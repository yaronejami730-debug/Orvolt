-- S2 : statuts, transitions, actions auto, champs custom, sources de leads.

-- ------------------------------------------------------------ tables
create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  position int not null default 0,
  kind text not null default 'normal' check (kind in ('normal','won','lost')),
  is_initial boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id),
  check (not (is_initial and kind <> 'normal'))
);
-- Un seul statut initial par organisation.
create unique index statuses_one_initial on public.statuses (org_id) where is_initial;

-- role_id null = tous les rôles. Un statut final n'a pas de transition sortante (trigger).
create table public.status_transitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  from_status_id uuid not null,
  to_status_id uuid not null,
  role_id uuid,
  check (from_status_id <> to_status_id),
  foreign key (from_status_id, org_id) references public.statuses (id, org_id) on delete cascade,
  foreign key (to_status_id, org_id) references public.statuses (id, org_id) on delete cascade,
  foreign key (role_id, org_id) references public.roles (id, org_id) on delete cascade
);
create unique index status_transitions_uniq on public.status_transitions
  (from_status_id, to_status_id, coalesce(role_id, '00000000-0000-0000-0000-000000000000'));

create table public.status_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  status_id uuid not null,
  type text not null check (type in ('assign','notify','create_task','webhook')),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 4000),
  position int not null default 0,
  enabled boolean not null default true,
  foreign key (status_id, org_id) references public.statuses (id, org_id) on delete cascade
);

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  type text not null check (type in ('text','number','date','select','file','address')),
  options jsonb not null default '{}' check (jsonb_typeof(options) = 'object' and pg_column_size(options) < 8000),
  required boolean not null default false,
  position int not null default 0,
  visible_roles uuid[],   -- null = tous les rôles, '{}' = masqué
  editable_roles uuid[],  -- null = tous les rôles
  created_at timestamptz not null default now(),
  unique (org_id, key),
  unique (org_id, label)
);

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  is_default boolean not null default false,
  is_system boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create index statuses_org_idx on public.statuses (org_id, position);
create index status_actions_status_idx on public.status_actions (status_id, position);
create index custom_fields_org_idx on public.custom_fields (org_id, position);
create index status_transitions_org_idx on public.status_transitions (org_id);

-- ------------------------------------------------------------ triggers
create function public.transition_guard() returns trigger
language plpgsql set search_path = public as $$
declare k text;
begin
  select kind into k from public.statuses where id = new.from_status_id;
  if k is distinct from 'normal' then raise exception 'final_status_no_outgoing' using errcode = 'P0001'; end if;
  return new;
end;
$$;
create trigger status_transitions_guard before insert or update on public.status_transitions
  for each row execute function public.transition_guard();

-- Un statut devenant final perd ses transitions sortantes ; org_id/ids immuables.
create function public.statuses_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id then raise exception 'immutable_org' using errcode = '42501'; end if;
  if new.kind <> 'normal' and old.kind = 'normal' then
    delete from public.status_transitions where from_status_id = new.id;
  end if;
  return new;
end;
$$;
create trigger statuses_guard before update on public.statuses
  for each row execute function public.statuses_guard();

create function public.immutable_org_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id then raise exception 'immutable_org' using errcode = '42501'; end if;
  if tg_table_name = 'custom_fields' and (new.type <> old.type or new.key <> old.key) then
    raise exception 'immutable_field_type' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger custom_fields_guard before update on public.custom_fields
  for each row execute function public.immutable_org_guard();
create trigger lead_sources_guard before update on public.lead_sources
  for each row execute function public.immutable_org_guard();
create trigger status_actions_guard before update on public.status_actions
  for each row execute function public.immutable_org_guard();

-- Sources système : non supprimables ni renommables par un client.
create function public.sources_system_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if; -- service_role / fonctions serveur
  if tg_op = 'DELETE' then
    if old.is_system then raise exception 'system_source' using errcode = '42501'; end if;
    return old;
  end if;
  if old.is_system and (new.name <> old.name or new.is_system <> old.is_system) then
    raise exception 'system_source' using errcode = '42501';
  end if;
  if new.is_system <> old.is_system then raise exception 'system_source' using errcode = '42501'; end if;
  return new;
end;
$$;
create trigger lead_sources_system before update or delete on public.lead_sources
  for each row execute function public.sources_system_guard();

-- ------------------------------------------------------------ fonctions
-- Transition autorisée ? Rôle admin : toujours (hors statut final). Sinon ligne explicite (role_id null = tous).
create function public.can_transition(org uuid, from_status uuid, to_status uuid, role uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
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
revoke all on function public.can_transition(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.can_transition(uuid, uuid, uuid, uuid) to authenticated, service_role;

-- Vrai si l'org possède des leads (la table arrive en S3).
create function public.org_has_leads(org uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r boolean;
begin
  if to_regclass('public.leads') is null then return false; end if;
  execute 'select exists (select 1 from public.leads where org_id = $1)' into r using org;
  return coalesce(r, false);
end;
$$;
revoke all on function public.org_has_leads(uuid) from public, anon;
grant execute on function public.org_has_leads(uuid) to authenticated, service_role;

-- Changer le statut initial atomiquement.
create function public.set_initial_status(org uuid, status uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm(org, 'statuses.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.statuses where id = status and org_id = org and kind = 'normal') then
    raise exception 'invalid_initial' using errcode = '22023';
  end if;
  update public.statuses set is_initial = false where org_id = org and is_initial and id <> status;
  update public.statuses set is_initial = true where id = status and org_id = org;
end;
$$;

create function public.reorder_statuses(org uuid, ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm(org, 'statuses.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.statuses s set position = o.ord - 1
  from unnest(ids) with ordinality as o(id, ord) where s.id = o.id and s.org_id = org;
end;
$$;

create function public.reorder_fields(org uuid, ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm(org, 'fields.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.custom_fields s set position = o.ord - 1
  from unnest(ids) with ordinality as o(id, ord) where s.id = o.id and s.org_id = org;
end;
$$;
revoke all on function public.set_initial_status(uuid, uuid), public.reorder_statuses(uuid, uuid[]),
  public.reorder_fields(uuid, uuid[]) from public, anon;
grant execute on function public.set_initial_status(uuid, uuid), public.reorder_statuses(uuid, uuid[]),
  public.reorder_fields(uuid, uuid[]) to authenticated, service_role;

-- Application d'un template (appelée par le serveur, service_role). Atomique et idempotente :
-- remplace statuts, champs et sources de l'org. Refuse si l'org a des leads.
-- payload = { statuses:[{key,name,color,kind,initial}], transitions:[{from,to,roles:[uuid]|null}],
--   actions:[{status,type,config,enabled}], fields:[{key,label,type,options,required,visible_roles,editable_roles}],
--   sources:[{name,color,is_default,is_system}] }
create function public.apply_template_payload(org uuid, payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb; t jsonb; a jsonb; f jsonb; src jsonb; ids jsonb := '{}'; sid uuid; i int := 0; rid text; pos int;
begin
  if not exists (select 1 from public.organizations where id = org) then raise exception 'unknown_org' using errcode = '22023'; end if;
  perform 1 from public.organizations where id = org for update;
  if public.org_has_leads(org) then raise exception 'org_has_leads' using errcode = 'P0001'; end if;
  delete from public.statuses where org_id = org;
  delete from public.custom_fields where org_id = org;
  delete from public.lead_sources where org_id = org;

  for s in select * from jsonb_array_elements(coalesce(payload -> 'statuses', '[]')) loop
    insert into public.statuses (org_id, name, color, kind, is_initial, position)
    values (org, s ->> 'name', s ->> 'color', coalesce(s ->> 'kind', 'normal'), coalesce((s ->> 'initial')::boolean, false), i)
    returning id into sid;
    ids := ids || jsonb_build_object(s ->> 'key', sid);
    i := i + 1;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(payload -> 'transitions', '[]')) loop
    if t -> 'roles' is null or jsonb_typeof(t -> 'roles') = 'null' then
      insert into public.status_transitions (org_id, from_status_id, to_status_id, role_id)
      values (org, (ids ->> (t ->> 'from'))::uuid, (ids ->> (t ->> 'to'))::uuid, null);
    else
      for rid in select * from jsonb_array_elements_text(t -> 'roles') loop
        insert into public.status_transitions (org_id, from_status_id, to_status_id, role_id)
        values (org, (ids ->> (t ->> 'from'))::uuid, (ids ->> (t ->> 'to'))::uuid, rid::uuid);
      end loop;
    end if;
  end loop;

  pos := 0;
  for a in select * from jsonb_array_elements(coalesce(payload -> 'actions', '[]')) loop
    insert into public.status_actions (org_id, status_id, type, config, position, enabled)
    values (org, (ids ->> (a ->> 'status'))::uuid, a ->> 'type', coalesce(a -> 'config', '{}'), pos, coalesce((a ->> 'enabled')::boolean, true));
    pos := pos + 1;
  end loop;

  i := 0;
  for f in select * from jsonb_array_elements(coalesce(payload -> 'fields', '[]')) loop
    insert into public.custom_fields (org_id, key, label, type, options, required, position, visible_roles, editable_roles)
    values (org, f ->> 'key', f ->> 'label', f ->> 'type', coalesce(f -> 'options', '{}'), coalesce((f ->> 'required')::boolean, false), i,
      case when f -> 'visible_roles' is null or jsonb_typeof(f -> 'visible_roles') = 'null' then null
        else array(select jsonb_array_elements_text(f -> 'visible_roles'))::uuid[] end,
      case when f -> 'editable_roles' is null or jsonb_typeof(f -> 'editable_roles') = 'null' then null
        else array(select jsonb_array_elements_text(f -> 'editable_roles'))::uuid[] end);
    i := i + 1;
  end loop;

  for src in select * from jsonb_array_elements(coalesce(payload -> 'sources', '[]')) loop
    insert into public.lead_sources (org_id, name, color, is_default, is_system)
    values (org, src ->> 'name', src ->> 'color', coalesce((src ->> 'is_default')::boolean, false), coalesce((src ->> 'is_system')::boolean, false));
  end loop;
end;
$$;
revoke all on function public.apply_template_payload(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_template_payload(uuid, jsonb) to service_role;

revoke all on function public.transition_guard(), public.statuses_guard(), public.immutable_org_guard(),
  public.sources_system_guard() from public, anon, authenticated;

-- ------------------------------------------------------------ RLS
alter table public.statuses enable row level security;
alter table public.statuses force row level security;
alter table public.status_transitions enable row level security;
alter table public.status_transitions force row level security;
alter table public.status_actions enable row level security;
alter table public.status_actions force row level security;
alter table public.custom_fields enable row level security;
alter table public.custom_fields force row level security;
alter table public.lead_sources enable row level security;
alter table public.lead_sources force row level security;

revoke all on public.statuses, public.status_transitions, public.status_actions, public.custom_fields, public.lead_sources from anon, authenticated;
grant select, insert, update, delete on public.statuses, public.status_transitions, public.status_actions,
  public.custom_fields, public.lead_sources to authenticated;

do $$
declare t text; perm text;
begin
  for t, perm in values ('statuses','statuses.manage'), ('status_transitions','statuses.manage'),
    ('status_actions','statuses.manage'), ('custom_fields','fields.manage'), ('lead_sources','settings.manage') loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_perm(org_id, %L))', t || '_insert', t, perm);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_perm(org_id, %L)) with check (public.has_perm(org_id, %L))', t || '_update', t, perm, perm);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_perm(org_id, %L))', t || '_delete', t, perm);
  end loop;
end $$;
