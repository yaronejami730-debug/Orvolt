import "server-only";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { resumeStep } from "@/lib/funnel/intent";
import type { AppSession } from "@/lib/session";

/** La formule est exigée à l'inscription si la facturation est configurée (ONBOARDING_REQUIRE_PLAN=0 la désactive : tests). */
export const planRequired = (): boolean => isBillingConfigured() && process.env.ONBOARDING_REQUIRE_PLAN !== "0";

/** Sans clé Stripe, hors production : le paiement est SIMULÉ pour pouvoir voir et tester le parcours (aucune carte, aucun prélèvement). */
export const simulateBilling = (): boolean => !isBillingConfigured() && process.env.NODE_ENV !== "production";

export type OnboardingStep = "activite" | "plan";

/**
 * Étape à terminer avant d'entrer dans l'application. Concerne le super administrateur d'une organisation qui n'a pas encore
 * fini son onboarding (jamais une sous-régie, ni un membre invité). null = accès libre.
 */
export function onboardingStep(s: Pick<AppSession, "isAdmin" | "org">): OnboardingStep | null {
  return resumeStep({ isAdmin: s.isAdmin, parentOrgId: s.org.parent_org_id, onboardedAt: s.org.onboarded_at, orgType: s.org.org_type, plan: s.org.plan, planRequired: planRequired() });
}
export const stepPath = (step: OnboardingStep) => (step === "activite" ? "/onboarding/activite" : "/onboarding/plan");

/** Où aller une fois l'onboarding terminé : régies partenaires si le gérant en a, sinon la synthèse de l'espace. */
export function afterOnboardingPath(answers: Record<string, unknown> | null | undefined): string {
  return answers && (answers.managesSubAgencies === true || answers.worksWithAgencies === true || answers.alsoAgency === true) ? "/settings/partners" : "/onboarding";
}
