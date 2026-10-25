-- S7a : abonnement Stripe, idempotence des événements, accès en lecture seule.

-- Délai maximal explicite pour les requêtes des clients (appels RPC/REST directs) : 8 s.
alter role authenticated set statement_timeout = '8s';
alter role anon set statement_timeout = '3s';

alter table public.organizations add column current_period_end timestamptz;
alter table public.organizations add column cancel_at_period_end boolean not null default false;
alter table public.organizations add column past_due_since timestamptz;
alter table public.organizations add column stripe_event_at timestamptz;   -- horodatage du dernier événement Stripe appliqué (ordre)
-- Les colonnes de facturation restent invisibles en écriture pour les clients (grants par colonne, voir S1) ;
-- la lecture est autorisée aux membres (affichage du plan et des échéances).

-- Journal des événements Stripe : idempotence (clé primaire = id d'événement), aucun accès client.
create table public.stripe_events (
  id text primary key check (char_length(id) between 5 and 100),
  type text not null check (char_length(type) <= 100),
  org_id uuid references public.organizations (id) on delete set null,
  event_created timestamptz not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'ignored')),
  detail text check (char_length(detail) <= 300),
  received_at timestamptz not null default now()
);
create index stripe_events_org_idx on public.stripe_events (org_id, event_created desc);
alter table public.stripe_events enable row level security;
alter table public.stripe_events force row level security;
revoke all on public.stripe_events from anon, authenticated;

-- L'organisation peut-elle écrire ? essai applicatif ou Stripe en cours, abonnement actif, ou paiement échoué en délai de grâce (7 j).
-- Sinon : lecture seule (annulé, impayé, essai expiré, paiement incomplet).
create function public.org_is_writable(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case o.subscription_status
      when 'active' then true
      when 'trialing' then coalesce(o.trial_ends_at, now()) > now()
      when 'past_due' then coalesce(o.past_due_since, now()) + interval '7 days' > now()
      else false end
    from public.organizations o where o.id = org), false);
$$;
revoke all on function public.org_is_writable(uuid) from public, anon;
grant execute on function public.org_is_writable(uuid) to authenticated, service_role;

-- Garde de base de données : un client authentifié ne peut plus écrire les données métier d'une organisation en lecture seule.
-- (service_role : webhooks, import, moteur d'actions — contrôlés côté serveur applicatif.)
create function public.enforce_org_writable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.org_is_writable(new.org_id) then
    raise exception 'org_read_only' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_org_writable() from public, anon, authenticated;
create trigger leads_writable before insert or update on public.leads for each row execute function public.enforce_org_writable();
create trigger appointments_writable before insert or update on public.appointments for each row execute function public.enforce_org_writable();
create trigger lead_notes_writable before insert on public.lead_notes for each row execute function public.enforce_org_writable();
create trigger lead_calls_writable before insert on public.lead_calls for each row execute function public.enforce_org_writable();
create trigger lead_files_writable before insert on public.lead_files for each row execute function public.enforce_org_writable();
create trigger tasks_writable before insert on public.tasks for each row execute function public.enforce_org_writable();
