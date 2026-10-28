import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";

// K-fixes :
//  - cause du signalement « à rééquilibrer » (rebalance_reason) ;
//  - le lead passe à « RDV pris » quand son RDV est confirmé / attribué, dans les limites du workflow de l'organisation.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let org = "", seq = 0;
const st: Record<string, string> = {};
const t = (h: number, d = 0) => new Date(Date.UTC(2031, 5, 10 + d, h, 0)).toISOString();

async function makeUser(tag: string): Promise<U> {
  const email = `kf-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
async function join(u: U, role: string) {
  await admin.from("profiles").update({ provisioned_org: org }).eq("id", u.id);
  const rid = (await admin.from("roles").select("id").eq("org_id", org).eq("name", role).single()).data!.id;
  const { error } = await admin.from("memberships").insert({ org_id: org, user_id: u.id, role_id: rid });
  if (error) throw error;
}
const lead = async (statusName: string) =>
  (await admin.from("leads").insert({ org_id: org, status_id: st[statusName], first_name: "Cli", last_name: `K${++seq}` }).select("id").single()).data!.id as string;
const leadStatus = async (id: string) => (await admin.from("statuses").select("name").eq("id", (await admin.from("leads").select("status_id").eq("id", id).single()).data!.status_id).single()).data!.name as string;
/** RDV à attribuer (confirmé ou non), sans commercial. */
const pendingAppt = async (leadId: string, status: string) =>
  (await admin.from("appointments").insert({ org_id: org, lead_id: leadId, status, dispatch_status: "unassigned", wish_from: "2031-06-10", wish_to: "2031-06-12", duration_min: 60 }).select("id").single());

beforeAll(async () => {
  const [owner, conf, c1] = await Promise.all(["owner", "conf", "c1"].map(makeUser));
  org = (await owner!.client.rpc("create_organization", { p_name: `KF ${run}`, p_template: "energie" })).data as string;
  await applyTemplate(org, "energie");
  await admin.from("organizations").update({ seat_limit: 20 }).eq("id", org);
  await join(conf!, "Confirmateur");
  await join(c1!, "Commercial");
  for (const s of (await admin.from("statuses").select("id, name").eq("org_id", org)).data!) st[s.name] = s.id;
});
afterAll(async () => {
  await admin.from("organizations").delete().eq("id", org);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("lead -> « RDV pris »", () => {
  it("RDV confirmé : un lead Nouveau passe à « RDV pris », avec l'événement d'historique", async () => {
    const l = await lead("Nouveau");
    expect((await pendingAppt(l, "confirmed")).error).toBeNull();
    expect(await leadStatus(l)).toBe("RDV pris");
    const ev = (await admin.from("lead_events").select("type, payload").eq("lead_id", l)).data!;
    expect(ev.some((e) => e.type === "status_changed" && e.payload.to_name === "RDV pris")).toBe(true);
    expect(ev.some((e) => e.type === "appointment" && e.payload.action === "lead_status_auto")).toBe(true);
  });
  it("RDV à confirmer (non confirmé) : le lead ne bouge pas ; il bouge à la confirmation", async () => {
    const l = await lead("À qualifier");
    const a = await pendingAppt(l, "planned");
    expect(a.error).toBeNull();
    expect(await leadStatus(l)).toBe("À qualifier");
    await admin.from("appointments").update({ status: "confirmed" }).eq("id", a.data!.id);
    expect(await leadStatus(l)).toBe("RDV pris");
  });
  it("attribution par la répartition (unassigned -> assigned) : un lead Qualifié passe à « RDV pris »", async () => {
    const l = await lead("Qualifié");
    const a = await pendingAppt(l, "planned");
    await admin.from("appointments").update({ dispatch_status: "assigned", assigned_to: users.c1!.id, starts_at: t(8), ends_at: t(9), dispatched_at: new Date().toISOString() }).eq("id", a.data!.id);
    expect(await leadStatus(l)).toBe("RDV pris");
  });
  it("jamais de recul ni de sortie d'un statut final : Devis envoyé, Signé et Perdu restent", async () => {
    for (const name of ["Devis envoyé", "Signé", "Perdu"]) {
      const l = await lead(name);
      expect((await pendingAppt(l, "confirmed")).error).toBeNull();
      expect(await leadStatus(l)).toBe(name);
    }
  });
  it("RDV de simulation : le lead ne bouge pas", async () => {
    const l = await lead("Nouveau");
    const { error } = await admin.from("appointments").insert({ org_id: org, lead_id: l, status: "confirmed", dispatch_status: "unassigned", wish_from: "2031-06-10", wish_to: "2031-06-12", duration_min: 60, is_simulation: true });
    expect(error).toBeNull();
    expect(await leadStatus(l)).toBe("Nouveau");
  });
  it("workflow sans chemin vers « RDV pris » : le lead ne bouge pas", async () => {
    await admin.from("status_transitions").delete().eq("org_id", org).eq("from_status_id", st["Qualifié"]!).eq("to_status_id", st["RDV pris"]!);
    const l = await lead("Qualifié");
    expect((await pendingAppt(l, "confirmed")).error).toBeNull();
    expect(await leadStatus(l)).toBe("Qualifié");
  });
  it("organisation sans statut « RDV pris » : aucun changement, l'enregistrement du RDV réussit", async () => {
    await admin.from("statuses").update({ name: "Visite" }).eq("id", st["RDV pris"]!);
    const l = await lead("Nouveau");
    expect((await pendingAppt(l, "confirmed")).error).toBeNull();
    expect(await leadStatus(l)).toBe("Nouveau");
  });
});

describe("rebalance_reason", () => {
  it("indisponibilité : cause « unavailability » ; remise à NULL quand le RDV n'est plus à rééquilibrer", async () => {
    const l = await lead("Visite");
    const { data, error } = await admin.from("appointments").insert({
      org_id: org, lead_id: l, assigned_to: users.c1!.id, starts_at: t(8, 3), ends_at: t(9, 3), status: "confirmed", dispatch_status: "assigned", dispatched_at: new Date().toISOString(),
      wish_from: "2031-06-13", wish_to: "2031-06-15", duration_min: 60,
    }).select("id").single();
    expect(error).toBeNull();
    const add = await users.conf!.client.from("sales_unavailability").insert({ org_id: org, user_id: users.c1!.id, day: "2031-06-13" });
    expect(add.error).toBeNull();
    const get = async () => (await admin.from("appointments").select("needs_rebalance, rebalance_reason").eq("id", data!.id).single()).data!;
    expect(await get()).toMatchObject({ needs_rebalance: true, rebalance_reason: "unavailability" });
    await admin.from("appointments").update({ needs_rebalance: false }).eq("id", data!.id);
    expect(await get()).toMatchObject({ needs_rebalance: false, rebalance_reason: null });
    await admin.from("appointments").update({ needs_rebalance: true }).eq("id", data!.id);
    expect(await get()).toMatchObject({ needs_rebalance: true, rebalance_reason: null });
  });
});
