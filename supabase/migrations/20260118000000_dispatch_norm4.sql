-- Règle de charge : la norme passe de 3 à 4 RDV/jour (brief : ~4 RDV par commercial et par jour).
-- Nouveaux défauts : norme 4, confort 5 (un RDV de plus seulement si le détour est faible), maximum 6 (jamais automatique).
-- Les organisations qui ont enregistré leurs propres seuils les conservent : seuls les défauts changent.

alter table public.dispatch_settings
  alter column target_per_day set default 4,
  alter column comfort_max set default 5,
  alter column absolute_max set default 6;

-- Une ligne dispatch_settings n'existe que si l'organisation a enregistré ses réglages (set_dispatch_org_settings) : ces valeurs explicites sont conservées.

-- apply_dispatch : mêmes replis que DEFAULT_ORG côté application (confort 5, maximum 6) quand ni la zone ni l'organisation ne fixent de seuil.
create or replace function public.apply_dispatch(p_org uuid, p_items jsonb, p_allow_estimate boolean default false) returns jsonb
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
    v_comfort := coalesce(z.comfort_max, ds.comfort_max, 5);
    v_absolute := greatest(v_comfort, coalesce(z.absolute_max, ds.absolute_max, 6));
    v_fifth := coalesce((it ->> 'fifth')::boolean, false);
    if v_cnt >= v_absolute then raise exception 'dispatch_day_full' using errcode = 'P0001'; end if;
    -- au-delà du confort (5 par défaut), jamais automatique : le confirmateur doit l'avoir approuvé explicitement (« fifth »)
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
      -- un RDV au-delà du confort approuvé à la main est une décision du confirmateur : verrouillée
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
