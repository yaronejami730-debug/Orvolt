-- Essais de code e-mail : incrément ATOMIQUE avant comparaison (des requêtes parallèles ne dépassent jamais p_max essais).
-- state : 'ok' (essai compté, code_hash renvoyé pour comparaison) | 'locked' | 'expired'.
create or replace function public.consume_email_attempt(p_email text, p_max int, p_now timestamptz default now())
returns table (state text, code_hash text)
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  update public.email_verifications v set attempts = v.attempts + 1
    where v.email = p_email and v.expires_at > p_now and v.attempts < p_max
    returning v.code_hash into h;
  if found then state := 'ok'; code_hash := h; return next; return; end if;
  state := case when exists (select 1 from public.email_verifications v where v.email = p_email and v.expires_at > p_now) then 'locked' else 'expired' end;
  code_hash := null;
  return next;
end;
$$;
revoke all on function public.consume_email_attempt(text, int, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_email_attempt(text, int, timestamptz) to service_role;
