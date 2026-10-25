-- S3 : leads, historique, notes, appels, fichiers, tâches, notifications, journal d'actions auto.

create extension if not exists pg_trgm with schema extensions;

alter table public.lead_sources add constraint lead_sources_id_org unique (id, org_id);

-- ------------------------------------------------------------ leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  status_id uuid not null,
  source_id uuid,
  assigned_to uuid,
  first_name text not null default '' check (char_length(first_name) <= 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  company text check (char_length(company) <= 120),
  email text check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 40),
  address text check (char_length(address) <= 300),
  city text check (char_length(city) <= 100),
  postal_code text check (char_length(postal_code) <= 12),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  value numeric(12, 2) check (value >= 0),
  custom jsonb not null default '{}' check (jsonb_typeof(custom) = 'object' and pg_column_size(custom) < 20000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  position double precision not null default extract(epoch from clock_timestamp()),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(company, '') || ' ' ||
          coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(city, ''))
  ) stored,
  unique (id, org_id),
  check (first_name <> '' or last_name <> '' or company is not null),
  foreign key (status_id, org_id) references public.statuses (id, org_id) on delete restrict,
  foreign key (source_id, org_id) references public.lead_sources (id, org_id) on delete restrict,
  foreign key (org_id, assigned_to) references public.memberships (org_id, user_id) on delete set null (assigned_to)
);
create index leads_org_status_idx on public.leads (org_id, status_id, position);
create index leads_org_assigned_idx on public.leads (org_id, assigned_to);
create index leads_org_created_idx on public.leads (org_id, created_at desc);
create index leads_org_source_idx on public.leads (org_id, source_id);
create index leads_search_idx on public.leads using gin (search_text extensions.gin_trgm_ops);

-- ------------------------------------------------------------ tables liées
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lead_id uuid not null,
  type text not null check (type in ('created','status_changed','assigned','note','call','appointment','field_changed','file','action_executed')),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 8000),
  actor_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade
);
create index lead_events_lead_idx on public.lead_events (lead_id, created_at desc);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lead_id uuid not null,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade
);
create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

create table public.lead_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lead_id uuid not null,
  caller_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  outcome text not null check (outcome in ('answered','no_answer','voicemail','busy','wrong_number','callback')),
  duration_seconds int not null default 0 check (duration_seconds between 0 and 86400),
  notes text check (char_length(notes) <= 2000),
  called_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade
);
create index lead_calls_lead_idx on public.lead_calls (lead_id, called_at desc);

create table public.lead_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lead_id uuid not null,
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null unique,
  name text not null check (char_length(name) between 1 and 200),
  size_bytes int not null check (size_bytes between 0 and 10485760),
  mime_type text not null check (char_length(mime_type) <= 100),
  created_at timestamptz not null default now(),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade,
  check (path like org_id::text || '/' || lead_id::text || '/%')
);
create index lead_files_lead_idx on public.lead_files (lead_id, created_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid,
  assigned_to uuid,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_at timestamptz,
  done boolean not null default false,
  done_at timestamptz,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade,
  foreign key (org_id, assigned_to) references public.memberships (org_id, user_id) on delete set null (assigned_to)
);
create index tasks_assignee_idx on public.tasks (assigned_to, done, due_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (char_length(type) <= 40),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 4000),
  read_at timestamptz,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create table public.action_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  status_id uuid,
  lead_id uuid,
  action_id uuid,
  type text not null,
  result text not null default 'pending' check (result in ('pending','success','failed','skipped')),
  error text check (char_length(error) <= 1000),
  attempts int not null default 0,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade
);
create index action_runs_lead_idx on public.action_runs (lead_id, created_at desc);

-- ------------------------------------------------------------ helpers / triggers
create function public.log_lead_event(org uuid, lead uuid, etype text, data jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.lead_events (org_id, lead_id, type, payload, actor_id) values (org, lead, etype, coalesce(data, '{}'), auth.uid());
$$;
revoke all on function public.log_lead_event(uuid, uuid, text, jsonb) from public, anon, authenticated;

create function public.leads_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid; init uuid;
begin
  if tg_op = 'INSERT' then
    if new.status_id is null then
      select id into init from public.statuses where org_id = new.org_id and is_initial;
      new.status_id := init;
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
create trigger leads_before before insert or update on public.leads
  for each row execute function public.leads_before();

create function public.leads_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare fn text; tn text; changed text[];
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
    select array_agg(k) into changed from (
      select k from jsonb_object_keys(new.custom) k where new.custom -> k is distinct from old.custom -> k
      union select k from jsonb_object_keys(old.custom) k where new.custom -> k is distinct from old.custom -> k) s;
    perform public.log_lead_event(new.org_id, new.id, 'field_changed', jsonb_build_object('keys', to_jsonb(coalesce(changed, '{}'))));
  end if;
  return new;
end;
$$;
create trigger leads_after after insert or update on public.leads
  for each row execute function public.leads_after();

create function public.child_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'lead_notes' then
    perform public.log_lead_event(new.org_id, new.lead_id, 'note', jsonb_build_object('note_id', new.id));
  elsif tg_table_name = 'lead_calls' then
    perform public.log_lead_event(new.org_id, new.lead_id, 'call', jsonb_build_object('call_id', new.id, 'outcome', new.outcome, 'duration', new.duration_seconds));
  elsif tg_table_name = 'lead_files' then
    perform public.log_lead_event(new.org_id, new.lead_id, 'file', jsonb_build_object('file_id', new.id, 'name', new.name));
  end if;
  return new;
end;
$$;
create trigger lead_notes_event after insert on public.lead_notes for each row execute function public.child_events();
create trigger lead_calls_event after insert on public.lead_calls for each row execute function public.child_events();
create trigger lead_files_event after insert on public.lead_files for each row execute function public.child_events();

-- Champs structurels immuables sur les tables liées.
create function public.child_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.org_id <> old.org_id or new.lead_id is distinct from old.lead_id then raise exception 'immutable_org' using errcode = '42501'; end if;
  if tg_table_name = 'lead_notes' then
    if new.author_id <> old.author_id then raise exception 'immutable_author' using errcode = '42501'; end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger lead_notes_guard before update on public.lead_notes for each row execute function public.child_guard();
create trigger lead_calls_guard before update on public.lead_calls for each row execute function public.child_guard();
create trigger tasks_guard before update on public.tasks for each row execute function public.child_guard();
revoke all on function public.leads_before(), public.leads_after(), public.child_events(), public.child_guard() from public, anon, authenticated;

-- ------------------------------------------------------------ RPC
-- Déplace un lead (statut + position). Les triggers appliquent can_transition ; renvoie les actions à exécuter.
create function public.move_lead(p_lead uuid, p_to uuid, p_position double precision default null) returns jsonb
language plpgsql set search_path = public as $$
declare l public.leads; ev uuid; acts jsonb := '[]'; changed boolean;
begin
  select * into l from public.leads where id = p_lead;
  if not found then raise exception 'lead_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.statuses where id = p_to and org_id = l.org_id) then
    raise exception 'status_not_found' using errcode = 'P0002';
  end if;
  changed := l.status_id <> p_to;
  update public.leads set status_id = p_to, position = coalesce(p_position, position) where id = p_lead;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if changed then
    select id into ev from public.lead_events where lead_id = p_lead and type = 'status_changed' order by created_at desc limit 1;
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'config', a.config, 'position', a.position) order by a.position), '[]')
      into acts from public.status_actions a where a.status_id = p_to and a.org_id = l.org_id and a.enabled;
  end if;
  return jsonb_build_object('lead_id', p_lead, 'org_id', l.org_id, 'changed', changed, 'from_status_id', l.status_id,
    'to_status_id', p_to, 'event_id', ev, 'actions', acts);
end;
$$;

-- Supprime un statut en déplaçant ses leads vers un statut de remplacement.
create function public.delete_status_replace(p_org uuid, p_status uuid, p_replacement uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int; k text; init boolean;
begin
  if not public.has_perm(p_org, 'statuses.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select kind, is_initial into k, init from public.statuses where id = p_status and org_id = p_org;
  if not found then raise exception 'status_not_found' using errcode = 'P0002'; end if;
  if init then raise exception 'initial_status' using errcode = 'P0001'; end if;
  if p_replacement is not null then
    if p_replacement = p_status or not exists (select 1 from public.statuses where id = p_replacement and org_id = p_org) then
      raise exception 'invalid_replacement' using errcode = '22023';
    end if;
    perform set_config('app.skip_transition', 'on', true);
    update public.leads set status_id = p_replacement where status_id = p_status and org_id = p_org;
    get diagnostics n = row_count;
    perform set_config('app.skip_transition', 'off', true);
  else
    n := 0;
  end if;
  delete from public.statuses where id = p_status and org_id = p_org;
  return n;
end;
$$;

create function public.status_lead_counts(p_org uuid) returns table (status_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select l.status_id, count(*) from public.leads l
  where l.org_id = p_org and public.has_perm(p_org, 'statuses.manage') group by l.status_id;
$$;
create function public.source_lead_counts(p_org uuid) returns table (source_id uuid, n bigint)
language sql stable security definer set search_path = public as $$
  select l.source_id, count(*) from public.leads l
  where l.org_id = p_org and l.source_id is not null and public.has_perm(p_org, 'settings.manage') group by l.source_id;
$$;
revoke all on function public.move_lead(uuid, uuid, double precision), public.delete_status_replace(uuid, uuid, uuid),
  public.status_lead_counts(uuid), public.source_lead_counts(uuid) from public, anon;
grant execute on function public.move_lead(uuid, uuid, double precision), public.delete_status_replace(uuid, uuid, uuid),
  public.status_lead_counts(uuid), public.source_lead_counts(uuid) to authenticated;

-- ------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['leads','lead_events','lead_notes','lead_calls','lead_files','tasks','notifications','action_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select, insert, delete on public.leads to authenticated;
grant update (status_id, source_id, assigned_to, first_name, last_name, company, email, phone, address, city, postal_code, lat, lng, value, custom, position, archived_at) on public.leads to authenticated;
grant select on public.lead_events, public.action_runs to authenticated;
grant select, insert, delete on public.lead_notes, public.lead_calls, public.lead_files to authenticated;
grant update (body) on public.lead_notes to authenticated;
grant update (outcome, duration_seconds, notes, called_at) on public.lead_calls to authenticated;
grant select, insert, delete on public.tasks to authenticated;
grant update (done, done_at, title, due_at) on public.tasks to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy leads_select on public.leads for select to authenticated using (
  public.is_org_member(org_id) and (public.has_perm(org_id, 'leads.view_all')
    or (public.has_perm(org_id, 'leads.view_own') and (assigned_to = auth.uid() or created_by = auth.uid()))));
create policy leads_insert on public.leads for insert to authenticated
  with check (public.has_perm(org_id, 'leads.create') and created_by = auth.uid());
create policy leads_update on public.leads for update to authenticated
  using (public.has_perm(org_id, 'leads.edit') and (public.has_perm(org_id, 'leads.view_all') or assigned_to = auth.uid() or created_by = auth.uid()))
  with check (public.has_perm(org_id, 'leads.edit'));
create policy leads_delete on public.leads for delete to authenticated
  using (public.has_perm(org_id, 'leads.delete') and (public.has_perm(org_id, 'leads.view_all') or assigned_to = auth.uid() or created_by = auth.uid()));

-- Tables enfant : visibles si le lead l'est (sous-requête soumise à la RLS de leads).
create policy lead_events_select on public.lead_events for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_events.lead_id));
create policy lead_notes_select on public.lead_notes for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_notes.lead_id));
create policy lead_notes_insert on public.lead_notes for insert to authenticated
  with check (author_id = auth.uid() and public.has_perm(org_id, 'leads.edit') and exists (select 1 from public.leads l where l.id = lead_notes.lead_id));
create policy lead_notes_update on public.lead_notes for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy lead_notes_delete on public.lead_notes for delete to authenticated
  using (author_id = auth.uid() or public.is_org_admin(org_id));

create policy lead_calls_select on public.lead_calls for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_calls.lead_id));
create policy lead_calls_insert on public.lead_calls for insert to authenticated
  with check (caller_id = auth.uid() and public.has_perm(org_id, 'leads.edit') and exists (select 1 from public.leads l where l.id = lead_calls.lead_id));
create policy lead_calls_update on public.lead_calls for update to authenticated
  using (caller_id = auth.uid()) with check (caller_id = auth.uid());
create policy lead_calls_delete on public.lead_calls for delete to authenticated
  using (caller_id = auth.uid() or public.is_org_admin(org_id));

create policy lead_files_select on public.lead_files for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_files.lead_id));
create policy lead_files_insert on public.lead_files for insert to authenticated
  with check (uploaded_by = auth.uid() and public.has_perm(org_id, 'leads.edit') and exists (select 1 from public.leads l where l.id = lead_files.lead_id));
create policy lead_files_delete on public.lead_files for delete to authenticated
  using (public.has_perm(org_id, 'leads.edit') and exists (select 1 from public.leads l where l.id = lead_files.lead_id));

create policy tasks_select on public.tasks for select to authenticated using (
  public.is_org_member(org_id) and (assigned_to = auth.uid() or created_by = auth.uid() or public.has_perm(org_id, 'leads.view_all')));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_perm(org_id, 'leads.edit') and created_by = auth.uid()
    and (lead_id is null or exists (select 1 from public.leads l where l.id = tasks.lead_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid()) with check (assigned_to = auth.uid() or created_by = auth.uid());
create policy tasks_delete on public.tasks for delete to authenticated
  using (created_by = auth.uid() or public.is_org_admin(org_id));

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid() and public.is_org_member(org_id));
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy action_runs_select on public.action_runs for select to authenticated using (public.has_perm(org_id, 'statuses.manage'));

-- ------------------------------------------------------------ Storage (bucket privé lead-files)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-files', 'lead-files', false, 10485760, array[
  'image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Chemin attendu : {org_id}/{lead_id}/{fichier}. Visible si le lead l'est pour l'appelant.
create function public.storage_lead_visible(object_name text) returns boolean
language sql stable set search_path = public as $$
  select case
    when (storage.foldername(object_name))[1] ~* '^[0-9a-f-]{36}$' and (storage.foldername(object_name))[2] ~* '^[0-9a-f-]{36}$'
    then exists (select 1 from public.leads l
      where l.id = ((storage.foldername(object_name))[2])::uuid and l.org_id = ((storage.foldername(object_name))[1])::uuid)
    else false end;
$$;
create function public.storage_lead_org(object_name text) returns uuid
language sql immutable set search_path = public as $$
  select case when (storage.foldername(object_name))[1] ~* '^[0-9a-f-]{36}$' then ((storage.foldername(object_name))[1])::uuid end;
$$;
grant execute on function public.storage_lead_visible(text), public.storage_lead_org(text) to authenticated;
revoke execute on function public.storage_lead_visible(text), public.storage_lead_org(text) from anon, public;

create policy lead_files_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'lead-files' and public.storage_lead_visible(name));
create policy lead_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lead-files' and public.storage_lead_visible(name) and public.has_perm(public.storage_lead_org(name), 'leads.edit'));
create policy lead_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lead-files' and public.storage_lead_visible(name) and public.has_perm(public.storage_lead_org(name), 'leads.edit'));
