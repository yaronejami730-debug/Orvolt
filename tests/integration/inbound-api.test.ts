import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/webhooks/inbound/[token]/route";
import { signPayload } from "@/lib/automation/signature";
import { generateToken, newEndpointSecret } from "@/lib/inbound/auth";
import { limiter } from "@/lib/rate-limit";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Math.random().toString(36).slice(2, 8);

let userA = "", orgA = "", orgB = "", srcId = "";
interface Ep { id: string; token: string; secret: string; hash: string }
const eps: Record<string, Ep> = {};

async function mkOrg(name: string, owner: string) {
  const { data, error } = await admin.from("organizations").insert({ name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${run}`, template: "generic", created_by: owner }).select("id").single();
  if (error) throw error;
  await admin.from("statuses").insert({ org_id: data.id, name: "Nouveau", color: "#3b82f6", is_initial: true });
  return data.id as string;
}
async function mkEp(org: string, kind: "generic" | "meta" | "google", extra: object = {}): Promise<Ep> {
  const id0 = crypto.randomUUID();
  const s = newEndpointSecret(id0, 1);
  const token = generateToken();
  const { data, error } = await admin.from("inbound_endpoints").insert({ id: id0, secret_version: 1, org_id: org, name: `${kind}-${run}`, kind, token, secret_hash: s.hash, secret_prefix: s.prefix, ...extra }).select("id").single();
  if (error) throw error;
  return { id: data.id, token, secret: s.secret, hash: s.hash };
}
const call = (token: string, body: string, headers: Record<string, string> = {}, ct = "application/json") =>
  POST(new NextRequest(`http://localhost/api/webhooks/inbound/${token}`, { method: "POST", body, headers: { "content-type": ct, ...headers } }), { params: Promise.resolve({ token }) });
const leadsOf = async (org: string) => (await admin.from("leads").select("id, email, source_id, org_id").eq("org_id", org)).data ?? [];

beforeAll(async () => {
  const { data } = await admin.auth.admin.createUser({ email: `api-${run}@test.local`, password: "Passw0rd!test", email_confirm: true });
  userA = data.user!.id;
  orgA = await mkOrg(`API A ${run}`, userA);
  orgB = await mkOrg(`API B ${run}`, userA);
  srcId = (await admin.from("lead_sources").insert({ org_id: orgA, name: "Webhook test" }).select("id").single()).data!.id;
  eps.generic = await mkEp(orgA, "generic", { default_source_id: srcId });
  eps.meta = await mkEp(orgA, "meta");
  eps.google = await mkEp(orgA, "google");
  eps.off = await mkEp(orgA, "generic", { active: false });
  eps.rate = await mkEp(orgA, "generic");
});

afterAll(async () => {
  for (const id of [orgA, orgB]) await admin.from("organizations").delete().eq("id", id);
  await admin.auth.admin.deleteUser(userA);
});

describe("API webhook entrant", () => {
  it("jeton invalide, inconnu ou désactivé : 404 neutre identique", async () => {
    const bodies = [];
    for (const token of ["court", "x".repeat(43), eps.off!.token]) {
      const r = await call(token, "{}", { "x-leadforge-secret": eps.off!.secret });
      expect(r.status, token).toBe(404);
      bodies.push(await r.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toMatch(/org|endpoint|secret/i);
  });
  it("Content-Type strict, taille maximale, JSON invalide", async () => {
    const e = eps.generic!;
    expect((await call(e.token, "{}", { "x-leadforge-secret": e.secret }, "text/plain")).status).toBe(415);
    expect((await call(e.token, "{}", { "x-leadforge-secret": e.secret }, "application/json; charset=utf-8")).status).not.toBe(415);
    expect((await call(e.token, JSON.stringify({ email: "a@b.fr", pad: "x".repeat(101 * 1024) }), { "x-leadforge-secret": e.secret })).status).toBe(413);
    expect((await call(e.token, "pas du json", { "x-leadforge-secret": e.secret })).status).toBe(400);
    expect((await call(e.token, "[1,2]", { "x-leadforge-secret": e.secret })).status).toBe(400);
  });
  it("authentification : sans secret ou mauvais secret = 401, sans fuite d'information", async () => {
    const e = eps.generic!;
    const r1 = await call(e.token, JSON.stringify({ email: "no@auth.fr", name: "No Auth" }));
    const r2 = await call(e.token, JSON.stringify({ email: "no@auth.fr", name: "No Auth" }), { "x-leadforge-secret": "lfs_mauvais" });
    expect([r1.status, r2.status]).toEqual([401, 401]);
    expect(await r1.json()).toEqual({ error: "unauthorized" });
    expect((await leadsOf(orgA)).filter((l) => l.email === "no@auth.fr")).toHaveLength(0);
  });
  it("secret en en-tête : lead créé dans l'org de l'endpoint, source par défaut, org du payload ignorée", async () => {
    const e = eps.generic!;
    const body = JSON.stringify({ email: "Alice@Example.com", phone: "06 12 34 56 78", name: "Alice Martin", org_id: orgB, organization_id: orgB, source_id: "x", status_id: "y" });
    const r = await call(e.token, body, { "x-leadforge-secret": e.secret });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "created" });
    const mine = (await leadsOf(orgA)).filter((l) => l.email === "Alice@Example.com" || l.email === "alice@example.com");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.source_id).toBe(srcId);
    expect(await leadsOf(orgB)).toHaveLength(0);
    const ev = await admin.from("lead_events").select("payload").eq("lead_id", mine[0]!.id).eq("type", "created").single();
    expect(ev.data!.payload.via).toBe("webhook");
  });
  it("signature HMAC valide acceptée, falsifiée refusée", async () => {
    const e = eps.generic!;
    const body = JSON.stringify({ email: "hmac@example.com", name: "Hm Ac" });
    const ts = Math.floor(Date.now() / 1000);
    const good = `t=${ts},v1=${signPayload(e.secret, ts, body)}`;
    expect((await call(e.token, body, { "x-leadforge-signature": good })).status).toBe(200);
    expect((await call(e.token, body.replace("Hm", "Xx"), { "x-leadforge-signature": good })).status).toBe(401);
    expect((await call(e.token, body, { "x-leadforge-signature": `t=${ts - 4000},v1=${signPayload(e.secret, ts - 4000, body)}` })).status).toBe(401);
  });
  it("doublon dans la fenêtre : 200 duplicate, un seul lead ; journal masqué", async () => {
    const e = eps.generic!;
    const body = JSON.stringify({ email: "alice@example.com", name: "Alice Bis" });
    const r = await call(e.token, body, { "x-leadforge-secret": e.secret });
    expect(await r.json()).toMatchObject({ status: "duplicate" });
    const byPhone = await call(e.token, JSON.stringify({ phone: "+33612345678", name: "Autre" }), { "x-leadforge-secret": e.secret });
    expect(await byPhone.json()).toMatchObject({ status: "duplicate" });
    expect((await leadsOf(orgA)).filter((l) => l.email?.toLowerCase() === "alice@example.com")).toHaveLength(1);
    const { data } = await admin.from("inbound_events").select("status, payload, ip_hash").eq("endpoint_id", e.id);
    expect(data!.some((x) => x.status === "duplicate")).toBe(true);
    expect(JSON.stringify(data)).not.toContain("alice@example.com");
    expect(JSON.stringify(data)).not.toContain("0612345678");
  });
  it("mappage générique configurable", async () => {
    const e = await mkEp(orgA, "generic", { mapping: { "contact.mail": "email", "contact.nom": "lastName", montant: "value" } });
    const r = await call(e.token, JSON.stringify({ contact: { mail: "map@example.com", nom: "Mappé" }, montant: "1500,5" }), { "x-leadforge-secret": e.secret });
    expect(await r.json()).toMatchObject({ status: "created" });
    expect((await admin.from("leads").select("last_name, value").eq("org_id", orgA).eq("email", "map@example.com").single()).data).toEqual({ last_name: "Mappé", value: 1500.5 });
  });
  it("rejets : e-mail invalide, sans contact, journalisés sans détail interne", async () => {
    const e = eps.generic!;
    const r = await call(e.token, JSON.stringify({ email: "invalide", name: "X" }), { "x-leadforge-secret": e.secret });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "rejected" });
    const { data } = await admin.from("inbound_events").select("reason").eq("endpoint_id", e.id).eq("status", "rejected");
    expect(data!.map((x) => x.reason)).toEqual(expect.arrayContaining(["invalid_email"]));
  });
  it("Meta Lead Ads : vérification GET (hub.challenge) et réception POST", async () => {
    const e = eps.meta!;
    const url = (vt: string) => new NextRequest(`http://localhost/api/webhooks/inbound/${e.token}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(vt)}&hub.challenge=12345`);
    const ok = await GET(url(e.secret), { params: Promise.resolve({ token: e.token }) });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    expect((await GET(url("mauvais"), { params: Promise.resolve({ token: e.token }) })).status).toBe(404);
    const payload = { object: "page", entry: [{ changes: [{ field: "leadgen", value: { field_data: [{ name: "full_name", values: ["Meta Lead"] }, { name: "email", values: ["meta@example.com"] }] } }] }] };
    const r = await call(e.token, JSON.stringify(payload));
    expect(await r.json()).toMatchObject({ status: "created" });
    expect((await leadsOf(orgA)).some((l) => l.email === "meta@example.com")).toBe(true);
  });
  it("Google Ads : google_key vérifiée", async () => {
    const e = eps.google!;
    const lead = (key: string, mail: string) => JSON.stringify({ google_key: key, user_column_data: [{ column_id: "FULL_NAME", string_value: "Gus Google" }, { column_id: "EMAIL", string_value: mail }] });
    expect((await call(e.token, lead("faux", "g1@example.com"))).status).toBe(401);
    expect(await (await call(e.token, lead(e.secret, "g2@example.com"))).json()).toMatchObject({ status: "created" });
  });
  it("limitation de débit : 429 avec Retry-After au-delà de 60 requêtes/minute", async () => {
    const e = eps.rate!;
    await limiter.check("noop", { limit: 1, windowMs: 1 });
    let last = 0, retry: string | null = null;
    for (let i = 0; i < 70; i++) {
      const r = await call(e.token, "pas du json", { "x-leadforge-secret": e.secret });
      last = r.status;
      if (r.status === 429) { retry = r.headers.get("retry-after"); break; }
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
  });
});
