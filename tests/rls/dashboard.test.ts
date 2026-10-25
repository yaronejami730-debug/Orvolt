import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let orgA = "", orgB = "";
const st: Record<string, string> = {};
const src: Record<string, string> = {};
const P = { from: "2031-03-01T00:00:00Z", to: "2031-04-01T00:00:00Z" };

async function makeUser(tag: string): Promise<U> {
  const email = `db-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true, user_metadata: { full_name: `User ${tag}` } });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
const rpc = (u: string, fn: string, args: Record<string, unknown> = {}) =>
  users[u]!.client.rpc(fn, { p_org: orgA, p_from: P.from, p_to: P.to, ...args });

beforeAll(async () => {
  const [a, b, mgr, vend, sans] = await Promise.all(["a", "b", "mgr", "vend", "sans"].map(makeUser));
  orgA = (await a!.client.rpc("create_organization", { p_name: `DB A ${run}`, p_template: "generic" })).data as string;
  orgB = (await b!.client.rpc("create_organization", { p_name: `DB B ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(orgA, "generic");
  await applyTemplate(orgB, "generic");
  // rôles : analyste (dashboard.view + view_all), vendeur (dashboard.view + view_own), sans (aucun droit dashboard)
  const mk = async (name: string, permissions: string[]) => (await admin.from("roles").insert({ org_id: orgA, name, permissions }).select("id").single()).data!.id as string;
  const roles = { mgr: await mk("Analyste", ["dashboard.view", "leads.view_all"]), vend: await mk("Vendeur", ["dashboard.view", "leads.view_own"]), sans: await mk("Sans", ["leads.view_all"]) };
  for (const [u, rid] of [[mgr!, roles.mgr], [vend!, roles.vend], [sans!, roles.sans]] as const) {
    await admin.from("profiles").update({ provisioned_org: orgA }).eq("id", u.id);
    await admin.from("memberships").insert({ org_id: orgA, user_id: u.id, role_id: rid });
  }
  for (const s of (await admin.from("statuses").select("id, name").eq("org_id", orgA)).data!) st[s.name] = s.id;
  for (const s of (await admin.from("lead_sources").select("id, name").eq("org_id", orgA)).data!) src[s.name] = s.id;
  const S1 = src["Salon"]!, S2 = src["Site web"]!;
  const at = (d: string) => `2031-${d}T10:00:00Z`;
  // Jeu de données connu (voir tests : P = mars 2031)
  type L = { n: number; src: string | null; who: "a" | "vend"; status: string; value: number | null; created: string; closed?: string };
  const leads: L[] = [
    { n: 1, src: S1, who: "a", status: "Gagné", value: 1000, created: at("03-05"), closed: at("03-10") },
    { n: 2, src: S1, who: "a", status: "Gagné", value: 2000, created: at("03-06"), closed: at("03-12") },
    { n: 3, src: S1, who: "vend", status: "Gagné", value: 500, created: at("03-07"), closed: at("04-10") }, // clôturé APRÈS la période
    { n: 4, src: S1, who: "vend", status: "Perdu", value: null, created: at("03-08"), closed: at("03-20") },
    { n: 5, src: S1, who: "vend", status: "Perdu", value: null, created: at("03-09"), closed: at("03-21") },
    { n: 6, src: S2, who: "a", status: "Nouveau", value: null, created: at("03-10") },
    { n: 7, src: S2, who: "a", status: "En cours", value: null, created: at("03-11") },
    { n: 8, src: S2, who: "vend", status: "En cours", value: null, created: at("03-12") },
    { n: 9, src: null, who: "a", status: "Nouveau", value: null, created: at("03-13") },
    { n: 10, src: S1, who: "vend", status: "Nouveau", value: null, created: at("03-14") },
    { n: 11, src: S2, who: "a", status: "Gagné", value: 4000, created: at("02-20"), closed: at("03-15") }, // créé avant, clôturé dans la période
  ];
  for (const l of leads) {
    const ins = await admin.from("leads").insert({
      org_id: orgA, status_id: st[l.status], source_id: l.src, assigned_to: l.who === "a" ? a!.id : vend!.id, created_by: a!.id,
      first_name: "Lead", last_name: String(l.n), value: l.value, created_at: l.created,
    }).select("id").single();
    if (ins.error) throw ins.error;
    if (l.closed) await admin.from("lead_events").insert({ org_id: orgA, lead_id: ins.data.id, type: "status_changed", payload: { to: st[l.status] }, created_at: l.closed });
  }
  // Rendez-vous : a (planifié 03-10, réalisé 03-11, hors période 04-15), vend (annulé 03-12)
  const lead1 = (await admin.from("leads").select("id").eq("org_id", orgA).eq("last_name", "1").single()).data!.id;
  const lead4 = (await admin.from("leads").select("id").eq("org_id", orgA).eq("last_name", "4").single()).data!.id;
  const ap = (who: string, lead: string, start: string, status: string, extra: object = {}) => ({ org_id: orgA, lead_id: lead, assigned_to: who, starts_at: `2031-${start}T09:00:00Z`, ends_at: `2031-${start}T10:00:00Z`, status, distance_status: "no_zone", ...extra });
  const r = await admin.from("appointments").insert([
    ap(a!.id, lead1, "03-10", "planned"), ap(a!.id, lead1, "03-11", "done"), ap(a!.id, lead1, "04-15", "planned"),
    ap(vend!.id, lead4, "03-12", "cancelled"), ap(vend!.id, lead4, "03-13", "planned", { distance_status: "over_radius" }),
  ]);
  if (r.error) throw r.error;
  // org B : un lead gagné (ne doit jamais apparaître chez A)
  const sb = (await admin.from("statuses").select("id, name").eq("org_id", orgB)).data!;
  await admin.from("leads").insert({ org_id: orgB, status_id: sb.find((s) => s.name === "Gagné")!.id, last_name: "B", value: 99999, created_at: "2031-03-05T10:00:00Z", created_by: b!.id });
});

afterAll(async () => {
  for (const id of [orgA, orgB]) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("exactitude sur un jeu de données connu", () => {
  it("kpi_summary (vue d'ensemble de l'organisation)", async () => {
    const { data, error } = await rpc("mgr", "kpi_summary");
    expect(error).toBeNull();
    expect(data).toMatchObject({
      created: 10,          // leads 1 à 10 (le 11 est créé avant la période)
      won: 3, lost: 2,      // clôturés dans la période : 1, 2, 11 gagnés ; 4, 5 perdus (le 3 est clôturé en avril)
      won_value: 7000,      // 1000 + 2000 + 4000
      cohort_won: 3, cohort_lost: 2, // cohorte créée en mars : 1, 2, 3 gagnés ; 4, 5 perdus
      appts_planned: 3,     // non annulés en mars : 2 de « a » + 1 de « vend » (l'annulé et celui d'avril sont exclus)
      appts_done: 1,
    });
  });
  it("filtres source et utilisateur", async () => {
    const s2 = (await rpc("mgr", "kpi_summary", { p_source: src["Site web"] })).data;
    expect(s2).toMatchObject({ created: 3, won: 1, lost: 0, won_value: 4000 });
    const v = (await rpc("mgr", "kpi_summary", { p_user: users.vend!.id })).data;
    expect(v).toMatchObject({ created: 5, won: 0, lost: 2, won_value: 0, appts_planned: 1 });
    expect((await rpc("mgr", "kpi_summary", { p_source: src["Salon"], p_user: users.a!.id })).data).toMatchObject({ created: 2, won: 2, won_value: 3000 });
  });
  it("période vide ou en dehors : zéros ; bornes strictes (fin exclue)", async () => {
    expect((await rpc("mgr", "kpi_summary", { p_from: "2031-06-01T00:00:00Z", p_to: "2031-07-01T00:00:00Z" })).data).toMatchObject({ created: 0, won: 0, lost: 0, won_value: 0, appts_planned: 0 });
    // le lead 10 est créé le 14 mars 10:00 : fin de période juste avant => exclu ; juste après => inclus
    const before = (await rpc("mgr", "kpi_summary", { p_to: "2031-03-14T10:00:00Z" })).data as { created: number };
    const after = (await rpc("mgr", "kpi_summary", { p_to: "2031-03-14T10:00:01Z" })).data as { created: number };
    expect(after.created - before.created).toBe(1);
  });
  it("leads_by_status : tous les statuts dans l'ordre du pipeline, avec couleur", async () => {
    const { data } = await rpc("mgr", "leads_by_status");
    expect(data!.map((r: { name: string }) => r.name)).toEqual(["Nouveau", "En cours", "Gagné", "Perdu"]);
    expect(Object.fromEntries(data!.map((r: { name: string; n: number }) => [r.name, Number(r.n)]))).toEqual({ Nouveau: 3, "En cours": 2, Gagné: 3, Perdu: 2 });
    expect(data![2].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(data![2].kind).toBe("won");
  });
  it("leads_by_source : « Sans source » inclus, gagnés par source", async () => {
    const { data } = await rpc("mgr", "leads_by_source");
    const by = Object.fromEntries(data!.map((r: { name: string; n: number; won: number }) => [r.name, [Number(r.n), Number(r.won)]]));
    expect(by).toEqual({ Salon: [6, 3], "Site web": [3, 0], "Sans source": [1, 0] });
  });
  it("leads_over_time : un seau par jour, totaux cohérents avec le résumé", async () => {
    // bornes alignées sur les minuits de Paris (UTC+1 début mars, UTC+2 à partir du 30 mars)
    const paris = { p_from: "2031-02-28T23:00:00Z", p_to: "2031-03-31T22:00:00Z" };
    const day = (await rpc("mgr", "leads_over_time", { p_bucket: "day", ...paris })).data as { bucket: string; created: number; won: number }[];
    expect(day).toHaveLength(31);
    expect(day.reduce((s, r) => s + Number(r.created), 0)).toBe(10);
    expect(day.reduce((s, r) => s + Number(r.won), 0)).toBe(3);
    expect(day.find((r) => r.bucket === "2031-03-05")!.created).toBe(1);
    expect(day.find((r) => r.bucket === "2031-03-15")!.won).toBe(1); // lead 11 clôturé le 15
    const week = (await rpc("mgr", "leads_over_time", { p_bucket: "week", ...paris })).data as { bucket: string; created: number }[];
    expect(week.reduce((s, r) => s + Number(r.created), 0)).toBe(10);
    expect(week.length).toBeLessThan(8);
    expect((await rpc("mgr", "leads_over_time", { p_bucket: "mois" })).error).not.toBeNull();
  });
  it("user_performance : par utilisateur actif, tri par gagnés", async () => {
    const { data, error } = await rpc("mgr", "user_performance");
    expect(error).toBeNull();
    const by = Object.fromEntries(data!.map((r: Record<string, unknown>) => [r.name, r]));
    expect(by["User a"]).toMatchObject({ leads: 5, appts_planned: 2, appts_done: 1, won: 3, lost: 0, won_value: 7000 });
    expect(by["User vend"]).toMatchObject({ leads: 5 - 0, appts_planned: 1, appts_done: 0, won: 0, lost: 2, won_value: 0 });
    expect(data![0].name).toBe("User a");
  });
  it("appointments_summary", async () => {
    expect((await rpc("mgr", "appointments_summary")).data).toEqual({ planned: 2, confirmed: 0, done: 1, cancelled: 1, no_show: 0, over_radius: 1 });
  });
});

describe("visibilité et sécurité", () => {
  it("view_own : uniquement ses propres chiffres (leads et rendez-vous)", async () => {
    const k = (await rpc("vend", "kpi_summary")).data;
    expect(k).toMatchObject({ created: 5, won: 0, lost: 2, appts_planned: 1, appts_done: 0 });
    const status = (await rpc("vend", "leads_by_status")).data as { n: number }[];
    expect(status.reduce((s, r) => s + Number(r.n), 0)).toBe(5);
    expect((await rpc("vend", "leads_by_source")).data!.reduce((s: number, r: { n: number }) => s + Number(r.n), 0)).toBe(5);
  });
  it("view_own : filtre sur un autre utilisateur refusé, sur soi accepté ; performance par utilisateur refusée", async () => {
    expect((await rpc("vend", "kpi_summary", { p_user: users.a!.id })).error?.message).toContain("forbidden");
    expect((await rpc("vend", "kpi_summary", { p_user: users.vend!.id })).error).toBeNull();
    expect((await rpc("vend", "user_performance")).error?.message).toContain("forbidden");
  });
  it("sans dashboard.view : toutes les fonctions refusées", async () => {
    for (const fn of ["kpi_summary", "leads_by_status", "leads_over_time", "leads_by_source", "user_performance", "appointments_summary"]) {
      expect((await rpc("sans", fn)).error?.message, fn).toContain("forbidden");
    }
  });
  it("anonyme refusé ; membre de B ne voit rien de A ; org arbitraire refusée", async () => {
    const anon = createClient(URL, ANON, opts);
    expect((await anon.rpc("kpi_summary", { p_org: orgA, p_from: P.from, p_to: P.to })).error).not.toBeNull();
    expect((await users.b!.client.rpc("kpi_summary", { p_org: orgA, p_from: P.from, p_to: P.to })).error?.message).toContain("forbidden");
    expect((await users.b!.client.rpc("user_performance", { p_org: orgA, p_from: P.from, p_to: P.to })).error?.message).toContain("forbidden");
    expect((await users.a!.client.rpc("kpi_summary", { p_org: crypto.randomUUID(), p_from: P.from, p_to: P.to })).error?.message).toContain("forbidden");
  });
  it("isolation : les chiffres de B n'apparaissent jamais chez A et inversement", async () => {
    const own = (await users.b!.client.rpc("kpi_summary", { p_org: orgB, p_from: P.from, p_to: P.to })).data;
    expect(own).toMatchObject({ created: 1, won: 1, won_value: 99999 });
    expect((await rpc("a", "kpi_summary")).data).toMatchObject({ won_value: 7000 });
    const perf = (await users.b!.client.rpc("user_performance", { p_org: orgB, p_from: P.from, p_to: P.to })).data as { name: string }[];
    expect(perf.map((r) => r.name).sort()).toEqual(["Non assigné", "User b"]);
  });
  it("période bornée : > 366 jours, fin avant début, valeurs nulles refusées", async () => {
    expect((await rpc("a", "kpi_summary", { p_from: "2029-01-01T00:00:00Z", p_to: "2031-01-01T00:00:00Z" })).error?.message).toContain("invalid_period");
    expect((await rpc("a", "kpi_summary", { p_from: P.to, p_to: P.from })).error?.message).toContain("invalid_period");
    expect((await rpc("a", "kpi_summary", { p_from: null })).error).not.toBeNull();
    expect((await rpc("a", "kpi_summary", { p_from: "2030-04-01T00:00:00Z", p_to: "2031-04-01T00:00:00Z" })).error).toBeNull(); // 365 jours
  });
});

describe("performances avec un volume réaliste", () => {
  it("5 000 leads : chaque agrégat répond rapidement (< 1,5 s) et reste exact", async () => {
    const o = (await admin.from("organizations").insert({ name: `DB Perf ${run}`, slug: `db-perf-${run}`, template: "generic", created_by: users.a!.id }).select("id").single()).data!.id as string;
    try {
      const won = (await admin.from("statuses").insert({ org_id: o, name: "Gagné", color: "#22c55e", kind: "won" }).select("id").single()).data!.id as string;
      const ini = (await admin.from("statuses").insert({ org_id: o, name: "Nouveau", color: "#3b82f6", is_initial: true }).select("id").single()).data!.id as string;
      const rid = (await admin.from("roles").insert({ org_id: o, name: "Admin", is_admin: true, is_system: true, permissions: [] }).select("id").single()).data!.id as string;
      await admin.from("profiles").update({ provisioned_org: o }).eq("id", users.a!.id);
      await admin.from("memberships").insert({ org_id: o, user_id: users.a!.id, role_id: rid });
      const rows = Array.from({ length: 5000 }, (_, i) => ({ org_id: o, status_id: i % 5 === 0 ? won : ini, last_name: `P${i}`, value: 100, created_at: new Date(Date.UTC(2031, 0, 1) + (i % 300) * 86_400_000).toISOString() }));
      for (let i = 0; i < rows.length; i += 1000) expect((await admin.from("leads").insert(rows.slice(i, i + 1000))).error).toBeNull();
      const args = { p_org: o, p_from: "2031-01-01T00:00:00Z", p_to: "2031-12-31T00:00:00Z" };
      for (const fn of ["kpi_summary", "leads_by_status", "leads_by_source", "leads_over_time", "user_performance", "appointments_summary"]) {
        const t0 = Date.now();
        const r = await users.a!.client.rpc(fn, args);
        expect(r.error, fn).toBeNull();
        expect(Date.now() - t0, fn).toBeLessThan(1500);
      }
      expect((await users.a!.client.rpc("kpi_summary", args)).data).toMatchObject({ created: 5000, won: 1000, won_value: 100000 });
    } finally {
      await admin.from("organizations").delete().eq("id", o);
    }
  }, 120_000);
});

describe("correctifs : archivés, source sur les rendez-vous, « Non assigné », délai maximal", () => {
  it("les leads archivés sont exclus de tous les indicateurs", async () => {
    const before = (await rpc("mgr", "kpi_summary")).data as { created: number };
    const ins = await admin.from("leads").insert({ org_id: orgA, status_id: st["Nouveau"], last_name: "Archivé", created_at: "2031-03-20T10:00:00Z", created_by: users.a!.id, assigned_to: users.a!.id, archived_at: "2031-03-25T10:00:00Z" }).select("id").single();
    expect(ins.error).toBeNull();
    expect(((await rpc("mgr", "kpi_summary")).data as { created: number }).created).toBe(before.created);
    const status = (await rpc("mgr", "leads_by_status")).data as { n: number }[];
    expect(status.reduce((s, r) => s + Number(r.n), 0)).toBe(before.created);
    const src = (await rpc("mgr", "leads_by_source")).data as { n: number }[];
    expect(src.reduce((s, r) => s + Number(r.n), 0)).toBe(before.created);
    await admin.from("leads").delete().eq("id", ins.data!.id);
  });
  it("le filtre source s'applique aussi aux rendez-vous", async () => {
    const salon = (await rpc("mgr", "kpi_summary", { p_source: src["Salon"] })).data as { appts_planned: number; appts_done: number };
    const web = (await rpc("mgr", "kpi_summary", { p_source: src["Site web"] })).data as { appts_planned: number };
    expect(salon.appts_planned).toBe(3);
    expect(salon.appts_done).toBe(1);
    expect(web.appts_planned).toBe(0);
    const sum = (await rpc("mgr", "appointments_summary", { p_source: src["Salon"] })).data as Record<string, number>;
    expect(sum).toMatchObject({ planned: 2, done: 1, cancelled: 1, over_radius: 1 });
  });
  it("« Non assigné » : la somme des lignes de performance égale le total des leads créés", async () => {
    const ins = await admin.from("leads").insert({ org_id: orgA, status_id: st["Nouveau"], last_name: "Orphelin", created_at: "2031-03-22T10:00:00Z", created_by: users.a!.id }).select("id").single();
    const perf = (await rpc("mgr", "user_performance")).data as { user_id: string | null; name: string; leads: number }[];
    const un = perf.find((r) => r.user_id === null);
    expect(un).toMatchObject({ name: "Non assigné", leads: 1 });
    const created = ((await rpc("mgr", "kpi_summary")).data as { created: number }).created;
    expect(perf.reduce((s, r) => s + Number(r.leads), 0)).toBe(created);
    await admin.from("leads").delete().eq("id", ins.data!.id);
  });
  it("délai maximal d'exécution configuré sur les fonctions", async () => {
    const { data } = await admin.rpc("normalize_phone", { p: "0612345678" }); // base joignable
    expect(data).toBe("+33612345678");
    const r = await fetch(`${URL}/rest/v1/rpc/kpi_summary`, { method: "POST", headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBeGreaterThanOrEqual(400); // paramètres manquants : refus propre
  });
});
