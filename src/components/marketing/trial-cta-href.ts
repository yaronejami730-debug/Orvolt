import { TRIAL_DAYS, type BillingInterval, type PlanId } from "@/lib/billing/plans";

/** Micro-texte sous le bouton : la durée vient de la config de facturation, jamais en dur. */
export const TRIAL_HINT = `${TRIAL_DAYS} jours d'essai · annulation en un clic`;

/** Lien d'inscription ; conserve ?plan= (et ?interval=) quand le visiteur vient d'une carte de plan. */
export function trialHref(opts: { plan?: PlanId; interval?: BillingInterval; signedIn?: boolean; signedInHref?: string } = {}): string {
  const { plan, interval, signedIn = false, signedInHref } = opts;
  if (signedIn && !plan) return signedInHref ?? "/dashboard";
  const base = signedIn ? (signedInHref ?? "/settings/billing") : "/signup";
  if (!plan) return base;
  const qs = new URLSearchParams({ plan });
  if (interval) qs.set("interval", interval);
  return `${base}?${qs.toString()}`;
}
