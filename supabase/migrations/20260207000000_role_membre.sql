-- Rôle système « Membre » (offre Starter : petite équipe où chacun fait un peu de tout).
-- Droits : leads (voir tout / les siens, créer, modifier, importer) + agenda complet. Jamais leads.delete, billing, settings,
-- members, roles, statuses, fields, dispatch ni dashboard. Pas un rôle terrain (is_field = false : pas de zone d'intervention).
-- Idempotent. Les nouvelles organisations le reçoivent par trigger : create_organization / create_partner_organization restent inchangées.
-- Si une organisation a déjà un rôle nommé « Membre » (personnalisé), l'insertion est ignorée (on conflict) ; le gating par plan
-- (roleAllowedForPlan) ne reconnaît que le rôle système.

-- 1) Backfill des organisations existantes.
insert into public.roles (org_id, name, description, is_system, is_admin, is_field, permissions)
select o.id, 'Membre', 'Équipe de départ : saisit et suit les leads, gère l''agenda.', true, false, false,
  array['leads.view_all','leads.view_own','leads.create','leads.edit','leads.import','appointments.manage_all','appointments.manage_own']
from public.organizations o
on conflict (org_id, name) do nothing;

-- 2) Nouvelles organisations (y compris sous-régies partenaires) : le rôle est ajouté juste après l'insertion de l'organisation.
create or replace function public.organizations_add_membre_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.roles (org_id, name, description, is_system, is_admin, is_field, permissions)
  values (new.id, 'Membre', 'Équipe de départ : saisit et suit les leads, gère l''agenda.', true, false, false,
    array['leads.view_all','leads.view_own','leads.create','leads.edit','leads.import','appointments.manage_all','appointments.manage_own'])
  on conflict (org_id, name) do nothing;
  return new;
end;
$$;
revoke all on function public.organizations_add_membre_role() from public, anon, authenticated;

drop trigger if exists organizations_add_membre_role on public.organizations;
create trigger organizations_add_membre_role after insert on public.organizations
  for each row execute function public.organizations_add_membre_role();
