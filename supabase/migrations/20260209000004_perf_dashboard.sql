-- Tableau de bord : dash_closed ne rescanne plus tout le journal pour chaque lead clos, et kpi_summary l'appelle UNE fois (au lieu de 3).
-- Résultats identiques (même définition de closed_at : dernier passage vers le statut courant, sinon création du lead).

create or replace function public.dash_closed(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null)
returns table (id uuid, assigned_to uuid, source_id uuid, value numeric, kind text, closed_at timestamptz)
language sql stable set search_path = public set statement_timeout = '8s' as $$
  select l.id, l.assigned_to, l.source_id, l.value, s.kind, c.closed_at
  from public.leads l
  join public.statuses s on s.id = l.status_id and s.org_id = l.org_id
  cross join lateral (
    select coalesce((select e.created_at from public.lead_events e
                      where e.lead_id = l.id and e.type = 'status_changed' and e.payload ->> 'to' = l.status_id::text
                      order by e.created_at desc limit 1), l.created_at) as closed_at) c
  where l.org_id = p_org and s.kind in ('won', 'lost') and l.archived_at is null
    and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)
    and c.closed_at >= p_from and c.closed_at < p_to;
$$;

create or replace function public.kpi_summary(p_org uuid, p_from timestamptz, p_to timestamptz, p_source uuid default null, p_user uuid default null)
returns jsonb
language plpgsql stable set search_path = public set statement_timeout = '8s' as $$
declare r jsonb;
begin
  perform public.dash_check(p_org, p_from, p_to, p_user);
  with c as materialized (select d.kind, d.value from public.dash_closed(p_org, p_from, p_to, p_source, p_user) d),
       a as (select * from public.dash_appt_counts(p_org, p_from, p_to, p_user, p_source))
  select jsonb_build_object(
    'created', (select count(*) from public.leads l where l.org_id = p_org and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
                  and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'won', (select count(*) from c where c.kind = 'won'),
    'lost', (select count(*) from c where c.kind = 'lost'),
    'won_value', (select coalesce(sum(c.value), 0) from c where c.kind = 'won'),
    'cohort_won', (select count(*) from public.leads l join public.statuses s on s.id = l.status_id
                    where l.org_id = p_org and s.kind = 'won' and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
                      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'cohort_lost', (select count(*) from public.leads l join public.statuses s on s.id = l.status_id
                    where l.org_id = p_org and s.kind = 'lost' and l.archived_at is null and l.created_at >= p_from and l.created_at < p_to
                      and (p_source is null or l.source_id = p_source) and (p_user is null or l.assigned_to = p_user)),
    'appts_planned', (select coalesce(a.planned + a.confirmed + a.done + a.no_show, 0) from a),
    'appts_done', (select coalesce(a.done, 0) from a)
  ) into r;
  return r;
end;
$$;
