-- S6 correctifs : leads archivés exclus, rendez-vous filtrés par source et réduits à des agrégats, délai maximal d'exécution.
--
-- Définition : les leads archivés (archived_at non nul) sont exclus de TOUS les indicateurs, comme de la liste /leads.

drop function public.dash_appts(uuid, timestamptz, timestamptz, uuid);
drop function public.appointments_summary(uuid, timestamptz, timestamptz, uuid);

-- Compteurs de rendez-vous (agrégats uniquement : aucune ligne n'est exposée). DEFINER pour que dashboard.view suffise,
-- avec la même visibilité qu'ailleurs : view_all => organisation ; sinon seulement les rendez-vous dont le lead est visible.
create function public.dash_appt_counts(p_org uuid, p_from timestamptz, p_to timestamptz, p_user uuid default null, p_source uuid default null)
returns table (planned bigint, confirmed bigint, done bigint, cancelled bigint, no_show bigint, over_radius bigint)
language plpgsql stable security definer set search_path = public set statement_timeout = '8s' as $$
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  return query
    select count(*) filter (where a.status = 'planned'), count(*) filter (where a.status = 'confirmed'), count(*) filter (where a.status = 'done'),
      count(*) filter (where a.status = 'cancelled'), count(*) filter (where a.status = 'no_show'),
      count(*) filter (where a.distance_status = 'over_radius' and a.status <> 'cancelled')
    from public.appointments a join public.leads l on l.id = a.lead_id and l.org_id = a.org_id
    where a.org_id = p_org and a.starts_at >= p_from and a.starts_at < p_to and l.archived_at is null
      and (p_user is null or a.assigned_to = p_user) and (p_source is null or l.source_id = p_source)
      and (public.has_perm(p_org, 'leads.view_all') or exists (select 1 from public.leads_api la where la.id = a.lead_id));
end;
$$;

create function public.dash_appt_counts_by_user(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null)
returns table (assigned_to uuid, planned bigint, done bigint)
language plpgsql stable security definer set search_path = public set statement_timeout = '8s' as $$
begin
  perform public.dash_check(p_org, p_from, p_to, null, true);
  return query
    select a.assigned_to, count(*) filter (where a.status <> 'cancelled'), count(*) filter (where a.status = 'done')
    from public.appointments a join public.leads l on l.id = a.lead_id and l.org_id = a.org_id
    where a.org_id = p_org and a.starts_at >= p_from and a.starts_at < p_to and l.archived_at is null and (p_source is null or l.source_id = p_source)
    group by a.assigned_to;
end;
$$;

create or replace function public.dash_closed(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null)
returns table (id uuid, assigned_to uuid, source_id uuid, value numeric, kind text, closed_at timestamptz)
language sql stable set search_path = public as $$
  select x.id, x.assigned_to, x.source_id, x.value, x.kind, x.closed_at from (
    select l.id, l.assigned_to, l.source_id, l.value, s.kind,
      coalesce((select max(e.created_at) from public.lead_events e
                 where e.lead_id = l.id and e.type = 'status_changed' and e.payload ->> 'to' = l.status_id::text), l.created_at) as closed_at
    from public.leads l
    join public.statuses s on s.id = l.status_id and s.org_id = l.org_id
    where l.org_id = p_org and s.kind in ('won', 'lost') and l.archived_at is null
      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)
  ) x where x.closed_at >= p_from and x.closed_at < p_to;
$$;

create or replace function public.kpi_summary(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  select jsonb_build_object(
    'created', (select count(*) from public.leads l where l.org_id = p_org and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
                  and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'won', (select count(*) from public.dash_closed(p_org, p_from, p_to, p_source, p_user) c where c.kind = 'won'),
    'lost', (select count(*) from public.dash_closed(p_org, p_from, p_to, p_source, p_user) c where c.kind = 'lost'),
    'won_value', (select coalesce(sum(c.value), 0) from public.dash_closed(p_org, p_from, p_to, p_source, p_user) c where c.kind = 'won'),
    'cohort_won', (select count(*) from public.leads l join public.statuses s on s.id = l.status_id
                    where l.org_id = p_org and s.kind = 'won' and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
                      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'cohort_lost', (select count(*) from public.leads l join public.statuses s on s.id = l.status_id
                    where l.org_id = p_org and s.kind = 'lost' and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
                      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'appts_planned', (select coalesce(c.planned + c.confirmed + c.done + c.no_show, 0) from public.dash_appt_counts(p_org, p_from, p_to, p_user, p_source) c),
    'appts_done', (select coalesce(c.done, 0) from public.dash_appt_counts(p_org, p_from, p_to, p_user, p_source) c)
  ) into r;
  return r;
end;
$$;

create or replace function public.leads_by_status(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null)
returns table (status_id uuid, name text, color text, kind text, "position" int, n bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  return query
    select s.id, s.name, s.color, s.kind, s.position, count(l.id)
    from public.statuses s
    left join public.leads l on l.status_id = s.id and l.org_id = p_org and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)
    where s.org_id = p_org
    group by s.id, s.name, s.color, s.kind, s.position
    order by s.position;
end;
$$;

create or replace function public.leads_over_time(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null, p_bucket text default 'day')
returns table (bucket date, created bigint, won bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  if p_bucket not in ('day', 'week') then raise exception 'invalid_bucket' using errcode = '22023'; end if;
  return query
    with series as (
      select generate_series(date_trunc(p_bucket, p_from at time zone 'Europe/Paris'), date_trunc(p_bucket, (p_to - interval '1 second') at time zone 'Europe/Paris'), ('1 ' || p_bucket)::interval)::date as d
    ),
    cr as (
      select date_trunc(p_bucket, l.created_at at time zone 'Europe/Paris')::date as d, count(*) as n
      from public.leads l where l.org_id = p_org and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
        and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user) group by 1
    ),
    wn as (
      select date_trunc(p_bucket, c.closed_at at time zone 'Europe/Paris')::date as d, count(*) as n
      from public.dash_closed(p_org, p_from, p_to, p_source, p_user) c where c.kind = 'won' group by 1
    )
    select series.d, coalesce(cr.n, 0), coalesce(wn.n, 0) from series left join cr on cr.d = series.d left join wn on wn.d = series.d order by series.d;
end;
$$;

create or replace function public.leads_by_source(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null)
returns table (source_id uuid, name text, n bigint, won bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  return query
    select l.source_id, coalesce(src.name, 'Sans source'), count(*), count(*) filter (where s.kind = 'won')
    from public.leads l
    join public.statuses s on s.id = l.status_id
    left join public.lead_sources src on src.id = l.source_id and src.org_id = l.org_id
    where l.org_id = p_org and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)
    group by l.source_id, src.name order by count(*) desc, 2;
end;
$$;

-- Une ligne par membre actif PLUS une ligne « Non assigné » (user_id NULL) : la somme des lignes = total des leads.
create or replace function public.user_performance(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null)
returns table (user_id uuid, name text, leads bigint, appts_planned bigint, appts_done bigint, won bigint, lost bigint, won_value numeric)
language plpgsql stable set search_path = public as $$
begin
  perform public.dash_check(p_org, p_from, p_to, null, true);
  return query
    with ap as (select * from public.dash_appt_counts_by_user(p_org, p_from, p_to, p_source)),
    members as (select m.user_id as uid, coalesce(p.full_name, p.email, '—') as nm from public.memberships m left join public.profiles p on p.id = m.user_id where m.org_id = p_org and m.status = 'active'),
    lc as (select l.assigned_to as uid, count(*) as n from public.leads l where l.org_id = p_org and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to and (p_source is null or l.source_id = p_source) group by l.assigned_to),
    cl as (select c.assigned_to as uid, count(*) filter (where c.kind = 'won') as won, count(*) filter (where c.kind = 'lost') as lost, coalesce(sum(c.value) filter (where c.kind = 'won'), 0) as val
           from public.dash_closed(p_org, p_from, p_to, p_source, null) c group by c.assigned_to)
    select u.uid, u.nm, coalesce(lc.n, 0), coalesce(ap.planned, 0), coalesce(ap.done, 0), coalesce(cl.won, 0), coalesce(cl.lost, 0), coalesce(cl.val, 0)
    from (select uid, nm from members union all select null::uuid, 'Non assigné') u
    left join lc on lc.uid is not distinct from u.uid
    left join ap on ap.assigned_to is not distinct from u.uid
    left join cl on cl.uid is not distinct from u.uid
    where u.uid is not null or coalesce(lc.n, 0) + coalesce(cl.won, 0) + coalesce(cl.lost, 0) + coalesce(ap.planned, 0) > 0
    order by 6 desc, 2;
end;
$$;

create function public.appointments_summary(p_org uuid, p_from timestamptz, p_to timestamptz, p_user uuid default null, p_source uuid default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  select to_jsonb(c) into r from public.dash_appt_counts(p_org, p_from, p_to, p_user, p_source) c;
  return r;
end;
$$;

-- Délai maximal d'exécution : une agrégation anormalement longue est interrompue (appels directs inclus).
alter function public.dash_check(uuid, timestamptz, timestamptz, uuid, boolean) set statement_timeout = '8s';
alter function public.dash_closed(uuid, timestamptz, timestamptz, uuid, uuid) set statement_timeout = '8s';
alter function public.kpi_summary(uuid, timestamptz, timestamptz, uuid, uuid) set statement_timeout = '8s';
alter function public.leads_by_status(uuid, timestamptz, timestamptz, uuid, uuid) set statement_timeout = '8s';
alter function public.leads_over_time(uuid, timestamptz, timestamptz, uuid, uuid, text) set statement_timeout = '8s';
alter function public.leads_by_source(uuid, timestamptz, timestamptz, uuid, uuid) set statement_timeout = '8s';
alter function public.user_performance(uuid, timestamptz, timestamptz, uuid) set statement_timeout = '8s';
alter function public.appointments_summary(uuid, timestamptz, timestamptz, uuid, uuid) set statement_timeout = '8s';

revoke all on function public.dash_appt_counts(uuid, timestamptz, timestamptz, uuid, uuid), public.dash_appt_counts_by_user(uuid, timestamptz, timestamptz, uuid),
  public.appointments_summary(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.dash_appt_counts(uuid, timestamptz, timestamptz, uuid, uuid), public.dash_appt_counts_by_user(uuid, timestamptz, timestamptz, uuid),
  public.appointments_summary(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;
