-- S3 correctifs : champs custom par rôle (écriture + lecture), statut initial à l'INSERT,
-- suivi des champs natifs, chemin de fichier sûr, version du secret webhook.

alter table public.organizations add column webhook_secret_version int not null default 1 check (webhook_secret_version >= 1);
alter table public.lead_files add constraint lead_files_path_safe
  check (path !~ '(^|/)\.\.(/|$)' and position(chr(92) in path) = 0 and path not like '/%');

-- ------------------------------------------------------------ champs custom : écriture contrôlée en base
create function public.validate_custom_write(p_org uuid, p_old jsonb, p_new jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare rid uuid; adm boolean; k text; v jsonb; f public.custom_fields; t text; num numeric; ok boolean;
begin
  select m.role_id, r.is_admin into rid, adm
    from public.memberships m join public.roles r on r.id = m.role_id
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active';
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  p_old := coalesce(p_old, '{}'); p_new := coalesce(p_new, '{}');
  for k in
    select key from jsonb_each(p_new) where p_old -> key is distinct from value
    union
    select key from jsonb_each(p_old) where not (p_new ? key)
  loop
    select * into f from public.custom_fields where org_id = p_org and key = k;
    if not found then
      if p_new ? k then raise exception 'unknown_custom_field' using errcode = 'P0001'; end if;
      continue; -- clé orpheline : suppression tolérée
    end if;
    if not adm and not ((f.visible_roles is null or rid = any (f.visible_roles))
                        and (f.editable_roles is null or rid = any (f.editable_roles))) then
      raise exception 'custom_field_forbidden' using errcode = '42501';
    end if;
    if not (p_new ? k) then continue; end if;
    v := p_new -> k;
    t := jsonb_typeof(v);
    ok := case f.type
      when 'number' then t = 'number'
      when 'text' then t = 'string' and char_length(v #>> '{}') <= 2000
      when 'address' then t = 'string' and char_length(v #>> '{}') <= 300
      when 'date' then t = 'string' and (v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      when 'file' then t = 'string' and (v #>> '{}') ~* '^[0-9a-f-]{36}$'
      when 'select' then
        (t = 'string' and (f.options -> 'choices') ? (v #>> '{}'))
        or (t = 'array' and coalesce((f.options ->> 'multiple')::boolean, false)
            and not exists (select 1 from jsonb_array_elements_text(v) e where not ((f.options -> 'choices') ? e)))
      else false end;
    if not coalesce(ok, false) then raise exception 'invalid_custom_value' using errcode = '22023'; end if;
    if f.type = 'number' then
      num := (v #>> '{}')::numeric;
      if (f.options ->> 'min') is not null and num < (f.options ->> 'min')::numeric then raise exception 'invalid_custom_value' using errcode = '22023'; end if;
      if (f.options ->> 'max') is not null and num > (f.options ->> 'max')::numeric then raise exception 'invalid_custom_value' using errcode = '22023'; end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.validate_custom_write(uuid, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.leads_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid; init uuid;
begin
  if tg_op = 'INSERT' then
    -- Les clients (hors admin) créent toujours dans le statut initial ; service_role / admin choisissent.
    if new.status_id is null or (auth.uid() is not null and not public.is_org_admin(new.org_id)) then
      select id into init from public.statuses where org_id = new.org_id and is_initial;
      new.status_id := init;
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

-- Suivi des champs natifs dans l'historique (field_changed).
create or replace function public.leads_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare fn text; tn text; changed text[] := '{}'; nat text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform public.log_lead_event(new.org_id, new.id, 'created', jsonb_build_object('status_id', new.status_id));
    return new;
  end if;
  if new.status_id <> old.status_id then
    select name into fn from public.statuses where id = old.status_id;
    select name into tn from public.statuses where id = new.status_id;
    perform public.log_lead_event(new.org_id, new.id, 'status_changed',
      jsonb_build_object('from', old.status_id, 'to', new.status_id, 'from_name', fn, 'to_name', tn));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    perform public.log_lead_event(new.org_id, new.id, 'assigned', jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;
  if new.custom is distinct from old.custom then
    select coalesce(array_agg(k), '{}') into changed from (
      select k from jsonb_object_keys(new.custom) k where new.custom -> k is distinct from old.custom -> k
      union select k from jsonb_object_keys(old.custom) k where new.custom -> k is distinct from old.custom -> k) s;
  end if;
  if new.first_name is distinct from old.first_name then nat := array_append(nat, 'first_name'::text); end if;
  if new.last_name is distinct from old.last_name then nat := array_append(nat, 'last_name'::text); end if;
  if new.company is distinct from old.company then nat := array_append(nat, 'company'::text); end if;
  if new.email is distinct from old.email then nat := array_append(nat, 'email'::text); end if;
  if new.phone is distinct from old.phone then nat := array_append(nat, 'phone'::text); end if;
  if new.address is distinct from old.address then nat := array_append(nat, 'address'::text); end if;
  if new.city is distinct from old.city then nat := array_append(nat, 'city'::text); end if;
  if new.postal_code is distinct from old.postal_code then nat := array_append(nat, 'postal_code'::text); end if;
  if new.value is distinct from old.value then nat := array_append(nat, 'value'::text); end if;
  if new.source_id is distinct from old.source_id then nat := array_append(nat, 'source_id'::text); end if;
  if cardinality(changed) > 0 or cardinality(nat) > 0 then
    perform public.log_lead_event(new.org_id, new.id, 'field_changed', jsonb_build_object('keys', to_jsonb(changed), 'native', to_jsonb(nat)));
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------ lecture : colonne custom masquée par rôle
create function public.mask_custom(p_org uuid, c jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (
    select m.role_id, r.is_admin from public.memberships m join public.roles r on r.id = m.role_id
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active')
  select coalesce(jsonb_object_agg(e.key, e.value), '{}')
  from jsonb_each(coalesce(c, '{}')) e, me
  where me.is_admin or exists (
    select 1 from public.custom_fields f
    where f.org_id = p_org and f.key = e.key and (f.visible_roles is null or me.role_id = any (f.visible_roles)));
$$;
revoke all on function public.mask_custom(uuid, jsonb) from public, anon;
grant execute on function public.mask_custom(uuid, jsonb) to authenticated;

-- La table de base n'expose plus `custom` en lecture aux clients ; ils passent par leads_api.
revoke select on public.leads from authenticated;
grant select (id, org_id, status_id, source_id, assigned_to, first_name, last_name, company, email, phone, address, city,
  postal_code, lat, lng, value, created_by, position, archived_at, created_at, updated_at, search_text)
  on public.leads to authenticated;

create view public.leads_api as
select l.id, l.org_id, l.status_id, l.source_id, l.assigned_to, l.first_name, l.last_name, l.company, l.email, l.phone,
  l.address, l.city, l.postal_code, l.lat, l.lng, l.value, public.mask_custom(l.org_id, l.custom) as custom,
  l.created_by, l.position, l.archived_at, l.created_at, l.updated_at, l.search_text
from public.leads l
where public.is_org_member(l.org_id) and (public.has_perm(l.org_id, 'leads.view_all')
  or (public.has_perm(l.org_id, 'leads.view_own') and (l.assigned_to = auth.uid() or l.created_by = auth.uid())));
revoke all on public.leads_api from anon, authenticated;
grant select on public.leads_api to authenticated;

-- Fusion atomique de champs custom (sans jamais exposer les clés masquées au client).
create function public.patch_lead_custom(p_lead uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  select org_id into oid from public.leads_api where id = p_lead;
  if not found then raise exception 'lead_not_found' using errcode = 'P0002'; end if;
  if not public.has_perm(oid, 'leads.edit') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.leads set custom =
    (coalesce(custom, '{}') || coalesce((select jsonb_object_agg(key, value) from jsonb_each(p_patch) where jsonb_typeof(value) <> 'null'), '{}'))
    - coalesce(array(select key from jsonb_each(p_patch) where jsonb_typeof(value) = 'null'), '{}')
  where id = p_lead;
end;
$$;
revoke all on function public.patch_lead_custom(uuid, jsonb) from public, anon;
grant execute on function public.patch_lead_custom(uuid, jsonb) to authenticated;

-- move_lead : ne lit plus la colonne custom (non accordée en lecture sur la table de base).
create or replace function public.move_lead(p_lead uuid, p_to uuid, p_position double precision default null) returns jsonb
language plpgsql set search_path = public as $$
declare l_org uuid; l_status uuid; ev uuid; acts jsonb := '[]'; changed boolean;
begin
  select org_id, status_id into l_org, l_status from public.leads where id = p_lead;
  if not found then raise exception 'lead_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.statuses where id = p_to and org_id = l_org) then
    raise exception 'status_not_found' using errcode = 'P0002';
  end if;
  changed := l_status <> p_to;
  update public.leads set status_id = p_to, position = coalesce(p_position, position) where id = p_lead;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if changed then
    select id into ev from public.lead_events where lead_id = p_lead and type = 'status_changed' order by created_at desc limit 1;
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'config', a.config, 'position', a.position) order by a.position), '[]')
      into acts from public.status_actions a where a.status_id = p_to and a.org_id = l_org and a.enabled;
  end if;
  return jsonb_build_object('lead_id', p_lead, 'org_id', l_org, 'changed', changed, 'from_status_id', l_status,
    'to_status_id', p_to, 'event_id', ev, 'actions', acts);
end;
$$;
