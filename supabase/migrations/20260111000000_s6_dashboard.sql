-- S6 : agrégations du tableau de bord.
--
-- Toutes les fonctions sont SECURITY INVOKER : la RLS de l'appelant s'applique aux lignes lues
--   - leads : view_all = toute l'organisation, view_own = leads assignés à soi ou créés par soi ;
--   - appointments : appointments.manage_all / manage_own ; lead_events : visibles si le lead l'est.
-- Elles exigent en plus dashboard.view, bornent la période (366 jours max) et refusent un filtre « utilisateur »
-- hors de son périmètre. L'organisation passée en paramètre n'est jamais crue : sans permission => erreur.
--
-- Définitions :
--   * créés          : leads dont created_at est dans [from, to[.
--   * clôturés       : leads actuellement en statut final dont la date de clôture est dans la période.
--                      Date de clôture = dernier événement status_changed vers le statut actuel (sinon created_at).
--   * taux de conversion = gagnés / (gagnés + perdus) parmi les clôturés de la période (NULL si aucun clôturé).
--   * cohorte        : leads créés dans la période, rapportés à leur statut actuel (gagnés / (gagnés + perdus)).
--   * valeur gagnée  : somme de leads.value des leads gagnés clôturés dans la période.
--   * RDV            : planifiés = non annulés dont starts_at est dans la période ; réalisés = status 'done'.

create index if not exists lead_events_status_idx on public.lead_events (lead_id, created_at desc) where type = 'status_changed';
create index if not exists leads_org_assigned_created_idx on public.leads (org_id, assigned_to, created_at);

create function public.dash_check(p_org uuid, p_from timestamptz, p_to timestamptz, p_user uuid, p_need_all boolean default false) returns void
language plpgsql stable set search_path = public as $$
begin
  if auth.uid() is null or not public.has_perm(p_org, 'dashboard.view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if p_need_all and not public.has_perm(p_org, 'leads.view_all') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user is not null and p_user <> auth.uid() and not public.has_perm(p_org, 'leads.view_all') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- Rendez-vous de la période dans le périmètre de l'appelant (dashboard.view suffit, sans exiger appointments.*) :
-- view_all => toute l'organisation ; sinon uniquement les RDV dont le lead lui est visible (vue leads_api).
create function public.dash_appts(p_org uuid, p_from timestamptz, p_to timestamptz, p_user uuid default null)
returns table (assigned_to uuid, status text, starts_at timestamptz, distance_status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  return query
    select a.assigned_to, a.status, a.starts_at, a.distance_status from public.appointments a
    where a.org_id = p_org and a.starts_at >= p_from and a.starts_at < p_to and (p_user is null or a.assigned_to = p_user)
      and (public.has_perm(p_org, 'leads.view_all') or exists (select 1 from public.leads_api la where la.id = a.lead_id));
end;
$$;

-- Leads clôturés (gagnés / perdus) dans la période, avec leur date de clôture.
create function public.dash_closed(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null)
returns table (id uuid, assigned_to uuid, source_id uuid, value numeric, kind text, closed_at timestamptz)
language sql stable set search_path = public as $$
  select x.id, x.assigned_to, x.source_id, x.value, x.kind, x.closed_at from (
    select l.id, l.assigned_to, l.source_id, l.value, s.kind,
      coalesce((select max(e.created_at) from public.lead_events e
                 where e.lead_id = l.id and e.type = 'status_changed' and e.payload ->> 'to' = l.status_id::text), l.created_at) as closed_at
    from public.leads l
    join public.statuses s on s.id = l.status_id and s.org_id = l.org_id
    where l.org_id = p_org and s.kind in ('won', 'lost')
      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)
  ) x where x.closed_at >= p_from and x.closed_at < p_to;
$$;

create function public.kpi_summary(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  select jsonb_build_object(
    'created', (select count(*) from public.leads l where l.org_id = p_org and l.created_at >= p_from and l.created_at < p_to
                  and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'won', (select count(*) from public.dash_closed(p_org, p_from, p_to, p_source, p_user) c where c.kind = 'won'),
    'lost', (select count(*) from public.dash_closed(p_org, p_from, p_to, p_source, p_user) c where c.kind = 'lost'),
    'won_value', (select coalesce(sum(c.value), 0) from public.dash_closed(p_org, p_from, p_to, p_source, p_user) c where c.kind = 'won'),
    'cohort_won', (select count(*) from public.leads l join public.statuses s on s.id = l.status_id
                    where l.org_id = p_org and s.kind = 'won' and l.created_at >= p_from and l.created_at < p_to
                      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'cohort_lost', (select count(*) from public.leads l join public.statuses s on s.id = l.status_id
                    where l.org_id = p_org and s.kind = 'lost' and l.created_at >= p_from and l.created_at < p_to
                      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'appts_planned', (select count(*) from public.dash_appts(p_org, p_from, p_to, p_user) a where a.status <> 'cancelled'),
    'appts_done', (select count(*) from public.dash_appts(p_org, p_from, p_to, p_user) a where a.status = 'done')
  ) into r;
  return r;
end;
$$;

-- Leads créés dans la période, répartis selon leur statut actuel (tous les statuts, dans l'ordre du pipeline).
create function public.leads_by_status(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null)
returns table (status_id uuid, name text, color text, kind text, "position" int, n bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  return query
    select s.id, s.name, s.color, s.kind, s.position, count(l.id)
    from public.statuses s
    left join public.leads l on l.status_id = s.id and l.org_id = p_org and l.created_at >= p_from and l.created_at < p_to
      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)
    where s.org_id = p_org
    group by s.id, s.name, s.color, s.kind, s.position
    order by s.position;
end;
$$;

-- Évolution : leads créés et gagnés par jour ou par semaine (fuseau Europe/Paris).
create function public.leads_over_time(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null, p_bucket text default 'day')
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
      from public.leads l where l.org_id = p_org and l.created_at >= p_from and l.created_at < p_to
        and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user) group by 1
    ),
    wn as (
      select date_trunc(p_bucket, c.closed_at at time zone 'Europe/Paris')::date as d, count(*) as n
      from public.dash_closed(p_org, p_from, p_to, p_source, p_user) c where c.kind = 'won' group by 1
    )
    select series.d, coalesce(cr.n, 0), coalesce(wn.n, 0) from series left join cr on cr.d = series.d left join wn on wn.d = series.d order by series.d;
end;
$$;

create function public.leads_by_source(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null)
returns table (source_id uuid, name text, n bigint, won bigint)
language plpgsql stable set search_path = public as $$
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  return query
    select l.source_id, coalesce(src.name, 'Sans source'), count(*), count(*) filter (where s.kind = 'won')
    from public.leads l
    join public.statuses s on s.id = l.status_id
    left join public.lead_sources src on src.id = l.source_id and src.org_id = l.org_id
    where l.org_id = p_org and l.created_at >= p_from and l.created_at < p_to
      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)
    group by l.source_id, src.name order by count(*) desc, 2;
end;
$$;

-- Performance par utilisateur : réservée à ceux qui voient tous les leads (managers).
create function public.user_performance(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null)
returns table (user_id uuid, name text, leads bigint, appts_planned bigint, appts_done bigint, won bigint, lost bigint, won_value numeric)
language plpgsql stable set search_path = public as $$
begin
  perform public.dash_check(p_org, p_from, p_to, null, true);
  return query
    select m.user_id, coalesce(p.full_name, p.email, '—'),
      (select count(*) from public.leads l where l.org_id = p_org and l.assigned_to = m.user_id and l.created_at >= p_from and l.created_at < p_to and (p_source is null or l.source_id = p_source)),
      (select count(*) from public.dash_appts(p_org, p_from, p_to, m.user_id) a where a.status <> 'cancelled'),
      (select count(*) from public.dash_appts(p_org, p_from, p_to, m.user_id) a where a.status = 'done'),
      (select count(*) from public.dash_closed(p_org, p_from, p_to, p_source, m.user_id) c where c.kind = 'won'),
      (select count(*) from public.dash_closed(p_org, p_from, p_to, p_source, m.user_id) c where c.kind = 'lost'),
      (select coalesce(sum(c.value), 0) from public.dash_closed(p_org, p_from, p_to, p_source, m.user_id) c where c.kind = 'won')
    from public.memberships m left join public.profiles p on p.id = m.user_id
    where m.org_id = p_org and m.status = 'active'
    order by 6 desc, 2;
end;
$$;

create function public.appointments_summary(p_org uuid, p_from timestamptz, p_to timestamptz, p_user uuid default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  select jsonb_build_object(
    'planned', count(*) filter (where a.status = 'planned'), 'confirmed', count(*) filter (where a.status = 'confirmed'),
    'done', count(*) filter (where a.status = 'done'), 'cancelled', count(*) filter (where a.status = 'cancelled'),
    'no_show', count(*) filter (where a.status = 'no_show'), 'over_radius', count(*) filter (where a.distance_status = 'over_radius' and a.status <> 'cancelled'))
  into r from public.dash_appts(p_org, p_from, p_to, p_user) a;
  return r;
end;
$$;

revoke all on function public.dash_appts(uuid, timestamptz, timestamptz, uuid), public.dash_check(uuid, timestamptz, timestamptz, uuid, boolean), public.dash_closed(uuid, timestamptz, timestamptz, uuid, uuid),
  public.kpi_summary(uuid, timestamptz, timestamptz, uuid, uuid), public.leads_by_status(uuid, timestamptz, timestamptz, uuid, uuid),
  public.leads_over_time(uuid, timestamptz, timestamptz, uuid, uuid, text), public.leads_by_source(uuid, timestamptz, timestamptz, uuid, uuid),
  public.user_performance(uuid, timestamptz, timestamptz, uuid), public.appointments_summary(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.dash_appts(uuid, timestamptz, timestamptz, uuid), public.dash_check(uuid, timestamptz, timestamptz, uuid, boolean), public.dash_closed(uuid, timestamptz, timestamptz, uuid, uuid),
  public.kpi_summary(uuid, timestamptz, timestamptz, uuid, uuid), public.leads_by_status(uuid, timestamptz, timestamptz, uuid, uuid),
  public.leads_over_time(uuid, timestamptz, timestamptz, uuid, uuid, text), public.leads_by_source(uuid, timestamptz, timestamptz, uuid, uuid),
  public.user_performance(uuid, timestamptz, timestamptz, uuid), public.appointments_summary(uuid, timestamptz, timestamptz, uuid) to authenticated;
