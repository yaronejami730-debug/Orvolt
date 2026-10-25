import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";

// QA2 S3 : append-only, usurpation d'auteur, contournements REST, Storage (traversal, URL signées), moteur d'actions.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
const orgIds: string[] = [];
let orgA = "", orgB = "";
const st: Record<string, Record<string, string>> = { A: {}, B: {} };
const lead: Record<string, string> = {};
const paths: string[] = [];

async function makeUser(tag: string): Promise<U> {
  const email = `ls-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
const roleId = async (org: string, name: string) => (await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single()).data!.id as string;
async function member(org: string, u: U, role: string) {
  await admin.from("profiles").update({ provisioned_org: org }).eq("id", u.id);
  await admin.from("memberships").insert({ org_id: org, user_id: u.id, role_id: await roleId(org, role) });
}
async function mkLead(org: string, status: string, extra: object = {}) {
  const r = await admin.from("leads").insert({ org_id: org, status_id: status, first_name: "Test", last_name: "Lead", ...extra }).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

beforeAll(async () => {
  const [a, b, own, prosp] = await Promise.all(["a", "b", "own", "prosp"].map(makeUser));
  orgA = (await a!.client.rpc("create_organization", { p_name: `LS A ${run}`, p_template: "generic" })).data as string;
  orgB = (await b!.client.rpc("create_organization", { p_name: `LS B ${run}`, p_template: "generic" })).data as string;
  orgIds.push(orgA, orgB);
  await applyTemplate(orgA, "generic");
  await applyTemplate(orgB, "generic");
  await member(orgA, own!, "Commercial");
  await member(orgA, prosp!, "Prospecteur");
  for (const [k, org] of [["A", orgA], ["B", orgB]] as const) {
    const { data } = await admin.from("statuses").select("id, name").eq("org_id", org);
    for (const s of data!) st[k]![s.name] = s.id;
  }
  lead.A1 = await mkLead(orgA, st.A!["Nouveau"]!, { created_by: a!.id });
  lead.Aown = await mkLead(orgA, st.A!["Nouveau"]!, { assigned_to: own!.id, created_by: a!.id });
  lead.B1 = await mkLead(orgB, st.B!["Nouveau"]!, { created_by: b!.id });
});
afterAll(async () => {
  if (paths.length) await admin.storage.from("lead-files").remove(paths);
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("historique append-only et usurpation d'auteur", () => {
  it("lead_events : aucun insert/update/delete client, même admin de l'org", async () => {
    const a = users.a!.client;
    const ev = (await admin.from("lead_events").select("id").eq("lead_id", lead.A1)).data![0]!;
    expect((await a.from("lead_events").insert({ org_id: orgA, lead_id: lead.A1, type: "note", payload: {} })).error).not.toBeNull();
    expect((await a.from("lead_events").update({ payload: { x: 1 } }).eq("id", ev.id).select()).error).not.toBeNull();
    expect((await a.from("lead_events").delete().eq("id", ev.id).select()).error).not.toBeNull();
    expect((await admin.from("lead_events").select("id").eq("id", ev.id)).data).toHaveLength(1);
  });
  it("action_runs / notifications : pas d'écriture client, pas de forge pour autrui", async () => {
    const a = users.a!.client;
    expect((await a.from("action_runs").insert({ org_id: orgA, type: "notify", dedupe_key: `k${run}` })).error).not.toBeNull();
    expect((await a.from("notifications").insert({ org_id: orgA, user_id: users.own!.id, type: "x" })).error).not.toBeNull();
    expect((await a.from("action_runs").select("id").eq("org_id", orgB)).data).toEqual([]);
  });
  it("notes/appels/tâches/fichiers/leads : author/caller/created_by/uploaded_by forgés refusés", async () => {
    const a = users.a!.client;
    const victim = users.own!.id;
    expect((await a.from("lead_notes").insert({ org_id: orgA, lead_id: lead.A1, author_id: victim, body: "faux" })).error).not.toBeNull();
    expect((await a.from("lead_calls").insert({ org_id: orgA, lead_id: lead.A1, caller_id: victim, outcome: "answered" })).error).not.toBeNull();
    expect((await a.from("tasks").insert({ org_id: orgA, lead_id: lead.A1, title: "t", created_by: victim })).error).not.toBeNull();
    expect((await a.from("lead_files").insert({ org_id: orgA, lead_id: lead.A1, uploaded_by: victim, path: `${orgA}/${lead.A1}/f.txt`, name: "f", size_bytes: 1, mime_type: "text/plain" })).error).not.toBeNull();
    expect((await a.from("leads").insert({ org_id: orgA, created_by: victim, first_name: "X", status_id: st.A!["Nouveau"] })).error).not.toBeNull();
    const own = (await a.from("lead_notes").insert({ org_id: orgA, lead_id: lead.A1, body: "vraie" }).select("author_id").single()).data;
    expect(own?.author_id).toBe(users.a!.id);
  });
  it("note d'autrui : ni modifiable ni supprimable par un non-auteur non admin ; author_id immuable", async () => {
    const n = (await admin.from("lead_notes").insert({ org_id: orgA, lead_id: lead.Aown, author_id: users.a!.id, body: "orig" }).select("id").single()).data!;
    const o = users.own!.client;
    expect((await o.from("lead_notes").update({ body: "hack" }).eq("id", n.id).select()).data ?? []).toEqual([]);
    expect((await o.from("lead_notes").delete().eq("id", n.id).select()).data ?? []).toEqual([]);
    expect((await users.a!.client.from("lead_notes").update({ author_id: users.own!.id }).eq("id", n.id).select()).error).not.toBeNull();
    expect((await admin.from("lead_notes").select("body").eq("id", n.id).single()).data!.body).toBe("orig");
  });
  it("tâches : réassignation et déplacement vers un autre lead/org impossibles côté client", async () => {
    const t = (await users.a!.client.from("tasks").insert({ org_id: orgA, lead_id: lead.A1, title: "mine", assigned_to: users.a!.id }).select("id").single()).data!;
    for (const patch of [{ assigned_to: users.own!.id }, { lead_id: lead.B1 }, { org_id: orgB }, { created_by: users.own!.id }])
      expect((await users.a!.client.from("tasks").update(patch).eq("id", t.id).select()).error, JSON.stringify(patch)).not.toBeNull();
    expect((await users.a!.client.from("tasks").insert({ org_id: orgA, lead_id: lead.B1, title: "x" })).error).not.toBeNull();
    expect((await users.a!.client.from("tasks").insert({ org_id: orgA, title: "x", assigned_to: users.b!.id })).error).not.toBeNull();
    expect((await users.b!.client.from("tasks").select("id").eq("id", t.id)).data).toEqual([]);
  });
});

describe("transitions et view_own via REST", () => {
  it("UPDATE en masse de status_id vers une transition interdite : refusé ligne par ligne", async () => {
    const r = await users.own!.client.from("leads").update({ status_id: st.A!["Gagné"] }).in("id", [lead.Aown]).select("id");
    expect(r.error).not.toBeNull();
    expect((await admin.from("leads").select("status_id").eq("id", lead.Aown).single()).data!.status_id).toBe(st.A!["Nouveau"]);
  });
  it("view_own : ne peut ni lire, ni modifier, ni s'attribuer un lead non visible", async () => {
    const o = users.own!.client;
    expect((await o.from("leads").select("id").eq("id", lead.A1)).data).toEqual([]);
    expect((await o.from("leads").update({ assigned_to: users.own!.id }).eq("id", lead.A1).select("id")).data ?? []).toEqual([]);
    expect((await o.rpc("move_lead", { p_lead: lead.A1, p_to: st.A!["En cours"] })).error).not.toBeNull();
    expect((await admin.from("leads").select("assigned_to, status_id").eq("id", lead.A1).single()).data).toMatchObject({ assigned_to: null, status_id: st.A!["Nouveau"] });
  });
  it("rôle sans leads.edit (Prospecteur a edit, test avec lecture seule) : pas d'écriture de notes", async () => {
    const { data: ro } = await admin.from("roles").insert({ org_id: orgA, name: "Lecteur", permissions: ["leads.view_all"] }).select("id").single();
    const u = await makeUser("ro");
    await admin.from("profiles").update({ provisioned_org: orgA }).eq("id", u.id);
    await admin.from("memberships").insert({ org_id: orgA, user_id: u.id, role_id: ro!.id });
    expect((await u.client.from("lead_notes").insert({ org_id: orgA, lead_id: lead.A1, body: "x" })).error).not.toBeNull();
    expect((await u.client.from("lead_calls").insert({ org_id: orgA, lead_id: lead.A1, outcome: "answered" })).error).not.toBeNull();
    expect((await u.client.from("leads").update({ first_name: "Hack" }).eq("id", lead.A1).select("id")).data ?? []).toEqual([]);
    expect((await u.client.from("leads").delete().eq("id", lead.A1).select("id")).data ?? []).toEqual([]);
    expect((await u.client.from("tasks").insert({ org_id: orgA, title: "x" })).error).not.toBeNull();
  });
  it("membre désactivé : plus aucun accès aux leads ni écriture sur ses propres notes", async () => {
    const u = await makeUser("off");
    await member(orgA, u, "Confirmateur");
    const n = (await u.client.from("lead_notes").insert({ org_id: orgA, lead_id: lead.A1, body: "avant" }).select("id").single()).data!;
    await admin.from("memberships").update({ status: "disabled" }).eq("user_id", u.id).eq("org_id", orgA);
    expect((await u.client.from("leads").select("id")).data ?? []).toEqual([]);
    expect((await u.client.from("lead_notes").update({ body: "apres" }).eq("id", n.id).select()).data ?? []).toEqual([]);
    expect((await u.client.from("lead_notes").delete().eq("id", n.id).select()).data ?? []).toEqual([]);
    expect((await admin.from("lead_notes").select("body").eq("id", n.id).single()).data!.body).toBe("avant");
  });
  // Corrigé : un client non admin créé toujours dans le statut initial (pas de contournement des transitions).
  it("la création directe dans un statut final est ramenée au statut initial", async () => {
    const r = await users.prosp!.client.from("leads").insert({ org_id: orgA, created_by: users.prosp!.id, first_name: "Direct", status_id: st.A!["Gagné"] }).select("id");
    expect(r.error).toBeNull();
    const row = (await admin.from("leads").select("status_id").eq("first_name", "Direct").eq("created_by", users.prosp!.id).single()).data!;
    expect(row.status_id).toBe(st.A!["Nouveau"]);
    await admin.from("leads").delete().eq("first_name", "Direct").eq("created_by", users.prosp!.id);
  });
  // FAILLE CONNUE (majeur si la visibilité par rôle est une promesse produit) : visible_roles / editable_roles
  // ne sont appliqués que par l'application ; la colonne `custom` est lisible et modifiable en entier via REST.
  it("un champ custom non visible/éditable pour le rôle ne devrait pas être modifiable via REST", async () => {
    const roleCom = await roleId(orgA, "Commercial");
    const f = (await admin.from("custom_fields").insert({ org_id: orgA, key: `secret_${run}`, label: `Secret ${run}`, type: "text", visible_roles: [], editable_roles: [] }).select("id").single()).data!;
    const r = await users.own!.client.from("leads").update({ custom: { [`secret_${run}`]: "forcé" } }).eq("id", lead.Aown).select("custom");
    await admin.from("custom_fields").delete().eq("id", f.id);
    void roleCom;
    expect(Boolean(r.error) || !r.data?.length).toBe(true);
  });
});

describe("Storage : URL signées, traversal, suppression cross-org", () => {
  const file = new Blob(["hello"], { type: "text/plain" });
  it("createSignedUrl / download / remove d'un objet d'une autre org ou d'un lead invisible : refusés", async () => {
    const p = `${orgA}/${lead.A1}/priv-${run}.txt`;
    paths.push(p);
    await admin.storage.from("lead-files").upload(p, file, { contentType: "text/plain" });
    for (const u of ["b", "own"]) {
      const b = users[u]!.client.storage.from("lead-files");
      expect((await b.createSignedUrl(p, 60)).error, u).not.toBeNull();
      expect((await b.download(p)).error, u).not.toBeNull();
      expect((await b.remove([p])).data ?? []).toEqual([]);
      expect((await b.list(`${orgA}/${lead.A1}`)).data ?? []).toEqual([]);
    }
    const anon = createClient(URL, ANON, opts).storage.from("lead-files");
    expect((await anon.download(p)).error).not.toBeNull();
    expect((await fetch(`${URL}/storage/v1/object/public/lead-files/${p}`)).status).toBeGreaterThanOrEqual(400);
    expect((await admin.storage.from("lead-files").list(`${orgA}/${lead.A1}`)).data!.map((f) => f.name)).toContain(`priv-${run}.txt`);
  });
  it("path traversal : un chemin forgé (../, %2e%2e, //) ne donne accès à aucun objet d'une autre org", async () => {
    const target = `${orgB}/${lead.B1}/b-secret-${run}.txt`;
    paths.push(target);
    await admin.storage.from("lead-files").upload(target, file, { contentType: "text/plain" });
    const a = users.a!.client.storage.from("lead-files");
    const forged = [
      `${orgA}/${lead.A1}/../../${target}`, `${orgA}/${lead.A1}/..%2f..%2f${target}`, `${orgA}/${lead.A1}//${target}`,
      `${orgA}/${lead.A1}/%2e%2e/%2e%2e/${target}`, `${orgB}/${lead.B1}/b-secret-${run}.txt`, `${orgA}/${lead.A1}/..\\..\\${target}`,
    ];
    for (const f of forged) {
      expect((await a.download(f)).error, f).not.toBeNull();
      expect((await a.createSignedUrl(f, 60)).data?.signedUrl ? (await fetch((await a.createSignedUrl(f, 60)).data!.signedUrl)).status : 404, f).toBeGreaterThanOrEqual(400);
      const up = await a.upload(f + ".x", file, { contentType: "text/plain" });
      if (!up.error) paths.push(f + ".x");
      expect((await admin.storage.from("lead-files").download(target)).error).toBeNull(); // cible intacte
    }
  });
  it("lead_files avec chemin '..' : l'URL signée ne doit jamais ouvrir l'objet d'une autre org", async () => {
    const target = `${orgB}/${lead.B1}/b-secret-${run}.txt`;
    const evil = `${orgA}/${lead.A1}/../../${target}`;
    const ins = await users.a!.client.from("lead_files").insert({ org_id: orgA, lead_id: lead.A1, path: evil, name: "evil.txt", size_bytes: 5, mime_type: "text/plain" }).select("id");
    if (!ins.error) {
      const s = await users.a!.client.storage.from("lead-files").createSignedUrl(evil, 60);
      if (s.data?.signedUrl) {
        const res = await fetch(s.data.signedUrl);
        expect(res.status === 200 ? await res.text() : "").not.toContain("hello");
      }
      await admin.from("lead_files").delete().eq("id", ins.data![0]!.id);
    }
  });
  it("upload : taille > 10 Mo, MIME HTML/SVG/JS refusés", async () => {
    const a = users.a!.client.storage.from("lead-files");
    const big = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "text/plain" });
    expect((await a.upload(`${orgA}/${lead.A1}/big-${run}.txt`, big, { contentType: "text/plain" })).error).not.toBeNull();
    for (const [n, t] of [["a.html", "text/html"], ["a.svg", "image/svg+xml"], ["a.js", "text/javascript"], ["a.exe", "application/x-msdownload"]] as const)
      expect((await a.upload(`${orgA}/${lead.A1}/${n}`, new Blob(["<svg onload=alert(1)>"], { type: t }), { contentType: t })).error, t).not.toBeNull();
  });
});

describe("moteur d'actions : revue statique et comportement", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk(path.resolve(__dirname, "../../src")).filter((f) => /\.(ts|tsx)$/.test(f));
  it("aucun fetch brut côté serveur vers une URL configurable : safeFetch uniquement", () => {
    // Exceptions assumées : composants client (fetch vers notre propre API) et le service de routage dont l'URL (ROUTING_URL, OSRM local) est posée par l'opérateur, jamais par un client.
    const raw = files.filter((f) => !f.endsWith("safe-fetch.ts") && !f.endsWith("src/lib/routing/service.ts") && !readFileSync(f, "utf8").startsWith('"use client"') && /(^|[^.\w])fetch\(/.test(readFileSync(f, "utf8")));
    expect(raw.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
  it("le moteur n'utilise que Deps.fetch (safeFetch en production) et ne rappelle jamais move_lead (pas de récursion)", () => {
    const engine = readFileSync(path.resolve(__dirname, "../../src/lib/automation/engine.ts"), "utf8");
    const store = readFileSync(path.resolve(__dirname, "../../src/lib/automation/store.ts"), "utf8");
    expect(engine).not.toMatch(/move_lead|\.rpc\(|from\("leads"\)/);
    expect(store).not.toMatch(/move_lead/);
    expect(store).toMatch(/fetch: \(url, o\) => safeFetch\(/);
    expect(store).not.toMatch(/[^.\w]fetch\(/);
  });
  it("la mise à jour d'assignation par le moteur ne modifie pas status_id (aucune boucle assign -> move)", async () => {
    const { createSupabaseStore } = await import("@/lib/automation/store");
    const store = createSupabaseStore(admin);
    const before = (await admin.from("leads").select("status_id").eq("id", lead.A1).single()).data!.status_id;
    await store.setAssignee(orgA, lead.A1, users.a!.id);
    const after = (await admin.from("leads").select("status_id, assigned_to").eq("id", lead.A1).single()).data!;
    expect(after.status_id).toBe(before);
    expect(after.assigned_to).toBe(users.a!.id);
    // org différente : aucune modification
    await store.setAssignee(orgB, lead.A1, users.b!.id);
    expect((await admin.from("leads").select("assigned_to").eq("id", lead.A1).single()).data!.assigned_to).toBe(users.a!.id);
  });
  it("idempotence : une même clé n'est réservée qu'une fois (pas de double exécution/flood)", async () => {
    const { createSupabaseStore } = await import("@/lib/automation/store");
    const store = createSupabaseStore(admin);
    const run0 = { orgId: orgA, statusId: st.A!["Nouveau"]!, leadId: lead.A1!, actionId: crypto.randomUUID(), type: "notify" };
    const key = `${crypto.randomUUID()}:${run0.actionId}`;
    const r = await Promise.all([store.claim(key, run0), store.claim(key, run0), store.claim(key, run0)]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });
  it("secret HMAC : propre à chaque org, jamais le sel brut ; sel absent = erreur en production", async () => {
    const { orgWebhookSecret } = await import("@/lib/automation/signature");
    const s1 = orgWebhookSecret("salt", orgA), s2 = orgWebhookSecret("salt", orgB);
    expect(s1).not.toBe(s2);
    expect(s1).not.toContain("salt");
    expect(orgWebhookSecret("salt2", orgA)).not.toBe(s1);
    const prev = { n: process.env.NODE_ENV, s: process.env.WEBHOOK_SIGNING_SALT };
    delete process.env.WEBHOOK_SIGNING_SALT;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const { productionDeps } = await import("@/lib/automation/store");
      expect(() => productionDeps().secret(orgA)).toThrow(/WEBHOOK_SIGNING_SALT/);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev.n!;
      if (prev.s !== undefined) process.env.WEBHOOK_SIGNING_SALT = prev.s;
    }
  });
  // MINEUR connu : hors NODE_ENV=production (préprod/preview), un sel absent retombe sur "dev-insecure-salt" (secrets prévisibles).
  it("sans WEBHOOK_SIGNING_SALT, aucun secret par défaut ne devrait être utilisé quel que soit NODE_ENV", async () => {
    const prev = process.env.WEBHOOK_SIGNING_SALT;
    delete process.env.WEBHOOK_SIGNING_SALT;
    try {
      const { productionDeps } = await import("@/lib/automation/store");
      expect(() => productionDeps().secret(orgA)).toThrow();
    } finally {
      if (prev !== undefined) process.env.WEBHOOK_SIGNING_SALT = prev;
    }
  });
});

// ---- Re-check S3 : champs custom (écriture/lecture), leads_api, patch_lead_custom, chemins, secret.
describe("re-check S3 : champs custom par rôle", () => {
  const key = (n: string) => `${n}_${run}`.toLowerCase();
  let leadOwn = "", leadForeign = "";
  beforeAll(async () => {
    const other = await roleId(orgA, "Confirmateur");
    const mk = (k: string, over: object) => admin.from("custom_fields").insert({ org_id: orgA, key: key(k), label: `L ${k} ${run}`, type: "text", ...over });
    await mk("open", {});
    await mk("hidden", { visible_roles: [other], editable_roles: [other] });
    await mk("roview", { visible_roles: null, editable_roles: [other] });
    await mk("num", { type: "number", options: { min: 0, max: 10 } });
    await mk("sel", { type: "select", options: { choices: ["a", "b"], multiple: false } });
    await mk("dt", { type: "date" });
    leadOwn = lead.Aown!;
    leadForeign = lead.A1!;
    await admin.from("leads").update({ custom: { [key("hidden")]: "SECRET-VALUE", [key("open")]: "ok" } }).eq("id", leadOwn);
  });
  const patch = (c: object, id = lead.Aown!) => users.own!.client.from("leads").update({ custom: c }).eq("id", id).select("id");

  it("écriture REST directe : clé inconnue, champ non éditable/non visible, mauvais type, bornes, date, option", async () => {
    expect((await patch({ [key("open")]: "x", inconnue: "y" })).error?.message).toContain("unknown_custom_field");
    expect((await patch({ [key("open")]: "ok", [key("hidden")]: "hack" })).error).not.toBeNull();
    expect((await patch({ [key("open")]: "ok", [key("roview")]: "hack" })).error).not.toBeNull();
    expect((await patch({ [key("open")]: 123 })).error).not.toBeNull();
    expect((await patch({ [key("open")]: { a: 1 } })).error).not.toBeNull();
    expect((await patch({ [key("open")]: "x".repeat(2001) })).error).not.toBeNull();
    expect((await patch({ [key("num")]: 11 })).error).not.toBeNull();
    expect((await patch({ [key("num")]: -1 })).error).not.toBeNull();
    expect((await patch({ [key("num")]: "5" })).error).not.toBeNull();
    expect((await patch({ [key("sel")]: "zzz" })).error).not.toBeNull();
    expect((await patch({ [key("sel")]: ["a"] })).error).not.toBeNull();
    expect((await patch({ [key("dt")]: "demain" })).error).not.toBeNull();
    expect((await patch({ [key("open")]: "ok", [key("num")]: 5, [key("sel")]: "a", [key("dt")]: "2026-01-31" })).error).not.toBeNull(); // supprime la clé masquée => refusé
  });
  it("écraser/effacer tout le jsonb ne permet pas de détruire un champ masqué", async () => {
    expect((await patch({})).error).not.toBeNull();
    expect((await admin.from("leads").select("custom").eq("id", leadOwn).single()).data!.custom[key("hidden")]).toBe("SECRET-VALUE");
  });
  it("INSERT REST : clé inconnue / champ interdit refusés, statut forcé à l'initial pour un non-admin", async () => {
    const p = users.prosp!.client;
    const base = { org_id: orgA, created_by: users.prosp!.id, first_name: "Ins", status_id: st.A!["Gagné"] };
    expect((await p.from("leads").insert({ ...base, custom: { inconnue: "x" } })).error).not.toBeNull();
    expect((await p.from("leads").insert({ ...base, custom: { [key("hidden")]: "x" } })).error).not.toBeNull();
    const ok = await p.from("leads").insert(base).select("id, status_id");
    expect(ok.error).toBeNull();
    expect(ok.data![0]!.status_id).toBe(st.A!["Nouveau"]);
    await admin.from("leads").delete().eq("id", ok.data![0]!.id);
  });
  it("lecture : la colonne custom n'est pas lisible sur la table (select *, select custom, RETURNING, filtre)", async () => {
    const o = users.own!.client;
    expect((await o.from("leads").select("*").eq("id", leadOwn)).error).not.toBeNull();
    expect((await o.from("leads").select("custom").eq("id", leadOwn)).error).not.toBeNull();
    expect((await o.from("leads").select("id").filter("custom->>" + key("hidden"), "ilike", "SECRET%")).error).not.toBeNull();
    expect((await o.from("leads").update({ first_name: "Test" }).eq("id", leadOwn).select("custom")).error).not.toBeNull();
    expect((await o.from("leads").update({ first_name: "Test" }).eq("id", leadOwn).select("*")).error).not.toBeNull();
    const ins = await o.from("leads").insert({ org_id: orgA, created_by: users.own!.id, first_name: "R" }).select("custom");
    expect(ins.error).not.toBeNull();
    await admin.from("leads").delete().eq("org_id", orgA).eq("first_name", "R");
  });
  it("leads_api : masque les clés non visibles, filtre par RLS (org, view_own), pas d'accès anon, filtre sur clé masquée muet", async () => {
    const own = await users.own!.client.from("leads_api").select("id, custom");
    expect(own.error).toBeNull();
    expect(own.data!.map((l) => l.id)).toEqual([leadOwn]); // view_own : pas lead.A1 ni lead.B1
    const c = own.data![0]!.custom as Record<string, unknown>;
    expect(c[key("open")]).toBe("ok");
    expect(JSON.stringify(own.data)).not.toContain("SECRET-VALUE");
    expect(c[key("hidden")]).toBeUndefined();
    // sonde : un filtre sur la clé masquée ne doit rien révéler
    const probe = await users.own!.client.from("leads_api").select("id").filter("custom->>" + key("hidden"), "like", "SECRET%");
    expect(probe.data ?? []).toEqual([]);
    // admin A voit tout dans son org, jamais l'org B
    const adm = await users.a!.client.from("leads_api").select("id, custom");
    expect(adm.data!.map((l) => l.id)).not.toContain(lead.B1);
    expect(JSON.stringify(adm.data)).toContain("SECRET-VALUE");
    expect((await users.b!.client.from("leads_api").select("id").eq("id", leadOwn)).data).toEqual([]);
    expect((await createClient(URL, ANON, opts).from("leads_api").select("id")).error).not.toBeNull();
    // la vue n'est pas écrivable
    expect((await users.a!.client.from("leads_api").update({ first_name: "x" }).eq("id", leadOwn).select()).error).not.toBeNull();
    expect((await users.a!.client.from("leads_api").delete().eq("id", leadOwn).select()).error).not.toBeNull();
  });
  it("autres chemins : lead_events ne contient pas les valeurs, realtime sans publication, mask_custom ne fuit pas", async () => {
    await patch({ [key("open")]: "autre" });
    const ev = await users.a!.client.from("lead_events").select("payload").eq("lead_id", leadOwn);
    expect(JSON.stringify(ev.data)).not.toContain("SECRET-VALUE");
    expect(JSON.stringify(ev.data)).not.toContain("autre");
    // mask_custom appliqué avec l'org d'un tiers : rien
    const m = await users.b!.client.rpc("mask_custom", { p_org: orgA, c: { [key("open")]: "v" } });
    expect(m.data).toEqual({});
    expect((await createClient(URL, ANON, opts).rpc("mask_custom", { p_org: orgA, c: {} })).error).not.toBeNull();
  });
  it("patch_lead_custom : permission, cross-org, lead invisible, clés/valeurs invalides, suppression par null", async () => {
    const o = users.own!.client;
    expect((await o.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { [key("open")]: "via rpc" } })).error).toBeNull();
    expect((await admin.from("leads").select("custom").eq("id", leadOwn).single()).data!.custom[key("open")]).toBe("via rpc");
    expect((await o.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { [key("hidden")]: "hack" } })).error).not.toBeNull();
    expect((await o.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { [key("hidden")]: null } })).error).not.toBeNull();
    expect((await o.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { inconnue: "x" } })).error).not.toBeNull();
    expect((await o.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { [key("num")]: 99 } })).error).not.toBeNull();
    expect((await o.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: [1, 2] })).error).not.toBeNull();
    expect((await o.rpc("patch_lead_custom", { p_lead: leadForeign, p_patch: { [key("open")]: "x" } })).error).not.toBeNull(); // view_own : invisible
    expect((await users.b!.client.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { [key("open")]: "x" } })).error).not.toBeNull(); // cross-org
    expect((await users.a!.client.rpc("patch_lead_custom", { p_lead: lead.B1, p_patch: { x: "y" } })).error).not.toBeNull();
    expect((await createClient(URL, ANON, opts).rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: {} })).error).not.toBeNull();
    expect((await o.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { [key("open")]: null } })).error).toBeNull();
    expect((await admin.from("leads").select("custom").eq("id", leadOwn).single()).data!.custom[key("open")]).toBeUndefined();
    expect((await admin.from("leads").select("custom").eq("id", lead.B1).single()).data!.custom).toEqual({});
  });
  it("admin : exempté des restrictions de rôle mais pas des types ni des clés inconnues", async () => {
    const a = users.a!.client;
    expect((await a.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { [key("hidden")]: "admin ok" } })).error).toBeNull();
    expect((await a.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { [key("num")]: 99 } })).error).not.toBeNull();
    expect((await a.rpc("patch_lead_custom", { p_lead: leadOwn, p_patch: { inconnue: 1 } })).error).not.toBeNull();
  });
  it("lead_files.path : '..', antislash et '/' initial refusés par CHECK", async () => {
    for (const p of [`${orgA}/${lead.A1}/../x.txt`, `${orgA}/${lead.A1}/a/..`, `${orgA}/${lead.A1}/a\\b.txt`])
      expect((await users.a!.client.from("lead_files").insert({ org_id: orgA, lead_id: lead.A1, path: p, name: "n", size_bytes: 1, mime_type: "text/plain" })).error, p).not.toBeNull();
    expect((await admin.from("lead_files").insert({ org_id: orgA, lead_id: lead.A1, path: `${orgA}/${lead.A1}/a/../b`, name: "n", size_bytes: 1, mime_type: "text/plain" })).error).not.toBeNull();
  });
});

describe("re-check S3 : secret webhook et sel", () => {
  it("secret/version : la version n'est modifiable par aucun client ; un membre ne peut pas la régénérer", async () => {
    for (const u of ["a", "own"]) {
      const r = await users[u]!.client.from("organizations").update({ webhook_secret_version: 99 }).eq("id", orgA).select();
      expect(r.error ?? (r.data?.length ? new Error("modifié") : null), u).toBeTruthy();
    }
    expect((await admin.from("organizations").select("webhook_secret_version").eq("id", orgA).single()).data!.webhook_secret_version).toBe(1);
  });
  it("le secret n'est jamais stocké en base ni dérivable sans le sel serveur ; sel faible refusé", async () => {
    const { requireSigningSalt, orgWebhookSecret } = await import("@/lib/automation/signature");
    for (const bad of [undefined, "", "dev-insecure-salt", "court"]) expect(() => requireSigningSalt({ WEBHOOK_SIGNING_SALT: bad }), String(bad)).toThrow();
    expect(requireSigningSalt({ WEBHOOK_SIGNING_SALT: "x".repeat(16) })).toHaveLength(16);
    expect(orgWebhookSecret("x".repeat(16), orgA, 1)).not.toBe(orgWebhookSecret("x".repeat(16), orgA, 2));
    const cols = (await admin.from("organizations").select("*").eq("id", orgA).single()).data!;
    expect(JSON.stringify(cols)).not.toContain(orgWebhookSecret("x".repeat(16), orgA, 1));
  });
  it("le secret n'est servi qu'aux admins (page et action) et la page ne s'appuie pas sur un rôle client", () => {
    const page = readFileSync(path.resolve(__dirname, "../../src/app/(app)/settings/webhooks/page.tsx"), "utf8");
    const act = readFileSync(path.resolve(__dirname, "../../src/app/(app)/settings/webhooks/actions.ts"), "utf8");
    expect(page).toMatch(/!s\.isAdmin/);
    expect(act).toMatch(/!g\.s\.isAdmin/);
    const leaks = ["leads/actions.ts", "settings/page.tsx", "layout.tsx"].map((f) => readFileSync(path.resolve(__dirname, "../../src/app/(app)", f), "utf8")).join("");
    expect(leaks).not.toMatch(/currentOrgSecret|webhook_secret/);
  });
});

describe("re-check S3 : rattrapage (catchup) et quota", () => {
  it("catchup : borné (24 h, 50 événements, 1/min/org), filtré par org, idempotent, n'utilise que le moteur + safeFetch", () => {
    const c = readFileSync(path.resolve(__dirname, "../../src/lib/automation/catchup.ts"), "utf8");
    expect(c).toMatch(/\.eq\("org_id", orgId\)/);
    expect(c).toMatch(/limit\(50\)/);
    expect(c).toMatch(/WINDOW_MS = 24/);
    expect(c).toMatch(/60_000/);
    expect(c).toMatch(/action_runs/);
    expect(c).not.toMatch(/[^.\w]fetch\(/);
  });
  it("quota egress : plafond 30/min/org dans le moteur, avant tout appel réseau", async () => {
    const { runActions, WEBHOOK_PER_MINUTE } = await import("@/lib/automation/engine");
    expect(WEBHOOK_PER_MINUTE).toBe(30);
    let calls = 0;
    const store = {
      claim: async () => true, finish: async () => {}, getLead: async () => ({ id: "l", org_id: "o", status_id: "s", assigned_to: null, first_name: "a", last_name: "b", email: null, phone: null, value: null }),
      statusName: async () => "s", activeMembers: async () => [], lastAssigned: async () => ({}), setAssignee: async () => {}, addNotification: async () => {}, addTask: async () => {},
      webhookRunsSince: async () => 31, secretVersion: async () => 1,
    };
    const res = await runActions(
      { orgId: "o", orgSlug: "o", leadId: "l", fromStatusId: "a", toStatusId: "b", eventId: "e", actorId: null },
      [{ id: "x", type: "webhook", config: { url: "https://hooks.example.com/x" }, position: 0 }],
      { store: store as never, fetch: async () => { calls++; return { status: 200 }; }, secret: () => "s", now: () => new Date(), sleep: async () => {}, log: () => {} },
    );
    expect(calls).toBe(0);
    expect(res[0]!.result).toBe("failed");
  });
});
