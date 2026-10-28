-- Programmation des formulaires d'appel (trames) par téléprospecteur et par domaine. Idempotent.
--  1) call_domains : domaines d'activité de l'organisation (Pompe à chaleur, Photovoltaïque…).
--  2) member_call_domains : domaines sur lesquels travaille un membre.
--  3) call_script_assignments : à qui (membre / domaine / tout le monde) et quand (période, jours, plage horaire Europe/Paris) un formulaire est proposé.
--  4) call_scripts.domain_id, leads.call_domain_id, call_script_runs.domain_name.
-- Droit de programmation : members.manage OU settings.manage. Fonction réservée au plan Pro et au-dessus (org_has_programming).
-- La résolution (qui voit quoi) est dans 20260212000001_call_scripts_resolution.sql.

-- ------------------------------------------------------------ helpers
-- Plan Pro et au-dessus, ou essai en cours (miroir de entitlementHas côté application). Une sous-régie lit le plan de sa régie maître.
create or replace function public.org_has_programming(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (o.subscription_status = 'trialing' and coalesce(o.trial_ends_at, now()) > now()) or o.plan in ('pro', 'business', 'premium')
    from public.organizations o
    where o.id = coalesce((select b.parent_org_id from public.organizations b where b.id = p_org), p_org)
  ), false);
$$;
revoke all on function public.org_has_programming(uuid) from public, anon;
grant execute on function public.org_has_programming(uuid) to authenticated, service_role;

create or replace function public.is_call_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_perm(p_org, 'members.manage') or public.has_perm(p_org, 'settings.manage');
$$;
revoke all on function public.is_call_manager(uuid) from public, anon;
grant execute on function public.is_call_manager(uuid) to authenticated, service_role;

-- ------------------------------------------------------------ 1) domaines
create table if not exists public.call_domains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
create unique index if not exists call_domains_org_name_uidx on public.call_domains (org_id, lower(btrim(name)));

-- ------------------------------------------------------------ 2) domaines d'un membre
create table if not exists public.member_call_domains (
  org_id uuid not null,
  user_id uuid not null,
  domain_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, domain_id),
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade,
  foreign key (domain_id, org_id) references public.call_domains (id, org_id) on delete cascade
);
create index if not exists member_call_domains_org_user_idx on public.member_call_domains (org_id, user_id);
create index if not exists member_call_domains_domain_idx on public.member_call_domains (domain_id, org_id);

-- ------------------------------------------------------------ rattachements aux trames, leads, saisies
alter table public.call_scripts add column if not exists domain_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'call_scripts_domain_fk') then
    alter table public.call_scripts add constraint call_scripts_domain_fk
      foreign key (domain_id, org_id) references public.call_domains (id, org_id) on delete set null (domain_id);
  end if;
end $$;
create index if not exists call_scripts_domain_idx on public.call_scripts (domain_id, org_id);

alter table public.leads add column if not exists call_domain_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_call_domain_fk') then
    alter table public.leads add constraint leads_call_domain_fk
      foreign key (call_domain_id, org_id) references public.call_domains (id, org_id) on delete set null (call_domain_id);
  end if;
end $$;
create index if not exists leads_call_domain_idx on public.leads (call_domain_id, org_id);
grant update (call_domain_id) on public.leads to authenticated;

-- Domaine figé à la saisie (comme script_name).
alter table public.call_script_runs add column if not exists domain_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'call_script_runs_domain_name_len') then
    alter table public.call_script_runs add constraint call_script_runs_domain_name_len check (domain_name is null or char_length(domain_name) <= 60);
  end if;
end $$;

-- leads_api : même définition qu'en 20260209000003 (dont phone_norm) + le domaine (colonne ajoutée en fin de vue : create or replace view n'accepte que des ajouts en fin).
create or replace view public.leads_api as
select l.id, l.org_id, l.status_id, l.source_id, l.assigned_to, l.first_name, l.last_name, l.company, l.email, l.phone,
  l.address, l.city, l.postal_code, l.lat, l.lng, l.value,
  case when l.custom = '{}'::jsonb then l.custom else public.mask_custom(l.org_id, l.custom) end as custom,
  l.created_by, l.position, l.archived_at, l.created_at, l.updated_at, l.search_text, l.phone_norm, l.call_domain_id
from public.leads l
where not l.is_simulation
  and (l.org_id = any ((select public.perm_orgs('leads.view_all'))::uuid[])
    or (l.org_id = any ((select public.perm_orgs('leads.view_own'))::uuid[])
        and (l.assigned_to = (select auth.uid()) or l.created_by = (select auth.uid()))));

-- Historique du lead : un type d'événement « formulaire d'appel rempli ».
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.lead_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status_changed%' loop
    execute format('alter table public.lead_events drop constraint %I', c);
  end loop;
  alter table public.lead_events add constraint lead_events_type_check
    check (type in ('created','status_changed','assigned','note','call','appointment','field_changed','file','action_executed','script'));
end $$;

-- ------------------------------------------------------------ 3) affectations (qui / quand)
create table if not exists public.call_script_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  script_id uuid not null,
  scope text not null check (scope in ('member', 'domain', 'all')),
  user_id uuid,
  domain_id uuid,
  starts_on date,                                   -- jour local (Europe/Paris), inclus
  ends_on date,                                     -- jour local (Europe/Paris), inclus
  days smallint[],                                  -- jours ISO 1 (lundi) à 7 (dimanche) ; null = tous
  time_from time,                                   -- plage horaire locale [time_from, time_to[ ; null = toute la journée
  time_to time,
  active boolean not null default true,
  priority int not null default 0 check (priority between 0 and 100),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((scope = 'member' and user_id is not null and domain_id is null)
      or (scope = 'domain' and domain_id is not null and user_id is null)
      or (scope = 'all' and user_id is null and domain_id is null)),
  check (starts_on is null or ends_on is null or ends_on >= starts_on),
  check (days is null or (cardinality(days) between 1 and 7 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  check ((time_from is null) = (time_to is null) and (time_from is null or time_from < time_to)),
  foreign key (script_id, org_id) references public.call_scripts (id, org_id) on delete cascade,
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade,
  foreign key (domain_id, org_id) references public.call_domains (id, org_id) on delete cascade
);
create index if not exists call_script_assignments_script_idx on public.call_script_assignments (script_id, org_id);
create index if not exists call_script_assignments_member_idx on public.call_script_assignments (org_id, user_id) where user_id is not null;
create index if not exists call_script_assignments_domain_idx on public.call_script_assignments (domain_id, org_id) where domain_id is not null;
-- Pas de doublon exact (même formulaire, même cible, mêmes fenêtres).
create unique index if not exists call_script_assignments_dedupe_uidx on public.call_script_assignments (
  script_id, scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(domain_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(starts_on, '0001-01-01'::date), coalesce(ends_on, '9999-12-31'::date), coalesce(days, '{}'::smallint[]),
  coalesce(time_from, '00:00'::time), coalesce(time_to, '00:00'::time));

-- ------------------------------------------------------------ plafonds + normalisation (triggers)
create or replace function public.call_programming_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'call_domains' then
    if (select count(*) from public.call_domains where org_id = new.org_id) >= 30 then raise exception 'too_many_domains' using errcode = 'P0001'; end if;
  elsif tg_table_name = 'member_call_domains' then
    if (select count(*) from public.member_call_domains where org_id = new.org_id and user_id = new.user_id) >= 10 then raise exception 'too_many_member_domains' using errcode = 'P0001'; end if;
  elsif tg_table_name = 'call_script_assignments' then
    if new.days is not null then
      new.days := (select array_agg(d order by d) from (select distinct unnest(new.days) as d) x);
    end if;
    if tg_op = 'INSERT' then
      if (select count(*) from public.call_script_assignments where org_id = new.org_id) >= 300 then raise exception 'too_many_assignments' using errcode = 'P0001'; end if;
      if (select count(*) from public.call_script_assignments where script_id = new.script_id) >= 40 then raise exception 'too_many_assignments_script' using errcode = 'P0001'; end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.call_programming_guard() from public, anon, authenticated;
drop trigger if exists call_domains_guard on public.call_domains;
create trigger call_domains_guard before insert on public.call_domains for each row execute function public.call_programming_guard();
drop trigger if exists member_call_domains_guard on public.member_call_domains;
create trigger member_call_domains_guard before insert on public.member_call_domains for each row execute function public.call_programming_guard();
drop trigger if exists call_script_assignments_guard on public.call_script_assignments;
create trigger call_script_assignments_guard before insert or update on public.call_script_assignments for each row execute function public.call_programming_guard();

-- Lecture seule d'organisation (abonnement inactif) : aucune écriture client.
do $$
declare t text;
begin
  foreach t in array array['call_domains', 'member_call_domains', 'call_script_assignments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_writable', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_org_writable()', t || '_writable', t);
  end loop;
end $$;

-- ------------------------------------------------------------ RLS (forcée)
alter table public.call_domains enable row level security;
alter table public.member_call_domains enable row level security;
alter table public.call_script_assignments enable row level security;
alter table public.call_domains force row level security;
alter table public.member_call_domains force row level security;
alter table public.call_script_assignments force row level security;
revoke all on public.call_domains, public.member_call_domains, public.call_script_assignments from anon, authenticated;
grant select, insert, delete on public.call_domains, public.member_call_domains, public.call_script_assignments to authenticated;
grant update (name, color, active, position) on public.call_domains to authenticated;
grant update (script_id, scope, user_id, domain_id, starts_on, ends_on, days, time_from, time_to, active, priority) on public.call_script_assignments to authenticated;

-- Domaines : lisibles par tous les membres actifs (liste de saisie du lead) ; écriture réservée aux gérants (plan Pro+ pour créer / modifier).
drop policy if exists call_domains_select on public.call_domains;
create policy call_domains_select on public.call_domains for select to authenticated using (public.is_org_member(org_id));
drop policy if exists call_domains_insert on public.call_domains;
create policy call_domains_insert on public.call_domains for insert to authenticated
  with check (public.is_call_manager(org_id) and public.org_has_programming(org_id));
drop policy if exists call_domains_update on public.call_domains;
create policy call_domains_update on public.call_domains for update to authenticated
  using (public.is_call_manager(org_id)) with check (public.is_call_manager(org_id) and public.org_has_programming(org_id));
drop policy if exists call_domains_delete on public.call_domains;
create policy call_domains_delete on public.call_domains for delete to authenticated using (public.is_call_manager(org_id));

-- Domaines d'un membre : chacun voit les siens, les gérants voient tout ; un téléprospecteur ne modifie pas les siens.
drop policy if exists member_call_domains_select on public.member_call_domains;
create policy member_call_domains_select on public.member_call_domains for select to authenticated
  using (public.is_org_member(org_id) and (user_id = auth.uid() or public.is_call_manager(org_id)));
drop policy if exists member_call_domains_insert on public.member_call_domains;
create policy member_call_domains_insert on public.member_call_domains for insert to authenticated
  with check (public.is_call_manager(org_id) and public.org_has_programming(org_id));
drop policy if exists member_call_domains_delete on public.member_call_domains;
create policy member_call_domains_delete on public.member_call_domains for delete to authenticated using (public.is_call_manager(org_id));

-- Affectations : invisibles pour un téléprospecteur (il passe par call_scripts_for_member).
drop policy if exists call_script_assignments_select on public.call_script_assignments;
create policy call_script_assignments_select on public.call_script_assignments for select to authenticated using (public.is_call_manager(org_id));
drop policy if exists call_script_assignments_insert on public.call_script_assignments;
create policy call_script_assignments_insert on public.call_script_assignments for insert to authenticated
  with check (public.is_call_manager(org_id) and public.org_has_programming(org_id) and created_by = auth.uid());
drop policy if exists call_script_assignments_update on public.call_script_assignments;
create policy call_script_assignments_update on public.call_script_assignments for update to authenticated
  using (public.is_call_manager(org_id)) with check (public.is_call_manager(org_id) and public.org_has_programming(org_id));
drop policy if exists call_script_assignments_delete on public.call_script_assignments;
create policy call_script_assignments_delete on public.call_script_assignments for delete to authenticated using (public.is_call_manager(org_id));
