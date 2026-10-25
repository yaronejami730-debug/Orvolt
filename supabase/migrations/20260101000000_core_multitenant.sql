-- LeadForge S1 : multi-tenant, rôles, permissions.
--
-- Catalogue de permissions (miroir de src/lib/permissions.ts) :
--   leads.view_all, leads.view_own, leads.create, leads.edit, leads.delete, leads.import,
--   statuses.manage, fields.manage, roles.manage, members.manage,
--   appointments.manage_all, appointments.manage_own, dashboard.view,
--   billing.manage, settings.manage

-- ---------------------------------------------------------------- tables
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique,
  template text not null default 'generic'
    check (template in ('energie','btp','immobilier','auto','generic')),
  plan text not null default 'trial',
  subscription_status text not null default 'trialing',
  trial_ends_at timestamptz default (now() + interval '14 days'),
  seat_limit int default 5 check (seat_limit is null or seat_limit >= 0),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  description text,
  is_system boolean not null default false,
  is_admin boolean not null default false,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id),
  constraint roles_permissions_known check (permissions <@ array[
    'leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
    'statuses.manage','fields.manage','roles.manage','members.manage',
    'appointments.manage_all','appointments.manage_own','dashboard.view',
    'billing.manage','settings.manage']::text[])
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  foreign key (role_id, org_id) references public.roles (id, org_id) on delete restrict
);
create index memberships_user_idx on public.memberships (user_id);
create index memberships_role_idx on public.memberships (role_id);

-- ---------------------------------------------------------------- fonctions d'autorisation
create function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
    where m.org_id = org and m.user_id = auth.uid() and m.status = 'active');
$$;

create function public.has_perm(org uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.org_id = org and m.user_id = auth.uid() and m.status = 'active'
      and (r.is_admin or perm = any (r.permissions)));
$$;

create function public.is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.org_id = org and m.user_id = auth.uid() and m.status = 'active' and r.is_admin);
$$;

create function public.shares_org_with(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships a
    join public.memberships b on b.org_id = a.org_id
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = uid);
$$;

create function public.role_is_admin(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.roles where id = rid), false);
$$;

revoke all on function public.is_org_member(uuid), public.has_perm(uuid, text),
  public.is_org_admin(uuid), public.shares_org_with(uuid), public.role_is_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid), public.has_perm(uuid, text),
  public.is_org_admin(uuid), public.shares_org_with(uuid), public.role_is_admin(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------- triggers
-- Profil créé automatiquement à l'inscription.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rôles : champs structurels immuables.
create function public.roles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.is_system <> old.is_system or new.is_admin <> old.is_admin then
    raise exception 'role_immutable_fields' using errcode = '42501';
  end if;
  if old.is_system and new.name <> old.name then
    raise exception 'system_role_rename' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger roles_guard before update on public.roles
  for each row execute function public.roles_guard();

-- Quota de sièges : refuse une membership active au-delà de seat_limit (null = illimité).
create function public.enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; used int;
begin
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.org_id = new.org_id then return new; end if;
  select seat_limit into lim from public.organizations where id = new.org_id for update;
  if lim is null then return new; end if;
  select count(*) into used from public.memberships
    where org_id = new.org_id and status = 'active' and id <> new.id;
  if used >= lim then
    raise exception 'seat_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger memberships_seat_limit before insert or update on public.memberships
  for each row execute function public.enforce_seat_limit();

-- ---------------------------------------------------------------- RLS
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.roles enable row level security;
alter table public.roles force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- Droits de table : tout retiré, puis ré-accordé au strict nécessaire.
revoke all on public.organizations, public.profiles, public.roles, public.memberships from anon, authenticated;
grant select on public.organizations, public.profiles, public.roles, public.memberships to authenticated;
-- Colonnes billing (plan, subscription_status, stripe_*, seat_limit, trial_ends_at) : service_role uniquement.
grant update (name) on public.organizations to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant insert, update, delete on public.roles to authenticated;
grant insert, update, delete on public.memberships to authenticated;

create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy roles_select on public.roles for select to authenticated
  using (public.is_org_member(org_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (public.has_perm(org_id, 'roles.manage') and not is_system and not is_admin);
create policy roles_update on public.roles for update to authenticated
  using (public.has_perm(org_id, 'roles.manage') and not is_admin)
  with check (public.has_perm(org_id, 'roles.manage') and not is_admin);
create policy roles_delete on public.roles for delete to authenticated
  using (public.has_perm(org_id, 'roles.manage') and not is_system);

create policy memberships_select on public.memberships for select to authenticated
  using (public.is_org_member(org_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_perm(org_id, 'members.manage')
    and (not public.role_is_admin(role_id) or public.is_org_admin(org_id)));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_perm(org_id, 'members.manage')
    and (not public.role_is_admin(role_id) or public.is_org_admin(org_id)))
  with check (public.has_perm(org_id, 'members.manage')
    and (not public.role_is_admin(role_id) or public.is_org_admin(org_id)));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_perm(org_id, 'members.manage')
    and (not public.role_is_admin(role_id) or public.is_org_admin(org_id)));

-- ---------------------------------------------------------------- templates (stub S2) + création d'org
create function public.apply_template(org uuid, template text) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Sprint S2 : statuts, champs custom et sources par métier.
  null;
end;
$$;
revoke all on function public.apply_template(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_template(uuid, text) to service_role;

create function public.create_organization(p_name text, p_template text) returns uuid
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
revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated, service_role;
