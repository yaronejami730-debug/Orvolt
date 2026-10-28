-- Reprise des événements Stripe bloqués : un plantage entre l'insertion et la fin du traitement laissait la ligne
-- en « processing » à vie (les rejeux Stripe étaient alors vus comme doublons). Le code reprend ceux > 5 min.
alter table public.stripe_events add column if not exists processing_at timestamptz not null default now();
alter table public.stripe_events add column if not exists processed_at timestamptz;
create index if not exists stripe_events_stuck_idx on public.stripe_events (processing_at) where status = 'processing';
