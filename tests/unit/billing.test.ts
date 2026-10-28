import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { computeEntitlement, type BillingOrg } from "@/lib/billing/entitlement";
import { mapStatus, mapStripeEvent, planOfPrice } from "@/lib/billing/events";
import { CURRENCY, GRACE_DAYS, PLAN_LIST, PLANS, TRIAL_DAYS, formatPrice, isPlanId, monthlyEquivalentCents, planSeats } from "@/lib/billing/plans";
import { safeRedirect, buildCheckoutParams, type OrgBilling } from "@/lib/billing/checkout";

const ORG = crypto.randomUUID();
const NOW = new Date("2031-05-10T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const org = (o: Partial<BillingOrg> = {}): BillingOrg => ({ plan: "trial", subscription_status: "trialing", trial_ends_at: day(10), seat_limit: 5, current_period_end: null, cancel_at_period_end: false, past_due_since: null, stripe_customer_id: null, stripe_subscription_id: null, ...o });

describe("plans (source unique)", () => {
  it("Starter 3 / 9,99 €, Pro 8 / 39 €, Business 20 / 79,99 €, Premium illimité / dès 199 €", () => {
    expect(PLAN_LIST.map((p) => [p.id, p.seats, p.priceCents])).toEqual([["starter", 3, 999], ["pro", 8, 3900], ["business", 20, 7999], ["premium", null, 19900]]);
    expect(PLANS.business.highlighted).toBe(true);
    expect(TRIAL_DAYS).toBe(14);
    expect(GRACE_DAYS).toBe(7);
    expect(CURRENCY).toBe("eur");
  });
  it("clés de recherche uniques, sièges croissants, helpers", () => {
    expect(new Set(PLAN_LIST.map((p) => p.lookupKey)).size).toBe(4);
    const seats = PLAN_LIST.map((p) => p.seats ?? Infinity); // null = illimité, donc le plus grand
    expect(seats).toEqual([...seats].sort((a, b) => a - b));
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("enterprise")).toBe(false);
    expect(planSeats("premium")).toBeNull();
    expect(planSeats("trial")).toBeNull();
    expect(formatPrice(3900)).toMatch(/^39\s€$/);
    expect(formatPrice(999)).toMatch(/^9,99\s€$/);
    // annuel : 2 mois offerts = 10 mensualités
    expect(PLAN_LIST.map((p) => p.yearlyPriceCents)).toEqual([9990, 39000, 79990, 199000]);
    expect(PLAN_LIST.every((p) => p.yearlyPriceCents === p.priceCents * 10)).toBe(true);
    expect(PLAN_LIST.map((p) => monthlyEquivalentCents(p))).toEqual([833, 3250, 6666, 16583]);
    expect(new Set([...PLAN_LIST.map((p) => p.lookupKey), ...PLAN_LIST.map((p) => p.lookupKeyYearly)]).size).toBe(8);
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
    // essai sans date de fin : lecture seule des deux côtés (org_is_writable : coalesce(trial_ends_at, now()) > now() est faux)
    expect(computeEntitlement(org({ trial_ends_at: null }), 1, NOW)).toMatchObject({ state: "trial_expired", writable: false, trialDaysLeft: null });
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
      plan: "pro", subscription_status: "active", seat_limit: 8, stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1",
      current_period_end: new Date(1_900_000_000 * 1000).toISOString(), cancel_at_period_end: false, past_due_since: null,
    });
  });
  it("période : ancienne API (sur l'abonnement) prioritaire", () => {
    const m = mapStripeEvent(ev("customer.subscription.created", sub({ current_period_end: 1_700_000_000 })))!;
    expect(m.patch({ subscription_status: "x", past_due_since: null, stripe_subscription_id: null, stripe_customer_id: null })!.current_period_end).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
  it("essai Stripe : trialing + trial_end ; annulation programmée", () => {
    const m = mapStripeEvent(ev("customer.subscription.created", sub({ status: "trialing", trial_end: 1_801_000_000, cancel_at_period_end: true })))!;
    expect(m.patch({ subscription_status: "x", past_due_since: null, stripe_subscription_id: null, stripe_customer_id: null })).toMatchObject({ subscription_status: "trialing", trial_ends_at: new Date(1_801_000_000 * 1000).toISOString(), cancel_at_period_end: true, seat_limit: 8 });
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

describe("Premium : tarif dégressif", () => {
  it("palier selon le mois de facturation, plancher à 24 mois", async () => {
    const { premiumTierCents } = await import("@/lib/billing/premium-tiers");
    const at = (m: number) => premiumTierCents(m);
    expect([1, 2, 3, 5, 6, 8, 9, 11, 12, 17, 18, 23, 24, 60].map(at)).toEqual([19900, 19900, 19400, 19400, 18600, 18600, 17900, 17900, 16900, 16900, 15900, 15900, 14900, 14900]);
    expect(at(1)).toBe(PLANS.premium.priceCents);
  });
  it("mois de la prochaine facture depuis le début d'ancienneté ; clé de prix par palier", async () => {
    const { premiumMonthAt, premiumLookupKey, premiumTierIndex } = await import("@/lib/billing/premium-tiers");
    const since = new Date("2030-01-15T00:00:00Z");
    expect(premiumMonthAt(since, new Date("2030-01-15T00:00:00Z"))).toBe(1);
    expect(premiumMonthAt(since, new Date("2030-02-15T00:00:00Z"))).toBe(2);
    expect(premiumMonthAt(since, new Date("2030-03-15T00:00:00Z"))).toBe(3);
    expect(premiumMonthAt(since, new Date("2031-01-15T00:00:00Z"))).toBe(13); // renouvellement annuel : palier du mois 13
    expect(premiumTierIndex(premiumMonthAt(since, new Date("2032-01-15T00:00:00Z")))).toBe(6);
    expect(premiumLookupKey(PLANS.premium.lookupKey, 0)).toBe("leadforge_premium_monthly");
    expect(premiumLookupKey(PLANS.premium.lookupKey, 3)).toBe("leadforge_premium_monthly_t4");
  });
  it("le prix d'un palier est reconnu comme Premium ; l'ancienneté démarre, se conserve, puis est perdue à la résiliation", () => {
    const tierPrice = price("leadforge_premium_yearly_t5");
    const sub5 = (o: Record<string, unknown> = {}) => ({ id: "sub_p", customer: "cus_1", status: "active", metadata: { org_id: ORG }, trial_end: null, items: { data: [{ id: "si_p", price: tierPrice, current_period_end: 1_900_000_000 }] }, ...o });
    const m = mapStripeEvent(ev("customer.subscription.updated", sub5()))!;
    const base = { subscription_status: "active", past_due_since: null, stripe_customer_id: "cus_1" };
    expect(m.patch({ ...base, plan: "pro", premium_since: null, stripe_subscription_id: "sub_p" })).toMatchObject({ plan: "premium", seat_limit: null, premium_since: expect.any(String) });
    // même abonnement déjà Premium : ancienneté conservée (aucune réécriture)
    expect(m.patch({ ...base, plan: "premium", premium_since: "2030-01-01T00:00:00Z", stripe_subscription_id: "sub_p" })).not.toHaveProperty("premium_since");
    // abonnement remplacé : l'ancienneté repart
    expect(m.patch({ ...base, plan: "premium", premium_since: "2030-01-01T00:00:00Z", stripe_subscription_id: "sub_old" })).toHaveProperty("premium_since", expect.any(String));
    const del = mapStripeEvent(ev("customer.subscription.deleted", sub5({ status: "canceled" })))!;
    expect(del.patch({ ...base, plan: "premium", premium_since: "2030-01-01T00:00:00Z", stripe_subscription_id: "sub_p" })).toMatchObject({ subscription_status: "canceled", premium_since: null });
  });
});

describe("utilisateurs supplémentaires", () => {
  it("sièges = plan + utilisateurs en plus, quel que soit l'ordre des lignes ; Premium : illimité", () => {
    const extra = { id: "si_x", price: price("leadforge_extra_seat_pro_monthly"), quantity: 3, current_period_end: 1_900_000_000 };
    const base = { id: "si_1", price: price(PLANS.pro.lookupKey), quantity: 1, current_period_end: 1_900_000_000 };
    const cur = { subscription_status: "active", past_due_since: null, stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" };
    for (const items of [[base, extra], [extra, base]]) {
      expect(mapStripeEvent(ev("customer.subscription.updated", sub({ items: { data: items } })))!.patch(cur)).toMatchObject({ plan: "pro", seat_limit: 11, extra_seats: 3 });
    }
    expect(mapStripeEvent(ev("customer.subscription.updated", sub({ items: { data: [base] } })))!.patch(cur)).toMatchObject({ seat_limit: 8, extra_seats: 0 });
    const prem = { id: "si_p", price: price(PLANS.premium.lookupKey), quantity: 1, current_period_end: 1_900_000_000 };
    expect(mapStripeEvent(ev("customer.subscription.updated", sub({ items: { data: [prem, extra] } })))!.patch(cur)).toMatchObject({ plan: "premium", seat_limit: null, extra_seats: 0 });
  });
  it("prix dégressif par formule : acheter des sièges à l'unité coûte plus cher que la formule du dessus", async () => {
    const { extraSeatPriceCents, extraSeatLookupKey } = await import("@/lib/billing/plans");
    expect(PLAN_LIST.map((p) => p.extraSeatCents)).toEqual([999, 699, 400, null]);
    expect(extraSeatPriceCents(PLANS.pro, "year")).toBe(6990);
    expect(extraSeatPriceCents(PLANS.premium, "month")).toBeNull();
    expect(extraSeatLookupKey(PLANS.business, "year")).toBe("leadforge_extra_seat_business_yearly");
    const cost = (p: typeof PLANS.starter, n: number) => p.priceCents + Math.max(0, n - (p.seats ?? 0)) * (p.extraSeatCents ?? 0);
    expect(cost(PLANS.starter, 8)).toBeGreaterThan(PLANS.pro.priceCents); // 8 utilisateurs : Pro moins cher que Starter + extras
    expect(cost(PLANS.pro, 20)).toBeGreaterThan(PLANS.business.priceCents); // 20 utilisateurs : Business moins cher que Pro + extras
  });
});

describe("inscription : SIRET", () => {
  it("14 chiffres avec clé de Luhn valide ; espaces tolérés", async () => {
    const { isValidSiret } = await import("@/lib/validation/auth");
    const luhn = (base13: string) => { for (let c = 0; c < 10; c++) { const d = base13 + c; if (isValidSiret(d)) return d; } return ""; };
    const good = luhn("7328293200007");
    expect(good).toHaveLength(14);
    expect(isValidSiret(good)).toBe(true);
    expect(isValidSiret(`${good.slice(0, 3)} ${good.slice(3, 6)} ${good.slice(6, 9)} ${good.slice(9)}`)).toBe(true);
    expect(isValidSiret("12345678901234")).toBe(false);
    expect(isValidSiret("1234")).toBe(false);
    expect(isValidSiret("abcdefghijklmn")).toBe(false);
  });
});

describe("onboarding : étapes avant d'entrer dans l'application", () => {
  const sess = (o: Record<string, unknown> = {}, isAdmin = true) => ({ isAdmin, org: { parent_org_id: null, onboarded_at: null, org_type: null, plan: "trial", ...o } }) as never;
  const prev = { key: process.env.STRIPE_SECRET_KEY, req: process.env.ONBOARDING_REQUIRE_PLAN };
  it("activité d'abord, puis formule (si la facturation est configurée) ; jamais pour un membre, une sous-régie ou une organisation existante", async () => {
    vi.doMock("server-only", () => ({}));
    const { onboardingStep, stepPath, afterOnboardingPath } = await import("@/lib/onboarding");
    process.env.STRIPE_SECRET_KEY = "sk_test_x"; delete process.env.ONBOARDING_REQUIRE_PLAN;
    expect(onboardingStep(sess())).toBe("activite");
    expect(onboardingStep(sess({ org_type: "agency" }))).toBe("plan");
    expect(onboardingStep(sess({ org_type: "agency", plan: "pro" }))).toBeNull();      // essai Stripe démarré
    expect(onboardingStep(sess({}, false))).toBeNull();                                 // membre invité
    expect(onboardingStep(sess({ parent_org_id: "x" }))).toBeNull();                    // sous-régie
    expect(onboardingStep(sess({ onboarded_at: "2026-01-01" }))).toBeNull();            // organisation existante
    process.env.ONBOARDING_REQUIRE_PLAN = "0";
    expect(onboardingStep(sess({ org_type: "agency" }))).toBeNull();                    // formule désactivée (tests)
    delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_API_BASE; delete process.env.ONBOARDING_REQUIRE_PLAN;
    expect(onboardingStep(sess({ org_type: "agency" }))).toBeNull();                    // pas de Stripe en local : étape ignorée
    expect(stepPath("activite")).toBe("/onboarding/activite");
    expect(stepPath("plan")).toBe("/onboarding/plan");
    expect(afterOnboardingPath({ managesSubAgencies: true })).toBe("/settings/partners");
    expect(afterOnboardingPath({ worksWithAgencies: true })).toBe("/settings/partners");
    expect(afterOnboardingPath({ managesInstallers: true })).toBe("/onboarding");
    expect(afterOnboardingPath(null)).toBe("/onboarding");
    if (prev.key) process.env.STRIPE_SECRET_KEY = prev.key; if (prev.req) process.env.ONBOARDING_REQUIRE_PLAN = prev.req;
  });
});
