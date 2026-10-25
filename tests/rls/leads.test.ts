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
const orgIds: string[] = [];
let orgA = "", orgB = "";
const st: Record<string, Record<string, string>> = { A: {}, B: {} };
const src: Record<string, string> = {};
const lead: Record<string, string> = {};
const paths: string[] = [];

async function makeUser(tag: string): Promise<U> {
  const email = `ld-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
const roleId = async (org: string, name: string) => (await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single()).data!.id as string;
async function member(org: string, u: U, role: string) {
  await admin.from("profiles").update({ provisioned_org: org }).eq("id", u.id);
  await admin.from("memberships").insert({ org_id: org, user_id: u.id, role_id: await roleId(org, role) });
}
async function mkLead(org: string, status: string, extra: object = {}) {
  const r = await admin.from("leads").insert({ org_id: org, status_id: status, first_name: "Test", last_name: "Lead", ...extra }).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
}

beforeAll(async () => {
  const [a, b, all, own, prosp] = await Promise.all(["a", "b", "all", "own", "prosp"].map(makeUser));
  orgA = (await a!.client.rpc("create_organization", { p_name: `LD A ${run}`, p_template: "generic" })).data as string;
  orgB = (await b!.client.rpc("create_organization", { p_name: `LD B ${run}`, p_template: "generic" })).data as string;
  orgIds.push(orgA, orgB);
  await applyTemplate(orgA, "generic");
  await applyTemplate(orgB, "generic");
  await member(orgA, all!, "Confirmateur");
  await member(orgA, own!, "Commercial");
  await member(orgA, prosp!, "Prospecteur");
  for (const [k, org] of [["A", orgA], ["B", orgB]] as const) {
    const { data } = await admin.from("statuses").select("id, name").eq("org_id", org);
    for (const s of data!) st[k]![s.name] = s.id;
    src[k] = (await admin.from("lead_sources").select("id").eq("org_id", org).eq("name", "Salon").single()).data!.id;
  }
  lead.A1 = await mkLead(orgA, st.A!["Nouveau"]!, { created_by: a!.id });
  lead.Aown = await mkLead(orgA, st.A!["Nouveau"]!, { assigned_to: own!.id, created_by: a!.id });
  lead.B1 = await mkLead(orgB, st.B!["Nouveau"]!, { created_by: b!.id });
});

afterAll(async () => {
  if (paths.length) await admin.storage.from("lead-files").remove(paths);
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

const CHILD = ["lead_events", "lead_notes", "lead_calls", "lead_files", "tasks", "notifications", "action_runs"] as const;

describe("isolation A/B", () => {
  it("A ne voit que ses leads et tables liées", async () => {
    const a = users.a!.client;
    expect((await a.from("leads").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await a.from("leads").select("id")).data!.map((l) => l.id).sort()).toEqual([lead.A1, lead.Aown].sort());
    await admin.from("lead_notes").insert({ org_id: orgB, lead_id: lead.B1, author_id: users.b!.id, body: "secret" });
    await admin.from("tasks").insert({ org_id: orgB, lead_id: lead.B1, title: "t", assigned_to: users.b!.id });
    await admin.from("notifications").insert({ org_id: orgB, user_id: users.b!.id, type: "x" });
    for (const t of CHILD) expect((await a.from(t).select("id").eq("org_id", orgB)).data, t).toEqual([]);
  });
  it("A ne peut ni écrire, ni modifier, ni supprimer chez B", async () => {
    const a = users.a!.client;
    expect((await a.from("leads").insert({ org_id: orgB, status_id: st.B!["Nouveau"], first_name: "X", created_by: users.a!.id })).error).not.toBeNull();
    expect((await a.from("lead_notes").insert({ org_id: orgB, lead_id: lead.B1, body: "x" })).error).not.toBeNull();
    expect((await a.from("lead_calls").insert({ org_id: orgB, lead_id: lead.B1, outcome: "answered" })).error).not.toBeNull();
    expect((await a.from("tasks").insert({ org_id: orgB, lead_id: lead.B1, title: "x", created_by: users.a!.id })).error).not.toBeNull();
    for (const t of ["leads", ...CHILD] as const) {
      expect((await a.from(t).update({ org_id: orgA }).eq("org_id", orgB).select()).data ?? [], t).toEqual([]);
      expect((await a.from(t).delete().eq("org_id", orgB).select()).data ?? [], t).toEqual([]);
    }
    expect((await admin.from("leads").select("id").eq("id", lead.B1)).data).toHaveLength(1);
    expect((await a.from("leads").update({ first_name: "Hack" }).eq("id", lead.B1).select("id")).data ?? []).toEqual([]);
  });
  it("un client ne peut pas écrire lead_events, action_runs, notifications", async () => {
    const a = users.a!.client;
    expect((await a.from("lead_events").insert({ org_id: orgA, lead_id: lead.A1, type: "note" })).error).not.toBeNull();
    expect((await a.from("action_runs").insert({ org_id: orgA, lead_id: lead.A1, type: "x", dedupe_key: "k" })).error).not.toBeNull();
    expect((await a.from("notifications").insert({ org_id: orgA, user_id: users.a!.id, type: "x" })).error).not.toBeNull();
  });
  it("notifications : un utilisateur ne voit que les siennes", async () => {
    await admin.from("notifications").insert({ org_id: orgA, user_id: users.own!.id, type: "t" });
    expect((await users.a!.client.from("notifications").select("id")).data).toEqual([]);
    const mine = await users.own!.client.from("notifications").select("id, read_at");
    expect(mine.data).toHaveLength(1);
    expect((await users.own!.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", mine.data![0]!.id).select()).data).toHaveLength(1);
  });
});

describe("view_all vs view_own", () => {
  it("view_all voit tout l'org, view_own seulement assignés/créés par soi", async () => {
    expect((await users.all!.client.from("leads").select("id")).data).toHaveLength(2);
    const own = (await users.own!.client.from("leads").select("id")).data!.map((l) => l.id);
    expect(own).toEqual([lead.Aown]);
    expect((await users.prosp!.client.from("leads").select("id")).data).toEqual([]);
  });
  it("view_own ne voit pas les notes/événements d'un lead invisible", async () => {
    await admin.from("lead_notes").insert({ org_id: orgA, lead_id: lead.A1, author_id: users.a!.id, body: "privé" });
    expect((await users.own!.client.from("lead_notes").select("id").eq("lead_id", lead.A1)).data).toEqual([]);
    expect((await users.own!.client.from("lead_events").select("id").eq("lead_id", lead.A1)).data).toEqual([]);
    expect((await users.own!.client.from("lead_notes").insert({ org_id: orgA, lead_id: lead.A1, body: "x" })).error).not.toBeNull();
  });
  it("création : permission requise ; un prospecteur voit ce qu'il crée", async () => {
    const r = await users.prosp!.client.from("leads").insert({ org_id: orgA, status_id: st.A!["Nouveau"], first_name: "Pro", created_by: users.prosp!.id }).select("id").single();
    expect(r.error).toBeNull();
    expect((await users.prosp!.client.from("leads").select("id")).data).toHaveLength(1);
    expect((await users.own!.client.from("leads").insert({ org_id: orgA, status_id: st.A!["Nouveau"], first_name: "No", created_by: users.own!.id })).error).not.toBeNull();
    expect((await users.all!.client.from("leads").delete().eq("id", lead.A1).select("id")).data ?? []).toEqual([]); // pas leads.delete
    expect((await users.prosp!.client.from("leads").insert({ org_id: orgA, status_id: st.A!["Nouveau"], first_name: "Usurp", created_by: users.a!.id })).error).not.toBeNull();
  });
});

describe("transitions", () => {
  it("UPDATE direct interdit pour un rôle sans transition, autorisé sinon", async () => {
    const own = users.own!.client;
    const bad = await own.from("leads").update({ status_id: st.A!["Gagné"] }).eq("id", lead.Aown).select("id");
    expect(bad.error?.message).toContain("transition_forbidden");
    const ok = await own.from("leads").update({ status_id: st.A!["En cours"] }).eq("id", lead.Aown).select("id");
    expect(ok.error).toBeNull();
    expect((await admin.from("leads").select("status_id").eq("id", lead.Aown).single()).data!.status_id).toBe(st.A!["En cours"]);
  });
  it("move_lead : refus explicite, succès, actions renvoyées, événement écrit", async () => {
    const own = users.own!.client;
    const refused = await own.rpc("move_lead", { p_lead: lead.Aown, p_to: st.A!["Perdu"], p_position: 5 });
    expect(refused.error).toBeNull(); // En cours -> Perdu autorisé (all)
    await admin.from("leads").update({ status_id: st.A!["Nouveau"] }).eq("id", lead.Aown);
    const forbidden = await own.rpc("move_lead", { p_lead: lead.Aown, p_to: st.A!["Gagné"], p_position: 1 });
    expect(forbidden.error?.message).toContain("transition_forbidden");
    const ok = await own.rpc("move_lead", { p_lead: lead.Aown, p_to: st.A!["En cours"], p_position: 2 });
    expect(ok.error).toBeNull();
    expect(ok.data.changed).toBe(true);
    expect(ok.data.event_id).toBeTruthy();
    const ev = await admin.from("lead_events").select("type, payload, actor_id").eq("lead_id", lead.Aown).eq("type", "status_changed").order("created_at", { ascending: false }).limit(1).single();
    expect(ev.data!.payload.to_name).toBe("En cours");
    expect(ev.data!.actor_id).toBe(users.own!.id);
  });
  it("admin peut tout déplacer ; un lead invisible n'est pas déplaçable", async () => {
    expect((await users.a!.client.rpc("move_lead", { p_lead: lead.A1, p_to: st.A!["Gagné"] })).error).toBeNull();
    expect((await users.own!.client.rpc("move_lead", { p_lead: lead.A1, p_to: st.A!["Nouveau"] })).error?.message).toContain("lead_not_found");
    expect((await users.a!.client.rpc("move_lead", { p_lead: lead.A1, p_to: st.B!["Nouveau"] })).error).not.toBeNull();
    await admin.from("leads").update({ status_id: st.A!["Nouveau"] }).eq("id", lead.A1);
  });
});

describe("FK cross-org et intégrité", () => {
  it("statut, source, assigné d'une autre org refusés", async () => {
    const a = users.a!.client;
    const base = { org_id: orgA, first_name: "FK", created_by: users.a!.id };
    expect((await a.from("leads").insert({ ...base, status_id: st.B!["Nouveau"] })).error).not.toBeNull();
    expect((await a.from("leads").insert({ ...base, status_id: st.A!["Nouveau"], source_id: src.B })).error).not.toBeNull();
    expect((await a.from("leads").insert({ ...base, status_id: st.A!["Nouveau"], assigned_to: users.b!.id })).error).not.toBeNull();
    expect((await a.from("leads").update({ source_id: src.B }).eq("id", lead.A1)).error).not.toBeNull();
    expect((await a.from("leads").update({ assigned_to: users.b!.id }).eq("id", lead.A1)).error).not.toBeNull();
    expect((await a.from("leads").update({ status_id: st.B!["Nouveau"] }).eq("id", lead.A1)).error).not.toBeNull();
  });
  it("org_id et created_by immuables ; statut initial par défaut", async () => {
    const a = users.a!.client;
    expect((await a.from("leads").update({ org_id: orgB }).eq("id", lead.A1)).error).not.toBeNull();
    const r = await admin.from("leads").insert({ org_id: orgA, first_name: "Init" }).select("status_id").single();
    expect(r.data!.status_id).toBe(st.A!["Nouveau"]);
  });
  it("assigné désactivé refusé", async () => {
    await admin.from("memberships").update({ status: "disabled" }).eq("org_id", orgA).eq("user_id", users.prosp!.id);
    expect((await users.a!.client.from("leads").update({ assigned_to: users.prosp!.id }).eq("id", lead.A1)).error?.message).toContain("invalid_assignee");
    await admin.from("memberships").update({ status: "active" }).eq("org_id", orgA).eq("user_id", users.prosp!.id);
  });
  it("événements : création, assignation, champs", async () => {
    await users.a!.client.from("leads").update({ assigned_to: users.all!.id, custom: { entreprise: "ACME" } }).eq("id", lead.A1);
    const { data } = await admin.from("lead_events").select("type").eq("lead_id", lead.A1);
    expect(data!.map((e) => e.type)).toEqual(expect.arrayContaining(["created", "assigned", "field_changed", "note"]));
  });
  it("statut utilisé : suppression directe bloquée, remplacement via RPC", async () => {
    const a = users.a!.client;
    expect((await a.from("statuses").delete().eq("id", st.A!["Gagné"])).error).toBeNull(); // aucun lead dedans
    const tmp = (await admin.from("statuses").insert({ org_id: orgA, name: "Tmp", color: "#3b82f6" }).select("id").single()).data!.id as string;
    const l = await mkLead(orgA, tmp);
    expect((await a.from("statuses").delete().eq("id", tmp)).error).not.toBeNull();
    expect((await users.own!.client.rpc("delete_status_replace", { p_org: orgA, p_status: tmp, p_replacement: st.A!["Nouveau"] })).error).not.toBeNull();
    const r = await a.rpc("delete_status_replace", { p_org: orgA, p_status: tmp, p_replacement: st.A!["Nouveau"] });
    expect(r.error).toBeNull();
    expect(r.data).toBe(1);
    expect((await admin.from("leads").select("status_id").eq("id", l).single()).data!.status_id).toBe(st.A!["Nouveau"]);
    expect((await a.rpc("delete_status_replace", { p_org: orgA, p_status: st.B!["En cours"], p_replacement: null })).error).not.toBeNull();
  });
  it("source utilisée : suppression bloquée ; compteurs ; garde du changement de template", async () => {
    const a = users.a!.client;
    const l = await mkLead(orgA, st.A!["Nouveau"]!, { source_id: src.A });
    expect((await a.from("lead_sources").delete().eq("id", src.A)).error).not.toBeNull();
    const counts = await a.rpc("source_lead_counts", { p_org: orgA });
    expect(counts.data!.find((c: { source_id: string }) => c.source_id === src.A).n).toBe(1);
    expect((await users.own!.client.rpc("source_lead_counts", { p_org: orgA })).data).toEqual([]);
    expect((await a.rpc("org_has_leads", { org: orgA })).data).toBe(true);
    const res = await applyTemplate(orgA, "btp");
    expect(res.ok).toBe(false);
    expect((await admin.from("statuses").select("id", { count: "exact", head: true }).eq("org_id", orgA)).count).toBeGreaterThan(0);
    await admin.from("leads").delete().eq("id", l);
  });
});

describe("Storage lead-files", () => {
  const file = new Blob(["hello"], { type: "text/plain" });
  it("upload sur le chemin {org}/{lead}/ ; lecture limitée aux leads visibles", async () => {
    const p = `${orgA}/${lead.Aown}/note.txt`;
    paths.push(p);
    expect((await users.a!.client.storage.from("lead-files").upload(p, file, { contentType: "text/plain" })).error).toBeNull();
    expect((await users.own!.client.storage.from("lead-files").download(p)).error).toBeNull();
    expect((await users.all!.client.storage.from("lead-files").download(p)).error).toBeNull();
    expect((await users.b!.client.storage.from("lead-files").download(p)).error).not.toBeNull();
    const p2 = `${orgA}/${lead.A1}/secret.txt`;
    paths.push(p2);
    await admin.storage.from("lead-files").upload(p2, file, { contentType: "text/plain" });
    expect((await users.own!.client.storage.from("lead-files").download(p2)).error).not.toBeNull(); // lead non visible
    expect((await users.b!.client.storage.from("lead-files").download(p2)).error).not.toBeNull();
  });
  it("écriture refusée : autre org, sans permission, chemin invalide, type interdit, liste", async () => {
    const bucket = (u: string) => users[u]!.client.storage.from("lead-files");
    expect((await bucket("b").upload(`${orgA}/${lead.Aown}/hack.txt`, file, { contentType: "text/plain" })).error).not.toBeNull();
    expect((await bucket("a").upload(`${orgB}/${lead.B1}/hack.txt`, file, { contentType: "text/plain" })).error).not.toBeNull();
    expect((await bucket("a").upload(`${orgA}/pas-un-uuid/x.txt`, file, { contentType: "text/plain" })).error).not.toBeNull();
    expect((await bucket("a").upload(`${orgA}/${lead.A1}/evil.html`, new Blob(["<script>"], { type: "text/html" }), { contentType: "text/html" })).error).not.toBeNull();
    expect((await bucket("prosp").upload(`${orgA}/${lead.A1}/x.txt`, file, { contentType: "text/plain" })).error).not.toBeNull();
    const list = await bucket("b").list(`${orgA}/${lead.Aown}`);
    expect(list.data ?? []).toEqual([]);
    expect((await bucket("b").remove([`${orgA}/${lead.Aown}/note.txt`])).data ?? []).toEqual([]);
    const { data } = await admin.storage.from("lead-files").list(`${orgA}/${lead.Aown}`);
    expect(data!.map((f) => f.name)).toContain("note.txt");
  });
  it("lead_files : chemin cohérent exigé", async () => {
    const a = users.a!.client;
    const bad = await a.from("lead_files").insert({ org_id: orgA, lead_id: lead.Aown, path: `${orgB}/x/y.txt`, name: "y", size_bytes: 1, mime_type: "text/plain" });
    expect(bad.error).not.toBeNull();
    const ok = await a.from("lead_files").insert({ org_id: orgA, lead_id: lead.Aown, path: `${orgA}/${lead.Aown}/note.txt`, name: "note.txt", size_bytes: 5, mime_type: "text/plain" });
    expect(ok.error).toBeNull();
  });
});
