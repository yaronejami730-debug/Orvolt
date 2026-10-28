-- Rôle « terrain » explicite : roles.is_field remplace la déduction par permissions (fragile : donner leads.create à un
-- commercial lui faisait perdre sa zone en silence). Miroir SQL exact de isFieldRole (src/lib/permissions.ts) :
--   isFieldRole = not is_admin and is_field.
-- Idempotent : le backfill ne s'exécute qu'à la création de la colonne (un rôle décoché à la main n'est jamais ré-activé).

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'roles' and column_name = 'is_field') then
    alter table public.roles add column is_field boolean not null default false;
    -- Ancienne règle : appointments.manage_own sans appointments.manage_all ni leads.create (hors rôles admin).
    update public.roles set is_field = true
    where not is_admin
      and 'appointments.manage_own' = any (permissions)
      and not ('appointments.manage_all' = any (permissions))
      and not ('leads.create' = any (permissions));
  end if;
end $$;

-- Rôle terrain d'après son identifiant.
create or replace function public.is_field_role(p_role uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not r.is_admin and r.is_field from public.roles r where r.id = p_role), false);
$$;

-- Le membre actif p_user de p_org a-t-il un rôle terrain ?
create or replace function public.is_field_member(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id
    where m.org_id = p_org and m.user_id = p_user and m.status = 'active' and not r.is_admin and r.is_field);
$$;
revoke all on function public.is_field_role(uuid), public.is_field_member(uuid, uuid) from public, anon;
grant execute on function public.is_field_role(uuid), public.is_field_member(uuid, uuid) to authenticated, service_role;

-- Les rôles créés par les fonctions de gabarit (Commercial / Poseur / rôles système) n'ont pas la colonne dans leurs INSERT :
-- ils héritent de l'ancienne règle à la création. Un rôle personnalisé créé par l'interface fixe is_field explicitement.
create or replace function public.roles_default_is_field() returns trigger
language plpgsql set search_path = public as $$
begin
  if not new.is_field and not new.is_admin and (new.is_system or new.name = 'Poseur')
     and 'appointments.manage_own' = any (new.permissions)
     and not ('appointments.manage_all' = any (new.permissions))
     and not ('leads.create' = any (new.permissions)) then
    new.is_field := true;
  end if;
  return new;
end;
$$;
revoke all on function public.roles_default_is_field() from public, anon, authenticated;
drop trigger if exists roles_default_is_field on public.roles;
create trigger roles_default_is_field before insert on public.roles for each row execute function public.roles_default_is_field();
