-- Les zones d'intervention ne concernent que les rôles terrain (commerciaux), jamais admin / prospecteur / confirmateur.
-- Dépend de 20260202000000 (roles.is_field, is_field_member).

-- RLS : création d'une zone réservée à un membre actif de rôle terrain ; modification idem tant que la zone reste active
-- (désactiver reste toujours permis, pour nettoyer).
drop policy if exists zones_insert on public.sales_zones;
create policy zones_insert on public.sales_zones for insert to authenticated
  with check (public.is_org_member(org_id) and (user_id = auth.uid() or public.has_perm(org_id, 'members.manage')) and public.is_field_member(org_id, user_id));
drop policy if exists zones_update on public.sales_zones;
create policy zones_update on public.sales_zones for update to authenticated
  using (user_id = auth.uid() or public.has_perm(org_id, 'members.manage'))
  with check ((user_id = auth.uid() or public.has_perm(org_id, 'members.manage')) and (not active or public.is_field_member(org_id, user_id)));

-- Un membre qui n'est plus terrain (changement de rôle) voit sa zone désactivée (les RDV déjà attribués restent à replanifier à la main).
create or replace function public.zones_deactivate_non_field() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'memberships' then
    if new.role_id is distinct from old.role_id and not public.is_field_role(new.role_id) then
      update public.sales_zones set active = false where org_id = new.org_id and user_id = new.user_id and active;
    end if;
  else -- roles : is_field décoché, rôle devenu admin ou permissions modifiées
    if new.is_admin or not new.is_field then
      update public.sales_zones z set active = false
      where z.active and z.org_id = new.org_id
        and z.user_id in (select m.user_id from public.memberships m where m.org_id = new.org_id and m.role_id = new.id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.zones_deactivate_non_field() from public, anon, authenticated;
drop trigger if exists memberships_zone_field on public.memberships;
create trigger memberships_zone_field after update of role_id on public.memberships for each row execute function public.zones_deactivate_non_field();
drop trigger if exists roles_zone_field on public.roles;
create trigger roles_zone_field after update of is_field, is_admin, permissions on public.roles for each row execute function public.zones_deactivate_non_field();

-- Nettoyage : zones actives de membres qui ne sont pas (ou plus) de rôle terrain.
update public.sales_zones z set active = false
where z.active and not public.is_field_member(z.org_id, z.user_id);
