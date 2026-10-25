-- S7 correctifs : lecture seule complète (toutes les tables d'écriture, DELETE compris, Storage), org_is_writable sans fuite.

-- Neutre (true) pour qui n'est pas membre actif de l'organisation : aucun statut d'abonnement d'un tiers ne fuit
-- (la RLS refuse de toute façon l'écriture d'un non-membre). Appels sans utilisateur (service_role, postgres) : réponse réelle.
create or replace function public.org_is_writable(org uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(org) then
    return true;
  end if;
  return coalesce((select case o.subscription_status
      when 'active' then true
      when 'trialing' then coalesce(o.trial_ends_at, now()) > now()
      when 'past_due' then coalesce(o.past_due_since, now()) + interval '7 days' > now()
      else false end
    from public.organizations o where o.id = org), false);
end;
$$;
revoke all on function public.org_is_writable(uuid) from public, anon;
grant execute on function public.org_is_writable(uuid) to authenticated, service_role;

-- Garde générique INSERT / UPDATE / DELETE (client authentifié uniquement ; service_role : contrôlé côté serveur).
create or replace function public.enforce_org_writable() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  o := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  if not public.org_is_writable(o) then
    raise exception 'org_read_only' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.enforce_org_writable() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['leads','appointments','lead_notes','lead_calls','lead_files','tasks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_writable', t);
  end loop;
  foreach t in array array['leads','appointments','lead_notes','lead_calls','lead_files','tasks',
    'statuses','status_transitions','status_actions','custom_fields','lead_sources','roles','sales_zones','inbound_endpoints','import_jobs'] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_org_writable()', t || '_writable', t);
  end loop;
end $$;

-- Membres : en lecture seule, seule la désactivation (pour repasser sous le quota de sièges) reste permise.
create or replace function public.enforce_membership_writable() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  o := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  if public.org_is_writable(o) then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.status = 'disabled' and new.role_id = old.role_id and new.user_id = old.user_id and new.org_id = old.org_id then
    return new;
  end if;
  raise exception 'org_read_only' using errcode = 'P0001';
end;
$$;
revoke all on function public.enforce_membership_writable() from public, anon, authenticated;
create trigger memberships_writable before insert or update or delete on public.memberships for each row execute function public.enforce_membership_writable();

-- Organisation elle-même (nom, réglages non facturation) : gelée en lecture seule.
create or replace function public.enforce_organization_writable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and tg_op = 'UPDATE' and not public.org_is_writable(old.id) then
    raise exception 'org_read_only' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.enforce_organization_writable() from public, anon, authenticated;
create trigger organizations_writable before update on public.organizations for each row execute function public.enforce_organization_writable();

-- Storage direct (lead-files) : plus d'envoi ni de suppression de fichier en lecture seule.
drop policy lead_files_obj_insert on storage.objects;
drop policy lead_files_obj_delete on storage.objects;
create policy lead_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lead-files' and public.storage_lead_visible(name) and public.has_perm(public.storage_lead_org(name), 'leads.edit')
    and public.org_is_writable(public.storage_lead_org(name)));
create policy lead_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lead-files' and public.storage_lead_visible(name) and public.has_perm(public.storage_lead_org(name), 'leads.edit')
    and public.org_is_writable(public.storage_lead_org(name)));
