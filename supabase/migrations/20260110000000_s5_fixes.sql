-- S5 correctifs : secret de signature dérivé côté serveur, secret d'application Meta chiffré, plafond quotidien par organisation.

-- secret_version : le secret affiché (une fois) est dérivé par HKDF(clé serveur, endpoint, version) ; NULL = ancien secret
-- aléatoire (en-tête secret toujours valide, signature HMAC indisponible tant que le secret n'est pas régénéré).
alter table public.inbound_endpoints add column secret_version int check (secret_version >= 1);
alter table public.inbound_endpoints add column meta_app_secret_enc text check (char_length(meta_app_secret_enc) <= 600);
alter table public.inbound_endpoints add column has_meta_secret boolean generated always as (meta_app_secret_enc is not null) stored;
grant select (secret_version, has_meta_secret) on public.inbound_endpoints to authenticated; -- jamais meta_app_secret_enc ni secret_hash

alter table public.organizations add column inbound_daily_limit int not null default 5000 check (inbound_daily_limit between 1 and 1000000);
create index inbound_events_org_idx on public.inbound_events (org_id, received_at desc);
