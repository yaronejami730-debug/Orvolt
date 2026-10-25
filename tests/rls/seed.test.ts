import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, DEMO_USERS, ORG_SPECS } from "../../scripts/seed/data";
import { runSeed, type SeedSummary } from "../../scripts/seed/seed";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);

async function counts() {
  const { data: orgs } = await admin.from("organizations").select("id, name").in("name", ORG_SPECS.map((s) => s.name));
  const ids = (orgs ?? []).map((o) => o.id as string);
  const n = async (table: string) => (await admin.from(table).select("id", { count: "exact", head: true }).in("org_id", ids)).count ?? 0;
  const users = (await admin.auth.admin.listUsers({ perPage: 200 })).data.users.filter((u) => u.email?.endsWith("@demo.test"));
  return { orgs: ids.length, orgIds: ids, users: users.length, leads: await n("leads"), appointments: await n("appointments"), tasks: await n("tasks"), notes: await n("lead_notes"), calls: await n("lead_calls"), events: await n("lead_events"), zones: await n("sales_zones") };
}

describe("seed de démonstration", () => {
  let first: SeedSummary;
  beforeAll(async () => {
    first = await runSeed();
  }, 120_000);

  it("crée 2 organisations, 7 utilisateurs, 200 leads, des RDV, tâches et zones", async () => {
    const c = await counts();
    expect(first.totals).toMatchObject({ orgs: 2, users: 7, leads: 200 });
    expect(c).toMatchObject({ orgs: 2, users: 7, leads: 200 });
    expect(c.appointments).toBeGreaterThan(0);
    expect(c.appointments).toBe(first.totals.appointments);
    expect(c.tasks).toBeGreaterThan(0);
    expect(c.notes).toBeGreaterThan(100);
    expect(c.calls).toBeGreaterThan(100);
    expect(c.zones).toBe(4);
    expect(c.events).toBeGreaterThan(200);
  });

  it("applique le template via applyTemplate (statuts, champs, sources)", async () => {
    const { orgIds } = await counts();
    const { data: orgs } = await admin.from("organizations").select("id, name, template").in("id", orgIds);
    expect(Object.fromEntries(orgs!.map((o) => [o.name, o.template]))).toEqual({ "Énergie Verte Démo": "energie", "Artisans Dupont Démo": "btp" });
    for (const id of orgIds) {
      expect((await admin.from("statuses").select("id", { count: "exact", head: true }).eq("org_id", id)).count).toBeGreaterThanOrEqual(6);
      expect((await admin.from("custom_fields").select("id", { count: "exact", head: true }).eq("org_id", id)).count).toBeGreaterThanOrEqual(5);
    }
  });

  it("idempotent : relancer ne duplique rien", async () => {
    const before = await counts();
    await runSeed();
    const after = await counts();
    const { orgIds: _a, ...b } = before;
    const { orgIds: _b, ...a } = after;
    void _a; void _b;
    expect(a).toEqual(b);
  }, 120_000);

  it("isolation : un membre d'Énergies ne voit aucun lead d'Artisans (et réciproquement)", async () => {
    const { orgIds } = await counts();
    const { data: orgs } = await admin.from("organizations").select("id, name").in("id", orgIds);
    const energie = orgs!.find((o) => o.name === "Énergie Verte Démo")!.id as string;
    const artisan = orgs!.find((o) => o.name === "Artisans Dupont Démo")!.id as string;
    const login = async (email: string) => {
      const c = createClient(URL, ANON, opts);
      const { error } = await c.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
      expect(error).toBeNull();
      return c;
    };
    const a = await login("admin.energies@demo.test");
    const seen = (await a.from("leads_api").select("id, org_id")).data ?? [];
    expect(seen.length).toBe(120);
    expect(seen.every((l) => l.org_id === energie)).toBe(true);
    expect((await a.from("leads_api").select("id").eq("org_id", artisan)).data).toEqual([]);
    for (const t of ["appointments", "lead_notes", "lead_calls", "tasks", "sales_zones"]) expect((await a.from(t).select("id").eq("org_id", artisan)).data, t).toEqual([]);

    const b = await login("admin.artisan@demo.test");
    const seenB = (await b.from("leads_api").select("id, org_id")).data ?? [];
    expect(seenB.length).toBe(80);
    expect(seenB.every((l) => l.org_id === artisan)).toBe(true);
  });

  it("rôles : le prospecteur ne voit que ses leads (assignés ou créés) ; le confirmateur voit tout Énergies", async () => {
    const login = async (email: string) => {
      const c = createClient(URL, ANON, opts);
      await c.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
      return { c, id: (await c.auth.getUser()).data.user!.id };
    };
    const p = await login("prospecteur@demo.test");
    const mine = (await p.c.from("leads_api").select("id, assigned_to, created_by")).data ?? [];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(120);
    expect(mine.every((l) => l.assigned_to === p.id || l.created_by === p.id)).toBe(true);
    const c = await login("confirmateur@demo.test");
    expect(((await c.c.from("leads_api").select("id")).data ?? []).length).toBe(120);
    expect(DEMO_USERS.map((u) => u.email)).toContain("commercial@demo.test");
  });

  it("garde-fous : RDV hors rayon portent une dérogation motivée ; aucun RDV dans le futur n'est réalisé", async () => {
    const { orgIds } = await counts();
    const { data } = await admin.from("appointments").select("status, starts_at, distance_status, distance_override, override_reason").in("org_id", orgIds);
    const over = data!.filter((a) => a.distance_status === "over_radius");
    expect(over.length).toBeGreaterThan(0);
    expect(over.every((a) => a.distance_override && String(a.override_reason).length >= 3)).toBe(true);
    expect(data!.filter((a) => new Date(a.starts_at) > new Date() && a.status === "done")).toEqual([]);
  });
});
