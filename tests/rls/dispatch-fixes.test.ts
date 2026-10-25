import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";
import { easterSunday } from "@/lib/dispatch/holidays";

// Correctifs de l'audit C : RDV « à attribuer » du télépro, simulation inoffensive, rejeu complet en base, rééquilibrage, fériés.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let orgA = "", orgB = "", statusA = "";
const BASE = { lat: 45.7578, lng: 4.832 };
const P1 = { lat: 45.7597, lng: 4.8422 };
const P2 = { lat: 45.7719, lng: 4.8902 };
// 2031-06-10 = mardi ; heure d'été (UTC+2) : 10:00 local = 08:00Z
const t = (h: number, m = 0, d = 0) => new Date(Date.UTC(2031, 5, 10 + d, h, m)).toISOString();
const key = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
let seq = 0;
const item = (id: string, user: string, start: string, end: string) => ({ appointment_id: id, user_id: user, starts_at: start, ends_at: end });

async function makeUser(tag: string): Promise<U> {
  const email = `df-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
async function join(org: string, u: U, role: string) {
  await admin.from("profiles").update({ provisioned_org: org }).eq("id", u.id);
  const rid = (await admin.from("roles").select("id").eq("org_id", org).eq("name", role).single()).data!.id;
  const { error } = await admin.from("memberships").insert({ org_id: org, user_id: u.id, role_id: rid });
  if (error) throw error;
}
async function lead(extra: object = {}): Promise<string> {
  const { data, error } = await admin.from("leads").insert({ org_id: orgA, status_id: statusA, first_name: "Cli", last_name: `Df${++seq}`, ...extra }).select("id").single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}
/** RDV confirmé « à attribuer » (souhait du 10 au 30 juin 2031, 60 min) avec point GPS. */
async function pending(point = P1, extra: object = {}, leadExtra: object = {}): Promise<{ id: string; lead: string }> {
  const l = await lead(leadExtra);
  const { data, error } = await admin.from("appointments").insert({
    org_id: orgA, lead_id: l, assigned_to: null, starts_at: null, ends_at: null, status: "confirmed", dispatch_status: "unassigned",
    wish_from: "2031-06-10", wish_to: "2031-06-30", duration_min: 60, lat: point.lat, lng: point.lng, location_address: "1 rue Test, Lyon", ...extra,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data!.id as string, lead: l };
}
const call = (items: object[]) => users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: items });
const notifs = async (user: string, like: string) => (await admin.from("notifications").select("payload, dedupe_key").eq("user_id", user).eq("org_id", orgA).like("dedupe_key", like)).data ?? [];

beforeAll(async () => {
  const [owner, ob, conf, c1, c2, pro] = await Promise.all(["owner", "ob", "conf", "c1", "c2", "pro"].map(makeUser));
  orgA = (await owner!.client.rpc("create_organization", { p_name: `DF A ${run}`, p_template: "generic" })).data as string;
  orgB = (await ob!.client.rpc("create_organization", { p_name: `DF B ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(orgA, "generic");
  await admin.from("organizations").update({ seat_limit: 20 }).eq("id", orgA);
  await join(orgA, conf!, "Confirmateur");
  await join(orgA, c1!, "Commercial");
  await join(orgA, c2!, "Commercial");
  await join(orgA, pro!, "Prospecteur");
  statusA = (await admin.from("statuses").select("id").eq("org_id", orgA).eq("is_initial", true).single()).data!.id;
  for (const u of [c1!, c2!]) {
    const { error } = await admin.from("sales_zones").insert({ org_id: orgA, user_id: u.id, base_address: "Place Bellecour, Lyon", base_lat: BASE.lat, base_lng: BASE.lng, radius_km: 40, work_start: "09:00", work_end: "19:00", target_per_day: 4, comfort_max: 5, absolute_max: 6 });
    if (error) throw new Error(error.message);
  }
  const rows = [[BASE, P1, 600, 5000], [BASE, P2, 900, 9000], [P1, P2, 720, 6000], [P2, P1, 720, 6000], [P1, BASE, 600, 5000], [P2, BASE, 900, 9000]] as const;
  await admin.from("routing_cache").upsert(rows.map(([a, b, s, m]) => ({ key: key(a, b), duration_s: s, distance_m: m, provider: "fake", expires_at: new Date(Date.now() + 86_400_000).toISOString() })));
});

afterAll(async () => {
  for (const id of [orgA, orgB]) await admin.from("organizations").delete().eq("id", id);
  await admin.from("routing_cache").delete().like("key", "45.7%");
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

// ------------------------------------------------------------------ HAUT 1
describe("RDV « à attribuer » créé par un télépro (create_pending_appointment)", () => {
  const args = (leadId: string, extra: object = {}) => ({ p_lead: leadId, p_wish_from: "2031-06-10", p_wish_to: "2031-06-14", p_duration: 60, p_address: "1 rue Test, 69003 Lyon", p_lat: P1.lat, p_lng: P1.lng, p_precision: "street", p_score: 0.9, p_source: "ban", p_notes: null, ...extra });
  let proLead = "";
  let apptId = "";
  beforeAll(async () => { proLead = await lead({ created_by: users.pro!.id, assigned_to: users.pro!.id }); });

  it("le télépro crée un RDV sans commercial ni heure : planned / unassigned, fenêtre, durée, position", async () => {
    const r = await users.pro!.client.rpc("create_pending_appointment", args(proLead));
    expect(r.error?.message).toBeUndefined();
    apptId = r.data as string;
    const a = (await admin.from("appointments").select("*").eq("id", apptId).single()).data!;
    expect(a).toMatchObject({
      assigned_to: null, starts_at: null, ends_at: null, status: "planned", dispatch_status: "unassigned", wish_from: "2031-06-10", wish_to: "2031-06-14",
      duration_min: 60, lat: P1.lat, lng: P1.lng, geo_precision: "street", geo_source: "ban", created_by: users.pro!.id, is_simulation: false,
    });
    const ev = await admin.from("lead_events").select("payload").eq("type", "appointment").contains("payload", { appointment_id: apptId, action: "pending_dispatch" });
    expect(ev.data).toHaveLength(1);
  });
  it("visible du télépro et du confirmateur, pas d'un autre commercial ; le confirmateur est prévenu", async () => {
    expect((await users.pro!.client.from("appointments").select("id").eq("id", apptId)).data).toHaveLength(1);
    expect((await users.conf!.client.from("appointments").select("id").eq("id", apptId)).data).toHaveLength(1);
    expect((await users.c1!.client.from("appointments").select("id").eq("id", apptId)).data).toEqual([]);
    const n = await admin.from("notifications").select("payload").eq("user_id", users.conf!.id).eq("org_id", orgA);
    expect(JSON.stringify(n.data)).toContain("à attribuer");
  });
  it("flux complet : le confirmateur confirme (planned seulement) puis le moteur attribue", async () => {
    const conf = await users.conf!.client.from("appointments").update({ status: "confirmed" }).eq("id", apptId).eq("dispatch_status", "unassigned").eq("status", "planned").select("id");
    expect(conf.error?.message).toBeUndefined();
    expect(conf.data).toHaveLength(1);
    const again = await users.conf!.client.from("appointments").update({ status: "confirmed" }).eq("id", apptId).eq("dispatch_status", "unassigned").eq("status", "planned").select("id");
    expect(again.data).toEqual([]); // déjà confirmé : le filtre status=planned ne touche plus rien
    const r = await call([item(apptId, users.c1!.id, t(8), t(9))]);
    expect(r.error?.message).toBeUndefined();
    expect(r.data).toMatchObject({ applied: 1 });
    expect((await admin.from("appointments").select("dispatch_status, assigned_to").eq("id", apptId).single()).data).toMatchObject({ dispatch_status: "assigned", assigned_to: users.c1!.id });
  });
  it("MOYEN 3 : un RDV annulé non attribué ne peut pas être « confirmé »", async () => {
    const x = await pending(P1, { status: "cancelled" });
    const r = await users.conf!.client.from("appointments").update({ status: "confirmed" }).eq("id", x.id).eq("dispatch_status", "unassigned").eq("status", "planned").select("id");
    expect(r.data).toEqual([]);
    expect((await admin.from("appointments").select("status").eq("id", x.id).single()).data!.status).toBe("cancelled");
  });
  it("refuse : fenêtre passée/aujourd'hui, ordre, > 31 jours, durée, position hors France ou incomplète, précision inconnue", async () => {
    const bad = async (extra: object, msg: string) => expect((await users.pro!.client.rpc("create_pending_appointment", args(proLead, extra))).error?.message, msg).toContain(msg);
    const today = new Date().toISOString().slice(0, 10);
    await bad({ p_wish_from: today, p_wish_to: "2031-06-14" }, "invalid_wish");
    await bad({ p_wish_from: "2031-06-14", p_wish_to: "2031-06-10" }, "invalid_wish");
    await bad({ p_wish_to: "2031-08-30" }, "invalid_wish");
    await bad({ p_duration: 10 }, "invalid_duration");
    await bad({ p_duration: 600 }, "invalid_duration");
    await bad({ p_lat: 0, p_lng: 0 }, "position_outside_france");
    await bad({ p_lat: 48.8, p_lng: null }, "invalid_position");
    await bad({ p_precision: "parfaite" }, "invalid_position");
    await bad({ p_source: "inconnu" }, "invalid_position");
  });
  it("refuse : lead hors périmètre (view_own), lead d'une autre organisation, utilisateur sans permission RDV", async () => {
    const others = await lead({ created_by: users.conf!.id });
    expect((await users.pro!.client.rpc("create_pending_appointment", args(others))).error?.message).toContain("lead_not_found");
    expect((await users.ob!.client.rpc("create_pending_appointment", args(proLead))).error).not.toBeNull();
    expect((await users.conf!.client.rpc("create_pending_appointment", args(others))).error).toBeNull(); // confirmateur : voit tous les leads
  });
  it("sans position : accepté (le RDV ira dans « À vérifier »)", async () => {
    const l = await lead({ created_by: users.pro!.id });
    const r = await users.pro!.client.rpc("create_pending_appointment", args(l, { p_lat: null, p_lng: null, p_precision: null, p_score: null, p_source: null }));
    expect(r.error?.message).toBeUndefined();
    expect((await admin.from("appointments").select("lat, geo_precision").eq("id", r.data as string).single()).data).toMatchObject({ lat: null, geo_precision: null });
  });
  it("le télépro ne peut toujours pas créer ni attribuer lui-même un RDV sans commercial par REST", async () => {
    const l = await lead({ created_by: users.pro!.id });
    const r = await users.pro!.client.from("appointments").insert({ org_id: orgA, lead_id: l, assigned_to: null, starts_at: t(8), ends_at: t(9), created_by: users.pro!.id }).select("id");
    expect(r.error).not.toBeNull();
  });
});

// ------------------------------------------------------------------ HAUT 2
describe("simulation inoffensive (is_simulation)", () => {
  let simLead = "", simAppt = "", owner = "";
  beforeAll(async () => {
    owner = users.pro!.id;
    const s = await pending(P1, { is_simulation: true }, { is_simulation: true, company: "[SIMULATION]", assigned_to: owner });
    simLead = s.lead; simAppt = s.id;
  });
  it("invisible pour les clients : tables, vue leads_api, REST (confirmateur et commerciaux)", async () => {
    for (const who of ["conf", "c1", "pro"]) {
      expect((await users[who]!.client.from("appointments").select("id").eq("id", simAppt)).data, `${who} appointments`).toEqual([]);
      expect((await users[who]!.client.from("leads_api").select("id").eq("id", simLead)).data, `${who} leads_api`).toEqual([]);
      expect((await users[who]!.client.from("leads").select("id").eq("id", simLead)).data, `${who} leads`).toEqual([]);
    }
    expect((await admin.from("appointments").select("id").eq("id", simAppt)).data).toHaveLength(1); // le serveur la voit
  });
  it("aucun client ne peut poser ni retirer is_simulation", async () => {
    const real = (await pending()).id;
    const r = await users.conf!.client.from("appointments").update({ is_simulation: true }).eq("id", real).select("id");
    expect(r.error).not.toBeNull();
    expect((await admin.from("appointments").select("is_simulation").eq("id", real).single()).data!.is_simulation).toBe(false);
  });
  it("apply_dispatch sur la simulation : aucune notification, propriétaire du lead intact, résultat marqué simulation", async () => {
    const before = (await notifs(users.c1!.id, "dispatch:%")).length;
    const r = await call([item(simAppt, users.c1!.id, t(8, 0, 1), t(9, 0, 1))]);
    expect(r.error?.message).toBeUndefined();
    expect(r.data).toMatchObject({ applied: 1, simulation: true });
    expect((await notifs(users.c1!.id, "dispatch:%")).length).toBe(before);
    expect((await admin.from("leads").select("assigned_to").eq("id", simLead).single()).data!.assigned_to).toBe(owner);
    expect((await admin.from("appointments").select("dispatch_status, assigned_to, is_simulation").eq("id", simAppt).single()).data).toMatchObject({ dispatch_status: "assigned", assigned_to: users.c1!.id, is_simulation: true });
    // le RDV simulé attribué reste invisible de l'agenda du commercial
    expect((await users.c1!.client.from("appointments").select("id").eq("id", simAppt)).data).toEqual([]);
  });
  it("les actions du confirmateur sur un RDV simulé ne notifient personne", async () => {
    const n0 = (await admin.from("notifications").select("id").eq("user_id", users.c2!.id).eq("org_id", orgA)).data!.length;
    const e = await users.conf!.client.rpc("dispatcher_edit_appointment", { p_id: simAppt, p_user: users.c2!.id, p_start: t(8, 0, 1), p_end: t(9, 0, 1) });
    expect(e.error?.message).toBeUndefined();
    expect((await admin.from("notifications").select("id").eq("user_id", users.c2!.id).eq("org_id", orgA)).data!.length).toBe(n0);
  });
  it("un lot ne mélange pas simulation et vrais RDV", async () => {
    const s = await pending(P1, { is_simulation: true }, { is_simulation: true });
    const real = await pending(P2);
    const r = await call([item(s.id, users.c1!.id, t(8, 0, 2), t(9, 0, 2)), item(real.id, users.c2!.id, t(8, 0, 2), t(9, 0, 2))]);
    expect(r.error?.message).toContain("dispatch_simulation_mixed");
    expect((await admin.from("appointments").select("dispatch_status").eq("id", s.id).single()).data!.dispatch_status).toBe("unassigned");
  });
  it("un RDV simulé ne bloque pas le créneau d'un vrai RDV et n'est pas compté dans sa journée", async () => {
    const s = await pending(P1, { is_simulation: true }, { is_simulation: true });
    expect((await call([item(s.id, users.c1!.id, t(8, 0, 3), t(9, 0, 3))])).error).toBeNull();
    const real = await pending(P1);
    const r = await call([item(real.id, users.c1!.id, t(8, 0, 3), t(9, 0, 3))]);
    expect(r.error?.message).toBeUndefined(); // même créneau, même commercial : pas de chevauchement avec une simulation
    expect(r.data).toMatchObject({ applied: 1, simulation: false });
  });
  it("les tableaux de bord (dash_appt_counts, SECURITY DEFINER) ignorent les RDV simulés", async () => {
    const win = { p_org: orgA, p_from: "2031-09-01T00:00:00Z", p_to: "2031-10-01T00:00:00Z" };
    const total = async () => {
      const r = await users.conf!.client.rpc("dash_appt_counts", win);
      expect(r.error?.message).toBeUndefined();
      const x = (r.data as { planned: number; confirmed: number }[])[0]!;
      return Number(x.planned) + Number(x.confirmed);
    };
    const before = await total();
    const l = await lead({ is_simulation: true });
    await admin.from("appointments").insert({ org_id: orgA, lead_id: l, assigned_to: users.c1!.id, starts_at: "2031-09-10T08:00:00Z", ends_at: "2031-09-10T09:00:00Z", status: "confirmed", is_simulation: true });
    expect(await total()).toBe(before);
    const lr = await lead();
    await admin.from("appointments").insert({ org_id: orgA, lead_id: lr, assigned_to: users.c1!.id, starts_at: "2031-09-11T08:00:00Z", ends_at: "2031-09-11T09:00:00Z", status: "confirmed" });
    expect(await total()).toBe(before + 1);
  });
  it("suppression par is_simulation : un vrai lead nommé « [SIMULATION] » n'est pas supprimé", async () => {
    const fake = await lead({ company: "[SIMULATION]" });
    const gone = await admin.from("leads").delete().eq("org_id", orgA).eq("is_simulation", true).select("id");
    expect(gone.data!.some((x) => x.id === simLead)).toBe(true);
    expect(gone.data!.some((x) => x.id === fake)).toBe(false);
    expect((await admin.from("leads").select("id").eq("id", fake)).data).toHaveLength(1);
    expect((await admin.from("appointments").select("id").eq("id", simAppt)).data).toEqual([]); // le RDV simulé part avec son lead
  });
});

// ------------------------------------------------------------------ MOYEN 5
describe("apply_dispatch : p_allow_estimate n'existe plus", () => {
  it("un appel direct avec p_allow_estimate est rejeté ; sans trajet en cache le refus reste dispatch_route_unknown", async () => {
    const x = await pending(P1);
    const r = await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: [item(x.id, users.c1!.id, t(8, 0, 8), t(9, 0, 8))], p_allow_estimate: true });
    expect(r.error).not.toBeNull();
    expect((await admin.from("appointments").select("dispatch_status").eq("id", x.id).single()).data!.dispatch_status).toBe("unassigned");
    const far = await pending({ lat: 45.9, lng: 4.9 });
    expect((await call([item(far.id, users.c1!.id, t(8, 0, 8), t(9, 0, 8))])).error?.message).toContain("dispatch_route_unknown");
  });
});

// ------------------------------------------------------------------ MOYEN 6 + 8
describe("apply_dispatch rejoue souhait, passé, précision, durée et jours fériés", () => {
  it("hors de la fenêtre souhaitée => dispatch_outside_wish", async () => {
    const x = await pending(P1, { wish_from: "2031-06-10", wish_to: "2031-06-12" });
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 3), t(9, 0, 3))])).error?.message).toContain("dispatch_outside_wish"); // 13 juin
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 2), t(9, 0, 2))])).error).toBeNull(); // 12 juin : dans la fenêtre
  });
  it("aujourd'hui ou dans le passé => dispatch_past_slot", async () => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const x = await pending(P1, { wish_from: day(-2), wish_to: day(3) });
    const at = (n: number) => `${day(n)}T08:00:00Z`;
    const end = (n: number) => `${day(n)}T09:00:00Z`;
    expect((await call([item(x.id, users.c1!.id, at(-1), end(-1))])).error?.message).toContain("dispatch_past_slot");
    expect((await call([item(x.id, users.c1!.id, at(0), end(0))])).error?.message).toContain("dispatch_past_slot");
  });
  it("position approximative (commune) non acceptée => dispatch_geo_approximate ; acceptée => ok avec 20 min de marge", async () => {
    const x = await pending(P1, { geo_precision: "municipality", geo_accepted: false });
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 6), t(9, 0, 6))])).error?.message).toContain("dispatch_geo_approximate");
    await admin.from("appointments").update({ geo_accepted: true }).eq("id", x.id);
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 6), t(9, 20, 6))])).error).toBeNull(); // 60 + 20 min
  });
  it("durée différente de la demande => dispatch_bad_duration (trop courte, ou plus de 20 min de marge)", async () => {
    const x = await pending(P1);
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 7), t(8, 40, 7))])).error?.message).toContain("dispatch_bad_duration");
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 7), t(9, 30, 7))])).error?.message).toContain("dispatch_bad_duration");
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 7), t(9, 0, 7))])).error).toBeNull();
  });
  it("jour férié (Ascension 2031 = jeudi 22 mai) => dispatch_holiday ; le lendemain est accepté", async () => {
    const x = await pending(P1, { wish_from: "2031-05-22", wish_to: "2031-05-23" });
    const at = (d: number) => new Date(Date.UTC(2031, 4, 22 + d, 8, 0)).toISOString();
    const end = (d: number) => new Date(Date.UTC(2031, 4, 22 + d, 9, 0)).toISOString();
    expect((await call([item(x.id, users.c1!.id, at(0), end(0))])).error?.message).toContain("dispatch_holiday");
    expect((await call([item(x.id, users.c1!.id, at(1), end(1))])).error).toBeNull();
  });
  it("is_fr_holiday / fr_easter en base = calcul TypeScript (Pâques 2024-2040, 11 fériés de 2031)", async () => {
    for (let y = 2024; y <= 2040; y++) {
      const r = await users.conf!.client.rpc("fr_easter", { p_year: y });
      expect(r.data, String(y)).toBe(easterSunday(y));
    }
    const days = ["2031-01-01", "2031-04-14", "2031-05-01", "2031-05-08", "2031-05-22", "2031-06-02", "2031-07-14", "2031-08-15", "2031-11-01", "2031-11-11", "2031-12-25"];
    for (const d of days) expect((await users.conf!.client.rpc("is_fr_holiday", { p_day: d })).data, d).toBe(true);
    for (const d of ["2031-05-23", "2031-06-10", "2031-12-24", "2031-04-13"]) expect((await users.conf!.client.rpc("is_fr_holiday", { p_day: d })).data, d).toBe(false);
  });
});

// ------------------------------------------------------------------ MOYEN 7
describe("rééquilibrage : ancien commercial prévenu, propriétaire du lead tracé", () => {
  it("l'ancien propriétaire du lead est tracé (lead_events) et prévenu, jamais écrasé en silence", async () => {
    const x = await pending(P1, {}, { assigned_to: users.pro!.id, created_by: users.pro!.id });
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 8), t(9, 0, 8))])).error).toBeNull();
    expect((await admin.from("leads").select("assigned_to").eq("id", x.lead).single()).data!.assigned_to).toBe(users.c1!.id);
    const ev = await admin.from("lead_events").select("payload").eq("lead_id", x.lead).contains("payload", { action: "owner_changed", from: users.pro!.id, to: users.c1!.id });
    expect(ev.data).toHaveLength(1);
    const n = await admin.from("notifications").select("payload").eq("user_id", users.pro!.id).eq("org_id", orgA);
    expect(JSON.stringify(n.data)).toContain("confié à un autre commercial");
  });
  it("rééquilibrage c1 -> c2 : c1 reçoit la notification de retrait, c2 la nouvelle attribution", async () => {
    const x = await pending(P2);
    expect((await call([item(x.id, users.c1!.id, t(8, 0, 9), t(9, 0, 9))])).error).toBeNull();
    await admin.from("appointments").update({ needs_rebalance: true }).eq("id", x.id);
    const r = await call([item(x.id, users.c2!.id, t(8, 30, 9), t(9, 30, 9))]);
    expect(r.error?.message).toBeUndefined();
    expect(r.data).toMatchObject({ applied: 1 });
    expect((await admin.from("appointments").select("assigned_to").eq("id", x.id).single()).data!.assigned_to).toBe(users.c2!.id);
    const moved = await notifs(users.c1!.id, "dispatch-moved:%");
    expect(moved).toHaveLength(1);
    expect(JSON.stringify(moved)).toContain("retiré");
    expect((await notifs(users.c2!.id, "dispatch:%")).length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ BAS 10 / 11
describe("report_address_fix et dispatcher_swap contrôlés", () => {
  let id = "";
  beforeAll(async () => {
    const x = await pending(P1);
    id = x.id;
    expect((await call([item(id, users.c1!.id, t(8, 0, 10), t(9, 0, 10))])).error).toBeNull();
  });
  it("position hors de France refusée ; position valide acceptée ; RDV annulé refusé", async () => {
    expect((await users.c1!.client.rpc("report_address_fix", { p_id: id, p_lat: 0, p_lng: 0, p_message: "" })).error?.message).toContain("position_outside_france");
    expect((await users.c1!.client.rpc("report_address_fix", { p_id: id, p_lat: 45.76, p_lng: 4.84, p_message: "Entrée côté rue" })).error?.message).toBeUndefined();
    expect((await admin.from("appointments").select("needs_rebalance, geo_precision").eq("id", id).single()).data).toMatchObject({ needs_rebalance: true, geo_precision: "manual_coords" });
    await admin.from("appointments").update({ status: "cancelled" }).eq("id", id);
    expect((await users.c1!.client.rpc("report_address_fix", { p_id: id, p_lat: 45.76, p_lng: 4.84, p_message: "" })).error?.message).toContain("dispatch_bad_status");
  });
  it("dispatcher_swap refuse un RDV annulé", async () => {
    const other = await pending(P2);
    expect((await call([item(other.id, users.c1!.id, t(8, 30, 10), t(9, 30, 10))])).error).toBeNull();
    const sw = await users.conf!.client.rpc("dispatcher_swap", { p_a: id, p_b: other.id });
    expect(sw.error?.message).toContain("dispatch_bad_status");
  });
});
