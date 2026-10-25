-- S1 correctifs sécurité : dernier admin, plafond d'orgs, membres légitimes, hygiène des grants.

-- 1) Dernier admin actif : impossible de désactiver / rétrograder / supprimer.
create function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare was_admin boolean; still_admin boolean := false; others int;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if; -- cascades (suppression d'org / d'utilisateur)
  if old.status <> 'active' then return coalesce(new, old); end if;
  select is_admin into was_admin from public.roles where id = old.role_id;
  if not coalesce(was_admin, false) then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    select (new.status = 'active' and new.org_id = old.org_id and coalesce(r.is_admin, false)) into still_admin
      from public.roles r where r.id = new.role_id;
    if coalesce(still_admin, false) then return new; end if;
  end if;
  perform 1 from public.organizations where id = old.org_id for update;
  if not found then return coalesce(new, old); end if;
  select count(*) into others from public.memberships m join public.roles r on r.id = m.role_id
    where m.org_id = old.org_id and m.status = 'active' and r.is_admin and m.id <> old.id;
  if others = 0 then raise exception 'last_admin' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end;
$$;
create trigger memberships_last_admin before update or delete on public.memberships
  for each row execute function public.protect_last_admin();

-- 2) Membres légitimes : un client ne peut ajouter qu'un compte provisionné pour cette org (app_metadata serveur).
alter table public.profiles add column provisioned_org uuid;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, provisioned_org)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_app_meta_data ->> 'provisioned_org', '')::uuid)
  on conflict (id) do nothing;
  return new;
end;
$$;

create function public.check_membership_target() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.user_id <> auth.uid()
     and not exists (select 1 from public.profiles p where p.id = new.user_id and p.provisioned_org = new.org_id) then
    raise exception 'invalid_member_target' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger memberships_target before insert on public.memberships
  for each row execute function public.check_membership_target();

-- 3) Plafond d'organisations par utilisateur (3).
create or replace function public.create_organization(p_name text, p_template text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  org uuid;
  admin_role uuid;
  base text;
  candidate text;
  all_perms text[] := array[
    'leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
    'statuses.manage','fields.manage','roles.manage','members.manage',
    'appointments.manage_all','appointments.manage_own','dashboard.view',
    'billing.manage','settings.manage'];
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) < 2 or char_length(p_name) > 80 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_template not in ('energie','btp','immobilier','auto','generic') then
    raise exception 'invalid_template' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  if (select count(*) from public.organizations where created_by = uid) >= 3 then
    raise exception 'org_limit_reached' using errcode = 'P0001';
  end if;

  base := regexp_replace(
    translate(lower(p_name), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '-', 'g');
  base := btrim(base, '-');
  if base = '' then base := 'org'; end if;
  candidate := base;
  while exists (select 1 from public.organizations where slug = candidate) loop
    candidate := base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  end loop;

  insert into public.organizations (name, slug, template, created_by)
  values (p_name, candidate, p_template, uid) returning id into org;

  insert into public.roles (org_id, name, description, is_system, is_admin, permissions)
  values (org, 'Admin', 'Accès complet à l''organisation', true, true, all_perms)
  returning id into admin_role;

  insert into public.roles (org_id, name, description, is_system, permissions) values
    (org, 'Prospecteur', 'Saisit et importe des leads, gère ses rendez-vous', true,
      array['leads.view_own','leads.create','leads.edit','leads.import','appointments.manage_own']),
    (org, 'Confirmateur', 'Qualifie les leads et planifie les rendez-vous', true,
      array['leads.view_all','leads.create','leads.edit','appointments.manage_all','dashboard.view']),
    (org, 'Commercial', 'Suit ses leads et ses rendez-vous', true,
      array['leads.view_own','leads.edit','appointments.manage_own']);

  insert into public.memberships (org_id, user_id, role_id, status)
  values (org, uid, admin_role, 'active');

  perform public.apply_template(org, p_template);
  return org;
end;
$$;

-- 4) Hygiène : fonctions trigger non appelables par les clients.
revoke all on function public.handle_new_user(), public.roles_guard(), public.enforce_seat_limit(),
  public.protect_last_admin(), public.check_membership_target() from public, anon, authenticated;

-- GoTrue écrit app_metadata après l'insertion : synchroniser aussi à la mise à jour.
create function public.sync_provisioned_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set provisioned_org = nullif(new.raw_app_meta_data ->> 'provisioned_org', '')::uuid
  where id = new.id and provisioned_org is distinct from nullif(new.raw_app_meta_data ->> 'provisioned_org', '')::uuid;
  return new;
end;
$$;
create trigger on_auth_user_app_meta after update of raw_app_meta_data on auth.users
  for each row execute function public.sync_provisioned_org();
revoke all on function public.sync_provisioned_org() from public, anon, authenticated;
