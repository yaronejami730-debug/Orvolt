-- Rétention : tables qui grossissaient sans purge. Chaque appel supprime au plus 20 000 lignes par table (traitement par lots,
-- pas de longue transaction) ; la tâche planifiée /api/cron/maintenance rappelle la fonction à chaque passage.

create or replace function public.purge_inbound_events(p_days int default 90, p_mask_days int default 14) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.inbound_events where ctid = any (array(
    select ctid from public.inbound_events where received_at < now() - make_interval(days => p_days) limit 20000));
  get diagnostics n = row_count;
  update public.inbound_events set payload = null where ctid = any (array(
    select ctid from public.inbound_events where payload is not null and received_at < now() - make_interval(days => p_mask_days) limit 20000));
  return n;
end;
$$;

create or replace function public.purge_housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare rl int; se int; ev int; nr int; no int;
begin
  -- compteurs de limitation expirés
  delete from public.rate_limits where ctid = any (array(select ctid from public.rate_limits where window_start < now() - interval '1 day' limit 20000));
  get diagnostics rl = row_count;
  -- événements Stripe déjà traités (Stripe ne rejoue pas au-delà de quelques jours)
  delete from public.stripe_events where ctid = any (array(
    select ctid from public.stripe_events where status in ('processed', 'ignored') and received_at < now() - interval '180 days' limit 20000));
  get diagnostics se = row_count;
  -- codes de vérification e-mail expirés
  delete from public.email_verifications where ctid = any (array(select ctid from public.email_verifications where expires_at < now() - interval '1 day' limit 20000));
  get diagnostics ev = row_count;
  -- notifications : lues > 90 jours, toutes > 365 jours
  delete from public.notifications where ctid = any (array(
    select ctid from public.notifications where read_at is not null and created_at < now() - interval '90 days' limit 20000));
  get diagnostics nr = row_count;
  delete from public.notifications where ctid = any (array(select ctid from public.notifications where created_at < now() - interval '365 days' limit 20000));
  get diagnostics no = row_count;
  return jsonb_build_object('rate_limits', rl, 'stripe_events', se, 'email_verifications', ev, 'notifications', nr + no);
end;
$$;
revoke all on function public.purge_inbound_events(int, int), public.purge_housekeeping() from public, anon, authenticated;
grant execute on function public.purge_inbound_events(int, int), public.purge_housekeeping() to service_role;
