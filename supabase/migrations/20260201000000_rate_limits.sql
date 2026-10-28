-- Rate limiting persistant et atomique (partagé entre instances serverless). Serveur uniquement (service_role).
-- Fenêtre fixe par clé : un seul INSERT ... ON CONFLICT, donc aucune course entre requêtes parallèles.
create table if not exists public.rate_limits (
  key text primary key check (char_length(key) <= 300),
  hits int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_ms int)
returns table (allowed boolean, remaining int, retry_after_ms int)
language plpgsql security definer set search_path = public as $$
declare
  win interval := make_interval(secs => greatest(p_window_ms, 1) / 1000.0);
  r public.rate_limits;
begin
  if p_key is null or char_length(p_key) > 300 or p_limit < 1 then raise exception 'invalid_args' using errcode = 'P0001'; end if;
  insert into public.rate_limits as t (key, hits, window_start) values (p_key, 1, now())
  on conflict (key) do update set
    hits = case when t.window_start <= now() - win then 1 else t.hits + 1 end,
    window_start = case when t.window_start <= now() - win then now() else t.window_start end
  returning * into r;
  -- Ménage opportuniste des fenêtres expirées (1 appel sur 200).
  if random() < 0.005 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  allowed := r.hits <= p_limit;
  remaining := greatest(p_limit - r.hits, 0);
  retry_after_ms := case when allowed then 0 else greatest(0, ceil(extract(epoch from (r.window_start + win - now())) * 1000))::int end;
  return next;
end;
$$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
