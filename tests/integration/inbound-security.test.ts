import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/webhooks/inbound/[token]/route";
import { signPayload } from "@/lib/automation/signature";
import { generateToken, newEndpointSecret, ipFromHeaders } from "@/lib/inbound/auth";
import { dryRunSchema } from "@/lib/validation/import";
import { autoMap } from "@/lib/import/mapping";

// QA2 S5 : attaques sur la route publique /api/webhooks/inbound/[token] et sur l'import CSV.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const run = Math.random().toString(36).slice(2, 8);
const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

let userA = "", orgA = "", orgB = "", srcId = "";
interface Ep { id: string; token: string; secret: string; hash: string }
const eps: Record<string, Ep> = {};
const orgs: string[] = [];

async function mkOrg(name: string) {
  const { data, error } = await admin.from("organizations").insert({ name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${run}`, template: "generic", created_by: userA }).select("id").single();
  if (error) throw error;
  await admin.from("statuses").insert({ org_id: data.id, name: "Nouveau", color: "#3b82f6", is_initial: true });
  orgs.push(data.id);
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
const call = (token: string, body: BodyInit | null, headers: Record<string, string> = {}) =>
  POST(new NextRequest(`http://localhost/api/webhooks/inbound/${token}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }), { params: Promise.resolve({ token }) });
const auth = (e: Ep) => ({ "x-leadforge-secret": e.secret });
const leadsOf = async (org: string) => (await admin.from("leads").select("*").eq("org_id", org)).data ?? [];

beforeAll(async () => {
  const { data } = await admin.auth.admin.createUser({ email: `isec-${run}@test.local`, password: "Passw0rd!test", email_confirm: true });
  userA = data.user!.id;
  orgA = await mkOrg(`ISEC A ${run}`);
  orgB = await mkOrg(`ISEC B ${run}`);
  srcId = (await admin.from("lead_sources").insert({ org_id: orgA, name: "Webhook sec" }).select("id").single()).data!.id;
  eps.gen = await mkEp(orgA, "generic", { default_source_id: srcId, dedupe_window_hours: 0 });
  eps.meta = await mkEp(orgA, "meta");
  eps.google = await mkEp(orgA, "google");
  eps.proto = await mkEp(orgA, "generic", { dedupe_window_hours: 0, mapping: { "__proto__.polluted": "firstName", "constructor.prototype.x": "lastName", "a.b": "custom.constructor", email: "email" } });
  eps.b = await mkEp(orgB, "generic");
});
afterAll(async () => {
  for (const id of orgs) await admin.from("organizations").delete().eq("id", id);
  await admin.auth.admin.deleteUser(userA);
});

describe("org dérivée du jeton, mass assignment, injection", () => {
  it("payload forgé (org_id, status_id, assigned_to, source_id, created_by, id, created_at, archived_at, custom) : rien n'est pris en compte", async () => {
    const e = eps.gen!;
    const fake = crypto.randomUUID();
    const body = JSON.stringify({
      email: "mass@assign.io", name: "Mass Assign", org_id: orgB, orgId: orgB, status_id: fake, assigned_to: userA, source_id: fake, created_by: userA,
      id: fake, created_at: "2000-01-01T00:00:00Z", archived_at: "2000-01-01T00:00:00Z", position: 1, lat: 1, lng: 1, custom: { is_admin: true }, "custom.x": 1,
    });
    const r = await call(e.token, body, auth(e));
    expect(r.status).toBe(200);
    const l = (await leadsOf(orgA)).find((x) => x.email === "mass@assign.io")!;
    expect(l).toBeTruthy();
    expect(l.org_id).toBe(orgA);
    expect(l.id).not.toBe(fake);
    expect(l.assigned_to).toBeNull();
    expect(l.created_by).toBeNull();
    expect(l.source_id).toBe(srcId);
    expect(l.archived_at).toBeNull();
    expect(l.lat).toBeNull();
    expect(Date.parse(l.created_at)).toBeGreaterThan(Date.parse("2020-01-01"));
    expect(l.custom).toEqual({});
    expect((await leadsOf(orgB)).length).toBe(0);
  });
  it("prototype pollution : __proto__ / constructor dans le payload ET dans le mappage n'altèrent rien", async () => {
    const e = eps.proto!;
    const body = '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"x":"y"}},"a":{"b":"v"},"email":"proto@pollute.io","name":"P P"}';
    const r = await call(e.token, body, auth(e));
    expect(r.status).toBe(200);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    const g = eps.gen!;
    expect((await call(g.token, '{"__proto__":{"isAdmin":true},"email":"proto2@pollute.io","name":"Q Q"}', auth(g))).status).toBe(200);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
  it("texte hostile : HTML/script, SQL, bidi, octets nuls, formules => stockés comme données, nettoyés ou neutralisés", async () => {
    const e = eps.gen!;
    const body = JSON.stringify({
      email: "hostile@x.io", first_name: "=HYPERLINK(\"http://evil\")", last_name: "<script>alert(1)</script>'; DROP TABLE leads;--",
      company: "Evil\u0000Corp‮etaerc", city: "@cmd|' /C calc'!A0", address: "+1+1",
    });
    expect((await call(e.token, body, auth(e))).status).toBe(200);
    const l = (await leadsOf(orgA)).find((x) => x.email === "hostile@x.io")!;
    expect(l.first_name).toBe('\'=HYPERLINK("http://evil")');
    expect(l.last_name).toBe("<script>alert(1)</script>'; DROP TABLE leads;--"); // donnée brute : l'affichage doit échapper (React)
    expect(l.company).not.toContain("\u0000");
    expect(l.city.startsWith("'@")).toBe(true);
    expect(l.address.startsWith("'+")).toBe(true);
    expect((await admin.from("leads").select("id", { count: "exact", head: true }).eq("org_id", orgA)).count).toBeGreaterThan(0); // table intacte
  });
  it("affichage : aucun dangerouslySetInnerHTML dans src (leads, notifications, journal, fiche)", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((f: { name: string; isDirectory(): boolean }) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]));
    const bad = walk(path.join(root, "src")).filter((f) => /\.(tsx?|jsx?)$/.test(f) && !f.endsWith("marketing/json-ld.tsx") && /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
  it("champs personnalisés entrants validés (type, clé inconnue) ; constructor/prototype ne contournent rien", async () => {
    const e = eps.proto!;
    // le mappage envoie a.b vers custom.constructor : champ inconnu => lead rejeté (pas créé), pas d'erreur 500
    const before = (await leadsOf(orgA)).length;
    const r = await call(e.token, JSON.stringify({ a: { b: "v" }, email: "cc@x.io", name: "C C" }), auth(e));
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("rejected");
    expect((await leadsOf(orgA)).length).toBe(before);
  });
  it("journal inbound_events : PII masquée, secrets masqués, pas de payload brut ; pas de secret dans les rejets", async () => {
    const e = eps.gen!;
    await call(e.token, JSON.stringify({ email: "pii.person@secret.io", phone: "0611223344", name: "Pii Person", api_key: "SUPERSECRET", token: "tok123" }), auth(e));
    const ev = (await admin.from("inbound_events").select("payload, reason, ip_hash").eq("endpoint_id", e.id).order("received_at", { ascending: false }).limit(1)).data![0]!;
    const s = JSON.stringify(ev.payload);
    expect(s).not.toContain("pii.person");
    expect(s).not.toContain("0611223344");
    expect(s).not.toContain("SUPERSECRET");
    expect(s).not.toContain("tok123");
    await call(e.token, "{}", { "x-leadforge-secret": "lfs_mauvaissecretxxxxxxxxxxxxxxxxxxxxxxx" });
    const all = JSON.stringify((await admin.from("inbound_events").select("*").eq("endpoint_id", e.id)).data);
    expect(all).not.toContain(e.secret);
    expect(all).not.toContain("lfs_mauvaissecret");
    expect(ev.ip_hash).toBeTruthy();
  });
});

describe("DoS et corps hostiles", () => {
  it("Content-Length mensonger (déclare 10 octets, envoie 300 Ko) : refusé 413 sans lire tout", async () => {
    const e = eps.gen!;
    const r = await call(e.token, JSON.stringify({ pad: "x".repeat(300 * 1024) }), { ...auth(e), "content-length": "10" });
    expect(r.status).toBe(413);
  });
  it("flux sans fin : interrompu à 100 Ko", async () => {
    const e = eps.gen!;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { sent += 65536; c.enqueue(new Uint8Array(65536).fill(97)); } });
    const t0 = Date.now();
    const r = await POST(new NextRequest(`http://localhost/api/webhooks/inbound/${e.token}`, { method: "POST", body: stream, headers: { "content-type": "application/json", ...auth(e) }, duplex: "half" } as never), { params: Promise.resolve({ token: e.token }) });
    expect(r.status).toBe(413);
    expect(sent).toBeLessThan(5 * 1024 * 1024);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("JSON très profond, très large, grand tableau : jamais de 500, temps borné", async () => {
    const e = eps.gen!;
    const deepArr = "[".repeat(40000) + "]".repeat(40000);
    const deepObj = '{"a":'.repeat(15000) + "1" + "}".repeat(15000);
    const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 8000 }, (_, i) => [`k${i}`, i])));
    const big = JSON.stringify({ email: "big@x.io", name: "Big", items: Array.from({ length: 9000 }, () => "abc") });
    for (const [n, b] of [["deepArr", deepArr], ["deepObj", deepObj], ["wide", wide], ["big", big]] as const) {
      const t0 = Date.now();
      const r = await call(e.token, b, auth(e));
      expect(r.status, n).toBeLessThan(500);
      expect(Date.now() - t0, n).toBeLessThan(5000);
    }
  });
  it("chemin de mappage : regex sans backtracking catastrophique, profondeur bornée", async () => {
    const { getPath, mappingConfigSchema } = await import("@/lib/inbound/adapters");
    const t0 = Date.now();
    expect(mappingConfigSchema.safeParse({ [("a.".repeat(40)).slice(0, 80)]: "email" }).success).toBe(true);
    expect(mappingConfigSchema.safeParse({ ["a".repeat(81)]: "email" }).success).toBe(false);
    expect(mappingConfigSchema.safeParse({ "a$(b)": "email" }).success).toBe(false);
    expect(mappingConfigSchema.safeParse({ a: "custom.__proto__" }).success).toBe(false);
    expect(getPath({ a: 1 }, "a.".repeat(40))).toBeUndefined();
    expect(getPath(JSON.parse('{"__proto__":{"x":1}}'), "__proto__.x")).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("route : pas de CORS, pas d'OPTIONS, aucune voie 'trusted' depuis HTTP, erreurs génériques", () => {
    const src = read("src/app/api/webhooks/inbound/[token]/route.ts");
    expect(src).not.toMatch(/access-control|Access-Control/i);
    expect(src).not.toMatch(/export async function (OPTIONS|PUT|PATCH|DELETE)/);
    expect(src).not.toMatch(/trusted/);
    expect(read("src/lib/inbound/handler.ts")).not.toMatch(/error\.message|e\.message|stack/);
  });
});

describe("réponses neutres, Meta, signature", () => {
  it("404 : corps et en-têtes identiques pour jeton inconnu / mal formé / désactivé / endpoint d'un autre type en GET", async () => {
    const off = await mkEp(orgA, "generic", { active: false });
    const results = [];
    for (const t of [generateToken(), "court", off.token, eps.gen!.token]) {
      const r = await GET(new NextRequest(`http://localhost/api/webhooks/inbound/${t}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=abc`), { params: Promise.resolve({ token: t }) });
      results.push([r.status, await r.text(), r.headers.get("content-type")]);
    }
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(results[0]![0]).toBe(404);
  });
  it("Meta GET : verify_token exact requis (comparaison sur hachages, longueurs variables sans exception), challenge en text/plain borné", async () => {
    const m = eps.meta!;
    const get = async (q: string) => GET(new NextRequest(`http://localhost/api/webhooks/inbound/${m.token}?${q}`), { params: Promise.resolve({ token: m.token }) });
    expect((await get(`hub.mode=subscribe&hub.verify_token=${m.secret}&hub.challenge=1234`)).status).toBe(200);
    for (const bad of ["", "a", m.secret.slice(0, -1), m.secret + "x", "x".repeat(5000), m.hash])
      expect((await get(`hub.mode=subscribe&hub.verify_token=${encodeURIComponent(bad)}&hub.challenge=1`)).status, bad.slice(0, 10)).toBe(404);
    expect((await get(`hub.mode=unsubscribe&hub.verify_token=${m.secret}&hub.challenge=1`)).status).toBe(404);
    const r = await get(`hub.mode=subscribe&hub.verify_token=${m.secret}&hub.challenge=${encodeURIComponent("<script>alert(1)</script>" + "A".repeat(500))}`);
    expect(r.headers.get("content-type")).toContain("text/plain");
    expect((await r.text()).length).toBeLessThanOrEqual(200);
    expect(read("src/lib/inbound/auth.ts")).toMatch(/timingSafeEqual/);
  });
  it("Meta POST : seul le jeton d'URL protège (documenté) ; un jeton inconnu reste neutre", async () => {
    const m = eps.meta!;
    const body = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { field_data: [{ name: "email", values: ["meta.sec@x.io"] }, { name: "full_name", values: ["Meta Sec"] }] } }] }] });
    expect((await call(m.token, body)).status).toBe(200);
    expect((await call(generateToken(), body)).status).toBe(404);
  });
  // FAILLE CONNUE (mineur/majeur selon exposition d'une fuite de base) : la clé HMAC est le SHA-256 du secret, stocké en base.
  // Quiconque lit secret_hash (sauvegarde, injection SQL, accès service_role) peut forger des signatures valides.
  it("une signature forgée avec le seul hachage stocké en base devrait être refusée", async () => {
    const e = eps.gen!;
    const body = JSON.stringify({ email: "forged.hmac@x.io", name: "Forged" });
    const ts = Math.floor(Date.now() / 1000);
    const r = await call(e.token, body, { "x-leadforge-signature": `t=${ts},v1=${signPayload(e.hash, ts, body)}` });
    expect(r.status).toBe(401);
  });
  it("rejeu d'une signature valide dans la fenêtre de 5 min : accepté mais sans doublon de lead (dédoublonnage)", async () => {
    const e = await mkEp(orgA, "generic", { dedupe_window_hours: 72 });
    const body = JSON.stringify({ email: "replay@x.io", name: "Replay" });
    const ts = Math.floor(Date.now() / 1000);
    const h = { "x-leadforge-signature": `t=${ts},v1=${signPayload(e.secret, ts, body)}` };
    expect((await (await call(e.token, body, h)).json()).status).toBe("created");
    expect((await (await call(e.token, body, h)).json()).status).toBe("duplicate");
    expect((await leadsOf(orgA)).filter((l) => l.email === "replay@x.io")).toHaveLength(1);
  });
});

describe("limitation de débit, floods, notifications", () => {
  it("IP : X-Forwarded-For ignoré sans TRUSTED_PROXY ; avec proxy de confiance, entrée de droite (non forgeable par le client)", () => {
    const h = (v: string) => (n: string) => (n === "x-forwarded-for" ? v : null);
    expect(ipFromHeaders(h("1.2.3.4, 5.6.7.8"), {})).toBeNull();
    expect(ipFromHeaders(h("6.6.6.6, 9.9.9.9"), { TRUSTED_PROXY: "1" })).toBe("9.9.9.9");
    expect(ipFromHeaders(h("::ffff:1.2.3.4"), { TRUSTED_PROXY: "1" })).toBe("::ffff:1.2.3.4");
  });
  it("création en masse : limite par endpoint (429) ; notifications bornées à 5 admins/lead, dédupliquées", async () => {
    const org = await mkOrg(`ISEC F ${run}`);
    for (let i = 0; i < 7; i++) {
      const { data } = await admin.auth.admin.createUser({ email: `adm${i}-${run}@t.local`, password: "Passw0rd!test", email_confirm: true });
      const role = (await admin.from("roles").insert({ org_id: org, name: `Adm${i}`, is_admin: true, permissions: [] }).select("id").single()).data!.id;
      await admin.from("profiles").update({ provisioned_org: org }).eq("id", data.user!.id);
      await admin.from("memberships").insert({ org_id: org, user_id: data.user!.id, role_id: role });
    }
    const e = await mkEp(org, "generic", { dedupe_window_hours: 0 });
    let created = 0, limited = 0;
    for (let i = 0; i < 70; i++) {
      const r = await call(e.token, JSON.stringify({ email: `flood${i}@x.io`, name: `F ${i}` }), auth(e));
      if (r.status === 429) limited++; else if ((await r.json()).status === "created") created++;
    }
    expect(limited).toBeGreaterThan(0);
    expect(created).toBeLessThanOrEqual(60);
    const n = (await admin.from("notifications").select("id", { count: "exact", head: true }).eq("org_id", org)).count!;
    expect(n).toBeLessThanOrEqual(created * 5);
    const users = (await admin.from("memberships").select("user_id").eq("org_id", org)).data!;
    for (const u of users) await admin.auth.admin.deleteUser(u.user_id);
  });
  // FAILLE CONNUE (majeur) : sans TRUSTED_PROXY, l'IP est inconnue (null) et TOUS les appelants partagent le même
  // seau "inbound-ip:<hash(unknown)>" de 120 req/min. Un tenant avec 2 endpoints (2 x 60/min) épuise le seau
  // et fait refuser (429) les webhooks de tous les autres tenants.
  it("le quota par IP ne doit pas être partagé entre tenants quand l'IP est inconnue", async () => {
    const a1 = await mkEp(orgA, "generic");
    const a2 = await mkEp(orgA, "generic");
    for (const ep of [a1, a2]) for (let i = 0; i < 60; i++) await call(ep.token, "{}", auth(ep));
    const victim = eps.b!;
    const r = await call(victim.token, JSON.stringify({ email: "victim@x.io", name: "Victime" }), auth(victim));
    expect(r.status).not.toBe(429);
  });
});

describe("import CSV : permissions, rejeu, prototype, rétention", () => {
  const act = read("src/app/(app)/import/actions.ts");
  it("toutes les actions d'import exigent leads.import (guard) ; les jobs sont filtrés par org ET auteur", () => {
    for (const fn of ["uploadCsvAction", "dryRunAction", "runImportAction", "errorReportCsvAction"]) {
      const b = act.slice(act.indexOf(`export async function ${fn}`)).split(/\nexport (async function|type)/)[0]!;
      expect(b, fn).toMatch(/guard\(PERM,/);
    }
    expect(act).toMatch(/\.eq\("org_id", s\.org\.id\)\.eq\("user_id", s\.user\.id\)/);
    expect(act).toMatch(/\.eq\("status", "validated"\)\.select/); // transition atomique : un job ne s'exécute qu'une fois
    expect(act).toMatch(/const path = `\$\{s\.org\.id\}\/\$\{job\.id\}\.csv`/); // chemin généré, jamais le nom de fichier client
  });
  it("mappage : en-têtes __proto__/constructor ne polluent rien ; schéma Zod borne les cibles", () => {
    const m = JSON.parse('{"__proto__":"email","constructor":"phone","toString":"first_name"}');
    const r = dryRunSchema.safeParse({ jobId: crypto.randomUUID(), mapping: m, options: { duplicateMode: "skip", duplicateBy: "email", sourceId: null, assign: { mode: "none" } } });
    expect(({} as Record<string, unknown>).email).toBeUndefined();
    void r;
    const auto = autoMap(["__proto__", "constructor", "Email"], []);
    expect(({} as Record<string, unknown>).email).toBeUndefined();
    expect(auto.Email).toBe("email");
    expect(dryRunSchema.safeParse({ jobId: crypto.randomUUID(), mapping: { A: "../../etc" }, options: { duplicateMode: "skip", duplicateBy: "email", sourceId: null, assign: { mode: "none" } } }).success).toBe(false);
  });
  it("bombes : 5 Mo / 5000 lignes / 60 colonnes plafonnés avant analyse", async () => {
    const { parseCsv, IMPORT_MAX_ROWS, IMPORT_MAX_BYTES, CsvError } = await import("@/lib/import/csv");
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(() => parseCsv(enc("a,b\n" + "1,2\n".repeat(IMPORT_MAX_ROWS + 1)))).toThrow(CsvError);
    expect(() => parseCsv(enc(Array.from({ length: 61 }, (_, i) => `c${i}`).join(",") + "\n1"))).toThrow(CsvError);
    expect(() => parseCsv(new Uint8Array(IMPORT_MAX_BYTES + 1).fill(97))).toThrow(CsvError);
    expect(() => parseCsv(new Uint8Array([97, 44, 0, 10, 49]))).toThrow(CsvError); // binaire
    const t0 = Date.now();
    const p = parseCsv(enc(`a,b\n"${"x".repeat(1_000_000)}",2`)); // champ énorme : tronqué à 2000
    expect(p.rows[0]![0].length).toBeLessThanOrEqual(2000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  // MINEUR/RGPD : le CSV (données personnelles) reste dans le bucket "imports" si l'import échoue ou n'est jamais lancé,
  // et purge_import_jobs supprime les lignes mais pas les objets Storage.
  it("un import en échec ou abandonné devrait supprimer le fichier source du bucket", () => {
    const failBranch = act.slice(act.indexOf("} catch (e) {", act.indexOf("export async function runImportAction")), act.indexOf("export async function errorReportCsvAction"));
    expect(failBranch).toMatch(/storage[\s\S]*remove/);
  });
  it("rétention : purge_* réservées au service_role ; non planifiées (documenté) ", async () => {
    const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    expect((await anon.rpc("purge_inbound_events", {})).error).not.toBeNull();
    expect((await anon.rpc("purge_import_jobs", {})).error).not.toBeNull();
  });
});
