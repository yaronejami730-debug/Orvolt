import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isForbiddenHost, webhookUrlSchema, saveActionsSchema, fieldInputSchema, createStatusSchema } from "@/lib/validation/workflow";

// QA2 S2 : isolation et escalade sur statuses, status_transitions, status_actions, custom_fields, lead_sources.
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
let orgA = "", orgB = "";
const ids: Record<string, string> = {};

async function makeUser(tag: string): Promise<U> {
  const email = `wf-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return (users[tag] = { id: data.user.id, client });
}
async function roleId(org: string, name: string) {
  return (await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single()).data!.id as string;
}
const payload = {
  statuses: [
    { key: "n", name: "Nouveau", color: "#112233", kind: "normal", initial: true },
    { key: "c", name: "Contacté", color: "#112233", kind: "normal", initial: false },
    { key: "w", name: "Gagné", color: "#112233", kind: "won", initial: false },
  ],
  transitions: [{ from: "n", to: "c", roles: null }],
  actions: [{ status: "c", type: "notify", config: { recipient: "assignee", message: "x" }, enabled: true }],
  fields: [{ key: "ville", label: "Ville", type: "text", required: false, options: {}, visible_roles: null, editable_roles: null }],
  sources: [{ name: "Web", color: null, is_default: true, is_system: false }, { name: "Import CSV", color: null, is_default: false, is_system: true }],
};
async function fixture(org: string) {
  const r = await admin.rpc("apply_template_payload", { org, payload });
  if (r.error) throw r.error;
  const g = async (t: string, col = "id") => (await admin.from(t).select(col).eq("org_id", org)).data as unknown as { id: string }[];
  return {
    statuses: (await admin.from("statuses").select("id, name").eq("org_id", org)).data!,
    transition: (await g("status_transitions"))[0]!.id,
    action: (await g("status_actions"))[0]!.id,
    field: (await g("custom_fields"))[0]!.id,
    sources: (await admin.from("lead_sources").select("id, name, is_system").eq("org_id", org)).data!,
  };
}
let fa: Awaited<ReturnType<typeof fixture>>, fb: Awaited<ReturnType<typeof fixture>>;

beforeAll(async () => {
  await Promise.all(["a", "b", "perm", "nobody", "x"].map(makeUser));
  const ra = await users.a!.client.rpc("create_organization", { p_name: `WF A ${run}`, p_template: "generic" });
  const rb = await users.b!.client.rpc("create_organization", { p_name: `WF B ${run}`, p_template: "generic" });
  if (ra.error || rb.error) throw ra.error ?? rb.error;
  orgA = ra.data as string; orgB = rb.data as string; orgIds.push(orgA, orgB);
  fa = await fixture(orgA); fb = await fixture(orgB);
  // "perm" = rôle avec uniquement fields.manage ; "nobody" = Commercial (aucune perm de config), tous deux dans A.
  const { data: r } = await admin.from("roles").insert({ org_id: orgA, name: "Champs", permissions: ["fields.manage"] }).select("id").single();
  await admin.from("memberships").insert({ org_id: orgA, user_id: users.perm!.id, role_id: r!.id });
  await admin.from("memberships").insert({ org_id: orgA, user_id: users.nobody!.id, role_id: await roleId(orgA, "Commercial") });
  ids.fb0 = fb.statuses[0]!.id;
});
afterAll(async () => {
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

const TABLES = ["statuses", "status_transitions", "status_actions", "custom_fields", "lead_sources"];

describe("isolation A/B sur les 5 tables", () => {
  it("A ne lit rien de B", async () => {
    for (const t of TABLES) expect((await users.a!.client.from(t).select("id").eq("org_id", orgB)).data, t).toEqual([]);
  });
  it("A ne modifie ni ne supprime rien de B", async () => {
    for (const t of TABLES) {
      const u = await users.a!.client.from(t).update({ org_id: orgA }).eq("org_id", orgB).select();
      expect(u.data ?? [], t).toEqual([]);
      const d = await users.a!.client.from(t).delete().eq("org_id", orgB).select();
      expect(d.data ?? [], t).toEqual([]);
    }
    for (const t of TABLES) expect((await admin.from(t).select("id", { count: "exact", head: true }).eq("org_id", orgB)).count, t).toBeGreaterThan(0);
  });
  it("A ne peut pas insérer dans B", async () => {
    expect((await users.a!.client.from("statuses").insert({ org_id: orgB, name: "Intrus", color: "#000000" })).error).not.toBeNull();
    expect((await users.a!.client.from("custom_fields").insert({ org_id: orgB, key: "intrus", label: "Intrus", type: "text" })).error).not.toBeNull();
    expect((await users.a!.client.from("lead_sources").insert({ org_id: orgB, name: "Intrus" })).error).not.toBeNull();
  });
  it("FK cross-org refusées : transition, action vers un statut de B depuis A", async () => {
    const sa = fa.statuses[0]!.id;
    expect((await users.a!.client.from("status_transitions").insert({ org_id: orgA, from_status_id: sa, to_status_id: ids.fb0 })).error).not.toBeNull();
    expect((await users.a!.client.from("status_transitions").insert({ org_id: orgA, from_status_id: sa, to_status_id: fa.statuses[1]!.id, role_id: await roleId(orgB, "Commercial") })).error).not.toBeNull();
    expect((await users.a!.client.from("status_actions").insert({ org_id: orgA, status_id: ids.fb0, type: "assign", config: {} })).error).not.toBeNull();
  });
  it("org_id immuable même pour un admin des deux orgs", async () => {
    // x devient admin de A et B via fixtures service role
    await admin.from("memberships").insert([
      { org_id: orgA, user_id: users.x!.id, role_id: await roleId(orgA, "Super administrateur") },
      { org_id: orgB, user_id: users.x!.id, role_id: await roleId(orgB, "Super administrateur") },
    ]);
    for (const [t, row] of [["statuses", fa.statuses[0]!.id], ["custom_fields", fa.field], ["lead_sources", fa.sources[0]!.id], ["status_actions", fa.action], ["status_transitions", fa.transition]] as const) {
      const r = await users.x!.client.from(t).update({ org_id: orgB }).eq("id", row).select();
      expect(r.error ?? (r.data?.length === 0 ? true : null), t).toBeTruthy();
    }
    expect((await admin.from("statuses").select("org_id").eq("id", fa.statuses[0]!.id).single()).data!.org_id).toBe(orgA);
    await admin.from("memberships").delete().eq("user_id", users.x!.id);
  });
});

describe("escalade de permissions", () => {
  it("Commercial (aucune perm) : lecture seule", async () => {
    const c = users.nobody!.client;
    expect((await c.from("statuses").select("id")).data!.length).toBeGreaterThan(0);
    expect((await c.from("statuses").insert({ org_id: orgA, name: "X1", color: "#000000" })).error).not.toBeNull();
    expect((await c.from("statuses").update({ name: "Hack" }).eq("id", fa.statuses[0]!.id).select()).data ?? []).toEqual([]);
    expect((await c.from("custom_fields").delete().eq("id", fa.field).select()).data ?? []).toEqual([]);
    expect((await c.from("lead_sources").update({ color: "#ffffff" }).eq("id", fa.sources[0]!.id).select()).data ?? []).toEqual([]);
    expect((await c.from("status_actions").delete().eq("id", fa.action).select()).data ?? []).toEqual([]);
    expect((await c.from("status_transitions").delete().eq("id", fa.transition).select()).data ?? []).toEqual([]);
  });
  it("fields.manage seul : pas d'écriture sur statuts/actions/transitions/sources", async () => {
    const c = users.perm!.client;
    expect((await c.from("custom_fields").update({ label: "Ville 2" }).eq("id", fa.field).select()).data).toHaveLength(1);
    await c.from("custom_fields").update({ label: "Ville" }).eq("id", fa.field);
    expect((await c.from("statuses").insert({ org_id: orgA, name: "X2", color: "#000000" })).error).not.toBeNull();
    expect((await c.from("statuses").delete().eq("id", fa.statuses[1]!.id).select()).data ?? []).toEqual([]);
    expect((await c.from("status_actions").delete().eq("id", fa.action).select()).data ?? []).toEqual([]);
    expect((await c.from("lead_sources").delete().eq("id", fa.sources[0]!.id).select()).data ?? []).toEqual([]);
  });
  it("RPC reorder/set_initial refusés sans la permission, y compris sur l'org d'un tiers", async () => {
    const sa = fa.statuses.map((s) => s.id);
    expect((await users.nobody!.client.rpc("reorder_statuses", { org: orgA, ids: sa })).error).not.toBeNull();
    expect((await users.nobody!.client.rpc("reorder_fields", { org: orgA, ids: [fa.field] })).error).not.toBeNull();
    expect((await users.perm!.client.rpc("reorder_statuses", { org: orgA, ids: sa })).error).not.toBeNull();
    expect((await users.perm!.client.rpc("reorder_fields", { org: orgA, ids: [fa.field] })).error).toBeNull();
    expect((await users.nobody!.client.rpc("set_initial_status", { org: orgA, status: sa[1] })).error).not.toBeNull();
    expect((await users.a!.client.rpc("reorder_statuses", { org: orgB, ids: [ids.fb0] })).error).not.toBeNull();
    expect((await users.a!.client.rpc("set_initial_status", { org: orgB, status: fb.statuses[1]!.id })).error).not.toBeNull();
    expect((await users.a!.client.rpc("set_initial_status", { org: orgA, status: ids.fb0 })).error).not.toBeNull(); // statut d'une autre org
    expect((await users.a!.client.rpc("set_initial_status", { org: orgA, status: fa.statuses.find((s) => s.name === "Gagné")!.id })).error).not.toBeNull(); // final
  });
  it("reorder_statuses ignore les ids d'une autre org mélangés dans la liste", async () => {
    const before = (await admin.from("statuses").select("id, position").eq("org_id", orgB)).data!;
    await users.a!.client.rpc("reorder_statuses", { org: orgA, ids: [ids.fb0, ...fa.statuses.map((s) => s.id)] });
    const after = (await admin.from("statuses").select("id, position").eq("org_id", orgB)).data!;
    expect(after.sort((x, y) => x.id.localeCompare(y.id))).toEqual(before.sort((x, y) => x.id.localeCompare(y.id)));
  });
  it("sources système non supprimables/renommables par un client, même admin", async () => {
    const sys = fa.sources.find((s) => s.is_system)!;
    expect((await users.a!.client.from("lead_sources").delete().eq("id", sys.id).select()).error).not.toBeNull();
    expect((await users.a!.client.from("lead_sources").update({ name: "Renommé" }).eq("id", sys.id).select()).error).not.toBeNull();
    expect((await users.a!.client.from("lead_sources").update({ is_system: true }).eq("id", fa.sources.find((s) => !s.is_system)!.id).select()).error).not.toBeNull();
  });
  it("un statut final ne peut avoir de transition sortante (API directe)", async () => {
    const w = fa.statuses.find((s) => s.name === "Gagné")!.id;
    expect((await users.a!.client.from("status_transitions").insert({ org_id: orgA, from_status_id: w, to_status_id: fa.statuses[0]!.id })).error).not.toBeNull();
  });
});

describe("fonctions SQL appelées directement", () => {
  it("anon : aucune fonction S2 exécutable", async () => {
    const anon = createClient(URL, ANON, opts);
    const calls: [string, object][] = [
      ["apply_template_payload", { org: orgA, payload }],
      ["reorder_statuses", { org: orgA, ids: [] }],
      ["reorder_fields", { org: orgA, ids: [] }],
      ["set_initial_status", { org: orgA, status: fa.statuses[0]!.id }],
      ["can_transition", { org: orgA, from_status: fa.statuses[0]!.id, to_status: fa.statuses[1]!.id, role: crypto.randomUUID() }],
      ["org_has_leads", { org: orgA }],
    ];
    for (const [fn, args] of calls) expect((await anon.rpc(fn, args)).error, fn).not.toBeNull();
  });
  it("authentifié : apply_template_payload (écrasement de config) interdit, même sur sa propre org", async () => {
    for (const org of [orgA, orgB]) {
      const r = await users.a!.client.rpc("apply_template_payload", { org, payload: { statuses: [], fields: [], sources: [] } });
      expect(r.error, org).not.toBeNull();
    }
    expect((await admin.from("statuses").select("id", { count: "exact", head: true }).eq("org_id", orgB)).count).toBe(3);
  });
  // Fuite mineure : can_transition / org_has_leads (SECURITY DEFINER, accessibles à tout authentifié)
  // acceptent n'importe quelle org ; il faut connaître les uuid, impact faible. it.fails = faille connue.
  it("org_has_leads(org d'un tiers) ne révèle rien (false)", async () => {
    const r = await users.x!.client.rpc("org_has_leads", { org: orgA });
    expect(r.error).toBeNull();
    expect(r.data).toBe(false);
  });
  it("can_transition sur l'org d'un tiers ne devrait pas révéler sa config", async () => {
    const r = await users.x!.client.rpc("can_transition", { org: orgA, from_status: fa.statuses[0]!.id, to_status: fa.statuses[1]!.id, role: await roleId(orgA, "Super administrateur") });
    expect(r.error ?? r.data === false).toBeTruthy();
  });
});

describe("contraintes jsonb et injection (couche DB, hors Zod)", () => {
  it("config d'action : objet requis et < 4000 octets", async () => {
    const st = fa.statuses[1]!.id;
    const bad = [[], "x", 1, { big: "a".repeat(5000) }];
    for (const config of bad) {
      const r = await users.a!.client.from("status_actions").insert({ org_id: orgA, status_id: st, type: "notify", config });
      expect(r.error, JSON.stringify(config).slice(0, 20)).not.toBeNull();
    }
    expect((await users.a!.client.from("status_actions").insert({ org_id: orgA, status_id: st, type: "ssh", config: {} })).error).not.toBeNull();
  });
  it("options de champ : objet requis, taille bornée, clé/type validés", async () => {
    const base = { org_id: orgA, key: "k_test", label: "K test", type: "text" };
    expect((await users.a!.client.from("custom_fields").insert({ ...base, options: ["x"] })).error).not.toBeNull();
    expect((await users.a!.client.from("custom_fields").insert({ ...base, options: { c: "a".repeat(9000) } })).error).not.toBeNull();
    expect((await users.a!.client.from("custom_fields").insert({ ...base, key: "K;drop", label: "L2" })).error).not.toBeNull();
    expect((await users.a!.client.from("custom_fields").insert({ ...base, type: "script", label: "L3" })).error).not.toBeNull();
    expect((await users.a!.client.from("statuses").insert({ org_id: orgA, name: "Couleur", color: "red;background:url(x)" })).error).not.toBeNull();
    expect((await users.a!.client.from("statuses").insert({ org_id: orgA, name: "z".repeat(41), color: "#000000" })).error).not.toBeNull();
  });
  it("type et clé d'un champ immuables", async () => {
    expect((await users.a!.client.from("custom_fields").update({ type: "number" }).eq("id", fa.field).select()).error).not.toBeNull();
    expect((await users.a!.client.from("custom_fields").update({ key: "autre" }).eq("id", fa.field).select()).error).not.toBeNull();
  });
  it("le texte hostile est stocké tel quel (données) : l'affichage doit l'échapper (React)", async () => {
    const xss = `<img src=x onerror=alert(1)>`;
    const r = await users.a!.client.from("lead_sources").insert({ org_id: orgA, name: xss }).select("name").single();
    expect(r.data?.name).toBe(xss);
    await users.a!.client.from("lead_sources").delete().eq("name", xss);
  });
  // FAILLE CONNUE (majeur, latent S3) : la validation de l'URL webhook n'existe que dans Zod ; un client
  // authentifié avec statuses.manage peut stocker via REST une config webhook arbitraire (http, IP interne).
  it("la DB devrait refuser une action webhook vers une URL interne/non-https", async () => {
    const r = await users.a!.client.from("status_actions").insert({ org_id: orgA, status_id: fa.statuses[1]!.id, type: "webhook", config: { url: "http://169.254.169.254/latest/meta-data" } }).select("id");
    if (r.data?.length) await admin.from("status_actions").delete().eq("id", r.data[0]!.id);
    expect(r.error).not.toBeNull();
  });
  // Idem pour les ids utilisateur/rôle d'une autre org dans la config (assign/notify) : non vérifiés en DB.
  it("la DB devrait refuser une action assign vers un user/rôle d'une autre org", async () => {
    const r = await users.a!.client.from("status_actions").insert({ org_id: orgA, status_id: fa.statuses[1]!.id, type: "assign", config: { mode: "user", userId: users.b!.id } }).select("id");
    if (r.data?.length) await admin.from("status_actions").delete().eq("id", r.data[0]!.id);
    expect(r.error).not.toBeNull();
  });
  it("visible_roles/editable_roles devraient refuser un rôle d'une autre org", async () => {
    const rb = await roleId(orgB, "Super administrateur");
    const r = await users.a!.client.from("custom_fields").insert({ org_id: orgA, key: "x_roles", label: "X roles", type: "text", visible_roles: [rb] }).select("id");
    if (r.data?.length) await admin.from("custom_fields").delete().eq("id", r.data[0]!.id);
    expect(r.error).not.toBeNull();
  });
});

describe("Zod : validation serveur (SSRF webhook, tailles, types)", () => {
  const bad = [
    "http://example.com/h", "ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "gopher://example.com",
    "https://localhost/x", "https://foo.localhost/x", "https://127.0.0.1/x", "https://127.1/x", "https://2130706433/x", "https://0x7f.0.0.1/x",
    "https://[::1]/x", "https://[::ffff:127.0.0.1]/x", "https://[::ffff:7f00:1]/x", "https://[fe80::1]/x", "https://[fd00::1]/x",
    "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/x", "https://172.16.0.1/x", "https://192.168.1.1/x", "https://0.0.0.0/x",
    "https://user:pw@example.com/x", "https://metadata.google.internal/x", "https://printer.local/x", "https://" + "a".repeat(600) + ".com",
  ];
  it("rejette les URL webhook dangereuses", () => {
    for (const u of bad) expect(webhookUrlSchema.safeParse(u).success, u).toBe(false);
  });
  it("accepte une URL https publique", () => {
    expect(webhookUrlSchema.safeParse("https://hooks.example.com/abc?x=1").success).toBe(true);
  });
  // Plages non couvertes par isForbiddenHost (mineur) : CGNAT, benchmark, multicast, NAT64, 6to4/teredo.
  it("isForbiddenHost devrait couvrir CGNAT 100.64/10, 198.18/15, multicast et NAT64", () => {
    for (const h of ["100.64.0.1", "198.18.0.1", "224.0.0.1", "[64:ff9b::7f00:1]"]) expect(isForbiddenHost(h), h).toBe(true);
  });
  it("tailles/types : actions, champs, statuts", () => {
    const sid = crypto.randomUUID();
    expect(saveActionsSchema.safeParse({ statusId: sid, actions: Array(11).fill({ type: "webhook", enabled: true, config: { url: "https://a.example.com" } }) }).success).toBe(false);
    expect(saveActionsSchema.safeParse({ statusId: sid, actions: [{ type: "notify", enabled: true, config: { recipient: "assignee", message: "x".repeat(301) } }] }).success).toBe(false);
    expect(saveActionsSchema.safeParse({ statusId: sid, actions: [{ type: "exec", enabled: true, config: {} }] }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ label: "A", type: "select", required: false, choices: Array(31).fill("x").map((c, i) => c + i), visibleRoles: null, editableRoles: null }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ label: "A", type: "select", required: false, choices: ["a", "A"], visibleRoles: null, editableRoles: null }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ label: "A", type: "text", required: false, visibleRoles: Array(21).fill(crypto.randomUUID()), editableRoles: null }).success).toBe(false);
    expect(createStatusSchema.safeParse({ name: "ok", color: "url(javascript:1)", kind: "normal" }).success).toBe(false);
  });
});

// ---- Re-check S2 : trigger validate_status_action en REST direct, RPC save_*, fuites définer.
describe("re-check S2 : validation DB des actions et RPC atomiques", () => {
  const st = () => fa.statuses[1]!.id;
  const ins = (type: string, config: unknown, c = users.a!.client) =>
    c.from("status_actions").insert({ org_id: orgA, status_id: st(), type, config }).select("id");
  it("webhook : refuse http, IP littérales (v4/décimale/hex/v6), hôtes internes, userinfo, URL trop longue", async () => {
    for (const url of [
      "http://example.com/h", "https://127.0.0.1/", "https://169.254.169.254/latest", "https://2130706433/", "https://0x7f000001/",
      "https://[::1]/", "https://localhost/", "https://a.localhost/", "https://svc.internal/", "https://metadata.google.internal/",
      "https://u:p@example.com/", "https://" + "a".repeat(520) + ".com", "ftp://example.com", "javascript:alert(1)", "", null,
    ]) expect((await ins("webhook", { url })).error, String(url).slice(0, 40)).not.toBeNull();
    expect((await ins("webhook", {})).error).not.toBeNull();
    expect((await ins("webhook", { url: "https://hooks.example.com/ok" }).then(async (r) => { if (r.data?.length) await admin.from("status_actions").delete().eq("id", r.data[0]!.id); return r; })).error).toBeNull();
  });
  it("assign/notify/create_task : cibles d'une autre org, modes invalides, tailles", async () => {
    const rb = await roleId(orgB, "Super administrateur");
    expect((await ins("assign", { mode: "user", userId: users.b!.id })).error).not.toBeNull();
    expect((await ins("assign", { mode: "role", roleId: rb })).error).not.toBeNull();
    expect((await ins("assign", { mode: "role" })).error).not.toBeNull();
    expect((await ins("assign", { mode: "root" })).error).not.toBeNull();
    expect((await ins("notify", { recipient: "role", roleId: rb, message: "x" })).error).not.toBeNull();
    expect((await ins("notify", { recipient: "assignee", message: "x".repeat(301) })).error).not.toBeNull();
    expect((await ins("create_task", { title: "t", delay: 999, unit: "days", assignee: "assignee" })).error).not.toBeNull();
    expect((await ins("create_task", { title: "t", delay: -1, unit: "days", assignee: "assignee" })).error).not.toBeNull();
    expect((await ins("create_task", { title: "t".repeat(121), delay: 1, unit: "days", assignee: "assignee" })).error).not.toBeNull();
    expect((await ins("notify", { recipient: "user", userId: "not-a-uuid", message: "x" })).error).not.toBeNull();
    // UPDATE d'une action valide vers une config hostile : également refusé
    const ok = await admin.from("status_actions").select("id").eq("id", fa.action).single();
    const up = await users.a!.client.from("status_actions").update({ type: "webhook", config: { url: "http://169.254.169.254" } }).eq("id", ok.data!.id).select();
    expect(up.error).not.toBeNull();
  });
  it("custom_fields : rôle d'une autre org refusé en insert et update", async () => {
    const rb = await roleId(orgB, "Super administrateur");
    expect((await users.a!.client.from("custom_fields").insert({ org_id: orgA, key: "rr_test", label: "RR", type: "text", editable_roles: [rb] })).error).not.toBeNull();
    expect((await users.a!.client.from("custom_fields").update({ visible_roles: [rb] }).eq("id", fa.field).select()).error).not.toBeNull();
  });
  it("org_has_leads / can_transition muets pour un non-membre", async () => {
    const c = users.x!.client;
    expect((await c.rpc("org_has_leads", { org: orgA })).data).toBe(false);
    expect((await c.rpc("can_transition", { org: orgA, from_status: fa.statuses[0]!.id, to_status: fa.statuses[1]!.id, role: await roleId(orgA, "Super administrateur") })).data).toBe(false);
    // et pour un membre admin, la réponse reste fidèle
    expect((await users.a!.client.rpc("can_transition", { org: orgA, from_status: fa.statuses[0]!.id, to_status: fa.statuses[1]!.id, role: await roleId(orgA, "Super administrateur") })).data).toBe(true);
  });
  it("save_transitions / save_status_actions : permission, cross-org, anon", async () => {
    const [s0, s1] = [fa.statuses[0]!.id, fa.statuses[1]!.id];
    const anon = createClient(URL, ANON, opts);
    expect((await anon.rpc("save_transitions", { org: orgA, from_status: s0, targets: [] })).error).not.toBeNull();
    expect((await anon.rpc("save_status_actions", { org: orgA, status: s1, actions: [] })).error).not.toBeNull();
    // sans statuses.manage : rien n'est supprimé (RLS), l'état reste intact
    for (const u of [users.nobody!, users.perm!, users.x!]) {
      await u.client.rpc("save_transitions", { org: orgA, from_status: s0, targets: [] });
      await u.client.rpc("save_status_actions", { org: orgA, status: s1, actions: [] });
    }
    expect((await admin.from("status_transitions").select("id").eq("id", fa.transition)).data).toHaveLength(1);
    expect((await admin.from("status_actions").select("id").eq("id", fa.action)).data).toHaveLength(1);
    // admin A sur l'org B : sans effet
    await users.a!.client.rpc("save_transitions", { org: orgB, from_status: fb.statuses[0]!.id, targets: [] });
    await users.a!.client.rpc("save_status_actions", { org: orgB, status: fb.statuses[1]!.id, actions: [] });
    expect((await admin.from("status_transitions").select("id").eq("id", fb.transition)).data).toHaveLength(1);
    expect((await admin.from("status_actions").select("id").eq("id", fb.action)).data).toHaveLength(1);
    // admin A cible un statut de B tout en passant org=A : FK/RLS refusent, état A intact (atomicité)
    const bad = await users.a!.client.rpc("save_transitions", { org: orgA, from_status: s0, targets: [{ to: fb.statuses[0]!.id, roles: null }] });
    expect(bad.error).not.toBeNull();
    expect((await admin.from("status_transitions").select("id").eq("id", fa.transition)).data).toHaveLength(1);
    const badAct = await users.a!.client.rpc("save_status_actions", { org: orgA, status: s1, actions: [{ type: "webhook", config: { url: "https://127.0.0.1" }, enabled: true }] });
    expect(badAct.error).not.toBeNull();
    expect((await admin.from("status_actions").select("id").eq("id", fa.action)).data).toHaveLength(1);
  });
});
