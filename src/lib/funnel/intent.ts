/** Logique PURE du tunnel d'inscription (sans accès base) : intention de plan, source d'acquisition, reprise d'étape. */
import { BILLING_INTERVALS, PLAN_IDS, type BillingInterval, type PlanId } from "@/lib/billing/plans";

export const FUNNEL_STEPS = ["signup_started", "email_verified", "account_created", "onboarding_done", "checkout_opened", "trial_started", "subscription_active"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface PlanIntent { plan: PlanId | null; interval: BillingInterval }

const first = (v: unknown): string | undefined => (Array.isArray(v) ? first(v[0]) : typeof v === "string" ? v : undefined);

/** ?plan=&interval= venant des CTA / de la page tarifs. Valeur inconnue ou mal formée : ignorée (jamais d'erreur). Intervalle par défaut : mensuel. */
export function parsePlanIntent(plan: unknown, interval: unknown): PlanIntent {
  const p = first(plan)?.trim().toLowerCase();
  const i = first(interval)?.trim().toLowerCase();
  return {
    plan: (PLAN_IDS as readonly string[]).includes(p ?? "") ? (p as PlanId) : null,
    interval: (BILLING_INTERVALS as readonly string[]).includes(i ?? "") ? (i as BillingInterval) : "month",
  };
}

/** Intention relue depuis organizations.onboarding (jsonb : jamais fiable, on revalide). */
export function intentFromAnswers(answers: unknown): PlanIntent {
  const a = answers && typeof answers === "object" ? (answers as Record<string, unknown>) : {};
  return parsePlanIntent(a.planIntent, a.intervalIntent);
}

/** Source d'acquisition (?src= ou utm_source) : minuscules/chiffres/tirets, 30 caractères maximum, sinon null. */
export function sanitizeSource(v: unknown): string | null {
  const s = first(v)?.trim().toLowerCase();
  return s && /^[a-z0-9][a-z0-9_-]{0,29}$/.test(s) ? s : null;
}

export type OnboardingStepId = "activite" | "plan";

/**
 * Reprise du parcours : étape restante pour le super administrateur d'une organisation qui n'a pas fini.
 * null = accès libre (sous-régie, membre invité, onboarding terminé, ou formule non exigée).
 */
export function resumeStep(o: { isAdmin: boolean; parentOrgId: string | null; onboardedAt: string | null; orgType: string | null; plan: string | null; planRequired: boolean }): OnboardingStepId | null {
  if (!o.isAdmin || o.parentOrgId || o.onboardedAt) return null;
  if (!o.orgType) return "activite";
  if (o.planRequired && o.plan === "trial") return "plan";
  return null;
}

/** Date de la première échéance : fin de l'essai (aujourd'hui + durée). */
export const firstChargeAt = (now: number, trialDays: number): Date => new Date(now + trialDays * 86_400_000);
