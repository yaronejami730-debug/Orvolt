-- S2 correctifs : triggers immuables par table, noms de source insensibles à la casse,
-- validation DB des actions auto, rôles de champs, fuites de définer, RPC atomiques.

-- 1) Gardes séparées (l'ancien trigger lisait new.type / new.key sur des tables sans ces colonnes).
drop trigger custom_fields_guard on public.custom_fields;
drop trigger lead_sources_guard on public.lead_sources;
drop trigger status_actions_guard on public.status_actions;
drop function public.immutable_org_guard();

create function public.immutable_org_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id then raise exception 'immutable_org' using errcode = '42501'; end if;
  return new;
end;
$$;
create function public.custom_fields_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id then raise exception 'immutable_org' using errcode = '42501'; end if;
  if new.type <> old.type or new.key <> old.key then raise exception 'immutable_field_type' using errcode = '42501'; end if;
  return new;
end;
$$;
create trigger custom_fields_guard before update on public.custom_fields
  for each row execute function public.custom_fields_guard();
create trigger lead_sources_guard before update on public.lead_sources
  for each row execute function public.immutable_org_guard();
create trigger status_actions_guard before update on public.status_actions
  for each row execute function public.immutable_org_guard();
create trigger status_transitions_org before update on public.status_transitions
  for each row execute function public.immutable_org_guard();

-- 2) Unicité des sources insensible à la casse.
create unique index lead_sources_name_ci on public.lead_sources (org_id, lower(name));

-- 3) Validation DB de la config des actions automatiques.
create function public.validate_status_action() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb := new.config; url text; host text; rid text; uid text;
begin
  if jsonb_typeof(c) <> 'object' or pg_column_size(c) >= 4000 then raise exception 'invalid_action_config' using errcode = '23514'; end if;

  if new.type = 'webhook' then
    url := c ->> 'url';
    if url is null or char_length(url) > 500 or url !~* '^https://[^/?#@\s]+([/?#].*)?$' then
      raise exception 'invalid_webhook_url' using errcode = '23514';
    end if;
    host := lower(substring(url from '^https://([^/?#:]+)'));
    if url ~* '^https://\[' or host is null or host = ''
       or host ~ '^[0-9.]+$' or host ~* '^0x' or host = 'localhost'
       or host ~ '\.(localhost|local|internal|localdomain|home|lan)$'
       or host = 'metadata' or host = 'metadata.google.internal' then
      raise exception 'invalid_webhook_url' using errcode = '23514';
    end if;
  elsif new.type = 'assign' then
    if c ->> 'mode' not in ('user', 'role') then raise exception 'invalid_action_config' using errcode = '23514'; end if;
  elsif new.type = 'notify' then
    if c ->> 'recipient' not in ('assignee', 'role', 'user')
       or char_length(coalesce(c ->> 'message', '')) not between 1 and 300 then
      raise exception 'invalid_action_config' using errcode = '23514';
    end if;
  elsif new.type = 'create_task' then
    if char_length(coalesce(c ->> 'title', '')) not between 1 and 120
       or c ->> 'unit' not in ('hours', 'days')
       or c ->> 'assignee' not in ('assignee', 'user')
       or (c ->> 'delay') !~ '^[0-9]{1,3}$' or (c ->> 'delay')::int > 365 then
      raise exception 'invalid_action_config' using errcode = '23514';
    end if;
  end if;

  rid := c ->> 'roleId';
  uid := c ->> 'userId';
  if rid is not null then
    if rid !~* '^[0-9a-f-]{36}$' or not exists (select 1 from public.roles where id = rid::uuid and org_id = new.org_id) then
      raise exception 'invalid_action_target' using errcode = '23514';
    end if;
  end if;
  if uid is not null then
    if uid !~* '^[0-9a-f-]{36}$' or not exists (select 1 from public.memberships where user_id = uid::uuid and org_id = new.org_id) then
      raise exception 'invalid_action_target' using errcode = '23514';
    end if;
  end if;
  if new.type = 'assign' and ((c ->> 'mode' = 'user' and uid is null) or (c ->> 'mode' = 'role' and rid is null)) then
    raise exception 'invalid_action_config' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger status_actions_validate before insert or update on public.status_actions
  for each row execute function public.validate_status_action();

-- 4) Rôles de visibilité / édition d'un champ : doivent appartenir à l'org.
create function public.validate_field_roles() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[] := coalesce(new.visible_roles, '{}') || coalesce(new.editable_roles, '{}');
begin
  if cardinality(ids) > 0 and (select count(distinct r.id) from public.roles r where r.org_id = new.org_id and r.id = any (ids))
       <> (select count(distinct x) from unnest(ids) x) then
    raise exception 'invalid_field_roles' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger custom_fields_roles before insert or update on public.custom_fields
  for each row execute function public.validate_field_roles();

revoke all on function public.validate_status_action(), public.validate_field_roles(),
  public.custom_fields_guard(), public.immutable_org_guard() from public, anon, authenticated;

-- 5) Aucune fuite pour une org dont l'appelant n'est pas membre (appels serveur sans JWT conservés).
create or replace function public.org_has_leads(org uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r boolean;
begin
  if auth.uid() is not null and not public.is_org_member(org) then return false; end if;
  if to_regclass('public.leads') is null then return false; end if;
  execute 'select exists (select 1 from public.leads where org_id = $1)' into r using org;
  return coalesce(r, false);
end;
$$;

create or replace function public.can_transition(org uuid, from_status uuid, to_status uuid, role uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or public.is_org_member(org)) and exists (
    select 1 from public.statuses f, public.statuses t
    where f.id = from_status and t.id = to_status and f.org_id = org and t.org_id = org
      and f.id <> t.id and f.kind = 'normal'
      and (
        exists (select 1 from public.roles r where r.id = role and r.org_id = org and r.is_admin)
        or exists (select 1 from public.status_transitions st
          where st.org_id = org and st.from_status_id = from_status and st.to_status_id = to_status
            and (st.role_id is null or st.role_id = role))
      ));
$$;

-- 6) Remplacements atomiques (SECURITY INVOKER : RLS et triggers s'appliquent).
-- targets = [{ "to": uuid, "roles": [uuid] | null }]
create function public.save_transitions(org uuid, from_status uuid, targets jsonb) returns void
language plpgsql set search_path = public as $$
declare t jsonb; rid text;
begin
  delete from public.status_transitions where org_id = org and from_status_id = from_status;
  for t in select * from jsonb_array_elements(coalesce(targets, '[]')) loop
    if t -> 'roles' is null or jsonb_typeof(t -> 'roles') = 'null' then
      insert into public.status_transitions (org_id, from_status_id, to_status_id, role_id)
      values (org, from_status, (t ->> 'to')::uuid, null);
    else
      for rid in select * from jsonb_array_elements_text(t -> 'roles') loop
        insert into public.status_transitions (org_id, from_status_id, to_status_id, role_id)
        values (org, from_status, (t ->> 'to')::uuid, rid::uuid);
      end loop;
    end if;
  end loop;
end;
$$;

-- actions = [{ "type", "config", "enabled" }]
create function public.save_status_actions(org uuid, status uuid, actions jsonb) returns void
language plpgsql set search_path = public as $$
begin
  delete from public.status_actions where org_id = org and status_id = status;
  insert into public.status_actions (org_id, status_id, type, config, enabled, position)
  select org, status, a ->> 'type', coalesce(a -> 'config', '{}'), coalesce((a ->> 'enabled')::boolean, true), (o - 1)::int
  from jsonb_array_elements(coalesce(actions, '[]')) with ordinality as x(a, o);
end;
$$;
revoke all on function public.save_transitions(uuid, uuid, jsonb), public.save_status_actions(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_transitions(uuid, uuid, jsonb), public.save_status_actions(uuid, uuid, jsonb) to authenticated;
