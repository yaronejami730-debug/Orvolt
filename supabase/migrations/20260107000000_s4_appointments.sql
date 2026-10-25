-- S4 : rendez-vous, zones d'intervention, cache de géocodage.

create extension if not exists btree_gist with schema extensions;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  assigned_to uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned','confirmed','done','cancelled','no_show')),
  location_address text check (char_length(location_address) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  distance_km numeric(7, 1) check (distance_km >= 0),
  distance_status text not null default 'no_zone' check (distance_status in ('ok','over_radius','no_geocode','no_zone')),
  distance_override boolean not null default false,
  override_reason text check (char_length(override_reason) <= 300),
  override_by uuid references auth.users (id) on delete set null,
  notes text check (char_length(notes) <= 2000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '12 hours'),
  check (not distance_override or char_length(btrim(coalesce(override_reason, ''))) >= 3),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade,
  foreign key (org_id, assigned_to) references public.memberships (org_id, user_id) on delete restrict,
  -- un commercial ne peut pas avoir deux rendez-vous simultanés (hors annulés)
  constraint appointments_no_overlap exclude using gist (
    org_id with =, assigned_to with =, tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled')
);
create index appointments_org_assigned_idx on public.appointments (org_id, assigned_to, starts_at);
create index appointments_lead_idx on public.appointments (lead_id, starts_at);

create table public.sales_zones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  base_address text not null check (char_length(btrim(base_address)) between 3 and 300),
  base_lat double precision not null check (base_lat between -90 and 90),
  base_lng double precision not null check (base_lng between -180 and 180),
  radius_km numeric(6, 1) not null check (radius_km between 5 and 200),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (org_id, user_id),
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade
);

-- Cache de géocodage : clé = hash de l'adresse normalisée ; service_role uniquement.
create table public.geocode_cache (
  key text primary key check (char_length(key) = 64),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  label text check (char_length(label) <= 300),
  provider text not null check (char_length(provider) <= 20),
  found boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ triggers
create function public.appointments_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.lead_id <> old.lead_id or new.created_by is distinct from old.created_by then
      raise exception 'immutable_appointment_fields' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  if auth.uid() is not null then
    -- Seul l'auteur de la dérogation est consigné ; jamais usurpable.
    if new.distance_override then
      if tg_op = 'INSERT' or not old.distance_override then new.override_by := auth.uid(); else new.override_by := old.override_by; end if;
      if new.distance_status <> 'over_radius' then raise exception 'override_not_needed' using errcode = 'P0001'; end if;
    else
      new.override_by := null; new.override_reason := null;
    end if;
    -- Un commercial « own » ne planifie que pour lui-même.
    if not public.has_perm(new.org_id, 'appointments.manage_all') and new.assigned_to <> auth.uid() then
      raise exception 'forbidden_assignee' using errcode = '42501';
    end if;
    if not exists (select 1 from public.memberships where org_id = new.org_id and user_id = new.assigned_to and status = 'active') then
      raise exception 'invalid_assignee' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger appointments_before before insert or update on public.appointments
  for each row execute function public.appointments_before();

create function public.appointments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text;
begin
  if tg_op = 'INSERT' then act := 'created';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then act := 'cancelled';
  elsif new.status <> old.status then act := 'status';
  elsif new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.assigned_to <> old.assigned_to
        or new.location_address is distinct from old.location_address then act := 'updated';
  else return new; end if;
  perform public.log_lead_event(new.org_id, new.lead_id, 'appointment', jsonb_build_object(
    'appointment_id', new.id, 'action', act, 'starts_at', new.starts_at, 'status', new.status, 'assigned_to', new.assigned_to,
    'distance_status', new.distance_status, 'override_reason', case when new.distance_override then new.override_reason end));
  return new;
end;
$$;
create trigger appointments_after after insert or update on public.appointments
  for each row execute function public.appointments_after();

create function public.zones_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.user_id <> old.user_id then raise exception 'immutable_org' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger sales_zones_guard before update on public.sales_zones for each row execute function public.zones_guard();
revoke all on function public.appointments_before(), public.appointments_after(), public.zones_guard() from public, anon, authenticated;

-- ------------------------------------------------------------ RLS
alter table public.appointments enable row level security;
alter table public.appointments force row level security;
alter table public.sales_zones enable row level security;
alter table public.sales_zones force row level security;
alter table public.geocode_cache enable row level security;
alter table public.geocode_cache force row level security;
revoke all on public.appointments, public.sales_zones, public.geocode_cache from anon, authenticated;
grant select, insert, update, delete on public.appointments, public.sales_zones to authenticated;

create policy appointments_select on public.appointments for select to authenticated using (
  public.is_org_member(org_id)
  and (public.has_perm(org_id, 'appointments.manage_all')
       or (public.has_perm(org_id, 'appointments.manage_own') and (assigned_to = auth.uid() or created_by = auth.uid())))
  and exists (select 1 from public.leads l where l.id = appointments.lead_id));
create policy appointments_insert on public.appointments for insert to authenticated with check (
  created_by = auth.uid()
  and (public.has_perm(org_id, 'appointments.manage_all') or (public.has_perm(org_id, 'appointments.manage_own') and assigned_to = auth.uid()))
  and exists (select 1 from public.leads l where l.id = appointments.lead_id));
create policy appointments_update on public.appointments for update to authenticated using (
  (public.has_perm(org_id, 'appointments.manage_all')
   or (public.has_perm(org_id, 'appointments.manage_own') and (assigned_to = auth.uid() or created_by = auth.uid())))
  and exists (select 1 from public.leads l where l.id = appointments.lead_id))
  with check (public.has_perm(org_id, 'appointments.manage_all') or (public.has_perm(org_id, 'appointments.manage_own') and assigned_to = auth.uid()));
create policy appointments_delete on public.appointments for delete to authenticated using (
  public.has_perm(org_id, 'appointments.manage_all')
  or (public.has_perm(org_id, 'appointments.manage_own') and (assigned_to = auth.uid() or created_by = auth.uid())));

-- Zones : lecture par soi, les gestionnaires d'équipe et ceux qui planifient pour tous ; écriture par soi ou members.manage.
create policy zones_select on public.sales_zones for select to authenticated using (
  public.is_org_member(org_id)
  and (user_id = auth.uid() or public.has_perm(org_id, 'members.manage') or public.has_perm(org_id, 'appointments.manage_all')));
create policy zones_insert on public.sales_zones for insert to authenticated
  with check (public.is_org_member(org_id) and (user_id = auth.uid() or public.has_perm(org_id, 'members.manage')));
create policy zones_update on public.sales_zones for update to authenticated
  using (user_id = auth.uid() or public.has_perm(org_id, 'members.manage'))
  with check (user_id = auth.uid() or public.has_perm(org_id, 'members.manage'));
create policy zones_delete on public.sales_zones for delete to authenticated
  using (user_id = auth.uid() or public.has_perm(org_id, 'members.manage'));
