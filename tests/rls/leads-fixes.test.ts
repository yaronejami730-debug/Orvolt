import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";
import { runMissedActions } from "@/lib/automation/catchup";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let org = "";
let leadId = "";
const st: Record<string, string> = {};
const roles: Record<string, string> = {};

async function makeUser(tag: string): Promise<U> {
  const email = `fx-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}

beforeAll(async () => {
  const [a, com, prosp] = await Promise.all(["a", "com", "prosp"].map(makeUser));
  org = (await a!.client.rpc("create_organization", { p_name: `FX ${run}`, p_template: "energie" })).data as string;
  await applyTemplate(org, "energie");
  for (const r of (await admin.from("roles").select("id, name").eq("org_id", org)).data!) roles[r.name] = r.id;
  for (const [u, role] of [[com!, "Commercial"], [prosp!, "Prospecteur"]] as const) {
    await admin.from("profiles").update({ provisioned_org: org }).eq("id", u.id);
    await admin.from("memberships").insert({ org_id: org, user_id: u.id, role_id: roles[role] });
  }
  for (const s of (await admin.from("statuses").select("id, name").eq("org_id", org)).data!) st[s.name] = s.id;
  // champs : un réservé à l'admin, un lisible mais non modifiable par le Commercial, un nombre borné
  const cf = await admin.from("custom_fields").insert([
    { org_id: org, key: "secret_admin", label: "Secret admin", type: "text", options: {}, visible_roles: [], editable_roles: [] },
    { org_id: org, key: "lecture_seule", label: "Lecture seule", type: "text", options: {}, visible_roles: [roles.Commercial], editable_roles: [] },
    { org_id: org, key: "note_pub", label: "Note publique", type: "text", options: {} },
    { org_id: org, key: "score", label: "Score", type: "number", options: { min: 0, max: 10 } },
  ]);
  if (cf.error) throw cf.error;
  leadId = (await admin.from("leads").insert({
    org_id: org, status_id: st["Nouveau"], first_name: "Lea", last_name: "Fix", assigned_to: com!.id, created_by: a!.id,
    custom: { secret_admin: "top", lecture_seule: "ro", note_pub: "ok" },
  }).select("id").single()).data!.id;
});

afterAll(async () => {
  await admin.from("organizations").delete().eq("id", org);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("champs personnalisés par rôle : écriture", () => {
  it("modification d'un champ non éditable / masqué : refusée en REST direct", async () => {
    const c = users.com!.client;
    expect((await c.from("leads").update({ custom: { secret_admin: "x", lecture_seule: "ro", note_pub: "ok" } }).eq("id", leadId).select("id")).error?.message).toContain("custom_field_forbidden");
    expect((await c.from("leads").update({ custom: { secret_admin: "top", lecture_seule: "piraté", note_pub: "ok" } }).eq("id", leadId).select("id")).error?.message).toContain("custom_field_forbidden");
    expect((await admin.from("leads").select("custom").eq("id", leadId).single()).data!.custom).toMatchObject({ secret_admin: "top", lecture_seule: "ro" });
  });
  it("un PATCH qui omet une clé masquée (donc la supprime) est refusé", async () => {
    const r = await users.com!.client.from("leads").update({ custom: { note_pub: "ok", lecture_seule: "ro" } }).eq("id", leadId).select("id");
    expect(r.error?.message).toContain("custom_field_forbidden");
  });
  it("clé inconnue, type invalide, valeur hors bornes : refusés", async () => {
    const base = { secret_admin: "top", lecture_seule: "ro", note_pub: "ok" };
    // l'admin passe aussi par les contrôles de type (clients authentifiés)
    const a = users.a!.client;
    expect((await a.from("leads").update({ custom: { ...base, inconnue: 1 } }).eq("id", leadId)).error?.message).toContain("unknown_custom_field");
    expect((await a.from("leads").update({ custom: { ...base, score: "dix" } }).eq("id", leadId)).error?.message).toContain("invalid_custom_value");
    expect((await a.from("leads").update({ custom: { ...base, score: 11 } }).eq("id", leadId)).error?.message).toContain("invalid_custom_value");
    expect((await a.from("leads").update({ custom: { ...base, score: -1 } }).eq("id", leadId)).error?.message).toContain("invalid_custom_value");
    expect((await a.from("leads").update({ custom: { ...base, score: 7 } }).eq("id", leadId).select("id")).error).toBeNull();
  });
  it("patch_lead_custom : met à jour les champs autorisés sans toucher aux clés masquées", async () => {
    const c = users.com!.client;
    expect((await c.rpc("patch_lead_custom", { p_lead: leadId, p_patch: { note_pub: "modifiée" } })).error).toBeNull();
    const row = (await admin.from("leads").select("custom").eq("id", leadId).single()).data!.custom;
    expect(row).toMatchObject({ note_pub: "modifiée", secret_admin: "top", lecture_seule: "ro" });
    expect((await c.rpc("patch_lead_custom", { p_lead: leadId, p_patch: { secret_admin: "x" } })).error?.message).toContain("custom_field_forbidden");
    expect((await c.rpc("patch_lead_custom", { p_lead: leadId, p_patch: { note_pub: null } })).error).toBeNull();
    expect((await admin.from("leads").select("custom").eq("id", leadId).single()).data!.custom).not.toHaveProperty("note_pub");
    expect((await users.prosp!.client.rpc("patch_lead_custom", { p_lead: leadId, p_patch: { note_pub: "x" } })).error).not.toBeNull(); // lead invisible
  });
});

describe("champs personnalisés par rôle : lecture", () => {
  it("la table de base n'expose plus la colonne custom aux clients", async () => {
    expect((await users.com!.client.from("leads").select("custom").eq("id", leadId)).error).not.toBeNull();
    expect((await users.a!.client.from("leads").select("*").eq("id", leadId)).error).not.toBeNull();
  });
  it("leads_api masque les clés non visibles pour le rôle ; l'admin voit tout", async () => {
    const com = (await users.com!.client.from("leads_api").select("custom").eq("id", leadId).single()).data!.custom;
    expect(com).toHaveProperty("lecture_seule");
    expect(com).not.toHaveProperty("secret_admin");
    const adm = (await users.a!.client.from("leads_api").select("custom").eq("id", leadId).single()).data!.custom;
    expect(adm).toHaveProperty("secret_admin");
  });
  it("leads_api respecte la visibilité des lignes (view_own, autre org, anon)", async () => {
    expect((await users.prosp!.client.from("leads_api").select("id")).data).toEqual([]);
    const other = await makeUser("other");
    expect((await other.client.from("leads_api").select("id")).data).toEqual([]);
    expect((await createClient(URL, ANON, opts).from("leads_api").select("id")).error).not.toBeNull();
    expect((await users.com!.client.from("leads_api").select("id")).data).toHaveLength(1);
  });
  it("le filtre sur un champ masqué ne révèle rien", async () => {
    const r = await users.com!.client.from("leads_api").select("id").ilike("custom->>secret_admin", "%top%");
    expect(r.data ?? []).toEqual([]);
  });
});

describe("statut initial imposé à l'INSERT, historique natif, chemins", () => {
  it("un client non admin créé toujours dans le statut initial ; l'admin choisit", async () => {
    const r = await users.prosp!.client.from("leads").insert({ org_id: org, created_by: users.prosp!.id, first_name: "Direct", status_id: st["Signé"] }).select("id");
    expect(r.error).toBeNull();
    const row = (await admin.from("leads").select("status_id").eq("created_by", users.prosp!.id).single()).data!;
    expect(row.status_id).toBe(st["Nouveau"]);
    const ra = await users.a!.client.from("leads").insert({ org_id: org, created_by: users.a!.id, first_name: "Choisi", status_id: st["RDV pris"] });
    expect(ra.error).toBeNull();
    expect((await admin.from("leads").select("status_id").eq("first_name", "Choisi").single()).data!.status_id).toBe(st["RDV pris"]);
  });
  it("les champs natifs modifiés sont tracés dans l'historique", async () => {
    const up = await users.a!.client.from("leads").update({ company: "ACME", phone: "0102030405" }).eq("id", leadId);
    expect(up.error).toBeNull();
    const { data } = await admin.from("lead_events").select("payload").eq("lead_id", leadId).eq("type", "field_changed").order("created_at", { ascending: false }).limit(1).single();
    expect(data!.payload.native).toEqual(expect.arrayContaining(["company", "phone"]));
  });
  it("lead_files.path refuse .. et les antislashs", async () => {
    const base = { org_id: org, lead_id: leadId, uploaded_by: users.a!.id, name: "x", size_bytes: 1, mime_type: "text/plain" };
    expect((await admin.from("lead_files").insert({ ...base, path: `${org}/${leadId}/../autre/x.txt` })).error).not.toBeNull();
    expect((await admin.from("lead_files").insert({ ...base, path: `${org}/${leadId}/a\\b.txt` })).error).not.toBeNull();
    expect((await admin.from("lead_files").insert({ ...base, path: `${org}/${leadId}/ok.txt` })).error).toBeNull();
  });
});

describe("rattrapage des actions manquées (changement de statut hors RPC)", () => {
  it("un UPDATE REST de statut déclenche les actions au rattrapage, une seule fois", async () => {
    const id = (await admin.from("leads").insert({ org_id: org, status_id: st["Nouveau"], first_name: "Rat", last_name: "Trapage", assigned_to: users.com!.id, created_by: users.a!.id }).select("id").single()).data!.id;
    expect((await users.a!.client.from("leads").update({ status_id: st["RDV pris"] }).eq("id", id)).error).toBeNull();
    const tasks = async () => (await admin.from("tasks").select("id").eq("lead_id", id)).data!.length;
    expect(await tasks()).toBe(0);
    expect(await runMissedActions(org, "fx", { force: true })).toBeGreaterThan(0);
    expect(await tasks()).toBe(1);
    await runMissedActions(org, "fx", { force: true });
    expect(await tasks()).toBe(1);
  });
});
