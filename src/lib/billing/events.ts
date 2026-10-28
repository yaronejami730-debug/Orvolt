import type Stripe from "stripe";
import { EXTRA_SEAT_LOOKUP_PREFIX, PLAN_LIST, planSeats, type PlanId } from "./plans";

export type OrgStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete";

export interface OrgPatch {
  plan?: PlanId;
  seat_limit?: number | null;
  subscription_status?: OrgStatus;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  cancel_at_period_end?: boolean;
  past_due_since?: string | null;
  /** Début de l'ancienneté continue Premium (palier de prix) ; null = hors Premium ou abonnement résilié. */
  premium_since?: string | null;
  extra_seats?: number;
}
export interface OrgState {
  subscription_status: string;
  past_due_since: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  plan?: string | null;
  premium_since?: string | null;
}
export interface Mapped {
  orgId?: string;
  customerId?: string;
  subscriptionId?: string;
  kind: "checkout" | "subscription" | "deleted" | "invoice_paid" | "payment_failed" | "trial_will_end";
  /** Patch calculé à partir de l'état courant de l'organisation ; null = rien à changer. */
  patch: (cur: OrgState) => OrgPatch | null;
  /** L'événement concerne un abonnement précis (contrôle de cohérence avec celui de l'organisation). */
  concerns: "subscription" | "customer";
}

export const HANDLED_EVENTS = [
  "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "invoice.paid", "invoice.payment_failed", "customer.subscription.trial_will_end",
] as const;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (sec: number | null | undefined) => (typeof sec === "number" ? new Date(sec * 1000).toISOString() : null);
const idOf = (v: unknown): string | undefined => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : undefined);
const orgIdOf = (v: unknown): string | undefined => (typeof v === "string" && uuid.test(v) ? v : undefined);

/** Statut Stripe -> statut applicatif. */
export function mapStatus(s: string): OrgStatus {
  switch (s) {
    case "trialing": return "trialing";
    case "active": return "active";
    case "past_due": return "past_due";
    case "unpaid": return "unpaid";
    case "incomplete": return "incomplete";
    default: return "canceled"; // canceled, incomplete_expired, paused…
  }
}

/** Identifie le plan d'un prix : lookup_key, sinon identifiant de prix configuré, sinon metadata.plan. */
export function planOfPrice(price: Stripe.Price | undefined, priceIds: Partial<Record<PlanId, string | undefined>> = {}): PlanId | null {
  if (!price) return null;
  // Les prix par palier du Premium portent la clé du plan suivie de « _tN ».
  const byKey = PLAN_LIST.find((p) => [p.lookupKey, p.lookupKeyYearly].some((k) => price.lookup_key === k || price.lookup_key?.startsWith(`${k}_t`)));
  if (byKey) return byKey.id;
  const byId = PLAN_LIST.find((p) => priceIds[p.id] && priceIds[p.id] === price.id);
  if (byId) return byId.id;
  const meta = price.metadata?.plan;
  return PLAN_LIST.find((p) => p.id === meta)?.id ?? null;
}

const isExtraSeat = (price: Stripe.Price | undefined) => !!price?.lookup_key?.startsWith(EXTRA_SEAT_LOOKUP_PREFIX);

/** Ligne du plan (hors utilisateurs supplémentaires) et nombre d'utilisateurs en plus de l'abonnement. */
function splitItems(sub: Stripe.Subscription, priceIds: Partial<Record<PlanId, string | undefined>>): { plan: PlanId | null; extra: number } {
  const items = sub.items?.data ?? [];
  let plan: PlanId | null = null;
  for (const it of items) if (!isExtraSeat(it.price)) { plan = planOfPrice(it.price, priceIds); if (plan) break; }
  const extra = items.filter((it) => isExtraSeat(it.price)).reduce((n, it) => n + (it.quantity ?? 0), 0);
  return { plan, extra: plan && planSeats(plan) !== null ? extra : 0 };
}

const periodEnd = (sub: Stripe.Subscription): string | null => {
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  return iso(legacy ?? item?.current_period_end);
};

/**
 * Ancienneté continue Premium. Démarre à la première facture (fin d'essai, sinon date de l'événement) ;
 * conservée tant que le même abonnement reste Premium ; remise à zéro dès qu'il est résilié, remplacé ou change de plan.
 */
function premiumSince(plan: PlanId, status: OrgStatus, cur: OrgState, sub: Stripe.Subscription, at: string): Pick<OrgPatch, "premium_since"> {
  if (plan !== "premium" || status === "canceled" || status === "unpaid") return { premium_since: null };
  if (status === "incomplete") return {};
  const sameTenure = cur.plan === "premium" && cur.premium_since && cur.stripe_subscription_id === sub.id;
  return sameTenure ? {} : { premium_since: iso(sub.trial_end) ?? at };
}

/** Traduit un événement Stripe vérifié en modification d'organisation. null = événement non géré. */
export function mapStripeEvent(event: Stripe.Event, priceIds: Partial<Record<PlanId, string | undefined>> = {}): Mapped | null {
  const at = iso(event.created)!;
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode !== "subscription") return null;
      const customerId = idOf(s.customer), subscriptionId = idOf(s.subscription);
      return {
        kind: "checkout", concerns: "customer", orgId: orgIdOf(s.client_reference_id) ?? orgIdOf(s.metadata?.org_id), customerId, subscriptionId,
        patch: () => ({ ...(customerId ? { stripe_customer_id: customerId } : {}), ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}) }),
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const { plan, extra } = splitItems(sub, priceIds);
      if (!plan) return null; // prix inconnu : on ne touche à rien
      const status = mapStatus(sub.status);
      return {
        kind: "subscription", concerns: "subscription", orgId: orgIdOf(sub.metadata?.org_id), customerId: idOf(sub.customer), subscriptionId: sub.id,
        patch: (cur) => ({
          plan, subscription_status: status, stripe_subscription_id: sub.id, ...(idOf(sub.customer) ? { stripe_customer_id: idOf(sub.customer)! } : {}),
          ...(status === "trialing" || status === "active" || status === "past_due" ? { seat_limit: planSeats(plan) === null ? null : planSeats(plan)! + extra, extra_seats: extra } : {}),
          current_period_end: periodEnd(sub), cancel_at_period_end: !!sub.cancel_at_period_end,
          ...(sub.trial_end ? { trial_ends_at: iso(sub.trial_end) } : {}),
          past_due_since: status === "past_due" ? (cur.past_due_since ?? at) : null,
          ...premiumSince(plan, status, cur, sub, at),
        }),
      };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return {
        kind: "deleted", concerns: "subscription", orgId: orgIdOf(sub.metadata?.org_id), customerId: idOf(sub.customer), subscriptionId: sub.id,
        // Résiliation : l'ancienneté Premium est perdue, une reprise repart du prix de départ.
        patch: () => ({ subscription_status: "canceled", cancel_at_period_end: false, past_due_since: null, current_period_end: iso(sub.ended_at ?? sub.canceled_at), premium_since: null }),
      };
    }
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      const meta = (inv as unknown as { subscription_details?: { metadata?: Record<string, string> }; parent?: { subscription_details?: { metadata?: Record<string, string> } } });
      return {
        kind: "invoice_paid", concerns: "customer", customerId: idOf(inv.customer),
        orgId: orgIdOf(meta.subscription_details?.metadata?.org_id) ?? orgIdOf(meta.parent?.subscription_details?.metadata?.org_id),
        patch: (cur) => ({ past_due_since: null, ...(["past_due", "unpaid", "incomplete"].includes(cur.subscription_status) ? { subscription_status: "active" as const } : {}) }),
      };
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const meta = (inv as unknown as { subscription_details?: { metadata?: Record<string, string> }; parent?: { subscription_details?: { metadata?: Record<string, string> } } });
      return {
        kind: "payment_failed", concerns: "customer", customerId: idOf(inv.customer),
        orgId: orgIdOf(meta.subscription_details?.metadata?.org_id) ?? orgIdOf(meta.parent?.subscription_details?.metadata?.org_id),
        patch: (cur) => ({ subscription_status: "past_due", past_due_since: cur.past_due_since ?? at }),
      };
    }
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      return { kind: "trial_will_end", concerns: "subscription", orgId: orgIdOf(sub.metadata?.org_id), customerId: idOf(sub.customer), subscriptionId: sub.id, patch: () => null };
    }
    default:
      return null;
  }
}
