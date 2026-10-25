import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeEntitlement, type BillingOrg, type Entitlement } from "./entitlement";

const TTL = 5_000;
const cache = new Map<string, { exp: number; value: Entitlement }>();
export const invalidateEntitlement = (orgId: string) => void cache.delete(orgId);

const COLS = "plan, subscription_status, trial_ends_at, seat_limit, current_period_end, cancel_at_period_end, past_due_since, stripe_customer_id, stripe_subscription_id";

/** Droits de l'organisation (lecture serveur, cache de 5 s invalidé par chaque webhook Stripe). */
export async function getEntitlement(orgId: string, fresh = false): Promise<Entitlement> {
  const hit = cache.get(orgId);
  if (!fresh && hit && hit.exp > Date.now()) return hit.value;
  const admin = createAdminClient();
  const [{ data: org }, { count }] = await Promise.all([
    admin.from("organizations").select(COLS).eq("id", orgId).single(),
    admin.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active"),
  ]);
  const value = computeEntitlement((org ?? { plan: "trial", subscription_status: "canceled", trial_ends_at: null, seat_limit: null, current_period_end: null, cancel_at_period_end: false, past_due_since: null, stripe_customer_id: null, stripe_subscription_id: null }) as BillingOrg, count ?? 0);
  cache.set(orgId, { exp: Date.now() + TTL, value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return value;
}

export async function isWritable(orgId: string): Promise<boolean> {
  return (await getEntitlement(orgId)).writable;
}
