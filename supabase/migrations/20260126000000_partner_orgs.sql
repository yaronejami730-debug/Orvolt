-- Régies partenaires : une régie maître gère des sous-régies.
-- Une sous-régie est une ORGANISATION À PART (ses rôles, ses membres, ses leads), rattachée à la maître par parent_org_id.
--  * La sous-régie ne voit jamais rien de la maître : aucune membership, aucune politique ne la relie à elle.
--  * La maître voit tout chez ses sous-régies : ses administrateurs y reçoivent un accès automatique (memberships.via_parent),
--    sans consommer de place. Aucune règle de sécurité des leads / rendez-vous n'est modifiée.
--  * La maître paie tout : places et abonnement se lisent sur la maître (enforce_seat_limit, org_is_writable).
-- Profondeur maximale : 1 (une sous-régie ne gère pas de sous-régies).

alter table public.organizations
  add column parent_org_id uuid references public.organizations (id) on delete cascade,
  add column org_type text check (org_type in ('installer', 'agency')),
  add column onboarding jsonb not null default '{}' check (jsonb_typeof(onboarding) = 'object' and pg_column_size(onboarding) < 4000),
  add constraint organizations_not_own_parent check (parent_org_id is null or parent_org_id <> id);
create index organizations_parent_idx on public.organizations (parent_org_id) where parent_org_id is not null;
alter table public.memberships add column via_parent boolean not null default false;

create function public.organizations_depth_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.parent_org_id is not null then
    if exists (select 1 from public.organizations p where p.id = new.parent_org_id and p.parent_org_id is not null) then
      raise exception 'partner_depth' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.organizations c where c.parent_org_id = new.id) then
      raise exception 'partner_depth' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger organizations_depth before insert or update of parent_org_id on public.organizations
  for each row execute function public.organizations_depth_guard();

-- Facturation : la maître paie. Les places se comptent sur la maître + toutes ses sous-régies (accès via_parent exclus).
create or replace function public.enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; used int; bill uuid;
begin
  if new.status <> 'active' or new.via_parent then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.org_id = new.org_id and not old.via_parent then return new; end if;
  select coalesce(parent_org_id, id) into bill from public.organizations where id = new.org_id;
  select seat_limit into lim from public.organizations where id = bill for update;
  if lim is null then return new; end if;
  select count(*) into used from public.memberships m
    join public.organizations o on o.id = m.org_id
    where (o.id = bill or o.parent_org_id = bill) and m.status = 'active' and not m.via_parent and m.id <> new.id;
  if used >= lim then raise exception 'seat_limit_reached' using errcode = 'P0001'; end if;
  return new;
end;
$$;

create or replace function public.org_is_writable(org uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((select case o.subscription_status
      when 'active' then true
      when 'trialing' then coalesce(o.trial_ends_at, now()) > now()
      when 'past_due' then coalesce(o.past_due_since, now()) + interval '7 days' > now()
      else false end
    from public.organizations o
    where o.id = (select coalesce(c.parent_org_id, c.id) from public.organizations c where c.id = org)), false);
end;
$$;

-- Accès de la maître : chaque administrateur (rôle is_admin) de la maître est membre « via_parent » de chaque sous-régie.
create function public.sync_parent_access(p_parent uuid) returns void
language plpgsql security definer set search_path = public as $$
declare child record;
begin
  for child in select id from public.organizations where parent_org_id = p_parent loop
    insert into public.memberships (org_id, user_id, role_id, status, via_parent)
    select child.id, m.user_id, (select r.id from public.roles r where r.org_id = child.id and r.system_key = 'super_admin'), 'active', true
    from public.memberships m join public.roles r on r.id = m.role_id
    where m.org_id = p_parent and m.status = 'active' and r.is_admin and not m.via_parent
    on conflict (org_id, user_id) do nothing;
    begin
      delete from public.memberships x
      where x.org_id = child.id and x.via_parent
        and x.user_id not in (select m.user_id from public.memberships m join public.roles r on r.id = m.role_id
                              where m.org_id = p_parent and m.status = 'active' and r.is_admin and not m.via_parent);
    exception when others then null;   -- ne bloque jamais un changement côté maître (ex. dernier administrateur de la sous-régie)
    end;
  end loop;
end;
$$;

create function public.memberships_sync_partners() returns trigger
language plpgsql security definer set search_path = public as $$
declare org uuid := coalesce(new.org_id, old.org_id);
begin
  if not coalesce(new.via_parent, old.via_parent) and exists (select 1 from public.organizations where parent_org_id = org) then
    perform public.sync_parent_access(org);
  end if;
  return null;
end;
$$;
create trigger memberships_sync_partners after insert or update or delete on public.memberships
  for each row execute function public.memberships_sync_partners();

-- Création d'une sous-régie par un administrateur de la maître. Mêmes rôles que toute organisation ; modèle métier au choix.
create function public.create_partner_organization(p_parent uuid, p_name text, p_template text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); org uuid; base text; candidate text;
  all_perms text[] := array[
    'leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
    'statuses.manage','fields.manage','roles.manage','members.manage',
    'appointments.manage_all','appointments.manage_own','dashboard.view',
    'billing.manage','settings.manage','dispatch.manage'];
  super_role uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_org_admin(p_parent) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if exists (select 1 from public.organizations where id = p_parent and parent_org_id is not null) then raise exception 'partner_depth' using errcode = 'P0001'; end if;
  if not public.org_is_writable(p_parent) then raise exception 'org_read_only' using errcode = 'P0001'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) < 2 or char_length(p_name) > 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if p_template not in ('energie','btp','immobilier','auto','generic') then raise exception 'invalid_template' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext(p_parent::text));
  if (select count(*) from public.organizations where parent_org_id = p_parent) >= 50 then raise exception 'partner_limit' using errcode = 'P0001'; end if;

  base := btrim(regexp_replace(translate(lower(p_name), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', '-', 'g'), '-');
  if base = '' then base := 'org'; end if;
  candidate := base;
  while exists (select 1 from public.organizations where slug = candidate) loop
    candidate := base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  end loop;

  insert into public.organizations (name, slug, template, created_by, parent_org_id, org_type)
  values (p_name, candidate, p_template, uid, p_parent, 'agency') returning id into org;

  insert into public.roles (org_id, name, description, is_system, is_admin, system_key, permissions)
  values (org, 'Super administrateur', 'Pouvoir total : programme les rôles, les permissions et les statuts de chaque rôle', true, true, 'super_admin', all_perms)
  returning id into super_role;
  insert into public.roles (org_id, name, description, is_system, system_key, permissions) values
    (org, 'Administrateur', 'Gère l''organisation dans la limite des droits accordés par le super administrateur', true, 'administrator',
      array['leads.view_all','leads.view_own','leads.create','leads.edit','leads.delete','leads.import',
        'statuses.manage','fields.manage','roles.manage','members.manage',
        'appointments.manage_all','appointments.manage_own','dashboard.view','settings.manage','dispatch.manage']);
  insert into public.roles (org_id, name, description, is_system, permissions) values
    (org, 'Prospecteur', 'Saisit et importe des leads, gère ses rendez-vous', true,
      array['leads.view_own','leads.create','leads.edit','leads.import','appointments.manage_own']),
    (org, 'Confirmateur', 'Qualifie les leads et planifie les rendez-vous', true,
      array['leads.view_all','leads.create','leads.edit','appointments.manage_all','dashboard.view','dispatch.manage']),
    (org, 'Commercial', 'Suit ses leads et ses rendez-vous', true,
      array['leads.view_own','leads.edit','appointments.manage_own']);

  perform public.apply_template(org, p_template);
  perform public.sync_parent_access(p_parent);
  return org;
end;
$$;

-- Réponses de l'onboarding (type d'activité, organisation des équipes) : écrites par le super administrateur de l'organisation.
create function public.set_org_profile(p_org uuid, p_type text, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if p_type not in ('installer', 'agency') then raise exception 'invalid_type' using errcode = '22023'; end if;
  update public.organizations set org_type = p_type, onboarding = coalesce(p_answers, '{}'::jsonb) where id = p_org and parent_org_id is null;
end;
$$;

revoke all on function public.organizations_depth_guard(), public.sync_parent_access(uuid), public.memberships_sync_partners(),
  public.create_partner_organization(uuid, text, text), public.set_org_profile(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_partner_organization(uuid, text, text), public.set_org_profile(uuid, text, jsonb) to authenticated;
revoke all on function public.org_is_writable(uuid) from public, anon;
grant execute on function public.org_is_writable(uuid) to authenticated, service_role;

-- Accès déjà existants : rien à rattraper (aucune sous-régie n'existe encore).
