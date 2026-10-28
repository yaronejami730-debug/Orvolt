-- Politiques de LECTURE des tables chaudes réécrites sans appel de fonction par ligne (voir 20260209000000).
-- Mêmes droits qu'avant : is_org_member(org) est impliqué par has_perm(org, …) (membre actif requis).

-- leads : lecture (client) --------------------------------------------------------------------------
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (
    org_id = any ((select public.perm_orgs('leads.view_all'))::uuid[])
    or (org_id = any ((select public.perm_orgs('leads.view_own'))::uuid[])
        and (assigned_to = (select auth.uid()) or created_by = (select auth.uid())))
  );

-- Vue de lecture des clients (propriétaire de la vue : RLS non appliquée, filtre explicite identique à la politique + simulation exclue).
create or replace view public.leads_api as
select l.id, l.org_id, l.status_id, l.source_id, l.assigned_to, l.first_name, l.last_name, l.company, l.email, l.phone,
  l.address, l.city, l.postal_code, l.lat, l.lng, l.value, public.mask_custom(l.org_id, l.custom) as custom,
  l.created_by, l.position, l.archived_at, l.created_at, l.updated_at, l.search_text
from public.leads l
where not l.is_simulation
  and (l.org_id = any ((select public.perm_orgs('leads.view_all'))::uuid[])
    or (l.org_id = any ((select public.perm_orgs('leads.view_own'))::uuid[])
        and (l.assigned_to = (select auth.uid()) or l.created_by = (select auth.uid()))));

-- appointments : lecture ----------------------------------------------------------------------------
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
  using (
    org_id = any ((select public.member_orgs())::uuid[])
    and (org_id = any ((select public.perm_orgs('appointments.manage_all'))::uuid[])
      or org_id = any ((select public.perm_orgs('dispatch.manage'))::uuid[])
      or (org_id = any ((select public.perm_orgs('appointments.manage_own'))::uuid[])
          and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()))))
    and exists (select 1 from public.leads l where l.id = appointments.lead_id)
  );

-- tasks : lecture -----------------------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    org_id = any ((select public.member_orgs())::uuid[])
    and (assigned_to = (select auth.uid()) or created_by = (select auth.uid())
         or org_id = any ((select public.perm_orgs('leads.view_all'))::uuid[]))
  );

-- notifications : lecture ---------------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and org_id = any ((select public.member_orgs())::uuid[]));
