import "server-only";
import { getEntitlement } from "./access";
import { entitlementAllowsRole, entitlementHas, featureLockedMessage, roleLockedMessage } from "./features";
import type { PlanFeature, RoleForPlan } from "./plans";

/** La fonctionnalité est-elle disponible pour cette organisation (essai complet, sinon selon le plan) ? */
export async function hasFeature(orgId: string, feature: PlanFeature): Promise<boolean> {
  return entitlementHas(await getEntitlement(orgId), feature);
}

/** Garde serveur : renvoie un message d'erreur si le plan ne donne pas accès, sinon null. */
export async function featureError(orgId: string, feature: PlanFeature): Promise<string | null> {
  return (await hasFeature(orgId, feature)) ? null : featureLockedMessage(feature);
}

/** Garde serveur d'attribution d'un rôle (nouveau membre, changement de rôle) : message d'erreur si le plan ne l'inclut pas, sinon null. */
export async function roleError(orgId: string, role: RoleForPlan): Promise<string | null> {
  return entitlementAllowsRole(await getEntitlement(orgId), role) ? null : roleLockedMessage(role.name);
}
