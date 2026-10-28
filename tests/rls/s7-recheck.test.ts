import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";

// QA2 S7 re-check : lecture seule étanche (toutes tables org-scopées, RPC, Storage, déplacement d'org_id), sortie sans paiement impossible.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);
const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let A = "", B = "", C = "";
const st: Record<string, string> = {};
const fx: Record<string, string> = {};
const ro = (id: string, status = "canceled") => admin.from("organizations").update({ subscription_status: status }).eq("id", id);

async function makeUser(tag: string): Promise<U> {
  const email = `s7r-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
const roleId = async (org: string, name: string) => (await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single()).data!.id as string;
const denied = (r: { error: unknown; data?: unknown }) => Boolean(r.error) || (Array.isArray(r.data) && r.data.length === 0);

beforeAll(async () => {
  const [a, m] = await Promise.all(["a", "m"].map(makeUser));
  A = (await a!.client.rpc("create_organization", { p_name: `S7R A ${run}`, p_template: "generic" })).data as string;
  B = (await a!.client.rpc("create_organization", { p_name: `S7R B ${run}`, p_template: "generic" })).data as string; // a est admin des deux
  C = (await a!.client.rpc("create_organization", { p_name: `S7R C ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(A, "generic");
  await applyTemplate(B, "generic");
  await admin.from("profiles").update({ provisioned_org: A }).eq("id", m!.id);
  await admin.from("memberships").insert({ org_id: A, user_id: m!.id, role_id: await roleId(A, "Commercial") });
  for (const s of (await admin.from("statuses").select("id, name").eq("org_id", A)).data!) st[s.name] = s.id;
  const one = async (t: string, row: Record<string, unknown>) => (await admin.from(t).insert(row).select("id").single()).data!.id as string;
  fx.lead = await one("leads", { org_id: A, status_id: st["Nouveau"], first_name: "F", last_name: "x", assigned_to: a!.id });
  fx.lead2 = await one("leads", { org_id: A, status_id: st["Nouveau"], first_name: "F2", last_name: "x" });
  fx.note = await one("lead_notes", { org_id: A, lead_id: fx.lead, author_id: a!.id, body: "n" });
  fx.call = await one("lead_calls", { org_id: A, lead_id: fx.lead, caller_id: a!.id, outcome: "answered" });
  fx.task = await one("tasks", { org_id: A, lead_id: fx.lead, title: "t", assigned_to: a!.id, created_by: a!.id });
  fx.file = await one("lead_files", { org_id: A, lead_id: fx.lead, uploaded_by: a!.id, path: `${A}/${fx.lead}/f-${run}.txt`, name: "f", size_bytes: 1, mime_type: "text/plain" });
  const d = new Date(Date.now() + 11 * 86_400_000);
  fx.appt = await one("appointments", { org_id: A, lead_id: fx.lead, assigned_to: a!.id, created_by: a!.id, starts_at: d.toISOString(), ends_at: new Date(d.getTime() + 3_600_000).toISOString() });
  fx.zone = await one("sales_zones", { org_id: A, user_id: a!.id, base_address: "Paris centre", base_lat: 48.8, base_lng: 2.3, radius_km: 20 });
  fx.src = await one("lead_sources", { org_id: A, name: `Src ${run}` });
  fx.field = await one("custom_fields", { org_id: A, key: `fx_${run}`, label: `FX ${run}`, type: "text" });
  fx.role = await one("roles", { org_id: A, name: `Role ${run}`, permissions: [] });
  fx.status = await one("statuses", { org_id: A, name: `St ${run}`, color: "#123456", position: 99 });
  fx.trans = await one("status_transitions", { org_id: A, from_status_id: st["Nouveau"], to_status_id: st["En cours"], role_id: fx.role });
  fx.action = await one("status_actions", { org_id: A, status_id: st["Nouveau"], type: "notify", config: { recipient: "assignee", message: "x" } });
  fx.mem = (await admin.from("memberships").select("id").eq("org_id", A).eq("user_id", m!.id).single()).data!.id;
});
afterAll(async () => {
  for (const id of [A, B, C]) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("lecture seule : matrice complète en REST direct (administrateur d'organisation)", () => {
  const upd: [string, string, Record<string, unknown>][] = [
    ["leads", "lead", { first_name: "Hack" }], ["lead_notes", "note", { body: "hack" }], ["lead_calls", "call", { notes: "hack" }],
    ["tasks", "task", { done: true }], ["appointments", "appt", { notes: "hack" }], ["sales_zones", "zone", { radius_km: 99 }],
    ["lead_sources", "src", { color: "#000000" }], ["custom_fields", "field", { label: "Hack" }], ["roles", "role", { description: "hack" }],
    ["statuses", "status", { color: "#000000" }], ["status_actions", "action", { enabled: false }],
    ["memberships", "mem", { role_id: "__admin__" }], ["organizations", "org", { name: "Hack" }],
  ];
  const del: [string, string][] = [
    ["leads", "lead2"], ["lead_notes", "note"], ["lead_calls", "call"], ["tasks", "task"], ["lead_files", "file"], ["appointments", "appt"],
    ["sales_zones", "zone"], ["lead_sources", "src"], ["custom_fields", "field"], ["roles", "role"], ["statuses", "status"],
    ["status_transitions", "trans"], ["status_actions", "action"], ["memberships", "mem"],
  ];
  beforeAll(async () => { await ro(A); });
  afterAll(async () => { await ro(A, "trialing"); });

  it("UPDATE refusé sur toutes les tables d'écriture", async () => {
    const adminRole = await roleId(A, "Super administrateur");
    fx.org = A;
    for (const [t, key, patch] of upd) {
      const p = JSON.parse(JSON.stringify(patch).replace("__admin__", adminRole));
      const r = await users.a!.client.from(t).update(p).eq("id", fx[key]!).select();
      expect(denied(r), `update ${t}`).toBe(true);
    }
    expect((await admin.from("leads").select("first_name").eq("id", fx.lead!).single()).data!.first_name).toBe("F");
    expect((await admin.from("organizations").select("name").eq("id", A).single()).data!.name).toBe(`S7R A ${run}`);
  });
  it("DELETE refusé sur toutes les tables, y compris les données de configuration", async () => {
    for (const [t, key] of del) {
      const r = await users.a!.client.from(t).delete().eq("id", fx[key]!).select();
      expect(denied(r), `delete ${t}`).toBe(true);
      expect((await admin.from(t).select("id").eq("id", fx[key]!)).data, `${t} toujours là`).toHaveLength(1);
    }
  });
  it("INSERT refusé sur toutes les tables d'écriture (tâche, note, appel, fichier, RDV, source, champ, rôle, statut, zone, membre)", async () => {
    const a = users.a!.client, uid = users.a!.id;
    const ins: Record<string, Record<string, unknown>> = {
      leads: { org_id: A, created_by: uid, first_name: "Ro" }, lead_notes: { org_id: A, lead_id: fx.lead, body: "ro" }, lead_calls: { org_id: A, lead_id: fx.lead, outcome: "answered" },
      tasks: { org_id: A, title: "ro", created_by: uid }, lead_files: { org_id: A, lead_id: fx.lead, path: `${A}/${fx.lead}/ro.txt`, name: "r", size_bytes: 1, mime_type: "text/plain" },
      appointments: { org_id: A, lead_id: fx.lead, assigned_to: uid, created_by: uid, starts_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), ends_at: new Date(Date.now() + 30 * 86_400_000 + 3_600_000).toISOString() },
      lead_sources: { org_id: A, name: "Ro" }, custom_fields: { org_id: A, key: "ro_key", label: "Ro", type: "text" }, roles: { org_id: A, name: "RoRole", permissions: [] },
      statuses: { org_id: A, name: "RoSt", color: "#000000" }, status_transitions: { org_id: A, from_status_id: st["Nouveau"], to_status_id: st["En cours"] },
      status_actions: { org_id: A, status_id: st["Nouveau"], type: "notify", config: { recipient: "assignee", message: "x" } },
    };
    for (const [t, row] of Object.entries(ins)) expect(denied(await a.from(t).insert(row)), `insert ${t}`).toBe(true);
    const u = await makeUser("late");
    await admin.from("profiles").update({ provisioned_org: A }).eq("id", u.id);
    expect(denied(await a.from("memberships").insert({ org_id: A, user_id: u.id, role_id: await roleId(A, "Commercial") })), "insert memberships").toBe(true);
  });
  it("RPC (DEFINER et INVOKER) refusées : move_lead, patch_lead_custom, delete_status_replace, set_initial_status, reorder_*, save_*", async () => {
    const a = users.a!.client;
    const res = await Promise.all([
      a.rpc("move_lead", { p_lead: fx.lead, p_to: st["En cours"] }),
      a.rpc("patch_lead_custom", { p_lead: fx.lead, p_patch: { [`fx_${run}`]: "x" } }),
      a.rpc("delete_status_replace", { p_org: A, p_status: fx.status, p_replacement: st["Nouveau"] }),
      a.rpc("set_initial_status", { org: A, status: st["En cours"] }),
      a.rpc("reorder_statuses", { org: A, ids: [st["En cours"], st["Nouveau"]] }),
      a.rpc("reorder_fields", { org: A, ids: [fx.field] }),
      a.rpc("save_transitions", { org: A, from_status: st["Nouveau"], targets: [] }),
      a.rpc("save_status_actions", { org: A, status: st["Nouveau"], actions: [] }),
    ]);
    res.forEach((r, i) => expect(r.error, `rpc ${i}`).not.toBeNull());
    expect((await admin.from("leads").select("status_id").eq("id", fx.lead!).single()).data!.status_id).toBe(st["Nouveau"]);
    expect((await admin.from("status_transitions").select("id").eq("id", fx.trans!)).data).toHaveLength(1);
    expect((await admin.from("statuses").select("is_initial").eq("id", st["Nouveau"]!).single()).data!.is_initial).toBe(true);
  });
  it("Storage direct : envoi et suppression refusés, lecture conservée", async () => {
    const b = users.a!.client.storage.from("lead-files");
    const p = `${A}/${fx.lead}/ro-${run}.txt`;
    expect((await b.upload(p, new Blob(["x"], { type: "text/plain" }), { contentType: "text/plain" })).error).not.toBeNull();
    const ex = `${A}/${fx.lead}/exists-${run}.txt`;
    await admin.storage.from("lead-files").upload(ex, new Blob(["keep"], { type: "text/plain" }), { contentType: "text/plain" });
    expect((await b.remove([ex])).data ?? []).toEqual([]);
    expect((await b.download(ex)).error).toBeNull(); // lecture conservée
    expect((await b.upload(ex, new Blob(["over"], { type: "text/plain" }), { contentType: "text/plain", upsert: true })).error).not.toBeNull(); // écrasement
    expect((await admin.storage.from("lead-files").download(ex)).error).toBeNull();
    await admin.storage.from("lead-files").remove([ex]);
  });
  it("déplacer des lignes vers une autre org (org_id) depuis une org en lecture seule : refusé (a est admin de A figée et de B active)", async () => {
    const a = users.a!.client;
    for (const [t, key] of [["leads", "lead"], ["lead_notes", "note"], ["tasks", "task"], ["appointments", "appt"], ["lead_sources", "src"], ["custom_fields", "field"], ["roles", "role"], ["statuses", "status"], ["sales_zones", "zone"], ["memberships", "mem"], ["status_actions", "action"], ["status_transitions", "trans"]] as const) {
      const r = await a.from(t).update({ org_id: B }).eq("id", fx[key]!).select();
      expect(denied(r), `org_id ${t}`).toBe(true);
      expect((await admin.from(t).select("org_id").eq("id", fx[key]!).single()).data!.org_id, `${t} reste dans A`).toBe(A);
    }
  });
  it("membres en lecture seule : seule la désactivation passe ; réactiver, changer le rôle, supprimer, déplacer : refusé", async () => {
    const a = users.a!.client;
    const adminRole = await roleId(A, "Super administrateur");
    expect(denied(await a.from("memberships").update({ role_id: adminRole }).eq("id", fx.mem!).select())).toBe(true);
    expect(denied(await a.from("memberships").delete().eq("id", fx.mem!).select())).toBe(true);
    expect(denied(await a.from("memberships").update({ status: "disabled", role_id: adminRole }).eq("id", fx.mem!).select())).toBe(true);
    const off = await a.from("memberships").update({ status: "disabled" }).eq("id", fx.mem!).select();
    expect(off.error).toBeNull();
    expect(off.data).toHaveLength(1);
    expect(denied(await a.from("memberships").update({ status: "active" }).eq("id", fx.mem!).select())).toBe(true); // pas de réactivation
    expect((await admin.from("memberships").select("status, role_id").eq("id", fx.mem!).single()).data!.status).toBe("disabled");
    await admin.from("memberships").update({ status: "active" }).eq("id", fx.mem!);
  });
  it("service_role (webhook entrant, import, moteur) non bloqué par les triggers mais contrôlé côté serveur ; guard serveur en liste blanche", async () => {
    expect((await admin.from("lead_notes").insert({ org_id: A, lead_id: fx.lead, author_id: users.a!.id, body: "svc" })).error).toBeNull();
    const g = read("src/lib/action-guard.ts");
    expect(g).toMatch(/isWritable/);
    expect(g).toMatch(/READ_SCOPES/);
    expect(read("src/lib/inbound/handler.ts")).toMatch(/402/);
  });
});

describe("sortie de lecture seule : uniquement par paiement (webhook signé), jamais par le client", () => {
  it("un administrateur ne peut pas se réactiver : colonnes de facturation, org_id/statut via RPC ou update refusés", async () => {
    await ro(A);
    const a = users.a!.client;
    for (const patch of [{ subscription_status: "active" }, { subscription_status: "trialing" }, { trial_ends_at: "2099-01-01T00:00:00Z" }, { past_due_since: null }, { plan: "business", seat_limit: 999 }, { stripe_subscription_id: "sub_x" }, { cancel_at_period_end: false }])
      expect(denied(await a.from("organizations").update(patch).eq("id", A).select()), JSON.stringify(patch)).toBe(true);
    expect((await a.from("stripe_events").insert({ id: `evt_fake_${run}`, type: "x", event_created: new Date().toISOString() })).error).not.toBeNull();
    // création d'une nouvelle organisation gratuite : plafonnée à 3 par utilisateur (A, B, C déjà créées)
    expect((await a.rpc("create_organization", { p_name: `S7R D ${run}`, p_template: "generic" })).error?.message).toContain("org_limit_reached");
    expect((await admin.from("organizations").select("subscription_status").eq("id", A).single()).data!.subscription_status).toBe("canceled");
  });
  it("pas de verrouillage permanent : après événement Stripe signé « actif », les écritures reprennent immédiatement", async () => {
    const Stripe = (await import("stripe")).default;
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const { NextRequest } = await import("next/server");
    const { PLANS } = await import("@/lib/billing/plans");
    await admin.from("organizations").update({ stripe_customer_id: `cus_${run}`, stripe_subscription_id: `sub_${run}`, subscription_status: "canceled", stripe_event_at: null }).eq("id", A);
    const a = users.a!.client;
    expect(denied(await a.from("lead_notes").insert({ org_id: A, lead_id: fx.lead, body: "avant" }))).toBe(true);
    const e = { id: `evt_s7r_${run}`, object: "event", type: "customer.subscription.updated", created: 2_100_000_000, data: { object: { id: `sub_${run}`, customer: `cus_${run}`, status: "active", metadata: { org_id: A }, cancel_at_period_end: false, trial_end: null, items: { data: [{ id: "si", price: { id: "p", lookup_key: PLANS.pro.lookupKey, metadata: {} }, current_period_end: 2_200_000_000 }] } } } };
    const payload = JSON.stringify(e);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET!, timestamp: Math.floor(Date.now() / 1000) });
    const r = await POST(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header, "content-type": "application/json" } }));
    expect(r.status).toBe(200);
    const row = await admin.from("organizations").select("subscription_status, seat_limit").eq("id", A).single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({ subscription_status: "active", seat_limit: 8 });
    expect((await a.from("lead_notes").insert({ org_id: A, lead_id: fx.lead, body: "après" })).error).toBeNull();
    const u1 = await a.from("leads").update({ first_name: "Reprise" }).eq("id", fx.lead!).select("id");
    const u2 = await a.from("organizations").update({ name: `S7R A ${run} ok` }).eq("id", A).select();
    expect(u1.error).toBeNull(); expect(u1.data).toHaveLength(1);
    expect(u2.error).toBeNull(); expect(u2.data).toHaveLength(1);
    expect((await a.storage.from("lead-files").upload(`${A}/${fx.lead}/back-${run}.txt`, new Blob(["x"], { type: "text/plain" }), { contentType: "text/plain" })).error).toBeNull();
    await admin.storage.from("lead-files").remove([`${A}/${fx.lead}/back-${run}.txt`]);
  });
  it("org_is_writable neutre pour un non-membre (aucune information d'abonnement d'un tiers)", async () => {
    await ro(C); // C: canceled ; a est membre de C, m non
    const asMember = (await users.a!.client.rpc("org_is_writable", { org: C })).data;
    const asOutsider = (await users.m!.client.rpc("org_is_writable", { org: C })).data;
    expect(asMember).toBe(false);
    expect(asOutsider).toBe(true); // neutre : identique à une organisation active
    expect((await users.m!.client.rpc("org_is_writable", { org: crypto.randomUUID() })).data).toBe(true);
    expect((await createClient(URL, ANON, opts).rpc("org_is_writable", { org: C })).error).not.toBeNull();
  });
  it("liaison customer <-> org : un client lié à une autre org fait ignorer l'événement signé", async () => {
    const Stripe = (await import("stripe")).default;
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const { NextRequest } = await import("next/server");
    const { PLANS } = await import("@/lib/billing/plans");
    await admin.from("organizations").update({ stripe_customer_id: `cus_c_${run}`, subscription_status: "canceled", stripe_event_at: null, stripe_subscription_id: null }).eq("id", C);
    await admin.from("organizations").update({ stripe_customer_id: null, stripe_subscription_id: null, subscription_status: "canceled" }).eq("id", B);
    const e = { id: `evt_s7r2_${run}`, object: "event", type: "customer.subscription.updated", created: 2_100_000_100, data: { object: { id: `sub_f_${run}`, customer: `cus_c_${run}`, status: "active", metadata: { org_id: B }, cancel_at_period_end: false, trial_end: null, items: { data: [{ id: "si", price: { id: "p", lookup_key: PLANS.pro.lookupKey, metadata: {} }, current_period_end: 2_200_000_000 }] } } } };
    const payload = JSON.stringify(e);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET!, timestamp: Math.floor(Date.now() / 1000) });
    const r = await POST(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header, "content-type": "application/json" } }));
    expect((await r.json()).result).toBe("ignored");
    const b = (await admin.from("organizations").select("stripe_customer_id, subscription_status").eq("id", B).single()).data!;
    expect(b).toEqual({ stripe_customer_id: null, subscription_status: "canceled" });
  });
});

describe("seed distant", () => {
  it("triple verrou : drapeau + confirmation de l'hôte + jamais en production ; local accepté", async () => {
    const { assertLocalTarget } = await import("../../scripts/seed/seed");
    expect(() => assertLocalTarget("https://prod.example.com", {})).toThrow();
    expect(() => assertLocalTarget("https://prod.example.com", { ALLOW_REMOTE_SEED: "1" })).toThrow(/confirmation/);
    expect(() => assertLocalTarget("https://prod.example.com", { ALLOW_REMOTE_SEED: "1", CONFIRM_REMOTE_SEED: "autre.example.com" })).toThrow();
    expect(() => assertLocalTarget("https://prod.example.com", { ALLOW_REMOTE_SEED: "1", CONFIRM_REMOTE_SEED: "prod.example.com", NODE_ENV: "production" })).toThrow(/production/);
    expect(() => assertLocalTarget("https://staging.example.com", { ALLOW_REMOTE_SEED: "1", CONFIRM_REMOTE_SEED: "staging.example.com" })).not.toThrow();
    expect(() => assertLocalTarget("http://127.0.0.1:56321", {})).not.toThrow();
    expect(() => assertLocalTarget("http://127.0.0.1.evil.com", {})).toThrow();
  });
});
