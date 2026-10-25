import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";
import { TEMPLATE_IDS, getTemplate } from "@/lib/templates";

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
const fx: Record<string, { st1: string; st2: string; won: string; role: string; adminRole: string; comRole: string }> = {};

async function makeUser(tag: string): Promise<U> {
  const email = `wf-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
const role = async (org: string, name: string) => (await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single()).data!.id as string;

async function seed(org: string) {
  const mk = async (name: string, extra: object = {}) =>
    (await admin.from("statuses").insert({ org_id: org, name, color: "#3b82f6", ...extra }).select("id").single()).data!.id as string;
  const st1 = await mk("Nouveau", { is_initial: true, position: 0 });
  const st2 = await mk("En cours", { position: 1 });
  const won = await mk("Gagné", { kind: "won", position: 2 });
  await admin.from("status_transitions").insert({ org_id: org, from_status_id: st1, to_status_id: st2, role_id: null });
  await admin.from("status_actions").insert({ org_id: org, status_id: st1, type: "notify", config: { recipient: "assignee", message: "x" } });
  await admin.from("custom_fields").insert({ org_id: org, key: "budget", label: "Budget", type: "number" });
  await admin.from("lead_sources").insert({ org_id: org, name: "Salon" });
  fx[org] = { st1, st2, won, role: await role(org, "Prospecteur"), adminRole: await role(org, "Super administrateur"), comRole: await role(org, "Commercial") };
}

beforeAll(async () => {
  const [a, b, c] = await Promise.all(["a", "b", "com"].map(makeUser));
  const ra = await a!.client.rpc("create_organization", { p_name: `WF A ${run}`, p_template: "generic" });
  const rb = await b!.client.rpc("create_organization", { p_name: `WF B ${run}`, p_template: "generic" });
  orgA = ra.data as string; orgB = rb.data as string;
  orgIds.push(orgA, orgB);
  await admin.from("profiles").update({ provisioned_org: orgA }).eq("id", c!.id);
  await admin.from("memberships").insert({ org_id: orgA, user_id: c!.id, role_id: await role(orgA, "Commercial") });
  await seed(orgA);
  await seed(orgB);
});

afterAll(async () => {
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

const TABLES = ["statuses", "status_transitions", "status_actions", "custom_fields", "lead_sources"] as const;

describe("isolation A/B sur les 5 tables", () => {
  for (const t of TABLES) {
    it(`${t} : A ne lit, n'écrit, ne modifie ni ne supprime rien de B`, async () => {
      const a = users.a!.client;
      expect((await a.from(t).select("id").eq("org_id", orgB)).data).toEqual([]);
      expect((await a.from(t).select("id").eq("org_id", orgA)).data!.length).toBeGreaterThan(0);
      const before = (await admin.from(t).select("id").eq("org_id", orgB)).data!.length;
      const row: Record<string, unknown> = {
        statuses: { name: "Hack", color: "#3b82f6" },
        status_transitions: { from_status_id: fx[orgB]!.st2, to_status_id: fx[orgB]!.st1 },
        status_actions: { status_id: fx[orgB]!.st1, type: "notify" },
        custom_fields: { key: "hack", label: "Hack", type: "text" },
        lead_sources: { name: "Hack" },
      }[t]!;
      expect((await a.from(t).insert({ org_id: orgB, ...row })).error).not.toBeNull();
      const upd = await a.from(t).update({ org_id: orgA }).eq("org_id", orgB).select();
      expect(upd.data ?? []).toEqual([]);
      const del = await a.from(t).delete().eq("org_id", orgB).select();
      expect(del.data ?? []).toEqual([]);
      expect((await admin.from(t).select("id").eq("org_id", orgB)).data!.length).toBe(before);
    });
  }
});

describe("permissions d'écriture", () => {
  it("un membre sans permission lit mais n'écrit dans aucune des 5 tables", async () => {
    const c = users.com!.client;
    for (const t of TABLES) expect((await c.from(t).select("id").eq("org_id", orgA)).data!.length, t).toBeGreaterThan(0);
    const f = fx[orgA]!;
    const attempts = [
      c.from("statuses").insert({ org_id: orgA, name: "X", color: "#3b82f6" }),
      c.from("status_transitions").insert({ org_id: orgA, from_status_id: f.st2, to_status_id: f.st1 }),
      c.from("status_actions").insert({ org_id: orgA, status_id: f.st1, type: "webhook" }),
      c.from("custom_fields").insert({ org_id: orgA, key: "x_y", label: "X", type: "text" }),
      c.from("lead_sources").insert({ org_id: orgA, name: "X" }),
    ];
    for (const r of await Promise.all(attempts)) expect(r.error).not.toBeNull();
    for (const t of TABLES) {
      expect((await c.from(t).update({ org_id: orgA }).eq("org_id", orgA).select()).data ?? []).toEqual([]);
      expect((await c.from(t).delete().eq("org_id", orgA).select()).data ?? []).toEqual([]);
    }
    expect((await c.rpc("reorder_statuses", { org: orgA, ids: [f.st2, f.st1] })).error).not.toBeNull();
    expect((await c.rpc("set_initial_status", { org: orgA, status: f.st2 })).error).not.toBeNull();
  });
  it("l'admin écrit, réordonne et change le statut initial", async () => {
    const a = users.a!.client;
    const f = fx[orgA]!;
    expect((await a.from("statuses").insert({ org_id: orgA, name: "Chaud", color: "#ef4444", position: 9 })).error).toBeNull();
    expect((await a.rpc("reorder_statuses", { org: orgA, ids: [f.st2, f.st1] })).error).toBeNull();
    expect((await admin.from("statuses").select("position").eq("id", f.st2).single()).data!.position).toBe(0);
    expect((await a.rpc("set_initial_status", { org: orgA, status: f.st2 })).error).toBeNull();
    expect((await admin.from("statuses").select("id").eq("org_id", orgA).eq("is_initial", true)).data).toEqual([{ id: f.st2 }]);
    expect((await a.rpc("set_initial_status", { org: orgA, status: f.won })).error).not.toBeNull();
    await a.rpc("set_initial_status", { org: orgA, status: f.st1 });
  });
});

describe("intégrité", () => {
  it("un seul statut initial par organisation", async () => {
    const r = await admin.from("statuses").insert({ org_id: orgA, name: "Deuxième initial", color: "#3b82f6", is_initial: true });
    expect(r.error).not.toBeNull();
  });
  it("un statut initial ne peut pas être final", async () => {
    expect((await admin.from("statuses").insert({ org_id: orgA, name: "Bizarre", color: "#3b82f6", kind: "won", is_initial: true })).error).not.toBeNull();
  });
  it("FK cross-org refusées (statuts et rôles d'une autre org)", async () => {
    const a = fx[orgA]!, b = fx[orgB]!;
    expect((await admin.from("status_transitions").insert({ org_id: orgA, from_status_id: a.st2, to_status_id: b.st1 })).error).not.toBeNull();
    expect((await admin.from("status_transitions").insert({ org_id: orgA, from_status_id: a.st2, to_status_id: a.st1, role_id: b.role })).error).not.toBeNull();
    expect((await admin.from("status_actions").insert({ org_id: orgA, status_id: b.st1, type: "notify" })).error).not.toBeNull();
    expect((await users.a!.client.from("status_transitions").insert({ org_id: orgA, from_status_id: a.st2, to_status_id: b.st1 })).error).not.toBeNull();
  });
  it("un statut final n'a pas de transition sortante", async () => {
    const f = fx[orgA]!;
    expect((await admin.from("status_transitions").insert({ org_id: orgA, from_status_id: f.won, to_status_id: f.st1 })).error).not.toBeNull();
    // un statut qui devient final perd ses transitions sortantes
    await admin.from("status_transitions").insert({ org_id: orgA, from_status_id: f.st2, to_status_id: f.st1, role_id: null });
    await admin.from("statuses").update({ kind: "lost" }).eq("id", f.st2);
    expect((await admin.from("status_transitions").select("id").eq("from_status_id", f.st2)).data).toEqual([]);
    await admin.from("statuses").update({ kind: "normal" }).eq("id", f.st2);
  });
  it("org_id d'un champ / clé / type immuables, source système verrouillée", async () => {
    const a = users.a!.client;
    expect((await a.from("custom_fields").update({ type: "text" }).eq("org_id", orgA)).error).not.toBeNull();
    expect((await a.from("custom_fields").update({ key: "autre" }).eq("org_id", orgA)).error).not.toBeNull();
    await admin.from("lead_sources").insert({ org_id: orgA, name: "Import CSV", is_system: true });
    expect((await a.from("lead_sources").delete().eq("name", "Import CSV")).error).not.toBeNull();
    expect((await a.from("lead_sources").update({ name: "Renommée" }).eq("name", "Import CSV")).error).not.toBeNull();
  });
  it("nom de statut unique par org, clé de champ valide", async () => {
    expect((await admin.from("statuses").insert({ org_id: orgA, name: "Nouveau", color: "#3b82f6" })).error).not.toBeNull();
    expect((await admin.from("custom_fields").insert({ org_id: orgA, key: "Bad Key", label: "Z", type: "text" })).error).not.toBeNull();
  });
});

describe("can_transition", () => {
  it("admin : oui ; rôle listé : oui ; rôle absent : non ; depuis un final : non ; autre org : non", async () => {
    const f = fx[orgA]!, b = fx[orgB]!;
    const can = async (from: string, to: string, r: string, org = orgA) =>
      (await users.a!.client.rpc("can_transition", { org, from_status: from, to_status: to, role: r })).data;
    expect(await can(f.st1, f.st2, f.comRole)).toBe(true); // role_id null = tous
    expect(await can(f.st1, f.won, f.adminRole)).toBe(true); // admin
    expect(await can(f.st1, f.won, f.comRole)).toBe(false);
    expect(await can(f.won, f.st1, f.adminRole)).toBe(false);
    expect(await can(f.st1, b.st2, f.adminRole)).toBe(false);
    expect(await can(b.st1, b.st2, b.adminRole, orgA)).toBe(false);
    await admin.from("status_transitions").insert({ org_id: orgA, from_status_id: f.st1, to_status_id: f.won, role_id: f.comRole });
    expect(await can(f.st1, f.won, f.comRole)).toBe(true);
    expect(await can(f.st1, f.won, f.role)).toBe(false);
  });
});

describe("apply_template_payload et applyTemplate", () => {
  it("n'est pas appelable par un client authentifié", async () => {
    expect((await users.a!.client.rpc("apply_template_payload", { org: orgA, payload: {} })).error).not.toBeNull();
  });
  for (const id of TEMPLATE_IDS) {
    it(`applique le template ${id} de façon idempotente`, async () => {
      const tpl = getTemplate(id)!;
      const counts = async () => ({
        st: (await admin.from("statuses").select("id", { count: "exact", head: true }).eq("org_id", orgA)).count,
        tr: (await admin.from("status_transitions").select("id", { count: "exact", head: true }).eq("org_id", orgA)).count,
        fi: (await admin.from("custom_fields").select("id", { count: "exact", head: true }).eq("org_id", orgA)).count,
        so: (await admin.from("lead_sources").select("id", { count: "exact", head: true }).eq("org_id", orgA)).count,
      });
      expect(await applyTemplate(orgA, id)).toEqual({ ok: true });
      const first = await counts();
      expect(await applyTemplate(orgA, id)).toEqual({ ok: true });
      expect(await counts()).toEqual(first);
      expect(first.st).toBe(tpl.statuses.length);
      expect(first.fi).toBe(tpl.fields.length);
      expect(first.so).toBe(tpl.sources.length + 2);
      const { data: init } = await admin.from("statuses").select("name").eq("org_id", orgA).eq("is_initial", true);
      expect(init).toHaveLength(1);
      expect((await admin.from("organizations").select("template").eq("id", orgA).single()).data!.template).toBe(id);
    });
  }
  it("rejette un template inconnu", async () => {
    expect((await applyTemplate(orgA, "nope")).ok).toBe(false);
  });
});

async function reseed() {
  for (const t of TABLES) await admin.from(t).delete().eq("org_id", orgA);
  await seed(orgA);
}

describe("non-régression : UPDATE sur chaque table à trigger de garde", () => {
  beforeAll(reseed);
  it("lead_sources : renommer et archiver fonctionnent", async () => {
    const a = users.a!.client;
    const created = await a.from("lead_sources").insert({ org_id: orgA, name: "Régression" }).select("id").single();
    expect(created.error).toBeNull();
    const ren = await a.from("lead_sources").update({ name: "Régression 2" }).eq("id", created.data!.id).select();
    expect(ren.error).toBeNull();
    expect(ren.data).toHaveLength(1);
    const arc = await a.from("lead_sources").update({ archived: true }).eq("id", created.data!.id).select();
    expect(arc.error).toBeNull();
    expect(arc.data).toHaveLength(1);
  });
  it("noms de source uniques sans tenir compte de la casse", async () => {
    const a = users.a!.client;
    await a.from("lead_sources").insert({ org_id: orgA, name: "Meta Casse" });
    const dup = await a.from("lead_sources").insert({ org_id: orgA, name: "meta casse" });
    expect(dup.error?.code).toBe("23505");
  });
  it("status_actions : UPDATE autorisé, changement d'org refusé", async () => {
    const a = users.a!.client;
    const row = await a.from("status_actions").select("id").eq("org_id", orgA).limit(1).single();
    expect((await a.from("status_actions").update({ enabled: false }).eq("id", row.data!.id).select()).data).toHaveLength(1);
    expect((await a.from("status_actions").update({ org_id: orgB }).eq("id", row.data!.id)).error).not.toBeNull();
  });
  it("status_transitions : UPDATE autorisé (rôle), changement d'org refusé", async () => {
    const a = users.a!.client;
    const row = await a.from("status_transitions").select("id").eq("org_id", orgA).limit(1).single();
    expect((await a.from("status_transitions").update({ role_id: fx[orgA]!.comRole }).eq("id", row.data!.id).select()).error).toBeNull();
    expect((await a.from("status_transitions").update({ org_id: orgB }).eq("id", row.data!.id)).error).not.toBeNull();
  });
  it("statuses et custom_fields : UPDATE nominal", async () => {
    const a = users.a!.client;
    expect((await a.from("statuses").update({ color: "#ef4444" }).eq("id", fx[orgA]!.st1).select()).data).toHaveLength(1);
    expect((await a.from("custom_fields").update({ required: true }).eq("org_id", orgA).select()).data!.length).toBeGreaterThan(0);
    expect((await a.from("statuses").update({ org_id: orgB }).eq("id", fx[orgA]!.st1)).error).not.toBeNull();
  });
});

describe("validation DB des actions et RPC atomiques", () => {
  beforeAll(reseed);
  const st = () => fx[orgA]!.st1;
  const ins = (type: string, config: object) => users.a!.client.from("status_actions").insert({ org_id: orgA, status_id: st(), type, config });
  it("webhook : https, hôte non interne, pas d'IP littérale", async () => {
    for (const url of ["http://example.com/h", "https://169.254.169.254/x", "https://localhost/x", "https://10.0.0.1/", "https://[::1]/x", "https://x.internal/p", "https://2130706433/", "https://u:p@example.com/"]) {
      expect((await ins("webhook", { url })).error, url).not.toBeNull();
    }
    expect((await ins("webhook", { url: "https://hooks.example.com/ok" })).error).toBeNull();
  });
  it("assign/notify : user ou rôle d'une autre org refusé, de la même org accepté", async () => {
    expect((await ins("assign", { mode: "user", userId: users.b!.id })).error).not.toBeNull();
    expect((await ins("assign", { mode: "role", roleId: fx[orgB]!.role })).error).not.toBeNull();
    expect((await ins("notify", { recipient: "user", userId: users.b!.id, message: "x" })).error).not.toBeNull();
    expect((await ins("assign", { mode: "role", roleId: fx[orgA]!.role })).error).toBeNull();
    expect((await ins("assign", { mode: "user", userId: users.a!.id })).error).toBeNull();
    expect((await ins("assign", { mode: "user" })).error).not.toBeNull();
    expect((await ins("create_task", { title: "t", delay: 999, unit: "days", assignee: "assignee" })).error).not.toBeNull();
    expect((await ins("notify", { recipient: "assignee", message: "x".repeat(301) })).error).not.toBeNull();
  });
  it("champs : rôles de visibilité d'une autre org refusés", async () => {
    const r = await users.a!.client.from("custom_fields").insert({ org_id: orgA, key: "x_roles", label: "X roles 2", type: "text", visible_roles: [fx[orgB]!.role] });
    expect(r.error).not.toBeNull();
  });
  it("save_transitions / save_status_actions sont atomiques (échec = rien n'est perdu)", async () => {
    const a = users.a!.client;
    const f = fx[orgA]!;
    const before = (await admin.from("status_transitions").select("id").eq("from_status_id", f.st1)).data!.length;
    expect(before).toBeGreaterThan(0);
    const bad = await a.rpc("save_transitions", { org: orgA, from_status: f.st1, targets: [{ to: f.st2, roles: null }, { to: fx[orgB]!.st1, roles: null }] });
    expect(bad.error).not.toBeNull();
    expect((await admin.from("status_transitions").select("id").eq("from_status_id", f.st1)).data!.length).toBe(before);
    const actionsBefore = (await admin.from("status_actions").select("id").eq("status_id", f.st1)).data!.length;
    const badA = await a.rpc("save_status_actions", { org: orgA, status: f.st1, actions: [{ type: "webhook", config: { url: "http://x" }, enabled: true }] });
    expect(badA.error).not.toBeNull();
    expect((await admin.from("status_actions").select("id").eq("status_id", f.st1)).data!.length).toBe(actionsBefore);
    expect((await a.rpc("save_transitions", { org: orgA, from_status: f.st1, targets: [{ to: f.st2, roles: null }] })).error).toBeNull();
    // sans permission : refus
    expect((await users.com!.client.rpc("save_transitions", { org: orgA, from_status: f.st1, targets: [] })).data ?? null).toBeNull();
    expect((await admin.from("status_transitions").select("id").eq("from_status_id", f.st1)).data!.length).toBe(1);
  });
});
