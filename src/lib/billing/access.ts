import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeEntitlement, type BillingOrg, type Entitlement } from "./entitlement";

const TTL = 5_000;
const cache = new Map<string, { exp: number; value: Entitlement }>();
export const invalidateEntitlement = (orgId: string) => void cache.delete(orgId);

const COLS = "plan, subscription_status, trial_ends_at, seat_limit, extra_seats, current_period_end, cancel_at_period_end, past_due_since, stripe_customer_id, stripe_subscription_id";

/** Droits de l'organisation (lecture serveur, cache de 5 s invalidé par chaque webhook Stripe). */
export async function getEntitlement(orgId: string, fresh = false): Promise<Entitlement> {
  const hit = cache.get(orgId);
  if (!fresh && hit && hit.exp > Date.now()) return hit.value;
  const admin = createAdminClient();
  // Une sous-régie n'a pas d'abonnement : droits et places se lisent sur la régie maître, qui paie pour toutes ses sous-régies.
  const { data: self } = await admin.from("organizations").select("parent_org_id").eq("id", orgId).single();
  const billingId = (self?.parent_org_id as string | null) ?? orgId;
  const { data: kids } = await admin.from("organizations").select("id").eq("parent_org_id", billingId);
  const ids = [billingId, ...(kids ?? []).map((k) => k.id as string)];
  const [{ data: org }, { count }] = await Promise.all([
    admin.from("organizations").select(COLS).eq("id", billingId).single(),
    admin.from("memberships").select("id", { count: "exact", head: true }).in("org_id", ids).eq("status", "active").eq("via_parent", false),
  ]);
  const value = computeEntitlement((org ?? { plan: "trial", subscription_status: "canceled", trial_ends_at: null, seat_limit: null, current_period_end: null, cancel_at_period_end: false, past_due_since: null, stripe_customer_id: null, stripe_subscription_id: null }) as BillingOrg, count ?? 0);
  cache.set(orgId, { exp: Date.now() + TTL, value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return value;
}

export async function isWritable(orgId: string): Promise<boolean> {
  return (await getEntitlement(orgId)).writable;
}
