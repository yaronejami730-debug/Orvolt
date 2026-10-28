-- En lecture seule, la désactivation d'un membre reste permise : la réattribution automatique des
-- confirmations (qui écrit dans appointments, gelé en lecture seule) est alors ignorée.
create or replace function public.memberships_reassign_confirmations() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(new.org_id, old.org_id);
begin
  if public.org_is_writable(o) then
    perform public.reassign_orphan_confirmations(o);
  end if;
  return null;
end;
$$;
