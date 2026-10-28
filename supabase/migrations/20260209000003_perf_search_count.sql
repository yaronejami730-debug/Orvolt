-- Liste des leads : compte plafonné (jamais de COUNT(*) sur 100 000 lignes) + recherche par téléphone normalisé.

-- La vue expose phone_norm (colonne ajoutée EN FIN de liste) ; custom vide = pas d'appel à mask_custom (coûteux, par ligne).
create or replace view public.leads_api as
select l.id, l.org_id, l.status_id, l.source_id, l.assigned_to, l.first_name, l.last_name, l.company, l.email, l.phone,
  l.address, l.city, l.postal_code, l.lat, l.lng, l.value,
  case when l.custom = '{}'::jsonb then l.custom else public.mask_custom(l.org_id, l.custom) end as custom,
  l.created_by, l.position, l.archived_at, l.created_at, l.updated_at, l.search_text, l.phone_norm
from public.leads l
where not l.is_simulation
  and (l.org_id = any ((select public.perm_orgs('leads.view_all'))::uuid[])
    or (l.org_id = any ((select public.perm_orgs('leads.view_own'))::uuid[])
        and (l.assigned_to = (select auth.uid()) or l.created_by = (select auth.uid()))));

-- Nombre de leads correspondant aux filtres de la liste, PLAFONNÉ à p_cap (10 000 par défaut) : au plus p_cap lignes lues.
-- SECURITY INVOKER : lit leads_api, donc mêmes droits que la liste.
create or replace function public.leads_count(
  p_org uuid, p_statuses uuid[] default null,
  p_sources uuid[] default null, p_sources_none boolean default false,
  p_assigned uuid[] default null, p_assigned_none boolean default false,
  p_from timestamptz default null, p_to timestamptz default null,
  p_q text default null, p_phone text default null, p_custom jsonb default null, p_cap int default 10000
) returns int
language plpgsql stable set search_path = public set statement_timeout = '5s' set plan_cache_mode = force_custom_plan as $$
declare
  n int;
  src_on boolean := coalesce(cardinality(p_sources), 0) > 0 or coalesce(p_sources_none, false);
  asg_on boolean := coalesce(cardinality(p_assigned), 0) > 0 or coalesce(p_assigned_none, false);
  q text := nullif(btrim(lower(p_q)), '');
  ph text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  if q is not null then q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_'); end if;
  select count(*) into n from (
    select 1 from public.leads_api l
    where l.org_id = p_org and l.archived_at is null
      and (coalesce(cardinality(p_statuses), 0) = 0 or l.status_id = any (p_statuses))
      and (not src_on or l.source_id = any (coalesce(p_sources, '{}'::uuid[])) or (coalesce(p_sources_none, false) and l.source_id is null))
      and (not asg_on or l.assigned_to = any (coalesce(p_assigned, '{}'::uuid[])) or (coalesce(p_assigned_none, false) and l.assigned_to is null))
      and (p_from is null or l.created_at >= p_from)
      and (p_to is null or l.created_at < p_to)
      and (q is null or l.search_text ilike '%' || q || '%' or (ph is not null and l.phone_norm ilike '%' || ph || '%'))
      and (p_custom is null or not exists (
            select 1 from jsonb_each_text(p_custom) e
            where (l.custom ->> e.key) is null or (l.custom ->> e.key) not ilike '%' || e.value || '%'))
    limit greatest(coalesce(p_cap, 10000), 1)
  ) s;
  return n;
end;
$$;
revoke all on function public.leads_count(uuid, uuid[], uuid[], boolean, uuid[], boolean, timestamptz, timestamptz, text, text, jsonb, int) from public, anon;
grant execute on function public.leads_count(uuid, uuid[], uuid[], boolean, uuid[], boolean, timestamptz, timestamptz, text, text, jsonb, int) to authenticated, service_role;
