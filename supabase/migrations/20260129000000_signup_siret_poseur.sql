-- SIRET reconnu par l'API publique à l'inscription (sinon saisi à la main : false).
alter table public.organizations add column siret_verified boolean not null default false;

-- Onboarding : un installateur qui gère des poseurs reçoit le rôle « Poseur » (modifiable, non système).
create or replace function public.set_org_profile(p_org uuid, p_type text, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if p_type not in ('installer', 'agency') then raise exception 'invalid_type' using errcode = '22023'; end if;
  update public.organizations set org_type = p_type, onboarding = coalesce(p_answers, '{}'::jsonb) where id = p_org and parent_org_id is null;
  if p_type = 'installer' and coalesce((p_answers ->> 'managesInstallers')::boolean, false) then
    insert into public.roles (org_id, name, description, is_system, permissions)
    values (p_org, 'Poseur', 'Réalise les installations : voit ses rendez-vous et ses chantiers', false, array['leads.view_own', 'appointments.manage_own'])
    on conflict (org_id, name) do nothing;
  end if;
end;
$$;
revoke all on function public.set_org_profile(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_org_profile(uuid, text, jsonb) to authenticated;
