-- Vérification de l'adresse e-mail à l'inscription : code à 6 chiffres (haché), valable 10 min, 5 essais.
-- Écrit et lu par le serveur uniquement (service_role) ; aucun accès client.
create table public.email_verifications (
  email text primary key check (char_length(email) between 5 and 160),
  code_hash text not null check (char_length(code_hash) = 64),
  expires_at timestamptz not null,
  attempts int not null default 0,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.email_verifications enable row level security;
alter table public.email_verifications force row level security;
revoke all on public.email_verifications from anon, authenticated;
