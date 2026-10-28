-- Correctif de 20260126 : org_is_writable conserve sa protection d'origine (réponse neutre pour un non-membre : aucun statut
-- d'abonnement d'un tiers ne fuit) ET lit l'abonnement de la régie maître pour une sous-régie.
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
    from public.organizations o
    where o.id = (select coalesce(c.parent_org_id, c.id) from public.organizations c where c.id = org)), false);
end;
$$;
revoke all on function public.org_is_writable(uuid) from public, anon;
grant execute on function public.org_is_writable(uuid) to authenticated, service_role;
