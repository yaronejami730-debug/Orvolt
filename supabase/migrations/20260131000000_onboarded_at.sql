-- Onboarding obligatoire à l'inscription (activité, puis formule d'essai). Les organisations existantes en sont dispensées.
alter table public.organizations add column onboarded_at timestamptz;
update public.organizations set onboarded_at = now();
