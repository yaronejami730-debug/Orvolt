-- Confirmation des rendez-vous : chaque RDV « Planifié » est attribué AUTOMATIQUEMENT à un confirmateur
-- (celui qui a le moins de RDV à confirmer). Le super administrateur peut le réattribuer à la main.

alter table public.appointments add column confirmer_id uuid references auth.users (id) on delete set null;
create index appointments_confirmer_idx on public.appointments (org_id, confirmer_id) where status = 'planned';

-- Confirmateur = membre actif dont le rôle (ni administrateur, ni rôle système d'administration) porte dispatch.manage.
create function public.org_confirmers(org uuid) returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select m.user_id from public.memberships m
  join public.roles r on r.id = m.role_id
  where m.org_id = org and m.status = 'active' and not r.is_admin and r.system_key is null and 'dispatch.manage' = any (r.permissions);
$$;

-- Confirmateur le moins chargé (RDV « Planifié » en attente), égalité tirée au sort. null si l'organisation n'en a aucun.
create function public.pick_confirmer(org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select c.user_id from public.org_confirmers(org) c
  order by (select count(*) from public.appointments a where a.org_id = org and a.confirmer_id = c.user_id and a.status = 'planned'), random()
  limit 1;
$$;

create function public.appointments_assign_confirmer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'planned' and new.confirmer_id is null and not new.is_simulation
     and (tg_op = 'INSERT' or old.status is distinct from 'planned') then
    new.confirmer_id := public.pick_confirmer(new.org_id);
  end if;
  return new;
end;
$$;
create trigger appointments_confirmer before insert or update of status on public.appointments
  for each row execute function public.appointments_assign_confirmer();

-- Réattribue les RDV à confirmer dont le confirmateur n'existe plus (parti, désactivé, changé de rôle) ou absent.
create function public.reassign_orphan_confirmations(org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  for r in select a.id from public.appointments a
    where a.org_id = org and a.status = 'planned' and not a.is_simulation
      and (a.confirmer_id is null or a.confirmer_id not in (select c.user_id from public.org_confirmers(org) c))
    order by a.created_at
  loop
    update public.appointments set confirmer_id = public.pick_confirmer(org) where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create function public.memberships_reassign_confirmations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.reassign_orphan_confirmations(coalesce(new.org_id, old.org_id));
  return null;
end;
$$;
create trigger memberships_reassign_confirmations after insert or update or delete on public.memberships
  for each row execute function public.memberships_reassign_confirmations();

-- Confirme un RDV « Planifié » : son confirmateur (ou un confirmateur si aucun n'est attribué), ou un administrateur.
create function public.confirm_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found or a.is_simulation then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not public.is_org_member(a.org_id) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not (public.is_org_admin(a.org_id)
          or (public.has_perm(a.org_id, 'dispatch.manage') and (a.confirmer_id is null or a.confirmer_id = auth.uid()))) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if not public.org_is_writable(a.org_id) then raise exception 'org_read_only' using errcode = 'P0001'; end if;
  if a.status <> 'planned' then raise exception 'not_planned' using errcode = 'P0001'; end if;
  update public.appointments set status = 'confirmed' where id = p_id;
end;
$$;

-- Réattribution manuelle par un administrateur ; p_user null = retour à l'attribution automatique.
create function public.set_appointment_confirmer(p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found or a.is_simulation then raise exception 'not_found' using errcode = 'P0001'; end if;
  if not public.is_org_admin(a.org_id) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if not public.org_is_writable(a.org_id) then raise exception 'org_read_only' using errcode = 'P0001'; end if;
  if a.status <> 'planned' then raise exception 'not_planned' using errcode = 'P0001'; end if;
  if p_user is not null and p_user not in (select c.user_id from public.org_confirmers(a.org_id) c) then
    raise exception 'not_confirmer' using errcode = 'P0001';
  end if;
  update public.appointments set confirmer_id = coalesce(p_user, public.pick_confirmer(a.org_id)) where id = p_id;
end;
$$;

revoke all on function public.org_confirmers(uuid), public.pick_confirmer(uuid), public.appointments_assign_confirmer(),
  public.reassign_orphan_confirmations(uuid), public.memberships_reassign_confirmations(),
  public.confirm_appointment(uuid), public.set_appointment_confirmer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_appointment(uuid), public.set_appointment_confirmer(uuid, uuid) to authenticated;

-- RDV déjà « Planifié » : attribution initiale.
select public.reassign_orphan_confirmations(id) from public.organizations;
