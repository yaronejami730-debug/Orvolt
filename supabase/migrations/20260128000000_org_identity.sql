-- Identité de l'entreprise saisie à l'inscription : SIRET (14 chiffres) et téléphone.
alter table public.organizations
  add column siret text check (siret ~ '^[0-9]{14}$'),
  add column phone text check (char_length(phone) between 6 and 30);
