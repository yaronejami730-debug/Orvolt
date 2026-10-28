-- K-fixes : un lead « Nouveau » le restait après confirmation / attribution du RDV.
-- Quand un RDV réel est confirmé ou attribué à un commercial par la répartition, le lead passe au statut « RDV pris » de l'organisation,
-- à ces conditions seulement :
--   * le statut « RDV pris » existe dans le workflow de l'organisation (statut normal, comparé sans casse) ;
--   * le lead est dans un statut normal situé AVANT lui (position inférieure) : jamais un statut final (Signé / Perdu), jamais un recul ;
--   * le workflow configuré permet d'y arriver : un chemin existe dans status_transitions (tous rôles confondus) du statut actuel vers « RDV pris ».
-- Le changement est systémique (pas une action d'un rôle) : il contourne le garde de transition par rôle (app.skip_transition), mais jamais ces conditions.
-- L'historique du lead reçoit l'événement status_changed habituel (leads_after) et un événement « appointment » qui indique l'origine automatique.
-- Les actions de statut (attribution, notification, tâche, webhook) sont exécutées par l'application lors d'un changement manuel : elles ne le sont pas ici.

create or replace function public.advance_lead_on_appointment(p_org uuid, p_lead uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare cur record; tgt record; reach boolean;
begin
  select s.id, s.kind, s.position, l.is_simulation into cur
    from public.leads l join public.statuses s on s.id = l.status_id and s.org_id = l.org_id
    where l.id = p_lead and l.org_id = p_org for update of l;
  if not found or cur.is_simulation or cur.kind <> 'normal' then return false; end if;
  select id, position, name into tgt from public.statuses where org_id = p_org and kind = 'normal' and lower(btrim(name)) = 'rdv pris' limit 1;
  if not found or cur.position >= tgt.position or cur.id = tgt.id then return false; end if;
  with recursive reach_cte(id) as (
    select to_status_id from public.status_transitions where org_id = p_org and from_status_id = cur.id
    union
    select t.to_status_id from public.status_transitions t join reach_cte r on t.from_status_id = r.id where t.org_id = p_org
  )
  select exists (select 1 from reach_cte where id = tgt.id) into reach;
  if not reach then return false; end if;
  perform set_config('app.skip_transition', 'on', true);
  update public.leads set status_id = tgt.id where id = p_lead and org_id = p_org;
  perform set_config('app.skip_transition', 'off', true);
  perform public.log_lead_event(p_org, p_lead, 'appointment', jsonb_build_object('action', 'lead_status_auto', 'to', tgt.id, 'to_name', tgt.name));
  return true;
end;
$$;
revoke all on function public.advance_lead_on_appointment(uuid, uuid) from public, anon, authenticated;

create or replace function public.appointments_advance_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_simulation or new.status = 'cancelled' then return new; end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.dispatch_status is distinct from old.dispatch_status then
    if new.status = 'confirmed' or (tg_op = 'UPDATE' and old.dispatch_status = 'unassigned' and new.dispatch_status = 'assigned') then
      begin -- ne doit jamais empêcher d'enregistrer le RDV (org en lecture seule, transition refusée, etc.)
        perform public.advance_lead_on_appointment(new.org_id, new.lead_id);
      exception when others then
        perform set_config('app.skip_transition', 'off', true);
      end;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.appointments_advance_lead() from public, anon, authenticated;
drop trigger if exists appointments_advance_lead on public.appointments;
create trigger appointments_advance_lead after insert or update on public.appointments
  for each row execute function public.appointments_advance_lead();
