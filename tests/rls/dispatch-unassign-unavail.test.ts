import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";

// Régressions du scénario multi-rôles en direct (J) :
//  - « Retirer » un RDV attribué conserve sa position GPS ;
//  - une indisponibilité signale « à rééquilibrer » les RDV déjà répartis de ce commercial (jour, et créneau si partiel), sauf RDV verrouillé.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let org = "", status = "", seq = 0;
// 2031-06-10 = mardi, heure d'été (UTC+2) : 10:00 local = 08:00Z
const t = (h: number, m = 0, d = 0) => new Date(Date.UTC(2031, 5, 10 + d, h, m)).toISOString();

async function makeUser(tag: string): Promise<U> {
  const email = `un-${tag}-${run}@test.local`;
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
/** RDV déjà réparti (service role) chez c1, avec position GPS. */
async function assigned(startH: number, extra: object = {}): Promise<string> {
  const l = (await admin.from("leads").insert({ org_id: org, status_id: status, first_name: "Cli", last_name: `Un${++seq}` }).select("id").single()).data!.id;
  const { data, error } = await admin.from("appointments").insert({
    org_id: org, lead_id: l, assigned_to: users.c1!.id, starts_at: t(startH), ends_at: t(startH + 1), status: "confirmed", dispatch_status: "assigned", dispatched_at: new Date().toISOString(),
    wish_from: "2031-06-10", wish_to: "2031-06-12", duration_min: 60, lat: 45.7597, lng: 4.8422, geo_precision: "housenumber", location_address: "1 rue Test, Lyon", ...extra,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}
const flag = async (id: string) => (await admin.from("appointments").select("needs_rebalance").eq("id", id).single()).data!.needs_rebalance as boolean;

beforeAll(async () => {
  const [owner, conf, c1] = await Promise.all(["owner", "conf", "c1"].map(makeUser));
  org = (await owner!.client.rpc("create_organization", { p_name: `UN ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(org, "generic");
  await admin.from("organizations").update({ seat_limit: 20 }).eq("id", org);
  await join(conf!, "Confirmateur");
  await join(c1!, "Commercial");
  status = (await admin.from("statuses").select("id").eq("org_id", org).eq("is_initial", true).single()).data!.id;
});
afterAll(async () => {
  await admin.from("organizations").delete().eq("id", org);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("dispatcher_unassign", () => {
  it("le RDV retiré repasse à attribuer en gardant sa position GPS (jamais « Pas de position GPS »)", async () => {
    const id = await assigned(8);
    const r = await users.conf!.client.rpc("dispatcher_unassign", { p_id: id });
    expect(r.error).toBeNull();
    const a = (await admin.from("appointments").select("assigned_to, starts_at, dispatch_status, status, lat, lng, geo_precision").eq("id", id).single()).data!;
    expect(a).toMatchObject({ assigned_to: null, starts_at: null, dispatch_status: "unassigned", status: "confirmed", lat: 45.7597, lng: 4.8422, geo_precision: "housenumber" });
  });
});

describe("indisponibilité d'un commercial déjà réparti", () => {
  const add = (day: string, extra: object = {}) => users.conf!.client.from("sales_unavailability").insert({ org_id: org, user_id: users.c1!.id, day, ...extra });
  it("journée entière : le RDV du jour est signalé à rééquilibrer, pas celui d'un autre jour", async () => {
    const same = await assigned(8);
    const other = await assigned(8, { starts_at: t(8, 0, 1), ends_at: t(9, 0, 1) });
    expect((await add("2031-06-10")).error).toBeNull();
    expect(await flag(same)).toBe(true);
    expect(await flag(other)).toBe(false);
  });
  it("créneau partiel : seul le RDV qui chevauche est signalé ; un RDV verrouillé ne l'est jamais", async () => {
    const day = 2; // 2031-06-12
    const inside = await assigned(8, { starts_at: t(8, 0, day), ends_at: t(9, 0, day) }); // 10:00-11:00 local
    const outside = await assigned(14, { starts_at: t(14, 0, day), ends_at: t(15, 0, day) }); // 16:00-17:00 local
    const locked = await assigned(9, { starts_at: t(9, 0, day), ends_at: t(10, 0, day), locked_by_dispatcher: true }); // 11:00-12:00 local
    expect((await add("2031-06-12", { start_min: 10 * 60 + 30, end_min: 12 * 60 })).error).toBeNull();
    expect(await flag(inside)).toBe(true);
    expect(await flag(outside)).toBe(false);
    expect(await flag(locked)).toBe(false);
  });
});
