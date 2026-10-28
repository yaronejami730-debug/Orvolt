-- Tunnel d'inscription : suivi de conversion (funnel_events) et relances d'onboarding (idempotentes via *_sent_at). Idempotent.

create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  step text not null check (step in ('signup_started', 'email_verified', 'account_created', 'onboarding_done', 'checkout_opened', 'trial_started', 'subscription_active')),
  org_id uuid references public.organizations (id) on delete set null,
  -- Empreinte non réversible de l'adresse (HMAC tronqué) : relie les étapes d'avant la création du compte, sans stocker l'adresse.
  visitor_key text check (visitor_key is null or char_length(visitor_key) between 8 and 64),
  plan text check (plan is null or char_length(plan) <= 20),
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  source text check (source is null or char_length(source) <= 30),
  created_at timestamptz not null default now()
);
-- Une seule occurrence d'une étape par organisation (ou par visiteur avant la création du compte).
create unique index if not exists funnel_events_once on public.funnel_events (coalesce(org_id::text, visitor_key), step);
create index if not exists funnel_events_step_idx on public.funnel_events (step, created_at);
alter table public.funnel_events enable row level security;
alter table public.funnel_events force row level security;
revoke all on public.funnel_events from anon, authenticated;
-- Aucune politique : seul le service-role (qui contourne la RLS) lit et écrit.

alter table public.organizations
  add column if not exists onboarding_reminder1_sent_at timestamptz,
  add column if not exists onboarding_reminder2_sent_at timestamptz,
  add column if not exists reminders_optout_at timestamptz;
