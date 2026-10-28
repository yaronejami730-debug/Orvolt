import type { Entitlement } from "./entitlement";
import { FEATURE_LABELS, minPlanFor, planHas, roleAllowedForPlan, type PlanFeature, type RoleForPlan } from "./plans";

/**
 * Droit d'accès à une fonctionnalité réservée à un plan (fonction pure).
 * Pendant l'essai (trialing) : accès complet aux fonctionnalités, comme l'annonce l'offre d'essai (« testez avec votre équipe »),
 * sauf le support prioritaire (un service réservé aux abonnés Premium, pas une fonction du produit).
 * Sinon : selon le plan souscrit.
 */
export function entitlementHas(ent: Pick<Entitlement, "state" | "plan">, feature: PlanFeature): boolean {
  return (ent.state === "trialing" && feature !== "priority_support") || planHas(ent.plan, feature);
}

/** Peut-on attribuer ce rôle ? Essai : tous les rôles ; sinon selon le plan (roleAllowedForPlan). */
export function entitlementAllowsRole(ent: Pick<Entitlement, "state" | "plan">, role: RoleForPlan): boolean {
  return ent.state === "trialing" || roleAllowedForPlan(ent.plan, role);
}

/** Message renvoyé par les actions serveur refusées faute de plan. */
export const featureLockedMessage = (feature: PlanFeature) => `${FEATURE_LABELS[feature]} : disponible avec le plan ${minPlanFor(feature).name}. Rendez-vous dans Paramètres > Facturation.`;

/** Message renvoyé quand le rôle choisi n'est pas inclus dans le plan. */
export const roleLockedMessage = (roleName: string) => `Le rôle « ${roleName} » est disponible avec le plan ${minPlanFor("specialized_roles").name}. Rendez-vous dans Paramètres > Facturation.`;
