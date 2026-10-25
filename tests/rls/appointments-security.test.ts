import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";
import { banResponseSchema, banGeocoder, nominatimGeocoder, nominatimResponseSchema } from "@/lib/geo/providers";
import { rangeSchema, appointmentInputSchema } from "@/lib/validation/appointments";

// QA2 S4 : rendez-vous, zones, cache de géocodage, géocodeur.
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
const lead: Record<string, string> = {};
const st: Record<string, string> = {};

async function makeUser(tag: string): Promise<U> {
  const email = `ap-${tag}-${run}@test.local`;
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
const at = (h: number, min = 0, day = 20) => new Date(Date.UTC(2031, 5, day, h, min)).toISOString();
let slot = 0;
function row(over: Record<string, unknown> = {}) {
  slot++;
  return { org_id: orgA, lead_id: lead.L1, assigned_to: users.own!.id, created_by: users.own!.id, starts_at: at(8 + (slot % 10), 0, 1 + Math.floor(slot / 10)), ends_at: at(9 + (slot % 10), 0, 1 + Math.floor(slot / 10)), ...over };
}
const adminAppt = async (over: Record<string, unknown> = {}) => {
  const r = await admin.from("appointments").insert(row(over)).select("id").single();
  if (r.error) throw r.error;
  return r.data.id as string;
};

beforeAll(async () => {
  const [a, b, conf, own, prosp] = await Promise.all(["a", "b", "conf", "own", "prosp"].map(makeUser));
  orgA = (await a!.client.rpc("create_organization", { p_name: `AP A ${run}`, p_template: "generic" })).data as string;
  orgB = (await b!.client.rpc("create_organization", { p_name: `AP B ${run}`, p_template: "generic" })).data as string;
  orgIds.push(orgA, orgB);
  await applyTemplate(orgA, "generic");
  await applyTemplate(orgB, "generic");
  await member(orgA, conf!, "Confirmateur");
  await member(orgA, own!, "Commercial");
  await member(orgA, prosp!, "Prospecteur");
  const mk = async (org: string, extra: object) => (await admin.from("leads").insert({ org_id: org, first_name: "L", last_name: "x", status_id: (await admin.from("statuses").select("id").eq("org_id", org).eq("is_initial", true).single()).data!.id, ...extra }).select("id").single()).data!.id as string;
  lead.L1 = await mk(orgA, { assigned_to: own!.id, created_by: a!.id });
  lead.L2 = await mk(orgA, { created_by: a!.id }); // invisible pour own / prosp
  lead.LB = await mk(orgB, { created_by: b!.id });
  void st;
});
afterAll(async () => {
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("isolation A/B", () => {
  it("A ne lit, modifie, supprime ni n'insère rien chez B (appointments, sales_zones)", async () => {
    const bId = await adminAppt({ org_id: orgB, lead_id: lead.LB, assigned_to: users.b!.id, created_by: users.b!.id });
    await admin.from("sales_zones").insert({ org_id: orgB, user_id: users.b!.id, base_address: "Paris", base_lat: 48.8, base_lng: 2.3, radius_km: 20 });
    const a = users.a!.client;
    expect((await a.from("appointments").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await a.from("sales_zones").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await a.from("appointments").update({ notes: "hack" }).eq("id", bId).select()).data ?? []).toEqual([]);
    expect((await a.from("appointments").delete().eq("id", bId).select()).data ?? []).toEqual([]);
    expect((await a.from("sales_zones").delete().eq("org_id", orgB).select()).data ?? []).toEqual([]);
    expect((await a.from("appointments").insert({ ...row({ org_id: orgB, lead_id: lead.LB, assigned_to: users.b!.id, created_by: users.a!.id }) })).error).not.toBeNull();
    expect((await a.from("sales_zones").insert({ org_id: orgB, user_id: users.a!.id, base_address: "Paris", base_lat: 1, base_lng: 1, radius_km: 20 })).error).not.toBeNull();
    // FK cross-org : lead de B dans org A, assigné de B dans org A
    expect((await a.from("appointments").insert(row({ lead_id: lead.LB, assigned_to: users.a!.id, created_by: users.a!.id }))).error).not.toBeNull();
    expect((await a.from("appointments").insert(row({ assigned_to: users.b!.id, created_by: users.a!.id }))).error).not.toBeNull();
    // déplacement d'org_id
    const mine = await adminAppt({ assigned_to: users.a!.id, created_by: users.a!.id });
    expect((await a.from("appointments").update({ org_id: orgB }).eq("id", mine).select()).error).not.toBeNull();
    expect((await a.from("sales_zones").update({ org_id: orgB }).eq("user_id", users.b!.id).select()).data ?? []).toEqual([]);
  });
  it("geocode_cache : illisible et non écrivable par tout client (même admin), anon compris", async () => {
    await admin.from("geocode_cache").upsert({ key: "a".repeat(64), lat: 1, lng: 1, label: "x", provider: "t", found: true, expires_at: new Date(Date.now() + 1e6).toISOString() });
    for (const c of [users.a!.client, users.own!.client, createClient(URL, ANON, opts)]) {
      expect((await c.from("geocode_cache").select("*")).error).not.toBeNull();
      expect((await c.from("geocode_cache").insert({ key: "b".repeat(64), provider: "x", expires_at: new Date().toISOString() })).error).not.toBeNull();
      expect((await c.from("geocode_cache").update({ lat: 9 }).eq("key", "a".repeat(64)).select()).error).not.toBeNull();
      expect((await c.from("geocode_cache").delete().eq("key", "a".repeat(64)).select()).error).not.toBeNull();
    }
    await admin.from("geocode_cache").delete().eq("key", "a".repeat(64));
  });
});

describe("manage_own vs manage_all et visibilité du lead", () => {
  it("manage_own : crée pour soi seulement ; jamais pour autrui, ni avec created_by forgé", async () => {
    const o = users.own!.client;
    expect((await o.from("appointments").insert(row({ assigned_to: users.prosp!.id }))).error).not.toBeNull();
    expect((await o.from("appointments").insert(row({ created_by: users.prosp!.id }))).error).not.toBeNull();
    expect((await o.from("appointments").insert(row())).error).toBeNull();
  });
  it("lead non visible (view_own) : création refusée, RDV existant illisible/non modifiable", async () => {
    const p = users.own!.client;
    expect((await p.from("appointments").insert(row({ lead_id: lead.L2 }))).error).not.toBeNull();
    const hidden = await adminAppt({ lead_id: lead.L2 });
    expect((await p.from("appointments").select("id").eq("id", hidden)).data).toEqual([]);
    expect((await p.from("appointments").update({ notes: "x" }).eq("id", hidden).select()).data ?? []).toEqual([]);
    expect((await p.from("appointments").select("id").eq("lead_id", lead.L2)).data).toEqual([]);
    // la lecture via la fiche (embed lead) ne révèle rien non plus
    expect((await p.from("lead_events").select("id").eq("lead_id", lead.L2)).data).toEqual([]);
  });
  it("manage_own : ne voit/modifie/annule/réassigne pas les RDV d'un autre ; ne peut les attribuer à autrui", async () => {
    const other = await adminAppt({ assigned_to: users.prosp!.id, created_by: users.a!.id });
    const o = users.own!.client;
    expect((await o.from("appointments").select("id").eq("id", other)).data).toEqual([]);
    expect((await o.from("appointments").update({ status: "cancelled" }).eq("id", other).select()).data ?? []).toEqual([]);
    expect((await o.from("appointments").delete().eq("id", other).select()).data ?? []).toEqual([]);
    const mine = await adminAppt();
    expect((await o.from("appointments").update({ assigned_to: users.prosp!.id }).eq("id", mine).select()).error).not.toBeNull(); // sortie vers autrui
    expect((await o.from("appointments").update({ assigned_to: users.own!.id }).eq("id", other).select()).data ?? []).toEqual([]); // vol
    expect((await admin.from("appointments").select("assigned_to").eq("id", mine).single()).data!.assigned_to).toBe(users.own!.id);
    expect((await admin.from("appointments").select("status").eq("id", other).single()).data!.status).toBe("planned");
  });
  it("manage_all voit et gère toute l'org (lead visible), mais pas hors org", async () => {
    const c = users.conf!.client;
    const mine = await adminAppt();
    expect((await c.from("appointments").select("id").eq("id", mine)).data).toHaveLength(1);
    expect((await c.from("appointments").update({ notes: "ok" }).eq("id", mine).select()).data).toHaveLength(1);
    expect((await c.from("appointments").update({ assigned_to: users.prosp!.id }).eq("id", mine).select()).error).toBeNull();
    expect((await c.from("appointments").update({ assigned_to: users.b!.id }).eq("id", mine).select()).error).not.toBeNull();
    expect((await c.from("appointments").insert(row({ assigned_to: users.b!.id, created_by: users.conf!.id }))).error).not.toBeNull();
  });
  it("membre désactivé : plus d'accès, assignation à un désactivé refusée", async () => {
    const u = await makeUser("off");
    await member(orgA, u, "Commercial");
    await admin.from("memberships").update({ status: "disabled" }).eq("user_id", u.id);
    expect((await u.client.from("appointments").select("id")).data ?? []).toEqual([]);
    expect((await users.conf!.client.from("appointments").insert(row({ assigned_to: u.id, created_by: users.conf!.id }))).error).not.toBeNull();
  });
});

describe("chevauchement", () => {
  const base = () => ({ day: 25 + (++slot % 4), h: 8 });
  it("refusé en INSERT, UPDATE, ré-activation d'un annulé ; limites semi-ouvertes ; fuseaux", async () => {
    const o = users.own!.client;
    const day = 3 + (slot % 5) + 10;
    const mk = (s: string, e: string, status = "planned") => o.from("appointments").insert(row({ starts_at: s, ends_at: e, status })).select("id");
    const A = await mk(at(10, 0, day), at(11, 0, day));
    expect(A.error).toBeNull();
    expect((await mk(at(10, 30, day), at(11, 30, day))).error?.code).toBe("23P01");
    expect((await mk(at(9, 0, day), at(10, 0, day) )).error).toBeNull(); // contigu avant : autorisé
    expect((await mk(at(11, 0, day), at(12, 0, day))).error).toBeNull(); // contigu après : autorisé
    expect((await mk("2031-06-" + String(day).padStart(2, "0") + "T10:59:59.999Z", at(12, 0, day))).error?.code).toBe("23P01"); // 1 ms de chevauchement
    // même instant exprimé dans un autre fuseau
    expect((await mk(`2031-06-${String(day).padStart(2, "0")}T13:00:00+03:00`, `2031-06-${String(day).padStart(2, "0")}T14:00:00+03:00`)).error?.code).toBe("23P01");
    // UPDATE vers un créneau occupé
    const B = await mk(at(15, 0, day), at(16, 0, day));
    expect((await o.from("appointments").update({ starts_at: at(10, 15, day), ends_at: at(10, 45, day) }).eq("id", B.data![0]!.id).select()).error?.code).toBe("23P01");
    // annulé -> planifié sur créneau repris
    const C = await mk(at(18, 0, day), at(19, 0, day), "cancelled");
    expect(C.error).toBeNull();
    expect((await mk(at(18, 0, day), at(19, 0, day))).error).toBeNull(); // un annulé libère le créneau
    expect((await o.from("appointments").update({ status: "planned" }).eq("id", C.data![0]!.id).select()).error?.code).toBe("23P01");
    // autre commercial : aucun conflit croisé
    expect((await users.conf!.client.from("appointments").insert(row({ assigned_to: users.prosp!.id, created_by: users.conf!.id, starts_at: at(10, 0, day), ends_at: at(11, 0, day) }))).error).toBeNull();
    void base;
  });
  it("durée bornée (ends > starts, <= 12 h) ; durée minimale de 5 min imposée", async () => {
    const o = users.own!.client;
    expect((await o.from("appointments").insert(row({ starts_at: at(10, 0, 9), ends_at: at(10, 0, 9) }))).error).not.toBeNull();
    expect((await o.from("appointments").insert(row({ starts_at: at(1, 0, 9), ends_at: at(15, 0, 9) }))).error).not.toBeNull();
    expect((await o.from("appointments").insert(row({ starts_at: "2031-07-01T10:00:00.000Z", ends_at: "2031-07-01T10:00:00.001Z" })).select("id")).error).not.toBeNull(); // 1 ms refusé
    expect((await o.from("appointments").insert(row({ starts_at: "2031-07-01T10:00:00.000Z", ends_at: "2031-07-01T10:04:00.000Z" })).select("id")).error).not.toBeNull(); // 4 min refusé
    expect((await o.from("appointments").insert(row({ starts_at: "2031-07-01T10:00:00.000Z", ends_at: "2031-07-01T10:05:00.000Z" })).select("id")).error).toBeNull(); // 5 min accepté
  });
});

describe("dérogation de distance et champs calculés", () => {
  it("dérogation : les clients ne peuvent écrire ni override, ni distance, ni coordonnées ; le serveur (service_role) oui", async () => {
    const o = users.own!.client;
    for (const extra of [
      { distance_override: true, override_reason: "client VIP", distance_status: "over_radius" },
      { override_by: users.a!.id }, { distance_status: "ok" }, { distance_km: 0 }, { lat: 45.7, lng: 4.8 },
    ]) {
      expect((await o.from("appointments").insert(row(extra))).error, JSON.stringify(extra)).not.toBeNull();
    }
    const r = await o.from("appointments").insert(row({})).select("id, distance_status, distance_override");
    expect(r.error).toBeNull();
    expect(r.data![0]).toMatchObject({ distance_status: "no_zone", distance_override: false }); // « non vérifié » par défaut
    const id = r.data![0]!.id;
    for (const patch of [{ distance_status: "ok" }, { distance_override: true, override_reason: "x" }, { override_by: users.a!.id }, { distance_km: 1 }, { lat: 1 }])
      expect((await users.conf!.client.from("appointments").update(patch).eq("id", id)).error, JSON.stringify(patch)).not.toBeNull();
    // serveur : écriture des champs de contrôle, tracée
    expect((await admin.from("appointments").update({ distance_status: "over_radius", distance_km: 80, distance_override: true, override_reason: "client VIP", override_by: users.own!.id }).eq("id", id)).error).toBeNull();
    const ev = await users.a!.client.from("lead_events").select("payload").eq("lead_id", lead.L1).eq("type", "appointment");
    expect(JSON.stringify(ev.data)).toContain("client VIP");
    expect((await users.a!.client.from("lead_events").delete().eq("lead_id", lead.L1).eq("type", "appointment").select()).error).not.toBeNull();
    // un client qui change le lieu invalide le contrôle précédent (retour à « non vérifié »)
    expect((await users.own!.client.from("appointments").update({ location_address: "Ailleurs, Lyon" }).eq("id", id)).error).toBeNull();
    expect((await admin.from("appointments").select("distance_status, distance_override, override_by, lat").eq("id", id).single()).data).toEqual({ distance_status: "no_zone", distance_override: false, override_by: null, lat: null });
  });
  // FAILLE CONNUE (majeur conditionnel) : distance_status / distance_km / lat / lng sont écrits par le client ;
  // le contrôle de rayon n'est effectué que dans la server action. Un commercial peut planifier hors zone sans
  // motif ni trace en forçant distance_status='ok' en REST.
  it("un client ne peut pas déclarer lui-même distance_status='ok' / distance_km / lat / lng", async () => {
    await admin.from("sales_zones").upsert({ org_id: orgA, user_id: users.own!.id, base_address: "Paris", base_lat: 48.85, base_lng: 2.35, radius_km: 5 }, { onConflict: "org_id,user_id" });
    const r = await users.own!.client.from("appointments").insert(row({ lat: 45.76, lng: 4.83, distance_km: 0, distance_status: "ok", location_address: "Lyon" })).select("id");
    expect(r.error).not.toBeNull();
  });
  it("zones : lecture limitée (soi, members.manage, manage_all) ; écriture pour autrui réservée à members.manage", async () => {
    await admin.from("sales_zones").upsert({ org_id: orgA, user_id: users.prosp!.id, base_address: "Domicile secret 12 rue X", base_lat: 48, base_lng: 2, radius_km: 20 }, { onConflict: "org_id,user_id" });
    expect((await users.own!.client.from("sales_zones").select("base_address").eq("user_id", users.prosp!.id)).data).toEqual([]);
    expect((await users.own!.client.from("sales_zones").upsert({ org_id: orgA, user_id: users.prosp!.id, base_address: "Hack", base_lat: 1, base_lng: 1, radius_km: 200 }, { onConflict: "org_id,user_id" })).error).not.toBeNull();
    expect((await users.own!.client.from("sales_zones").update({ user_id: users.a!.id }).eq("user_id", users.own!.id).select()).error).not.toBeNull();
    expect((await users.own!.client.from("sales_zones").insert({ org_id: orgA, user_id: users.own!.id, base_address: "ab", base_lat: 1, base_lng: 1, radius_km: 20 })).error).not.toBeNull();
    expect((await users.own!.client.from("sales_zones").insert({ org_id: orgA, user_id: users.own!.id, base_address: "Lyon centre", base_lat: 95, base_lng: 1, radius_km: 20 })).error).not.toBeNull();
    expect((await users.own!.client.from("sales_zones").insert({ org_id: orgA, user_id: users.own!.id, base_address: "Lyon centre", base_lat: 45, base_lng: 1, radius_km: 500 })).error).not.toBeNull();
    expect((await users.conf!.client.from("sales_zones").select("id").eq("user_id", users.prosp!.id)).data).toHaveLength(1); // manage_all
  });
  it("notifications : aucun client ne peut en forger (RDV compris)", async () => {
    expect((await users.conf!.client.from("notifications").insert({ org_id: orgA, user_id: users.own!.id, type: "appointment", payload: {} })).error).not.toBeNull();
  });
  it("texte hostile (adresse, notes, motif) stocké comme donnée ; tailles bornées par la base", async () => {
    const xss = `<img src=x onerror=alert(1)>`;
    const ok = await users.own!.client.from("appointments").insert(row({ location_address: xss, notes: xss })).select("location_address");
    expect(ok.data![0]!.location_address).toBe(xss);
    expect((await users.own!.client.from("appointments").insert(row({ location_address: "x".repeat(301) }))).error).not.toBeNull();
    expect((await users.own!.client.from("appointments").insert(row({ notes: "x".repeat(2001) }))).error).not.toBeNull();
    expect((await users.own!.client.from("appointments").insert(row({ distance_status: "pwn" }))).error).not.toBeNull();
    expect((await users.own!.client.from("appointments").insert(row({ status: "pwn" }))).error).not.toBeNull();
  });
  it("suppression d'un RDV : journalisée dans l'historique", async () => {
    const id = await adminAppt();
    const before = (await admin.from("lead_events").select("id", { count: "exact", head: true }).eq("lead_id", lead.L1)).count!;
    await users.own!.client.from("appointments").delete().eq("id", id);
    const after = (await admin.from("lead_events").select("id", { count: "exact", head: true }).eq("lead_id", lead.L1)).count!;
    expect(after).toBe(before + 1);
    const last = (await admin.from("lead_events").select("payload").eq("lead_id", lead.L1).eq("type", "appointment").order("created_at", { ascending: false }).limit(1).single()).data!;
    expect(last.payload.action).toBe("deleted");
  });
});

describe("géocodage : hôtes fixes, validation des réponses, abus", () => {
  const geo = readFileSync(path.resolve(__dirname, "../../src/lib/geo/geocode.ts"), "utf8");
  const prov = readFileSync(path.resolve(__dirname, "../../src/lib/geo/providers.ts"), "utf8");
  it("appels sortants : safeFetch uniquement (https, IP épinglée, maxBytes), jamais fetch brut ni URL venant du client", () => {
    expect(geo).toMatch(/safeFetch\(url/);
    expect(geo).toMatch(/maxBytes: 200_000/);
    expect(geo).not.toMatch(/[^.\w]fetch\(/);
    const urls = [...prov.matchAll(/`(https:\/\/[^`]+)`/g)].map((m) => m[1]!);
    const banUrls = [...prov.matchAll(/"(https:\/\/[^"]+)"/g)].map((m) => m[1]!); // BAN_URLS : constantes fixes (Géoplateforme + ancienne API)
    expect([...urls, ...banUrls].map((u) => new globalThis.URL(u.replace(/\$\{[^}]+\}/g, "x")).hostname).sort()).toEqual(["api-adresse.data.gouv.fr", "data.geopf.fr", "nominatim.openstreetmap.org"]);
    for (const u of urls) expect(u.match(/\$\{/g)!.length, u).toBe(1); // une seule interpolation : encodeURIComponent(query)
    
  });
  it("l'adresse est encodée : aucune injection de paramètre (&limit, #, CRLF, //host)", async () => {
    const seen: string[] = [];
    const f = async (u: string) => { seen.push(u); return { status: 200, body: JSON.stringify({ features: [] }) }; };
    await banGeocoder(f).geocode("rue x&limit=1000&autocomplete=1#frag\r\nHost: evil.com");
    await nominatimGeocoder(async (u) => { seen.push(u); return { status: 200, body: "[]" }; }).geocode("a&countrycodes=us&format=xml//evil.com/../");
    for (const u of seen) {
      const url = new globalThis.URL(u);
      expect(["api-adresse.data.gouv.fr", "data.geopf.fr", "nominatim.openstreetmap.org"]).toContain(url.hostname);
      expect(url.hash).toBe("");
      expect(u).not.toMatch(/[\r\n ]/);
      expect(url.searchParams.getAll("limit").length).toBeLessThanOrEqual(1);
    }
    expect(new globalThis.URL(seen[0]!).searchParams.get("limit")).toBe("1");
    expect(new globalThis.URL(seen[1]!).searchParams.get("countrycodes")).toBe("fr");
  });
  it("réponses non fiables : coordonnées hors bornes, NaN, types inattendus, label géant => rejetées", async () => {
    const bad = [
      { features: [{ geometry: { coordinates: [200, 10] }, properties: { label: "x" } }] },
      { features: [{ geometry: { coordinates: [2, 99] }, properties: { label: "x" } }] },
      { features: [{ geometry: { coordinates: ["2", "48"] }, properties: { label: "x" } }] },
      { features: [{ geometry: { coordinates: [2, 48] }, properties: { label: "x".repeat(301) } }] },
      { features: "evil" }, [], null,
    ];
    for (const b of bad) expect(banResponseSchema.safeParse(b).success, JSON.stringify(b).slice(0, 50)).toBe(false);
    for (const b of [[{ lat: "999", lon: "2", display_name: "x" }], [{ lat: "abc", lon: "2", display_name: "x" }], [{ lat: "1", lon: "2", display_name: "x".repeat(501) }], { lat: 1 }])
      expect(nominatimResponseSchema.safeParse(b).success).toBe(false);
    await expect(banGeocoder(async () => ({ status: 200, body: "<html>pas du json" })).geocode("x y z")).rejects.toThrow();
    await expect(banGeocoder(async () => ({ status: 200, body: JSON.stringify({ features: [{ geometry: { coordinates: [200, 10] }, properties: { label: "x" } }] }) })).geocode("x y z")).rejects.toThrow();
    await expect(nominatimGeocoder(async () => ({ status: 500 })).geocode("x y z")).rejects.toThrow();
  });
  it("clé de cache : hash sha256 de l'adresse normalisée (pas de collision de casse/accents, pas d'écriture client)", async () => {
    vi_noop();
    const { addressKey } = await import("@/lib/geo/geocode");
    expect(addressKey("12 Rue de l'Église, Paris")).toBe(addressKey("12  rue DE L EGLISE paris"));
    expect(addressKey("12 rue A")).not.toBe(addressKey("13 rue A"));
    expect(addressKey("x y z")).toHaveLength(64);
  });
  it("validation Zod des actions agenda : plage <= 45 jours, durée 15-480, dates ISO, uuid", () => {
    const iso = (d: number) => new Date(Date.UTC(2031, 0, 1) + d * 86_400_000).toISOString();
    expect(rangeSchema.safeParse({ from: iso(0), to: iso(45) }).success).toBe(true);
    expect(rangeSchema.safeParse({ from: iso(0), to: iso(46) }).success).toBe(false);
    expect(rangeSchema.safeParse({ from: iso(0), to: iso(400) }).success).toBe(false);
    expect(rangeSchema.safeParse({ from: "hier", to: iso(1) }).success).toBe(false);
    expect(rangeSchema.safeParse({ from: iso(0), to: iso(1), userIds: Array(51).fill(crypto.randomUUID()) }).success).toBe(false);
    const ok = { leadId: crypto.randomUUID(), assignedTo: crypto.randomUUID(), startsAt: iso(1), durationMin: 30 };
    expect(appointmentInputSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ durationMin: 14 }, { durationMin: 481 }, { durationMin: 30.5 }, { location: "ab" }, { location: "x".repeat(301) }, { notes: "x".repeat(2001) }, { overrideReason: "ab" }, { startsAt: "2031-01-01" }])
      expect(appointmentInputSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });
  it("revue statique des actions agenda : permission serveur + rate limit, calcul serveur de la distance, org de session", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/app/(app)/agenda/actions.ts"), "utf8");
    expect((src.match(/guardAny\(\[\.\.\.PERMS\]/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(src).not.toMatch(/\bp\.data\.(lat|lng|distance\w*)\b|\bd\.(lat|lng)\b/); // jamais lu depuis l'entrée client
    expect(src).toMatch(/checkDistance\(/);
  });
  it("mock géocodeur : garde-fou production présent", () => {
    expect(geo).toMatch(/GEOCODER === "mock"/);
    // corrigé : interdit en production hors banc d'essai e2e déclaré
    expect(geo).toMatch(/NODE_ENV === "production"/);
    expect(geo).toMatch(/E2E_ALLOW_MOCK_GEOCODER/);
  });
});
function vi_noop() {}

// ---- Re-check S4 : colonnes de contrôle réservées au serveur, repli « non vérifié », mock, timeout, journal.
describe("re-check S4 : colonnes de distance non écrivables, repli, service_role, mock, timeout", () => {
  const CTRL: [string, unknown][] = [
    ["lat", 45.7], ["lng", 4.8], ["distance_km", 0], ["distance_status", "ok"], ["distance_override", true],
    ["override_reason", "motif forcé"], ["override_by", "00000000-0000-0000-0000-000000000001"],
  ];
  it("INSERT et UPDATE REST : chaque colonne de contrôle est refusée (permission denied), y compris pour un admin d'org", async () => {
    for (const [col, val] of CTRL) {
      for (const who of ["own", "a"] as const) {
        const ins = await users[who]!.client.from("appointments").insert(row({ assigned_to: users[who]!.id, created_by: users[who]!.id, [col]: val }));
        expect(ins.error, `insert ${col} ${who}`).not.toBeNull();
        const id = await adminAppt({ assigned_to: users[who]!.id, created_by: users[who]!.id });
        const up = await users[who]!.client.from("appointments").update({ [col]: val }).eq("id", id).select();
        expect(up.error, `update ${col} ${who}`).not.toBeNull();
      }
    }
  });
  it("colonnes structurelles toujours refusées en UPDATE client : org_id, lead_id, created_by, id, created_at, updated_at", async () => {
    const id = await adminAppt();
    for (const patch of [{ org_id: orgB }, { lead_id: lead.L2 }, { created_by: users.a!.id }, { id: crypto.randomUUID() }, { created_at: "2000-01-01T00:00:00Z" }])
      expect((await users.own!.client.from("appointments").update(patch).eq("id", id).select()).error, JSON.stringify(patch)).not.toBeNull();
  });
  it("repli « non vérifié » : changer lieu ou commercial en REST efface coordonnées, distance et dérogation", async () => {
    const id = await adminAppt({ location_address: "Lyon", lat: 45.7, lng: 4.8, distance_km: 3, distance_status: "ok" });
    const over = await adminAppt({ location_address: "Marseille", lat: 43.3, lng: 5.4, distance_km: 90, distance_status: "over_radius", distance_override: true, override_reason: "client VIP", override_by: users.own!.id });
    const o = users.own!.client;
    expect((await o.from("appointments").update({ notes: "n" }).eq("id", id).select()).error).toBeNull();
    expect((await admin.from("appointments").select("distance_status, lat").eq("id", id).single()).data).toMatchObject({ distance_status: "ok", lat: 45.7 }); // inchangé
    expect((await o.from("appointments").update({ location_address: "Paris" }).eq("id", id).select()).error).toBeNull();
    expect((await admin.from("appointments").select("lat, lng, distance_km, distance_status, distance_override").eq("id", id).single()).data).toEqual({ lat: null, lng: null, distance_km: null, distance_status: "no_zone", distance_override: false });
    expect((await o.from("appointments").update({ location_address: "Brest" }).eq("id", over).select()).error).toBeNull();
    expect((await admin.from("appointments").select("distance_override, override_reason, override_by, distance_status").eq("id", over).single()).data).toEqual({ distance_override: false, override_reason: null, override_by: null, distance_status: "no_zone" });
    // changement de commercial par un manage_all
    const id2 = await adminAppt({ location_address: "Lyon", lat: 45.7, lng: 4.8, distance_km: 3, distance_status: "ok" });
    expect((await users.conf!.client.from("appointments").update({ assigned_to: users.prosp!.id }).eq("id", id2).select()).error).toBeNull();
    expect((await admin.from("appointments").select("distance_status, lat").eq("id", id2).single()).data).toEqual({ distance_status: "no_zone", lat: null });
    // une insertion REST ne peut jamais produire « ok » : valeur par défaut
    const ins = await o.from("appointments").insert(row({ location_address: "Lille" })).select("distance_status, lat, distance_override");
    expect(ins.data![0]).toEqual({ distance_status: "no_zone", lat: null, distance_override: false });
  });
  it("durée minimale 5 min (CHECK)", async () => {
    expect((await users.own!.client.from("appointments").insert(row({ starts_at: at(4, 0, 27), ends_at: at(4, 4, 27) }))).error).not.toBeNull();
    expect((await users.own!.client.from("appointments").insert(row({ starts_at: at(4, 0, 27), ends_at: at(4, 5, 27) }))).error).toBeNull();
    const id = await adminAppt();
    expect((await users.own!.client.from("appointments").update({ ends_at: new Date(Date.parse((await admin.from("appointments").select("starts_at").eq("id", id).single()).data!.starts_at) + 1000).toISOString() }).eq("id", id).select()).error).not.toBeNull();
  });
  it("suppression journalisée dans l'historique (append-only), sauf cascade ; le journal reste invisible aux autres orgs", async () => {
    const id = await adminAppt();
    const before = (await admin.from("lead_events").select("id", { count: "exact", head: true }).eq("lead_id", lead.L1)).count!;
    expect((await users.own!.client.from("appointments").delete().eq("id", id).select()).data).toHaveLength(1);
    const ev = (await admin.from("lead_events").select("payload, actor_id").eq("lead_id", lead.L1).eq("type", "appointment").order("created_at", { ascending: false }).limit(1)).data![0]!;
    expect(ev.payload).toMatchObject({ action: "deleted", appointment_id: id });
    expect(ev.actor_id).toBe(users.own!.id);
    expect((await admin.from("lead_events").select("id", { count: "exact", head: true }).eq("lead_id", lead.L1)).count).toBe(before + 1);
    expect((await users.b!.client.from("lead_events").select("id").eq("lead_id", lead.L1)).data).toEqual([]);
    expect((await users.own!.client.from("lead_events").delete().eq("lead_id", lead.L1).select()).error).not.toBeNull();
  });
  it("action serveur : permissions et appartenance vérifiées via le client authentifié AVANT toute écriture service_role, org de session, champs fixes", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/app/(app)/agenda/actions.ts"), "utf8");
    const fnBody = (name: string) => src.slice(src.indexOf(`export async function ${name}`)).split(/\nexport async function /)[0]!;
    for (const fn of ["createAppointmentAction", "updateAppointmentAction"]) {
      const b = fnBody(fn);
      expect(b.indexOf("guardAny("), fn).toBeGreaterThanOrEqual(0);
      expect(b.indexOf("guardAny("), fn).toBeLessThan(b.indexOf("assertScope("));
      expect(b.indexOf("assertScope("), fn).toBeLessThan(b.indexOf("writeDistance("));
      // l'écriture client (RLS) précède et conditionne l'écriture service_role
      expect(b.indexOf(".from(\"appointments\")"), fn).toBeLessThan(b.indexOf("writeDistance("));
      expect(b.indexOf("if (error"), fn).toBeLessThan(b.indexOf("writeDistance("));
    }
    expect(fnBody("updateAppointmentAction")).toMatch(/\.eq\("org_id", s\.org\.id\)\.select\("id"\)/);
    expect(fnBody("updateAppointmentAction")).toMatch(/if \(!data\?\.length\) return/);
    const wd = src.slice(src.indexOf("async function writeDistance"), src.indexOf("function mapApptError"));
    expect(wd).toMatch(/\.eq\("id", id\)\s*\.eq\("org_id", s\.org\.id\)/);
    expect(wd).not.toMatch(/\.\.\.\w*(input|data|d)\b/); // pas de mass-assignment : champs listés un par un
    // les seuls usages de service_role de l'agenda : notification, writeDistance, recalcul de zone (org de session)
    expect((src.match(/createAdminClient\(\)/g) ?? []).length + (src.match(/const admin = createAdminClient/g) ?? []).length).toBeLessThanOrEqual(4);
  });
  it("IDOR sur appointment_id d'une autre org : la RLS bloque l'étape client, donc writeDistance n'est jamais atteinte", async () => {
    const bAppt = await adminAppt({ org_id: orgB, lead_id: lead.LB, assigned_to: users.b!.id, created_by: users.b!.id });
    const up = await users.a!.client.from("appointments").update({ notes: "x", location_address: "Hack" }).eq("id", bAppt).eq("org_id", orgA).select("id");
    expect(up.data ?? []).toEqual([]);
    const up2 = await users.a!.client.from("appointments").update({ notes: "x" }).eq("id", bAppt).select("id");
    expect(up2.data ?? []).toEqual([]);
    expect((await admin.from("appointments").select("notes, location_address").eq("id", bAppt).single()).data).toMatchObject({ notes: null });
    const mine = await adminAppt({ assigned_to: users.prosp!.id, created_by: users.conf!.id });
    expect((await users.own!.client.from("appointments").update({ assigned_to: users.own!.id }).eq("id", mine).select()).data ?? []).toEqual([]); // vol refusé
  });
});

describe("re-check S4 : mock en production et délai de safeFetch", () => {
  it("GEOCODER=mock : refusé en production, autorisé hors production ou avec le drapeau e2e explicite", async () => {
    const { activeGeocoders } = await import("@/lib/geo/geocode");
    const env = process.env as Record<string, string | undefined>;
    const prev = { g: env.GEOCODER, n: env.NODE_ENV, e: env.E2E_ALLOW_MOCK_GEOCODER };
    try {
      env.GEOCODER = "mock";
      env.NODE_ENV = "production";
      delete env.E2E_ALLOW_MOCK_GEOCODER;
      expect(() => activeGeocoders()).toThrow(/interdit en production/);
      env.E2E_ALLOW_MOCK_GEOCODER = "true"; // seule la valeur "1" débloque
      expect(() => activeGeocoders()).toThrow();
      env.E2E_ALLOW_MOCK_GEOCODER = "1";
      expect(activeGeocoders()[0]!.name).toBe("mock");
      env.NODE_ENV = "test";
      delete env.E2E_ALLOW_MOCK_GEOCODER;
      expect(activeGeocoders()[0]!.name).toBe("mock");
      env.GEOCODER = "ban";
      env.NODE_ENV = "production";
      expect(activeGeocoders().map((g) => g.name)).toEqual(["ban", "nominatim"]);
    } finally {
      for (const [k, v] of [["GEOCODER", prev.g], ["NODE_ENV", prev.n], ["E2E_ALLOW_MOCK_GEOCODER", prev.e]] as const) {
        if (v === undefined) delete env[k]; else env[k] = v;
      }
    }
  });
  it("le drapeau E2E_ALLOW_MOCK_GEOCODER n'existe que dans geocode.ts et la config Playwright (ni .env*, ni next.config, ni CI de prod)", () => {
    const root = path.resolve(__dirname, "../..");
    const files = ["next.config.ts", ".env.example", ".env.local", "vercel.json", "package.json", "src/lib/geo/geocode.ts", "playwright.config.ts"];
    const withFlag = files.filter((f) => { try { return readFileSync(path.join(root, f), "utf8").includes("E2E_ALLOW_MOCK_GEOCODER"); } catch { return false; } });
    expect(withFlag.sort()).toEqual(["playwright.config.ts", "src/lib/geo/geocode.ts"]);
    for (const f of [".env.example", ".env.local"]) {
      try { expect(readFileSync(path.join(root, f), "utf8")).not.toMatch(/^\s*GEOCODER\s*=\s*mock/m); } catch (e) { if ((e as { code?: string }).code !== "ENOENT") throw e; }
    }
  });
  it("safeFetch : délai total (réponse qui goutte-à-goutte) => rejet dans le délai, sans attendre", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));
    vi.doMock("node:https", () => ({
      request: (_o: unknown, cb: (r: unknown) => void) => {
        const handlers: Record<string, (e?: Error) => void> = {};
        const timers: ReturnType<typeof setInterval>[] = [];
        const res = { statusCode: 200, on: (e: string, h: (c?: Buffer) => void) => { if (e === "data") timers.push(setInterval(() => h(Buffer.from("x")), 20)); return res; }, destroy: () => timers.forEach(clearInterval) };
        const req = { on: (e: string, h: (e?: Error) => void) => { handlers[e] = h; return req; }, end: () => cb(res), destroy: (err?: Error) => { timers.forEach(clearInterval); handlers.error?.(err); } };
        return req;
      },
    }));
    const { safeFetch } = await import("@/lib/net/safe-fetch");
    const t0 = Date.now();
    await expect(safeFetch("https://slow.example.com/", { method: "GET", timeoutMs: 300, maxBytes: 200_000 })).rejects.toThrow(/timeout/);
    expect(Date.now() - t0).toBeLessThan(2000);
    vi.doUnmock("node:https");
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });
});
