-- Informations d'entreprise reconnues par l'API publique à l'inscription (adresse, forme juridique, NAF, création).
-- Un seul jsonb : lecture seule côté application, écrit uniquement par le serveur (service role). Idempotent.
alter table public.organizations add column if not exists company_info jsonb;
