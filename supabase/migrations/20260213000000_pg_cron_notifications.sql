-- Planification des rappels par Supabase (Vercel Hobby n'autorise que des crons quotidiens).
-- pg_cron déclenche, pg_net appelle GET /api/cron/notifications avec Authorization: Bearer <CRON_SECRET>.
-- Les secrets ne sont PAS dans ce fichier : à créer une fois dans Vault (voir README ci-dessous).
--
--   select vault.create_secret('https://orvolt.fr', 'app_url');         -- sans slash final
--   select vault.create_secret('<CRON_SECRET de Vercel>', 'cron_secret');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.app_cron_call(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'app_cron_call: secrets Vault app_url / cron_secret manquants';
    return null;
  end if;
  return net.http_get(
    url := v_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.app_cron_call(text) from public, anon, authenticated;

-- Idempotent : on remplace la tâche si elle existe déjà.
select cron.unschedule(jobid) from cron.job where jobname = 'orvolt-notifications';
select cron.schedule('orvolt-notifications', '*/15 * * * *', $$select public.app_cron_call('/api/cron/notifications')$$);
