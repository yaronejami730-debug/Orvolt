"use server";

import { revalidatePath } from "next/cache";
import { dashboardCache } from "@/lib/dashboard/cache";
import { z } from "zod";
import { guardAny, mapDbError, type ActionResult } from "@/lib/action-guard";
import { DEFAULT_WORK, applySchema, orgSettingsSchema, workSettingsSchema } from "@/lib/dispatch/settings";
import { buildPlan, cacheLegs, truncationWarnings, type PlanBundle, type RoutingInfo, type ToCheck } from "@/lib/dispatch/server";
import { guardClientPoint } from "@/lib/dispatch/point-guard";
import { editAppointmentSchema, unavailabilitySchema } from "@/lib/dispatch/settings";
import { addDays, localDay, isoWeekday, zonedToUtc } from "@/lib/dispatch/time";
import type { DispatchResult } from "@/lib/dispatch/types";
import { haversineKm } from "@/lib/geo/haversine";
import { activeGeocoders, geocodeAddress } from "@/lib/geo/geocode";
import { resolveManualAddress, type GeoPoint } from "@/lib/geo/resolve";
import { parseCoordinates, plausibleInFrance } from "@/lib/geo/coords";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sessionCan } from "@/lib/session";
import { fieldErrors, firstError } from "@/lib/validation/auth";

const invalid = <T = undefined>(e: z.ZodError): ActionResult<T> => ({ ok: false, error: firstError(e), fieldErrors: fieldErrors(e) });
const DISPATCH = ["dispatch.manage"] as const;

export interface PreviewData {
  plan: DispatchResult;
  planHash: string;
  days: string[];
  maxLegKm: number;
  reps: { id: string; name: string; baseAddress: string; base: { lat: number; lng: number }; radiusKm: number; targetPerDay: number; comfortMax: number; absoluteMax: number; workStartMin: number; workEndMin: number }[];
  requests: Record<string, { label: string; address: string | null; wishFrom: string; wishTo: string; durationMin: number }>;
  pendingCount: number;
  routing: RoutingInfo;
  toCheck: ToCheck[];
  mode: "dispatch" | "rebalance";
  /** RDV au-delà du confort proposés (jamais automatiques) et journées surchargées par des RDV déjà posés. */
  proposed: DispatchResult["proposed"];
  warnings: DispatchResult["warnings"];
  maxExtraMin: number;
  /** Rééquilibrage : qui change de commercial / d'heure (avant -> après). */
  diff: { id: string; label: string; from: { rep: string; day: string; start: number; end: number } | null; to: { rep: string; day: string; start: number; end: number } | null; changed: boolean }[];
  traffic: { morningCoef: number; eveningCoef: number; safetyPct: number };
  maxLegMin: number;
  maxBaseMin: number;
  /** Limites de chargement atteintes (RDV à attribuer, RDV existants, indisponibilités) : jamais silencieuses. */
  truncations: string[];
  /** Vue simulation : données fictives, aucun commercial notifié. */
  simulation: boolean;
}

function toPreview(b: PlanBundle, mode: "dispatch" | "rebalance"): PreviewData {
  const name = (id: string) => b.ctx.reps.find((r) => r.id === id)?.name ?? "—";
  const diff: PreviewData["diff"] = mode === "rebalance" ? b.rows.filter((p) => p.status === "confirmed").map((p) => {
    const a = b.result.assignments.find((x) => x.requestId === p.id);
    const from = p.current ? { rep: name(p.current.repId), day: p.current.day, start: p.current.startMin, end: p.current.endMin } : null;
    const to = a ? { rep: name(a.repId), day: a.day, start: a.startMin, end: a.endMin } : null;
    return { id: p.id, label: p.lead_name, from, to, changed: !from || !to || from.rep !== to.rep || from.day !== to.day || from.start !== to.start };
  }) : [];
  return {
    mode, diff, proposed: b.result.proposed, warnings: b.result.warnings, maxExtraMin: b.ctx.orgSettings.maxExtraMin,
    plan: b.result, planHash: b.planHash, days: b.ctx.days, maxLegKm: b.ctx.orgSettings.maxLegKm,
    reps: b.ctx.reps.map((r) => ({ id: r.id, name: r.name, baseAddress: r.baseAddress, base: r.base, radiusKm: r.radiusKm, targetPerDay: r.targetPerDay, comfortMax: r.comfortMax, absoluteMax: r.absoluteMax, workStartMin: r.workStartMin, workEndMin: r.workEndMin })),
    requests: Object.fromEntries(b.ctx.pending.map((p) => [p.id, { label: p.lead_name, address: p.address, wishFrom: p.wishFrom, wishTo: p.wishTo, durationMin: p.durationMin }])),
    truncations: truncationWarnings(b.ctx.truncated), simulation: b.ctx.simulation,
    pendingCount: b.requests.length, routing: b.routing, toCheck: b.toCheck, maxLegMin: b.ctx.orgSettings.maxLegMin, maxBaseMin: b.ctx.orgSettings.maxBaseMin,
    traffic: { morningCoef: b.ctx.orgSettings.morningCoef, eveningCoef: b.ctx.orgSettings.eveningCoef, safetyPct: b.ctx.orgSettings.safetyPct },
  };
}

/** Calcule la répartition sans rien écrire. */
export async function previewDispatchAction(input?: unknown): Promise<ActionResult<PreviewData>> {
  const g = await guardAny([...DISPATCH], "dispatch-preview");
  if ("error" in g) return { ok: false, error: g.error };
  const opts = z.object({ rebalance: z.boolean().optional(), simulation: z.boolean().optional() }).safeParse(input ?? {}).data;
  const rebalance = opts?.rebalance === true;
  const simulation = opts?.simulation === true;
  // Vue simulation : les lignes is_simulation sont masquées aux clients (RLS), lecture serveur après contrôle de la permission.
  const b = await buildPlan(simulation ? createAdminClient() : await createClient(), g.s.org.id, { rebalance, simulation });
  if (b.ctx.reps.length === 0) return { ok: false, code: "no_reps", error: "Aucun commercial avec une zone active : définissez une zone dans Réglages > Membres." };
  if (b.requests.length === 0 && b.toCheck.length === 0) return { ok: false, code: "nothing", error: "Aucun RDV confirmé à attribuer." };
  if (b.requests.length === 0) return { ok: false, code: "to_check", error: `${b.toCheck.length} RDV à vérifier avant répartition : corrigez leur position (section « À vérifier ») puis relancez.` };
  return { ok: true, data: toPreview(b, rebalance ? "rebalance" : "dispatch") };
}

const fifth0 = (b: PlanBundle, ids?: string[]) => b.result.proposed.filter((a) => (ids ?? []).includes(a.requestId)).length;
const RPC_ERRORS: [string, string][] = [
  ["dispatch_needs_approval", "Un RDV au-delà du confort n'a pas été approuvé : relancez l'aperçu."],
  ["appointments_no_overlap", "Un des commerciaux a déjà un RDV sur ce créneau : relancez l'aperçu."],
  ["dispatch_day_full", "Une journée est devenue pleine : relancez l'aperçu."],
  ["dispatch_leg_too_long", "Un trajet dépasse la limite : relancez l'aperçu."],
  ["dispatch_travel_time", "Temps de trajet insuffisant entre deux RDV : relancez l'aperçu."],
  ["dispatch_outside_hours", "Un créneau sort des horaires du commercial : relancez l'aperçu."],
  ["dispatch_not_workday", "Un créneau tombe un jour non travaillé : relancez l'aperçu."],
  ["dispatch_out_of_zone", "Un RDV est hors zone du commercial : relancez l'aperçu."],
  ["dispatch_already_assigned", "Un RDV vient d'être attribué par quelqu'un d'autre : relancez l'aperçu."],
  ["dispatch_not_confirmed", "Un RDV n'est plus confirmé : relancez l'aperçu."],
  ["dispatch_invalid_rep", "Un commercial n'est plus actif : relancez l'aperçu."],
  ["dispatch_no_zone", "Un commercial n'a plus de zone active : relancez l'aperçu."],
  ["dispatch_no_geocode", "Un RDV n'a pas de coordonnées : relancez l'aperçu."],
  ["dispatch_route_unknown", "Itinéraire inconnu : relancez l'aperçu."],
  ["dispatch_unavailable", "Un commercial est indisponible sur un créneau : relancez l'aperçu."],
  ["dispatch_past_slot", "Un créneau est aujourd'hui ou dans le passé : relancez l'aperçu."],
  ["dispatch_holiday", "Un créneau tombe un jour férié : relancez l'aperçu."],
  ["dispatch_outside_wish", "Un créneau sort des jours souhaités : relancez l'aperçu."],
  ["dispatch_bad_duration", "La durée d'un créneau ne correspond plus à la demande : relancez l'aperçu."],
  ["dispatch_geo_approximate", "Une position approximative n'a pas été acceptée : corrigez-la ou acceptez-la puis relancez l'aperçu."],
  ["dispatch_simulation_mixed", "Un lot ne peut pas mélanger simulation et RDV réels : relancez l'aperçu."],
  ["dispatch_bad_status", "Un des RDV n'est plus actif (annulé ou terminé) : relancez l'aperçu."],
  ["locked_by_dispatcher", "Ce RDV est verrouillé par le confirmateur : déverrouillez-le d'abord."],
  ["forbidden", "Permission insuffisante."],
];

/** Applique la proposition : recalculée côté serveur, comparée à l'aperçu validé, puis écrite atomiquement par apply_dispatch. */
export async function applyDispatchAction(input: unknown): Promise<ActionResult<{ applied: number; skipped: number; unassigned: number }>> {
  const g = await guardAny([...DISPATCH], "dispatch-apply");
  if ("error" in g) return { ok: false, error: g.error };
  const p = applySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { s } = g;
  const supabase = await createClient();
  const simulation = p.data.simulation === true;
  const b = await buildPlan(simulation ? createAdminClient() : supabase, s.org.id, { rebalance: p.data.rebalance === true, simulation });
  if (b.planHash !== p.data.planHash) {
    return { ok: false, code: "stale", error: "La situation a changé depuis l'aperçu : relancez la répartition pour voir la nouvelle proposition." };
  }
  if (b.routing.estimated) {
    return { ok: false, code: "estimate", error: "Itinéraires routiers indisponibles : la proposition n'est qu'une estimation et ne peut pas être validée automatiquement. Démarrez le service de routage (npm run routing:up) puis relancez." };
  }
  if (b.result.assignments.length + fifth0(b, p.data.includeFifth) === 0) return { ok: false, error: "Rien à attribuer." };
  await cacheLegs(b.provider, b.usedLegs);
  const chosen = new Set(p.data.includeFifth ?? []);
  const fifth = b.result.proposed.filter((a) => chosen.has(a.requestId));
  if (chosen.size !== fifth.length) return { ok: false, code: "stale", error: "Un RDV au-delà du confort sélectionné n'est plus proposé : relancez la répartition." };
  const items = [...b.result.assignments.map((a) => ({ a, fifth: false })), ...fifth.map((a) => ({ a, fifth: true }))].map(({ a, fifth: f }) => ({
    appointment_id: a.requestId, user_id: a.repId, fifth: f,
    starts_at: zonedToUtc(a.day, a.startMin).toISOString(), ends_at: zonedToUtc(a.day, a.endMin).toISOString(),
  }));
  const { data, error } = await supabase.rpc("apply_dispatch", { p_org: s.org.id, p_items: items });
  if (error) {
    const hit = RPC_ERRORS.find(([k]) => error.message.includes(k) || error.code === "23P01" && k === "appointments_no_overlap");
    return { ok: false, code: "rejected", error: hit?.[1] ?? mapDbError(error.message, "Répartition impossible. Relancez l'aperçu.") };
  }
  dashboardCache.clear();
  revalidatePath("/agenda");
  revalidatePath("/agenda/repartition");
  const r = data as { applied: number; skipped: number };
  return { ok: true, data: { applied: r.applied, skipped: r.skipped, unassigned: b.result.unassigned.length + b.result.proposed.length - fifth.length } };
}

export async function saveWorkSettingsAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny(["dispatch.manage", "members.manage"], "dispatch-settings");
  if ("error" in g) return { ok: false, error: g.error };
  const p = workSettingsSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const d = p.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_work_settings", {
    p_org: g.s.org.id, p_user: d.userId, p_start: d.workStart, p_end: d.workEnd, p_target: d.targetPerDay, p_comfort: d.comfortMax, p_absolute: d.absoluteMax, p_days: [...new Set(d.workDays)].sort(),
    p_duration: d.durationMin, p_rate: d.travelMinPerKm, p_margin: d.travelMarginMin,
  });
  if (error) {
    if (error.message.includes("zone_required")) return { ok: false, error: "Définissez d'abord la zone d'intervention de ce membre." };
    return { ok: false, error: mapDbError(error.message, "Enregistrement impossible.") };
  }
  revalidatePath("/settings/members");
  revalidatePath("/agenda/repartition");
  return { ok: true };
}

export async function saveOrgSettingsAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny(["dispatch.manage", "settings.manage"], "dispatch-settings");
  if ("error" in g) return { ok: false, error: g.error };
  const p = orgSettingsSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const d = p.data;
  const { error } = await supabase.rpc("set_dispatch_org_settings", {
    p_org: g.s.org.id, p_max_leg_km: d.maxLegKm, p_horizon_days: d.horizonDays, p_max_leg_min: d.maxLegMin, p_max_base_min: d.maxBaseMin,
    p_morning: d.morningCoef, p_evening: d.eveningCoef, p_safety: d.safetyPct, p_target: d.targetPerDay, p_comfort: d.comfortMax, p_absolute: d.absoluteMax, p_extra: d.maxExtraMin,
  });
  if (error) return { ok: false, error: mapDbError(error.message, "Enregistrement impossible.") };
  revalidatePath("/settings/members");
  revalidatePath("/agenda/repartition");
  return { ok: true };
}

/** Confirme un RDV à attribuer (le confirmateur valide, le moteur peut alors le répartir). */
export async function confirmPendingAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...DISPATCH], "dispatch-confirm");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("appointments").update({ status: "confirmed" }).eq("id", p.data.id).eq("org_id", g.s.org.id).eq("dispatch_status", "unassigned").eq("status", "planned").select("id");
  if (error || !data?.length) return { ok: false, error: "Confirmation refusée." };
  revalidatePath("/agenda/repartition");
  return { ok: true };
}

// ------------------------------------------------------------------ dernier mot du confirmateur (verrouillé)
const dbErr = (m: string): string => RPC_ERRORS.find(([k]) => m.includes(k))?.[1]
  ?? (m.includes("appointments_no_overlap") || m.includes("23P01") ? "Ce commercial a déjà un RDV sur ce créneau." : m.includes("dispatch_invalid_rep") ? "Ce commercial n'est pas actif." : m.includes("dispatch_bad") ? "Opération impossible sur ce RDV." : mapDbError(m, "Opération impossible."));
const done = (): ActionResult => { revalidatePath("/agenda/repartition"); revalidatePath("/agenda"); dashboardCache.clear(); return { ok: true }; };

/** Change le commercial et/ou l'heure : décision verrouillée (le moteur ne la défait jamais). */
export async function editDispatchedAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...DISPATCH], "dispatch-edit");
  if ("error" in g) return { ok: false, error: g.error };
  const p = editAppointmentSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const d = p.data;
  const [h, m] = d.start.split(":").map(Number) as [number, number];
  const start = zonedToUtc(d.day, h * 60 + m);
  const supabase = await createClient();
  const { error } = await supabase.rpc("dispatcher_edit_appointment", { p_id: d.id, p_user: d.userId, p_start: start.toISOString(), p_end: new Date(start.getTime() + d.durationMin * 60_000).toISOString() });
  return error ? { ok: false, error: dbErr(error.message) } : done();
}
export async function swapDispatchedAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...DISPATCH], "dispatch-edit");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ a: z.uuid(), b: z.uuid() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("dispatcher_swap", { p_a: p.data.a, p_b: p.data.b });
  return error ? { ok: false, error: dbErr(error.message) } : done();
}
export async function unassignDispatchedAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...DISPATCH], "dispatch-edit");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("dispatcher_unassign", { p_id: p.data.id });
  return error ? { ok: false, error: dbErr(error.message) } : done();
}
export async function setLockAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...DISPATCH], "dispatch-edit");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid(), locked: z.boolean() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("dispatcher_set_lock", { p_id: p.data.id, p_locked: p.data.locked });
  return error ? { ok: false, error: dbErr(error.message) } : done();
}

/** Le commercial signale un problème sur son RDV : notifie les confirmateurs, sans effet sur la répartition. */
export async function reportIssueAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny(["appointments.manage_own", "appointments.manage_all"], "dispatch-issue");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid(), message: z.string().trim().min(3, "Message trop court.").max(500, "500 caractères maximum.") }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("report_appointment_issue", { p_id: p.data.id, p_message: p.data.message });
  if (error) return { ok: false, error: error.message.includes("forbidden") ? "Vous ne pouvez signaler un problème que sur vos propres RDV." : mapDbError(error.message, "Envoi impossible.") };
  revalidatePath("/agenda");
  return { ok: true };
}

// ------------------------------------------------------------------ indisponibilités (saisies par le confirmateur / admin)
export async function addUnavailabilityAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny(["dispatch.manage", "members.manage"], "dispatch-unavail");
  if ("error" in g) return { ok: false, error: g.error };
  const p = unavailabilitySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const d = p.data;
  const tm = (t: string) => { const [h, m] = t.split(":").map(Number) as [number, number]; return h * 60 + m; };
  const { error } = await (await createClient()).from("sales_unavailability").insert({
    org_id: g.s.org.id, user_id: d.userId, day: d.day, start_min: d.allDay ? null : tm(d.start!), end_min: d.allDay ? null : tm(d.end!), reason: d.reason || null, created_by: g.s.user.id,
  });
  if (error) return { ok: false, error: mapDbError(error.message, "Enregistrement impossible.") };
  return done();
}
export async function deleteUnavailabilityAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny(["dispatch.manage", "members.manage"], "dispatch-unavail");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).from("sales_unavailability").delete().eq("id", p.data.id).eq("org_id", g.s.org.id);
  return error ? { ok: false, error: mapDbError(error.message) } : done();
}

// ------------------------------------------------------------------ correction de position (RDV « à vérifier »)
const PRECISIONS = ["housenumber", "street", "locality", "municipality", "manual_pin", "manual_coords"] as const;
const fixSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("suggestion"), id: z.uuid(), label: z.string().trim().min(3).max(300), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), precision: z.enum(PRECISIONS), score: z.number().min(0).max(1).optional(), insee: z.string().max(5).nullable().optional() }),
  z.object({ mode: z.literal("manual_address"), id: z.uuid(), address: z.string().trim().min(3, "Adresse trop courte.").max(300), postcode: z.string().regex(/^\d{5}$/, "Code postal à 5 chiffres."), city: z.string().trim().min(2, "Commune obligatoire.").max(100) }),
  z.object({ mode: z.enum(["pin", "coords"]), id: z.uuid(), lat: z.number().min(-90, "Latitude invalide.").max(90, "Latitude invalide."), lng: z.number().min(-180, "Longitude invalide.").max(180, "Longitude invalide.") }),
  z.object({ mode: z.literal("gps"), id: z.uuid(), text: z.string().trim().min(1, "Collez les coordonnées.").max(500) }),
  z.object({ mode: z.literal("accept"), id: z.uuid() }),
]);

/** Le confirmateur corrige la position d'un RDV à attribuer ; la correction est journalisée sur le lead. */
export async function fixLocationAction(input: unknown): Promise<ActionResult<{ precision: string | null; warnings?: string[] }>> {
  // Le confirmateur corrige tout ; le télépro (créateur du RDV) peut fournir une position tant que le RDV n'est pas attribué.
  const g = await guardAny([...DISPATCH, "appointments.manage_own", "appointments.manage_all"], "dispatch-fix");
  if ("error" in g) return { ok: false, error: g.error };
  const p = fixSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const d = p.data;
  const { s } = g;
  const dispatcher = sessionCan(s, "dispatch.manage");
  const admin = createAdminClient();
  const { data: appt } = await admin.from("appointments").select("id, lead_id, lat, lng, geo_precision, dispatch_status, locked_by_dispatcher, created_by").eq("id", d.id).eq("org_id", s.org.id).maybeSingle();
  if (!appt) return { ok: false, error: "RDV introuvable." };
  const assigned = appt.dispatch_status === "assigned";
  if (assigned && appt.locked_by_dispatcher) return { ok: false, error: "Ce RDV est verrouillé par le confirmateur : déverrouillez-le d'abord." };
  if (!dispatcher && (assigned || appt.created_by !== s.user.id || d.mode === "accept")) return { ok: false, error: "Permission insuffisante." };
  let point: (GeoPoint & { address?: string }) | null = null;
  let warnings: string[] = [];
  const now = new Date().toISOString();
  if (d.mode === "accept") {
    if (appt.lat === null || appt.geo_precision !== "municipality") return { ok: false, error: "Rien à accepter : la position n'est pas approximative." };
    const { error } = await admin.from("appointments").update({ geo_accepted: true, geo_fixed_by: s.user.id, geo_fixed_at: now, ...(assigned ? { needs_rebalance: true } : {}) }).eq("id", d.id);
    if (error) return { ok: false, error: mapDbError(error.message) };
  } else {
    if (d.mode === "suggestion") {
      // Point envoyé par le navigateur : revalidé côté serveur (France plausible) ; hors confirmateur, le libellé est re-géocodé et la précision plafonnée si le point n'est pas confirmé.
      const geo = dispatcher ? null : await geocodeAddress(d.label);
      const server = geo?.found ? { lat: geo.result.lat, lng: geo.result.lng, precision: geo.result.precision ?? ("street" as const) } : null;
      const gp = guardClientPoint({ lat: d.lat, lng: d.lng, precision: d.precision }, server, dispatcher);
      if (!gp.ok) return { ok: false, error: gp.error };
      if (gp.capped) warnings = ["Position non confirmée par le serveur : enregistrée comme approximative (commune), à accepter ou corriger par le confirmateur."];
      point = { lat: gp.lat, lng: gp.lng, precision: gp.precision, score: gp.fromServer && geo?.found ? (geo.result.score ?? null) : (d.score ?? null), source: "ban", insee: d.insee ?? null, label: d.label, address: d.label };
    }
    else if (d.mode === "manual_address") {
      const center = async (postcode: string, city: string) => {
        const r = await geocodeAddress(`${postcode} ${city}`);
        return r.found ? { ...r.result, precision: "municipality" as const } : null;
      };
      const r = await resolveManualAddress({ text: d.address, postcode: d.postcode, city: d.city }, activeGeocoders(), center);
      if (!r) return { ok: false, error: "Aucune position trouvée, même pour la commune : collez la position GPS depuis Google Maps.", fieldErrors: { city: "Commune introuvable." } };
      point = { ...r, address: `${d.address}, ${d.postcode} ${d.city}` };
    } else if (d.mode === "gps") {
      const c = parseCoordinates(d.text, appt.lat !== null && appt.lng !== null ? { lat: appt.lat, lng: appt.lng } : null);
      if (!c.ok) return { ok: false, error: c.error, fieldErrors: { text: c.error } };
      warnings = c.warnings;
      point = { lat: c.lat, lng: c.lng, precision: "manual_coords", score: 1, source: "manual", insee: null, label: "Position GPS saisie" };
    } else {
      if (!plausibleInFrance(d.lat, d.lng)) return { ok: false, error: "Position hors de France : vérifiez les coordonnées." };
      point = { lat: d.lat, lng: d.lng, precision: d.mode === "pin" ? "manual_pin" : "manual_coords", score: 1, source: "manual", insee: null, label: "Position saisie" };
    }
    const upd = {
      lat: point.lat, lng: point.lng, geo_precision: point.precision, geo_score: point.score, geo_source: point.source, insee_code: point.insee,
      geo_accepted: false, geo_fixed_by: s.user.id, geo_fixed_at: now, ...(assigned ? { needs_rebalance: true } : {}),
      ...(point.address ? { location_address: point.address.slice(0, 300) } : {}),
    };
    const { error } = await admin.from("appointments").update(upd).eq("id", d.id).eq("org_id", s.org.id);
    if (error) return { ok: false, error: mapDbError(error.message) };
    await admin.from("leads").update({ lat: point.lat, lng: point.lng, geo_precision: point.precision, geo_score: point.score, geo_source: point.source, insee_code: point.insee }).eq("id", appt.lead_id).eq("org_id", s.org.id);
  }
  await admin.from("lead_events").insert({ org_id: s.org.id, lead_id: appt.lead_id, type: "appointment", actor_id: s.user.id, payload: { appointment_id: d.id, action: "geo_fixed", mode: d.mode, precision: point?.precision ?? "municipality", source: point?.source ?? "manual", rebalance: assigned } });
  revalidatePath("/agenda/repartition");
  return { ok: true, data: { precision: point?.precision ?? "municipality", warnings } };
}

/** Le commercial concerné fournit la position exacte (Google Maps) d'un de ses RDV : met à jour le lead, marque « à rééquilibrer », prévient le confirmateur. */
export async function reportAddressFixAction(input: unknown): Promise<ActionResult<{ warnings: string[] }>> {
  const g = await guardAny(["appointments.manage_own", "appointments.manage_all"], "dispatch-issue");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid(), text: z.string().trim().min(1, "Collez les coordonnées.").max(500), message: z.string().trim().max(500).optional() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data: cur } = await supabase.from("appointments").select("lat, lng").eq("id", p.data.id).eq("org_id", g.s.org.id).maybeSingle();
  const c = parseCoordinates(p.data.text, cur && cur.lat !== null && cur.lng !== null ? { lat: cur.lat, lng: cur.lng } : null);
  if (!c.ok) return { ok: false, error: c.error, fieldErrors: { text: c.error } };
  const { error } = await supabase.rpc("report_address_fix", { p_id: p.data.id, p_lat: c.lat, p_lng: c.lng, p_message: p.data.message ?? "" });
  if (error) return { ok: false, error: error.message.includes("forbidden") ? "Vous ne pouvez corriger que vos propres RDV." : mapDbError(error.message, "Envoi impossible.") };
  revalidatePath("/agenda");
  revalidatePath("/agenda/repartition");
  return { ok: true, data: { warnings: c.warnings } };
}

// ------------------------------------------------------------------ simulation
const SIM_COMPANY = "[SIMULATION]";
const SIM_PEOPLE = [
  ["Claire", "Fontaine"], ["Marc", "Vidal"], ["Sonia", "Perrin"], ["Julien", "Garnier"], ["Amélie", "Roux"],
  ["Thierry", "Mercier"], ["Nadia", "Colin"], ["Bruno", "Faure"], ["Elsa", "Blanc"], ["Hugo", "Lambert"],
] as const;
/** Adresses plausibles de l'agglomération lyonnaise (coordonnées indicatives, uniquement pour choisir celles proches de la zone). */
const SIM_ADDRESSES: { a: string; lat: number; lng: number }[] = [
  { a: "15 rue de la République, 69002 Lyon", lat: 45.7640, lng: 4.8357 },
  { a: "48 cours Émile Zola, 69100 Villeurbanne", lat: 45.7719, lng: 4.8902 },
  { a: "22 avenue Jean Jaurès, 69007 Lyon", lat: 45.7497, lng: 4.8420 },
  { a: "10 rue de la Mairie, 69200 Vénissieux", lat: 45.6977, lng: 4.8869 },
  { a: "5 avenue Franklin Roosevelt, 69500 Bron", lat: 45.7369, lng: 4.9132 },
  { a: "31 Grande Rue de Saint-Clair, 69300 Caluire-et-Cuire", lat: 45.7956, lng: 4.8467 },
  { a: "12 avenue Édouard Aynard, 69130 Écully", lat: 45.7742, lng: 4.7708 },
  { a: "8 rue Voltaire, 69600 Oullins", lat: 45.7157, lng: 4.8076 },
  { a: "27 rue Maréchal Leclerc, 69800 Saint-Priest", lat: 45.6958, lng: 4.9456 },
  { a: "6 avenue Jean Jaurès, 69150 Décines-Charpieu", lat: 45.7708, lng: 4.9588 },
  { a: "19 avenue de la Libération, 69160 Tassin-la-Demi-Lune", lat: 45.7603, lng: 4.7507 },
  { a: "3 rue Garibaldi, 69003 Lyon", lat: 45.7597, lng: 4.8422 },
];

export async function launchSimulationAction(): Promise<ActionResult<{ created: number; zoneOwner: string }>> {
  const g = await guardAny([...DISPATCH], "dispatch-simulation");
  if ("error" in g) return { ok: false, error: g.error };
  const { s } = g;
  const supabase = await createClient();
  const { data: zones } = await supabase.from("sales_zones").select("user_id, base_lat, base_lng, radius_km, work_days, default_duration_min").eq("org_id", s.org.id).eq("active", true);
  const near = (zones ?? []).map((z) => ({ z, list: SIM_ADDRESSES.filter((x) => haversineKm({ lat: x.lat, lng: x.lng }, { lat: z.base_lat, lng: z.base_lng }) <= Number(z.radius_km) * 0.9) }))
    .sort((a, b) => b.list.length - a.list.length)[0];
  if (!near || near.list.length < 6) {
    return { ok: false, error: "La simulation utilise des adresses de l'agglomération lyonnaise : définissez la zone d'un commercial autour de Lyon (ex. Place Bellecour, 69002 Lyon, rayon 40 km)." };
  }
  const admin = createAdminClient();
  // Un seul jeu de simulation à la fois : relancer ne cumule jamais les leads fictifs.
  const { count } = await admin.from("leads").select("id", { count: "exact", head: true }).eq("org_id", s.org.id).eq("is_simulation", true);
  if ((count ?? 0) > 0) return { ok: false, code: "exists", error: "Une simulation est déjà en cours : supprimez-la d'abord (bouton « Supprimer la simulation »)." };
  const { data: init } = await admin.from("statuses").select("id").eq("org_id", s.org.id).eq("is_initial", true).maybeSingle();
  if (!init) return { ok: false, error: "Aucun statut initial dans cette organisation." };
  const { data: owner } = await supabase.from("profiles").select("full_name, email").eq("id", near.z.user_id).maybeSingle();

  // Fenêtre : du prochain jour ouvré sur 5 jours calendaires (le moteur choisit jour et heure).
  let first = addDays(localDay(new Date()), 1);
  const wd = (near.z.work_days as number[]) ?? DEFAULT_WORK.workDays;
  for (let i = 0; i < 7 && !wd.includes(isoWeekday(first)); i++) first = addDays(first, 1);
  const last = addDays(first, 4);
  const addrs = near.list;
  type Sim = { address: string; lat: number | null; lng: number | null; precision: string | null; source: string | null };
  // 7 adresses fiables (point GPS fixé à la saisie) + 3 cas volontairement problématiques pour montrer la section « À vérifier ».
  const sims: Sim[] = [
    ...Array.from({ length: 7 }, (_, i): Sim => { const a = addrs[i % addrs.length]!; return { address: a.a, lat: a.lat, lng: a.lng, precision: "housenumber", source: "ban" }; }),
    { address: "Lieu-dit Les Granges, 69590 Saint-Symphorien-sur-Coise", lat: null, lng: null, precision: null, source: null },
    { address: "Chemin des Écureuils, 69290 Craponne", lat: 45.7447, lng: 4.7194, precision: "municipality", source: "ban" },
    { address: "Plan d'eau du Grand Parc, 69120 Vaulx-en-Velin", lat: 45.8, lng: 4.91, precision: "manual_coords", source: "manual" },
  ];
  const leadRows = SIM_PEOPLE.map(([fn, ln], i) => ({
    org_id: s.org.id, status_id: init.id, first_name: fn, last_name: ln, company: SIM_COMPANY, phone: `06 39 97 ${String(10 + i).padStart(2, "0")} 0${i}`,
    address: sims[i]!.address, lat: sims[i]!.lat, lng: sims[i]!.lng, geo_precision: sims[i]!.precision, geo_source: sims[i]!.source, created_by: s.user.id,
    is_simulation: true,
  }));
  const { data: leads, error: le } = await admin.from("leads").insert(leadRows).select("id, address");
  if (le || !leads) return { ok: false, error: mapDbError(le?.message, "Simulation impossible.") };
  const byAddr = new Map(sims.map((x) => [x.address, x]));
  const { error: ae } = await admin.from("appointments").insert(leads.map((l) => {
    const x = byAddr.get(l.address as string)!;
    return {
      org_id: s.org.id, lead_id: l.id, assigned_to: null, starts_at: null, ends_at: null, status: "confirmed", dispatch_status: "unassigned",
      wish_from: first, wish_to: last, duration_min: near.z.default_duration_min, location_address: l.address, lat: x.lat, lng: x.lng,
      geo_precision: x.precision, geo_source: x.source, notes: "RDV de simulation (répartition automatique).", created_by: s.user.id, is_simulation: true,
    };
  }));
  if (ae) {
    await admin.from("leads").delete().in("id", leads.map((l) => l.id)).eq("org_id", s.org.id).eq("is_simulation", true);
    return { ok: false, error: mapDbError(ae.message, "Simulation impossible.") };
  }
  revalidatePath("/agenda/repartition");
  return { ok: true, data: { created: leads.length, zoneOwner: owner?.full_name ?? owner?.email ?? "—" } };
}

/**
 * Supprime les leads (et RDV) du jeu de simulation, repérés par is_simulation (jamais par le nom de société : un vrai lead « [SIMULATION] » est intact).
 * Les RDV simulés déjà « attribués » partent avec leur lead : leur nombre est renvoyé pour que l'interface le dise.
 */
export async function clearSimulationAction(): Promise<ActionResult<{ removed: number; assignedRemoved: number }>> {
  const g = await guardAny([...DISPATCH], "dispatch-simulation");
  if ("error" in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const { count: assignedRemoved } = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("org_id", g.s.org.id).eq("is_simulation", true).eq("dispatch_status", "assigned");
  const { data, error } = await admin.from("leads").delete().eq("org_id", g.s.org.id).eq("is_simulation", true).select("id");
  if (error) return { ok: false, error: mapDbError(error.message, "Suppression impossible.") };
  revalidatePath("/agenda/repartition");
  revalidatePath("/agenda");
  return { ok: true, data: { removed: data?.length ?? 0, assignedRemoved: assignedRemoved ?? 0 } };
}
