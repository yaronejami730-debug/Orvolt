import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests offensifs QA2 : escalade, dernier admin, create_organization abusif, grants, RLS forcée.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Passw0rd!test";

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
const orgIds: string[] = [];
let orgA = "";
let orgB = "";
let managerMembership = "";
let memberMembership = "";

async function makeUser(tag: string): Promise<U> {
  const email = `sec-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return (users[tag] = { id: data.user.id, client });
}
async function roleId(org: string, name: string) {
  const { data } = await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single();
  return data!.id as string;
}

beforeAll(async () => {
  await Promise.all(["a", "b", "manager", "member", "x"].map(makeUser));
  const ra = await users.a!.client.rpc("create_organization", { p_name: `Sec A ${run}`, p_template: "generic" });
  const rb = await users.b!.client.rpc("create_organization", { p_name: `Sec B ${run}`, p_template: "generic" });
  if (ra.error || rb.error) throw ra.error ?? rb.error;
  orgA = ra.data as string;
  orgB = rb.data as string;
  orgIds.push(orgA, orgB);
  // Rôle custom "Gestionnaire" : members.manage + roles.manage, non admin (fixture service role).
  const { data: custom } = await admin
    .from("roles")
    .insert({ org_id: orgA, name: "Gestionnaire", permissions: ["members.manage", "roles.manage"] })
    .select("id")
    .single();
  const m1 = await admin.from("memberships").insert({ org_id: orgA, user_id: users.manager!.id, role_id: custom!.id }).select("id").single();
  const m2 = await admin.from("memberships").insert({ org_id: orgA, user_id: users.member!.id, role_id: await roleId(orgA, "Commercial") }).select("id").single();
  managerMembership = m1.data!.id;
  memberMembership = m2.data!.id;
});

afterAll(async () => {
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("escalade de privilèges", () => {
  it("un utilisateur sans org ne peut pas s'auto-attribuer le rôle admin d'une org existante", async () => {
    const { error } = await users.x!.client.from("memberships").insert({ org_id: orgA, user_id: users.x!.id, role_id: await roleId(orgA, "Super administrateur") });
    expect(error).not.toBeNull();
    expect((await admin.from("memberships").select("id").eq("org_id", orgA).eq("user_id", users.x!.id)).data).toEqual([]);
  });
  it("un membre simple ne peut pas se promouvoir admin ni changer son statut", async () => {
    const adminRole = await roleId(orgA, "Super administrateur");
    const up = await users.member!.client.from("memberships").update({ role_id: adminRole }).eq("id", memberMembership).select();
    expect(up.data ?? []).toEqual([]);
    const { data } = await admin.from("memberships").select("role_id").eq("id", memberMembership).single();
    expect(data!.role_id).not.toBe(adminRole);
  });
  it("un gestionnaire non admin ne peut ni promouvoir en admin, ni toucher à un admin", async () => {
    const adminRole = await roleId(orgA, "Super administrateur");
    const self = await users.manager!.client.from("memberships").update({ role_id: adminRole }).eq("id", managerMembership).select();
    expect(self.data ?? []).toEqual([]);
    const other = await users.manager!.client.from("memberships").update({ role_id: adminRole }).eq("id", memberMembership).select();
    expect(other.data ?? []).toEqual([]);
    const ins = await users.manager!.client.from("memberships").insert({ org_id: orgA, user_id: users.x!.id, role_id: adminRole });
    expect(ins.error).not.toBeNull();
    const { data: adminMs } = await admin.from("memberships").select("id").eq("org_id", orgA).eq("user_id", users.a!.id).single();
    const dis = await users.manager!.client.from("memberships").update({ status: "disabled" }).eq("id", adminMs!.id).select();
    expect(dis.data ?? []).toEqual([]);
    const del = await users.manager!.client.from("memberships").delete().eq("id", adminMs!.id).select();
    expect(del.data ?? []).toEqual([]);
    const demote = await users.manager!.client.from("memberships").update({ role_id: await roleId(orgA, "Commercial") }).eq("id", adminMs!.id).select();
    expect(demote.data ?? []).toEqual([]);
  });
  it("un gestionnaire ne peut pas rendre un rôle admin ni changer ses champs structurels", async () => {
    const custom = await roleId(orgA, "Gestionnaire");
    for (const patch of [{ is_admin: true }, { is_system: true }, { org_id: orgB }]) {
      const r = await users.manager!.client.from("roles").update(patch).eq("id", custom).select();
      expect(r.data ?? [], JSON.stringify(patch)).toEqual([]);
    }
    const { data } = await admin.from("roles").select("is_admin, is_system, org_id").eq("id", custom).single();
    expect(data).toMatchObject({ is_admin: false, is_system: false, org_id: orgA });
  });
  it("un admin ne peut pas déplacer une membership ou un rôle vers une autre org", async () => {
    const { data: ms } = await admin.from("memberships").select("id").eq("org_id", orgA).eq("user_id", users.a!.id).single();
    const mv = await users.a!.client.from("memberships").update({ org_id: orgB }).eq("id", ms!.id).select();
    expect(mv.error ?? mv.data?.length === 0).toBeTruthy();
    expect((await admin.from("memberships").select("org_id").eq("id", ms!.id).single()).data!.org_id).toBe(orgA);
    const mvRole = await users.a!.client.from("roles").update({ org_id: orgB }).eq("id", await roleId(orgA, "Gestionnaire")).select();
    expect(mvRole.error ?? mvRole.data?.length === 0).toBeTruthy();
  });
  it("une membership ne peut référencer le rôle d'une autre org (FK composite)", async () => {
    const { error } = await users.a!.client.from("memberships").insert({ org_id: orgA, user_id: users.x!.id, role_id: await roleId(orgB, "Commercial") });
    expect(error).not.toBeNull();
  });
  it("un membre désactivé perd immédiatement tout accès (JWT encore valide)", async () => {
    await admin.from("memberships").update({ status: "disabled" }).eq("id", memberMembership);
    const orgs = await users.member!.client.from("organizations").select("id");
    expect(orgs.data ?? []).toEqual([]);
    expect(((await users.member!.client.from("roles").select("id").eq("org_id", orgA)).data ?? [])).toEqual([]);
    await admin.from("memberships").update({ status: "active" }).eq("id", memberMembership);
  });
  it("les colonnes email/id du profil et org billing ne sont pas modifiables", async () => {
    expect((await users.a!.client.from("profiles").update({ email: "evil@x.io" }).eq("id", users.a!.id)).error).not.toBeNull();
    expect((await users.a!.client.from("profiles").update({ id: users.b!.id }).eq("id", users.a!.id)).error).not.toBeNull();
    expect((await users.a!.client.from("organizations").update({ id: crypto.randomUUID() }).eq("id", orgA)).error).not.toBeNull();
    expect((await users.a!.client.from("organizations").update({ created_by: users.b!.id, slug: "hijack" }).eq("id", orgA)).error).not.toBeNull();
  });
});

describe("dernier admin (trigger SQL)", () => {
  it("l'unique admin ne peut pas se désactiver via l'API directe", async () => {
    const { data: ms } = await admin.from("memberships").select("id").eq("org_id", orgB).eq("user_id", users.b!.id).single();
    const r = await users.b!.client.from("memberships").update({ status: "disabled" }).eq("id", ms!.id).select();
    try {
      expect(r.error ?? r.data?.length === 0).toBeTruthy();
    } finally {
      await admin.from("memberships").update({ status: "active" }).eq("id", ms!.id);
    }
  });
  it("l'unique admin ne peut pas se rétrograder via l'API directe", async () => {
    const { data: ms } = await admin.from("memberships").select("id, role_id").eq("org_id", orgB).eq("user_id", users.b!.id).single();
    const r = await users.b!.client.from("memberships").update({ role_id: await roleId(orgB, "Commercial") }).eq("id", ms!.id).select();
    try {
      expect(r.error ?? r.data?.length === 0).toBeTruthy();
    } finally {
      await admin.from("memberships").update({ role_id: ms!.role_id }).eq("id", ms!.id);
    }
  });
  it("l'unique admin ne peut pas supprimer sa propre membership via l'API directe", async () => {
    const { data: ms } = await admin.from("memberships").select("id, role_id").eq("org_id", orgB).eq("user_id", users.b!.id).single();
    const r = await users.b!.client.from("memberships").delete().eq("id", ms!.id).select();
    try {
      expect(r.error ?? r.data?.length === 0).toBeTruthy();
    } finally {
      const { data } = await admin.from("memberships").select("id").eq("id", ms!.id);
      if (!data?.length) await admin.from("memberships").insert({ id: ms!.id, org_id: orgB, user_id: users.b!.id, role_id: ms!.role_id });
    }
  });
});

describe("create_organization abusif", () => {
  it("ne permet pas de s'injecter dans une org existante (même nom/slug)", async () => {
    const before = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", orgA);
    const slugA = (await admin.from("organizations").select("slug").eq("id", orgA).single()).data!.slug;
    const r = await users.x!.client.rpc("create_organization", { p_name: slugA, p_template: "generic" });
    expect(r.error).toBeNull();
    orgIds.push(r.data as string);
    expect(r.data).not.toBe(orgA);
    const after = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", orgA);
    expect(after.count).toBe(before.count);
    expect((await users.x!.client.from("memberships").select("org_id").eq("org_id", orgA)).data).toEqual([]);
  });
  it("ignore toute tentative d'injection via les paramètres (nom SQL, template hors liste, null)", async () => {
    const c = users.x!.client;
    expect((await c.rpc("create_organization", { p_name: "Robert'); drop table roles;--", p_template: "generic" })).error).toBeNull();
    expect((await c.rpc("create_organization", { p_name: "Valide", p_template: "generic'; --" })).error).not.toBeNull();
    expect((await c.rpc("create_organization", { p_name: "Valide", p_template: null })).error).not.toBeNull();
    expect((await c.rpc("create_organization", { p_name: null, p_template: "generic" })).error).not.toBeNull();
    expect((await c.rpc("create_organization", { p_name: "a".repeat(81), p_template: "generic" })).error).not.toBeNull();
    // nettoyage des orgs créées par ce test
    const { data } = await admin.from("organizations").select("id").eq("created_by", users.x!.id);
    for (const o of data ?? []) orgIds.push(o.id);
    expect((await admin.from("roles").select("id", { count: "exact", head: true })).count).toBeGreaterThan(0);
  });
  it("le créateur n'obtient aucune permission dans une autre org", async () => {
    expect((await users.x!.client.from("roles").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await users.x!.client.from("roles").insert({ org_id: orgB, name: "Intrus", permissions: [] })).error).not.toBeNull();
  });
  // Limite connue (mineur/majeur selon exposition) : aucun plafond du nombre d'orgs par utilisateur.
  it("documente l'absence de plafond : un même utilisateur peut créer plusieurs orgs d'essai", async () => {
    const { data } = await admin.from("organizations").select("id").eq("created_by", users.x!.id);
    expect((data ?? []).length).toBeGreaterThan(1);
  });
});

describe("quota de sièges sous concurrence", () => {
  it("des insertions parallèles ne dépassent pas seat_limit", async () => {
    const extra = await Promise.all(["c1", "c2", "c3", "c4"].map(makeUser));
    await admin.from("organizations").update({ seat_limit: 4 }).eq("id", orgA); // a + manager + member = 3 actifs
    const role = await roleId(orgA, "Commercial");
    await admin.from("profiles").update({ provisioned_org: orgA }).in("id", extra.map((u) => u.id));
    await Promise.all(extra.map((u) => users.a!.client.from("memberships").insert({ org_id: orgA, user_id: u.id, role_id: role })));
    const { count } = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", orgA).eq("status", "active");
    expect(count).toBe(4);
    await admin.from("organizations").update({ seat_limit: 5 }).eq("id", orgA);
  });
});

describe("grants et fonctions", () => {
  it("anon ne lit ni n'écrit aucune table", async () => {
    const anon = createClient(URL, ANON, opts);
    for (const t of ["organizations", "profiles", "roles", "memberships"]) {
      const r = await anon.from(t).select("*");
      expect(r.error ?? (r.data?.length === 0 ? null : r.data), t).toBeTruthy();
      expect((await anon.from(t).insert({}).select()).error, t).not.toBeNull();
    }
  });
  it("anon et authentifié ne peuvent pas appeler les helpers ni apply_template directement", async () => {
    const anon = createClient(URL, ANON, opts);
    for (const [fn, args] of [
      ["is_org_member", { org: orgA }],
      ["has_perm", { org: orgA, perm: "leads.view_all" }],
      ["is_org_admin", { org: orgA }],
      ["shares_org_with", { uid: users.a!.id }],
      ["role_is_admin", { rid: crypto.randomUUID() }],
    ] as const) {
      expect((await anon.rpc(fn, args)).error, fn).not.toBeNull();
    }
    expect((await users.x!.client.rpc("apply_template", { org: orgA, template: "btp" })).error).not.toBeNull();
  });
  it("les helpers appelés avec l'org d'un tiers ne révèlent rien (false)", async () => {
    const c = users.x!.client;
    expect((await c.rpc("is_org_member", { org: orgA })).data).toBe(false);
    expect((await c.rpc("is_org_admin", { org: orgA })).data).toBe(false);
    expect((await c.rpc("has_perm", { org: orgA, perm: "leads.view_all" })).data).toBe(false);
    expect((await c.rpc("shares_org_with", { uid: users.a!.id })).data).toBe(false);
  });
  it("les fonctions trigger ne sont pas appelables comme RPC", async () => {
    const anon = createClient(URL, ANON, opts);
    for (const fn of ["handle_new_user", "roles_guard", "enforce_seat_limit"]) {
      expect((await anon.rpc(fn)).error, fn).not.toBeNull();
      expect((await users.x!.client.rpc(fn)).error, fn).not.toBeNull();
    }
  });
  it("les métadonnées d'inscription ne peuvent pas forger un profil ou une org", async () => {
    const email = `sec-meta-${run}@test.local`;
    const c = createClient(URL, ANON, opts);
    const { data } = await c.auth.signUp({ email, password: PASSWORD, options: { data: { full_name: "M", id: users.a!.id, org_id: orgA, role: "admin" } } });
    if (data.user) {
      users.meta = { id: data.user.id, client: c };
      expect((await admin.from("memberships").select("id").eq("user_id", data.user.id)).data).toEqual([]);
      expect((await admin.from("profiles").select("id").eq("id", data.user.id)).data).toHaveLength(1);
      expect((await admin.from("profiles").select("full_name").eq("id", users.a!.id).single()).data!.full_name).not.toBe("M");
    }
  });
});

describe("schéma public : RLS activée + FORCE sur toutes les tables, fonctions à search_path fixé", () => {
  function psql(sql: string): string | null {
    try {
      return execFileSync("docker", ["exec", "-i", "supabase_db_SAAS_CRM", "psql", "-U", "postgres", "-At", "-c", sql], {
        encoding: "utf8",
        env: { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` },
      }).trim();
    } catch {
      return null; // docker indisponible : test ignoré
    }
  }
  it("aucune table publique sans RLS+FORCE", () => {
    const out = psql(
      "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not (c.relrowsecurity and c.relforcerowsecurity)",
    );
    if (out === null) return;
    expect(out).toBe("");
  });
  it("aucune fonction SECURITY DEFINER sans search_path fixé, aucun accès anon aux fonctions métier", () => {
    const noPath = psql(
      "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))",
    );
    if (noPath === null) return;
    expect(noPath).toBe("");
    const anonExec = psql(
      "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')",
    );
    expect(anonExec).toBe("");
  });
});

describe("membres légitimes et plafond d'organisations", () => {
  it("un admin ne peut pas ajouter un compte non provisionné pour son org", async () => {
    const stranger = await makeUser("stranger");
    const r = await users.a!.client.from("memberships").insert({ org_id: orgA, user_id: stranger.id, role_id: await roleId(orgA, "Commercial") });
    expect(r.error).not.toBeNull();
  });
  it("un utilisateur ne peut pas créer plus de 3 organisations", async () => {
    const u = await makeUser("orgcap");
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await u.client.rpc("create_organization", { p_name: `Cap ${i} ${Math.random().toString(36).slice(2, 6)}`, p_template: "generic" });
      expect(r.error).toBeNull();
      created.push(r.data as string);
    }
    const fourth = await u.client.rpc("create_organization", { p_name: "Cap 4", p_template: "generic" });
    expect(fourth.error?.message).toContain("org_limit_reached");
    for (const id of created) await admin.from("organizations").delete().eq("id", id);
  });
});
