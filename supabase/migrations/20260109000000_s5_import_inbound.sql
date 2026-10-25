-- S5 : import CSV, webhooks entrants, dédoublonnage.

-- ------------------------------------------------------------ normalisation (dédoublonnage)
-- Téléphone « E.164 approché » : 0612345678 / +33 6 12 34 56 78 / 0033612345678 => +33612345678.
create function public.normalize_phone(p text) returns text
language sql immutable parallel safe set search_path = public as $$
  select case
    when p is null then null
    when regexp_replace(p, '\D', '', 'g') = '' then null
    when btrim(p) like '+%' then '+' || regexp_replace(p, '\D', '', 'g')
    when regexp_replace(p, '\D', '', 'g') like '00%' then '+' || substr(regexp_replace(p, '\D', '', 'g'), 3)
    when regexp_replace(p, '\D', '', 'g') ~ '^0[1-9]\d{8}$' then '+33' || substr(regexp_replace(p, '\D', '', 'g'), 2)
    when regexp_replace(p, '\D', '', 'g') ~ '^33[1-9]\d{8}$' then '+' || regexp_replace(p, '\D', '', 'g')
    else regexp_replace(p, '\D', '', 'g')
  end;
$$;

revoke all on function public.normalize_phone(text) from public, anon;
grant execute on function public.normalize_phone(text) to authenticated, service_role;

alter table public.leads add column email_norm text generated always as (nullif(lower(btrim(email)), '')) stored;
alter table public.leads add column phone_norm text generated always as (public.normalize_phone(phone)) stored;
create index leads_org_email_norm_idx on public.leads (org_id, email_norm) where email_norm is not null;
create index leads_org_phone_norm_idx on public.leads (org_id, phone_norm) where phone_norm is not null;

-- ------------------------------------------------------------ import_jobs
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 200),
  file_path text check (char_length(file_path) <= 300),
  status text not null default 'uploaded' check (status in ('uploaded','validated','running','done','failed')),
  total int not null default 0 check (total >= 0),
  created_count int not null default 0,
  updated_count int not null default 0,
  skipped_count int not null default 0,
  failed_count int not null default 0,
  mapping jsonb not null default '{}' check (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) < 20000),
  options jsonb not null default '{}' check (jsonb_typeof(options) = 'object' and pg_column_size(options) < 20000),
  error_report jsonb not null default '[]' check (jsonb_typeof(error_report) = 'array' and pg_column_size(error_report) < 400000),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index import_jobs_org_idx on public.import_jobs (org_id, created_at desc);

-- ------------------------------------------------------------ inbound_endpoints
create table public.inbound_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('generic','meta','google')),
  token text not null unique check (char_length(token) >= 32),
  secret_hash text not null check (char_length(secret_hash) = 64),
  secret_prefix text not null check (char_length(secret_prefix) between 4 and 12),
  default_source_id uuid,
  mapping jsonb not null default '{}' check (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) < 8000),
  dedupe_window_hours int not null default 72 check (dedupe_window_hours between 0 and 8760),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  secret_rotated_at timestamptz,
  unique (id, org_id),
  foreign key (default_source_id, org_id) references public.lead_sources (id, org_id) on delete restrict
);

create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  endpoint_id uuid not null,
  received_at timestamptz not null default now(),
  status text not null check (status in ('created','duplicate','rejected')),
  reason text check (char_length(reason) <= 200),
  lead_id uuid,
  payload jsonb check (payload is null or pg_column_size(payload) < 6000),
  ip_hash text check (char_length(ip_hash) <= 64),
  foreign key (endpoint_id, org_id) references public.inbound_endpoints (id, org_id) on delete cascade,
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete set null (lead_id)
);
create index inbound_events_endpoint_idx on public.inbound_events (endpoint_id, received_at desc);

-- Rétention : événements supprimés après p_days, payload (données personnelles) effacé après p_mask_days.
create function public.purge_inbound_events(p_days int default 90, p_mask_days int default 14) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.inbound_events where received_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  update public.inbound_events set payload = null where payload is not null and received_at < now() - make_interval(days => p_mask_days);
  return n;
end;
$$;
create function public.purge_import_jobs(p_days int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.import_jobs where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.purge_inbound_events(int, int), public.purge_import_jobs(int) from public, anon, authenticated;
grant execute on function public.purge_inbound_events(int, int), public.purge_import_jobs(int) to service_role;

-- ------------------------------------------------------------ RLS
alter table public.import_jobs enable row level security;
alter table public.import_jobs force row level security;
alter table public.inbound_endpoints enable row level security;
alter table public.inbound_endpoints force row level security;
alter table public.inbound_events enable row level security;
alter table public.inbound_events force row level security;
revoke all on public.import_jobs, public.inbound_endpoints, public.inbound_events from anon, authenticated;

-- Écritures : uniquement serveur (service_role) après contrôle de permission ; lecture selon permission.
grant select on public.import_jobs to authenticated;
grant select (id, org_id, name, kind, token, secret_prefix, default_source_id, mapping, dedupe_window_hours, active, created_by, created_at, secret_rotated_at)
  on public.inbound_endpoints to authenticated;   -- secret_hash n'est jamais lisible par un client
grant select on public.inbound_events to authenticated;

create policy import_jobs_select on public.import_jobs for select to authenticated
  using (public.has_perm(org_id, 'leads.import') and (user_id = auth.uid() or public.is_org_admin(org_id)));
create policy inbound_endpoints_select on public.inbound_endpoints for select to authenticated
  using (public.has_perm(org_id, 'settings.manage'));
create policy inbound_events_select on public.inbound_events for select to authenticated
  using (public.has_perm(org_id, 'settings.manage'));

-- ------------------------------------------------------------ Storage : bucket privé des fichiers CSV (service_role uniquement)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 5242880, array['text/csv','text/plain','application/csv','application/vnd.ms-excel'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
