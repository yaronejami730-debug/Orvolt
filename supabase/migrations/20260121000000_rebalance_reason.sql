-- K-fixes : cause du signalement « à rééquilibrer ». NULL = position GPS corrigée (comportement historique),
-- 'unavailability' = indisponibilité déclarée sur le jour du RDV. Remis à NULL dès que le RDV n'est plus à rééquilibrer.
alter table public.appointments add column if not exists rebalance_reason text check (rebalance_reason is null or rebalance_reason in ('unavailability'));

create or replace function public.appointments_reset_rebalance_reason() returns trigger
language plpgsql set search_path = public as $$
begin
  if not new.needs_rebalance then new.rebalance_reason := null; end if;
  return new;
end;
$$;
drop trigger if exists appointments_reset_rebalance_reason on public.appointments;
create trigger appointments_reset_rebalance_reason before update on public.appointments
  for each row execute function public.appointments_reset_rebalance_reason();

create or replace function public.flag_rebalance_on_unavailability() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('lf.dispatch', 'on', true);
  begin -- le signalement ne doit jamais empêcher d'enregistrer l'indisponibilité
  update public.appointments a set needs_rebalance = true, rebalance_reason = 'unavailability'
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
