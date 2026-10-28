-- Notifications par e-mail : horodatages d'envoi (idempotence) lus et écrits uniquement par le cron (service_role).
-- Un envoi est « réservé » par UPDATE ... WHERE <colonne> IS NULL avant l'appel au fournisseur ; un échec remet la colonne à NULL.
-- Déplacer un rendez-vous, une échéance ou la fin d'essai remet les compteurs concernés à zéro (nouveau rappel utile).

alter table public.appointments
  add column reminder_day_sent_at timestamptz,
  add column reminder_hour_sent_at timestamptz,
  add column customer_reminder_sent_at timestamptz;
alter table public.tasks add column reminder_sent_at timestamptz;
alter table public.organizations
  add column trial_ending_mail_sent_at timestamptz,
  add column trial_expired_mail_sent_at timestamptz,
  add column seat_limit_mail_sent_at timestamptz;

-- Index partiels : le cron ne parcourt que ce qui reste à envoyer.
create index appointments_reminder_idx on public.appointments (starts_at)
  where status in ('planned', 'confirmed') and (reminder_day_sent_at is null or reminder_hour_sent_at is null or customer_reminder_sent_at is null);
create index tasks_reminder_idx on public.tasks (due_at) where not done and reminder_sent_at is null and due_at is not null;

create function public.appointments_reset_reminders() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.starts_at is distinct from old.starts_at or new.assigned_to is distinct from old.assigned_to then
    new.reminder_day_sent_at := null;
    new.reminder_hour_sent_at := null;
    new.customer_reminder_sent_at := null;
  end if;
  return new;
end;
$$;
create trigger appointments_reset_reminders before update of starts_at, assigned_to on public.appointments
  for each row execute function public.appointments_reset_reminders();

create function public.tasks_reset_reminder() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.due_at is distinct from old.due_at or new.assigned_to is distinct from old.assigned_to then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;
create trigger tasks_reset_reminder before update of due_at, assigned_to on public.tasks
  for each row execute function public.tasks_reset_reminder();

create function public.organizations_reset_trial_mails() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.trial_ends_at is distinct from old.trial_ends_at then
    new.trial_ending_mail_sent_at := null;
    new.trial_expired_mail_sent_at := null;
  end if;
  return new;
end;
$$;
create trigger organizations_reset_trial_mails before update of trial_ends_at on public.organizations
  for each row execute function public.organizations_reset_trial_mails();

-- Les colonnes d'envoi ne sont écrites que par le serveur : aucun droit client (les droits UPDATE existants sont par colonne).
