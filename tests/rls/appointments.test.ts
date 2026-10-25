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
const lead: Record<string, string> = {};
const roleIds: Record<string, string> = {};

async function makeUser(tag: string): Promise<U> {
  const email = `ap-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
async function member(org: string, u: U, role: string) {
  await admin.from("profiles").update({ provisioned_org: org }).eq("id", u.id);
  const rid = (await admin.from("roles").select("id").eq("org_id", org).eq("name", role).single()).data!.id;
  await admin.from("memberships").insert({ org_id: org, user_id: u.id, role_id: rid });
}
const at = (h: number, d = 0) => { const t = new Date(Date.UTC(2031, 5, 10 + d, h, 0, 0)); return t.toISOString(); };
const appt = (org: string, leadId: string, who: string, start: string, end: string, extra: object = {}) =>
  ({ org_id: org, lead_id: leadId, assigned_to: who, starts_at: start, ends_at: end, ...extra });

beforeAll(async () => {
  const [a, b, mgr, own1, own2, none] = await Promise.all(["a", "b", "mgr", "own1", "own2", "none"].map(makeUser));
  orgA = (await a!.client.rpc("create_organization", { p_name: `AP A ${run}`, p_template: "generic" })).data as string;
  orgB = (await b!.client.rpc("create_organization", { p_name: `AP B ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(orgA, "generic");
  await applyTemplate(orgB, "generic");
  for (const r of (await admin.from("roles").select("id, name").eq("org_id", orgA)).data!) roleIds[r.name] = r.id;
  // Rôles : manager (manage_all + view_all), commerciaux (manage_own), « none » sans droit rendez-vous
  const mgrRole = (await admin.from("roles").insert({ org_id: orgA, name: "Manager RDV", permissions: ["appointments.manage_all", "leads.view_all", "leads.edit", "members.manage"] }).select("id").single()).data!.id;
  const noneRole = (await admin.from("roles").insert({ org_id: orgA, name: "Sans RDV", permissions: ["leads.view_all"] }).select("id").single()).data!.id;
  for (const [u, rid] of [[mgr!, mgrRole], [own1!, roleIds.Commercial], [own2!, roleIds.Commercial], [none!, noneRole]] as const) {
    await admin.from("profiles").update({ provisioned_org: orgA }).eq("id", u.id);
    await admin.from("memberships").insert({ org_id: orgA, user_id: u.id, role_id: rid });
  }
  void member;
  const nouveauA = (await admin.from("statuses").select("id").eq("org_id", orgA).eq("is_initial", true).single()).data!.id;
  const nouveauB = (await admin.from("statuses").select("id").eq("org_id", orgB).eq("is_initial", true).single()).data!.id;
  const mk = async (org: string, status: string, extra: object) => (await admin.from("leads").insert({ org_id: org, status_id: status, first_name: "L", last_name: "Ead", ...extra }).select("id").single()).data!.id as string;
  lead.own1 = await mk(orgA, nouveauA, { assigned_to: own1!.id, created_by: a!.id });
  lead.own2 = await mk(orgA, nouveauA, { assigned_to: own2!.id, created_by: a!.id });
  lead.B = await mk(orgB, nouveauB, { created_by: b!.id });
});

afterAll(async () => {
  for (const id of [orgA, orgB]) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("isolation A/B", () => {
  it("appointments, sales_zones, geocode_cache : rien de visible ni d'écrivable chez B", async () => {
    const a = users.a!.client;
    await admin.from("appointments").insert(appt(orgB, lead.B, users.b!.id, at(9), at(10)));
    await admin.from("sales_zones").insert({ org_id: orgB, user_id: users.b!.id, base_address: "Paris", base_lat: 48.85, base_lng: 2.35, radius_km: 30 });
    await admin.from("geocode_cache").upsert({ key: "a".repeat(64), lat: 1, lng: 1, provider: "mock", expires_at: new Date(Date.now() + 1e6).toISOString() });
    for (const t of ["appointments", "sales_zones"] as const) {
      expect((await a.from(t).select("id").eq("org_id", orgB)).data, t).toEqual([]);
      expect((await a.from(t).update({ org_id: orgA }).eq("org_id", orgB).select("id")).data ?? [], t).toEqual([]);
      expect((await a.from(t).delete().eq("org_id", orgB).select("id")).data ?? [], t).toEqual([]);
    }
    expect((await a.from("appointments").insert(appt(orgB, lead.B, users.b!.id, at(11), at(12), { created_by: users.a!.id }))).error).not.toBeNull();
    expect((await a.from("sales_zones").insert({ org_id: orgB, user_id: users.b!.id, base_address: "Lyon", base_lat: 45, base_lng: 4, radius_km: 20 })).error).not.toBeNull();
    // cache de géocodage : aucun accès client
    expect((await a.from("geocode_cache").select("key")).error).not.toBeNull();
    expect((await a.from("geocode_cache").insert({ key: "b".repeat(64), provider: "x", expires_at: new Date().toISOString() })).error).not.toBeNull();
    expect((await createClient(URL, ANON, opts).from("appointments").select("id")).error).not.toBeNull();
    expect((await admin.from("appointments").select("id").eq("org_id", orgB)).data).toHaveLength(1);
  });
});

describe("manage_own vs manage_all", () => {
  it("un commercial planifie pour lui-même, pas pour un autre", async () => {
    const o1 = users.own1!.client;
    expect((await o1.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(9), at(10), { created_by: users.own1!.id }))).error).toBeNull();
    const other = await o1.from("appointments").insert(appt(orgA, lead.own1, users.own2!.id, at(9), at(10), { created_by: users.own1!.id }));
    expect(other.error).not.toBeNull();
    // usurpation de created_by
    expect((await o1.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(14), at(15), { created_by: users.own2!.id }))).error).not.toBeNull();
  });
  it("un commercial ne voit que ses rendez-vous ; le manager voit tout", async () => {
    await admin.from("appointments").insert(appt(orgA, lead.own2, users.own2!.id, at(9), at(10)));
    expect((await users.own1!.client.from("appointments").select("assigned_to")).data!.every((r) => r.assigned_to === users.own1!.id)).toBe(true);
    expect((await users.own2!.client.from("appointments").select("id")).data).toHaveLength(1);
    expect((await users.mgr!.client.from("appointments").select("id")).data!.length).toBeGreaterThanOrEqual(2);
    expect((await users.own1!.client.from("appointments").update({ notes: "hack" }).eq("assigned_to", users.own2!.id).select("id")).data ?? []).toEqual([]);
    expect((await users.own1!.client.from("appointments").delete().eq("assigned_to", users.own2!.id).select("id")).data ?? []).toEqual([]);
  });
  it("sans permission rendez-vous : lecture et écriture refusées", async () => {
    const n = users.none!.client;
    expect((await n.from("appointments").select("id")).data).toEqual([]);
    expect((await n.from("appointments").insert(appt(orgA, lead.own1, users.none!.id, at(16), at(17), { created_by: users.none!.id }))).error).not.toBeNull();
  });
  it("lead non visible (view_own) : rendez-vous impossible et invisible", async () => {
    // own1 ne voit pas le lead d'own2
    const r = await users.own1!.client.from("appointments").insert(appt(orgA, lead.own2, users.own1!.id, at(11), at(12), { created_by: users.own1!.id }));
    expect(r.error).not.toBeNull();
    // si le lead devient invisible, le RDV l'est aussi
    const ap = (await admin.from("appointments").insert(appt(orgA, lead.own2, users.own1!.id, at(13), at(14), { created_by: users.mgr!.id }))).error;
    expect(ap).toBeNull();
    expect((await users.own1!.client.from("appointments").select("id").eq("lead_id", lead.own2)).data).toEqual([]);
  });
  it("le manager planifie pour un commercial", async () => {
    expect((await users.mgr!.client.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(15), at(16), { created_by: users.mgr!.id }))).error).toBeNull();
  });
});

describe("intégrité", () => {
  it("FK cross-org : lead ou assigné d'une autre org refusés", async () => {
    const a = users.a!.client;
    expect((await a.from("appointments").insert(appt(orgA, lead.B, users.a!.id, at(9, 3), at(10, 3), { created_by: users.a!.id }))).error).not.toBeNull();
    expect((await admin.from("appointments").insert(appt(orgA, lead.own1, users.b!.id, at(9, 3), at(10, 3)))).error).not.toBeNull();
  });
  it("chevauchement refusé pour un même commercial ; bornes contiguës et annulés autorisés", async () => {
    const m = users.mgr!.client;
    const base = { created_by: users.mgr!.id };
    expect((await m.from("appointments").insert(appt(orgA, lead.own1, users.own2!.id, at(9, 5), at(11, 5), base))).error).toBeNull();
    const over = await m.from("appointments").insert(appt(orgA, lead.own1, users.own2!.id, at(10, 5), at(12, 5), base));
    expect(over.error?.code).toBe("23P01");
    expect((await m.from("appointments").insert(appt(orgA, lead.own1, users.own2!.id, at(11, 5), at(12, 5), base))).error).toBeNull(); // contigu
    expect((await m.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(10, 5), at(12, 5), base))).error).toBeNull(); // autre commercial
    // annulé : libère le créneau
    await m.from("appointments").update({ status: "cancelled" }).eq("assigned_to", users.own2!.id).eq("starts_at", at(9, 5));
    expect((await m.from("appointments").insert(appt(orgA, lead.own1, users.own2!.id, at(9, 5), at(10, 5), base))).error).toBeNull();
    // réactiver un annulé en conflit : refusé
    const cancelled = await m.from("appointments").select("id").eq("assigned_to", users.own2!.id).eq("status", "cancelled").limit(1).single();
    await m.from("appointments").update({ starts_at: at(9, 5), ends_at: at(10, 5) }).eq("id", cancelled.data!.id);
    expect((await m.from("appointments").update({ status: "planned" }).eq("id", cancelled.data!.id)).error?.code).toBe("23P01");
  });
  it("contraintes : fin > début, durée max, dérogation motivée (service)", async () => {
    const m = users.mgr!.client;
    const base = { created_by: users.mgr!.id };
    expect((await m.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(10, 8), at(9, 8), base))).error).not.toBeNull();
    expect((await m.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(1, 8), at(20, 8), base))).error).not.toBeNull();
    expect((await admin.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(10, 9), at(11, 9), { distance_override: true, override_reason: "" }))).error).not.toBeNull();
  });
  it("distance et dérogation : colonnes non écrivables par un client, durée minimale", async () => {
    const o1 = users.own1!.client;
    const base = { created_by: users.own1!.id };
    for (const extra of [{ distance_override: true, override_reason: "Client VIP", distance_status: "over_radius" }, { distance_status: "ok" }, { lat: 1, lng: 1 }, { override_by: users.own2!.id }]) {
      expect((await o1.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(10, 10), at(11, 10), { ...base, ...extra }))).error, JSON.stringify(extra)).not.toBeNull();
    }
    const ok = await o1.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(10, 10), at(11, 10), base)).select("id");
    expect(ok.error).toBeNull();
    expect((await o1.from("appointments").update({ distance_status: "ok" }).eq("id", ok.data![0]!.id)).error).not.toBeNull();
    expect((await o1.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(12, 10), new Date(Date.parse(at(12, 10)) + 4 * 60000).toISOString(), base))).error).not.toBeNull();
  });
  it("événements lead : création, annulation", async () => {
    const m = users.mgr!.client;
    const r = await m.from("appointments").insert(appt(orgA, lead.own1, users.own1!.id, at(10, 12), at(11, 12), { created_by: users.mgr!.id })).select("id");
    await m.from("appointments").update({ status: "cancelled" }).eq("id", r.data![0]!.id);
    const { data } = await admin.from("lead_events").select("payload").eq("lead_id", lead.own1).eq("type", "appointment");
    const actions = data!.map((e) => e.payload.action);
    expect(actions).toEqual(expect.arrayContaining(["created", "cancelled"]));
  });
});

describe("zones d'intervention", () => {
  const z = (org: string, user: string, extra: object = {}) => ({ org_id: org, user_id: user, base_address: "10 rue de Rivoli, Paris", base_lat: 48.855, base_lng: 2.36, radius_km: 30, ...extra });
  it("chacun gère sa zone ; members.manage gère celles de l'équipe ; les autres non", async () => {
    expect((await users.own1!.client.from("sales_zones").insert(z(orgA, users.own1!.id))).error).toBeNull();
    expect((await users.own1!.client.from("sales_zones").insert(z(orgA, users.own2!.id))).error).not.toBeNull();
    expect((await users.mgr!.client.from("sales_zones").insert(z(orgA, users.own2!.id))).error).toBeNull();
    expect((await users.own1!.client.from("sales_zones").select("user_id")).data!.map((r) => r.user_id)).toEqual([users.own1!.id]);
    expect((await users.mgr!.client.from("sales_zones").select("id")).data!.length).toBe(2);
    expect((await users.own1!.client.from("sales_zones").update({ radius_km: 99 }).eq("user_id", users.own2!.id).select("id")).data ?? []).toEqual([]);
  });
  it("rayon borné, zone d'un non-membre refusée", async () => {
    expect((await users.mgr!.client.from("sales_zones").update({ radius_km: 3 }).eq("user_id", users.own2!.id)).error).not.toBeNull();
    expect((await users.mgr!.client.from("sales_zones").update({ radius_km: 500 }).eq("user_id", users.own2!.id)).error).not.toBeNull();
    expect((await admin.from("sales_zones").insert(z(orgA, users.b!.id))).error).not.toBeNull();
  });
});

describe("lecture agenda (jointure lead)", () => {
  it("la requête de l'agenda (embed lead) fonctionne pour un utilisateur authentifié", async () => {
    const r = await users.mgr!.client.from("appointments")
      .select("id, lead_id, assigned_to, starts_at, ends_at, status, location_address, distance_km, distance_status, distance_override, override_reason, notes, lead:leads(first_name, last_name, company)")
      .eq("org_id", orgA).limit(5);
    expect(r.error).toBeNull();
    expect(r.data!.length).toBeGreaterThan(0);
    expect(r.data![0]).toHaveProperty("lead.first_name");
  });
});
