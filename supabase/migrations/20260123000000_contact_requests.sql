-- Demandes de contact de la page publique /contact (« être recontacté »).
-- Écriture par le serveur uniquement (service_role) : aucun accès client, comme stripe_events.
create table public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  email text not null check (char_length(email) between 5 and 160),
  phone text not null check (char_length(phone) between 6 and 30),
  company text check (char_length(company) <= 120),
  message text check (char_length(message) <= 1000),
  source text not null default 'contact' check (char_length(source) <= 40),
  created_at timestamptz not null default now()
);
create index contact_requests_created_idx on public.contact_requests (created_at desc);
alter table public.contact_requests enable row level security;
alter table public.contact_requests force row level security;
revoke all on public.contact_requests from anon, authenticated;
