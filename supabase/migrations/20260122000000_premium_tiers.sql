-- Plan Premium : tarif dégressif par ancienneté continue.
-- premium_since = début de l'ancienneté (première facture). Remis à null à la résiliation ou au changement de plan :
-- une reprise repart du prix de départ. Écrit uniquement par le webhook Stripe (service_role), comme les autres colonnes de facturation.
alter table public.organizations add column premium_since timestamptz;

-- Utilisateurs supplémentaires (Starter, Pro, Business) : 9,99 EUR/mois chacun, quel que soit le rôle.
-- seat_limit = sièges du plan + extra_seats (calculé par le webhook Stripe, seule source d'écriture).
alter table public.organizations add column extra_seats integer not null default 0 check (extra_seats >= 0);
