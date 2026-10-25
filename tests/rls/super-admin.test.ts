import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
const orgIds: string[] = [];
let orgA = "";
let orgB = "";
const role: Record<string, string> = {};
let sInit = "";
let sTarget = "";

async function makeUser(tag: string): Promise<U> {
  const email = `sa-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  if (e2) throw e2;
  return (users[tag] = { id: data.user.id, client });
}
const roleId = async (org: string, name: string) =>
  ((await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single()).data!.id as string);
const join = async (org: string, u: U, roleName: string) =>
  admin.from("memberships").insert({ org_id: org, user_id: u.id, role_id: await roleId(org, roleName) }).select("id").single();
/** Droit de statut (service role, hors garde-fous). */
const setGrant = (statusId: string, name: string, place: boolean, create = false) =>
  admin.from("status_role_grants").update({ can_place: place, can_create: place && create }).eq("status_id", statusId).eq("role_id", role[name]!);
const newLead = async (assigned: string) =>
  (await admin.from("leads").insert({ org_id: orgA, first_name: "T", last_name: run, created_by: assigned, assigned_to: assigned }).select("id").single()).data!.id as string;

beforeAll(async () => {
  const [sa, adm, pros, mgr, b] = await Promise.all(["sa", "adm", "pros", "mgr", "b"].map(makeUser));
  const ra = await sa!.client.rpc("create_organization", { p_name: `SA A ${run}`, p_template: "energie" });
  const rb = await b!.client.rpc("create_organization", { p_name: `SA B ${run}`, p_template: "btp" });
  if (ra.error || rb.error) throw ra.error ?? rb.error;
  orgA = ra.data as string;
  orgB = rb.data as string;
  orgIds.push(orgA, orgB);
  for (const n of ["Super administrateur", "Administrateur", "Prospecteur", "Commercial"]) role[n] = await roleId(orgA, n);
  const g = await admin.from("roles").insert({ org_id: orgA, name: "Gestion", permissions: ["roles.manage", "members.manage", "statuses.manage", "leads.view_own"] }).select("id").single();
  role.Gestion = g.data!.id;
  await join(orgA, adm!, "Administrateur");
  await join(orgA, pros!, "Prospecteur");
  await admin.from("memberships").insert({ org_id: orgA, user_id: mgr!.id, role_id: role.Gestion });
  const mk = async (org: string, name: string, pos: number, initial: boolean) =>
    ((r) => { if (r.error) throw r.error; return r.data!.id as string; })(await admin.from("statuses").insert({ org_id: org, name, color: "#3b82f6", position: pos, kind: "normal", is_initial: initial }).select("id").single());
  sInit = await mk(orgA, "Nouveau", 0, true);
  sTarget = await mk(orgA, "Qualifié", 1, false);
  await mk(orgB, "Nouveau", 0, true);
  // transition ouverte à tous les rôles : seule la matrice décide
  await admin.from("status_transitions").upsert({ org_id: orgA, from_status_id: sInit, to_status_id: sTarget, role_id: null });
});

afterAll(async () => {
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("hiérarchie de rôles", () => {
  it("l'org a un Super administrateur (is_admin) et un Administrateur (non is_admin, sans billing.manage)", async () => {
    const { data } = await admin.from("roles").select("name, is_admin, is_system, system_key, permissions").eq("org_id", orgA).in("name", ["Super administrateur", "Administrateur"]);
    const sup = data!.find((r) => r.name === "Super administrateur")!;
    const adm = data!.find((r) => r.name === "Administrateur")!;
    expect(sup).toMatchObject({ is_admin: true, is_system: true, system_key: "super_admin" });
    expect(adm).toMatchObject({ is_admin: false, is_system: true, system_key: "administrator" });
    expect(adm.permissions).not.toContain("billing.manage");
    expect(adm.permissions).toContain("roles.manage");
  });

  it("l'Administrateur ne modifie pas le rôle Administrateur ; le super admin si", async () => {
    const r = await users.adm!.client.from("roles").update({ permissions: ["leads.view_own"] }).eq("id", role.Administrateur!).select();
    expect(r.data ?? []).toHaveLength(0);
    const ok = await users.sa!.client.from("roles").update({ permissions: ["leads.view_all", "leads.view_own", "roles.manage", "members.manage", "statuses.manage", "fields.manage", "settings.manage"] }).eq("id", role.Administrateur!).select();
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
  });

  it("anti-escalade : pas de rôle is_admin, ni de permission que l'on ne possède pas", async () => {
    const c = users.adm!.client;
    expect((await c.from("roles").insert({ org_id: orgA, name: `Sup ${run}`, is_admin: true })).error).not.toBeNull();
    expect((await c.from("roles").insert({ org_id: orgA, name: `Fact ${run}`, permissions: ["billing.manage"] })).error?.message).toMatch(/permission_escalation/);
    expect((await c.from("roles").insert({ org_id: orgA, name: `Ok ${run}`, permissions: ["leads.view_own"] })).error).toBeNull();
  });

  it("un membre à droits limités ne s'accorde rien : ni permission, ni rôle Administrateur", async () => {
    const c = users.mgr!.client;
    const up = await c.from("roles").update({ permissions: ["roles.manage", "members.manage", "statuses.manage", "leads.view_own", "billing.manage"] }).eq("id", role.Gestion!).select();
    expect(up.error?.message ?? "").toMatch(/permission_escalation|self_escalation/);
    const self = await c.from("memberships").update({ role_id: role.Administrateur! }).eq("user_id", users.mgr!.id).select();
    expect(self.error?.message ?? "").toMatch(/self_role_change|role_above_caller/);
    const other = await c.from("memberships").update({ role_id: role.Administrateur! }).eq("user_id", users.pros!.id).select();
    expect(other.error?.message ?? "").toMatch(/role_above_caller/);
  });

  it("l'Administrateur ne peut ni attribuer ni retirer le rôle Super administrateur", async () => {
    const c = users.adm!.client;
    const give = await c.from("memberships").update({ role_id: role["Super administrateur"]! }).eq("user_id", users.pros!.id).select();
    expect(give.data ?? []).toHaveLength(0);
    const strip = await c.from("memberships").update({ role_id: role.Commercial! }).eq("user_id", users.sa!.id).select();
    expect(strip.data ?? []).toHaveLength(0);
    expect((await c.from("memberships").delete().eq("user_id", users.sa!.id).select()).data ?? []).toHaveLength(0);
  });

  it("le dernier super administrateur reste protégé", async () => {
    const r = await users.sa!.client.from("memberships").update({ role_id: role.Commercial! }).eq("user_id", users.sa!.id).select();
    expect(r.error?.message ?? "").toMatch(/last_admin/);
  });
});

describe("matrice « qui peut poser quel statut »", () => {
  it("déplacement : respecte le droit de poser du rôle (en plus de la transition)", async () => {
    const lead = await newLead(users.pros!.id);
    await setGrant(sTarget, "Prospecteur", false);
    const denied = await users.pros!.client.from("leads").update({ status_id: sTarget }).eq("id", lead).select("status_id");
    expect(denied.error?.message ?? "").toMatch(/transition_forbidden/);
    expect((await users.pros!.client.rpc("can_transition", { org: orgA, from_status: sInit, to_status: sTarget, role: role.Prospecteur })).data).toBe(false);
    await setGrant(sTarget, "Prospecteur", true);
    const ok = await users.pros!.client.from("leads").update({ status_id: sTarget }).eq("id", lead).select("status_id");
    expect(ok.error).toBeNull();
    expect(ok.data?.[0]?.status_id).toBe(sTarget);
  });

  it("l'Administrateur n'est pas exempté : la matrice le limite ; le super admin passe toujours", async () => {
    await setGrant(sTarget, "Administrateur", false);
    const rpc = (r: string) => users.sa!.client.rpc("can_transition", { org: orgA, from_status: sInit, to_status: sTarget, role: r });
    expect((await rpc(role.Administrateur!)).data).toBe(false);
    expect((await rpc(role["Super administrateur"]!)).data).toBe(true);
    await setGrant(sTarget, "Administrateur", true);
    expect((await rpc(role.Administrateur!)).data).toBe(true);
  });

  it("création : statut initial par défaut, statut demandé seulement si accordé à la création", async () => {
    const make = async () => (await users.pros!.client.from("leads").insert({ org_id: orgA, first_name: "C", last_name: run, status_id: sTarget }).select("status_id").single());
    await setGrant(sTarget, "Prospecteur", true, false);
    expect((await make()).data?.status_id).toBe(sInit);
    await setGrant(sTarget, "Prospecteur", true, true);
    expect((await make()).data?.status_id).toBe(sTarget);
    await setGrant(sTarget, "Prospecteur", true, false);
  });

  it("le super admin enregistre la matrice de façon atomique (RPC)", async () => {
    const grants = [{ status: sTarget, role: role.Commercial, place: false, create: false }, { status: sInit, role: role.Commercial, place: true, create: true }];
    expect((await users.sa!.client.rpc("save_status_grants", { org: orgA, grants })).error).toBeNull();
    const { data } = await admin.from("status_role_grants").select("can_place, status_id").eq("role_id", role.Commercial!).eq("status_id", sTarget).single();
    expect(data?.can_place).toBe(false);
    await setGrant(sTarget, "Commercial", true);
  });

  it("un Administrateur ne peut accorder que ce qu'il possède, ni à lui-même ni à son propre rôle", async () => {
    await setGrant(sTarget, "Administrateur", false);
    await setGrant(sTarget, "Prospecteur", false);
    const c = users.adm!.client;
    const esc = await c.rpc("save_status_grants", { org: orgA, grants: [{ status: sTarget, role: role.Prospecteur, place: true, create: false }] });
    expect(esc.error?.message ?? "").toMatch(/grants_escalation|grants_locked_role/);
    const self = await c.rpc("save_status_grants", { org: orgA, grants: [{ status: sTarget, role: role.Administrateur, place: true, create: false }] });
    expect(self.error?.message ?? "").toMatch(/grants_locked_role/);
    // retirer un droit à un autre rôle reste permis
    const down = await c.rpc("save_status_grants", { org: orgA, grants: [{ status: sInit, role: role.Commercial, place: false, create: false }] });
    expect(down.error).toBeNull();
    await setGrant(sTarget, "Administrateur", true);
    await setGrant(sTarget, "Prospecteur", true);
    await setGrant(sInit, "Commercial", true);
  });

  it("rôle sans statuses.manage : écriture refusée", async () => {
    const r = await users.pros!.client.rpc("save_status_grants", { org: orgA, grants: [{ status: sTarget, role: role.Prospecteur, place: true, create: true }] });
    expect(r.error).not.toBeNull();
    const { data } = await admin.from("status_role_grants").select("can_create").eq("status_id", sTarget).eq("role_id", role.Prospecteur!).single();
    expect(data?.can_create).toBe(false);
  });

  it("un nouveau rôle créé par un Administrateur n'hérite que de ses droits de statut", async () => {
    await setGrant(sTarget, "Administrateur", false);
    const c = users.adm!.client;
    const created = await c.from("roles").insert({ org_id: orgA, name: `Heritier ${run}`, permissions: ["leads.view_own"] }).select("id").single();
    expect(created.error).toBeNull();
    const { data } = await admin.from("status_role_grants").select("can_place").eq("role_id", created.data!.id).eq("status_id", sTarget).single();
    expect(data?.can_place).toBe(false);
    await setGrant(sTarget, "Administrateur", true);
  });

  it("isolation inter-org : lecture et écriture des droits d'une autre org impossibles", async () => {
    const b = users.b!.client;
    expect((await b.from("status_role_grants").select("role_id").eq("org_id", orgA)).data ?? []).toHaveLength(0);
    const w = await b.rpc("save_status_grants", { org: orgA, grants: [{ status: sTarget, role: role.Prospecteur, place: false, create: false }] });
    expect(w.error).not.toBeNull();
    const { data } = await admin.from("status_role_grants").select("can_place").eq("status_id", sTarget).eq("role_id", role.Prospecteur!).single();
    expect(data?.can_place).toBe(true);
    expect((await b.rpc("can_place_status", { org: orgA, status: sTarget, role: role.Prospecteur })).data).not.toBe(true);
    // org B : sa propre matrice est bien alimentée et distincte
    const mine = await b.from("status_role_grants").select("role_id").eq("org_id", orgB);
    expect((mine.data ?? []).length).toBeGreaterThan(0);
  });
});
