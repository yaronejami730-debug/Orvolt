-- S4 correctifs : colonnes de contrôle de distance non écrivables par les clients, durée minimale, journal des suppressions.

-- Les clients (REST) ne peuvent poser que les données de planification ; distance, coordonnées et dérogation
-- sont écrites par le serveur (service_role) après vérification des permissions et calcul du contrôle.
revoke insert, update on public.appointments from authenticated;
grant insert (org_id, lead_id, assigned_to, starts_at, ends_at, status, location_address, notes, created_by) on public.appointments to authenticated;
grant update (assigned_to, starts_at, ends_at, status, location_address, notes) on public.appointments to authenticated;

alter table public.appointments add constraint appointments_min_duration check (ends_at - starts_at >= interval '5 minutes');

create or replace function public.appointments_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.lead_id <> old.lead_id or new.created_by is distinct from old.created_by then
      raise exception 'immutable_appointment_fields' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  if auth.uid() is not null then
    -- Lieu ou commercial modifié par un client : l'ancien contrôle n'est plus valable => « non vérifié ».
    if tg_op = 'UPDATE' and (new.location_address is distinct from old.location_address or new.assigned_to <> old.assigned_to) then
      new.lat := null; new.lng := null; new.distance_km := null; new.distance_status := 'no_zone';
      new.distance_override := false; new.override_reason := null; new.override_by := null;
    end if;
    if not public.has_perm(new.org_id, 'appointments.manage_all') and new.assigned_to <> auth.uid() then
      raise exception 'forbidden_assignee' using errcode = '42501';
    end if;
    if not exists (select 1 from public.memberships where org_id = new.org_id and user_id = new.assigned_to and status = 'active') then
      raise exception 'invalid_assignee' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.appointments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text;
begin
  if tg_op = 'INSERT' then act := 'created';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then act := 'cancelled';
  elsif new.status <> old.status then act := 'status';
  elsif new.distance_override and not old.distance_override then act := 'override';
  elsif new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.assigned_to <> old.assigned_to
        or new.location_address is distinct from old.location_address then act := 'updated';
  else return new; end if;
  perform public.log_lead_event(new.org_id, new.lead_id, 'appointment', jsonb_build_object(
    'appointment_id', new.id, 'action', act, 'starts_at', new.starts_at, 'status', new.status, 'assigned_to', new.assigned_to,
    'distance_status', new.distance_status, 'override_reason', case when new.distance_override then new.override_reason end));
  return new;
end;
$$;

-- Suppression journalisée (sauf suppression en cascade du lead / de l'organisation).
create function public.appointments_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.leads where id = old.lead_id) then
    perform public.log_lead_event(old.org_id, old.lead_id, 'appointment', jsonb_build_object(
      'appointment_id', old.id, 'action', 'deleted', 'starts_at', old.starts_at, 'status', old.status, 'assigned_to', old.assigned_to));
  end if;
  return old;
end;
$$;
create trigger appointments_deleted after delete on public.appointments for each row execute function public.appointments_deleted();
revoke all on function public.appointments_deleted() from public, anon, authenticated;
