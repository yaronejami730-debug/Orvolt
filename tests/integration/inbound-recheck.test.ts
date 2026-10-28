import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/webhooks/inbound/[token]/route";
import { GET as CRON_GET, POST as CRON_POST } from "@/app/api/cron/maintenance/route";
import { signPayload } from "@/lib/automation/signature";
import { cleanText } from "@/lib/leads/normalize";
import { decryptSecret, deriveEndpointSecret, encryptSecret, generateSecret, generateToken, inboundKey, ipSalt, newEndpointSecret, sha256Hex, verifyMetaSignature } from "@/lib/inbound/auth";
import { cronAuthorized } from "@/lib/cron";
import { isPublicPath } from "@/lib/supabase/middleware";

// QA2 S5 re-check : isolation des seaux, dérivation HKDF, secret Meta chiffré, cron, rétention.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Math.random().toString(36).slice(2, 8);
const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");

let userA = "";
const orgs: string[] = [];
interface Ep { id: string; token: string; secret: string; hash: string }

async function mkOrg(name: string, extra: object = {}) {
  const { data, error } = await admin.from("organizations").insert({ name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${run}`, template: "generic", created_by: userA, ...extra }).select("id").single();
  if (error) throw error;
  await admin.from("statuses").insert({ org_id: data.id, name: "Nouveau", color: "#3b82f6", is_initial: true });
  orgs.push(data.id);
  return data.id as string;
}
/** Endpoint « nouveau » : secret dérivé HKDF(clé, id, version), seul le hachage est stocké. */
async function mkEp(org: string, kind: "generic" | "meta" | "google", extra: Record<string, unknown> = {}, legacy = false): Promise<Ep> {
  const id = randomUUID();
  const token = generateToken();
  const s = legacy ? generateSecret() : newEndpointSecret(id, 1);
  const { error } = await admin.from("inbound_endpoints").insert({ id, org_id: org, name: `${kind}-${run}`, kind, token, secret_hash: s.hash, secret_prefix: s.prefix, secret_version: legacy ? null : 1, dedupe_window_hours: 0, ...extra });
  if (error) throw error;
  return { id, token, secret: s.secret, hash: s.hash };
}
const call = (token: string, body: string, headers: Record<string, string> = {}) =>
  POST(new NextRequest(`http://localhost/api/webhooks/inbound/${token}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }), { params: Promise.resolve({ token }) });
const lead = (n: string) => JSON.stringify({ email: `${n}@x.io`, name: `N ${n}` });

beforeAll(async () => {
  const { data } = await admin.auth.admin.createUser({ email: `rc-${run}@test.local`, password: "Passw0rd!test", email_confirm: true });
  userA = data.user!.id;
});
afterAll(async () => {
  for (const id of orgs) await admin.from("organizations").delete().eq("id", id);
  await admin.auth.admin.deleteUser(userA);
});

describe("isolation des seaux de débit", () => {
  it("saturer le tenant A (2 endpoints, plusieurs minutes de quota) n'affecte pas B ; IP inconnue", async () => {
    const orgA = await mkOrg(`RC A ${run}`), orgB = await mkOrg(`RC B ${run}`);
    const a1 = await mkEp(orgA, "generic"), a2 = await mkEp(orgA, "generic"), a3 = await mkEp(orgA, "generic"), b = await mkEp(orgB, "generic");
    let limited = 0;
    for (const e of [a1, a2, a3]) for (let i = 0; i < 80; i++) if ((await call(e.token, "{}", { "x-leadforge-secret": e.secret })).status === 429) limited++;
    expect(limited).toBeGreaterThan(0); // A est bien limité (endpoint 60/min, org 200/min)
    const r = await call(b.token, lead("victim-rc"), { "x-leadforge-secret": b.secret });
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("created");
  });
  it("tokens inconnus (floods) ne consomment aucun seau d'un tenant valide ; la réponse reste neutre puis 429 global", async () => {
    const org = await mkOrg(`RC U ${run}`);
    const e = await mkEp(org, "generic");
    let saw429 = false;
    for (let i = 0; i < 700; i++) {
      const r = await call(generateToken(), "{}");
      if (r.status === 429) { saw429 = true; break; }
      expect(r.status).toBe(404);
    }
    expect(saw429).toBe(true);
    const ok = await call(e.token, lead("after-flood"), { "x-leadforge-secret": e.secret });
    expect(ok.status).toBe(200);
  });
  it("plafond quotidien par organisation : atteint => 429 quota_exceeded, sans création", async () => {
    const org = await mkOrg(`RC D ${run}`, { inbound_daily_limit: 3 });
    const e = await mkEp(org, "generic");
    const statuses: string[] = [];
    for (let i = 0; i < 5; i++) statuses.push(String((await call(e.token, lead(`day${i}`), { "x-leadforge-secret": e.secret })).status));
    expect(statuses).toEqual(["200", "200", "200", "429", "429"]);
    expect((await admin.from("leads").select("id", { count: "exact", head: true }).eq("org_id", org)).count).toBe(3);
    expect((await (await call(e.token, lead("day9"), { "x-leadforge-secret": e.secret })).json())).toEqual({ error: "quota_exceeded" });
  });
});

describe("secret dérivé (HKDF) : la base ne permet plus de forger", () => {
  it("l'attaque précédente (clé = secret_hash lu en base) échoue ; la signature avec le secret dérivé passe ; l'en-tête secret passe", async () => {
    const org = await mkOrg(`RC H ${run}`);
    const e = await mkEp(org, "generic");
    const body = lead("hkdf");
    const ts = Math.floor(Date.now() / 1000);
    const forged = await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(e.hash, ts, body)}` });
    expect(forged.status).toBe(401);
    // l'attaquant qui connaît aussi l'identifiant d'endpoint et la version (lisibles) mais pas la clé d'application échoue
    const guessed = deriveEndpointSecret(e.id, 1, { INBOUND_SECRET_KEY: "x".repeat(40) });
    expect((await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(guessed, ts, body)}` })).status).toBe(401);
    expect(e.secret).toBe(deriveEndpointSecret(e.id, 1));
    expect((await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(e.secret, ts, body)}` })).status).toBe(200);
    expect((await call(e.token, lead("hkdf2"), { "x-leadforge-secret": e.secret })).status).toBe(200);
    // le hachage n'est pas le secret
    expect((await call(e.token, lead("hkdf3"), { "x-leadforge-secret": e.hash })).status).toBe(401);
    // propriétés de dérivation : par endpoint, par version
    expect(deriveEndpointSecret(e.id, 2)).not.toBe(e.secret);
    expect(deriveEndpointSecret(randomUUID(), 1)).not.toBe(e.secret);
    expect(sha256Hex(e.secret)).toBe(e.hash);
  });
  it("ancien endpoint (secret_version NULL) : en-tête secret inchangé, AUCUNE voie de signature (pas de repli faible), hachage inutilisable", async () => {
    const org = await mkOrg(`RC L ${run}`);
    const e = await mkEp(org, "generic", {}, true);
    const body = lead("legacy");
    const ts = Math.floor(Date.now() / 1000);
    expect((await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(e.hash, ts, body)}` })).status).toBe(401); // ancien comportement : clé = hash
    expect((await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(e.secret, ts, body)}` })).status).toBe(401); // pas de dérivation possible
    expect((await call(e.token, body, { "x-leadforge-secret": e.secret })).status).toBe(200);
    expect((await call(e.token, lead("legacy2"), { "x-leadforge-secret": e.hash })).status).toBe(401);
  });
  it("INBOUND_SECRET_KEY : exigée (>= 32 car.) en production, valeur de développement refusée ; repli seulement hors production", () => {
    const dev = "leadforge-dev-inbound-key-not-for-production";
    expect(() => inboundKey({ NODE_ENV: "production" })).toThrow();
    expect(() => inboundKey({ NODE_ENV: "production", INBOUND_SECRET_KEY: "court" })).toThrow();
    expect(() => inboundKey({ NODE_ENV: "production", INBOUND_SECRET_KEY: dev })).toThrow();
    expect(() => inboundKey({ NODE_ENV: "production", WEBHOOK_SIGNING_SALT: "s".repeat(40) })).toThrow(); // pas de repli sur le sel en prod
    expect(inboundKey({ NODE_ENV: "production", INBOUND_SECRET_KEY: "k".repeat(32) }).length).toBe(32);
    expect(() => inboundKey({ NODE_ENV: "development" })).not.toThrow();
    // deux clés différentes => secrets différents
    const id = randomUUID();
    expect(deriveEndpointSecret(id, 1, { INBOUND_SECRET_KEY: "a".repeat(32) })).not.toBe(deriveEndpointSecret(id, 1, { INBOUND_SECRET_KEY: "b".repeat(32) }));
  });
  it("sel du hachage d'IP : obligatoire et fort en production", () => {
    expect(() => ipSalt({ NODE_ENV: "production" })).toThrow();
    expect(() => ipSalt({ NODE_ENV: "production", WEBHOOK_SIGNING_SALT: "dev-insecure-salt" })).toThrow();
    expect(() => ipSalt({ NODE_ENV: "production", WEBHOOK_SIGNING_SALT: "court" })).toThrow();
    expect(ipSalt({ NODE_ENV: "production", WEBHOOK_SIGNING_SALT: "s".repeat(20) })).toBe("s".repeat(20));
  });
  // MINEUR : en production sans INBOUND_SECRET_KEY, la dérivation lève une exception non attrapée dans le handler (500 au lieu de 401).
  it("sans clé d'application valide, un endpoint nouveau échoue fermé (jamais d'accès)", async () => {
    const org = await mkOrg(`RC K ${run}`);
    const e = await mkEp(org, "generic");
    const prev = { n: process.env.NODE_ENV, k: process.env.INBOUND_SECRET_KEY, s: process.env.WEBHOOK_SIGNING_SALT };
    const env = process.env as Record<string, string | undefined>;
    try {
      env.NODE_ENV = "production"; delete env.INBOUND_SECRET_KEY; env.WEBHOOK_SIGNING_SALT = "s".repeat(24);
      const body = lead("nokey"); const ts = Math.floor(Date.now() / 1000);
      let status = 0;
      try { status = (await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${"0".repeat(64)}` })).status; } catch { status = 500; }
      expect([401, 500]).toContain(status);
      expect((await admin.from("leads").select("id", { count: "exact", head: true }).eq("org_id", org)).count).toBe(0);
    } finally {
      for (const [k, v] of [["NODE_ENV", prev.n], ["INBOUND_SECRET_KEY", prev.k], ["WEBHOOK_SIGNING_SALT", prev.s]] as const) { if (v === undefined) delete env[k]; else env[k] = v; }
    }
  });
});

describe("Meta : secret d'application chiffré + X-Hub-Signature-256", () => {
  const sig = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  it("chiffrement AES-GCM : jamais en clair en base ni lisible par un client ; falsification détectée", async () => {
    const org = await mkOrg(`RC M ${run}`);
    const appSecret = "meta-app-secret-" + run;
    const e = await mkEp(org, "meta", { meta_app_secret_enc: encryptSecret(appSecret) });
    const row = (await admin.from("inbound_endpoints").select("meta_app_secret_enc, has_meta_secret").eq("id", e.id).single()).data!;
    expect(row.meta_app_secret_enc).not.toContain(appSecret);
    expect(row.has_meta_secret).toBe(true);
    expect(decryptSecret(row.meta_app_secret_enc)).toBe(appSecret);
    const blob = row.meta_app_secret_enc.split(".");
    blob[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptSecret(blob.join("."))).toBeNull();
    expect(decryptSecret("v2.a.b.c")).toBeNull();
    expect(decryptSecret(encryptSecret(appSecret), { INBOUND_SECRET_KEY: "z".repeat(40) })).toBeNull(); // mauvaise clé
    // un client authentifié ne peut lire ni la colonne chiffrée ni secret_hash
    const u = await admin.auth.admin.createUser({ email: `rcm-${run}@test.local`, password: "Passw0rd!test", email_confirm: true });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email: `rcm-${run}@test.local`, password: "Passw0rd!test" });
    expect((await c.from("inbound_endpoints").select("meta_app_secret_enc")).error).not.toBeNull();
    expect((await c.from("inbound_endpoints").select("secret_hash")).error).not.toBeNull();
    expect((await c.from("inbound_endpoints").select("*")).error).not.toBeNull();
    expect((await createClient(URL, ANON, { auth: { persistSession: false } }).from("inbound_endpoints").select("has_meta_secret")).error).not.toBeNull();
    await admin.auth.admin.deleteUser(u.data.user!.id);
  });
  it("signature obligatoire dès qu'un secret d'application est renseigné ; corps brut ; valeurs invalides refusées", async () => {
    const org = await mkOrg(`RC N ${run}`);
    const appSecret = "app-secret-" + run;
    const e = await mkEp(org, "meta", { meta_app_secret_enc: encryptSecret(appSecret) });
    const body = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { field_data: [{ name: "email", values: [`meta-${run}@x.io`] }, { name: "full_name", values: ["Meta Ok"] }] } }] }] });
    expect((await call(e.token, body)).status).toBe(401); // sans en-tête
    for (const bad of ["", "sha256=", `sha256=${"0".repeat(64)}`, sig("autre", body), sig(appSecret, body).replace("sha256=", "sha1="), sig(appSecret, body).toUpperCase().replace("SHA256=", "sha256=x"), `sha256=${"a".repeat(63)}`, sig(appSecret, body) + "00"])
      expect((await call(e.token, body, { "x-hub-signature-256": bad })).status, bad.slice(0, 20)).toBe(401);
    expect((await call(e.token, body + " ", { "x-hub-signature-256": sig(appSecret, body) })).status).toBe(401); // corps modifié d'un octet
    expect((await call(e.token, body, { "x-hub-signature-256": sig(appSecret, body) })).status).toBe(200);
    expect((await call(e.token, body, { "x-hub-signature-256": sig(appSecret, body).toUpperCase().replace("SHA256=", "sha256=") })).status).toBe(200); // hex insensible à la casse
    expect(verifyMetaSignature(null, appSecret, body)).toBe(false);
    expect(read("src/lib/inbound/auth.ts")).toMatch(/safeEqualHex\(createHmac\("sha256", appSecret\)/);
    // secret indéchiffrable (clé changée) => échec fermé
    const bad = await mkEp(org, "meta", { meta_app_secret_enc: "v1.aaaa.bbbb.cccc" });
    expect((await call(bad.token, body, { "x-hub-signature-256": sig(appSecret, body) })).status).toBe(401);
    // sans secret d'application configuré : rejet (le jeton d'URL seul ne suffit plus)
    const open = await mkEp(org, "meta");
    expect((await call(open.token, body)).status).toBe(401);
    expect((await call(open.token, body, { "x-hub-signature-256": sig(appSecret, body) })).status).toBe(401);
    // GET verify_token : inchangé, 404 neutre sinon
    const g = (q: string) => GET(new NextRequest(`http://localhost/api/webhooks/inbound/${e.token}?${q}`), { params: Promise.resolve({ token: e.token }) });
    expect((await g(`hub.mode=subscribe&hub.verify_token=${e.secret}&hub.challenge=77`)).status).toBe(200);
    expect((await g(`hub.mode=subscribe&hub.verify_token=${e.hash}&hub.challenge=77`)).status).toBe(404);
  });
});

describe("sanitisation entrante", () => {
  it("bidi (U+202A-202E, U+2066-2069, U+200E/F) et octets nuls retirés ; formules neutralisées dans les champs texte", async () => {
    expect(cleanText("ab‮cd⁦ef‏g\u0000h")).toBe("abcdefgh");
    const org = await mkOrg(`RC S ${run}`);
    const e = await mkEp(org, "generic");
    const r = await call(e.token, JSON.stringify({ email: `bidi-${run}@x.io`, first_name: "‮=cmd|' /C calc'!A0", last_name: "Lo⁦rem", company: "+SUM(1)" }), { "x-leadforge-secret": e.secret });
    expect(r.status).toBe(200);
    const l = (await admin.from("leads").select("first_name, last_name, company").eq("org_id", org).single()).data!;
    expect(l.first_name.startsWith("'=")).toBe(true);
    expect(l.last_name).toBe("Lorem");
    expect(l.company.startsWith("'+")).toBe(true);
    for (const v of Object.values(l)) expect(String(v)).not.toMatch(/[‪-‮⁦-⁩‎‏]/);
  });
});

describe("/api/cron/maintenance", () => {
  const req = (auth?: string) => new NextRequest("http://localhost/api/cron/maintenance", { headers: auth ? { authorization: auth } : {} });
  it("cronAuthorized : temps constant (hachages), refus sans secret/secret court/schéma/valeur proche", () => {
    const s = "c".repeat(24);
    expect(cronAuthorized(`Bearer ${s}`, s)).toBe(true);
    for (const h of [null, "", "Bearer ", `Bearer ${s}x`, `Bearer ${s.slice(0, -1)}`, `bearer ${s}`, `Basic ${s}`, s, "Bearer " + "c".repeat(5000)]) expect(cronAuthorized(h, s), String(h).slice(0, 12)).toBe(false);
    expect(cronAuthorized("Bearer short", "short")).toBe(false);
    expect(cronAuthorized(`Bearer ${s}`, undefined)).toBe(false);
    expect(read("src/lib/cron.ts")).toMatch(/timingSafeEqual/);
  });
  it("route : 404 sans CRON_SECRET, 401 sans/avec mauvais jeton (sans fuite), 200 avec jeton ; idempotent ; GET et POST", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.CRON_SECRET;
    try {
      delete env.CRON_SECRET;
      expect((await CRON_GET(req("Bearer x".repeat(3)))).status).toBe(404);
      env.CRON_SECRET = "cron-secret-" + run + "-0123456789";
      const r1 = await CRON_GET(req());
      const r2 = await CRON_GET(req("Bearer mauvais"));
      expect([r1.status, r2.status]).toEqual([401, 401]);
      expect(await r1.json()).toEqual({ error: "unauthorized" });
      const ok = await CRON_GET(req(`Bearer ${env.CRON_SECRET}`));
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toBe("no-store");
      const first = await ok.json();
      expect(Object.keys(first.report).sort()).toEqual(["housekeeping", "importFilesRemoved", "importJobsDeleted", "inboundEventsDeleted"]);
      const second = await (await CRON_POST(req(`Bearer ${env.CRON_SECRET}`))).json();
      expect(second.report.importFilesRemoved).toBe(0); // idempotent : rien de plus à purger
    } finally {
      if (prev === undefined) delete env.CRON_SECRET; else env.CRON_SECRET = prev;
    }
  });
  // FAILLE (majeur fonctionnel) : le middleware ne déclare pas /api/cron/ comme public ; un appel du planificateur
  // (sans session) est redirigé vers /login : la maintenance et la rétention RGPD ne s'exécutent jamais.
  it("/api/cron/maintenance doit être joignable sans session (chemin public, protégé par CRON_SECRET)", () => {
    expect(isPublicPath("/api/cron/maintenance")).toBe(true);
  });
  it("rétention : purge réservée au service_role ; la purge d'événements ne supprime que les anciens, tous tenants confondus mais sans toucher aux récents", async () => {
    const org = await mkOrg(`RC P ${run}`);
    const e = await mkEp(org, "generic");
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const mid = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const ins = await admin.from("inbound_events").insert([
      { org_id: org, endpoint_id: e.id, status: "rejected", received_at: old, payload: { a: 1 } },
      { org_id: org, endpoint_id: e.id, status: "rejected", received_at: mid, payload: { a: 1 } },
      { org_id: org, endpoint_id: e.id, status: "rejected", received_at: new Date().toISOString(), payload: { a: 1 } },
    ]);
    expect(ins.error).toBeNull();
    const { runMaintenance } = await import("@/lib/maintenance");
    await runMaintenance();
    const rows = (await admin.from("inbound_events").select("received_at, payload").eq("org_id", org)).data!;
    expect(rows).toHaveLength(2); // l'ancien (100 j) supprimé
    expect(rows.find((r) => r.received_at.startsWith(mid.slice(0, 10)))!.payload).toBeNull(); // masqué (> 14 j)
    expect(rows.find((r) => !r.received_at.startsWith(mid.slice(0, 10)))!.payload).not.toBeNull(); // récent intact
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    expect((await anon.rpc("purge_inbound_events", {})).error).not.toBeNull();
  });
});

describe("CSV de simulation conservé jusqu'à l'import", () => {
  it("bucket imports : aucun accès client (liste, lecture, URL signée, écriture, suppression), entre users/orgs/anon", async () => {
    const org = await mkOrg(`RC I ${run}`);
    const p = `${org}/${randomUUID()}.csv`;
    await admin.storage.from("imports").upload(p, new Blob(["a,b\nsecret@pii.io,1"], { type: "text/csv" }), { contentType: "text/csv" });
    const mk = async (tag: string) => {
      const email = `rci-${tag}-${run}@test.local`;
      const u = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
      const c = createClient(URL, ANON, { auth: { persistSession: false } });
      await c.auth.signInWithPassword({ email, password: "Passw0rd!test" });
      return { c, id: u.data.user!.id };
    };
    const [x, y] = [await mk("x"), await mk("y")];
    await admin.from("profiles").update({ provisioned_org: org }).eq("id", x.id);
    const role = (await admin.from("roles").insert({ org_id: org, name: "Imp", permissions: ["leads.import", "leads.view_all", "settings.manage"] }).select("id").single()).data!.id;
    await admin.from("memberships").insert({ org_id: org, user_id: x.id, role_id: role }); // même org, mêmes droits d'import
    for (const cl of [x.c, y.c, createClient(URL, ANON, { auth: { persistSession: false } })]) {
      const b = cl.storage.from("imports");
      expect((await b.download(p)).error).not.toBeNull();
      expect((await b.createSignedUrl(p, 60)).error).not.toBeNull();
      expect((await b.list(org)).data ?? []).toEqual([]);
      expect((await b.upload(`${org}/evil.csv`, new Blob(["x"], { type: "text/csv" }), { contentType: "text/csv" })).error).not.toBeNull();
      expect((await b.remove([p])).data ?? []).toEqual([]);
    }
    expect((await fetch(`${URL}/storage/v1/object/public/imports/${p}`)).status).toBeGreaterThanOrEqual(400);
    expect((await admin.storage.from("imports").download(p)).error).toBeNull();
    // import_jobs d'un autre user de la même org : illisible sans être admin/auteur
    const job = (await admin.from("import_jobs").insert({ org_id: org, user_id: userA, filename: "f.csv", file_path: p }).select("id").single()).data!.id;
    expect((await x.c.from("import_jobs").select("id").eq("id", job)).data).toEqual([]);
    expect((await y.c.from("import_jobs").select("id").eq("id", job)).data).toEqual([]);
    // suppression à l'abandon : purgeImportFiles retire le fichier et efface file_path
    await admin.from("import_jobs").update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), status: "validated" }).eq("id", job);
    const { purgeImportFiles } = await import("@/lib/maintenance");
    await purgeImportFiles();
    expect((await admin.storage.from("imports").download(p)).error).not.toBeNull();
    expect((await admin.from("import_jobs").select("file_path, status").eq("id", job).single()).data).toEqual({ file_path: null, status: "failed" });
    // un import récent (< 1 h) n'est pas touché
    const p2 = `${org}/${randomUUID()}.csv`;
    await admin.storage.from("imports").upload(p2, new Blob(["a\n1"], { type: "text/csv" }), { contentType: "text/csv" });
    const job2 = (await admin.from("import_jobs").insert({ org_id: org, user_id: userA, filename: "g.csv", file_path: p2, status: "validated" }).select("id").single()).data!.id;
    await purgeImportFiles();
    expect((await admin.storage.from("imports").download(p2)).error).toBeNull();
    await admin.storage.from("imports").remove([p2]);
    void job2;
    for (const u of [x.id, y.id]) await admin.auth.admin.deleteUser(u);
  });
  it("échec d'import : le fichier est supprimé dans la branche catch ; jobs filtrés par org ET auteur (statique)", () => {
    const act = read("src/app/(app)/import/actions.ts");
    const failBranch = act.slice(act.indexOf("} catch (e) {", act.indexOf("export async function runImportAction")), act.indexOf("export async function errorReportCsvAction"));
    expect(failBranch).toMatch(/storage\.from\(BUCKET\)\.remove\(\[job\.file_path\]\)/);
    expect(failBranch).toMatch(/file_path: null/);
    expect(act).toMatch(/\.eq\("org_id", s\.org\.id\)\.eq\("user_id", s\.user\.id\)/);
  });
});
