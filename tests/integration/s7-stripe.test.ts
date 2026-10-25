import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import Stripe from "stripe";
import { afterAll, describe, expect, it } from "vitest";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { PLANS } from "@/lib/billing/plans";

// QA2 S7 : mapping organisation <- événement Stripe (métadonnées forgées, client d'une autre org).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Math.random().toString(36).slice(2, 8);
const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const orgs: string[] = [];
let clock = 2_000_000_000, n = 0;

async function mkOrg(tag: string, extra: Record<string, unknown> = {}) {
  const { data: u } = await admin.auth.admin.createUser({ email: `s7s-${tag}-${run}@test.local`, password: "Passw0rd!test", email_confirm: true });
  const { data } = await admin.from("organizations").insert({ name: `S7S ${tag} ${run}`, slug: `s7s-${tag}-${run}`, template: "generic", created_by: u.user!.id, ...extra }).select("id").single();
  orgs.push(data!.id);
  return { id: data!.id as string, user: u.user!.id };
}
const row = async (id: string) => (await admin.from("organizations").select("*").eq("id", id).single()).data!;
const sub = (id: string, customer: string, orgId: string | undefined, status = "active") => ({
  id, customer, status, metadata: orgId ? { org_id: orgId } : {}, cancel_at_period_end: false, trial_end: null,
  items: { data: [{ id: "si", price: { id: "price_pro", lookup_key: PLANS.pro.lookupKey, metadata: {} }, current_period_end: 2_050_000_000 }] },
});
const send = (type: string, object: unknown, created = ++clock, idOverride?: string) => {
  const e = { id: idOverride ?? `evt_s7_${run}_${++n}`, object: "event", type, created, data: { object } };
  const payload = JSON.stringify(e);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) });
  return stripeWebhook(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header, "content-type": "application/json" } }));
};
afterAll(async () => { for (const id of orgs) await admin.from("organizations").delete().eq("id", id); });

describe("webhook Stripe : mapping organisation", () => {
  // Correctif m3 : la liaison client Stripe <-> organisation déjà stockée prime sur metadata.org_id ; divergence = événement ignoré.
  it("événement signé dont les métadonnées visent l'org X mais dont le client appartient à l'org Y : l'org X ne doit pas être modifiée", async () => {
    const y = await mkOrg("y", { stripe_customer_id: `cus_y_${run}`, stripe_subscription_id: `sub_y_${run}`, subscription_status: "active", plan: "pro", seat_limit: 10 });
    const x = await mkOrg("x"); // jamais souscrit : pas de customer
    const before = await row(x.id);
    const r = await send("customer.subscription.updated", sub(`sub_forged_${run}`, `cus_y_${run}`, x.id));
    expect(r.status).toBe(200);
    const after = await row(x.id);
    expect(after.stripe_customer_id).toBe(before.stripe_customer_id); // ne reçoit pas le client de Y
    expect(after.seat_limit).toBe(before.seat_limit);
    expect((await row(y.id)).stripe_customer_id).toBe(`cus_y_${run}`);
  });
  it("sans métadonnées : le client lié résout l'org ; client inconnu et sans métadonnées : ignoré ; org_id non-uuid : ignoré", async () => {
    const o = await mkOrg("c", { stripe_customer_id: `cus_c_${run}`, stripe_subscription_id: `sub_c_${run}`, subscription_status: "trialing", plan: "starter", seat_limit: 3 });
    expect((await (await send("customer.subscription.updated", sub(`sub_c_${run}`, `cus_c_${run}`, undefined))).json()).result).toBe("processed");
    expect((await row(o.id)).plan).toBe("pro");
    expect((await (await send("customer.subscription.updated", sub("sub_unknown", "cus_unknown_" + run, undefined))).json()).result).toBe("ignored");
    expect((await (await send("customer.subscription.updated", sub("sub_bad", "cus_unknown2_" + run, "not-a-uuid' or 1=1"))).json()).result).toBe("ignored");
  });
  it("rejeu du même id d'événement : duplicate, aucun effet ; ordre : plus ancien ignoré ; plan inconnu : ignoré", async () => {
    const o = await mkOrg("r", { stripe_customer_id: `cus_r_${run}`, stripe_subscription_id: `sub_r_${run}`, subscription_status: "active", plan: "pro" });
    const id = `evt_replay_${run}`;
    expect((await (await send("customer.subscription.updated", sub(`sub_r_${run}`, `cus_r_${run}`, o.id, "past_due"), ++clock, id)).json()).result).toBe("processed");
    expect((await row(o.id)).subscription_status).toBe("past_due");
    await admin.from("organizations").update({ subscription_status: "active" }).eq("id", o.id);
    expect((await (await send("customer.subscription.updated", sub(`sub_r_${run}`, `cus_r_${run}`, o.id, "past_due"), clock, id)).json()).result).toBe("duplicate");
    expect((await row(o.id)).subscription_status).toBe("active");
    expect((await (await send("customer.subscription.updated", sub(`sub_r_${run}`, `cus_r_${run}`, o.id, "canceled"), clock - 500)).json()).result).toBe("ignored");
    expect((await row(o.id)).subscription_status).toBe("active");
    const weird = sub(`sub_r_${run}`, `cus_r_${run}`, o.id);
    weird.items.data[0]!.price = { id: "price_x", lookup_key: "evil_plan", metadata: {} } as never;
    expect((await (await send("customer.subscription.updated", weird)).json()).result).toBe("ignored");
    expect((await row(o.id)).plan).toBe("pro");
  });
});
