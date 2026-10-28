import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Programmation des formulaires d'appel : isolation entre organisations, membre désactivé, droits d'un téléprospecteur,
// références inter-organisations, plafonds, doublons, résolution SQL (qui voit quoi) et plan.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let org = "", org2 = "";
let domPac = "", domPv = "", dom2 = "", sPac = "", sPv = "", sGen = "", s2 = "", lead = "";

async function makeUser(tag: string): Promise<U> {
  const email = `cs-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
async function join(u: U, o: string, role: string) {
  await admin.from("profiles").update({ provisioned_org: o }).eq("id", u.id);
  const rid = (await admin.from("roles").select("id").eq("org_id", o).eq("name", role).single()).data!.id;
  const { error } = await admin.from("memberships").insert({ org_id: o, user_id: u.id, role_id: rid });
  if (error) throw error;
}
const script = async (o: string, name: string, domain: string | null = null) =>
  (await admin.from("call_scripts").insert({ org_id: o, name, domain_id: domain }).select("id").single()).data!.id as string;
const assign = (o: string, scriptId: string, extra: Record<string, unknown> = {}) =>
  admin.from("call_script_assignments").insert({ org_id: o, script_id: scriptId, scope: "all", ...extra });
const visible = async (u: U) => ((await u.client.rpc("call_scripts_for_member", { p_lead: lead })).data ?? []).map((r: { name: string }) => r.name) as string[];

beforeAll(async () => {
  const [boss, pac, pv, off, boss2] = await Promise.all(["boss", "pac", "pv", "off", "boss2"].map(makeUser));
  org = (await boss!.client.rpc("create_organization", { p_name: `CS ${run}`, p_template: "energie" })).data as string;
  org2 = (await boss2!.client.rpc("create_organization", { p_name: `CS2 ${run}`, p_template: "energie" })).data as string;
  await admin.from("organizations").update({ seat_limit: 20 }).eq("id", org);
  await join(pac!, org, "Prospecteur");
  await join(pv!, org, "Prospecteur");
  await join(off!, org, "Prospecteur");
  await admin.from("memberships").update({ status: "disabled" }).eq("org_id", org).eq("user_id", off!.id);
  domPac = (await admin.from("call_domains").insert({ org_id: org, name: "PAC" }).select("id").single()).data!.id;
  domPv = (await admin.from("call_domains").insert({ org_id: org, name: "PV" }).select("id").single()).data!.id;
  dom2 = (await admin.from("call_domains").insert({ org_id: org2, name: "Autre" }).select("id").single()).data!.id;
  sPac = await script(org, "Form PAC", domPac);
  sPv = await script(org, "Form PV", domPv);
  sGen = await script(org, "Form générique");
  s2 = await script(org2, "Form autre org");
  await admin.from("member_call_domains").insert([{ org_id: org, user_id: pac!.id, domain_id: domPac }, { org_id: org, user_id: pv!.id, domain_id: domPv }]);
  await assign(org, sPac, { scope: "domain", domain_id: domPac });
  await assign(org, sPv, { scope: "domain", domain_id: domPv });
  // create_organization ne crée plus de statut : on en pose un directement (sans applyTemplate, qui ajoute aussi domaines et formulaires).
  const status = (await admin.from("statuses").insert({ org_id: org, name: "Nouveau", color: "#3b82f6", is_initial: true }).select("id").single()).data!.id;
  // Le Prospecteur ne voit que ses propres leads (leads.view_own) : le lead de test est créé par le service_role, on lui donne donc la vue globale
  // dans cette organisation de test uniquement, pour que call_scripts_for_member (qui exige la visibilité du lead) s'applique aux deux téléprospecteurs.
  await admin.from("roles").update({ permissions: ["leads.view_all", "leads.view_own", "leads.create", "leads.edit", "leads.import", "appointments.manage_own"] }).eq("org_id", org).eq("name", "Prospecteur");
  lead = (await admin.from("leads").insert({ org_id: org, status_id: status, first_name: "Cli", last_name: "Ent" }).select("id").single()).data!.id;
});
afterAll(async () => {
  await admin.from("organizations").delete().in("id", [org, org2]);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("isolation et droits", () => {
  it("une autre organisation ne voit ni domaines, ni affectations, ni domaines de membres", async () => {
    const o = users.boss2!.client;
    expect((await o.from("call_domains").select("id").eq("org_id", org)).data).toEqual([]);
    expect((await o.from("call_script_assignments").select("id").eq("org_id", org)).data).toEqual([]);
    expect((await o.from("member_call_domains").select("user_id").eq("org_id", org)).data).toEqual([]);
    expect((await o.rpc("call_scripts_for_member", { p_lead: lead })).data ?? []).toEqual([]);
  });
  it("un membre désactivé ne lit ni n'écrit rien", async () => {
    const d = users.off!.client;
    expect((await d.from("call_domains").select("id")).data).toEqual([]);
    expect((await d.from("call_scripts").select("id")).data).toEqual([]);
    expect((await d.from("call_domains").insert({ org_id: org, name: "X" })).error).not.toBeNull();
  });
  it("un téléprospecteur lit les domaines mais pas les affectations des autres, et ne modifie rien", async () => {
    const p = users.pac!.client;
    expect(((await p.from("call_domains").select("id")).data ?? []).length).toBe(2);
    expect((await p.from("call_script_assignments").select("id")).data).toEqual([]);
    expect(((await p.from("member_call_domains").select("user_id")).data ?? []).map((r) => r.user_id)).toEqual([users.pac!.id]); // seulement les siens
    expect((await p.from("call_domains").insert({ org_id: org, name: "Pirate" })).error).not.toBeNull();
    await p.from("call_domains").update({ name: "Hacké" }).eq("id", domPac);
    expect((await admin.from("call_domains").select("name").eq("id", domPac).single()).data!.name).toBe("PAC");
    expect((await p.from("call_script_assignments").insert({ org_id: org, script_id: sGen, scope: "all", created_by: users.pac!.id })).error).not.toBeNull();
    expect((await p.from("member_call_domains").insert({ org_id: org, user_id: users.pac!.id, domain_id: domPv })).error).not.toBeNull();
    await p.from("member_call_domains").delete().eq("user_id", users.pac!.id);
    expect((await admin.from("member_call_domains").select("domain_id").eq("user_id", users.pac!.id)).data!.length).toBe(1);
  });
  it("le gérant (administrateur) programme", async () => {
    const b = users.boss!.client;
    const { error } = await b.from("call_script_assignments").insert({ org_id: org, script_id: sGen, scope: "all", priority: 1, created_by: users.boss!.id });
    expect(error).toBeNull();
    expect(((await b.from("call_script_assignments").select("id")).data ?? []).length).toBeGreaterThanOrEqual(3);
    await admin.from("call_script_assignments").delete().eq("org_id", org).eq("script_id", sGen);
  });
});

describe("références inter-organisations", () => {
  it("refusées par les clés étrangères composites", async () => {
    expect((await assign(org, s2)).error).not.toBeNull(); // formulaire d'une autre organisation
    expect((await assign(org, sGen, { scope: "domain", domain_id: dom2 })).error).not.toBeNull();
    expect((await assign(org, sGen, { scope: "member", user_id: users.boss2!.id })).error).not.toBeNull();
    expect((await admin.from("member_call_domains").insert({ org_id: org, user_id: users.pv!.id, domain_id: dom2 })).error).not.toBeNull();
    expect((await admin.from("call_scripts").update({ domain_id: dom2 }).eq("id", sGen)).error).not.toBeNull();
    expect((await admin.from("leads").update({ call_domain_id: dom2 }).eq("id", lead)).error).not.toBeNull();
  });
  it("incohérences refusées par contraintes", async () => {
    expect((await assign(org, sGen, { scope: "member" })).error).not.toBeNull();
    expect((await assign(org, sGen, { starts_on: "2031-02-01", ends_on: "2031-01-01" })).error).not.toBeNull();
    expect((await assign(org, sGen, { time_from: "12:00", time_to: "09:00" })).error).not.toBeNull();
    expect((await assign(org, sGen, { days: [0, 8] })).error).not.toBeNull();
  });
  it("doublon exact refusé", async () => {
    expect((await assign(org, sGen, { days: [1, 2] })).error).toBeNull();
    expect((await assign(org, sGen, { days: [2, 1] })).error).not.toBeNull();
    await admin.from("call_script_assignments").delete().eq("org_id", org).eq("script_id", sGen);
  });
});

describe("plafonds", () => {
  it("30 domaines par organisation", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ org_id: org2, name: `D${i}` }));
    let ok = 0;
    for (const r of rows) if (!(await admin.from("call_domains").insert(r)).error) ok++;
    expect(ok + 1).toBe(30); // « Autre » existe déjà
  });
  it("10 domaines par membre et 40 programmations par formulaire", async () => {
    const dids: string[] = [];
    for (let i = 0; i < 11; i++) dids.push((await admin.from("call_domains").insert({ org_id: org, name: `M${i}` }).select("id").single()).data?.id ?? "");
    let ok = 0;
    for (const d of dids.filter(Boolean)) if (!(await admin.from("member_call_domains").insert({ org_id: org, user_id: users.pv!.id, domain_id: d })).error) ok++;
    expect(ok + 1).toBe(10); // + PV
    let n = 0;
    for (let i = 1; i <= 45; i++) if (!(await assign(org, sGen, { starts_on: `2031-01-${String((i % 28) + 1).padStart(2, "0")}`, ends_on: `2032-0${(i % 9) + 1}-15`, priority: i % 100 })).error) n++;
    expect(n).toBe(40);
    await admin.from("call_script_assignments").delete().eq("org_id", org).eq("script_id", sGen);
  });
});

describe("résolution SQL", () => {
  it("chaque téléprospecteur ne voit que les formulaires qui lui sont affectés (non programmé = ouvert à tous)", async () => {
    expect(await visible(users.pac!)).toEqual(["Form PAC", "Form générique"]);
    expect(await visible(users.pv!)).toEqual(["Form PV", "Form générique"]);
    // lecture directe : le formulaire d'un autre domaine n'est pas lisible non plus
    expect(((await users.pac!.client.from("call_scripts").select("name")).data ?? []).map((r) => r.name).sort()).toEqual(["Form PAC", "Form générique"]);
    expect((await users.pac!.client.from("call_script_questions").select("id").eq("script_id", sPv)).data).toEqual([]);
  });
  it("le domaine du lead passe en premier ; un domaine inactif est ignoré", async () => {
    await admin.from("member_call_domains").insert({ org_id: org, user_id: users.pac!.id, domain_id: domPv });
    await admin.from("leads").update({ call_domain_id: domPv }).eq("id", lead);
    expect((await visible(users.pac!))[0]).toBe("Form PV");
    await admin.from("call_domains").update({ active: false }).eq("id", domPv);
    expect((await visible(users.pac!))[0]).toBe("Form PAC");
    await admin.from("call_domains").update({ active: true }).eq("id", domPv);
    await admin.from("member_call_domains").delete().eq("user_id", users.pac!.id).eq("domain_id", domPv);
    await admin.from("leads").update({ call_domain_id: null }).eq("id", lead);
  });
  it("période passée : le formulaire disparaît ; période future aussi ; l'heure demandée par un téléprospecteur est ignorée", async () => {
    const id = (await admin.from("call_script_assignments").select("id").eq("script_id", sPac).single()).data!.id;
    await admin.from("call_script_assignments").update({ ends_on: "2020-01-01" }).eq("id", id);
    expect(await visible(users.pac!)).toEqual(["Form générique"]);
    await admin.from("call_script_assignments").update({ starts_on: "2099-01-01", ends_on: null }).eq("id", id);
    expect(await visible(users.pac!)).toEqual(["Form générique"]);
    // p_at ne sert qu'au gérant : un téléprospecteur ne peut pas « voyager dans le temps »
    expect(((await users.pac!.client.rpc("call_scripts_for_member", { p_lead: lead, p_at: "2099-06-01T10:00:00Z" })).data ?? []).map((r: { name: string }) => r.name)).toEqual(["Form générique"]);
    await admin.from("call_script_assignments").update({ starts_on: null, ends_on: null }).eq("id", id);
  });
  it("un gérant voit tous les formulaires actifs ; l'aperçu d'un membre reflète sa programmation", async () => {
    expect((await visible(users.boss!)).sort()).toEqual(["Form PAC", "Form PV", "Form générique"]);
    const prev = (await users.boss!.client.rpc("call_scripts_preview", { p_org: org, p_user: users.pac!.id })).data as { name: string }[];
    expect(prev.map((r) => r.name)).toEqual(["Form PAC", "Form générique"]);
    expect((await users.pac!.client.rpc("call_scripts_preview", { p_org: org, p_user: users.pv!.id })).error).not.toBeNull();
  });
  it("une saisie sur un formulaire non affecté est refusée par la base", async () => {
    const answers = [{ question: "q", label: "Q", value: "x" }];
    const bad = await users.pac!.client.from("call_script_runs").insert({ org_id: org, script_id: sPv, script_name: "Form PV", lead_id: lead, answers });
    expect(bad.error).not.toBeNull();
    const good = await users.pac!.client.from("call_script_runs").insert({ org_id: org, script_id: sPac, script_name: "Form PAC", domain_name: "PAC", lead_id: lead, answers });
    // (nécessite leads.edit : le Prospecteur l'a ; sinon le test révèle un rôle mal configuré)
    expect(good.error).toBeNull();
    expect((await admin.from("lead_events").select("type").eq("lead_id", lead).eq("type", "script")).data!.length).toBe(1);
  });
  it("plan Starter : la programmation est ignorée (tout est ouvert) et non modifiable", async () => {
    await admin.from("organizations").update({ plan: "starter", subscription_status: "active" }).eq("id", org);
    expect((await visible(users.pac!)).sort()).toEqual(["Form PAC", "Form PV", "Form générique"]);
    expect((await users.boss!.client.from("call_domains").insert({ org_id: org, name: "Starter" })).error).not.toBeNull();
    await admin.from("organizations").update({ plan: "pro" }).eq("id", org);
    expect(await visible(users.pv!)).toEqual(["Form PV", "Form générique"]);
  });
});
