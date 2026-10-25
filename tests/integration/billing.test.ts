import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { getEntitlement, invalidateEntitlement } from "@/lib/billing/access";
import { BillingError, changePlan, createCheckout, createPortal, type OrgBilling } from "@/lib/billing/checkout";
import { PLANS } from "@/lib/billing/plans";
import { getStripe } from "@/lib/billing/stripe";
import { generateToken, newEndpointSecret } from "@/lib/inbound/auth";
import { processInbound } from "@/lib/inbound/handler";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Math.random().toString(36).slice(2, 8);
const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const orgs: string[] = [];
const userIds: string[] = [];
let clock = 1_900_000_000;

async function mkUser(tag: string) {
  const { data } = await admin.auth.admin.createUser({ email: `bill-${tag}-${run}@test.local`, password: "Passw0rd!test", email_confirm: true });
  userIds.push(data.user!.id);
  return data.user!.id;
}
async function mkOrg(tag: string, extra: Record<string, unknown> = {}, members = 1) {
  const owner = await mkUser(`${tag}-o`);
  const { data, error } = await admin.from("organizations").insert({ name: `BILL ${tag} ${run}`, slug: `bill-${tag}-${run}`, template: "generic", created_by: owner, ...extra }).select("id").single();
  if (error) throw error;
  const id = data.id as string;
  orgs.push(id);
  await admin.from("statuses").insert({ org_id: id, name: "Nouveau", color: "#3b82f6", is_initial: true });
  const adminRole = (await admin.from("roles").insert({ org_id: id, name: "Admin", is_admin: true, is_system: true, permissions: [] }).select("id").single()).data!.id;
  const userRole = (await admin.from("roles").insert({ org_id: id, name: "Membre", permissions: ["leads.create", "leads.edit", "leads.view_all"] }).select("id").single()).data!.id;
  await admin.from("profiles").update({ provisioned_org: id }).eq("id", owner);
  await admin.from("memberships").insert({ org_id: id, user_id: owner, role_id: adminRole });
  const extraUsers: string[] = [];
  for (let i = 1; i < members; i++) {
    const u = await mkUser(`${tag}-m${i}`);
    await admin.from("profiles").update({ provisioned_org: id }).eq("id", u);
    await admin.from("memberships").insert({ org_id: id, user_id: u, role_id: userRole });
    extraUsers.push(u);
  }
  return { id, owner, userRole, extraUsers };
}
const orgRow = async (id: string) => (await admin.from("organizations").select("*").eq("id", id).single()).data!;

const price = (key: string) => ({ id: `price_${key}`, lookup_key: key, metadata: {} });
const cus = (orgId: string) => `cus_${orgId.slice(0, 8)}`;
const sid = (orgId: string) => `sub_${orgId.slice(0, 8)}`;
const subObj = (orgId: string, o: Record<string, unknown> = {}) => ({
  id: sid(orgId), customer: cus(orgId), status: "active", metadata: { org_id: orgId }, cancel_at_period_end: false, trial_end: null,
  items: { data: [{ id: "si_1", price: price(PLANS.pro.lookupKey), current_period_end: 1_950_000_000 }] }, ...o,
});
let evN = 0;
const event = (type: string, object: unknown, created = ++clock) => ({ id: `evt_${run}_${++evN}`, object: "event", type, created, data: { object } });
const sign = (payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) => Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
const send = (e: unknown, opts: { secret?: string; timestamp?: number; body?: string; header?: string | null } = {}) => {
  const payload = JSON.stringify(e);
  const header = opts.header === undefined ? sign(payload, opts.secret ?? SECRET, opts.timestamp) : opts.header;
  return stripeWebhook(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", body: opts.body ?? payload, headers: { ...(header ? { "stripe-signature": header } : {}), "content-type": "application/json" } }));
};

beforeAll(() => { vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"); });
afterAll(async () => {
  for (const id of orgs) await admin.from("organizations").delete().eq("id", id);
  for (const u of userIds) await admin.auth.admin.deleteUser(u);
});

describe("webhook Stripe : signature", () => {
  it("signature valide : 200 ; événement inconnu accepté et ignoré", async () => {
    const r = await send(event("charge.refunded", {}));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ received: true, result: "ignored" });
  });
  it("signature invalide, absente, corps modifié, mauvais secret : 400, aucun effet", async () => {
    const o = await mkOrg("sig");
    const e = event("customer.subscription.updated", subObj(o.id));
    const good = JSON.stringify(e);
    expect((await send(e, { secret: "whsec_autre" })).status).toBe(400);
    expect((await send(e, { header: null })).status).toBe(400);
    expect((await send(e, { header: "t=1,v1=abc" })).status).toBe(400);
    expect((await send(e, { body: good.replace("active", "canceled"), header: sign(good) })).status).toBe(400); // corps altéré après signature
    expect((await orgRow(o.id)).plan).toBe("trial");
    expect((await admin.from("stripe_events").select("id").eq("id", e.id)).data).toEqual([]);
  });
  it("horodatage trop ancien (rejeu différé) : 400 ; dans la tolérance : 200", async () => {
    const o = await mkOrg("old");
    const e = event("customer.subscription.updated", subObj(o.id));
    expect((await send(e, { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(400);
    expect((await send(e, { timestamp: Math.floor(Date.now() / 1000) - 120 })).status).toBe(200);
  });
  it("sans STRIPE_WEBHOOK_SECRET : 503 (jamais d'événement non vérifié)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await send(event("charge.refunded", {}))).status).toBe(503);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  });
  it("corps démesuré : 413", async () => {
    const r = await stripeWebhook(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", body: "x".repeat(1_100_000), headers: { "stripe-signature": "t=1,v1=a" } }));
    expect(r.status).toBe(413);
  });
});

describe("webhook Stripe : état de l'organisation", () => {
  it("souscription : checkout terminé puis abonnement actif Pro (10 sièges), idempotent", async () => {
    const o = await mkOrg("flow");
    const co = event("checkout.session.completed", { mode: "subscription", client_reference_id: o.id, customer: cus(o.id), subscription: sid(o.id), metadata: { org_id: o.id } });
    expect(await (await send(co)).json()).toMatchObject({ result: "processed" });
    expect(await orgRow(o.id)).toMatchObject({ stripe_customer_id: cus(o.id), stripe_subscription_id: sid(o.id), plan: "trial" });
    const up = event("customer.subscription.updated", subObj(o.id));
    expect(await (await send(up)).json()).toMatchObject({ result: "processed" });
    expect(await orgRow(o.id)).toMatchObject({ plan: "pro", subscription_status: "active", seat_limit: 10, cancel_at_period_end: false, past_due_since: null });
    expect(new Date((await orgRow(o.id)).current_period_end).toISOString()).toBe(new Date(1_950_000_000 * 1000).toISOString());
    // même événement rejoué : aucun nouvel effet
    expect(await (await send(up)).json()).toMatchObject({ result: "duplicate" });
    expect(await (await send(co)).json()).toMatchObject({ result: "duplicate" });
    expect((await admin.from("stripe_events").select("id").eq("org_id", o.id)).data).toHaveLength(2);
    expect((await getEntitlement(o.id, true))).toMatchObject({ state: "active", writable: true, seatLimit: 10 });
  });
  it("ordre : un événement plus ancien que le dernier appliqué est ignoré", async () => {
    const o = await mkOrg("order");
    await send(event("customer.subscription.updated", subObj(o.id), 1_900_100_000));
    const stale = event("customer.subscription.updated", subObj(o.id, { status: "canceled" }), 1_900_000_500);
    expect(await (await send(stale)).json()).toMatchObject({ result: "ignored" });
    expect((await orgRow(o.id)).subscription_status).toBe("active");
    expect((await admin.from("stripe_events").select("detail").eq("id", stale.id).single()).data!.detail).toBe("out_of_order");
  });
  it("paiement échoué : délai de grâce de 7 jours ; facture payée : retour à actif", async () => {
    const o = await mkOrg("pay");
    await send(event("customer.subscription.updated", subObj(o.id)));
    const failed = event("invoice.payment_failed", { customer: cus(o.id), subscription_details: { metadata: { org_id: o.id } } });
    expect(await (await send(failed)).json()).toMatchObject({ result: "processed" });
    let row = await orgRow(o.id);
    expect(row.subscription_status).toBe("past_due");
    expect(row.past_due_since).not.toBeNull();
    expect((await admin.rpc("org_is_writable", { org: o.id })).data).toBe(true);
    expect((await getEntitlement(o.id, true)).state).toBe("past_due");
    expect((await admin.from("notifications").select("id").eq("org_id", o.id).eq("type", "billing")).data!.length).toBeGreaterThan(0);
    await admin.from("organizations").update({ past_due_since: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("id", o.id);
    expect((await admin.rpc("org_is_writable", { org: o.id })).data).toBe(false);
    // retrouvée par le client Stripe lié (sans métadonnées)
    expect(await (await send(event("invoice.paid", { customer: cus(o.id) }))).json()).toMatchObject({ result: "processed", });
    row = await orgRow(o.id);
    expect(row).toMatchObject({ subscription_status: "active", past_due_since: null });
    expect((await admin.rpc("org_is_writable", { org: o.id })).data).toBe(true);
  });
  it("annulation : lecture seule en base (client authentifié) mais pas pour le service_role ; données conservées", async () => {
    const o = await mkOrg("cancel");
    await admin.from("leads").insert({ org_id: o.id, status_id: (await admin.from("statuses").select("id").eq("org_id", o.id).single()).data!.id, last_name: "Existant", created_by: o.owner });
    await send(event("customer.subscription.updated", subObj(o.id)));
    // client authentifié (membre) : écriture possible tant que l'abonnement est actif
    const email = `bill-cancel-o-${run}@test.local`;
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email, password: "Passw0rd!test" });
    const st = (await admin.from("statuses").select("id").eq("org_id", o.id).single()).data!.id;
    const mk = (n: string) => c.from("leads").insert({ org_id: o.id, status_id: st, last_name: n, created_by: o.owner });
    expect((await mk("Avant")).error).toBeNull();
    expect(await (await send(event("customer.subscription.deleted", subObj(o.id, { status: "canceled" })))).json()).toMatchObject({ result: "processed" });
    expect((await orgRow(o.id)).subscription_status).toBe("canceled");
    const blocked = await mk("Après");
    expect(blocked.error?.message).toContain("org_read_only");
    expect((await c.from("leads").update({ first_name: "x" }).eq("org_id", o.id)).error?.message).toContain("org_read_only");
    expect((await c.from("leads").select("id").eq("org_id", o.id)).data!.length).toBeGreaterThanOrEqual(2); // lecture intacte
    expect((await admin.from("leads").insert({ org_id: o.id, status_id: st, last_name: "Service" })).error).toBeNull();
    expect((await getEntitlement(o.id, true))).toMatchObject({ state: "canceled", writable: false });
  });
  it("webhooks entrants (S5) : 402 quand l'organisation est en lecture seule", async () => {
    const o = await mkOrg("inb", { subscription_status: "canceled" });
    const id = crypto.randomUUID();
    const s = newEndpointSecret(id, 1);
    const token = generateToken();
    await admin.from("inbound_endpoints").insert({ id, org_id: o.id, name: "t", kind: "generic", token, secret_hash: s.hash, secret_prefix: s.prefix, secret_version: 1 });
    const r = await processInbound({ token, method: "POST", headers: { get: (n: string) => (n === "x-leadforge-secret" ? s.secret : null) }, body: JSON.stringify({ email: "ro@x.io", name: "Ro" }), ip: null });
    expect(r.status).toBe(402);
    expect((await admin.from("leads").select("id").eq("org_id", o.id)).data).toEqual([]);
  });
  it("rétrogradation : sièges dépassés signalés, membres conservés, ajout bloqué, administrateurs notifiés", async () => {
    const o = await mkOrg("down", { plan: "pro", subscription_status: "active", seat_limit: 10 }, 5);
    await admin.from("organizations").update({ stripe_customer_id: cus(o.id), stripe_subscription_id: sid(o.id) }).eq("id", o.id);
    const starter = subObj(o.id, { items: { data: [{ id: "si_1", price: price(PLANS.starter.lookupKey), current_period_end: 1_950_000_000 }] } });
    expect(await (await send(event("customer.subscription.updated", starter))).json()).toMatchObject({ result: "processed" });
    expect(await orgRow(o.id)).toMatchObject({ plan: "starter", seat_limit: 3 });
    const e = await getEntitlement(o.id, true);
    expect(e).toMatchObject({ seatsUsed: 5, seatLimit: 3, seatsExceeded: true, seatsOver: 2, writable: true });
    expect((await admin.from("memberships").select("id").eq("org_id", o.id).eq("status", "active")).data).toHaveLength(5); // rien n'est supprimé
    const extra = await mkUser("down-extra");
    await admin.from("profiles").update({ provisioned_org: o.id }).eq("id", extra);
    const add = await admin.from("memberships").insert({ org_id: o.id, user_id: extra, role_id: o.userRole });
    expect(add.error?.message).toContain("seat_limit_reached");
    const n = await admin.from("notifications").select("payload").eq("org_id", o.id).eq("type", "billing");
    expect(JSON.stringify(n.data)).toContain("désactivez 2 membre");
    // désactiver des membres rétablit la situation
    for (const u of o.extraUsers.slice(0, 2)) await admin.from("memberships").update({ status: "disabled" }).eq("org_id", o.id).eq("user_id", u);
    invalidateEntitlement(o.id);
    expect((await getEntitlement(o.id, true)).seatsExceeded).toBe(false);
  });
  it("événements d'un ancien abonnement ou d'un autre client : ignorés ; organisation inconnue : ignorée sans erreur", async () => {
    const o = await mkOrg("other");
    await send(event("customer.subscription.updated", subObj(o.id)));
    const oldDeleted = event("customer.subscription.deleted", subObj(o.id, { id: "sub_old", status: "canceled" }));
    expect(await (await send(oldDeleted)).json()).toMatchObject({ result: "ignored" });
    expect((await orgRow(o.id)).subscription_status).toBe("active");
    const foreign = event("customer.subscription.updated", subObj(o.id, { customer: "cus_autre", status: "canceled" }));
    expect(await (await send(foreign)).json()).toMatchObject({ result: "ignored" });
    expect((await orgRow(o.id)).subscription_status).toBe("active");
    const ghost = event("customer.subscription.updated", subObj(crypto.randomUUID(), { customer: "cus_inconnu" }));
    expect(await (await send(ghost)).json()).toMatchObject({ result: "ignored" });
    const unknownPrice = event("customer.subscription.updated", subObj(o.id, { items: { data: [{ price: price("autre_produit") }] } }));
    expect(await (await send(unknownPrice)).json()).toMatchObject({ result: "ignored" });
    expect((await orgRow(o.id)).plan).toBe("pro");
  });
});

describe("Checkout / portail / changement de plan (via stripe-mock)", () => {
  const stripe = getStripe()!;
  const env = { NEXT_PUBLIC_APP_URL: "http://localhost:3000" };
  const base = (o: { id: string }, extra: Partial<OrgBilling> = {}): OrgBilling => ({ id: o.id, name: "Acme", stripe_customer_id: null, stripe_subscription_id: null, subscription_status: "trialing", ...extra });

  it("client Stripe configuré vers stripe-mock", () => {
    expect(stripe).not.toBeNull();
  });
  it("session de paiement : bon prix, essai 14 j, carte requise, org en métadonnées, client créé et lié", async () => {
    const o = await mkOrg("co");
    const create = vi.spyOn(stripe.checkout.sessions, "create");
    const customers = vi.spyOn(stripe.customers, "create");
    const url = await createCheckout(stripe, base(o), "pro", "admin@acme.fr", { ...env, STRIPE_PRICE_PRO: "price_pro_env" });
    expect(url).toMatch(/^https:\/\//);
    const params = create.mock.calls[0]![0]!;
    expect(params).toMatchObject({
      mode: "subscription", client_reference_id: o.id, line_items: [{ price: "price_pro_env", quantity: 1 }], payment_method_collection: "always",
      metadata: { org_id: o.id, plan: "pro" }, subscription_data: { trial_period_days: 14, metadata: { org_id: o.id, plan: "pro" } },
    });
    expect(params.success_url).toBe("http://localhost:3000/settings/billing?checkout=success");
    expect(customers.mock.calls[0]![0]).toMatchObject({ email: "admin@acme.fr", metadata: { org_id: o.id } });
    const row = await orgRow(o.id);
    expect(row.stripe_customer_id).toMatch(/^cus_/);
    // second appel : le client est réutilisé
    customers.mockClear();
    await createCheckout(stripe, base(o, { stripe_customer_id: row.stripe_customer_id }), "starter", "admin@acme.fr", { ...env, STRIPE_PRICE_STARTER: "price_st" });
    expect(customers).not.toHaveBeenCalled();
    create.mockRestore(); customers.mockRestore();
  });
  it("prix retrouvé par lookup_key quand STRIPE_PRICE_* est vide ; plan inconnu et double abonnement refusés", async () => {
    const o = await mkOrg("co2");
    const list = vi.spyOn(stripe.prices, "list");
    expect(await createCheckout(stripe, base(o, { stripe_customer_id: "cus_x" }), "business", "a@b.fr", env)).toMatch(/^https:/);
    expect(list.mock.calls[0]![0]).toMatchObject({ lookup_keys: [PLANS.business.lookupKey], active: true });
    await expect(createCheckout(stripe, base(o), "enterprise", "a@b.fr", env)).rejects.toBeInstanceOf(BillingError);
    await expect(createCheckout(stripe, base(o, { subscription_status: "active", stripe_subscription_id: "sub_1" }), "pro", "a@b.fr", env)).rejects.toThrow(/existe déjà/);
    list.mockRestore();
  });
  it("organisation qui a déjà souscrit : pas de nouvel essai", async () => {
    const o = await mkOrg("co3");
    const create = vi.spyOn(stripe.checkout.sessions, "create");
    await createCheckout(stripe, base(o, { stripe_customer_id: "cus_x", stripe_subscription_id: "sub_old", subscription_status: "canceled" }), "pro", "a@b.fr", { ...env, STRIPE_PRICE_PRO: "price_p" });
    expect(create.mock.calls[0]![0]!.subscription_data!.trial_period_days).toBeUndefined();
    create.mockRestore();
  });
  it("portail client : exige un client Stripe ; renvoie l'adresse de retour vers la facturation", async () => {
    const o = await mkOrg("po");
    await expect(createPortal(stripe, base(o), env)).rejects.toThrow(/Aucun abonnement/);
    const create = vi.spyOn(stripe.billingPortal.sessions, "create");
    expect(await createPortal(stripe, base(o, { stripe_customer_id: "cus_x" }), env)).toMatch(/^https:/);
    expect(create.mock.calls[0]![0]).toMatchObject({ customer: "cus_x", return_url: "http://localhost:3000/settings/billing" });
    create.mockRestore();
  });
  it("changement de plan : mise à jour proratisée de l'abonnement existant", async () => {
    const o = await mkOrg("cp");
    const update = vi.spyOn(stripe.subscriptions, "update");
    await changePlan(stripe, base(o, { stripe_subscription_id: "sub_123", subscription_status: "active" }), "business", { ...env, STRIPE_PRICE_BUSINESS: "price_biz" });
    expect(update.mock.calls[0]![1]).toMatchObject({ items: [{ price: "price_biz" }], proration_behavior: "create_prorations", metadata: { org_id: o.id, plan: "business" } });
    await expect(changePlan(stripe, base(o), "pro", env)).rejects.toThrow(/Aucun abonnement/);
    update.mockRestore();
  });
  it("sans clé ni stripe-mock : facturation non configurée ; stripe-mock ignoré en production", () => {
    expect(getStripe({})).toBeNull();
    expect(getStripe({ NODE_ENV: "production", STRIPE_API_BASE: "http://127.0.0.1:12111" })).toBeNull(); // pas de clé : le mock n'est pas pris en compte
    expect(getStripe({ STRIPE_SECRET_KEY: "sk_test_abc" })).not.toBeNull();
    expect(getStripe({ NODE_ENV: "production", STRIPE_SECRET_KEY: "pas_une_cle" })).toBeNull();
  });
});
