import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Passw0rd!test";

interface U { id: string; email: string; client: SupabaseClient }
const users: Record<string, U> = {};
const orgIds: string[] = [];
let orgA = "";
let orgB = "";
let commercialMembership = "";

async function makeUser(tag: string): Promise<U> {
  const email = `rls-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `User ${tag}` } });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return (users[tag] = { id: data.user.id, email, client });
}

async function roleId(org: string, name: string) {
  const { data } = await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single();
  return data!.id as string;
}

beforeAll(async () => {
  const [a, b, c, d, e] = await Promise.all(["a", "b", "commercial", "d", "e"].map(makeUser));
  const ra = await a!.client.rpc("create_organization", { p_name: `Org A ${run}`, p_template: "energie" });
  const rb = await b!.client.rpc("create_organization", { p_name: `Org B ${run}`, p_template: "btp" });
  if (ra.error || rb.error) throw ra.error ?? rb.error;
  orgA = ra.data as string;
  orgB = rb.data as string;
  orgIds.push(orgA, orgB);
  // Commercial dans l'org A (fixture via service role)
  const { data } = await admin.from("memberships").insert({ org_id: orgA, user_id: c!.id, role_id: await roleId(orgA, "Commercial") }).select("id").single();
  commercialMembership = data!.id;
  void d; void e;
});

afterAll(async () => {
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("create_organization", () => {
  it("crée 5 rôles système et un admin membre", async () => {
    const { data: roles } = await admin.from("roles").select("name, is_admin, is_system").eq("org_id", orgA);
    expect(roles?.map((r) => r.name).sort()).toEqual(["Administrateur", "Commercial", "Confirmateur", "Prospecteur", "Super administrateur"]);
    expect(roles?.every((r) => r.is_system)).toBe(true);
    expect(roles?.filter((r) => r.is_admin)).toHaveLength(1);
    const { data: m } = await admin.from("memberships").select("user_id").eq("org_id", orgA).eq("user_id", users.a!.id);
    expect(m).toHaveLength(1);
  });
  it("refuse anonyme, template invalide, nom invalide", async () => {
    const anon = createClient(URL, ANON, opts);
    expect((await anon.rpc("create_organization", { p_name: "Zed Corp", p_template: "generic" })).error).not.toBeNull();
    expect((await users.d!.client.rpc("create_organization", { p_name: "Zed Corp", p_template: "nope" })).error).not.toBeNull();
    expect((await users.d!.client.rpc("create_organization", { p_name: "x", p_template: "generic" })).error).not.toBeNull();
  });
  it("génère des slugs uniques", async () => {
    const r1 = await users.d!.client.rpc("create_organization", { p_name: `Doublon ${run}`, p_template: "generic" });
    const r2 = await users.e!.client.rpc("create_organization", { p_name: `Doublon ${run}`, p_template: "generic" });
    orgIds.push(r1.data as string, r2.data as string);
    const { data } = await admin.from("organizations").select("slug").in("id", [r1.data, r2.data]);
    expect(new Set(data?.map((o) => o.slug)).size).toBe(2);
  });
});

describe("isolation A / B : lecture", () => {
  it("A ne voit que son organisation", async () => {
    const { data } = await users.a!.client.from("organizations").select("id");
    expect(data?.map((o) => o.id)).toEqual([orgA]);
  });
  it("A ne lit ni rôles, ni memberships, ni profil de B", async () => {
    expect((await users.a!.client.from("roles").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await users.a!.client.from("memberships").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await users.a!.client.from("profiles").select("id").eq("id", users.b!.id)).data).toEqual([]);
  });
  it("A lit le profil d'un co-membre", async () => {
    const { data } = await users.a!.client.from("profiles").select("id, full_name").eq("id", users.commercial!.id);
    expect(data).toHaveLength(1);
  });
});

describe("isolation A / B : écriture", () => {
  it("A ne peut pas insérer une organisation", async () => {
    const { error } = await users.a!.client.from("organizations").insert({ name: "Pirate", slug: `pirate-${run}` });
    expect(error).not.toBeNull();
  });
  it("A ne peut pas insérer rôle ou membership dans B", async () => {
    const r = await users.a!.client.from("roles").insert({ org_id: orgB, name: "Intrus", permissions: [] });
    expect(r.error).not.toBeNull();
    const m = await users.a!.client.from("memberships").insert({ org_id: orgB, user_id: users.a!.id, role_id: await roleId(orgB, "Super administrateur") });
    expect(m.error).not.toBeNull();
    const { data } = await admin.from("memberships").select("id").eq("org_id", orgB).eq("user_id", users.a!.id);
    expect(data).toEqual([]);
  });
  it("A ne peut ni modifier ni supprimer les lignes de B", async () => {
    const adminB = await roleId(orgB, "Super administrateur");
    const ops = [
      users.a!.client.from("organizations").update({ name: "Hack" }).eq("id", orgB).select(),
      users.a!.client.from("roles").update({ name: "Hack" }).eq("id", adminB).select(),
      users.a!.client.from("memberships").update({ status: "disabled" }).eq("org_id", orgB).select(),
      users.a!.client.from("profiles").update({ full_name: "Hack" }).eq("id", users.b!.id).select(),
      users.a!.client.from("organizations").delete().eq("id", orgB).select(),
      users.a!.client.from("roles").delete().eq("id", adminB).select(),
      users.a!.client.from("memberships").delete().eq("org_id", orgB).select(),
      users.a!.client.from("profiles").delete().eq("id", users.b!.id).select(),
    ];
    for (const res of await Promise.all(ops)) expect(res.data ?? []).toEqual([]);
    const { data: org } = await admin.from("organizations").select("name").eq("id", orgB).single();
    expect(org?.name).toBe(`Org B ${run}`);
    expect((await admin.from("memberships").select("id").eq("org_id", orgB)).data).toHaveLength(1);
    expect((await admin.from("roles").select("id").eq("org_id", orgB)).data).toHaveLength(5);
    const { data: prof } = await admin.from("profiles").select("full_name").eq("id", users.b!.id).single();
    expect(prof?.full_name).toBe("User b");
  });
  it("A modifie son propre profil mais pas celui d'un autre", async () => {
    const ok = await users.a!.client.from("profiles").update({ full_name: "Alice" }).eq("id", users.a!.id).select();
    expect(ok.data).toHaveLength(1);
    const other = await users.a!.client.from("profiles").update({ full_name: "X" }).eq("id", users.commercial!.id).select();
    expect(other.data ?? []).toEqual([]);
  });
});

describe("permissions dans l'organisation", () => {
  it("un membre sans members.manage ne peut pas ajouter de membership", async () => {
    const { error } = await users.commercial!.client
      .from("memberships")
      .insert({ org_id: orgA, user_id: users.d!.id, role_id: await roleId(orgA, "Commercial") });
    expect(error).not.toBeNull();
    expect((await admin.from("memberships").select("id").eq("org_id", orgA).eq("user_id", users.d!.id)).data).toEqual([]);
  });
  it("un membre sans roles.manage ne peut pas créer ni modifier de rôle", async () => {
    expect((await users.commercial!.client.from("roles").insert({ org_id: orgA, name: "Hack", permissions: ["billing.manage"] })).error).not.toBeNull();
    const upd = await users.commercial!.client.from("roles").update({ permissions: ["billing.manage"] }).eq("id", await roleId(orgA, "Commercial")).select();
    expect(upd.data ?? []).toEqual([]);
  });
  it("un membre sans members.manage ne peut ni modifier ni supprimer une membership", async () => {
    const upd = await users.commercial!.client.from("memberships").update({ role_id: await roleId(orgA, "Super administrateur") }).eq("id", commercialMembership).select();
    expect(upd.data ?? []).toEqual([]);
    const del = await users.commercial!.client.from("memberships").delete().eq("id", commercialMembership).select();
    expect(del.data ?? []).toEqual([]);
  });
  it("un non-admin ne peut pas modifier l'organisation", async () => {
    const res = await users.commercial!.client.from("organizations").update({ name: "Hack" }).eq("id", orgA).select();
    expect(res.data ?? []).toEqual([]);
  });
  it("l'admin gère les rôles personnalisés mais pas les champs structurels", async () => {
    const created = await users.a!.client.from("roles").insert({ org_id: orgA, name: "Support", permissions: ["leads.view_all"] }).select("id").single();
    expect(created.error).toBeNull();
    const sys = await users.a!.client.from("roles").insert({ org_id: orgA, name: "Sys", is_system: true });
    expect(sys.error).not.toBeNull();
    const adm = await users.a!.client.from("roles").insert({ org_id: orgA, name: "Super", is_admin: true });
    expect(adm.error).not.toBeNull();
    const bad = await users.a!.client.from("roles").insert({ org_id: orgA, name: "Bad", permissions: ["inconnue"] });
    expect(bad.error).not.toBeNull();
    const flip = await users.a!.client.from("roles").update({ is_admin: true }).eq("id", created.data!.id).select();
    expect(flip.data ?? []).toEqual([]);
    const sysId = await roleId(orgA, "Commercial");
    const delSys = await users.a!.client.from("roles").delete().eq("id", sysId).select();
    expect(delSys.data ?? []).toEqual([]);
    const adminRoleUpd = await users.a!.client.from("roles").update({ permissions: [] }).eq("id", await roleId(orgA, "Super administrateur")).select();
    expect(adminRoleUpd.data ?? []).toEqual([]);
    const del = await users.a!.client.from("roles").delete().eq("id", created.data!.id).select();
    expect(del.data).toHaveLength(1);
  });
});

describe("colonnes billing", () => {
  it("l'admin renomme son org mais ne peut pas toucher au billing", async () => {
    const ok = await users.a!.client.from("organizations").update({ name: `Org A ${run}` }).eq("id", orgA).select();
    expect(ok.data).toHaveLength(1);
    for (const patch of [
      { plan: "business" },
      { subscription_status: "active" },
      { stripe_customer_id: "cus_x" },
      { stripe_subscription_id: "sub_x" },
      { seat_limit: 999 },
      { trial_ends_at: "2099-01-01T00:00:00Z" },
    ]) {
      const { error } = await users.a!.client.from("organizations").update(patch).eq("id", orgA);
      expect(error, JSON.stringify(patch)).not.toBeNull();
    }
    const { data } = await admin.from("organizations").select("plan, subscription_status, seat_limit, stripe_customer_id").eq("id", orgA).single();
    expect(data).toMatchObject({ plan: "trial", subscription_status: "trialing", seat_limit: 5, stripe_customer_id: null });
  });
  it("le service role peut modifier le billing", async () => {
    const { error } = await admin.from("organizations").update({ plan: "pro" }).eq("id", orgA);
    expect(error).toBeNull();
    await admin.from("organizations").update({ plan: "trial" }).eq("id", orgA);
  });
});

describe("quota de sièges", () => {
  it("bloque une membership active au-delà de seat_limit", async () => {
    await admin.from("profiles").update({ provisioned_org: orgA }).in("id", [users.d!.id, users.e!.id]);
    await admin.from("organizations").update({ seat_limit: 2 }).eq("id", orgA); // A + commercial
    const roleCom = await roleId(orgA, "Commercial");
    const over = await users.a!.client.from("memberships").insert({ org_id: orgA, user_id: users.d!.id, role_id: roleCom });
    expect(over.error?.message).toContain("seat_limit_reached");

    await admin.from("organizations").update({ seat_limit: 3 }).eq("id", orgA);
    const ok = await users.a!.client.from("memberships").insert({ org_id: orgA, user_id: users.d!.id, role_id: roleCom }).select("id").single();
    expect(ok.error).toBeNull();

    // Réactiver un membre désactivé hors quota est refusé ; désactiver libère un siège.
    const off = await users.a!.client.from("memberships").update({ status: "disabled" }).eq("id", ok.data!.id).select();
    expect(off.data).toHaveLength(1);
    const e = await users.a!.client.from("memberships").insert({ org_id: orgA, user_id: users.e!.id, role_id: roleCom });
    expect(e.error).toBeNull();
    const reactivate = await users.a!.client.from("memberships").update({ status: "active" }).eq("id", ok.data!.id).select();
    expect(reactivate.error?.message).toContain("seat_limit_reached");
  });
  it("seat_limit null = illimité", async () => {
    await admin.from("organizations").update({ seat_limit: null }).eq("id", orgA);
    const { error } = await users.a!.client.from("memberships").update({ status: "active" }).eq("org_id", orgA).eq("user_id", users.d!.id);
    expect(error).toBeNull();
  });
});
