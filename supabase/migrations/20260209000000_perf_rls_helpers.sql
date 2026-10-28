-- Performance : les politiques RLS appelaient has_perm()/is_org_member() (fonctions SECURITY DEFINER, non inlinables)
-- UNE FOIS PAR LIGNE LUE. Sur 100 000 leads, un simple COUNT coûtait 1 à 3 s.
-- Ces deux fonctions renvoient, en un seul appel, les organisations pour lesquelles l'utilisateur courant a le droit voulu.
-- Utilisées sous la forme  org_id = any ((select public.perm_orgs('leads.view_all')))  elles sont évaluées une seule fois
-- par requête (InitPlan) puis comparées à chaque ligne sans nouvel accès aux tables.
-- Sémantique identique à public.has_perm / public.is_org_member (membre actif ; rôle administrateur = tous les droits).

create or replace function public.member_orgs() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.org_id), '{}'::uuid[])
  from public.memberships m
  where m.user_id = (select auth.uid()) and m.status = 'active';
$$;

create or replace function public.perm_orgs(p_perm text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.org_id), '{}'::uuid[])
  from public.memberships m
  join public.roles r on r.id = m.role_id
  where m.user_id = (select auth.uid()) and m.status = 'active' and (r.is_admin or p_perm = any (r.permissions));
$$;

revoke all on function public.member_orgs(), public.perm_orgs(text) from public, anon;
grant execute on function public.member_orgs(), public.perm_orgs(text) to authenticated, service_role;

-- has_perm / is_org_member : mêmes résultats, mais l'identité est lue une seule fois (InitPlan) au lieu de deux appels auth.uid().
create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
    where m.org_id = org and m.user_id = (select auth.uid()) and m.status = 'active');
$$;

create or replace function public.has_perm(org uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.org_id = org and m.user_id = (select auth.uid()) and m.status = 'active'
      and (r.is_admin or perm = any (r.permissions)));
$$;
