-- Résolution des formulaires d'appel : quels formulaires voit un membre, et lequel ouvrir par défaut. Idempotent.
-- Miroir SQL de resolveScriptsForMember (src/lib/call-programming.ts) : même règle, évaluée côté base pour ne pas faire confiance au client.
--
-- Règle : un formulaire n'apparaît que s'il est actif ET (jamais programmé = ouvert à tous, comportement historique)
-- OU affecté au membre (directement, via un de ses domaines, ou à tout le monde) dans sa fenêtre (période, jours, plage horaire Europe/Paris).
-- Ordre : domaine du lead, puis domaine du membre, puis formulaire générique, puis les autres ; ensuite priorité décroissante,
-- spécificité (membre > domaine > tous), position, nom. Le premier est le formulaire par défaut.
-- Hors plan Pro+ (org_has_programming) ou pour un gérant (members.manage / settings.manage / fields.manage) : tous les formulaires actifs.

create or replace function public.call_scripts_resolve(p_org uuid, p_user uuid, p_lead_domain uuid, p_at timestamptz, p_all boolean)
returns table (script_id uuid, name text, domain_id uuid, rank int, is_default boolean, reason text, assignment_id uuid)
language sql stable security definer set search_path = public as $$
  with loc as (select (p_at at time zone 'Europe/Paris') as ts),
  ld as (select d.id from public.call_domains d where d.id = p_lead_domain and d.org_id = p_org and d.active),
  mdom as (
    select d.id from public.member_call_domains m
    join public.call_domains d on d.id = m.domain_id and d.org_id = m.org_id and d.active
    where m.org_id = p_org and m.user_id = p_user),
  cand as (
    select s.id as sid, s.name as sname, s.domain_id as sdom, s.position as spos, a.id as aid,
      case when p_all then 0 else coalesce(a.priority, -1) end as prio,
      case when p_all then 3 else case a.scope when 'member' then 0 when 'domain' then 1 when 'all' then 2 else 3 end end as spec
    from public.call_scripts s
    left join public.call_script_assignments a on a.script_id = s.id and a.org_id = s.org_id
    where s.org_id = p_org and s.active
      and (
        p_all
        or a.id is null                                                      -- jamais programmé : ouvert à tous
        or (a.active
            and (a.scope = 'all' or (a.scope = 'member' and a.user_id = p_user) or (a.scope = 'domain' and a.domain_id in (select id from mdom)))
            and (a.starts_on is null or (select ts::date from loc) >= a.starts_on)
            and (a.ends_on is null or (select ts::date from loc) <= a.ends_on)
            and (a.days is null or extract(isodow from (select ts from loc))::int = any (a.days))
            and (a.time_from is null or ((select ts::time from loc) >= a.time_from and (select ts::time from loc) < a.time_to)))
      )),
  best as (
    select distinct on (sid) sid, sname, sdom, spos, aid, prio, spec
    from cand order by sid, prio desc, spec, aid),
  ranked as (
    select b.*,
      case when b.sdom is not null and b.sdom = (select id from ld) then 0
           when b.sdom is not null and b.sdom in (select id from mdom) then 1
           when b.sdom is null then 2 else 3 end as grp
    from best b)
  select r.sid, r.sname, r.sdom,
    (row_number() over (order by r.grp, r.prio desc, r.spec, r.spos, r.sname, r.sid))::int,
    row_number() over (order by r.grp, r.prio desc, r.spec, r.spos, r.sname, r.sid) = 1,
    case r.grp when 0 then 'lead_domain' when 1 then 'member_domain' when 2 then 'generic' else 'other' end,
    r.aid
  from ranked r
  order by 4;
$$;
revoke all on function public.call_scripts_resolve(uuid, uuid, uuid, timestamptz, boolean) from public, anon, authenticated;

-- Formulaires applicables à l'utilisateur connecté pour un lead (visible pour lui). `p_at` n'est pris en compte que pour un gérant
-- (simulation) : un téléprospecteur est toujours évalué à l'instant présent.
create or replace function public.call_scripts_for_member(p_lead uuid, p_at timestamptz default now())
returns table (script_id uuid, name text, domain_id uuid, rank int, is_default boolean, reason text, assignment_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare o uuid; ld uuid; see_all boolean; mgr boolean;
begin
  if auth.uid() is null then return; end if;
  select la.org_id, la.call_domain_id into o, ld from public.leads_api la where la.id = p_lead;   -- visibilité du lead = RLS des leads
  if o is null or not public.is_org_member(o) then return; end if;
  mgr := public.is_call_manager(o) or public.has_perm(o, 'fields.manage');
  see_all := mgr or not public.org_has_programming(o);
  return query select * from public.call_scripts_resolve(o, auth.uid(), ld, case when mgr then coalesce(p_at, now()) else now() end, see_all);
end;
$$;

-- Aperçu pour un gérant : « ce que verrait ce membre à cet instant » (hors plan Pro+, tous les formulaires actifs).
create or replace function public.call_scripts_preview(p_org uuid, p_user uuid, p_lead_domain uuid default null, p_at timestamptz default now())
returns table (script_id uuid, name text, domain_id uuid, rank int, is_default boolean, reason text, assignment_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_call_manager(p_org) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_user) then raise exception 'not_found' using errcode = 'P0001'; end if;
  return query select * from public.call_scripts_resolve(p_org, p_user, p_lead_domain, coalesce(p_at, now()), not public.org_has_programming(p_org));
end;
$$;

revoke all on function public.call_scripts_for_member(uuid, timestamptz), public.call_scripts_preview(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.call_scripts_for_member(uuid, timestamptz), public.call_scripts_preview(uuid, uuid, uuid, timestamptz) to authenticated;

-- ------------------------------------------------------------ lecture des formulaires : seulement ceux que le membre peut utiliser
create or replace function public.call_script_visible(p_org uuid, p_script uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_member(p_org) and (
    not public.org_has_programming(p_org) or public.is_call_manager(p_org) or public.has_perm(p_org, 'fields.manage')
    or exists (select 1 from public.call_scripts_resolve(p_org, auth.uid(), null, now(), false) r where r.script_id = p_script));
$$;
revoke all on function public.call_script_visible(uuid, uuid) from public, anon;
grant execute on function public.call_script_visible(uuid, uuid) to authenticated, service_role;

drop policy if exists call_scripts_select on public.call_scripts;
create policy call_scripts_select on public.call_scripts for select to authenticated using (public.call_script_visible(org_id, id));
drop policy if exists call_script_questions_select on public.call_script_questions;
create policy call_script_questions_select on public.call_script_questions for select to authenticated using (public.call_script_visible(org_id, script_id));

-- Une saisie n'est acceptée que pour un formulaire applicable au membre (défense en profondeur : le serveur le vérifie aussi).
create or replace function public.call_script_run_applicable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.script_id is null then return new; end if;
  if not public.org_has_programming(new.org_id) or public.is_call_manager(new.org_id) or public.has_perm(new.org_id, 'fields.manage') then return new; end if;
  if not exists (select 1 from public.call_scripts_resolve(new.org_id, auth.uid(), null, now(), false) r where r.script_id = new.script_id) then
    raise exception 'script_not_assigned' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.call_script_run_applicable() from public, anon, authenticated;
drop trigger if exists call_script_runs_applicable on public.call_script_runs;
create trigger call_script_runs_applicable before insert on public.call_script_runs for each row execute function public.call_script_run_applicable();

-- ------------------------------------------------------------ enregistrement d'une trame : + domaine (nullable = générique)
drop function if exists public.save_call_script(uuid, uuid, text, text, boolean, jsonb);
create or replace function public.save_call_script(p_id uuid, p_org uuid, p_name text, p_description text, p_active boolean, p_questions jsonb, p_domain uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  sid uuid; q jsonb; i int := 0; seen uuid[] := '{}'; qid uuid; cond uuid;
begin
  if not public.has_perm(p_org, 'fields.manage') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not public.org_is_writable(p_org) then raise exception 'org_read_only' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > 40 then raise exception 'invalid_questions' using errcode = 'P0001'; end if;
  if p_domain is not null and not exists (select 1 from public.call_domains d where d.id = p_domain and d.org_id = p_org) then raise exception 'invalid_domain' using errcode = 'P0001'; end if;

  if p_id is null then
    if (select count(*) from public.call_scripts where org_id = p_org) >= 30 then raise exception 'too_many_scripts' using errcode = 'P0001'; end if;
    insert into public.call_scripts (org_id, name, description, active, position, domain_id)
      values (p_org, p_name, nullif(btrim(p_description), ''), p_active, coalesce((select max(position) + 1 from public.call_scripts where org_id = p_org), 0), p_domain)
      returning id into sid;
  else
    update public.call_scripts set name = p_name, description = nullif(btrim(p_description), ''), active = p_active, domain_id = p_domain
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
revoke all on function public.save_call_script(uuid, uuid, text, text, boolean, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_call_script(uuid, uuid, text, text, boolean, jsonb, uuid) to authenticated;

-- Historique du lead : une ligne « Formulaire rempli » (formulaire + domaine figés) à chaque saisie.
create or replace function public.call_script_run_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_lead_event(new.org_id, new.lead_id, 'script',
    jsonb_build_object('script_name', new.script_name, 'domain_name', new.domain_name, 'run_id', new.id));
  return new;
end;
$$;
revoke all on function public.call_script_run_log() from public, anon, authenticated;
drop trigger if exists call_script_runs_log on public.call_script_runs;
create trigger call_script_runs_log after insert on public.call_script_runs for each row execute function public.call_script_run_log();
