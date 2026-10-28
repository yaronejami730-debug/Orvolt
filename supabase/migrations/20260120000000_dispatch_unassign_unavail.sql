-- J-multirole : deux correctifs trouvés par le scénario multi-rôles en direct.
--
-- 1) « Retirer » un RDV attribué (dispatcher_unassign) effaçait sa position GPS : le déclencheur appointments_guard remet lat/lng à null
--    quand assigned_to change hors contexte « lf.dispatch ». Le RDV repassait « à vérifier : Pas de position GPS ». On garde la position.
-- 2) Une indisponibilité ajoutée pour un commercial qui a déjà un RDV réparti ce jour-là ne signalait rien : le RDV est maintenant marqué
--    « à rééquilibrer » (bouton Rééquilibrer de la page Répartition) sauf s'il est verrouillé par le confirmateur.

create or replace function public.dispatcher_unassign(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.appointments%rowtype; d date;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into a from public.appointments where id = p_id for update;
  if not found or not public.has_perm(a.org_id, 'dispatch.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if a.dispatch_status <> 'assigned' or a.status not in ('planned', 'confirmed') then raise exception 'dispatch_bad_status' using errcode = 'P0001'; end if;
  perform set_config('lf.dispatcher', 'on', true);
  perform set_config('lf.dispatch', 'on', true); -- conserve lat/lng : le RDV retiré reste géolocalisé
  d := greatest((a.starts_at at time zone 'Europe/Paris')::date, (now() at time zone 'Europe/Paris')::date + 1);
  update public.appointments set assigned_to = null, starts_at = null, ends_at = null, dispatch_status = 'unassigned', dispatched_at = null,
    wish_from = coalesce(a.wish_from, d), wish_to = greatest(coalesce(a.wish_to, d + 6), coalesce(a.wish_from, d)),
    duration_min = coalesce(a.duration_min, greatest(15, extract(epoch from (a.ends_at - a.starts_at))::int / 60)),
    locked_by_dispatcher = false, locked_by = null, locked_at = null, status = 'confirmed'
  where id = p_id;
  perform public.dispatch_notify(a.org_id, a.assigned_to, 'Un rendez-vous a été retiré de votre agenda par le confirmateur', a.lead_id);
end;
$$;

create or replace function public.flag_rebalance_on_unavailability() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lf.dispatch', 'on', true);
  begin -- le signalement ne doit jamais empêcher d'enregistrer l'indisponibilité
  update public.appointments a set needs_rebalance = true
  where a.org_id = new.org_id and a.assigned_to = new.user_id and a.dispatch_status = 'assigned' and a.dispatched_at is not null
    and not a.locked_by_dispatcher and a.status in ('planned', 'confirmed') and a.starts_at >= now() and not a.needs_rebalance
    and (a.starts_at at time zone 'Europe/Paris')::date = new.day
    and (new.start_min is null or (
      extract(hour from (a.starts_at at time zone 'Europe/Paris'))::int * 60 + extract(minute from (a.starts_at at time zone 'Europe/Paris'))::int < new.end_min
      and extract(hour from (a.ends_at at time zone 'Europe/Paris'))::int * 60 + extract(minute from (a.ends_at at time zone 'Europe/Paris'))::int > new.start_min));
  exception when others then null;
  end;
  return new;
end;
$$;
revoke all on function public.flag_rebalance_on_unavailability() from public, anon, authenticated;
drop trigger if exists sales_unavailability_flag_rebalance on public.sales_unavailability;
create trigger sales_unavailability_flag_rebalance after insert on public.sales_unavailability
  for each row execute function public.flag_rebalance_on_unavailability();
