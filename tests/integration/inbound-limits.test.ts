import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as cronGet } from "@/app/api/cron/maintenance/route";
import { POST } from "@/app/api/webhooks/inbound/[token]/route";
import { signPayload } from "@/lib/automation/signature";
import { buildTestPayload } from "@/lib/inbound/adapters";
import { encryptSecret, generateSecret, generateToken, newEndpointSecret } from "@/lib/inbound/auth";
import { processInbound, RATES } from "@/lib/inbound/handler";
import { dropUnfinishedImports, purgeImportFiles } from "@/lib/maintenance";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Math.random().toString(36).slice(2, 8);
let user = "", orgA = "", orgB = "";
interface Ep { id: string; token: string; secret: string; hash: string }
const orgs: string[] = [];

async function mkOrg(name: string) {
  const { data, error } = await admin.from("organizations").insert({ name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${run}`, template: "generic", created_by: user }).select("id").single();
  if (error) throw error;
  await admin.from("statuses").insert({ org_id: data.id, name: "Nouveau", color: "#3b82f6", is_initial: true });
  orgs.push(data.id);
  return data.id as string;
}
async function mkEp(org: string, kind: "generic" | "meta" | "google" = "generic", extra: object = {}, legacy = false): Promise<Ep> {
  const id = crypto.randomUUID();
  const s = legacy ? generateSecret() : newEndpointSecret(id, 1);
  const token = generateToken();
  const { error } = await admin.from("inbound_endpoints").insert({ id, org_id: org, name: `${kind}-${id.slice(0, 4)}`, kind, token, secret_hash: s.hash, secret_prefix: s.prefix, secret_version: legacy ? null : 1, dedupe_window_hours: 0, ...extra });
  if (error) throw error;
  return { id, token, secret: s.secret, hash: s.hash };
}
const call = (token: string, body: string, headers: Record<string, string> = {}) =>
  POST(new NextRequest(`http://localhost/api/webhooks/inbound/${token}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }), { params: Promise.resolve({ token }) });
const lead = (i: number | string) => JSON.stringify({ email: `l${i}-${run}@x.io`, name: `L ${i}` });

beforeAll(async () => {
  const { data } = await admin.auth.admin.createUser({ email: `lim-${run}@test.local`, password: "Passw0rd!test", email_confirm: true });
  user = data.user!.id;
  orgA = await mkOrg(`LIM A ${run}`);
  orgB = await mkOrg(`LIM B ${run}`);
});
afterAll(async () => {
  delete process.env.TRUSTED_PROXY;
  for (const id of orgs) await admin.from("organizations").delete().eq("id", id);
  await admin.auth.admin.deleteUser(user);
});

describe("limitation de débit : isolation entre tenants", () => {
  it("IP inconnue : un tenant qui sature ses endpoints puis son organisation n'affecte pas un autre tenant", async () => {
    const a = [await mkEp(orgA), await mkEp(orgA), await mkEp(orgA), await mkEp(orgA)];
    const b = await mkEp(orgB);
    const statuses = new Map<number, number>();
    for (const ep of a) for (let i = 0; i < 61; i++) { const r = await call(ep.token, "{}", { "x-leadforge-secret": ep.secret }); statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1); }
    expect(statuses.get(429)).toBeGreaterThan(0); // plafond par endpoint (60) et par organisation (200) atteints
    const r = await call(b.token, lead("victim"), { "x-leadforge-secret": b.secret });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "created" });
  });
  it("plafond par endpoint et par organisation indépendants", async () => {
    expect(RATES.endpoint.limit).toBeLessThan(RATES.org.limit);
    const e1 = await mkEp(orgB), e2 = await mkEp(orgB);
    for (let i = 0; i < 62; i++) await call(e1.token, "{}", { "x-leadforge-secret": e1.secret });
    expect((await call(e1.token, "{}", { "x-leadforge-secret": e1.secret })).status).toBe(429);
    expect((await call(e2.token, lead("e2"), { "x-leadforge-secret": e2.secret })).status).toBe(200); // autre endpoint de la même org : intact
  });
  it("jetons inconnus : limités par IP (si connue), sans toucher les tenants valides d'autres IP", async () => {
    process.env.TRUSTED_PROXY = "1";
    const good = await mkEp(await mkOrg(`LIM G ${run}`));
    try {
      let limited = 0;
      for (let i = 0; i < RATES.unknownIp.limit + 5; i++) {
        const r = await call(generateToken(), "{}", { "x-forwarded-for": "203.0.113.50" });
        if (r.status === 429) limited++;
        else expect(r.status).toBe(404);
      }
      expect(limited).toBeGreaterThan(0);
      const ok = await call(good.token, lead("ip2"), { "x-leadforge-secret": good.secret, "x-forwarded-for": "198.51.100.7" });
      expect(ok.status).toBe(200);
    } finally {
      delete process.env.TRUSTED_PROXY;
    }
  });
  it("jetons inconnus sans IP : seau global distinct, jamais celui d'un tenant", async () => {
    expect(RATES.unknownGlobal.limit).toBeGreaterThanOrEqual(RATES.endpoint.limit);
    const r = await call(generateToken(), "{}");
    expect(r.status).toBe(404);
  });
  it("plafond quotidien par organisation (configurable), sans effet sur les autres", async () => {
    const o = await mkOrg(`LIM Q ${run}`);
    await admin.from("organizations").update({ inbound_daily_limit: 2 }).eq("id", o);
    const q = await mkEp(o);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await call(q.token, lead(`q${i}`), { "x-leadforge-secret": q.secret })).status);
    expect(codes).toEqual([200, 200, 429, 429]);
    const other = await mkEp(await mkOrg(`LIM O ${run}`));
    expect((await call(other.token, lead("q-other"), { "x-leadforge-secret": other.secret })).status).toBe(200);
  });
});

let authOrg = "";
describe("authentification : secret dérivé, Meta chiffré, anciens endpoints", () => {
  beforeAll(async () => { authOrg = await mkOrg(`LIM AUTH ${run}`); });
  it("signature HMAC : le secret dérivé fonctionne ; le hachage stocké ne permet pas de forger", async () => {
    const e = await mkEp(authOrg);
    const body = lead("hmac");
    const ts = Math.floor(Date.now() / 1000);
    expect((await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(e.hash, ts, body)}` })).status).toBe(401);
    expect((await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(e.secret, ts, body)}` })).status).toBe(200);
  });
  it("ancien endpoint (secret aléatoire) : en-tête secret valide, signature HMAC indisponible", async () => {
    const e = await mkEp(authOrg, "generic", {}, true);
    const body = lead("legacy");
    const ts = Math.floor(Date.now() / 1000);
    for (const key of [e.hash, e.secret]) expect((await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(key, ts, body)}` })).status).toBe(401);
    expect((await call(e.token, body, { "x-leadforge-secret": e.secret })).status).toBe(200);
  });
  it("Meta avec secret d'application : X-Hub-Signature-256 obligatoire ; sans secret, jeton seul", async () => {
    const e = await mkEp(authOrg, "meta", { meta_app_secret_enc: encryptSecret("meta-app-secret") });
    const body = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { field_data: [{ name: "email", values: [`m-${run}@x.io`] }, { name: "full_name", values: ["Meta Signé"] }] } }] }] });
    expect((await call(e.token, body)).status).toBe(401);
    expect((await call(e.token, body, { "x-hub-signature-256": "sha256=" + "0".repeat(64) })).status).toBe(401);
    const sig = `sha256=${createHmac("sha256", "meta-app-secret").update(body).digest("hex")}`;
    expect(await (await call(e.token, body, { "x-hub-signature-256": sig })).json()).toMatchObject({ status: "created" });
    const plain = await mkEp(authOrg, "meta");
    expect((await call(plain.token, body.replace(`m-${run}`, `p-${run}`))).status).toBe(200);
    // le secret d'application chiffré n'est lisible ni en clair en base ni par un client
    const { data } = await admin.from("inbound_endpoints").select("meta_app_secret_enc").eq("id", e.id).single();
    expect(data!.meta_app_secret_enc).not.toContain("meta-app-secret");
  });
  it("« Envoyer un test » : la charge suit le mappage personnalisé de l'endpoint", async () => {
    const mapping = { "contact.email": "email", "contact.name": "fullName" };
    const e = await mkEp(authOrg, "generic", { mapping });
    const r = await processInbound({ token: e.token, method: "POST", headers: { get: () => null }, body: JSON.stringify(buildTestPayload("generic", mapping, 123)), ip: null, trusted: true });
    expect(r.json).toMatchObject({ status: "created" });
  });
});

describe("maintenance planifiée et fichiers d'import", () => {
  it("route cron : désactivée sans CRON_SECRET, 401 si faux, rapport si correct", async () => {
    const req = (h: Record<string, string> = {}) => cronGet(new NextRequest("http://localhost/api/cron/maintenance", { headers: h }));
    delete process.env.CRON_SECRET;
    expect((await req()).status).toBe(404);
    process.env.CRON_SECRET = "c".repeat(32);
    expect((await req()).status).toBe(401);
    expect((await req({ authorization: "Bearer faux" })).status).toBe(401);
    const ok = await req({ authorization: `Bearer ${"c".repeat(32)}` });
    expect(ok.status).toBe(200);
    expect((await ok.json()).report).toHaveProperty("importFilesRemoved");
    delete process.env.CRON_SECRET;
  });
  it("purgeImportFiles : les CSV d'imports abandonnés ou en échec sont supprimés du Storage", async () => {
    const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const mk = async (status: string, created_at: string) => {
      const id = crypto.randomUUID();
      const path = `${orgA}/${id}.csv`;
      await admin.storage.from("imports").upload(path, new Blob(["Nom\nA"], { type: "text/csv" }), { contentType: "text/csv" });
      await admin.from("import_jobs").insert({ id, org_id: orgA, user_id: user, filename: "x.csv", status, file_path: path, created_at });
      return { id, path };
    };
    const abandoned = await mk("validated", old);
    const failed = await mk("failed", old);
    const fresh = await mk("uploaded", new Date().toISOString());
    expect(await purgeImportFiles()).toBeGreaterThanOrEqual(2);
    for (const j of [abandoned, failed]) {
      const { data } = await admin.from("import_jobs").select("file_path, status").eq("id", j.id).single();
      expect(data!.file_path).toBeNull();
      expect((await admin.storage.from("imports").download(j.path)).error).not.toBeNull();
    }
    expect((await admin.storage.from("imports").download(fresh.path)).error).toBeNull(); // trop récent : conservé
    await dropUnfinishedImports(orgA, user);
    expect((await admin.storage.from("imports").download(fresh.path)).error).not.toBeNull(); // nouvel envoi : ancien fichier supprimé
  });
});
