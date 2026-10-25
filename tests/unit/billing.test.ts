import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { computeEntitlement, type BillingOrg } from "@/lib/billing/entitlement";
import { mapStatus, mapStripeEvent, planOfPrice } from "@/lib/billing/events";
import { CURRENCY, GRACE_DAYS, PLAN_LIST, PLANS, TRIAL_DAYS, TRIAL_SEATS, formatPrice, isPlanId, monthlyEquivalentCents, planSeats } from "@/lib/billing/plans";
import { safeRedirect, buildCheckoutParams, type OrgBilling } from "@/lib/billing/checkout";

const ORG = crypto.randomUUID();
const NOW = new Date("2031-05-10T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const org = (o: Partial<BillingOrg> = {}): BillingOrg => ({ plan: "trial", subscription_status: "trialing", trial_ends_at: day(10), seat_limit: 5, current_period_end: null, cancel_at_period_end: false, past_due_since: null, stripe_customer_id: null, stripe_subscription_id: null, ...o });

describe("plans (source unique)", () => {
  it("Starter 3 / 9,90 €, Pro 10 / 79 €, Business illimité / 199 €", () => {
    expect(PLAN_LIST.map((p) => [p.id, p.seats, p.priceCents])).toEqual([["starter", 3, 990], ["pro", 10, 7900], ["business", null, 19900]]);
    expect(PLANS.pro.highlighted).toBe(true);
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_SEATS).toBe(5);
    expect(GRACE_DAYS).toBe(7);
    expect(CURRENCY).toBe("eur");
  });
  it("clés de recherche uniques, sièges croissants, helpers", () => {
    expect(new Set(PLAN_LIST.map((p) => p.lookupKey)).size).toBe(3);
    const seats = PLAN_LIST.map((p) => p.seats ?? Infinity); // null = illimité, donc le plus grand
    expect(seats).toEqual([...seats].sort((a, b) => a - b));
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("enterprise")).toBe(false);
    expect(planSeats("business")).toBeNull();
    expect(planSeats("trial")).toBeNull();
    expect(formatPrice(7900)).toMatch(/^79\s€$/);
    expect(formatPrice(990)).toMatch(/^9,90\s€$/);
    // annuel : 2 mois offerts = 10 mensualités
    expect(PLAN_LIST.map((p) => p.yearlyPriceCents)).toEqual([9900, 79000, 199000]);
    expect(PLAN_LIST.every((p) => p.yearlyPriceCents === p.priceCents * 10)).toBe(true);
    expect(PLAN_LIST.map((p) => monthlyEquivalentCents(p))).toEqual([825, 6583, 16583]);
    expect(new Set([...PLAN_LIST.map((p) => p.lookupKey), ...PLAN_LIST.map((p) => p.lookupKeyYearly)]).size).toBe(6);
  });
});

describe("droits (entitlement)", () => {
  it("essai applicatif en cours : écriture, jours restants", () => {
    const e = computeEntitlement(org(), 2, NOW);
    expect(e).toMatchObject({ state: "trialing", writable: true, trialDaysLeft: 10, seatsExceeded: false, hasSubscription: false });
  });
  it("essai expiré sans abonnement : lecture seule ; avec abonnement : annulé", () => {
    expect(computeEntitlement(org({ trial_ends_at: day(-1) }), 1, NOW)).toMatchObject({ state: "trial_expired", writable: false });
    expect(computeEntitlement(org({ trial_ends_at: day(-1), stripe_subscription_id: "sub_1" }), 1, NOW)).toMatchObject({ state: "canceled", writable: false });
    expect(computeEntitlement(org({ trial_ends_at: NOW.toISOString() }), 1, NOW).writable).toBe(false); // borne : expire à l'instant
  });
  it("actif : écriture ; annulé / impayé / incomplet : lecture seule", () => {
    expect(computeEntitlement(org({ subscription_status: "active", plan: "pro", seat_limit: 10 }), 4, NOW)).toMatchObject({ state: "active", writable: true });
    for (const s of ["canceled", "unpaid", "incomplete"]) expect(computeEntitlement(org({ subscription_status: s }), 1, NOW)).toMatchObject({ state: "canceled", writable: false });
  });
  it("paiement échoué : écriture pendant 7 jours de grâce, puis lecture seule", () => {
    const inGrace = computeEntitlement(org({ subscription_status: "past_due", past_due_since: day(-6) }), 1, NOW);
    expect(inGrace).toMatchObject({ state: "past_due", writable: true });
    expect(inGrace.graceEndsAt!.getTime()).toBe(new Date(day(1)).getTime());
    expect(computeEntitlement(org({ subscription_status: "past_due", past_due_since: day(-7) }), 1, NOW)).toMatchObject({ state: "canceled", writable: false });
    expect(computeEntitlement(org({ subscription_status: "past_due", past_due_since: day(-8) }), 1, NOW).writable).toBe(false);
  });
  it("rétrogradation : sièges dépassés signalés sans bloquer les données", () => {
    const e = computeEntitlement(org({ subscription_status: "active", plan: "starter", seat_limit: 3 }), 7, NOW);
    expect(e).toMatchObject({ seatsExceeded: true, seatsOver: 4, writable: true, seatLimit: 3 });
    expect(computeEntitlement(org({ subscription_status: "active", seat_limit: 10 }), 10, NOW).seatsExceeded).toBe(false);
    expect(computeEntitlement(org({ subscription_status: "active", seat_limit: null }), 99, NOW).seatsExceeded).toBe(false);
  });
});

// --- Événements Stripe -> état de l'organisation
const price = (lookup: string, id = "price_x"): Stripe.Price => ({ id, lookup_key: lookup, metadata: {} } as unknown as Stripe.Price);
const sub = (o: Record<string, unknown> = {}) => ({
  id: "sub_1", customer: "cus_1", status: "active", metadata: { org_id: ORG }, cancel_at_period_end: false, trial_end: null,
  items: { data: [{ id: "si_1", price: price(PLANS.pro.lookupKey), current_period_end: 1_900_000_000 }] }, ...o,
});
const ev = (type: string, object: unknown, created = 1_800_000_000) => ({ id: `evt_${type}`, type, created, data: { object } }) as unknown as Stripe.Event;

describe("mapStripeEvent", () => {
  it("souscription active : plan, statut, sièges, échéance (nouvelle API : période sur l'item)", () => {
    const m = mapStripeEvent(ev("customer.subscription.updated", sub()))!;
    expect(m).toMatchObject({ orgId: ORG, customerId: "cus_1", subscriptionId: "sub_1", kind: "subscription" });
    expect(m.patch({ subscription_status: "trialing", past_due_since: null, stripe_subscription_id: null, stripe_customer_id: null })).toMatchObject({
      plan: "pro", subscription_status: "active", seat_limit: 10, stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1",
      current_period_end: new Date(1_900_000_000 * 1000).toISOString(), cancel_at_period_end: false, past_due_since: null,
    });
  });
  it("période : ancienne API (sur l'abonnement) prioritaire", () => {
    const m = mapStripeEvent(ev("customer.subscription.created", sub({ current_period_end: 1_700_000_000 })))!;
    expect(m.patch({ subscription_status: "x", past_due_since: null, stripe_subscription_id: null, stripe_customer_id: null })!.current_period_end).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
  it("essai Stripe : trialing + trial_end ; annulation programmée", () => {
    const m = mapStripeEvent(ev("customer.subscription.created", sub({ status: "trialing", trial_end: 1_801_000_000, cancel_at_period_end: true })))!;
    expect(m.patch({ subscription_status: "x", past_due_since: null, stripe_subscription_id: null, stripe_customer_id: null })).toMatchObject({ subscription_status: "trialing", trial_ends_at: new Date(1_801_000_000 * 1000).toISOString(), cancel_at_period_end: true, seat_limit: 10 });
  });
  it("past_due : horodatage de début conservé s'il existe", () => {
    const m = mapStripeEvent(ev("customer.subscription.updated", sub({ status: "past_due" })))!;
    const cur = { subscription_status: "active", stripe_subscription_id: null, stripe_customer_id: null };
    expect(m.patch({ ...cur, past_due_since: null })!.past_due_since).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(m.patch({ ...cur, past_due_since: "2031-01-01T00:00:00.000Z" })!.past_due_since).toBe("2031-01-01T00:00:00.000Z");
  });
  it("prix inconnu : événement ignoré (aucun changement)", () => {
    expect(mapStripeEvent(ev("customer.subscription.updated", sub({ items: { data: [{ price: price("autre_produit") }] } })))).toBeNull();
  });
  it("suppression : annulé ; paiement échoué : past_due ; facture payée : retour à actif", () => {
    const base = { subscription_status: "active", past_due_since: null, stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" };
    expect(mapStripeEvent(ev("customer.subscription.deleted", sub({ status: "canceled" })))!.patch(base)).toMatchObject({ subscription_status: "canceled", cancel_at_period_end: false });
    const failed = mapStripeEvent(ev("invoice.payment_failed", { customer: "cus_1", subscription_details: { metadata: { org_id: ORG } } }))!;
    expect(failed).toMatchObject({ orgId: ORG, customerId: "cus_1", kind: "payment_failed" });
    expect(failed.patch(base)).toMatchObject({ subscription_status: "past_due" });
    const paid = mapStripeEvent(ev("invoice.paid", { customer: "cus_1" }))!;
    expect(paid.patch({ ...base, subscription_status: "past_due", past_due_since: "x" })).toMatchObject({ subscription_status: "active", past_due_since: null });
    expect(paid.patch(base)).toEqual({ past_due_since: null }); // actif : statut inchangé
    expect(paid.orgId).toBeUndefined(); // retrouvée par le client Stripe lié
  });
  it("checkout terminé : lie client et abonnement ; ignoré hors mode abonnement", () => {
    const m = mapStripeEvent(ev("checkout.session.completed", { mode: "subscription", client_reference_id: ORG, customer: "cus_9", subscription: "sub_9", metadata: {} }))!;
    expect(m).toMatchObject({ orgId: ORG, customerId: "cus_9", subscriptionId: "sub_9" });
    expect(m.patch({ subscription_status: "trialing", past_due_since: null, stripe_subscription_id: null, stripe_customer_id: null })).toEqual({ stripe_customer_id: "cus_9", stripe_subscription_id: "sub_9" });
    expect(mapStripeEvent(ev("checkout.session.completed", { mode: "payment" }))).toBeNull();
  });
  it("fin d'essai : aucun changement d'état ; org_id non-uuid ignoré ; type inconnu ignoré", () => {
    expect(mapStripeEvent(ev("customer.subscription.trial_will_end", sub()))!.patch({ subscription_status: "trialing", past_due_since: null, stripe_subscription_id: null, stripe_customer_id: null })).toBeNull();
    expect(mapStripeEvent(ev("customer.subscription.updated", sub({ metadata: { org_id: "'; drop table organizations;--" } })))!.orgId).toBeUndefined();
    expect(mapStripeEvent(ev("charge.refunded", {}))).toBeNull();
  });
  it("statuts et reconnaissance du plan", () => {
    expect([mapStatus("trialing"), mapStatus("active"), mapStatus("past_due"), mapStatus("unpaid"), mapStatus("incomplete"), mapStatus("incomplete_expired"), mapStatus("canceled"), mapStatus("paused")]).toEqual(["trialing", "active", "past_due", "unpaid", "incomplete", "canceled", "canceled", "canceled"]);
    expect(planOfPrice(price("x", "price_B"), { business: "price_B" })).toBe("business");
    expect(planOfPrice({ id: "p", lookup_key: null, metadata: { plan: "starter" } } as unknown as Stripe.Price)).toBe("starter");
    expect(planOfPrice(undefined)).toBeNull();
  });
});

describe("Checkout", () => {
  const o: OrgBilling = { id: ORG, name: "Acme", stripe_customer_id: "cus_1", stripe_subscription_id: null, subscription_status: "trialing" };
  const env = { NEXT_PUBLIC_APP_URL: "https://app.example.com/" };
  it("paramètres : abonnement, essai 14 j carte requise, org et plan en métadonnées, URLs de retour", () => {
    const p = buildCheckoutParams(o, "pro", "price_pro", "cus_1", env);
    expect(p).toMatchObject({
      mode: "subscription", customer: "cus_1", client_reference_id: ORG, line_items: [{ price: "price_pro", quantity: 1 }],
      payment_method_collection: "always", metadata: { org_id: ORG, plan: "pro" }, subscription_data: { trial_period_days: 14, metadata: { org_id: ORG, plan: "pro" } },
      success_url: "https://app.example.com/settings/billing?checkout=success", cancel_url: "https://app.example.com/settings/billing?checkout=cancel",
    });
    expect((p as Record<string, unknown>).payment_method_types).toBeUndefined(); // moyens de paiement automatiques (Apple Pay / Google Pay)
  });
  it("pas de nouvel essai pour une organisation qui a déjà souscrit", () => {
    expect(buildCheckoutParams({ ...o, stripe_subscription_id: "sub_old" }, "pro", "price_pro", "cus_1", env).subscription_data!.trial_period_days).toBeUndefined();
  });
  it("redirections : https stripe.com uniquement (mock autorisé en développement)", () => {
    expect(safeRedirect("https://checkout.stripe.com/c/pay/x", false)).toContain("checkout.stripe.com");
    expect(safeRedirect("https://billing.stripe.com/p/session/x", false)).toContain("billing.stripe.com");
    for (const bad of ["http://checkout.stripe.com/x", "https://evil.example.com/x", "https://stripe.com.evil.io/x", "javascript:alert(1)"]) expect(() => safeRedirect(bad, false)).toThrow();
    expect(safeRedirect("https://x.dev.stripe.me/session", true)).toContain("stripe.me");
  });
});
