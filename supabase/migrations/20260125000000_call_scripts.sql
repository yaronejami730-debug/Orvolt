-- Trames d'appel : formulaires créés par l'administrateur, remplis par le téléprospecteur pendant l'appel.
-- Droit de construction : fields.manage (comme les champs personnalisés). Remplissage : leads.edit sur un lead visible.

create table public.call_scripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 300),
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

create table public.call_script_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  script_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 200),
  help text check (char_length(help) <= 300),                 -- consigne pour le téléprospecteur
  type text not null check (type in ('short_text', 'long_text', 'number', 'yes_no', 'single', 'multi', 'date')),
  choices jsonb not null default '[]' check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) <= 20 and pg_column_size(choices) < 4000),
  required boolean not null default false,
  position int not null default 0,
  show_if jsonb check (show_if is null or (jsonb_typeof(show_if) = 'object' and show_if ? 'question' and show_if ? 'equals' and pg_column_size(show_if) < 600)),
  created_at timestamptz not null default now(),
  foreign key (script_id, org_id) references public.call_scripts (id, org_id) on delete cascade
);
create index call_script_questions_script_idx on public.call_script_questions (script_id, position);

create table public.call_script_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  script_id uuid references public.call_scripts (id) on delete set null,
  script_name text not null check (char_length(script_name) <= 80),
  lead_id uuid not null,
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  answers jsonb not null check (jsonb_typeof(answers) = 'array' and pg_column_size(answers) < 60000),  -- [{ question, label, value }] figé à la saisie
  created_at timestamptz not null default now(),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade
);
create index call_script_runs_lead_idx on public.call_script_runs (lead_id, created_at desc);

alter table public.call_scripts enable row level security;
alter table public.call_script_questions enable row level security;
alter table public.call_script_runs enable row level security;
alter table public.call_scripts force row level security;
alter table public.call_script_questions force row level security;
alter table public.call_script_runs force row level security;
revoke all on public.call_scripts, public.call_script_questions, public.call_script_runs from anon, authenticated;
grant select on public.call_scripts, public.call_script_questions to authenticated;
grant select, insert on public.call_script_runs to authenticated;

create policy call_scripts_select on public.call_scripts for select to authenticated using (public.is_org_member(org_id));
create policy call_script_questions_select on public.call_script_questions for select to authenticated using (public.is_org_member(org_id));
-- Une saisie se lit et s'écrit sur un lead visible (RLS des leads) ; on ne la modifie pas : c'est un compte rendu d'appel.
create policy call_script_runs_select on public.call_script_runs for select to authenticated using (
  public.is_org_member(org_id) and exists (select 1 from public.leads l where l.id = call_script_runs.lead_id));
create policy call_script_runs_insert on public.call_script_runs for insert to authenticated with check (
  user_id = auth.uid() and public.has_perm(org_id, 'leads.edit')
  and exists (select 1 from public.leads l where l.id = call_script_runs.lead_id));
create trigger call_script_runs_writable before insert on public.call_script_runs for each row execute function public.enforce_org_writable();

/*
 * save_call_script : crée ou met à jour une trame ET remplace toutes ses questions, en une seule transaction.
 * p_questions = [{ id, label, help, type, choices[], required, show_if: { question, equals } | null }, ...] dans l'ordre d'affichage.
 * Une condition ne peut viser qu'une question PLUS HAUT dans la trame (jamais elle-même ni une suivante).
 */
create function public.save_call_script(p_id uuid, p_org uuid, p_name text, p_description text, p_active boolean, p_questions jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  sid uuid; q jsonb; i int := 0; seen uuid[] := '{}'; qid uuid; cond uuid;
begin
  if not public.has_perm(p_org, 'fields.manage') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not public.org_is_writable(p_org) then raise exception 'org_read_only' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > 40 then raise exception 'invalid_questions' using errcode = 'P0001'; end if;

  if p_id is null then
    if (select count(*) from public.call_scripts where org_id = p_org) >= 30 then raise exception 'too_many_scripts' using errcode = 'P0001'; end if;
    insert into public.call_scripts (org_id, name, description, active, position)
      values (p_org, p_name, nullif(btrim(p_description), ''), p_active, coalesce((select max(position) + 1 from public.call_scripts where org_id = p_org), 0))
      returning id into sid;
  else
    update public.call_scripts set name = p_name, description = nullif(btrim(p_description), ''), active = p_active
      where id = p_id and org_id = p_org returning id into sid;
    if sid is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  end if;

  delete from public.call_script_questions where script_id = sid and org_id = p_org;
  for q in select * from jsonb_array_elements(p_questions) loop
    qid := (q ->> 'id')::uuid;
    cond := nullif(q -> 'show_if' ->> 'question', '')::uuid;
    if qid = any (seen) then raise exception 'invalid_questions' using errcode = 'P0001'; end if;
    if cond is not null and not (cond = any (seen)) then raise exception 'invalid_condition' using errcode = 'P0001'; end if;
    insert into public.call_script_questions (id, org_id, script_id, label, help, type, choices, required, position, show_if)
    values (qid, p_org, sid, q ->> 'label', nullif(btrim(coalesce(q ->> 'help', '')), ''), q ->> 'type',
            coalesce(q -> 'choices', '[]'::jsonb), coalesce((q ->> 'required')::boolean, false), i,
            case when cond is null then null else jsonb_build_object('question', cond, 'equals', q -> 'show_if' ->> 'equals') end);
    seen := seen || qid;
    i := i + 1;
  end loop;
  return sid;
end;
$$;

create function public.delete_call_script(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select org_id into org from public.call_scripts where id = p_id;
  if org is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not public.has_perm(org, 'fields.manage') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not public.org_is_writable(org) then raise exception 'org_read_only' using errcode = 'P0001'; end if;
  delete from public.call_scripts where id = p_id;
end;
$$;

revoke all on function public.save_call_script(uuid, uuid, text, text, boolean, jsonb), public.delete_call_script(uuid) from public, anon, authenticated;
grant execute on function public.save_call_script(uuid, uuid, text, text, boolean, jsonb), public.delete_call_script(uuid) to authenticated;
