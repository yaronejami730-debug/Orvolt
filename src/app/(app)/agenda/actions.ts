"use server";

import { isFieldRole } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { mailAppointment } from "@/lib/notifications/appointment-mail";
import { dashboardCache } from "@/lib/dashboard/cache";
import { z } from "zod";
import { guard, guardAny, mapDbError, type ActionResult } from "@/lib/action-guard";
import { hasFeature, featureError } from "@/lib/billing/feature-guard";
import { checkDistance, type DistanceResult, type ZoneLike } from "@/lib/geo/haversine";
import { geocodeAddress } from "@/lib/geo/geocode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sessionCan, type AppSession } from "@/lib/session";
import { fieldErrors, firstError } from "@/lib/validation/auth";
import {
  PAST_APPT_MESSAGE, CONFIRM_ONLY_MESSAGE, canSetApptStatus, isPastStart, apptStatusSchema, appointmentInputSchema, appointmentUpdateSchema, pendingInputSchema, previewSchema, rangeSchema, zoneSchema, type ApptStatus,
} from "@/lib/validation/appointments";
import { guardClientPoint } from "@/lib/dispatch/point-guard";
import { checkWishWindow, PENDING_RPC_ERRORS } from "@/lib/dispatch/pending";
import { localDay } from "@/lib/dispatch/time";
import { leadName } from "@/lib/leads/types";

type SB = Awaited<ReturnType<typeof createClient>>;
const invalid = <T = undefined>(e: z.ZodError): ActionResult<T> => ({ ok: false, error: firstError(e), fieldErrors: fieldErrors(e) });
const PERMS = ["appointments.manage_own", "appointments.manage_all"] as const;

export interface ApptRow {
  id: string;
  lead_id: string;
  assigned_to: string;
  starts_at: string;
  ends_at: string;
  status: ApptStatus;
  location_address: string | null;
  distance_km: number | null;
  distance_status: DistanceResult["status"];
  distance_override: boolean;
  override_reason: string | null;
  notes: string | null;
  lead_name: string;
}
const APPT_COLS = "id, lead_id, assigned_to, starts_at, ends_at, status, location_address, distance_km, distance_status, distance_override, override_reason, notes, lead:leads(first_name, last_name, company)";
type RawAppt = Omit<ApptRow, "lead_name"> & { lead: { first_name: string; last_name: string; company: string | null } | null };
const toRow = (r: RawAppt): ApptRow => {
  const { lead, ...rest } = r;
  return { ...rest, distance_km: rest.distance_km === null ? null : Number(rest.distance_km), lead_name: lead ? leadName(lead) : "Lead" };
};

export interface Preview {
  distance: DistanceResult & { label: string | null; zoneOwner: string | null };
  conflicts: { id: string; starts_at: string; ends_at: string; lead_name: string }[];
}

async function loadZone(supabase: SB, orgId: string, userId: string): Promise<(ZoneLike & { user_id: string }) | null> {
  const { data } = await supabase.from("sales_zones").select("user_id, base_lat, base_lng, radius_km, active").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  return data ? { user_id: data.user_id, base_lat: data.base_lat, base_lng: data.base_lng, radius_km: Number(data.radius_km), active: data.active } : null;
}

async function assertScope(s: AppSession, supabase: SB, leadId: string, assignedTo: string): Promise<string | null> {
  if (assignedTo !== s.user.id && !sessionCan(s, "appointments.manage_all")) return "Vous ne pouvez planifier que pour vous-même.";
  const { data: lead } = await supabase.from("leads_api").select("id").eq("id", leadId).eq("org_id", s.org.id).maybeSingle();
  return lead ? null : "Lead introuvable.";
}

async function computeDistance(s: AppSession, supabase: SB, assignedTo: string, address: string | null | undefined) {
  // Contrôle des distances réservé à Business+ : sans le plan, aucune zone n'est appliquée (statut « no_zone »).
  const zone = (await hasFeature(s.org.id, "distance_control")) ? await loadZone(supabase, s.org.id, assignedTo) : null;
  const geo = address && address.trim().length >= 3 ? await geocodeAddress(address) : { found: false as const, cached: false };
  const distance = checkDistance(geo.found ? { lat: geo.result.lat, lng: geo.result.lng } : null, zone);
  return { distance, geo, zone };
}

export async function previewAppointmentAction(input: unknown): Promise<ActionResult<Preview>> {
  const g = await guardAny([...PERMS], "agenda-preview");
  if ("error" in g) return { ok: false, error: g.error };
  const p = previewSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { s } = g;
  const supabase = await createClient();
  const scope = await assertScope(s, supabase, p.data.leadId, p.data.assignedTo);
  if (scope) return { ok: false, error: scope };
  const { distance, geo } = await computeDistance(s, supabase, p.data.assignedTo, p.data.address);
  let zoneOwner: string | null = null;
  if (distance.status !== "no_zone") {
    const { data } = await supabase.from("profiles").select("full_name").eq("id", p.data.assignedTo).maybeSingle();
    zoneOwner = data?.full_name ?? null;
  }
  let conflicts: Preview["conflicts"] = [];
  if (p.data.startsAt && p.data.durationMin) {
    const start = new Date(p.data.startsAt);
    const end = new Date(start.getTime() + p.data.durationMin * 60_000);
    let q = supabase.from("appointments").select(APPT_COLS).eq("org_id", s.org.id).eq("assigned_to", p.data.assignedTo).neq("status", "cancelled").lt("starts_at", end.toISOString()).gt("ends_at", start.toISOString());
    if (p.data.excludeId) q = q.neq("id", p.data.excludeId);
    const { data } = await q.limit(5);
    conflicts = ((data ?? []) as unknown as RawAppt[]).map(toRow).map((r) => ({ id: r.id, starts_at: r.starts_at, ends_at: r.ends_at, lead_name: r.lead_name }));
  }
  return { ok: true, data: { distance: { ...distance, label: geo.found ? geo.result.label : null, zoneOwner }, conflicts } };
}

async function notifyAssignee(s: AppSession, assignedTo: string, leadId: string, leadLabel: string, startsAt: string, verb: string) {
  if (assignedTo === s.user.id) return;
  await createAdminClient().from("notifications").insert({
    org_id: s.org.id, user_id: assignedTo, type: "appointment",
    payload: { lead_id: leadId, lead_name: leadLabel, message: `${verb} : rendez-vous le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(startsAt))}` },
  });
}

/**
 * Écrit les colonnes de contrôle (coordonnées, distance, dérogation) : réservées au serveur (service_role).
 * Appelé uniquement après vérification des permissions et insertion/mise à jour par le client authentifié (RLS).
 * En cas d'échec, le RDV reste « distance non vérifiée » (valeur par défaut posée par la base).
 */
async function writeDistance(s: AppSession, id: string, distance: DistanceResult, geo: Awaited<ReturnType<typeof geocodeAddress>>, overrideReason?: string) {
  const override = distance.status === "over_radius" && !!overrideReason;
  const { error } = await createAdminClient()
    .from("appointments")
    .update({
      lat: geo.found ? geo.result.lat : null,
      lng: geo.found ? geo.result.lng : null,
      geo_precision: geo.found ? (geo.result.precision ?? "street") : null,
      geo_score: geo.found ? (geo.result.score ?? null) : null,
      geo_source: geo.found ? (geo.result.provider === "nominatim" ? "nominatim" : "ban") : null,
      distance_km: distance.distance_km,
      distance_status: distance.status,
      distance_override: override,
      override_reason: override ? overrideReason : null,
      override_by: override ? s.user.id : null,
    })
    .eq("id", id)
    .eq("org_id", s.org.id);
  if (error) console.error("[agenda] écriture distance", error.message);
}

function mapApptError<T = undefined>(e: { code?: string; message: string }): ActionResult<T> {
  if (e.code === "23P01" || e.message.includes("appointments_no_overlap")) return { ok: false, code: "conflict", error: "Ce commercial a déjà un rendez-vous sur ce créneau." };
  if (e.message.includes("forbidden_assignee")) return { ok: false, error: "Vous ne pouvez planifier que pour vous-même." };
  if (e.message.includes("invalid_assignee")) return { ok: false, error: "Ce commercial n'est pas actif." };
  return { ok: false, error: mapDbError(e.message, "Enregistrement impossible.") };
}

export async function createAppointmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await guardAny([...PERMS], "agenda-write");
  if ("error" in g) return { ok: false, error: g.error };
  const p = appointmentInputSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { s } = g;
  const d = p.data;
  if (isPastStart(d.startsAt)) return { ok: false, error: PAST_APPT_MESSAGE, fieldErrors: { startsAt: PAST_APPT_MESSAGE } };
  const supabase = await createClient();
  const scope = await assertScope(s, supabase, d.leadId, d.assignedTo);
  if (scope) return { ok: false, error: scope };
  const { distance, geo } = await computeDistance(s, supabase, d.assignedTo, d.location);
  if (distance.status === "over_radius" && !d.overrideReason) {
    return { ok: false, code: "over_radius", error: `Lieu à ${distance.distance_km} km, au-delà du rayon de ${distance.radius_km} km : un motif est requis pour forcer.` };
  }
  const start = new Date(d.startsAt);
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      org_id: s.org.id, lead_id: d.leadId, assigned_to: d.assignedTo, created_by: s.user.id,
      starts_at: start.toISOString(), ends_at: new Date(start.getTime() + d.durationMin * 60_000).toISOString(),
      location_address: d.location ?? null, notes: d.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return mapApptError(error ?? { message: "" });
  await writeDistance(s, data.id, distance, geo, d.overrideReason);
  const { data: lead } = await supabase.from("leads_api").select("first_name, last_name, company").eq("id", d.leadId).maybeSingle();
  await notifyAssignee(s, d.assignedTo, d.leadId, lead ? leadName(lead) : "Lead", start.toISOString(), "Nouveau rendez-vous").catch(() => undefined);
  after(() => mailAppointment("assigned", data.id, s.user.id)); // e-mail à l'assigné (jamais à soi-même) ; un échec ne bloque rien
  dashboardCache.clear();
  revalidatePath("/agenda");
  revalidatePath(`/leads/${d.leadId}`);
  return { ok: true, data: { id: data.id } };
}

/**
 * Un télépro (appointments.manage_own) propose un RDV « à attribuer » : fenêtre de jours souhaitée + durée, sans commercial ni heure.
 * Le confirmateur le confirme puis la répartition automatique choisit commercial et créneau. Position revérifiée côté serveur.
 */
export async function createPendingAppointmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await guardAny([...PERMS], "agenda-write");
  if ("error" in g) return { ok: false, error: g.error };
  const p = pendingInputSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { s } = g;
  const d = p.data;
  const bad = checkWishWindow(d.wishFrom, d.wishTo, localDay(new Date()));
  if (bad) return { ok: false, error: bad, fieldErrors: { wishFrom: bad } };
  const supabase = await createClient();
  const scope = await assertScope(s, supabase, d.leadId, s.user.id);
  if (scope) return { ok: false, error: scope };
  // Position : toujours revue par le serveur (géocodage du libellé). Un point client n'est retenu tel quel que pour le confirmateur.
  const geo = await geocodeAddress(d.location);
  const server = geo.found ? { lat: geo.result.lat, lng: geo.result.lng, precision: geo.result.precision ?? ("street" as const) } : null;
  let point: { lat: number; lng: number; precision: string; score: number | null; source: string } | null = null;
  if (d.point) {
    const gp = guardClientPoint(d.point, server, sessionCan(s, "dispatch.manage"));
    if (!gp.ok) return { ok: false, error: gp.error, fieldErrors: { location: gp.error } };
    const manual = gp.precision === "manual_pin" || gp.precision === "manual_coords";
    point = { lat: gp.lat, lng: gp.lng, precision: gp.precision, score: gp.fromServer && geo.found ? (geo.result.score ?? null) : null, source: manual ? "manual" : gp.fromServer && geo.found && geo.result.provider === "nominatim" ? "nominatim" : "ban" };
  } else if (server && geo.found) {
    point = { lat: server.lat, lng: server.lng, precision: server.precision, score: geo.result.score ?? null, source: geo.result.provider === "nominatim" ? "nominatim" : "ban" };
  }
  const { data, error } = await supabase.rpc("create_pending_appointment", {
    p_lead: d.leadId, p_wish_from: d.wishFrom, p_wish_to: d.wishTo, p_duration: d.durationMin, p_address: d.location,
    p_lat: point?.lat ?? null, p_lng: point?.lng ?? null, p_precision: point?.precision ?? null, p_score: point?.score ?? null, p_source: point?.source ?? null,
    p_notes: d.notes ?? null,
  });
  if (error || !data) {
    const hit = PENDING_RPC_ERRORS.find(([k]) => (error?.message ?? "").includes(k));
    return { ok: false, error: hit?.[1] ?? mapDbError(error?.message, "Enregistrement impossible.") };
  }
  dashboardCache.clear();
  revalidatePath("/agenda");
  revalidatePath("/agenda/repartition");
  revalidatePath(`/leads/${d.leadId}`);
  return { ok: true, data: { id: data as string } };
}

export async function updateAppointmentAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...PERMS], "agenda-write");
  if ("error" in g) return { ok: false, error: g.error };
  const p = appointmentUpdateSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { s } = g;
  const d = p.data;
  const supabase = await createClient();
  const { data: cur } = await supabase.from("appointments").select("lead_id, status, starts_at, assigned_to").eq("id", d.id).eq("org_id", s.org.id).maybeSingle();
  if (!cur) return { ok: false, error: "Rendez-vous introuvable." };
  // Déplacement dans le passé refusé (sauf RDV déjà réalisé / absent, ou début inchangé : simple correction de notes).
  const unchangedStart = new Date(cur.starts_at).getTime() === new Date(d.startsAt).getTime();
  if (isPastStart(d.startsAt) && !unchangedStart && cur.status !== "done" && cur.status !== "no_show") {
    return { ok: false, error: PAST_APPT_MESSAGE, fieldErrors: { startsAt: PAST_APPT_MESSAGE } };
  }
  const scope = await assertScope(s, supabase, cur.lead_id, d.assignedTo);
  if (scope) return { ok: false, error: scope };
  const { distance, geo } = await computeDistance(s, supabase, d.assignedTo, d.location);
  if (distance.status === "over_radius" && !d.overrideReason) {
    return { ok: false, code: "over_radius", error: `Lieu à ${distance.distance_km} km, au-delà du rayon de ${distance.radius_km} km : un motif est requis pour forcer.` };
  }
  const start = new Date(d.startsAt);
  const { data, error } = await supabase
    .from("appointments")
    .update({
      assigned_to: d.assignedTo, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + d.durationMin * 60_000).toISOString(),
      location_address: d.location ?? null, notes: d.notes ?? null,
    })
    .eq("id", d.id).eq("org_id", s.org.id).select("id");
  if (error) return mapApptError(error);
  if (!data?.length) return { ok: false, error: "Modification refusée." };
  await writeDistance(s, d.id, distance, geo, d.overrideReason);
  // Réattribué : l'ancien commercial est prévenu de l'annulation ; déplacé ou réattribué : le nouvel assigné reçoit le créneau.
  const reassigned = !!cur.assigned_to && cur.assigned_to !== d.assignedTo;
  if (cur.status !== "cancelled" && (reassigned || !cur.starts_at || new Date(cur.starts_at).getTime() !== start.getTime())) {
    after(async () => {
      if (reassigned && cur.starts_at) await mailAppointment("cancelled", d.id, s.user.id, { userId: cur.assigned_to, startsAt: cur.starts_at });
      await mailAppointment("assigned", d.id, s.user.id);
    });
  }
  dashboardCache.clear();
  revalidatePath("/agenda");
  revalidatePath(`/leads/${cur.lead_id}`);
  return { ok: true };
}

export async function setAppointmentStatusAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...PERMS], "agenda-write");
  if ("error" in g) return { ok: false, error: g.error };
  const p = apptStatusSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  if (!canSetApptStatus(p.data.status, sessionCan(g.s, "dispatch.manage"))) return { ok: false, error: CONFIRM_ONLY_MESSAGE };
  const supabase = await createClient();
  const { data, error } = await supabase.from("appointments").update({ status: p.data.status }).eq("id", p.data.id).eq("org_id", g.s.org.id).select("lead_id");
  if (error) return mapApptError(error); // réactiver un RDV annulé peut entrer en conflit
  if (!data?.length) return { ok: false, error: "Modification refusée." };
  if (p.data.status === "cancelled") after(() => mailAppointment("cancelled", p.data.id, g.s.user.id));
  dashboardCache.clear();
  revalidatePath("/agenda");
  revalidatePath(`/leads/${data[0]!.lead_id}`);
  return { ok: true };
}

export async function listAppointmentsAction(input: unknown): Promise<ActionResult<{ rows: ApptRow[] }>> {
  const g = await guardAny([...PERMS], "agenda-list");
  if ("error" in g) return { ok: false, error: g.error };
  const p = rangeSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  let q = supabase.from("appointments").select(APPT_COLS).eq("org_id", g.s.org.id).lt("starts_at", p.data.to).gt("ends_at", p.data.from).order("starts_at").limit(1000);
  if (p.data.userIds?.length) q = q.in("assigned_to", p.data.userIds);
  if (p.data.leadId) q = q.eq("lead_id", p.data.leadId);
  const { data, error } = await q;
  if (error) return { ok: false, error: "Chargement impossible." };
  return { ok: true, data: { rows: ((data ?? []) as unknown as RawAppt[]).map(toRow) } };
}

/** Prochain rendez-vous par lead (badge Kanban). */
export async function listNextAppointmentsAction(): Promise<ActionResult<{ next: Record<string, string> }>> {
  const g = await guard([], "agenda-list");
  if ("error" in g) return { ok: false, error: g.error };
  if (!PERMS.some((p) => sessionCan(g.s, p))) return { ok: true, data: { next: {} } };
  const supabase = await createClient();
  const { data } = await supabase.from("appointments").select("lead_id, starts_at").eq("org_id", g.s.org.id).in("status", ["planned", "confirmed"]).gte("starts_at", new Date().toISOString()).order("starts_at").limit(1000);
  const next: Record<string, string> = {};
  for (const r of data ?? []) if (!(r.lead_id in next)) next[r.lead_id] = r.starts_at;
  return { ok: true, data: { next } };
}

// ---------------------------------------------------------------- zone d'intervention
export async function saveZoneAction(input: unknown): Promise<ActionResult> {
  const g = await guard([], "zones");
  if ("error" in g) return { ok: false, error: g.error };
  const p = zoneSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { s } = g;
  const locked = await featureError(s.org.id, "distance_control");
  if (locked) return { ok: false, error: locked };
  if (p.data.userId !== s.user.id && !sessionCan(s, "members.manage")) return { ok: false, error: "Permission insuffisante." };
  const geo = await geocodeAddress(p.data.baseAddress);
  if (!geo.found) return { ok: false, error: "Adresse introuvable.", fieldErrors: { baseAddress: "Adresse introuvable : précisez la rue et la ville." } };
  const supabase = await createClient();
  // Une zone n'a de sens que pour un rôle terrain (commercial) : les autres ne se déplacent pas.
  const target = (await supabase.from("memberships").select("role:roles(is_admin, is_field, permissions)").eq("org_id", s.org.id).eq("user_id", p.data.userId).eq("status", "active").maybeSingle()).data as { role: { is_admin: boolean; is_field: boolean; permissions: string[] } | null } | null;
  if (!target?.role || !isFieldRole({ is_admin: target.role.is_admin, is_field: target.role.is_field, permissions: target.role.permissions ?? [] })) return { ok: false, error: "Seuls les commerciaux ont une zone d'intervention." };
  const { error } = await supabase.from("sales_zones").upsert(
    { org_id: s.org.id, user_id: p.data.userId, base_address: p.data.baseAddress, base_lat: geo.result.lat, base_lng: geo.result.lng, radius_km: p.data.radiusKm, active: p.data.active },
    { onConflict: "org_id,user_id" },
  );
  if (error) return { ok: false, error: mapDbError(error.message, "Enregistrement impossible.") };
  // Les rendez-vous futurs sont recontrôlés (hors dérogations déjà motivées).
  const admin = createAdminClient();
  const { data: future } = await admin.from("appointments").select("id, lat, lng, distance_override").eq("org_id", s.org.id).eq("assigned_to", p.data.userId).gte("starts_at", new Date().toISOString()).neq("status", "cancelled");
  for (const a of future ?? []) {
    if (a.distance_override) continue;
    const d = checkDistance(a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng } : null, { base_lat: geo.result.lat, base_lng: geo.result.lng, radius_km: p.data.radiusKm, active: p.data.active });
    await admin.from("appointments").update({ distance_km: d.distance_km, distance_status: d.status }).eq("id", a.id);
  }
  revalidatePath("/settings/members");
  revalidatePath("/agenda");
  return { ok: true };
}
