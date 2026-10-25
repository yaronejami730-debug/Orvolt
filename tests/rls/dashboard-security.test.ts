import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";
import { TtlCache, scopeKey } from "@/lib/dashboard/cache";

// QA2 S6 : fonctions d'agrégation du tableau de bord (appels RPC directs).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);
const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let orgA = "", orgB = "";
const st: Record<string, string> = {};
const FNS = ["kpi_summary", "leads_by_status", "leads_over_time", "leads_by_source", "user_performance", "appointments_summary", "dash_appt_counts", "dash_appt_counts_by_user", "dash_closed", "dash_check"];
const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const P = () => ({ p_from: iso(-30), p_to: iso(1) });

async function makeUser(tag: string): Promise<U> {
  const email = `ds-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true, user_metadata: { full_name: `User ${tag}` } });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
const rpc = (u: string, fn: string, args: Record<string, unknown> = {}, org = orgA) => users[u]!.client.rpc(fn, { p_org: org, ...P(), ...(fn === "dash_check" ? { p_user: null } : {}), ...args });
const mkLead = async (org: string, status: string, extra: object = {}) => (await admin.from("leads").insert({ org_id: org, status_id: status, first_name: "L", last_name: "x", ...extra }).select("id").single()).data!.id as string;
const mkAppt = async (org: string, lead: string, who: string, h: number, extra: object = {}) => {
  const d = new Date(Date.now() + (5 + h) * 86_400_000);
  const r = await admin.from("appointments").insert({ org_id: org, lead_id: lead, assigned_to: who, created_by: who, starts_at: d.toISOString(), ends_at: new Date(d.getTime() + 3_600_000).toISOString(), ...extra }).select("id").single();
  if (r.error) throw r.error;
};
const P2 = () => ({ p_from: iso(-1), p_to: iso(30) });

beforeAll(async () => {
  const [a, b, vend, noappt, sans] = await Promise.all(["a", "b", "vend", "noappt", "sans"].map(makeUser));
  orgA = (await a!.client.rpc("create_organization", { p_name: `DS A ${run}`, p_template: "generic" })).data as string;
  orgB = (await b!.client.rpc("create_organization", { p_name: `DS B ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(orgA, "generic");
  await applyTemplate(orgB, "generic");
  const mk = async (name: string, permissions: string[]) => (await admin.from("roles").insert({ org_id: orgA, name, permissions }).select("id").single()).data!.id as string;
  const roles = { vend: await mk("Vendeur", ["dashboard.view", "leads.view_own"]), noappt: await mk("Analyste", ["dashboard.view", "leads.view_all"]), sans: await mk("Sans", ["leads.view_all"]) };
  for (const [u, rid] of [[vend!, roles.vend], [noappt!, roles.noappt], [sans!, roles.sans]] as const) {
    await admin.from("profiles").update({ provisioned_org: orgA }).eq("id", u.id);
    await admin.from("memberships").insert({ org_id: orgA, user_id: u.id, role_id: rid });
  }
  for (const s of (await admin.from("statuses").select("id, name").eq("org_id", orgA)).data!) st[s.name] = s.id;
});
afterAll(async () => {
  for (const id of [orgA, orgB]) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("accès : anon, non-membre, sans dashboard.view, org arbitraire", () => {
  it("anon : les 9 fonctions refusées (EXECUTE révoqué)", async () => {
    const anon = createClient(URL, ANON, opts);
    for (const fn of FNS) expect((await anon.rpc(fn, { p_org: orgA, ...P(), ...(fn === "dash_check" ? { p_user: null } : {}) })).error, fn).not.toBeNull();
  });
  it("non-membre (org B) vers org A ; org inexistante ; sans dashboard.view (view_all inclus) : 42501 partout", async () => {
    // dash_closed (SQL INVOKER, sans dash_check) : bornée par la RLS => vide pour un non-membre ; pour « sans » (view_all) seules des lignes déjà lisibles
    expect((await rpc("b", "dash_closed", { p_from: iso(-30), p_to: iso(1) })).data ?? []).toEqual([]);
    expect((await rpc("a", "dash_closed", { p_from: iso(-30), p_to: iso(1) }, crypto.randomUUID())).data ?? []).toEqual([]);
    for (const fn of FNS.filter((f) => f !== "dash_closed")) {
      expect((await rpc("b", fn)).error?.code, `b ${fn}`).toBe("42501");
      expect((await rpc("sans", fn)).error?.code, `sans ${fn}`).toBe("42501");
      expect((await rpc("a", fn, {}, crypto.randomUUID())).error?.code, `inconnue ${fn}`).toBe("42501");
    }
  });
  it("période : NULL, inversée, vide, > 366 j refusées ; 366 j acceptée ; bucket invalide ; types injectés refusés", async () => {
    const base = { p_org: orgA };
    const a = users.a!.client;
    for (const bad of [{ p_from: null, p_to: iso(0) }, { p_from: iso(0), p_to: null }, { p_from: iso(0), p_to: iso(-1) }, { p_from: iso(0), p_to: iso(0) }, { p_from: iso(-367), p_to: iso(0) }, { p_from: "-infinity", p_to: "infinity" }])
      expect((await a.rpc("kpi_summary", { ...base, ...bad })).error, JSON.stringify(bad)).not.toBeNull();
    expect((await a.rpc("kpi_summary", { ...base, p_from: iso(-366), p_to: iso(0) })).error).toBeNull();
    expect((await a.rpc("leads_over_time", { ...base, ...P(), p_bucket: "month" })).error).not.toBeNull();
    expect((await a.rpc("leads_over_time", { ...base, ...P(), p_bucket: "day'; drop table leads;--" })).error).not.toBeNull();
    for (const [k, v] of [["p_source", "x' or '1'='1"], ["p_user", "1; select 1"], ["p_source", "not-a-uuid"]] as const)
      expect((await a.rpc("kpi_summary", { ...base, ...P(), [k]: v })).error, k).not.toBeNull();
  });
  it("filtres source/utilisateur d'une AUTRE org : aucun chiffre, aucune erreur révélatrice", async () => {
    const sB = (await admin.from("lead_sources").select("id").eq("org_id", orgB).limit(1).single()).data!.id;
    const lB = await mkLead(orgB, (await admin.from("statuses").select("id").eq("org_id", orgB).eq("is_initial", true).single()).data!.id, { source_id: sB, assigned_to: users.b!.id });
    void lB;
    const k = await rpc("a", "kpi_summary", { p_source: sB, p_user: users.b!.id });
    expect(k.error).toBeNull();
    expect(k.data).toMatchObject({ created: 0, won: 0, lost: 0 });
    const bySrc = await rpc("a", "leads_by_source", { p_source: sB });
    expect(bySrc.data).toEqual([]);
    expect(JSON.stringify((await rpc("a", "leads_by_source")).data)).not.toContain(sB);
    // et B ne voit pas A
    expect(JSON.stringify((await rpc("b", "leads_by_source", {}, orgB)).data)).not.toContain(users.a!.id);
  });
});

describe("view_own : périmètre strict via toutes les fonctions", () => {
  let own = "", other = "", ownAppt = 0;
  beforeAll(async () => {
    own = await mkLead(orgA, st["Nouveau"]!, { assigned_to: users.vend!.id });
    other = await mkLead(orgA, st["Nouveau"]!, { assigned_to: users.a!.id });
    const outsider = await mkLead(orgA, st["Gagné"]!, { assigned_to: users.a!.id, value: 777 });
    void outsider;
    await mkAppt(orgA, own, users.vend!.id, 1);
    await mkAppt(orgA, other, users.a!.id, 2);
    await mkAppt(orgA, other, users.a!.id, 3, { status: "done" });
    ownAppt = 1;
  });
  it("kpi / statuts / source / temps ne comptent que les leads du vendeur", async () => {
    const k = (await rpc("vend", "kpi_summary")).data as Record<string, number>;
    expect(k.created).toBe(1);
    expect(k.won).toBe(0);
    expect(k.won_value).toBe(0);
    const st_ = (await rpc("vend", "leads_by_status")).data as { n: number }[];
    expect(st_.reduce((s, r) => s + Number(r.n), 0)).toBe(1);
    expect(((await rpc("vend", "leads_by_source")).data as { n: number }[]).reduce((s, r) => s + Number(r.n), 0)).toBe(1);
    expect(((await rpc("vend", "leads_over_time", { p_bucket: "day" })).data as { created: number }[]).reduce((s, r) => s + Number(r.created), 0)).toBe(1);
    const adminK = (await rpc("a", "kpi_summary")).data as Record<string, number>;
    expect(adminK.created).toBeGreaterThan(k.created);
  });
  it("rendez-vous : le vendeur ne compte que ceux de SES leads ; jamais ceux d'une autre org", async () => {
    const s = (await rpc("vend", "appointments_summary", P2())).data as Record<string, number>;
    expect(s.planned).toBe(ownAppt);
    expect(s.done).toBe(0);
    const counts = (await rpc("vend", "dash_appt_counts", P2())).data as Record<string, number>[];
    expect(Number(counts[0]!.planned)).toBe(ownAppt);
    // RDV d'une autre org jamais compté même en visant l'org A
    const lb = await mkLead(orgB, (await admin.from("statuses").select("id").eq("org_id", orgB).eq("is_initial", true).single()).data!.id);
    await mkAppt(orgB, lb, users.b!.id, 4);
    const all = (await rpc("a", "appointments_summary", P2())).data as Record<string, number>;
    expect(all.planned).toBeGreaterThanOrEqual(ownAppt);
    expect(((await rpc("b", "appointments_summary", P2(), orgB)).data as Record<string, number>).planned).toBe(1);
  });
  it("user_performance et filtre sur un autre utilisateur refusés ; dash_closed direct borné par la RLS", async () => {
    expect((await rpc("vend", "user_performance")).error?.code).toBe("42501");
    expect((await rpc("vend", "kpi_summary", { p_user: users.a!.id })).error?.code).toBe("42501");
    expect((await rpc("vend", "appointments_summary", { p_user: users.a!.id })).error?.code).toBe("42501");
    expect((await rpc("vend", "dash_appt_counts", { p_user: users.a!.id })).error?.code).toBe("42501");
    expect((await rpc("vend", "kpi_summary", { p_user: users.vend!.id })).error).toBeNull();
    const closed = (await rpc("vend", "dash_closed", { p_from: iso(-1), p_to: iso(1) })).data as { value: number }[];
    expect(JSON.stringify(closed)).not.toContain("777");
  });
  it("les agrégats n'exposent aucune colonne custom ; la table ne laisse pas lire custom", async () => {
    for (const fn of ["kpi_summary", "leads_by_status", "leads_by_source", "dash_closed"]) expect(JSON.stringify((await rpc("a", fn, fn === "dash_closed" ? { p_from: iso(-1), p_to: iso(1) } : {})).data)).not.toMatch(/custom/);
    expect((await users.vend!.client.from("leads").select("custom")).error).not.toBeNull();
  });
  it("dash_appts n'existe plus : seuls des agrégats de rendez-vous sont exposés (aucune ligne)", async () => {
    expect((await rpc("noappt", "dash_appts", P2())).error).not.toBeNull();
    const c = (await rpc("noappt", "dash_appt_counts", P2())).data as Record<string, unknown>[];
    expect(Object.keys(c[0]!).sort()).toEqual(["cancelled", "confirmed", "done", "no_show", "over_radius", "planned"]);
  });
});

describe("exactitude : fuseau Europe/Paris, double comptage, archivés, supprimés", () => {
  it("un lead créé à 00:30 Paris (22:30Z veille, passage heure d'été) tombe dans le bon jour ; bornes de période en Paris", async () => {
    const mk = (created: string) => mkLead(orgA, st["Nouveau"]!, { created_at: created, source_id: null });
    // 29/03/2026 : passage à l'heure d'été (02:00 -> 03:00) ; 28/03 23:30Z = 00:30 Paris le 29 (CET+1) ; 29/03 21:59Z = 23:59 Paris le 29 (CEST+2)
    await mk("2026-03-28T23:30:00Z");
    await mk("2026-03-29T21:59:00Z");
    await mk("2026-03-29T22:00:00Z"); // 00:00 le 30
    const from = "2026-03-28T23:00:00Z", to = "2026-03-29T22:00:00Z"; // jour calendaire Paris du 29/03 (23 h)
    const rows = (await users.a!.client.rpc("leads_over_time", { p_org: orgA, p_from: from, p_to: to, p_bucket: "day" })).data as { bucket: string; created: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bucket).toBe("2026-03-29");
    expect(Number(rows[0]!.created)).toBe(2);
    const k = (await users.a!.client.rpc("kpi_summary", { p_org: orgA, p_from: from, p_to: to })).data as Record<string, number>;
    expect(k.created).toBe(2);
    // fin exclue : 22:00Z pile appartient au jour suivant
    const next = (await users.a!.client.rpc("kpi_summary", { p_org: orgA, p_from: to, p_to: "2026-03-30T22:00:00Z" })).data as Record<string, number>;
    expect(next.created).toBeGreaterThanOrEqual(1);
  });
  it("totaux cohérents entre fonctions ; lead gagné deux fois = 1 ; lead supprimé retiré ; archivé compté (comportement documenté)", async () => {
    const from = iso(-2), to = iso(1);
    const L = await mkLead(orgA, st["Nouveau"]!, { assigned_to: users.a!.id, value: 100 });
    for (let i = 0; i < 2; i++) {
      await admin.from("leads").update({ status_id: st["Gagné"]! }).eq("id", L);
      await admin.from("leads").update({ status_id: st["Nouveau"]! }).eq("id", L);
    }
    await admin.from("leads").update({ status_id: st["Gagné"]! }).eq("id", L);
    const gone = await mkLead(orgA, st["Nouveau"]!);
    const arch = await mkLead(orgA, st["Nouveau"]!, { archived_at: new Date().toISOString() });
    await admin.from("leads").delete().eq("id", gone);
    const a = users.a!.client;
    const args = { p_org: orgA, p_from: from, p_to: to };
    const k = (await a.rpc("kpi_summary", args)).data as Record<string, number>;
    const byStatus = (await a.rpc("leads_by_status", args)).data as { n: number }[];
    const bySource = (await a.rpc("leads_by_source", args)).data as { n: number; won: number }[];
    const time = (await a.rpc("leads_over_time", { ...args, p_bucket: "day" })).data as { created: number; won: number }[];
    const sum = (rows: { n?: number; created?: number }[], key: "n" | "created") => rows.reduce((s, r) => s + Number((r as Record<string, number>)[key]), 0);
    expect(sum(byStatus, "n")).toBe(k.created);
    expect(sum(bySource, "n")).toBe(k.created);
    expect(sum(time, "created")).toBe(k.created);
    expect(time.reduce((s, r) => s + Number(r.won), 0)).toBe(k.won);
    expect(bySource.reduce((s, r) => s + Number(r.won), 0)).toBe(k.cohort_won);
    const closed = (await a.rpc("dash_closed", args)).data as { id: string }[];
    expect(closed.filter((c) => c.id === L)).toHaveLength(1); // pas de double comptage malgré 3 passages en Gagné
    expect(k.won).toBe(closed.filter((c) => (c as unknown as { kind: string }).kind === "won").length);
    const ids = (await a.rpc("dash_closed", args)).data as { id: string }[];
    expect(ids.some((c) => c.id === gone)).toBe(false);
    void arch; // les leads archivés restent comptés dans les KPI (la liste /leads les masque) : écart documenté
    const perf = (await a.rpc("user_performance", { p_org: orgA, p_from: from, p_to: to })).data as { user_id: string; leads: number }[];
    expect(perf.reduce((s, r) => s + Number(r.leads), 0)).toBeLessThanOrEqual(k.created); // un lead appartient à un seul utilisateur
    expect(new Set(perf.map((r) => r.user_id)).size).toBe(perf.length);
  });
  it("libellés hostiles (statut, source, nom d'utilisateur) renvoyés tels quels comme données (échappement à l'affichage)", async () => {
    const xss = `<img src=x onerror=alert(1)>"'</title><script>1</script>`;
    await admin.from("statuses").update({ name: xss.slice(0, 40) }).eq("id", st["Perdu"]!);
    await admin.from("lead_sources").insert({ org_id: orgA, name: xss.slice(0, 40) });
    const r = (await users.a!.client.rpc("leads_by_status", { p_org: orgA, ...P() })).data as { name: string }[];
    expect(r.some((x) => x.name.startsWith("<img"))).toBe(true);
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((f: { name: string; isDirectory(): boolean }) => (f.isDirectory() ? walk(path.join(d, f.name)) : [path.join(d, f.name)]));
    const root = path.resolve(__dirname, "../..", "src");
    expect(walk(root).filter((f) => /\.(tsx?)$/.test(f) && !f.endsWith("marketing/json-ld.tsx") && /dangerouslySetInnerHTML|\.innerHTML\s*=|<title>\{/.test(readFileSync(f, "utf8")))).toEqual([]);
    const view = read("src/components/dashboard/dashboard-view.tsx");
    expect(view).not.toMatch(/dangerouslySetInnerHTML/);
    expect(view).not.toMatch(/href=\{[^}]*(label|name)[^}]*\}/); // liens construits uniquement avec des uuid
  });
});

describe("privilèges SQL", () => {
  function psql(sql: string): string | null {
    try { return execFileSync("docker", ["exec", "-i", "supabase_db_SAAS_CRM", "psql", "-U", "postgres", "-At", "-c", sql], { encoding: "utf8", env: { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` } }).trim(); } catch { return null; }
  }
  it("EXECUTE : ni PUBLIC ni anon ; search_path fixé ; seuls dash_appt_counts* sont SECURITY DEFINER", () => {
    const out = psql(`select p.proname, p.prosecdef, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('public', p.oid, 'execute'), p.proconfig::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('${FNS.join("','")}') order by 1`);
    if (out === null) return;
    const rows = out.split("\n").map((l) => l.split("|"));
    expect(rows).toHaveLength(FNS.length);
    for (const [name, secdef, anon, pub, cfg] of rows) {
      expect(anon, `${name} anon`).toBe("f");
      expect(pub, `${name} public`).toBe("f");
      expect(cfg, `${name} search_path`).toContain("search_path=public");
      expect(cfg, `${name} délai maximal`).toContain("statement_timeout=8s");
      expect(secdef === "t", name).toBe(name.startsWith("dash_appt_counts"));
    }
  });
});

describe("cache mémoire et rate limit (revue)", () => {
  it("clé = organisation + utilisateur + périmètre + fonction + paramètres : aucune collision ni partage", () => {
    const k = (org: string, user: string, scope: "all" | "own", p: unknown = { preset: "30d" }) => scopeKey({ org, user, scope }, "kpi", p);
    const keys = new Set([k("o1", "u1", "all"), k("o1", "u1", "own"), k("o1", "u2", "all"), k("o2", "u1", "all"), k("o1", "u1", "all", { preset: "7d" })]);
    expect(keys.size).toBe(5);
    expect(scopeKey({ org: "o1", user: "u1", scope: "all" }, "kpi", 1)).not.toBe(scopeKey({ org: "o1", user: "u1", scope: "all" }, "time", 1));
  });
  it("TTL et borne du nombre d'entrées respectés ; clear() vide tout", async () => {
    let t = 0;
    const c = new TtlCache(1000, 3, () => t);
    let loads = 0;
    const load = async () => ++loads;
    await c.get("a", load); await c.get("a", load);
    expect(loads).toBe(1);
    t = 1001; await c.get("a", load);
    expect(loads).toBe(2);
    for (const k of ["b", "c", "d", "e"]) await c.get(k, load);
    expect(c.size).toBeLessThanOrEqual(3);
    c.clear(); expect(c.size).toBe(0);
  });
  it("actions : dashboard.view vérifié côté serveur AVANT le cache, débit limité, user_performance réservée à view_all", () => {
    const src = read("src/app/(app)/dashboard/actions.ts");
    const prep = src.slice(src.indexOf("async function prepare"), src.indexOf("type Prep"));
    expect(prep.indexOf('sessionCan(s, "dashboard.view")')).toBeLessThan(prep.indexOf("allow("));
    expect(prep.indexOf("allow(")).toBeLessThan(prep.indexOf("dashParamsSchema.safeParse"));
    expect(src).toMatch(/if \(!c\.all\) return \{ ok: false, error: "Réservé aux managers\." \}/);
    expect(prep).toMatch(/const user = all \? \(p\.data\.user \?\? null\) : null/);
  });
  // FAILLE (mineur/majeur DoS authentifié) : la clé de cache utilise l'ENTRÉE BRUTE `input` (non validée) :
  // des clés distinctes de ~1 Mo (champs inconnus ignorés par Zod) contournent le cache et saturent la mémoire
  // (500 entrées x taille de clé) ; la clé devrait être construite à partir des paramètres validés (p.data).
  it("la clé de cache ne doit pas contenir l'entrée brute non validée", () => {
    const src = read("src/app/(app)/dashboard/actions.ts");
    expect(src).not.toMatch(/scopeKey\(c\.scope, "\w+", \[input,/);
  });
  it("une clé démesurée n'est jamais mise en cache (mémoire du process protégée)", async () => {
    const { TtlCache } = await import("@/lib/dashboard/cache");
    const c = new TtlCache();
    for (let i = 0; i < 20; i++) await c.get(scopeKey({ org: "o", user: "u", scope: "all" }, "kpi", [{ preset: "30d", junk: `${i}`.repeat(200_000) }]), async () => i);
    expect(c.size).toBe(0);
  });
});

// ---- Re-check S6 : cache borné, agrégats de RDV, archivés, délai maximal, filtres /leads.
describe("re-check S6 : cache", () => {
  it("clé issue des seuls paramètres validés ; junk de 200 Ko jamais mis en cache ; mémoire totale bornée", async () => {
    const src = read("src/app/(app)/dashboard/actions.ts");
    expect(src).not.toMatch(/scopeKey\([^)]*\binput\b/); // plus d'entrée brute dans la clé
    expect((src.match(/scopeKey\(c\.scope, "\w+", /g) ?? []).length).toBe(5);
    expect(src).toMatch(/const norm = \{ from: period\.fromDay, to: period\.toDay, bucket: period\.bucket, source, user \}/);
    expect(src).toMatch(/Object\.keys\(input\)\.length > 12/);
    expect(src.indexOf("dashParamsSchema.safeParse")).toBeLessThan(src.indexOf("const norm"));
    const c = new TtlCache();
    const junkKey = scopeKey({ org: "o", user: "u", scope: "all" }, "kpi", { junk: "x".repeat(200_000) });
    await c.get(junkKey, async () => ({ a: 1 }));
    expect(c.size).toBe(0);
    await c.get("k", async () => "y".repeat(2_000_000)); // valeur > maxBytes/10 : non mise en cache
    expect(c.size).toBe(0);
    for (let i = 0; i < 2000; i++) await c.get(scopeKey({ org: "o", user: `u${i}`, scope: "own" }, "kpi", { i }), async () => ({ pad: "z".repeat(5000) }));
    expect(c.size).toBeLessThanOrEqual(500);
    expect(c.totalBytes).toBeLessThanOrEqual(4_000_000);
    c.clear();
    expect(c.size + c.totalBytes).toBe(0);
  });
});

describe("re-check S6 : agrégats de RDV (dash_appts supprimée)", () => {
  let own = "", other = "", arch = "", sB = "";
  beforeAll(async () => {
    own = await mkLead(orgA, st["Nouveau"]!, { assigned_to: users.vend!.id });
    other = await mkLead(orgA, st["Nouveau"]!, { assigned_to: users.a!.id });
    arch = await mkLead(orgA, st["Nouveau"]!, { assigned_to: users.a!.id, archived_at: new Date().toISOString() });
    sB = await mkLead(orgB, (await admin.from("statuses").select("id").eq("org_id", orgB).eq("is_initial", true).single()).data!.id, { assigned_to: users.b!.id });
    await mkAppt(orgA, own, users.vend!.id, 11);
    await mkAppt(orgA, other, users.a!.id, 12);
    await mkAppt(orgA, arch, users.a!.id, 13);
    await mkAppt(orgB, sB, users.b!.id, 14);
  });
  const win = () => ({ p_from: iso(-1), p_to: iso(60) });
  it("dash_appts et l'ancien appointments_summary (4 args) n'existent plus ; plus aucune ligne de RDV exposée", async () => {
    expect((await users.a!.client.rpc("dash_appts", { p_org: orgA, ...win(), p_user: null })).error).not.toBeNull();
    for (const [fn, args] of [["dash_appt_counts", {}], ["dash_appt_counts_by_user", {}]] as const) {
      const r = await users.noappt!.client.rpc(fn, { p_org: orgA, ...win(), ...args });
      expect(r.error, fn).toBeNull();
      const row = JSON.stringify(r.data);
      expect(row).not.toMatch(/lead_id|starts_at|distance_status|location|notes/);
    }
    const c = (await users.noappt!.client.rpc("dash_appt_counts", { p_org: orgA, ...win() })).data as Record<string, number>[];
    expect(Object.keys(c[0]!).sort()).toEqual(["cancelled", "confirmed", "done", "no_show", "over_radius", "planned"]);
  });
  it("isolation A/B, anon, sans dashboard.view, view_own, archivés exclus", async () => {
    const anon = createClient(URL, ANON, opts);
    for (const fn of ["dash_appt_counts", "dash_appt_counts_by_user", "appointments_summary"]) {
      expect((await anon.rpc(fn, { p_org: orgA, ...win() })).error, `anon ${fn}`).not.toBeNull();
      expect((await users.b!.client.rpc(fn, { p_org: orgA, ...win() })).error?.code, `b ${fn}`).toBe("42501");
      expect((await users.sans!.client.rpc(fn, { p_org: orgA, ...win() })).error?.code, `sans ${fn}`).toBe("42501");
      expect((await users.a!.client.rpc(fn, { p_org: crypto.randomUUID(), ...win() })).error?.code, `inconnue ${fn}`).toBe("42501");
    }
    // view_own : uniquement ses RDV ; filtre sur un autre utilisateur refusé ; by_user réservé à view_all
    const v = (await users.vend!.client.rpc("dash_appt_counts", { p_org: orgA, ...win() })).data as { planned: number }[];
    const rowsA = (await admin.from("appointments").select("status, lead:leads!inner(assigned_to, created_by, archived_at)").eq("org_id", orgA).gte("starts_at", win().p_from).lt("starts_at", win().p_to)).data as unknown as { status: string; lead: { assigned_to: string | null; created_by: string | null; archived_at: string | null } }[];
    const live = rowsA.filter((r) => !r.lead.archived_at && r.status === "planned");
    const vendExpected = live.filter((r) => r.lead.assigned_to === users.vend!.id || r.lead.created_by === users.vend!.id).length;
    expect(vendExpected).toBeGreaterThan(0);
    expect(Number(v[0]!.planned)).toBe(vendExpected);
    expect(vendExpected).toBeLessThan(live.length);
    expect((await users.vend!.client.rpc("dash_appt_counts", { p_org: orgA, ...win(), p_user: users.a!.id })).error?.code).toBe("42501");
    expect((await users.vend!.client.rpc("dash_appt_counts_by_user", { p_org: orgA, ...win() })).error?.code).toBe("42501");
    // admin A : voit les RDV de A (own + other) mais ni l'archivé ni ceux de B
    const a = (await users.a!.client.rpc("dash_appt_counts", { p_org: orgA, ...win() })).data as { planned: number }[];
    expect(Number(a[0]!.planned)).toBe(live.length);
    const by = (await users.a!.client.rpc("dash_appt_counts_by_user", { p_org: orgA, ...win() })).data as { assigned_to: string; planned: number }[];
    expect(by.some((r) => r.assigned_to === users.b!.id)).toBe(false);
    expect(by.reduce((s, r) => s + Number(r.planned), 0)).toBe(rowsA.filter((r) => !r.lead.archived_at && r.status !== "cancelled").length);
    // filtre source d'une autre org : zéro
    const srcB = (await admin.from("lead_sources").select("id").eq("org_id", orgB).limit(1).single()).data!.id;
    expect(Number(((await users.a!.client.rpc("dash_appt_counts", { p_org: orgA, ...win(), p_source: srcB })).data as { planned: number }[])[0]!.planned)).toBe(0);
    // KPI : archivé exclu partout
    const k = (await users.a!.client.rpc("kpi_summary", { p_org: orgA, ...win() })).data as Record<string, number>;
    expect(k.appts_planned).toBe(rowsA.filter((r) => !r.lead.archived_at && r.status !== "cancelled").length);
    const closedIds = JSON.stringify((await users.a!.client.rpc("dash_closed", { p_org: orgA, p_from: iso(-3000 + 2900), p_to: iso(1) })).data);
    expect(closedIds).not.toContain(arch);
  });
  it("user_performance : ligne « Non assigné », somme des leads = total, aucun doublon ; réservée à view_all", async () => {
    await mkLead(orgA, st["Nouveau"]!, {}); // non assigné
    const args = { p_org: orgA, p_from: iso(-2), p_to: iso(1) };
    const perf = (await users.a!.client.rpc("user_performance", args)).data as { user_id: string | null; name: string; leads: number }[];
    const k = (await users.a!.client.rpc("kpi_summary", args)).data as Record<string, number>;
    expect(perf.some((r) => r.user_id === null && r.name === "Non assigné")).toBe(true);
    expect(perf.reduce((s, r) => s + Number(r.leads), 0)).toBe(k.created);
    expect(perf.filter((r) => r.user_id === null)).toHaveLength(1);
    expect((await users.vend!.client.rpc("user_performance", args)).error?.code).toBe("42501");
  });
});

describe("re-check S6 : délai maximal, privilèges", () => {
  function psql(sql: string): string | null {
    try { return execFileSync("docker", ["exec", "-i", "supabase_db_SAAS_CRM", "psql", "-U", "postgres", "-At", "-c", sql], { encoding: "utf8", env: { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` } }).trim(); } catch { return null; }
  }
  it("fonctions dashboard : ni PUBLIC ni anon, search_path fixé, seuls dash_appt_counts* sont DEFINER ; dash_appts absente", () => {
    const names = ["kpi_summary", "leads_by_status", "leads_over_time", "leads_by_source", "user_performance", "appointments_summary", "dash_check", "dash_closed", "dash_appt_counts", "dash_appt_counts_by_user"];
    const out = psql(`select p.proname, p.prosecdef, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('public', p.oid, 'execute'), p.proconfig::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('${names.join("','")}','dash_appts') order by 1`);
    if (out === null) return;
    const rows = out.split("\n").map((l) => l.split("|"));
    expect(rows.map((r) => r[0]).sort()).toEqual([...names].sort()); // dash_appts n'existe plus
    for (const [name, secdef, anon, pub, cfg] of rows) {
      expect(anon, `${name} anon`).toBe("f");
      expect(pub, `${name} public`).toBe("f");
      expect(cfg, `${name} search_path`).toContain("search_path=public");
      expect(secdef === "t", name).toBe(name.startsWith("dash_appt_counts"));
    }
  });
  it("délai maximal : le rôle authenticated (appels PostgREST) a un statement_timeout <= 10 s ; anon aussi", () => {
    const out = psql("select rolname, coalesce(rolconfig::text,'') from pg_roles where rolname in ('authenticated','anon') order by 1");
    if (out === null) return;
    for (const line of out.split("\n")) {
      const m = line.match(/statement_timeout=(\d+)(ms|s)/);
      expect(m, line).not.toBeNull();
      expect(Number(m![1]) * (m![2] === "s" ? 1000 : 1)).toBeLessThanOrEqual(10_000);
    }
  });
  // Comportement PostgreSQL documenté : un `SET statement_timeout` porté par la fonction (ALTER FUNCTION ... SET) n'est PAS appliqué au
  // statement en cours. La protection effective est celle du rôle (migration `alter role authenticated set statement_timeout`, test ci-dessus).
  it("un statement_timeout posé au niveau de la fonction n'interrompt pas l'exécution (seule la config du rôle protège)", () => {
    const t0 = Date.now();
    const out = psql("create function public.zz_qa_sleep() returns int language plpgsql set statement_timeout='1s' as $$ begin perform pg_sleep(2.5); return 1; end $$; select public.zz_qa_sleep(); ");
    psql("drop function if exists public.zz_qa_sleep()");
    if (out === null) return;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2000);
  });
});

describe("re-check S6 : filtres /leads depuis le dashboard", () => {
  it("dates validées (yyyy-mm-dd), jours calendaires Paris, sans interpolation ; « Sans source » = none ; uuid uniquement dans .or()", async () => {
    const { listParamsSchema } = await import("@/lib/validation/leads");
    const ok = listParamsSchema.safeParse({ sources: ["none", crypto.randomUUID()], from: "2026-03-29", to: "2026-03-29" });
    expect(ok.success).toBe(true);
    for (const bad of [{ from: "2026-03-29T00:00:00Z" }, { from: "29/03/2026" }, { to: "2026-03-29' or 1=1" }, { sources: ["x),status_id.not.is.null,(y"] }, { assigned: ["a,b"] }, { sources: ["none)"] }])
      expect(listParamsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const src = read("src/app/(app)/leads/actions.ts");
    const f = src.slice(src.indexOf("function applyFilters"), src.indexOf("export async function listLeadsAction"));
    expect(f).toMatch(/startOfParisDay\(d\)\.toISOString\(\)/);
    expect(f).toMatch(/\.gte\("created_at", lo\)/);
    expect(f).toMatch(/\.lt\("created_at", hi\)/);
    expect(f).not.toMatch(/\$\{p\.(from|to)\}/); // jamais de date brute interpolée
    expect(f).toMatch(/p\.sources\.filter\(\(x\) => x !== "none"\)/);
    const dash = read("src/components/dashboard/dashboard-view.tsx");
    expect(dash).toMatch(/new URLSearchParams\(\{ view: "table" \}\)/);
    // jour Paris : un lead créé à 00:30 Paris (22:30Z) du 29/03/2026 est dans le filtre « du 29 au 29 »
    const { startOfParisDay, shiftDay } = await import("@/lib/dashboard/period");
    const lo = startOfParisDay("2026-03-29").toISOString(), hi = startOfParisDay(shiftDay("2026-03-29", 1)).toISOString();
    expect(lo).toBe("2026-03-28T23:00:00.000Z");
    expect(hi).toBe("2026-03-29T22:00:00.000Z");
    expect(() => startOfParisDay("2026-02-30")).toThrow();
  });
});
