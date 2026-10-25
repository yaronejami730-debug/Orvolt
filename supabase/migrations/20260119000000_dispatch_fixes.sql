-- Correctifs de l'audit répartition (docs/agents/dispatch/C-audit.md) :
-- HAUT 1  RDV « à attribuer » créé par un télépro (create_pending_appointment)
-- HAUT 2  simulation inoffensive (is_simulation + masquage RLS + aucune notification ni écrasement du propriétaire du lead)
-- MOYEN 5-8  apply_dispatch sans p_allow_estimate, rejeu complet en base, ancien commercial prévenu, jours fériés français
-- BAS 10-11  report_address_fix et dispatcher_swap contrôlés

-- ------------------------------------------------------------ 1) marqueur de simulation
alter table public.leads add column is_simulation boolean not null default false;
alter table public.appointments add column is_simulation boolean not null default false;
create index leads_simulation_idx on public.leads (org_id) where is_simulation;
create index appointments_simulation_idx on public.appointments (org_id) where is_simulation;
-- La colonne est lue par la politique restrictive ci-dessous (leads n'a que des droits de lecture par colonne).
grant select (is_simulation) on public.leads to authenticated;

-- Les lignes de simulation n'apparaissent jamais pour les clients (listes, agenda, tableaux de bord, tournées) : seul le serveur
-- (service_role, page Répartition en vue simulation) les lit et les écrit. Aucun client ne peut poser is_simulation (pas de droit d'écriture sur la colonne).
create policy leads_no_simulation on public.leads as restrictive for select to authenticated using (not is_simulation);
create policy appointments_no_simulation on public.appointments as restrictive for select to authenticated using (not is_simulation);

-- La vue leads_api (propriétaire de la vue : RLS non appliquée) exclut aussi la simulation.
create or replace view public.leads_api as
select l.id, l.org_id, l.status_id, l.source_id, l.assigned_to, l.first_name, l.last_name, l.company, l.email, l.phone,
  l.address, l.city, l.postal_code, l.lat, l.lng, l.value, public.mask_custom(l.org_id, l.custom) as custom,
  l.created_by, l.position, l.archived_at, l.created_at, l.updated_at, l.search_text
from public.leads l
where not l.is_simulation and public.is_org_member(l.org_id) and (public.has_perm(l.org_id, 'leads.view_all')
  or (public.has_perm(l.org_id, 'leads.view_own') and (l.assigned_to = auth.uid() or l.created_by = auth.uid())));

-- Compteurs de rendez-vous du tableau de bord (SECURITY DEFINER : RLS ignorée, filtre explicite).
create or replace function public.dash_appt_counts(p_org uuid, p_from timestamptz, p_to timestamptz, p_user uuid default null, p_source uuid default null)
returns table (planned bigint, confirmed bigint, done bigint, cancelled bigint, no_show bigint, over_radius bigint)
language plpgsql stable security definer set search_path = public set statement_timeout = '8s' as $$
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  return query
    select count(*) filter (where a.status = 'planned'), count(*) filter (where a.status = 'confirmed'), count(*) filter (where a.status = 'done'),
      count(*) filter (where a.status = 'cancelled'), count(*) filter (where a.status = 'no_show'),
      count(*) filter (where a.distance_status = 'over_radius' and a.status <> 'cancelled')
    from public.appointments a join public.leads l on l.id = a.lead_id and l.org_id = a.org_id
    where a.org_id = p_org and a.starts_at >= p_from and a.starts_at < p_to and l.archived_at is null and not a.is_simulation
      and (p_user is null or a.assigned_to = p_user) and (p_source is null or l.source_id = p_source)
      and (public.has_perm(p_org, 'leads.view_all') or exists (select 1 from public.leads_api la where la.id = a.lead_id));
end;
$$;

create or replace function public.dash_appt_counts_by_user(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null)
returns table (assigned_to uuid, planned bigint, done bigint)
language plpgsql stable security definer set search_path = public set statement_timeout = '8s' as $$
begin
  perform public.dash_check(p_org, p_from, p_to, null, true);
  return query
    select a.assigned_to, count(*) filter (where a.status <> 'cancelled'), count(*) filter (where a.status = 'done')
    from public.appointments a join public.leads l on l.id = a.lead_id and l.org_id = a.org_id
    where a.org_id = p_org and a.starts_at >= p_from and a.starts_at < p_to and l.archived_at is null and not a.is_simulation and (p_source is null or l.source_id = p_source)
    group by a.assigned_to;
end;
$$;

-- Un RDV de simulation ne notifie jamais personne (ni commercial, ni confirmateur).
create or replace function public.dispatch_notify(p_org uuid, p_user uuid, p_msg text, p_lead uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, type, payload)
  select p_org, p_user, 'appointment', jsonb_build_object('message', p_msg, 'lead_id', p_lead)
  where p_user is not null and not exists (select 1 from public.leads l where l.id = p_lead and l.is_simulation)
$$;

-- Les RDV de simulation ne bloquent pas les vrais créneaux (anti-chevauchement limité aux vrais RDV).
alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap exclude using gist (
  org_id with =, assigned_to with =, tstzrange(starts_at, ends_at) with &&
) where (status <> 'cancelled' and dispatch_status = 'assigned' and not is_simulation);

-- ------------------------------------------------------------ 2) outils : France plausible, Pâques, jours fériés
create function public.plausible_in_france(p_lat double precision, p_lng double precision) returns boolean
language sql immutable parallel safe set search_path = public as $$
  select p_lat is not null and p_lng is not null and (
    (p_lat between 41.2 and 51.3 and p_lng between -5.5 and 9.8)          -- métropole (Corse incluse)
    or (p_lat between 15.8 and 16.6 and p_lng between -61.9 and -60.9)    -- Guadeloupe
    or (p_lat between 14.3 and 14.95 and p_lng between -61.3 and -60.7)   -- Martinique
    or (p_lat between 2 and 5.9 and p_lng between -54.7 and -51.5)        -- Guyane
    or (p_lat between -21.5 and -20.8 and p_lng between 55.1 and 55.9)    -- La Réunion
    or (p_lat between -13.1 and -12.5 and p_lng between 44.9 and 45.4))   -- Mayotte
$$;

-- Dimanche de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher) ; miroir de src/lib/dispatch/holidays.ts.
create function public.fr_easter(p_year int) returns date
language plpgsql immutable parallel safe set search_path = public as $$
declare a int := p_year % 19; b int := p_year / 100; c int := p_year % 100; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_year, mo, dy);
end;
$$;

-- Jours fériés légaux de France métropolitaine : 8 fixes + lundi de Pâques, Ascension (Pâques + 39), lundi de Pentecôte (Pâques + 50).
create function public.is_fr_holiday(p_day date) returns boolean
language plpgsql immutable parallel safe set search_path = public as $$
declare y int := extract(year from p_day)::int; easter date;
begin
  if (extract(month from p_day)::int, extract(day from p_day)::int) in ((1, 1), (5, 1), (5, 8), (7, 14), (8, 15), (11, 1), (11, 11), (12, 25)) then return true; end if;
  easter := public.fr_easter(y);
  return p_day in (easter + 1, easter + 39, easter + 50);
end;
$$;
revoke all on function public.plausible_in_france(double precision, double precision), public.fr_easter(int), public.is_fr_holiday(date) from public, anon;
grant execute on function public.plausible_in_france(double precision, double precision), public.fr_easter(int), public.is_fr_holiday(date) to authenticated;

-- ------------------------------------------------------------ 3) RDV « à attribuer » créé par un télépro
-- Même déclencheur qu'avant ; seule nouveauté : une insertion « à attribuer » faite par create_pending_appointment (drapeau lf.pending_create) est admise.
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
    elsif tg_op = 'INSERT' and coalesce(current_setting('lf.pending_create', true), '') = 'on'
          and new.dispatch_status = 'unassigned' and new.status = 'planned' and public.has_perm(new.org_id, 'appointments.manage_own') then
      null; -- RDV « à attribuer » d'un télépro : le confirmateur choisira le commercial et l'heure
    elsif not public.has_perm(new.org_id, 'appointments.manage_all') and not public.has_perm(new.org_id, 'dispatch.manage') then
      raise exception 'forbidden_assignee' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Crée un RDV « à attribuer » (sans commercial ni heure : fenêtre de jours souhaitée + durée) pour un utilisateur qui gère ses propres RDV.
-- Toutes les entrées sont revalidées ici (périmètre du lead, fenêtre, durée, position en France). Précision/coordonnées : le serveur applicatif
-- revérifie l'adresse avant l'appel ; les points saisis à la main restent signalés « manual_* » (jamais présentés comme une adresse certifiée).
create function public.create_pending_appointment(
  p_lead uuid, p_wish_from date, p_wish_to date, p_duration int, p_address text default null,
  p_lat double precision default null, p_lng double precision default null, p_precision text default null,
  p_score numeric default null, p_source text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  l public.leads%rowtype;
  addr text := nullif(btrim(coalesce(p_address, '')), '');
  notes text := nullif(btrim(coalesce(p_notes, '')), '');
  tomorrow date := ((now() at time zone 'Europe/Paris')::date + 1);
  new_id uuid;
  who text;
  r record;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into l from public.leads where id = p_lead and not is_simulation;
  if not found or not public.is_org_member(l.org_id) then raise exception 'lead_not_found' using errcode = 'P0002'; end if;
  if not (public.has_perm(l.org_id, 'appointments.manage_own') or public.has_perm(l.org_id, 'appointments.manage_all')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (public.has_perm(l.org_id, 'leads.view_all') or (public.has_perm(l.org_id, 'leads.view_own') and (l.assigned_to is not distinct from uid or l.created_by is not distinct from uid))) then
    raise exception 'lead_not_found' using errcode = 'P0002';
  end if;
  if p_wish_from is null or p_wish_to is null or p_wish_from < tomorrow or p_wish_to < p_wish_from or p_wish_to - p_wish_from > 30 then
    raise exception 'invalid_wish' using errcode = '22023';
  end if;
  if p_duration is null or p_duration not between 15 and 480 then raise exception 'invalid_duration' using errcode = '22023'; end if;
  if addr is not null and char_length(addr) > 300 or notes is not null and char_length(notes) > 2000 then raise exception 'invalid_text' using errcode = '22023'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'invalid_position' using errcode = '22023'; end if;
  if p_lat is not null then
    if not public.plausible_in_france(p_lat, p_lng) then raise exception 'position_outside_france' using errcode = '22023'; end if;
    if p_precision is null or p_precision not in ('housenumber', 'street', 'locality', 'municipality', 'manual_pin', 'manual_coords')
       or coalesce(p_source, 'manual') not in ('ban', 'nominatim', 'manual') or p_score < 0 or p_score > 1 then
      raise exception 'invalid_position' using errcode = '22023';
    end if;
  end if;
  perform set_config('lf.pending_create', 'on', true);
  insert into public.appointments (org_id, lead_id, assigned_to, starts_at, ends_at, status, dispatch_status, wish_from, wish_to, duration_min,
      location_address, lat, lng, geo_precision, geo_score, geo_source, notes, created_by)
    values (l.org_id, l.id, null, null, null, 'planned', 'unassigned', p_wish_from, p_wish_to, p_duration,
      addr, p_lat, p_lng, case when p_lat is null then null else p_precision end, case when p_lat is null then null else p_score end,
      case when p_lat is null then null else coalesce(p_source, 'manual') end, notes, uid)
    returning id into new_id;
  select coalesce(full_name, email, 'Un collègue') into who from public.profiles where id = uid;
  for r in select m.user_id from public.memberships m join public.roles ro on ro.id = m.role_id
    where m.org_id = l.org_id and m.status = 'active' and m.user_id <> uid and (ro.is_admin or 'dispatch.manage' = any (ro.permissions)) loop
    perform public.dispatch_notify(l.org_id, r.user_id, format('%s propose un rendez-vous à attribuer (à confirmer dans Répartition)', who), l.id);
  end loop;
  return new_id;
end;
$$;
revoke all on function public.create_pending_appointment(uuid, date, date, int, text, double precision, double precision, text, numeric, text, text) from public, anon;
grant execute on function public.create_pending_appointment(uuid, date, date, int, text, double precision, double precision, text, numeric, text, text) to authenticated;

-- ------------------------------------------------------------ 4) apply_dispatch : rejeu complet en base, simulation, rééquilibrage, fériés
-- p_allow_estimate disparaît : un appel direct ne peut plus accepter d'estimation à vol d'oiseau (la base exige un itinéraire réel en cache).
drop function public.apply_dispatch(uuid, jsonb, boolean);
create function public.apply_dispatch(p_org uuid, p_items jsonb) returns jsonb
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
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_sim boolean; v_first boolean := true; v_rebal boolean; v_old_owner uuid;
  moved_from jsonb := '{}'::jsonb;
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
    -- un lot est soit 100 % simulation, soit 100 % réel : jamais mélangé
    if v_first then v_sim := a.is_simulation; v_first := false;
    elsif a.is_simulation is distinct from v_sim then raise exception 'dispatch_simulation_mixed' using errcode = 'P0001'; end if;
    if a.dispatch_status = 'assigned' and a.locked_by_dispatcher then raise exception 'locked_by_dispatcher' using errcode = '42501'; end if;
    if a.dispatch_status = 'assigned' and not (a.id = any (parked)) then
      if a.assigned_to = v_user and a.starts_at = v_start then skipped := skipped + 1; continue; end if;
      raise exception 'dispatch_already_assigned' using errcode = 'P0001';
    end if;
    if a.status not in ('confirmed', 'planned') or (a.dispatch_status = 'unassigned' and a.status <> 'confirmed') then raise exception 'dispatch_not_confirmed' using errcode = 'P0001'; end if;
    if v_end <= v_start or v_end - v_start > interval '12 hours' then raise exception 'dispatch_bad_slot' using errcode = 'P0001'; end if;
    -- rejeu des règles du moteur : jamais aujourd'hui ni dans le passé, jamais un jour férié
    v_rebal := a.id = any (parked);
    v_day := (v_start at time zone tz)::date;
    if v_day <= v_today then raise exception 'dispatch_past_slot' using errcode = 'P0001'; end if;
    if public.is_fr_holiday(v_day) then raise exception 'dispatch_holiday' using errcode = 'P0001'; end if;
    if not v_rebal then
      -- fenêtre de jours souhaitée par le télépro et durée demandée (+ au plus 20 min de marge pour une position approximative)
      if a.wish_from is null or a.wish_to is null or v_day < a.wish_from or v_day > a.wish_to then raise exception 'dispatch_outside_wish' using errcode = 'P0001'; end if;
      if a.duration_min is not null and (v_end - v_start < a.duration_min * interval '1 minute' or v_end - v_start > (a.duration_min + 20) * interval '1 minute') then
        raise exception 'dispatch_bad_duration' using errcode = 'P0001';
      end if;
    end if;
    if not exists (select 1 from public.memberships where org_id = p_org and user_id = v_user and status = 'active') then
      raise exception 'dispatch_invalid_rep' using errcode = 'P0001';
    end if;
    select * into z from public.sales_zones where org_id = p_org and user_id = v_user and active;
    if not found then raise exception 'dispatch_no_zone' using errcode = 'P0001'; end if;
    if a.lat is null or a.lng is null then raise exception 'dispatch_no_geocode' using errcode = 'P0001'; end if;
    -- position approximative (commune seule) : seulement si le confirmateur l'a acceptée (même règle que l'aperçu)
    if coalesce(a.geo_precision, 'street') = 'municipality' and not a.geo_accepted then raise exception 'dispatch_geo_approximate' using errcode = 'P0001'; end if;

    -- pré-filtre : rayon à vol d'oiseau ; décision : temps de route réel depuis la base
    if public.haversine_km(a.lat, a.lng, z.base_lat, z.base_lng) > z.radius_km + 0.05 then raise exception 'dispatch_out_of_zone' using errcode = 'P0001'; end if;
    select * into leg from public.route_leg(z.base_lat, z.base_lng, a.lat, a.lng, false);
    if leg.duration_s / 60.0 > v_base_min + 0.5 then raise exception 'dispatch_out_of_zone' using errcode = 'P0001'; end if;

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
        and (starts_at at time zone tz)::date = v_day and id <> a.id and (a.is_simulation or not is_simulation);
    v_comfort := coalesce(z.comfort_max, ds.comfort_max, 5);
    v_absolute := greatest(v_comfort, coalesce(z.absolute_max, ds.absolute_max, 6));
    v_fifth := coalesce((it ->> 'fifth')::boolean, false);
    if v_cnt >= v_absolute then raise exception 'dispatch_day_full' using errcode = 'P0001'; end if;
    -- au-delà du confort (5 par défaut), jamais automatique : le confirmateur doit l'avoir approuvé explicitement (« fifth »)
    if v_cnt >= v_comfort and not v_fifth then raise exception 'dispatch_needs_approval' using errcode = 'P0001'; end if;

    select lat, lng, ends_at into prev from public.appointments
      where org_id = p_org and assigned_to = v_user and status <> 'cancelled' and dispatch_status = 'assigned'
        and (starts_at at time zone tz)::date = v_day and id <> a.id and (a.is_simulation or not is_simulation) and ends_at <= v_start order by ends_at desc limit 1;
    select lat, lng, starts_at into nxt from public.appointments
      where org_id = p_org and assigned_to = v_user and status <> 'cancelled' and dispatch_status = 'assigned'
        and (starts_at at time zone tz)::date = v_day and id <> a.id and (a.is_simulation or not is_simulation) and starts_at >= v_end order by starts_at asc limit 1;
    if prev.ends_at is not null and prev.lat is not null then
      select * into leg from public.route_leg(prev.lat, prev.lng, a.lat, a.lng, false);
      if leg.distance_m / 1000.0 > v_leg_km + 0.1 or leg.duration_s / 60.0 > v_leg_min + 0.5 then raise exception 'dispatch_leg_too_long' using errcode = 'P0001'; end if;
      if extract(epoch from (v_start - prev.ends_at)) / 60 < public.traffic_minutes(leg.duration_s, v_day, extract(epoch from (prev.ends_at at time zone tz)::time)::int / 60, v_morning, v_evening, v_safety) + z.travel_margin_min - 1 then raise exception 'dispatch_travel_time' using errcode = 'P0001'; end if;
    elsif prev.ends_at is null then
      select * into leg from public.route_leg(z.base_lat, z.base_lng, a.lat, a.lng, false);
      if (extract(epoch from v_lstart) - extract(epoch from z.work_start)) / 60 < public.traffic_minutes(leg.duration_s, v_day, extract(epoch from z.work_start)::int / 60, v_morning, v_evening, v_safety) + z.travel_margin_min - 1 then raise exception 'dispatch_travel_time' using errcode = 'P0001'; end if;
    end if;
    if nxt.starts_at is not null and nxt.lat is not null then
      select * into leg from public.route_leg(a.lat, a.lng, nxt.lat, nxt.lng, false);
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
    -- Simulation : ni propriétaire de lead modifié, ni notification (aucune trace chez les vrais commerciaux).
    if not a.is_simulation then
      -- le commercial doit voir le lead de son RDV (périmètre « leads.view_own ») ; l'ancien propriétaire est tracé et prévenu, jamais écrasé en silence
      select assigned_to into v_old_owner from public.leads where id = a.lead_id and org_id = p_org;
      update public.leads set assigned_to = v_user where id = a.lead_id and org_id = p_org and assigned_to is distinct from v_user;
      if v_old_owner is not null and v_old_owner <> v_user then
        perform public.log_lead_event(p_org, a.lead_id, 'appointment', jsonb_build_object('appointment_id', a.id, 'action', 'owner_changed', 'from', v_old_owner, 'to', v_user, 'via', 'dispatch'));
        if not (v_rebal and v_old_owner = a.assigned_to) then
          perform public.dispatch_notify(p_org, v_old_owner, 'Un de vos leads a été confié à un autre commercial par la répartition automatique', a.lead_id);
        end if;
      end if;
      per_user := jsonb_set(per_user, array[v_user::text], to_jsonb(coalesce((per_user ->> v_user::text)::int, 0) + 1));
      -- rééquilibrage : l'ancien commercial est prévenu du retrait
      if v_rebal and a.assigned_to is not null and a.assigned_to <> v_user then
        moved_from := jsonb_set(moved_from, array[a.assigned_to::text], to_jsonb(coalesce((moved_from ->> a.assigned_to::text)::int, 0) + 1));
      end if;
    end if;
    applied := applied + 1;
  end loop;

  for r in select key as u, value::text::int as n from jsonb_each(per_user) loop
    insert into public.notifications (org_id, user_id, type, payload, dedupe_key)
    values (p_org, r.u::uuid, 'appointment',
      jsonb_build_object('message', format('Répartition automatique : %s nouveau(x) rendez-vous dans votre agenda', r.n), 'count', r.n),
      'dispatch:' || batch::text || ':' || r.u);
  end loop;
  for r in select key as u, value::text::int as n from jsonb_each(moved_from) loop
    insert into public.notifications (org_id, user_id, type, payload, dedupe_key)
    values (p_org, r.u::uuid, 'appointment',
      jsonb_build_object('message', format('Rééquilibrage : %s rendez-vous retiré(s) de votre agenda', r.n), 'count', r.n),
      'dispatch-moved:' || batch::text || ':' || r.u);
  end loop;
  return jsonb_build_object('applied', applied, 'skipped', skipped, 'simulation', coalesce(v_sim, false));
end;
$$;
revoke all on function public.apply_dispatch(uuid, jsonb) from public, anon;
grant execute on function public.apply_dispatch(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ 5) report_address_fix : position plausible, RDV actif
create or replace function public.report_address_fix(p_id uuid, p_lat double precision, p_lng double precision, p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments%rowtype; who text; r record; msg text := btrim(coalesce(p_message, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or char_length(msg) > 500 then raise exception 'invalid_message' using errcode = '22023'; end if;
  if not public.plausible_in_france(p_lat, p_lng) then raise exception 'position_outside_france' using errcode = '22023'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or a.assigned_to is distinct from auth.uid() or not public.is_org_member(a.org_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.status not in ('planned', 'confirmed') then raise exception 'dispatch_bad_status' using errcode = 'P0001'; end if;
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

-- ------------------------------------------------------------ 6) dispatcher_swap : seuls des RDV actifs s'échangent (zone/horaires restent le « dernier mot » du confirmateur)
create or replace function public.dispatcher_swap(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x public.appointments%rowtype; y public.appointments%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_a = p_b then raise exception 'dispatch_bad_slot' using errcode = 'P0001'; end if;
  select * into x from public.appointments where id = least(p_a, p_b) for update;
  select * into y from public.appointments where id = greatest(p_a, p_b) for update;
  if x.id is null or y.id is null or x.org_id <> y.org_id or not public.has_perm(x.org_id, 'dispatch.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if x.dispatch_status <> 'assigned' or y.dispatch_status <> 'assigned' or x.status not in ('planned', 'confirmed') or y.status not in ('planned', 'confirmed') then
    raise exception 'dispatch_bad_status' using errcode = 'P0001';
  end if;
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
