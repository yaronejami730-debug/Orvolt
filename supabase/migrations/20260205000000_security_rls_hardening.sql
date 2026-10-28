-- Second audit sécurité : durcissement RLS / triggers. Idempotent (create or replace, drop ... if exists).
--  1) memberships : org_id / user_id / via_parent immuables côté client, accès « via_parent » réservé à la synchronisation maître
--     (un gérant de membres pouvait créer des membres via_parent = hors quota de sièges, ou retirer l'accès de la régie maître).
--  2) membre DÉSACTIVÉ : ne peut plus modifier / supprimer ses propres notes, appels, tâches, notifications, zones.
--  3) lecture seule (abonnement inactif) : tables jusque-là non couvertes par enforce_org_writable.
--  4) confirmation d'un RDV réservée à dispatch.manage (plus de confirmation directe par PostgREST / agenda).
--  5) longueurs de profil, plafond de fichiers par lead.

-- ------------------------------------------------------------ 1) memberships : champs structurels
create or replace function public.memberships_immutable_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- service_role / postgres (auth.uid() null) et synchronisation maître -> sous-régie : autorisés.
  if auth.uid() is null or coalesce(current_setting('lf.parent_sync', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.via_parent and pg_trigger_depth() <= 1 then raise exception 'via_parent_locked' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.via_parent then raise exception 'via_parent_locked' using errcode = '42501'; end if;
    return new;
  end if;
  if old.via_parent or new.via_parent or new.org_id <> old.org_id or new.user_id <> old.user_id then
    raise exception 'membership_immutable_fields' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.memberships_immutable_guard() from public, anon, authenticated;
drop trigger if exists memberships_immutable on public.memberships;
create trigger memberships_immutable before insert or update or delete on public.memberships
  for each row execute function public.memberships_immutable_guard();

-- sync_parent_access : identique à 20260126, + drapeau de transaction qui autorise la création / suppression des accès via_parent.
create or replace function public.sync_parent_access(p_parent uuid) returns void
language plpgsql security definer set search_path = public as $$
declare child record;
begin
  perform set_config('lf.parent_sync', 'on', true);
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
  perform set_config('lf.parent_sync', 'off', true);
end;
$$;
revoke all on function public.sync_parent_access(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ 2) membre désactivé : plus aucune écriture sur ses propres lignes
drop policy if exists lead_notes_update on public.lead_notes;
create policy lead_notes_update on public.lead_notes for update to authenticated
  using (author_id = auth.uid() and public.is_org_member(org_id)) with check (author_id = auth.uid() and public.is_org_member(org_id));
drop policy if exists lead_notes_delete on public.lead_notes;
create policy lead_notes_delete on public.lead_notes for delete to authenticated
  using (public.is_org_member(org_id) and (author_id = auth.uid() or public.is_org_admin(org_id)));

drop policy if exists lead_calls_update on public.lead_calls;
create policy lead_calls_update on public.lead_calls for update to authenticated
  using (caller_id = auth.uid() and public.is_org_member(org_id)) with check (caller_id = auth.uid() and public.is_org_member(org_id));
drop policy if exists lead_calls_delete on public.lead_calls;
create policy lead_calls_delete on public.lead_calls for delete to authenticated
  using (public.is_org_member(org_id) and (caller_id = auth.uid() or public.is_org_admin(org_id)));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_org_member(org_id) and (assigned_to = auth.uid() or created_by = auth.uid()))
  with check (public.is_org_member(org_id) and (assigned_to = auth.uid() or created_by = auth.uid()));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_org_member(org_id) and (created_by = auth.uid() or public.is_org_admin(org_id)));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() and public.is_org_member(org_id)) with check (user_id = auth.uid() and public.is_org_member(org_id));
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid() and public.is_org_member(org_id));

drop policy if exists zones_delete on public.sales_zones;
create policy zones_delete on public.sales_zones for delete to authenticated
  using (public.is_org_member(org_id) and (user_id = auth.uid() or public.has_perm(org_id, 'members.manage')));
drop policy if exists zones_update on public.sales_zones;
create policy zones_update on public.sales_zones for update to authenticated
  using (public.is_org_member(org_id) and (user_id = auth.uid() or public.has_perm(org_id, 'members.manage')))
  with check (public.is_org_member(org_id) and (user_id = auth.uid() or public.has_perm(org_id, 'members.manage')) and (not active or public.is_field_member(org_id, user_id)));

-- ------------------------------------------------------------ 3) lecture seule : tables non couvertes jusqu'ici
do $$
declare t text;
begin
  foreach t in array array['status_role_grants', 'sales_unavailability', 'dispatch_settings', 'call_scripts', 'call_script_questions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_writable', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_org_writable()', t || '_writable', t);
  end loop;
end $$;

-- ------------------------------------------------------------ 4) confirmation d'un RDV : dispatch.manage (ou administrateur)
create or replace function public.appointments_confirm_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then return new; end if;
  if not public.has_perm(new.org_id, 'dispatch.manage') then raise exception 'forbidden_confirm' using errcode = '42501'; end if;
  return new;
end;
$$;
revoke all on function public.appointments_confirm_guard() from public, anon, authenticated;
drop trigger if exists appointments_confirm_guard on public.appointments;
create trigger appointments_confirm_guard before insert or update of status on public.appointments
  for each row execute function public.appointments_confirm_guard();

-- ------------------------------------------------------------ 5) longueurs de profil, plafond de fichiers par lead
-- NOT VALID : contrôle toute nouvelle écriture sans bloquer d'éventuelles anciennes lignes.
alter table public.profiles drop constraint if exists profiles_full_name_len;
alter table public.profiles add constraint profiles_full_name_len check (full_name is null or char_length(full_name) <= 200) not valid;
alter table public.profiles drop constraint if exists profiles_avatar_url_https;
alter table public.profiles add constraint profiles_avatar_url_https check (avatar_url is null or (char_length(avatar_url) <= 500 and avatar_url ~* '^https://')) not valid;

create or replace function public.lead_files_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.lead_files f where f.lead_id = new.lead_id) >= 50 then
    raise exception 'too_many_files' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.lead_files_cap() from public, anon, authenticated;
drop trigger if exists lead_files_cap on public.lead_files;
create trigger lead_files_cap before insert on public.lead_files for each row execute function public.lead_files_cap();
