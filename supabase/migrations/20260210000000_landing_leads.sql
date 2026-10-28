-- Prospects des pages d'acquisition /lp/* (essai gratuit, demande de rappel). Idempotente.
-- Écriture par le serveur uniquement (client service_role). RLS activée et FORCÉE, AUCUNE policy pour anon/authenticated :
-- aucune lecture client possible. (Pas de mécanisme « super-admin plateforme » existant : le super_admin actuel est un rôle d'organisation.)
create table if not exists public.landing_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('essai', 'rappel')),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  email text not null check (char_length(email) between 5 and 160),
  phone text not null check (char_length(phone) between 8 and 20),
  company text check (char_length(company) <= 200),
  trade text check (trade in ('installateurs', 'regies')),
  preferred_slot text check (preferred_slot in ('matin', 'apres-midi', 'peu-importe')),
  consent_at timestamptz,
  consent_text_version text check (char_length(consent_text_version) <= 40),
  utm jsonb not null default '{}'::jsonb check (jsonb_typeof(utm) = 'object' and pg_column_size(utm) <= 2048),
  referrer text check (char_length(referrer) <= 300),
  landing_path text check (char_length(landing_path) <= 60),
  ip_hash text check (char_length(ip_hash) <= 64),
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  notes text check (char_length(notes) <= 2000),
  -- Un rappel exige un consentement horodaté.
  constraint landing_leads_rappel_consent check (kind <> 'rappel' or consent_at is not null)
);
create index if not exists landing_leads_created_idx on public.landing_leads (created_at desc);
create index if not exists landing_leads_status_idx on public.landing_leads (status);
create index if not exists landing_leads_email_idx on public.landing_leads (email);
alter table public.landing_leads enable row level security;
alter table public.landing_leads force row level security;
revoke all on public.landing_leads from anon, authenticated;
