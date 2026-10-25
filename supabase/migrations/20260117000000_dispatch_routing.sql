-- Répartition : itinéraires routiers réels (cache de trajets), indisponibilités, dernier mot du confirmateur (verrou),
-- signalement de problème par le commercial. Le moteur propose ; le confirmateur / admin / super admin décide.

-- ------------------------------------------------------------ 1) cache de trajets routiers
-- Clé = « lat,lng>lat,lng » arrondie à 4 décimales (~11 m). Écrit par le serveur (service_role) ; lu par apply_dispatch.
create table public.routing_cache (
  key text primary key check (char_length(key) <= 80),
  duration_s int not null check (duration_s >= 0),
  distance_m int not null check (distance_m >= 0),
  provider text not null check (char_length(provider) <= 20),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.routing_cache enable row level security;
alter table public.routing_cache force row level security;
revoke all on public.routing_cache from anon, authenticated;

create function public.route_key(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns text
language sql immutable as $$
  select round(lat1::numeric, 4)::text || ',' || round(lng1::numeric, 4)::text || '>' || round(lat2::numeric, 4)::text || ',' || round(lng2::numeric, 4)::text
$$;

-- Trajet routier A -> B : cache d'abord ; sinon estimation (vol d'oiseau x 1,4 à 50 km/h) uniquement si p_allow_estimate.
create function public.route_leg(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision, p_allow_estimate boolean)
returns table (duration_s int, distance_m int)
language plpgsql security definer set search_path = public as $$
declare k text := public.route_key(lat1, lng1, lat2, lng2); h double precision;
begin
  if k = public.route_key(lat2, lng2, lat2, lng2) then return query select 0, 0; return; end if;
  return query select c.duration_s, c.distance_m from public.routing_cache c where c.key = k and c.expires_at > now();
  if found then return; end if;
  if not p_allow_estimate then raise exception 'dispatch_route_unknown' using errcode = 'P0001'; end if;
  h := public.haversine_km(lat1, lng1, lat2, lng2) * 1.4;
  return query select ceil(h / 50 * 3600)::int, ceil(h * 1000)::int;
end;
$$;
revoke all on function public.route_key(double precision, double precision, double precision, double precision),
  public.route_leg(double precision, double precision, double precision, double precision, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------ 2) réglages d'organisation : minutes de route
alter table public.dispatch_settings
  add column max_leg_min int not null default 45 check (max_leg_min between 5 and 300),
  add column max_base_min int not null default 75 check (max_base_min between 5 and 480),
  add column traffic_morning_coef numeric(3, 2) not null default 1.25 check (traffic_morning_coef between 1 and 3),
  add column traffic_evening_coef numeric(3, 2) not null default 1.40 check (traffic_evening_coef between 1 and 3),
  add column safety_margin_pct int not null default 10 check (safety_margin_pct between 0 and 100),
  -- règle de charge : norme 3 RDV/jour, 4 possible (détour faible), 5 exceptionnel (jamais automatique)
  add column target_per_day int not null default 3 check (target_per_day between 1 and 10),
  add column comfort_max int not null default 4 check (comfort_max between 1 and 10),
  add column absolute_max int not null default 5 check (absolute_max between 1 and 10),
  add column max_extra_minutes int not null default 20 check (max_extra_minutes between 0 and 120),
  add constraint dispatch_load_order check (target_per_day <= comfort_max and comfort_max <= absolute_max);

-- surcharges par commercial (null = valeur de l'organisation) ; max_per_day est remplacé par ces seuils
alter table public.sales_zones drop column max_per_day;
alter table public.sales_zones
  add column target_per_day int check (target_per_day between 1 and 10),
  add column comfort_max int check (comfort_max between 1 and 10),
  add column absolute_max int check (absolute_max between 1 and 10),
  add constraint sales_zones_load_order check (coalesce(target_per_day, 1) <= coalesce(comfort_max, 10) and coalesce(comfort_max, 1) <= coalesce(absolute_max, 10) and coalesce(target_per_day, 1) <= coalesce(absolute_max, 10));
-- l'upsert REST de la zone envoie aussi org_id / user_id (immuables, protégés par le déclencheur zones_guard)
grant update (org_id, user_id) on public.sales_zones to authenticated;

drop function public.set_member_work_settings(uuid, uuid, time, time, int, smallint[], int, numeric, int);
create function public.set_member_work_settings(
  p_org uuid, p_user uuid, p_start time, p_end time, p_days smallint[], p_duration int, p_rate numeric, p_margin int,
  p_target int, p_comfort int, p_absolute int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not (public.has_perm(p_org, 'dispatch.manage') or public.has_perm(p_org, 'members.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_end <= p_start then raise exception 'invalid_window' using errcode = '22023'; end if;
  if coalesce(p_target, 1) > coalesce(p_comfort, 10) or coalesce(p_comfort, 1) > coalesce(p_absolute, 10) or coalesce(p_target, 1) > coalesce(p_absolute, 10) then
    raise exception 'invalid_load' using errcode = '22023';
  end if;
  update public.sales_zones set work_start = p_start, work_end = p_end, work_days = p_days,
    default_duration_min = p_duration, travel_min_per_km = p_rate, travel_margin_min = p_margin,
    target_per_day = p_target, comfort_max = p_comfort, absolute_max = p_absolute, updated_at = now()
  where org_id = p_org and user_id = p_user;
  if not found then raise exception 'zone_required' using errcode = 'P0001'; end if;
end;
$$;
revoke all on function public.set_member_work_settings(uuid, uuid, time, time, smallint[], int, numeric, int, int, int, int) from public, anon;
grant execute on function public.set_member_work_settings(uuid, uuid, time, time, smallint[], int, numeric, int, int, int, int) to authenticated;

-- Durée de trajet avec circulation estimée selon l'heure de départ : heures de pointe en semaine 7h30-9h30 et 16h30-19h30,
-- coefficient appliqué aux trajets de plus de 15 min, puis marge de sécurité en %. Même formule que src/lib/dispatch/traffic.ts.
create function public.traffic_minutes(p_base_s int, p_day date, p_depart_min int, p_morning numeric, p_evening numeric, p_safety int) returns int
language sql immutable as $$
  select ceil(p_base_s / 60.0 * (case when p_base_s > 900 and extract(isodow from p_day) <= 5 then
      (case when p_depart_min >= 450 and p_depart_min < 570 then p_morning when p_depart_min >= 990 and p_depart_min < 1170 then p_evening else 1 end)
    else 1 end) * (1 + p_safety / 100.0))::int
$$;
revoke all on function public.traffic_minutes(int, date, int, numeric, numeric, int) from public, anon, authenticated;

drop function public.set_dispatch_org_settings(uuid, numeric, int);
create function public.set_dispatch_org_settings(p_org uuid, p_max_leg_km numeric, p_horizon_days int, p_max_leg_min int, p_max_base_min int, p_morning numeric, p_evening numeric, p_safety int, p_target int, p_comfort int, p_absolute int, p_extra int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not (public.has_perm(p_org, 'dispatch.manage') or public.has_perm(p_org, 'settings.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_max_leg_km is null or p_max_leg_km < 1 or p_max_leg_km > 300 or p_horizon_days is null or p_horizon_days < 1 or p_horizon_days > 30
     or p_max_leg_min is null or p_max_leg_min < 5 or p_max_leg_min > 300 or p_max_base_min is null or p_max_base_min < 5 or p_max_base_min > 480
     or p_target is null or p_comfort is null or p_absolute is null or p_extra is null or p_target < 1 or p_target > p_comfort or p_comfort > p_absolute or p_absolute > 10 or p_extra < 0 or p_extra > 120
     or p_morning is null or p_morning < 1 or p_morning > 3 or p_evening is null or p_evening < 1 or p_evening > 3 or p_safety is null or p_safety < 0 or p_safety > 100 then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  insert into public.dispatch_settings (org_id, max_leg_km, horizon_days, max_leg_min, max_base_min, traffic_morning_coef, traffic_evening_coef, safety_margin_pct, target_per_day, comfort_max, absolute_max, max_extra_minutes)
  values (p_org, p_max_leg_km, p_horizon_days, p_max_leg_min, p_max_base_min, p_morning, p_evening, p_safety, p_target, p_comfort, p_absolute, p_extra)
  on conflict (org_id) do update set max_leg_km = excluded.max_leg_km, horizon_days = excluded.horizon_days,
    max_leg_min = excluded.max_leg_min, max_base_min = excluded.max_base_min, traffic_morning_coef = excluded.traffic_morning_coef,
    traffic_evening_coef = excluded.traffic_evening_coef, safety_margin_pct = excluded.safety_margin_pct,
    target_per_day = excluded.target_per_day, comfort_max = excluded.comfort_max, absolute_max = excluded.absolute_max, max_extra_minutes = excluded.max_extra_minutes, updated_at = now();
end;
$$;
revoke all on function public.set_dispatch_org_settings(uuid, numeric, int, int, int, numeric, numeric, int, int, int, int, int) from public, anon;
grant execute on function public.set_dispatch_org_settings(uuid, numeric, int, int, int, numeric, numeric, int, int, int, int, int) to authenticated;

-- ------------------------------------------------------------ 3) verrou du confirmateur + signalement
alter table public.appointments
  add column locked_by_dispatcher boolean not null default false,
  add column locked_by uuid references auth.users (id) on delete set null,
  add column locked_at timestamptz,
  add column issue_message text check (char_length(issue_message) <= 500),
  add column issue_at timestamptz,
  add column issue_by uuid references auth.users (id) on delete set null,
  -- position corrigée sur un RDV déjà réparti : le confirmateur peut « rééquilibrer » (jamais un RDV verrouillé)
  add column needs_rebalance boolean not null default false;

create or replace function public.appointments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare moved boolean := false; is_dispatcher boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.lead_id <> old.lead_id or new.created_by is distinct from old.created_by then
      raise exception 'immutable_appointment_fields' using errcode = '42501';
    end if;
    new.updated_at := now();
    moved := new.assigned_to is distinct from old.assigned_to or new.starts_at is distinct from old.starts_at
             or new.ends_at is distinct from old.ends_at or new.dispatch_status is distinct from old.dispatch_status;
    if moved and old.locked_by_dispatcher and coalesce(current_setting('lf.dispatcher', true), '') <> 'on' then
      -- Ni le moteur (service_role) ni un client ne défait une décision du confirmateur : il faut d'abord déverrouiller.
      raise exception 'locked_by_dispatcher' using errcode = '42501';
    end if;
    if moved and auth.uid() is not null and old.dispatched_at is not null and coalesce(current_setting('lf.dispatcher', true), '') <> 'on' and coalesce(current_setting('lf.dispatch', true), '') <> 'on' then
      is_dispatcher := public.has_perm(new.org_id, 'appointments.manage_all') or public.has_perm(new.org_id, 'dispatch.manage');
      -- Un commercial ne déplace ni ne réattribue un RDV réparti ; une modification manuelle du confirmateur est verrouillée.
      if not is_dispatcher then raise exception 'dispatched_readonly' using errcode = '42501'; end if;
      new.locked_by_dispatcher := true; new.locked_by := auth.uid(); new.locked_at := now();
    end if;
  end if;
  if auth.uid() is not null then
    if tg_op = 'UPDATE' and (new.location_address is distinct from old.location_address or new.assigned_to is distinct from old.assigned_to)
       and coalesce(current_setting('lf.dispatch', true), '') <> 'on' then
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
  if tg_op = 'UPDATE' and new.starts_at >= '2099-01-01' then return new; end if; -- créneau de garage temporaire (rééquilibrage)
  if tg_op = 'INSERT' then act := case when new.dispatch_status = 'unassigned' then 'pending_dispatch' else 'created' end;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then act := 'cancelled';
  elsif old.dispatch_status = 'unassigned' and new.dispatch_status = 'assigned' then act := 'dispatched';
  elsif old.dispatch_status = 'assigned' and new.dispatch_status = 'unassigned' then act := 'unassigned';
  elsif new.status <> old.status then act := 'status';
  elsif new.distance_override and not old.distance_override then act := 'override';
  elsif new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at or new.assigned_to is distinct from old.assigned_to
        or new.location_address is distinct from old.location_address then act := 'updated';
  elsif new.locked_by_dispatcher is distinct from old.locked_by_dispatcher then act := case when new.locked_by_dispatcher then 'locked' else 'unlocked' end;
  elsif new.issue_at is distinct from old.issue_at and new.issue_message is not null then act := 'issue';
  else return new; end if;
  perform public.log_lead_event(new.org_id, new.lead_id, 'appointment', jsonb_build_object(
    'appointment_id', new.id, 'action', act, 'starts_at', new.starts_at, 'status', new.status, 'assigned_to', new.assigned_to,
    'distance_status', new.distance_status, 'override_reason', case when new.distance_override then new.override_reason end,
    'message', case when act = 'issue' then new.issue_message end));
  return new;
end;
$$;

-- ------------------------------------------------------------ 4) indisponibilités (saisies par le confirmateur / admin)
create table public.sales_unavailability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  day date not null,
  start_min int check (start_min between 0 and 1439),
  end_min int check (end_min between 1 and 1440),
  reason text check (char_length(reason) <= 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((start_min is null) = (end_min is null)),
  check (start_min is null or end_min > start_min),
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade
);
create index sales_unavailability_idx on public.sales_unavailability (org_id, user_id, day);
alter table public.sales_unavailability enable row level security;
alter table public.sales_unavailability force row level security;
revoke all on public.sales_unavailability from anon, authenticated;
grant select, insert, delete on public.sales_unavailability to authenticated;
create policy unavail_select on public.sales_unavailability for select to authenticated using (
  public.is_org_member(org_id) and (user_id = auth.uid() or public.has_perm(org_id, 'dispatch.manage')
    or public.has_perm(org_id, 'members.manage') or public.has_perm(org_id, 'appointments.manage_all')));
create policy unavail_insert on public.sales_unavailability for insert to authenticated with check (
  created_by = auth.uid() and (public.has_perm(org_id, 'dispatch.manage') or public.has_perm(org_id, 'members.manage')));
create policy unavail_delete on public.sales_unavailability for delete to authenticated using (
  public.has_perm(org_id, 'dispatch.manage') or public.has_perm(org_id, 'members.manage'));

-- ------------------------------------------------------------ 5) application atomique (routes réelles)
drop function public.apply_dispatch(uuid, jsonb);
create function public.apply_dispatch(p_org uuid, p_items jsonb, p_allow_estimate boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  tz constant text := 'Europe/Paris';
  it jsonb;
  a public.appointments%rowtype;
  z public.sales_zones%rowtype;
  ds public.dispatch_settings%rowtype;
  v_leg_km numeric := 40; v_leg_min int := 45; v_base_min int := 75; v_morning numeric := 1.25; v_evening numeric := 1.40; v_safety int := 10; v_comfort int; v_absolute int; v_fifth boolean;
  v_user uuid; v_start timestamptz; v_end timestamptz;
  v_day date; v_lstart time; v_lend time;
  v_cnt int;
  prev record; nxt record; leg record;
  applied int := 0; skipped int := 0;
  per_user jsonb := '{}'::jsonb;
  batch uuid := gen_random_uuid();
  r record;
  parked uuid[] := '{}';
  n_park int := 0;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.has_perm(p_org, 'dispatch.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('dispatch:' || p_org::text));
  perform set_config('lf.dispatch', 'on', true);
  -- Rééquilibrage : les RDV réputés « à rééquilibrer » (non verrouillés) sont garés hors planning le temps de la validation.
  for r in select (value ->> 'appointment_id')::uuid as id from jsonb_array_elements(p_items) loop
    n_park := n_park + 1;
    update public.appointments set starts_at = '2100-01-01 00:00+00'::timestamptz + n_park * interval '13 hours', ends_at = '2100-01-01 01:00+00'::timestamptz + n_park * interval '13 hours'
    where id = r.id and org_id = p_org and dispatch_status = 'assigned' and needs_rebalance and not locked_by_dispatcher and dispatched_at is not null and status in ('planned', 'confirmed');
    if found then parked := parked || r.id; end if;
  end loop;
  select * into ds from public.dispatch_settings where org_id = p_org;
  if found then v_leg_km := ds.max_leg_km; v_leg_min := ds.max_leg_min; v_base_min := ds.max_base_min; v_morning := ds.traffic_morning_coef; v_evening := ds.traffic_evening_coef; v_safety := ds.safety_margin_pct; end if;

  for it in select value from jsonb_array_elements(p_items) order by (value ->> 'starts_at')::timestamptz loop
    v_user := (it ->> 'user_id')::uuid;
    v_start := (it ->> 'starts_at')::timestamptz;
    v_end := (it ->> 'ends_at')::timestamptz;
    select * into a from public.appointments where id = (it ->> 'appointment_id')::uuid and org_id = p_org for update;
    if not found then raise exception 'dispatch_appointment_not_found' using errcode = 'P0001'; end if;
    if a.dispatch_status = 'assigned' and a.locked_by_dispatcher then raise exception 'locked_by_dispatcher' using errcode = '42501'; end if;
    if a.dispatch_status = 'assigned' and not (a.id = any (parked)) then
      if a.assigned_to = v_user and a.starts_at = v_start then skipped := skipped + 1; continue; end if;
      raise exception 'dispatch_already_assigned' using errcode = 'P0001';
    end if;
    if a.status not in ('confirmed', 'planned') or (a.dispatch_status = 'unassigned' and a.status <> 'confirmed') then raise exception 'dispatch_not_confirmed' using errcode = 'P0001'; end if;
    if v_end <= v_start or v_end - v_start > interval '12 hours' then raise exception 'dispatch_bad_slot' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.memberships where org_id = p_org and user_id = v_user and status = 'active') then
      raise exception 'dispatch_invalid_rep' using errcode = 'P0001';
    end if;
    select * into z from public.sales_zones where org_id = p_org and user_id = v_user and active;
    if not found then raise exception 'dispatch_no_zone' using errcode = 'P0001'; end if;
    if a.lat is null or a.lng is null then raise exception 'dispatch_no_geocode' using errcode = 'P0001'; end if;

    -- pré-filtre : rayon à vol d'oiseau ; décision : temps de route réel depuis la base
    if public.haversine_km(a.lat, a.lng, z.base_lat, z.base_lng) > z.radius_km + 0.05 then raise exception 'dispatch_out_of_zone' using errcode = 'P0001'; end if;
    select * into leg from public.route_leg(z.base_lat, z.base_lng, a.lat, a.lng, p_allow_estimate);
    if leg.duration_s / 60.0 > v_base_min + 0.5 then raise exception 'dispatch_out_of_zone' using errcode = 'P0001'; end if;

    v_day := (v_start at time zone tz)::date;
    v_lstart := (v_start at time zone tz)::time;
    v_lend := (v_end at time zone tz)::time;
    if (v_end at time zone tz)::date <> v_day or v_lstart < z.work_start or v_lend > z.work_end then
      raise exception 'dispatch_outside_hours' using errcode = 'P0001';
    end if;
    if not (extract(isodow from v_day)::smallint = any (z.work_days)) then raise exception 'dispatch_not_workday' using errcode = 'P0001'; end if;
    if exists (select 1 from public.sales_unavailability u where u.org_id = p_org and u.user_id = v_user and u.day = v_day
        and (u.start_min is null or (u.start_min < extract(epoch from v_lend)::int / 60 and u.end_min > extract(epoch from v_lstart)::int / 60))) then
      raise exception 'dispatch_unavailable' using errcode = 'P0001';
    end if;

    select count(*) into v_cnt from public.appointments
      where org_id = p_org and assigned_to = v_user and status <> 'cancelled' and dispatch_status = 'assigned'
        and (starts_at at time zone tz)::date = v_day and id <> a.id;
    v_comfort := coalesce(z.comfort_max, ds.comfort_max, 4);
    v_absolute := greatest(v_comfort, coalesce(z.absolute_max, ds.absolute_max, 5));
    v_fifth := coalesce((it ->> 'fifth')::boolean, false);
    if v_cnt >= v_absolute then raise exception 'dispatch_day_full' using errcode = 'P0001'; end if;
    -- au-delà du confort (4), jamais automatique : le confirmateur doit l'avoir approuvé explicitement (« fifth »)
    if v_cnt >= v_comfort and not v_fifth then raise exception 'dispatch_needs_approval' using errcode = 'P0001'; end if;

    select lat, lng, ends_at into prev from public.appointments
      where org_id = p_org and assigned_to = v_user and status <> 'cancelled' and dispatch_status = 'assigned'
        and (starts_at at time zone tz)::date = v_day and id <> a.id and ends_at <= v_start order by ends_at desc limit 1;
    select lat, lng, starts_at into nxt from public.appointments
      where org_id = p_org and assigned_to = v_user and status <> 'cancelled' and dispatch_status = 'assigned'
        and (starts_at at time zone tz)::date = v_day and id <> a.id and starts_at >= v_end order by starts_at asc limit 1;
    if prev.ends_at is not null and prev.lat is not null then
      select * into leg from public.route_leg(prev.lat, prev.lng, a.lat, a.lng, p_allow_estimate);
      if leg.distance_m / 1000.0 > v_leg_km + 0.1 or leg.duration_s / 60.0 > v_leg_min + 0.5 then raise exception 'dispatch_leg_too_long' using errcode = 'P0001'; end if;
      if extract(epoch from (v_start - prev.ends_at)) / 60 < public.traffic_minutes(leg.duration_s, v_day, extract(epoch from (prev.ends_at at time zone tz)::time)::int / 60, v_morning, v_evening, v_safety) + z.travel_margin_min - 1 then raise exception 'dispatch_travel_time' using errcode = 'P0001'; end if;
    elsif prev.ends_at is null then
      select * into leg from public.route_leg(z.base_lat, z.base_lng, a.lat, a.lng, p_allow_estimate);
      if (extract(epoch from v_lstart) - extract(epoch from z.work_start)) / 60 < public.traffic_minutes(leg.duration_s, v_day, extract(epoch from z.work_start)::int / 60, v_morning, v_evening, v_safety) + z.travel_margin_min - 1 then raise exception 'dispatch_travel_time' using errcode = 'P0001'; end if;
    end if;
    if nxt.starts_at is not null and nxt.lat is not null then
      select * into leg from public.route_leg(a.lat, a.lng, nxt.lat, nxt.lng, p_allow_estimate);
      if leg.distance_m / 1000.0 > v_leg_km + 0.1 or leg.duration_s / 60.0 > v_leg_min + 0.5 then raise exception 'dispatch_leg_too_long' using errcode = 'P0001'; end if;
      if extract(epoch from (nxt.starts_at - v_end)) / 60 < public.traffic_minutes(leg.duration_s, v_day, extract(epoch from v_lend)::int / 60, v_morning, v_evening, v_safety) + z.travel_margin_min - 1 then raise exception 'dispatch_travel_time' using errcode = 'P0001'; end if;
    end if;

    update public.appointments set assigned_to = v_user, starts_at = v_start, ends_at = v_end, dispatch_status = 'assigned', needs_rebalance = false,
      dispatched_at = coalesce(dispatched_at, now()),
      -- un 5e RDV approuvé à la main est une décision du confirmateur : verrouillée
      locked_by_dispatcher = (v_fifth and v_cnt >= v_comfort) or locked_by_dispatcher,
      locked_by = case when v_fifth and v_cnt >= v_comfort then uid else locked_by end, locked_at = case when v_fifth and v_cnt >= v_comfort then now() else locked_at end,
      distance_km = round(public.haversine_km(a.lat, a.lng, z.base_lat, z.base_lng)::numeric, 1), distance_status = 'ok'
    where id = a.id;
    -- le commercial doit voir le lead de son RDV (périmètre « leads.view_own »)
    update public.leads set assigned_to = v_user where id = a.lead_id and org_id = p_org and assigned_to is distinct from v_user;
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
revoke all on function public.apply_dispatch(uuid, jsonb, boolean) from public, anon;
grant execute on function public.apply_dispatch(uuid, jsonb, boolean) to authenticated;

-- ------------------------------------------------------------ 6) décisions du confirmateur (dernier mot, verrouillées)
create function public.dispatch_notify(p_org uuid, p_user uuid, p_msg text, p_lead uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, type, payload)
  select p_org, p_user, 'appointment', jsonb_build_object('message', p_msg, 'lead_id', p_lead) where p_user is not null
$$;
revoke all on function public.dispatch_notify(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Change le commercial et/ou l'heure d'un RDV (ou l'attribue à la main). Contraintes dures : membre actif, pas de chevauchement.
create function public.dispatcher_edit_appointment(p_id uuid, p_user uuid, p_start timestamptz, p_end timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments%rowtype; z public.sales_zones%rowtype; old_user uuid; km double precision;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not public.has_perm(a.org_id, 'dispatch.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status in ('cancelled', 'done', 'no_show') then raise exception 'dispatch_bad_status' using errcode = 'P0001'; end if;
  if p_end <= p_start or p_end - p_start > interval '12 hours' then raise exception 'dispatch_bad_slot' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.memberships where org_id = a.org_id and user_id = p_user and status = 'active') then
    raise exception 'dispatch_invalid_rep' using errcode = 'P0001';
  end if;
  perform set_config('lf.dispatcher', 'on', true);
  perform set_config('lf.dispatch', 'on', true);
  old_user := a.assigned_to;
  select * into z from public.sales_zones where org_id = a.org_id and user_id = p_user and active;
  km := case when found and a.lat is not null then public.haversine_km(a.lat, a.lng, z.base_lat, z.base_lng) end;
  update public.appointments set assigned_to = p_user, starts_at = p_start, ends_at = p_end, dispatch_status = 'assigned',
    dispatched_at = coalesce(dispatched_at, now()), locked_by_dispatcher = true, locked_by = auth.uid(), locked_at = now(),
    distance_km = case when km is null then null else round(km::numeric, 1) end,
    distance_status = case when km is null then 'no_zone' when km <= z.radius_km + 0.05 then 'ok' else 'over_radius' end
  where id = p_id;
  update public.leads set assigned_to = p_user where id = a.lead_id and org_id = a.org_id and assigned_to is distinct from p_user;
  perform public.dispatch_notify(a.org_id, p_user, 'Rendez-vous attribué ou modifié par le confirmateur', a.lead_id);
  if old_user is not null and old_user <> p_user then
    perform public.dispatch_notify(a.org_id, old_user, 'Un rendez-vous a été retiré de votre agenda par le confirmateur', a.lead_id);
  end if;
end;
$$;

-- Échange commercial et horaire de deux RDV attribués.
create function public.dispatcher_swap(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.appointments%rowtype; y public.appointments%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_a = p_b then raise exception 'dispatch_bad_slot' using errcode = 'P0001'; end if;
  select * into x from public.appointments where id = least(p_a, p_b) for update;
  select * into y from public.appointments where id = greatest(p_a, p_b) for update;
  if x.id is null or y.id is null or x.org_id <> y.org_id or not public.has_perm(x.org_id, 'dispatch.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if x.dispatch_status <> 'assigned' or y.dispatch_status <> 'assigned' then raise exception 'dispatch_bad_status' using errcode = 'P0001'; end if;
  perform set_config('lf.dispatcher', 'on', true);
  perform set_config('lf.dispatch', 'on', true);
  update public.appointments set starts_at = '2100-01-01 08:00+00', ends_at = '2100-01-01 09:00+00' where id = x.id; -- libère le créneau
  update public.appointments set assigned_to = x.assigned_to, starts_at = x.starts_at, ends_at = x.ends_at, locked_by_dispatcher = true, locked_by = auth.uid(), locked_at = now() where id = y.id;
  update public.appointments set assigned_to = y.assigned_to, starts_at = y.starts_at, ends_at = y.ends_at, locked_by_dispatcher = true, locked_by = auth.uid(), locked_at = now() where id = x.id;
  update public.leads set assigned_to = y.assigned_to where id = x.lead_id and org_id = x.org_id;
  update public.leads set assigned_to = x.assigned_to where id = y.lead_id and org_id = y.org_id;
  perform public.dispatch_notify(x.org_id, x.assigned_to, 'Votre agenda a été modifié par le confirmateur (échange de rendez-vous)', x.lead_id);
  if y.assigned_to <> x.assigned_to then perform public.dispatch_notify(x.org_id, y.assigned_to, 'Votre agenda a été modifié par le confirmateur (échange de rendez-vous)', y.lead_id); end if;
end;
$$;

-- Retire un RDV de la tournée : il repasse « à attribuer » (verrou levé).
create function public.dispatcher_unassign(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments%rowtype; d date;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not public.has_perm(a.org_id, 'dispatch.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.dispatch_status <> 'assigned' or a.status not in ('planned', 'confirmed') then raise exception 'dispatch_bad_status' using errcode = 'P0001'; end if;
  perform set_config('lf.dispatcher', 'on', true);
  d := greatest((a.starts_at at time zone 'Europe/Paris')::date, (now() at time zone 'Europe/Paris')::date + 1);
  update public.appointments set assigned_to = null, starts_at = null, ends_at = null, dispatch_status = 'unassigned', dispatched_at = null,
    wish_from = coalesce(a.wish_from, d), wish_to = greatest(coalesce(a.wish_to, d + 6), coalesce(a.wish_from, d)),
    duration_min = coalesce(a.duration_min, greatest(15, extract(epoch from (a.ends_at - a.starts_at))::int / 60)),
    locked_by_dispatcher = false, locked_by = null, locked_at = null, status = 'confirmed'
  where id = p_id;
  perform public.dispatch_notify(a.org_id, a.assigned_to, 'Un rendez-vous a été retiré de votre agenda par le confirmateur', a.lead_id);
end;
$$;

create function public.dispatcher_set_lock(p_id uuid, p_locked boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not public.has_perm(a.org_id, 'dispatch.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.appointments set locked_by_dispatcher = p_locked, locked_by = case when p_locked then auth.uid() end, locked_at = case when p_locked then now() end where id = p_id;
end;
$$;

-- « Signaler un problème » : message libre du commercial, notifie les confirmateurs ; sans effet sur la répartition.
create function public.report_appointment_issue(p_id uuid, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments%rowtype; who text; r record; msg text := btrim(coalesce(p_message, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if char_length(msg) < 3 or char_length(msg) > 500 then raise exception 'invalid_message' using errcode = '22023'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or a.assigned_to is distinct from auth.uid() or not public.is_org_member(a.org_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(full_name, email, 'Un commercial') into who from public.profiles where id = auth.uid();
  perform set_config('lf.dispatcher', 'on', true); -- n'altère ni commercial ni horaire
  update public.appointments set issue_message = msg, issue_at = now(), issue_by = auth.uid() where id = p_id;
  for r in select m.user_id from public.memberships m join public.roles ro on ro.id = m.role_id
    where m.org_id = a.org_id and m.status = 'active' and m.user_id <> auth.uid() and (ro.is_admin or 'dispatch.manage' = any (ro.permissions)) loop
    perform public.dispatch_notify(a.org_id, r.user_id, format('Problème signalé par %s : %s', who, left(msg, 160)), a.lead_id);
  end loop;
end;
$$;

revoke all on function public.dispatcher_edit_appointment(uuid, uuid, timestamptz, timestamptz), public.dispatcher_swap(uuid, uuid),
  public.dispatcher_unassign(uuid), public.dispatcher_set_lock(uuid, boolean), public.report_appointment_issue(uuid, text) from public, anon;
grant execute on function public.dispatcher_edit_appointment(uuid, uuid, timestamptz, timestamptz), public.dispatcher_swap(uuid, uuid),
  public.dispatcher_unassign(uuid), public.dispatcher_set_lock(uuid, boolean), public.report_appointment_issue(uuid, text) to authenticated;

-- ------------------------------------------------------------ 7) points GPS fiables (fixés à la saisie) et précision
alter table public.geocode_cache add column precision text, add column score numeric(4, 3);

alter table public.leads
  add column geo_precision text check (geo_precision in ('housenumber','street','locality','municipality','manual_pin','manual_coords')),
  add column geo_score numeric(4, 3) check (geo_score between 0 and 1),
  add column geo_source text check (geo_source in ('ban','nominatim','manual')),
  add column insee_code text check (char_length(insee_code) <= 5);

alter table public.appointments
  add column geo_precision text check (geo_precision in ('housenumber','street','locality','municipality','manual_pin','manual_coords')),
  add column geo_score numeric(4, 3) check (geo_score between 0 and 1),
  add column geo_source text check (geo_source in ('ban','nominatim','manual')),
  add column insee_code text check (char_length(insee_code) <= 5),
  -- le confirmateur accepte une position approximative (commune seule) pour la répartition
  add column geo_accepted boolean not null default false,
  add column geo_fixed_by uuid references auth.users (id) on delete set null,
  add column geo_fixed_at timestamptz;

-- Le commercial concerné fournit la position exacte (coordonnées Google Maps) d'un de ses RDV : le point du lead et du RDV est mis à jour,
-- le RDV est marqué « à rééquilibrer » et les confirmateurs sont prévenus. Il ne déplace ni n'attribue rien.
create function public.report_address_fix(p_id uuid, p_lat double precision, p_lng double precision, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments%rowtype; who text; r record; msg text := btrim(coalesce(p_message, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or char_length(msg) > 500 then raise exception 'invalid_message' using errcode = '22023'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or a.assigned_to is distinct from auth.uid() or not public.is_org_member(a.org_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(full_name, email, 'Un commercial') into who from public.profiles where id = auth.uid();
  update public.appointments set lat = p_lat, lng = p_lng, geo_precision = 'manual_coords', geo_source = 'manual', geo_score = 1, geo_accepted = false,
    geo_fixed_by = auth.uid(), geo_fixed_at = now(), needs_rebalance = true,
    issue_message = coalesce(nullif(msg, ''), 'Position GPS corrigée'), issue_at = now(), issue_by = auth.uid()
  where id = p_id;
  update public.leads set lat = p_lat, lng = p_lng, geo_precision = 'manual_coords', geo_source = 'manual', geo_score = 1 where id = a.lead_id and org_id = a.org_id;
  perform public.log_lead_event(a.org_id, a.lead_id, 'appointment', jsonb_build_object('appointment_id', a.id, 'action', 'geo_fixed', 'mode', 'coords', 'precision', 'manual_coords', 'source', 'manual', 'by_role', 'commercial'));
  for r in select m.user_id from public.memberships m join public.roles ro on ro.id = m.role_id
    where m.org_id = a.org_id and m.status = 'active' and m.user_id <> auth.uid() and (ro.is_admin or 'dispatch.manage' = any (ro.permissions)) loop
    perform public.dispatch_notify(a.org_id, r.user_id, format('Position corrigée par %s : relancez la répartition (Rééquilibrer)', who), a.lead_id);
  end loop;
end;
$$;
revoke all on function public.report_address_fix(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.report_address_fix(uuid, double precision, double precision, text) to authenticated;
