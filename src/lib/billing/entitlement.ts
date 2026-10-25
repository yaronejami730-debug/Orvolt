import { GRACE_DAYS, planSeats } from "./plans";

/** Ligne organisations utile à la facturation. */
export interface BillingOrg {
  plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  seat_limit: number | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export type EntitlementState =
  | "trialing" // essai (applicatif ou Stripe) en cours
  | "active" // abonnement actif
  | "past_due" // paiement échoué, délai de grâce en cours
  | "trial_expired" // essai terminé sans abonnement
  | "canceled" // abonnement annulé / impayé / incomplet
  ;

export interface Entitlement {
  state: EntitlementState;
  /** Écritures autorisées (sinon lecture seule). */
  writable: boolean;
  plan: string;
  /** Jours d'essai restants (essai en cours). */
  trialDaysLeft: number | null;
  /** Fin du délai de grâce (paiement échoué). */
  graceEndsAt: Date | null;
  seatLimit: number | null;
  seatsUsed: number;
  /** Plus de membres actifs que de sièges (rétrogradation) : ajout bloqué, désactivation demandée. */
  seatsExceeded: boolean;
  seatsOver: number;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
}

const DAY = 86_400_000;

/** Calcule les droits d'une organisation (fonction pure). Reflète public.org_is_writable côté base. */
export function computeEntitlement(org: BillingOrg, seatsUsed: number, now = new Date()): Entitlement {
  const trialEnd = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const status = org.subscription_status;
  let state: EntitlementState;
  let writable = false;
  let graceEndsAt: Date | null = null;
  let trialDaysLeft: number | null = null;

  if (status === "active") {
    state = "active";
    writable = true;
  } else if (status === "trialing") {
    if (!trialEnd || trialEnd.getTime() > now.getTime()) {
      state = "trialing";
      writable = true;
      trialDaysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / DAY)) : null;
    } else {
      state = org.stripe_subscription_id ? "canceled" : "trial_expired";
    }
  } else if (status === "past_due") {
    graceEndsAt = new Date((org.past_due_since ? new Date(org.past_due_since).getTime() : now.getTime()) + GRACE_DAYS * DAY);
    if (graceEndsAt.getTime() > now.getTime()) {
      state = "past_due";
      writable = true;
    } else {
      state = "canceled";
      graceEndsAt = null;
    }
  } else {
    state = "canceled";
  }
  const seatLimit = org.seat_limit;
  const over = seatLimit === null ? 0 : Math.max(0, seatsUsed - seatLimit);
  return {
    state, writable, plan: org.plan, trialDaysLeft, graceEndsAt, seatLimit, seatsUsed,
    seatsExceeded: over > 0, seatsOver: over,
    periodEnd: org.current_period_end ? new Date(org.current_period_end) : null,
    cancelAtPeriodEnd: org.cancel_at_period_end,
    hasSubscription: !!org.stripe_subscription_id,
  };
}

export const READ_ONLY_MESSAGE = "Abonnement inactif : lecture seule. Rendez-vous dans Paramètres > Facturation.";

/** Sièges attendus pour un plan Stripe (cohérence plan/seat_limit). */
export const seatsForPlan = (plan: string): number | null => planSeats(plan);
