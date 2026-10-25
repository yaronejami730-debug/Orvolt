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
let orgA = "", orgB = "";
const BASE = { lat: 45.7578, lng: 4.832 };
const P1 = { lat: 45.7597, lng: 4.8422 };
const P2 = { lat: 45.7719, lng: 4.8902 };
// 2031-06-10 = mardi ; heure d'été (UTC+2) : 10:00 local = 08:00Z
const t = (h: number, m = 0, d = 0) => new Date(Date.UTC(2031, 5, 10 + d, h, m)).toISOString();
const key = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
let seq = 0;
const leads: string[] = [];

async function makeUser(tag: string): Promise<U> {
  const email = `dp-${tag}-${run}@test.local`;
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
/** RDV confirmé « à attribuer » avec point GPS. */
async function pending(point = P1, extra: object = {}): Promise<string> {
  const l = (await admin.from("leads").insert({ org_id: orgA, status_id: statusA, first_name: "Cli", last_name: `Ent${++seq}` }).select("id").single()).data!.id as string;
  leads.push(l);
  const { data, error } = await admin.from("appointments").insert({
    org_id: orgA, lead_id: l, assigned_to: null, starts_at: null, ends_at: null, status: "confirmed", dispatch_status: "unassigned",
    wish_from: "2031-06-10", wish_to: "2031-06-30", duration_min: 60, lat: point.lat, lng: point.lng, location_address: "1 rue Test, Lyon", ...extra,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}
const item = (id: string, user: string, start: string, end: string) => ({ appointment_id: id, user_id: user, starts_at: start, ends_at: end });
let statusA = "";

beforeAll(async () => {
  const [owner, ob, conf, c1, c2, pro] = await Promise.all(["owner", "ob", "conf", "c1", "c2", "pro"].map(makeUser));
  orgA = (await owner!.client.rpc("create_organization", { p_name: `DP A ${run}`, p_template: "generic" })).data as string;
  orgB = (await ob!.client.rpc("create_organization", { p_name: `DP B ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(orgA, "generic");
  await admin.from("organizations").update({ seat_limit: 20 }).eq("id", orgA);
  await join(orgA, conf!, "Confirmateur");
  await join(orgA, c1!, "Commercial");
  await join(orgA, c2!, "Commercial");
  await join(orgA, pro!, "Prospecteur");
  statusA = (await admin.from("statuses").select("id").eq("org_id", orgA).eq("is_initial", true).single()).data!.id;
  for (const u of [c1!, c2!]) {
    const { error } = await admin.from("sales_zones").insert({ org_id: orgA, user_id: u.id, base_address: "Place Bellecour, Lyon", base_lat: BASE.lat, base_lng: BASE.lng, radius_km: 40, work_start: "09:00", work_end: "19:00", target_per_day: 2, comfort_max: 2, absolute_max: 3 });
    if (error) throw new Error(error.message);
  }
  // trajets routiers « réels » mémorisés (écrits par le serveur ; ici 10 min base->RDV, 12 min entre RDV)
  const rows = [[BASE, P1, 600, 5000], [BASE, P2, 900, 9000], [P1, P2, 720, 6000], [P2, P1, 720, 6000], [P1, BASE, 600, 5000], [P2, BASE, 900, 9000]] as const;
  await admin.from("routing_cache").upsert(rows.map(([a, b, s, m]) => ({ key: key(a, b), duration_s: s, distance_m: m, provider: "fake", expires_at: new Date(Date.now() + 86_400_000).toISOString() })));
});

afterAll(async () => {
  for (const id of [orgA, orgB]) await admin.from("organizations").delete().eq("id", id);
  await admin.from("routing_cache").delete().like("key", "45.7%");
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("permission dispatch.manage", () => {
  it("accordée au Confirmateur et à l'Administrateur ; pas au Commercial ni au Prospecteur", async () => {
    const { data } = await admin.from("roles").select("name, permissions, is_admin").eq("org_id", orgA);
    const has = (n: string) => data!.find((r) => r.name === n)!.permissions.includes("dispatch.manage");
    expect(has("Confirmateur")).toBe(true);
    expect(has("Administrateur")).toBe(true);
    expect(data!.find((r) => r.is_admin)).toBeTruthy(); // le super administrateur l'a via is_admin
    expect(has("Commercial")).toBe(false);
    expect(has("Prospecteur")).toBe(false);
  });
});

describe("apply_dispatch (rejoue la validation en base)", () => {
  it("refuse commercial, prospecteur et autre organisation", async () => {
    const id = await pending();
    for (const who of ["c1", "pro", "ob"]) {
      const r = await users[who]!.client.rpc("apply_dispatch", { p_org: orgA, p_items: [item(id, users.c1!.id, t(8), t(9))] });
      expect(r.error, who).not.toBeNull();
    }
    expect((await admin.from("appointments").select("dispatch_status").eq("id", id).single()).data!.dispatch_status).toBe("unassigned");
  });
  it("le confirmateur applique, idempotent, journalise et notifie", async () => {
    const id = await pending();
    const items = [item(id, users.c1!.id, t(8), t(9))];
    const r1 = await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: items });
    expect(r1.error?.message).toBeUndefined();
    expect(r1.data).toMatchObject({ applied: 1, skipped: 0 });
    const r2 = await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: items });
    expect(r2.data).toMatchObject({ applied: 0, skipped: 1 });
    const a = (await admin.from("appointments").select("dispatch_status, assigned_to, dispatched_at, locked_by_dispatcher").eq("id", id).single()).data!;
    expect(a).toMatchObject({ dispatch_status: "assigned", assigned_to: users.c1!.id, locked_by_dispatcher: false });
    expect(a.dispatched_at).not.toBeNull();
    const n = await admin.from("notifications").select("payload").eq("user_id", users.c1!.id).like("dedupe_key", "dispatch:%");
    expect(n.data!.length).toBeGreaterThan(0);
    const ev = await admin.from("lead_events").select("payload").eq("type", "appointment").contains("payload", { appointment_id: id, action: "dispatched" });
    expect(ev.data).toHaveLength(1);
  });
  it("refuse hors horaires, jour non travaillé, journée pleine, chevauchement, trajet impossible, indisponibilité", async () => {
    const c2 = users.c2!.id;
    const call = (items: object[]) => users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: items });
    const a = await pending(P1);
    expect((await call([item(a, c2, t(5), t(6))])).error?.message).toContain("dispatch_outside_hours"); // 07:00 local
    expect((await call([item(a, c2, t(8, 0, 4), t(9, 0, 4))])).error?.message).toContain("dispatch_not_workday"); // dimanche
    expect((await call([item(a, c2, t(7, 0), t(8, 0))])).error?.message).toContain("dispatch_travel_time"); // 09:00 local < 09:00 + trajet
    expect((await call([item(a, c2, t(8), t(9))])).error).toBeNull();
    const b = await pending(P2);
    expect((await call([item(b, c2, t(8, 30), t(9, 30))])).error?.message).toMatch(/appointments_no_overlap|exclusion|dispatch_travel_time/);
    expect((await call([item(b, c2, t(9, 0), t(10, 0))])).error?.message).toContain("dispatch_travel_time"); // 12 min + 10 min de marge requis
    const c = await pending(P2);
    // règle de charge : confort 2 pour ce commercial, le suivant doit être approuvé (« fifth »), maximum absolu 3
    expect((await call([item(b, c2, t(9, 30), t(10, 30)), item(c, c2, t(11, 30), t(12, 30))])).error?.message).toContain("dispatch_needs_approval");
    expect((await call([item(b, c2, t(9, 30), t(10, 30)), { ...item(c, c2, t(11, 30), t(12, 30)), fifth: true }])).error).toBeNull();
    const dd = await pending(P1);
    expect((await call([{ ...item(dd, c2, t(13, 30), t(14, 30)), fifth: true }])).error?.message).toContain("dispatch_day_full"); // maximum absolu 3 atteint
    const un = await pending(P2);
    await admin.from("sales_unavailability").insert({ org_id: orgA, user_id: users.c1!.id, day: "2031-06-11", start_min: 600, end_min: 720 });
    expect((await call([item(un, users.c1!.id, t(8, 30, 1), t(9, 30, 1))])).error?.message).toContain("dispatch_unavailable"); // 10:30-11:30 local
    expect((await call([item(un, users.c1!.id, t(10, 30, 1), t(11, 30, 1))])).error).toBeNull();
  });
  it("itinéraire inconnu => refus (pas d'estimation silencieuse)", async () => {
    const far = { lat: 45.9, lng: 4.9 };
    const id = await pending(far);
    const r = await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: [item(id, users.c1!.id, t(8, 0, 2), t(9, 0, 2))] });
    expect(r.error?.message).toContain("dispatch_route_unknown");
  });
  it("tout ou rien : une erreur annule tout le lot", async () => {
    const ok = await pending(P1);
    const bad = await pending(P2);
    const r = await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: [item(ok, users.c1!.id, t(8, 0, 3), t(9, 0, 3)), item(bad, users.c1!.id, t(8, 10, 3), t(9, 10, 3))] });
    expect(r.error).not.toBeNull();
    expect((await admin.from("appointments").select("dispatch_status").eq("id", ok).single()).data!.dispatch_status).toBe("unassigned");
  });
});

describe("dernier mot du confirmateur (verrou) et droits du commercial", () => {
  let id = "";
  beforeAll(async () => {
    id = await pending();
    const r = await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: [item(id, users.c1!.id, t(8, 0, 6), t(9, 0, 6))] });
    expect(r.error).toBeNull();
  });
  it("un commercial ne déplace ni ne réattribue un RDV réparti", async () => {
    const lid = (await admin.from("appointments").select("lead_id").eq("id", id).single()).data!.lead_id;
    await admin.from("leads").update({ assigned_to: users.c1!.id }).eq("id", lid); // le commercial voit le lead : RLS laisse passer, le déclencheur refuse
    const mv = await users.c1!.client.from("appointments").update({ starts_at: t(9, 0, 6), ends_at: t(10, 0, 6) }).eq("id", id).select("id");
    expect(mv.error?.message ?? "").toContain("dispatched_readonly");
    const re = await users.c1!.client.from("appointments").update({ assigned_to: users.c2!.id }).eq("id", id).select("id");
    expect(re.error).not.toBeNull();
    expect((await users.c2!.client.from("appointments").select("id").eq("id", id)).data).toEqual([]);
  });
  it("le confirmateur modifie un RDV déjà proposé : verrouillé, avec auteur", async () => {
    const e = await users.conf!.client.rpc("dispatcher_edit_appointment", { p_id: id, p_user: users.c2!.id, p_start: t(9, 0, 6), p_end: t(10, 0, 6) });
    expect(e.error?.message).toBeUndefined();
    const a = (await admin.from("appointments").select("assigned_to, locked_by_dispatcher, locked_by, locked_at").eq("id", id).single()).data!;
    expect(a).toMatchObject({ assigned_to: users.c2!.id, locked_by_dispatcher: true, locked_by: users.conf!.id });
    expect(a.locked_at).not.toBeNull();
    const notif = await admin.from("notifications").select("id").eq("user_id", users.c2!.id).eq("org_id", orgA);
    expect(notif.data!.length).toBeGreaterThan(0);
  });
  it("le moteur (service_role) ne peut pas écraser un RDV verrouillé ; le prospecteur et le commercial ne le déverrouillent pas", async () => {
    const w = await admin.from("appointments").update({ assigned_to: users.c1!.id }).eq("id", id);
    expect(w.error?.message ?? "").toContain("locked_by_dispatcher");
    const d = await admin.from("appointments").update({ dispatch_status: "unassigned", assigned_to: null, starts_at: null, ends_at: null }).eq("id", id);
    expect(d.error).not.toBeNull();
    for (const who of ["c2", "pro"]) expect((await users[who]!.client.rpc("dispatcher_set_lock", { p_id: id, p_locked: false })).error, who).not.toBeNull();
    expect((await admin.from("appointments").select("locked_by_dispatcher").eq("id", id).single()).data!.locked_by_dispatcher).toBe(true);
  });
  it("une relance d'apply_dispatch sur un RDV verrouillé ne le modifie pas", async () => {
    const r = await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: [item(id, users.c1!.id, t(8, 0, 6), t(9, 0, 6))] });
    expect(r.error?.message ?? "").toContain("locked_by_dispatcher");
    expect((await admin.from("appointments").select("assigned_to").eq("id", id).single()).data!.assigned_to).toBe(users.c2!.id);
  });
  it("échange, retrait et déverrouillage par le confirmateur uniquement", async () => {
    const other = await pending(P2);
    await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: [item(other, users.c1!.id, t(8, 30, 6), t(9, 30, 6))] });
    const sw = await users.conf!.client.rpc("dispatcher_swap", { p_a: id, p_b: other });
    expect(sw.error?.message).toBeUndefined();
    const x = (await admin.from("appointments").select("assigned_to, locked_by_dispatcher").in("id", [id, other])).data!;
    expect(x.every((r) => r.locked_by_dispatcher)).toBe(true);
    expect((await users.c2!.client.rpc("dispatcher_unassign", { p_id: id })).error).not.toBeNull();
    expect((await users.conf!.client.rpc("dispatcher_unassign", { p_id: id })).error).toBeNull();
    const back = (await admin.from("appointments").select("dispatch_status, locked_by_dispatcher, assigned_to").eq("id", id).single()).data!;
    expect(back).toMatchObject({ dispatch_status: "unassigned", locked_by_dispatcher: false, assigned_to: null });
    expect((await users.conf!.client.rpc("dispatcher_set_lock", { p_id: other, p_locked: false })).error).toBeNull();
  });
  it("« Signaler un problème » : seul le commercial concerné ; notifie les confirmateurs ; ne change pas la répartition", async () => {
    const rid = await pending();
    await users.conf!.client.rpc("apply_dispatch", { p_org: orgA, p_items: [item(rid, users.c1!.id, t(8, 0, 7), t(9, 0, 7))] });
    expect((await users.c2!.client.rpc("report_appointment_issue", { p_id: rid, p_message: "Adresse introuvable" })).error).not.toBeNull();
    expect((await users.c1!.client.rpc("report_appointment_issue", { p_id: rid, p_message: "ab" })).error).not.toBeNull();
    const ok = await users.c1!.client.rpc("report_appointment_issue", { p_id: rid, p_message: "Adresse introuvable sur place" });
    expect(ok.error?.message).toBeUndefined();
    const a = (await admin.from("appointments").select("assigned_to, dispatch_status, locked_by_dispatcher, issue_message").eq("id", rid).single()).data!;
    expect(a).toMatchObject({ assigned_to: users.c1!.id, dispatch_status: "assigned", locked_by_dispatcher: false, issue_message: "Adresse introuvable sur place" });
    const n = await admin.from("notifications").select("payload").eq("user_id", users.conf!.id).eq("org_id", orgA);
    expect(JSON.stringify(n.data)).toContain("Problème signalé");
  });
});

describe("réglages, indisponibilités et isolation", () => {
  it("réglages par commercial : confirmateur oui, commercial et autre org non, validation de la plage", async () => {
    const args = (u: string, extra: object = {}) => ({ p_org: orgA, p_user: u, p_start: "10:00", p_end: "20:00", p_days: [1, 2, 3], p_duration: 45, p_rate: 1.2, p_margin: 10, p_target: 3, p_comfort: 4, p_absolute: 5, ...extra });
    expect((await users.conf!.client.rpc("set_member_work_settings", args(users.c1!.id))).error).toBeNull();
    const z = (await admin.from("sales_zones").select("work_start, work_end, target_per_day, comfort_max, absolute_max, work_days, default_duration_min").eq("user_id", users.c1!.id).single()).data!;
    expect(z).toMatchObject({ work_start: "10:00:00", work_end: "20:00:00", target_per_day: 3, comfort_max: 4, absolute_max: 5, default_duration_min: 45 });
    expect((await users.c1!.client.rpc("set_member_work_settings", args(users.c1!.id, { p_target: 9 }))).error).not.toBeNull();
    expect((await users.ob!.client.rpc("set_member_work_settings", args(users.c1!.id))).error).not.toBeNull();
    expect((await users.conf!.client.rpc("set_member_work_settings", args(users.c1!.id, { p_end: "09:00" }))).error).not.toBeNull();
    expect((await users.conf!.client.rpc("set_member_work_settings", args(users.c1!.id, { p_absolute: 11 }))).error).not.toBeNull();
    await users.conf!.client.rpc("set_member_work_settings", args(users.c1!.id, { p_start: "09:00", p_end: "19:00", p_target: 2, p_comfort: 2, p_absolute: 3, p_days: [1, 2, 3, 4, 5], p_duration: 60 }));
  });
  it("un commercial ne peut pas modifier ses horaires par REST (colonnes protégées)", async () => {
    const r = await users.c1!.client.from("sales_zones").update({ target_per_day: 10, work_start: "05:00" }).eq("user_id", users.c1!.id).select("user_id");
    expect(r.error).not.toBeNull();
  });
  it("réglages d'organisation : confirmateur oui, commercial non, bornes validées, lecture isolée", async () => {
    const a = { p_org: orgA, p_max_leg_km: 50, p_horizon_days: 10, p_max_leg_min: 40, p_max_base_min: 80, p_morning: 1.3, p_evening: 1.5, p_safety: 15, p_target: 3, p_comfort: 4, p_absolute: 5, p_extra: 20 };
    expect((await users.conf!.client.rpc("set_dispatch_org_settings", a)).error).toBeNull();
    expect((await users.c1!.client.rpc("set_dispatch_org_settings", a)).error).not.toBeNull();
    expect((await users.conf!.client.rpc("set_dispatch_org_settings", { ...a, p_horizon_days: 31 })).error).not.toBeNull();
    expect((await users.conf!.client.rpc("set_dispatch_org_settings", { ...a, p_morning: 0.5 })).error).not.toBeNull();
    expect((await users.conf!.client.rpc("set_dispatch_org_settings", { ...a, p_comfort: 2 })).error).not.toBeNull(); // norme <= confort <= maximum
    expect((await users.conf!.client.from("dispatch_settings").select("max_leg_min, safety_margin_pct, target_per_day, max_extra_minutes").eq("org_id", orgA).single()).data).toMatchObject({ max_leg_min: 40, safety_margin_pct: 15, target_per_day: 3, max_extra_minutes: 20 });
    expect((await users.ob!.client.from("dispatch_settings").select("org_id").eq("org_id", orgA)).data).toEqual([]);
    expect((await users.c1!.client.from("dispatch_settings").select("org_id").eq("org_id", orgA)).data).toEqual([]);
  });
  it("indisponibilités : saisies par le confirmateur, lisibles par le commercial concerné seulement, isolées par organisation", async () => {
    const row = { org_id: orgA, user_id: users.c2!.id, day: "2031-06-20", start_min: null, end_min: null, reason: "Congé" };
    expect((await users.c2!.client.from("sales_unavailability").insert({ ...row, created_by: users.c2!.id })).error).not.toBeNull();
    expect((await users.pro!.client.from("sales_unavailability").insert({ ...row, created_by: users.pro!.id })).error).not.toBeNull();
    expect((await users.conf!.client.from("sales_unavailability").insert({ ...row, created_by: users.conf!.id })).error).toBeNull();
    expect(((await users.c2!.client.from("sales_unavailability").select("id").eq("day", "2031-06-20")).data ?? []).length).toBe(1);
    expect(((await users.c1!.client.from("sales_unavailability").select("id").eq("day", "2031-06-20")).data ?? []).length).toBe(0);
    expect((await users.ob!.client.from("sales_unavailability").select("id").eq("org_id", orgA)).data).toEqual([]);
    expect((await users.c2!.client.from("sales_unavailability").delete().eq("day", "2031-06-20").select("id")).data ?? []).toEqual([]);
  });
  it("le cache de trajets n'est lisible par aucun utilisateur connecté", async () => {
    expect((await users.conf!.client.from("routing_cache").select("key").limit(1)).error).not.toBeNull();
    expect((await users.conf!.client.rpc("route_leg", { lat1: 1, lng1: 1, lat2: 2, lng2: 2, p_allow_estimate: true })).error).not.toBeNull();
  });
  it("RDV à attribuer : jamais visibles d'une autre organisation ni d'un commercial", async () => {
    const id = await pending();
    expect((await users.ob!.client.from("appointments").select("id").eq("id", id)).data).toEqual([]);
    expect((await users.c1!.client.from("appointments").select("id").eq("id", id)).data).toEqual([]);
    expect((await users.conf!.client.from("appointments").select("id").eq("id", id)).data).toHaveLength(1);
    expect((await users.c1!.client.from("appointments").insert({ org_id: orgA, lead_id: leads[0], assigned_to: null, status: "confirmed" })).error).not.toBeNull();
  });
});
