-- Hiérarchie de rôles : Super administrateur (is_admin) > Administrateur > rôles métier.
-- + droits « poser un statut » par rôle (status_role_grants) + garde-fous anti-escalade en base.

-- ------------------------------------------------------------ 1) rôles : clé système
alter table public.roles add column system_key text check (system_key in ('super_admin', 'administrator'));
create unique index roles_system_key_uniq on public.roles (org_id, system_key) where system_key is not null;

-- ------------------------------------------------------------ 2) droits de statut par rôle
-- Une ligne par (statut, rôle non super-admin). can_place = peut poser ce statut (destination d'un
-- déplacement) ; can_create = peut aussi créer un lead directement dans ce statut (le statut initial
-- est toujours ouvert à la création). Le super administrateur n'a pas de ligne : tout lui est permis.
create table public.status_role_grants (
  org_id uuid not null references public.organizations (id) on delete cascade,
  status_id uuid not null,
  role_id uuid not null,
  can_place boolean not null default true,
  can_create boolean not null default false,
  primary key (status_id, role_id),
  check (not can_create or can_place),
  foreign key (status_id, org_id) references public.statuses (id, org_id) on delete cascade,
  foreign key (role_id, org_id) references public.roles (id, org_id) on delete cascade
);
create index status_role_grants_org_idx on public.status_role_grants (org_id);
create index status_role_grants_role_idx on public.status_role_grants (role_id);

alter table public.status_role_grants enable row level security;
alter table public.status_role_grants force row level security;
revoke all on public.status_role_grants from anon, authenticated;
grant select, insert, update, delete on public.status_role_grants to authenticated;
create policy status_role_grants_select on public.status_role_grants for select to authenticated
  using (public.is_org_member(org_id));
create policy status_role_grants_insert on public.status_role_grants for insert to authenticated
  with check (public.has_perm(org_id, 'statuses.manage'));
create policy status_role_grants_update on public.status_role_grants for update to authenticated
  using (public.has_perm(org_id, 'statuses.manage')) with check (public.has_perm(org_id, 'statuses.manage'));
create policy status_role_grants_delete on public.status_role_grants for delete to authenticated
  using (public.has_perm(org_id, 'statuses.manage'));

create trigger status_role_grants_org before update on public.status_role_grants
  for each row execute function public.immutable_org_guard();

-- Rôle du membre connecté dans une org (null si non membre actif).
create function public.caller_role(org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.role_id from public.memberships m
  where m.org_id = org and m.user_id = auth.uid() and m.status = 'active';
$$;

-- Le statut peut-il être posé (destination) par ce rôle ?
create function public.can_place_status(org uuid, status uuid, role uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or public.is_org_member(org)) and (
    exists (select 1 from public.roles r where r.id = role and r.org_id = org and r.is_admin)
    or exists (select 1 from public.status_role_grants g
      where g.org_id = org and g.status_id = status and g.role_id = role and g.can_place));
$$;

-- Le rôle peut-il créer un lead directement dans ce statut ? (statut initial : toujours)
create function public.can_create_in_status(org uuid, status uuid, role uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or public.is_org_member(org)) and exists (select 1 from public.statuses s where s.id = status and s.org_id = org) and (
    exists (select 1 from public.statuses s where s.id = status and s.org_id = org and s.is_initial)
    or exists (select 1 from public.roles r where r.id = role and r.org_id = org and r.is_admin)
    or exists (select 1 from public.status_role_grants g
      where g.org_id = org and g.status_id = status and g.role_id = role and g.can_place and g.can_create));
$$;

-- Le rôle cible ne dépasse-t-il pas le rôle de l'appelant (permissions + droits de statut) ?
create function public.role_within(target uuid, caller uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select caller is not null and (
    exists (select 1 from public.roles c where c.id = caller and c.is_admin)
    or (
      exists (select 1 from public.roles t, public.roles c
        where t.id = target and c.id = caller and t.org_id = c.org_id and not t.is_admin and t.permissions <@ c.permissions)
      and not exists (select 1 from public.status_role_grants tg
        left join public.status_role_grants cg on cg.status_id = tg.status_id and cg.role_id = caller
        where tg.role_id = target
          and ((tg.can_place and not coalesce(cg.can_place, false)) or (tg.can_create and not coalesce(cg.can_create, false))))
    ));
$$;

revoke all on function public.caller_role(uuid), public.can_place_status(uuid, uuid, uuid),
  public.can_create_in_status(uuid, uuid, uuid), public.role_within(uuid, uuid) from public, anon;
grant execute on function public.caller_role(uuid), public.can_place_status(uuid, uuid, uuid),
  public.can_create_in_status(uuid, uuid, uuid), public.role_within(uuid, uuid) to authenticated, service_role;

-- can_transition : super admin = tout ; les autres doivent avoir (transition autorisée) ET (droit de poser la destination).
create or replace function public.can_transition(org uuid, from_status uuid, to_status uuid, role uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or public.is_org_member(org)) and exists (
    select 1 from public.statuses f, public.statuses t
    where f.id = from_status and t.id = to_status and f.org_id = org and t.org_id = org
      and f.id <> t.id and f.kind = 'normal'
      and (
        exists (select 1 from public.roles r where r.id = role and r.org_id = org and r.is_admin)
        or (
          exists (select 1 from public.status_role_grants g
            where g.org_id = org and g.status_id = to_status and g.role_id = role and g.can_place)
          and exists (select 1 from public.status_transitions st
            where st.org_id = org and st.from_status_id = from_status and st.to_status_id = to_status
              and (st.role_id is null or st.role_id = role))
        )
      ));
$$;

-- Création de lead : statut demandé accepté seulement si le rôle y a droit, sinon statut initial.
create or replace function public.leads_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid; init uuid;
begin
  if tg_op = 'INSERT' then
    select id into init from public.statuses where org_id = new.org_id and is_initial;
    if new.status_id is null then
      new.status_id := init;
    elsif auth.uid() is not null and new.status_id is distinct from init
          and exists (select 1 from public.statuses s where s.id = new.status_id and s.org_id = new.org_id) then -- statut d'une autre org : la FK refuse
      rid := public.caller_role(new.org_id);
      if rid is null or not public.can_create_in_status(new.org_id, new.status_id, rid) then
        new.status_id := init;
      end if;
    end if;
    if auth.uid() is not null and new.custom <> '{}'::jsonb then
      perform public.validate_custom_write(new.org_id, '{}', new.custom);
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.created_by is distinct from old.created_by then
    raise exception 'immutable_lead_fields' using errcode = '42501';
  end if;
  new.updated_at := now();
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null
     and not exists (select 1 from public.memberships where org_id = new.org_id and user_id = new.assigned_to and status = 'active') then
    raise exception 'invalid_assignee' using errcode = 'P0001';
  end if;
  if new.custom is distinct from old.custom and auth.uid() is not null then
    perform public.validate_custom_write(new.org_id, old.custom, new.custom);
  end if;
  if new.status_id <> old.status_id and auth.uid() is not null
     and coalesce(current_setting('app.skip_transition', true), '') <> 'on' then
    select role_id into rid from public.memberships where org_id = new.org_id and user_id = auth.uid() and status = 'active';
    if rid is null or not public.can_transition(new.org_id, old.status_id, new.status_id, rid) then
      raise exception 'transition_forbidden' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Alimentation automatique : nouveau statut -> une ligne par rôle ; nouveau rôle -> une ligne par statut.
-- Un rôle créé par un non-super-admin hérite au plus des droits de son créateur (pas d'escalade).
create function public.grants_on_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.status_role_grants (org_id, status_id, role_id, can_place, can_create)
  select new.org_id, new.id, r.id, true, coalesce(r.system_key = 'administrator', false)
  from public.roles r where r.org_id = new.org_id and not r.is_admin
  on conflict do nothing;
  return new;
end;
$$;
create trigger statuses_grants after insert on public.statuses
  for each row execute function public.grants_on_status();

create function public.grants_on_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare cr uuid;
begin
  if new.is_admin then return new; end if;
  cr := case when auth.uid() is null or public.is_org_admin(new.org_id) then null else public.caller_role(new.org_id) end;
  insert into public.status_role_grants (org_id, status_id, role_id, can_place, can_create)
  select new.org_id, s.id, new.id,
    case when cr is null then true else coalesce(cg.can_place, false) end,
    case when cr is null then coalesce(new.system_key = 'administrator', false) else coalesce(cg.can_create, false) end
  from public.statuses s
  left join public.status_role_grants cg on cg.status_id = s.id and cg.role_id = cr
  where s.org_id = new.org_id
  on conflict do nothing;
  return new;
end;
$$;
create trigger roles_grants after insert on public.roles
  for each row execute function public.grants_on_role();

-- Garde-fou des droits de statut (hors cascades de triggers : profondeur 1).
create function public.grants_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare cr uuid; tkey text; tadmin boolean; ok boolean;
begin
  select system_key, is_admin into tkey, tadmin from public.roles where id = new.role_id;
  if tadmin then raise exception 'grants_super_admin' using errcode = '42501'; end if;
  if auth.uid() is null or pg_trigger_depth() > 1 or public.is_org_admin(new.org_id) then return new; end if;
  if tg_op = 'UPDATE' and (new.can_place, new.can_create) is not distinct from (old.can_place, old.can_create) then return new; end if;
  cr := public.caller_role(new.org_id);
  if cr is null then raise exception 'grants_forbidden' using errcode = '42501'; end if;
  -- ni son propre rôle, ni le rôle Administrateur : réservés au super administrateur
  if new.role_id = cr or tkey = 'administrator' then raise exception 'grants_locked_role' using errcode = '42501'; end if;
  if new.can_place and not (tg_op = 'UPDATE' and old.can_place) then
    select exists (select 1 from public.status_role_grants g where g.status_id = new.status_id and g.role_id = cr and g.can_place) into ok;
    if not ok then raise exception 'grants_escalation' using errcode = '42501'; end if;
  end if;
  if new.can_create and not (tg_op = 'UPDATE' and old.can_create)
     and not exists (select 1 from public.statuses s where s.id = new.status_id and s.is_initial) then
    select exists (select 1 from public.status_role_grants g where g.status_id = new.status_id and g.role_id = cr and g.can_create) into ok;
    if not ok then raise exception 'grants_escalation' using errcode = '42501'; end if;
  end if;
  return new;
end;
$$;
create trigger status_role_grants_guard before insert or update on public.status_role_grants
  for each row execute function public.grants_guard();

-- Remplacement atomique (SECURITY INVOKER : RLS + garde-fous s'appliquent).
-- grants = [{ "status": uuid, "role": uuid, "place": bool, "create": bool }]
create function public.save_status_grants(org uuid, grants jsonb) returns void
language plpgsql set search_path = public as $$
begin
  insert into public.status_role_grants (org_id, status_id, role_id, can_place, can_create)
  select org, (g ->> 'status')::uuid, (g ->> 'role')::uuid,
    coalesce((g ->> 'place')::boolean, false),
    coalesce((g ->> 'place')::boolean, false) and coalesce((g ->> 'create')::boolean, false)
  from jsonb_array_elements(coalesce(grants, '[]')) g
  on conflict (status_id, role_id) do update
    set can_place = excluded.can_place, can_create = excluded.can_create
    where status_role_grants.org_id = org
      and (status_role_grants.can_place, status_role_grants.can_create) is distinct from (excluded.can_place, excluded.can_create);
end;
$$;
revoke all on function public.save_status_grants(uuid, jsonb) from public, anon;
grant execute on function public.save_status_grants(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ 3) rôles : garde-fous anti-escalade
create or replace function public.roles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.is_system <> old.is_system or new.is_admin <> old.is_admin
     or new.system_key is distinct from old.system_key then
    raise exception 'role_immutable_fields' using errcode = '42501';
  end if;
  if old.is_system and new.name <> old.name then
    raise exception 'system_role_rename' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function public.roles_escalation_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare cr uuid; cperms text[]; added text[];
begin
  if auth.uid() is null or public.is_org_admin(new.org_id) then return new; end if;
  cr := public.caller_role(new.org_id);
  if cr is null then return new; end if; -- les politiques RLS refusent déjà les non-membres
  if new.is_admin or (tg_op = 'INSERT' and (new.system_key is not null or new.is_system)) then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.system_key = 'administrator' then
    raise exception 'administrator_role_locked' using errcode = '42501';
  end if;
  select permissions into cperms from public.roles where id = cr;
  added := array(select unnest(new.permissions) except select unnest(case when tg_op = 'UPDATE' then old.permissions else '{}'::text[] end));
  if tg_op = 'UPDATE' and new.id = cr and cardinality(added) > 0 then
    raise exception 'self_escalation' using errcode = '42501';
  end if;
  if not (added <@ cperms) then
    raise exception 'permission_escalation' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger roles_escalation before insert or update on public.roles
  for each row execute function public.roles_escalation_guard();

drop policy roles_insert on public.roles;
create policy roles_insert on public.roles for insert to authenticated
  with check (public.has_perm(org_id, 'roles.manage') and not is_system and not is_admin and system_key is null);
drop policy roles_update on public.roles;
create policy roles_update on public.roles for update to authenticated
  using (public.has_perm(org_id, 'roles.manage') and not is_admin
    and (system_key is distinct from 'administrator' or public.is_org_admin(org_id)))
  with check (public.has_perm(org_id, 'roles.manage') and not is_admin
    and (system_key is distinct from 'administrator' or public.is_org_admin(org_id)));

-- Affectation de rôle : un non-super-admin ne peut ni se changer de rôle, ni attribuer / retirer un rôle
-- qui dépasse le sien (permissions ou droits de statut). Les super admins restent gérés par les politiques.
create function public.memberships_escalation_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare cr uuid; o uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  o := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  if public.is_org_admin(o) then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and new.user_id = auth.uid() then return new; end if; -- création d'organisation
  if tg_op = 'UPDATE' and new.role_id = old.role_id then return new; end if;
  cr := public.caller_role(o);
  if cr is null then return coalesce(new, old); end if;
  if tg_op <> 'INSERT' and old.user_id = auth.uid() and (tg_op = 'DELETE' or new.role_id <> old.role_id) then
    raise exception 'self_role_change' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and not public.role_within(new.role_id, cr) then
    raise exception 'role_above_caller' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger memberships_escalation before insert or update or delete on public.memberships
  for each row execute function public.memberships_escalation_guard();

revoke all on function public.grants_on_status(), public.grants_on_role(), public.grants_guard(),
  public.roles_guard(), public.roles_escalation_guard(), public.memberships_escalation_guard()
  from public, anon, authenticated;

-- ------------------------------------------------------------ 4) données existantes
-- 4a) libérer les noms réservés
update public.roles set name = left(name, 28) || ' (perso)'
where not is_admin and system_key is null and name in ('Administrateur', 'Super administrateur');

-- 4b) le rôle is_admin devient « Super administrateur » (garde de renommage système levée le temps de la migration)
alter table public.roles disable trigger roles_guard;
update public.roles set name = 'Super administrateur', system_key = 'super_admin',
  description = 'Pouvoir total : programme les rôles, les permissions et les statuts de chaque rôle'
where is_admin and is_system;
alter table public.roles enable trigger roles_guard;

-- 4c) rôle système « Administrateur » dans chaque organisation
insert into public.roles (org_id, name, description, is_system, is_admin, system_key, permissions)
select o.id, 'Administrateur', 'Gère l''organisation dans la limite des droits accordés par le super administrateur', true, false, 'administrator',
  array['leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
    'statuses.manage','fields.manage','roles.manage','members.manage',
    'appointments.manage_all','appointments.manage_own','dashboard.view','settings.manage']
from public.organizations o
where not exists (select 1 from public.roles r where r.org_id = o.id and r.system_key = 'administrator');

-- 4d) droits de statut : tous les rôles non super-admin peuvent tout poser (comportement actuel conservé) ;
--     seul l'Administrateur crée aussi dans n'importe quel statut.
insert into public.status_role_grants (org_id, status_id, role_id, can_place, can_create)
select s.org_id, s.id, r.id, true, coalesce(r.system_key = 'administrator', false)
from public.statuses s join public.roles r on r.org_id = s.org_id and not r.is_admin
on conflict do nothing;

-- ------------------------------------------------------------ 5) création d'organisation
create or replace function public.create_organization(p_name text, p_template text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  org uuid;
  super_role uuid;
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

  insert into public.roles (org_id, name, description, is_system, is_admin, system_key, permissions)
  values (org, 'Super administrateur', 'Pouvoir total : programme les rôles, les permissions et les statuts de chaque rôle',
    true, true, 'super_admin', all_perms)
  returning id into super_role;

  insert into public.roles (org_id, name, description, is_system, system_key, permissions) values
    (org, 'Administrateur', 'Gère l''organisation dans la limite des droits accordés par le super administrateur', true, 'administrator',
      array['leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
        'statuses.manage','fields.manage','roles.manage','members.manage',
        'appointments.manage_all','appointments.manage_own','dashboard.view','settings.manage']);
  insert into public.roles (org_id, name, description, is_system, permissions) values
    (org, 'Prospecteur', 'Saisit et importe des leads, gère ses rendez-vous', true,
      array['leads.view_own','leads.create','leads.edit','leads.import','appointments.manage_own']),
    (org, 'Confirmateur', 'Qualifie les leads et planifie les rendez-vous', true,
      array['leads.view_all','leads.create','leads.edit','appointments.manage_all','dashboard.view']),
    (org, 'Commercial', 'Suit ses leads et ses rendez-vous', true,
      array['leads.view_own','leads.edit','appointments.manage_own']);

  insert into public.memberships (org_id, user_id, role_id, status)
  values (org, uid, super_role, 'active');

  perform public.apply_template(org, p_template);
  return org;
end;
$$;
