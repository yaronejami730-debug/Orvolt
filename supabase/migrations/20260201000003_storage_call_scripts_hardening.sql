-- Durcissement : (1) chemins de storage lead-files strictement UUID (un cast invalide levait une erreur au lieu de refuser) ;
-- (2) bucket « imports » : aucune policy client (service_role seul) ; (3) call_script_runs.script_id doit être de la même organisation.
create or replace function public.storage_lead_visible(object_name text) returns boolean
language sql stable set search_path = public as $$
  select case
    when (storage.foldername(object_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (storage.foldername(object_name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then exists (select 1 from public.leads l
      where l.id = ((storage.foldername(object_name))[2])::uuid and l.org_id = ((storage.foldername(object_name))[1])::uuid)
    else false end;
$$;
create or replace function public.storage_lead_org(object_name text) returns uuid
language sql immutable set search_path = public as $$
  select case when (storage.foldername(object_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then ((storage.foldername(object_name))[1])::uuid end;
$$;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual ilike '%''imports''%' or with_check ilike '%''imports''%')
  loop execute format('drop policy %I on storage.objects', p.policyname); end loop;
end $$;

create or replace function public.call_script_run_same_org() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.script_id is not null and not exists (select 1 from public.call_scripts s where s.id = new.script_id and s.org_id = new.org_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists call_script_runs_same_org on public.call_script_runs;
create trigger call_script_runs_same_org before insert on public.call_script_runs for each row execute function public.call_script_run_same_org();
