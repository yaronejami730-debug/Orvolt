/**
 * Grille dégressive du plan Premium : configuration INTERNE.
 * Les montants des paliers et le plancher ne sont jamais affichés sur la page tarifs ni envoyés au navigateur :
 * seuls le prix de départ (premier palier) et les CGV (serveur) les exposent. Ne pas importer depuis un composant client.
 * Sans import : ce fichier est aussi chargé tel quel par scripts/stripe-setup.mjs.
 */
export interface PremiumTier {
  /** Premier mois de facturation (1 = première mensualité) où ce palier s'applique. */
  fromMonth: number;
  /** Prix mensuel en centimes d'euro. */
  cents: number;
}

export const PREMIUM_TIERS: readonly PremiumTier[] = [
  { fromMonth: 1, cents: 19900 },
  { fromMonth: 3, cents: 19400 },
  { fromMonth: 6, cents: 18600 },
  { fromMonth: 9, cents: 17900 },
  { fromMonth: 12, cents: 16900 },
  { fromMonth: 18, cents: 15900 },
  { fromMonth: 24, cents: 14900 }, // plancher
];

/** Index du palier applicable au mois d'ancienneté `month` (1-based). */
export function premiumTierIndex(month: number): number {
  let idx = 0;
  PREMIUM_TIERS.forEach((t, i) => { if (month >= t.fromMonth) idx = i; });
  return idx;
}

export const premiumTierCents = (month: number): number => PREMIUM_TIERS[premiumTierIndex(month)]!.cents;

/** Clé de recherche Stripe d'un palier ; le palier 0 garde la clé du plan (cf. PLANS.premium). */
export function premiumLookupKey(base: string, tierIndex: number): string {
  return tierIndex === 0 ? base : `${base}_t${tierIndex + 1}`;
}

/** Mois entiers écoulés entre deux dates (calendaire, jour du mois pris en compte). */
export function monthsBetween(from: Date, to: Date): number {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/** Mois de facturation (1-based) de la prochaine facture, pour un abonnement dont l'ancienneté continue démarre à `since`. */
export const premiumMonthAt = (since: Date, invoiceDate: Date): number => monthsBetween(since, invoiceDate) + 1;
