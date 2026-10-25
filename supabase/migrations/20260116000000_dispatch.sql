-- Répartition automatique des RDV confirmés : permission dédiée, RDV « à attribuer », réglages par commercial et par organisation,
-- application atomique et rejouée en base (apply_dispatch).

-- ------------------------------------------------------------ 1) permission dispatch.manage
alter table public.roles drop constraint roles_permissions_known;
alter table public.roles add constraint roles_permissions_known check (permissions <@ array[
  'leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
  'statuses.manage','fields.manage','roles.manage','members.manage',
  'appointments.manage_all','appointments.manage_own','dashboard.view',
  'billing.manage','settings.manage','dispatch.manage']::text[]);

alter table public.roles disable trigger roles_guard;
update public.roles set permissions = array_append(permissions, 'dispatch.manage')
where not ('dispatch.manage' = any (permissions))
  and (system_key = 'administrator' or is_admin or (is_system and name = 'Confirmateur' and system_key is null));
alter table public.roles enable trigger roles_guard;

create or replace function public.create_organization(p_name text, p_template text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  org uuid;
  super_role uuid;
  base text;
  candidate text;
  all_perms text[] := array[
    'leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
    'statuses.manage','fields.manage','roles.manage','members.manage',
    'appointments.manage_all','appointments.manage_own','dashboard.view',
    'billing.manage','settings.manage','dispatch.manage'];
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) < 2 or char_length(p_name) > 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_template not in ('energie','btp','immobilier','auto','generic') then
    raise exception 'invalid_template' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  if (select count(*) from public.organizations where created_by = uid) >= 3 then
    raise exception 'org_limit_reached' using errcode = 'P0001';
  end if;

  base := regexp_replace(
    translate(lower(p_name), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '-', 'g');
  base := btrim(base, '-');
  if base = '' then base := 'org'; end if;
  candidate := base;
  while exists (select 1 from public.organizations where slug = candidate) loop
    candidate := base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  end loop;

  insert into public.organizations (name, slug, template, created_by)
  values (p_name, candidate, p_template, uid) returning id into org;

  insert into public.roles (org_id, name, description, is_system, is_admin, system_key, permissions)
  values (org, 'Super administrateur', 'Pouvoir total : programme les rôles, les permissions et les statuts de chaque rôle',
    true, true, 'super_admin', all_perms)
  returning id into super_role;

  insert into public.roles (org_id, name, description, is_system, system_key, permissions) values
    (org, 'Administrateur', 'Gère l''organisation dans la limite des droits accordés par le super administrateur', true, 'administrator',
      array['leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
        'statuses.manage','fields.manage','roles.manage','members.manage',
        'appointments.manage_all','appointments.manage_own','dashboard.view','settings.manage','dispatch.manage']);
  insert into public.roles (org_id, name, description, is_system, permissions) values
    (org, 'Prospecteur', 'Saisit et importe des leads, gère ses rendez-vous', true,
      array['leads.view_own','leads.create','leads.edit','leads.import','appointments.manage_own']),
    (org, 'Confirmateur', 'Qualifie les leads et planifie les rendez-vous', true,
      array['leads.view_all','leads.create','leads.edit','appointments.manage_all','dashboard.view','dispatch.manage']),
    (org, 'Commercial', 'Suit ses leads et ses rendez-vous', true,
      array['leads.view_own','leads.edit','appointments.manage_own']);

  insert into public.memberships (org_id, user_id, role_id, status)
  values (org, uid, super_role, 'active');

  perform public.apply_template(org, p_template);
  return org;
end;
$$;

-- ------------------------------------------------------------ 2) réglages de répartition par commercial (sur sales_zones)
alter table public.sales_zones
  add column work_start time not null default '09:00',
  add column work_end time not null default '19:00',
  add column max_per_day int not null default 4 check (max_per_day between 1 and 10),
  add column work_days smallint[] not null default '{1,2,3,4,5}'
    check (cardinality(work_days) between 1 and 7 and work_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  add column default_duration_min int not null default 60 check (default_duration_min between 15 and 480),
  add column travel_min_per_km numeric(4, 2) not null default 1.2 check (travel_min_per_km between 0.1 and 10),
  add column travel_margin_min int not null default 10 check (travel_margin_min between 0 and 120),
  add constraint sales_zones_work_window check (work_end > work_start);

-- Les réglages d'horaires ne s'écrivent que par la fonction set_member_work_settings (permission vérifiée en base).
revoke insert, update on public.sales_zones from authenticated;
grant insert (org_id, user_id, base_address, base_lat, base_lng, radius_km, active) on public.sales_zones to authenticated;
grant update (base_address, base_lat, base_lng, radius_km, active) on public.sales_zones to authenticated;

-- Réglages d'organisation
create table public.dispatch_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  max_leg_km numeric(5, 1) not null default 40 check (max_leg_km between 1 and 300),
  horizon_days int not null default 7 check (horizon_days between 1 and 30),
  updated_at timestamptz not null default now()
);
alter table public.dispatch_settings enable row level security;
alter table public.dispatch_settings force row level security;
revoke all on public.dispatch_settings from anon, authenticated;
grant select on public.dispatch_settings to authenticated;
create policy dispatch_settings_select on public.dispatch_settings for select to authenticated using (
  public.is_org_member(org_id)
  and (public.has_perm(org_id, 'dispatch.manage') or public.has_perm(org_id, 'members.manage') or public.has_perm(org_id, 'settings.manage')));

create function public.set_dispatch_org_settings(p_org uuid, p_max_leg_km numeric, p_horizon_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not (public.has_perm(p_org, 'dispatch.manage') or public.has_perm(p_org, 'settings.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_max_leg_km is null or p_max_leg_km < 1 or p_max_leg_km > 300 or p_horizon_days is null or p_horizon_days < 1 or p_horizon_days > 30 then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  insert into public.dispatch_settings (org_id, max_leg_km, horizon_days) values (p_org, p_max_leg_km, p_horizon_days)
  on conflict (org_id) do update set max_leg_km = excluded.max_leg_km, horizon_days = excluded.horizon_days, updated_at = now();
end;
$$;

create function public.set_member_work_settings(
  p_org uuid, p_user uuid, p_start time, p_end time, p_max int, p_days smallint[], p_duration int, p_rate numeric, p_margin int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not (public.has_perm(p_org, 'dispatch.manage') or public.has_perm(p_org, 'members.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_end <= p_start then raise exception 'invalid_window' using errcode = '22023'; end if;
  update public.sales_zones set work_start = p_start, work_end = p_end, max_per_day = p_max, work_days = p_days,
    default_duration_min = p_duration, travel_min_per_km = p_rate, travel_margin_min = p_margin, updated_at = now()
  where org_id = p_org and user_id = p_user;
  if not found then raise exception 'zone_required' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.set_dispatch_org_settings(uuid, numeric, int),
  public.set_member_work_settings(uuid, uuid, time, time, int, smallint[], int, numeric, int) from public, anon;
grant execute on function public.set_dispatch_org_settings(uuid, numeric, int),
  public.set_member_work_settings(uuid, uuid, time, time, int, smallint[], int, numeric, int) to authenticated;

-- ------------------------------------------------------------ 3) RDV « à attribuer »
alter table public.appointments alter column assigned_to drop not null;
alter table public.appointments alter column starts_at drop not null;
alter table public.appointments alter column ends_at drop not null;
alter table public.appointments
  add column dispatch_status text not null default 'assigned' check (dispatch_status in ('unassigned','assigned')),
  add column wish_from date,
  add column wish_to date,
  add column duration_min int check (duration_min between 15 and 480),
  add column dispatched_at timestamptz,
  add constraint appointments_dispatch_consistent check (
    (dispatch_status = 'assigned' and assigned_to is not null and starts_at is not null and ends_at is not null)
    or (dispatch_status = 'unassigned' and assigned_to is null and starts_at is null and ends_at is null
        and wish_from is not null and wish_to is not null and wish_to >= wish_from and duration_min is not null)),
  add constraint appointments_wish_span check (wish_to is null or wish_to - wish_from <= 30);
create index appointments_unassigned_idx on public.appointments (org_id, wish_from) where dispatch_status = 'unassigned';

-- Anti-chevauchement : uniquement quand le RDV est attribué.
alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap exclude using gist (
  org_id with =, assigned_to with =, tstzrange(starts_at, ends_at) with &&
) where (status <> 'cancelled' and dispatch_status = 'assigned');

-- Les clients (REST) ne créent jamais de RDV « à attribuer » ni ne changent le mode de répartition :
-- les colonnes dispatch_* / wish_* restent écrites par le serveur ou par apply_dispatch.
create or replace function public.appointments_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.lead_id <> old.lead_id or new.created_by is distinct from old.created_by then
      raise exception 'immutable_appointment_fields' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  if auth.uid() is not null then
    if tg_op = 'UPDATE' and (new.location_address is distinct from old.location_address or new.assigned_to is distinct from old.assigned_to)
       and current_setting('lf.dispatch', true) is distinct from 'on' then
      new.lat := null; new.lng := null; new.distance_km := null; new.distance_status := 'no_zone';
      new.distance_override := false; new.override_reason := null; new.override_by := null;
    end if;
    if new.assigned_to is not null then
      if not public.has_perm(new.org_id, 'appointments.manage_all') and new.assigned_to <> auth.uid() then
        raise exception 'forbidden_assignee' using errcode = '42501';
      end if;
      if not exists (select 1 from public.memberships where org_id = new.org_id and user_id = new.assigned_to and status = 'active') then
        raise exception 'invalid_assignee' using errcode = 'P0001';
      end if;
    elsif not public.has_perm(new.org_id, 'appointments.manage_all') and not public.has_perm(new.org_id, 'dispatch.manage') then
      raise exception 'forbidden_assignee' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.appointments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text;
begin
  if tg_op = 'INSERT' then act := case when new.dispatch_status = 'unassigned' then 'pending_dispatch' else 'created' end;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then act := 'cancelled';
  elsif old.dispatch_status = 'unassigned' and new.dispatch_status = 'assigned' then act := 'dispatched';
  elsif new.status <> old.status then act := 'status';
  elsif new.distance_override and not old.distance_override then act := 'override';
  elsif new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at or new.assigned_to is distinct from old.assigned_to
        or new.location_address is distinct from old.location_address then act := 'updated';
  else return new; end if;
  perform public.log_lead_event(new.org_id, new.lead_id, 'appointment', jsonb_build_object(
    'appointment_id', new.id, 'action', act, 'starts_at', new.starts_at, 'status', new.status, 'assigned_to', new.assigned_to,
    'distance_status', new.distance_status, 'override_reason', case when new.distance_override then new.override_reason end));
  return new;
end;
$$;

-- Lecture des RDV à attribuer : permission de répartition ou gestion globale (déjà couverte) ; on ajoute dispatch.manage.
drop policy appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated using (
  public.is_org_member(org_id)
  and (public.has_perm(org_id, 'appointments.manage_all') or public.has_perm(org_id, 'dispatch.manage')
       or (public.has_perm(org_id, 'appointments.manage_own') and (assigned_to = auth.uid() or created_by = auth.uid())))
  and exists (select 1 from public.leads l where l.id = appointments.lead_id));

-- ------------------------------------------------------------ 4) application atomique
create function public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 2 * 6371.0088 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

/*
 * apply_dispatch(p_org, p_items) : p_items = [{appointment_id, user_id, starts_at, ends_at}, ...].
 * Rejoue en base : appartenance org, droit dispatch.manage, RDV confirmé et à attribuer (idempotent si déjà posé à l'identique),
 * commercial actif avec zone, rayon, jour/horaires travaillés, max par jour, trajet max et durée de trajet entre RDV voisins,
 * chevauchement (contrainte d'exclusion). Tout ou rien. Verrou consultatif par organisation (double clic).
 */
create function public.apply_dispatch(p_org uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  tz constant text := 'Europe/Paris';
  it jsonb;
  a public.appointments%rowtype;
  z public.sales_zones%rowtype;
  v_leg numeric := 40;
  v_user uuid; v_start timestamptz; v_end timestamptz;
  v_day date; v_lstart time; v_lend time;
  v_km double precision; v_cnt int;
  prev record; nxt record;
  applied int := 0; skipped int := 0;
  per_user jsonb := '{}'::jsonb;
  batch uuid := gen_random_uuid();
  r record;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.has_perm(p_org, 'dispatch.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('dispatch:' || p_org::text));
  perform set_config('lf.dispatch', 'on', true);
  select max_leg_km into v_leg from public.dispatch_settings where org_id = p_org;
  v_leg := coalesce(v_leg, 40);

  for it in select value from jsonb_array_elements(p_items) order by (value ->> 'starts_at')::timestamptz loop
    v_user := (it ->> 'user_id')::uuid;
    v_start := (it ->> 'starts_at')::timestamptz;
    v_end := (it ->> 'ends_at')::timestamptz;
    select * into a from public.appointments where id = (it ->> 'appointment_id')::uuid and org_id = p_org for update;
    if not found then raise exception 'dispatch_appointment_not_found' using errcode = 'P0001'; end if;
    if a.dispatch_status = 'assigned' then
      if a.assigned_to = v_user and a.starts_at = v_start then skipped := skipped + 1; continue; end if;
      raise exception 'dispatch_already_assigned' using errcode = 'P0001';
    end if;
    if a.status <> 'confirmed' then raise exception 'dispatch_not_confirmed' using errcode = 'P0001'; end if;
    if v_end <= v_start or v_end - v_start > interval '12 hours' then raise exception 'dispatch_bad_slot' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.memberships where org_id = p_org and user_id = v_user and status = 'active') then
      raise exception 'dispatch_invalid_rep' using errcode = 'P0001';
    end if;
    select * into z from public.sales_zones where org_id = p_org and user_id = v_user and active;
    if not found then raise exception 'dispatch_no_zone' using errcode = 'P0001'; end if;
    if a.lat is null or a.lng is null then raise exception 'dispatch_no_geocode' using errcode = 'P0001'; end if;

    v_km := public.haversine_km(a.lat, a.lng, z.base_lat, z.base_lng);
    if v_km > z.radius_km + 0.05 then raise exception 'dispatch_out_of_zone' using errcode = 'P0001'; end if;

    v_day := (v_start at time zone tz)::date;
    v_lstart := (v_start at time zone tz)::time;
    v_lend := (v_end at time zone tz)::time;
    if (v_end at time zone tz)::date <> v_day or v_lstart < z.work_start or v_lend > z.work_end then
      raise exception 'dispatch_outside_hours' using errcode = 'P0001';
    end if;
    if not (extract(isodow from v_day)::smallint = any (z.work_days)) then raise exception 'dispatch_not_workday' using errcode = 'P0001'; end if;

    select count(*) into v_cnt from public.appointments
      where org_id = p_org and assigned_to = v_user and status <> 'cancelled' and dispatch_status = 'assigned'
        and (starts_at at time zone tz)::date = v_day and id <> a.id;
    if v_cnt >= z.max_per_day then raise exception 'dispatch_day_full' using errcode = 'P0001'; end if;

    -- voisins du même jour (déjà posés, y compris ceux de ce lot traités avant)
    select lat, lng, ends_at into prev from public.appointments
      where org_id = p_org and assigned_to = v_user and status <> 'cancelled' and dispatch_status = 'assigned'
        and (starts_at at time zone tz)::date = v_day and id <> a.id and ends_at <= v_start order by ends_at desc limit 1;
    select lat, lng, starts_at into nxt from public.appointments
      where org_id = p_org and assigned_to = v_user and status <> 'cancelled' and dispatch_status = 'assigned'
        and (starts_at at time zone tz)::date = v_day and id <> a.id and starts_at >= v_end order by starts_at asc limit 1;
    if prev.ends_at is not null and prev.lat is not null then
      v_km := public.haversine_km(prev.lat, prev.lng, a.lat, a.lng);
      if v_km > v_leg + 0.05 then raise exception 'dispatch_leg_too_long' using errcode = 'P0001'; end if;
      if extract(epoch from (v_start - prev.ends_at)) / 60 < ceil(v_km * z.travel_min_per_km + z.travel_margin_min) - 1 then
        raise exception 'dispatch_travel_time' using errcode = 'P0001';
      end if;
    elsif prev.ends_at is null then
      v_km := public.haversine_km(z.base_lat, z.base_lng, a.lat, a.lng);
      if (extract(epoch from v_lstart) - extract(epoch from z.work_start)) / 60 < ceil(v_km * z.travel_min_per_km + z.travel_margin_min) - 1 then
        raise exception 'dispatch_travel_time' using errcode = 'P0001';
      end if;
    end if;
    if nxt.starts_at is not null and nxt.lat is not null then
      v_km := public.haversine_km(a.lat, a.lng, nxt.lat, nxt.lng);
      if v_km > v_leg + 0.05 then raise exception 'dispatch_leg_too_long' using errcode = 'P0001'; end if;
      if extract(epoch from (nxt.starts_at - v_end)) / 60 < ceil(v_km * z.travel_min_per_km + z.travel_margin_min) - 1 then
        raise exception 'dispatch_travel_time' using errcode = 'P0001';
      end if;
    end if;

    update public.appointments set assigned_to = v_user, starts_at = v_start, ends_at = v_end, dispatch_status = 'assigned',
      dispatched_at = now(), distance_km = round(public.haversine_km(a.lat, a.lng, z.base_lat, z.base_lng)::numeric, 1), distance_status = 'ok'
    where id = a.id;
    applied := applied + 1;
    per_user := jsonb_set(per_user, array[v_user::text], to_jsonb(coalesce((per_user ->> v_user::text)::int, 0) + 1));
  end loop;

  for r in select key as u, value::text::int as n from jsonb_each(per_user) loop
    insert into public.notifications (org_id, user_id, type, payload, dedupe_key)
    values (p_org, r.u::uuid, 'appointment',
      jsonb_build_object('message', format('Répartition automatique : %s nouveau(x) rendez-vous dans votre agenda', r.n), 'count', r.n),
      'dispatch:' || batch::text || ':' || r.u);
  end loop;
  return jsonb_build_object('applied', applied, 'skipped', skipped);
end;
$$;
revoke all on function public.apply_dispatch(uuid, jsonb), public.haversine_km(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.apply_dispatch(uuid, jsonb), public.haversine_km(double precision, double precision, double precision, double precision) to authenticated;
