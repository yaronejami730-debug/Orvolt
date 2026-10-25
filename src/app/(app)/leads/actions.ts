"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { dashboardCache } from "@/lib/dashboard/cache";
import { guard, mapDbError, type ActionResult } from "@/lib/action-guard";
import { runStatusActions } from "@/lib/automation/store";
import { matchesSignature } from "@/lib/validation/file-signature";
import { validateCustom } from "@/lib/custom-fields";
import { shiftDay, startOfParisDay } from "@/lib/dashboard/period";
import { LEAD_COLS, type LeadRow } from "@/lib/leads/types";
import { loadFieldDefs } from "@/lib/leads/meta";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, firstError } from "@/lib/validation/auth";
import {
  bulkAssignSchema, bulkMoveSchema, bulkSchema, callSchema, createLeadSchema, idOnly, listParamsSchema, moveLeadSchema,
  noteSchema, noteUpdateSchema, safeFileName, updateLeadSchema, validateUpload, type ListParams,
} from "@/lib/validation/leads";
import { z } from "zod";

type SB = Awaited<ReturnType<typeof createClient>>;
const invalid = <T = undefined>(e: z.ZodError): ActionResult<T> => ({ ok: false, error: firstError(e), fieldErrors: fieldErrors(e) });
const esc = (s: string) => s.toLowerCase().replace(/[%_\\,()*]/g, " ").trim();

function listQuery(supabase: SB, orgId: string) {
  // Lecture via la vue leads_api : les champs personnalisés masqués pour le rôle sont retirés en base.
  return supabase.from("leads_api").select(LEAD_COLS, { count: "exact" }).eq("org_id", orgId).is("archived_at", null);
}
function applyFilters(q: ReturnType<typeof listQuery>, p: ListParams) {
  if (p.statuses.length) q = q.in("status_id", p.statuses);
  if (p.sources.length) {
    const ids = p.sources.filter((x) => x !== "none");
    const parts = [...(ids.length ? [`source_id.in.(${ids.join(",")})`] : []), ...(p.sources.includes("none") ? ["source_id.is.null"] : [])];
    q = q.or(parts.join(","));
  }
  if (p.assigned.length) {
    const ids = p.assigned.filter((x) => x !== "none");
    const parts = [...(ids.length ? [`assigned_to.in.(${ids.join(",")})`] : []), ...(p.assigned.includes("none") ? ["assigned_to.is.null"] : [])];
    q = q.or(parts.join(","));
  }
  // Jours calendaires Europe/Paris (mêmes bornes que le tableau de bord) : début inclus, fin incluse (jusqu'au lendemain 00:00 exclu).
  const day = (d: string) => { try { return startOfParisDay(d).toISOString(); } catch { return null; } }; // date inexistante (30 février) : ignorée
  const lo = p.from ? day(p.from) : null;
  const hi = p.to ? day(shiftDay(p.to, 1)) : null;
  if (lo) q = q.gte("created_at", lo);
  if (hi) q = q.lt("created_at", hi);
  if (p.q && esc(p.q)) q = q.ilike("search_text", `%${esc(p.q)}%`);
  for (const [k, v] of Object.entries(p.custom)) if (esc(v)) q = q.ilike(`custom->>${k}`, `%${esc(v)}%`);
  return q;
}

export async function listLeadsAction(input: unknown): Promise<ActionResult<{ rows: LeadRow[]; total: number }>> {
  const g = await guard([], "leads-list");
  if ("error" in g) return { ok: false, error: g.error };
  const p = listParamsSchema.safeParse(input ?? {});
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const from = (p.data.page - 1) * p.data.pageSize;
  const { data, count, error } = await applyFilters(listQuery(supabase, g.s.org.id), p.data)
    .order(p.data.sort, { ascending: p.data.dir === "asc", nullsFirst: false })
    .order("id")
    .range(from, from + p.data.pageSize - 1);
  if (error) return { ok: false, error: "Chargement impossible." };
  return { ok: true, data: { rows: (data ?? []) as unknown as LeadRow[], total: count ?? 0 } };
}

export async function listKanbanAction(input: unknown): Promise<ActionResult<{ rows: LeadRow[]; total: number }>> {
  const g = await guard([], "leads-list");
  if ("error" in g) return { ok: false, error: g.error };
  const p = listParamsSchema.safeParse(input ?? {});
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data, count, error } = await applyFilters(listQuery(supabase, g.s.org.id), p.data).order("position").limit(1000);
  if (error) return { ok: false, error: "Chargement impossible." };
  return { ok: true, data: { rows: (data ?? []) as unknown as LeadRow[], total: count ?? 0 } };
}

export async function createLeadAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await guard("leads.create", "leads-write");
  if ("error" in g) return { ok: false, error: g.error };
  const p = createLeadSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { s } = g;
  const defs = await loadFieldDefs(s.org.id);
  const custom = validateCustom(defs, p.data.custom ?? {}, { roleId: s.role.id, isAdmin: s.isAdmin }, "create");
  if (!custom.ok) return { ok: false, error: Object.values(custom.errors)[0], fieldErrors: Object.fromEntries(Object.entries(custom.errors).map(([k, v]) => [`custom.${k}`, v])) };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      org_id: s.org.id, created_by: s.user.id, status_id: d.statusId ?? undefined,
      source_id: d.sourceId ?? null, assigned_to: d.assignedTo ?? null,
      first_name: d.firstName, last_name: d.lastName, company: d.company || null, email: d.email || null, phone: d.phone || null,
      address: d.address || null, city: d.city || null, postal_code: d.postalCode || null, value: d.value ?? null, custom: custom.data,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: mapDbError(error?.message, "Création impossible.") };
  // La base n'accepte le statut demandé que si le rôle y a droit (sinon statut initial) ; on tente alors le déplacement (transitions respectées).
  if (!s.isAdmin && d.statusId) await moveOne(s, supabase, data.id, d.statusId).catch(() => undefined);
  dashboardCache.clear();
  revalidatePath("/leads");
  return { ok: true, data: { id: data.id } };
}

export async function updateLeadAction(input: unknown): Promise<ActionResult> {
  const g = await guard("leads.edit", "leads-write");
  if ("error" in g) return { ok: false, error: g.error };
  const p = updateLeadSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { s } = g;
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  const c = p.data.core;
  if (c) {
    const map: Record<string, string> = { firstName: "first_name", lastName: "last_name", company: "company", email: "email", phone: "phone", address: "address", city: "city", postalCode: "postal_code", value: "value", sourceId: "source_id", assignedTo: "assigned_to" };
    for (const [k, col] of Object.entries(map)) {
      const v = (c as Record<string, unknown>)[k];
      if (v !== undefined) patch[col] = v === "" ? (k === "firstName" || k === "lastName" ? "" : null) : v;
    }
  }
  let customPatch: Record<string, unknown> | null = null;
  if (p.data.custom) {
    const defs = await loadFieldDefs(s.org.id);
    const res = validateCustom(defs, p.data.custom, { roleId: s.role.id, isAdmin: s.isAdmin }, "update");
    if (!res.ok) return { ok: false, error: Object.values(res.errors)[0], fieldErrors: Object.fromEntries(Object.entries(res.errors).map(([k, v]) => [`custom.${k}`, v])) };
    customPatch = {};
    for (const k of Object.keys(p.data.custom)) customPatch[k] = k in res.data ? res.data[k] : null; // null = effacer
  }
  if (Object.keys(patch).length === 0 && !customPatch) return { ok: true };
  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabase.from("leads").update(patch).eq("id", p.data.id).eq("org_id", s.org.id).select("id");
    if (error || !data?.length) return { ok: false, error: mapDbError(error?.message ?? "row-level security", "Enregistrement impossible.") };
  }
  if (customPatch) {
    const { error } = await supabase.rpc("patch_lead_custom", { p_lead: p.data.id, p_patch: customPatch });
    if (error) return { ok: false, error: mapDbError(error.message, "Enregistrement impossible.") };
  }
  dashboardCache.clear();
  revalidatePath(`/leads/${p.data.id}`);
  return { ok: true };
}

async function moveOne(s: Awaited<ReturnType<typeof import("@/lib/session").requireSession>>, supabase: SB, leadId: string, toStatusId: string, position?: number): Promise<ActionResult> {
  const { data, error } = await supabase.rpc("move_lead", { p_lead: leadId, p_to: toStatusId, p_position: position ?? null });
  if (error) {
    if (error.message.includes("transition_forbidden")) {
      const [{ data: l }, { data: to }] = await Promise.all([
        supabase.from("leads").select("status:statuses(name, kind)").eq("id", leadId).maybeSingle(),
        supabase.from("statuses").select("name").eq("id", toStatusId).maybeSingle(),
      ]);
      const cur = (l as unknown as { status?: { name?: string; kind?: string } } | null)?.status;
      if (cur?.kind && cur.kind !== "normal") {
        return { ok: false, code: "final_status", error: `« ${cur.name} » est un statut final : un lead ne peut plus en sortir.` };
      }
      return { ok: false, code: "transition_forbidden", error: `Transition non autorisée pour votre rôle : ${cur?.name ?? "?"} → ${to?.name ?? "?"}.` };
    }
    if (error.message.includes("lead_not_found")) return { ok: false, code: "not_found", error: "Lead introuvable." };
    return { ok: false, error: mapDbError(error.message, "Déplacement impossible.") };
  }
  dashboardCache.clear();
  const r = data as { changed: boolean; event_id: string | null; from_status_id: string; to_status_id: string; actions: { id: string; type: string; config: unknown; position: number }[] };
  if (r.changed && r.event_id && r.actions.length) {
    const ctx = { orgId: s.org.id, orgSlug: s.org.slug, leadId, fromStatusId: r.from_status_id, toStatusId: r.to_status_id, eventId: r.event_id, actorId: s.user.id };
    // Hors du chemin de réponse ; un échec d'action n'annule jamais le déplacement.
    after(async () => {
      try {
        await runStatusActions(ctx, r.actions);
      } catch (e) {
        console.error("[automation]", e instanceof Error ? e.message : e);
      }
    });
  }
  return { ok: true };
}

export async function moveLeadAction(input: unknown): Promise<ActionResult> {
  const g = await guard("leads.edit", "leads-move");
  if ("error" in g) return { ok: false, error: g.error };
  const p = moveLeadSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  return moveOne(g.s, await createClient(), p.data.leadId, p.data.toStatusId, p.data.position);
}

type BulkReport = { done: number; failed: { id: string; error: string }[] };
async function bulk(ids: string[], fn: (id: string) => Promise<ActionResult>): Promise<ActionResult<BulkReport>> {
  const failed: BulkReport["failed"] = [];
  let done = 0;
  for (const id of ids) {
    const r = await fn(id);
    if (r.ok) done++;
    else failed.push({ id, error: r.error ?? "Échec." });
  }
  dashboardCache.clear();
  revalidatePath("/leads");
  return { ok: done > 0 || failed.length === 0, data: { done, failed }, error: done === 0 && failed.length ? failed[0]!.error : undefined };
}

export async function bulkMoveAction(input: unknown): Promise<ActionResult<BulkReport>> {
  const g = await guard("leads.edit", "leads-bulk");
  if ("error" in g) return { ok: false, error: g.error };
  const p = bulkMoveSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  return bulk(p.data.ids, (id) => moveOne(g.s, supabase, id, p.data.toStatusId));
}

export async function bulkAssignAction(input: unknown): Promise<ActionResult<BulkReport>> {
  const g = await guard("leads.edit", "leads-bulk");
  if ("error" in g) return { ok: false, error: g.error };
  const p = bulkAssignSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  return bulk(p.data.ids, async (id) => {
    const { data, error } = await supabase.from("leads").update({ assigned_to: p.data.assignedTo }).eq("id", id).eq("org_id", g.s.org.id).select("id");
    return error || !data?.length ? { ok: false, error: mapDbError(error?.message ?? "row-level security") } : { ok: true };
  });
}

export async function bulkDeleteAction(input: unknown): Promise<ActionResult<BulkReport>> {
  const g = await guard("leads.delete", "leads-bulk");
  if ("error" in g) return { ok: false, error: g.error };
  const p = bulkSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  return bulk(p.data.ids, async (id) => {
    const { data, error } = await supabase.from("leads").delete().eq("id", id).eq("org_id", g.s.org.id).select("id");
    return error || !data?.length ? { ok: false, error: "Suppression refusée." } : { ok: true };
  });
}

export async function deleteLeadAction(input: unknown): Promise<ActionResult> {
  const g = await guard("leads.delete", "leads-write");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idOnly.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").delete().eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Suppression refusée." };
  dashboardCache.clear();
  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------- notes
export async function addNoteAction(input: unknown): Promise<ActionResult> {
  const g = await guard("leads.edit", "leads-notes");
  if ("error" in g) return { ok: false, error: g.error };
  const p = noteSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { error } = await supabase.from("lead_notes").insert({ org_id: g.s.org.id, lead_id: p.data.leadId, author_id: g.s.user.id, body: p.data.body });
  if (error) return { ok: false, error: mapDbError(error.message, "Ajout impossible.") };
  revalidatePath(`/leads/${p.data.leadId}`);
  return { ok: true };
}
export async function updateNoteAction(input: unknown): Promise<ActionResult> {
  const g = await guard("leads.edit", "leads-notes");
  if ("error" in g) return { ok: false, error: g.error };
  const p = noteUpdateSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lead_notes").update({ body: p.data.body }).eq("id", p.data.id).eq("org_id", g.s.org.id).select("lead_id");
  if (error || !data?.length) return { ok: false, error: "Modification refusée (vous ne pouvez modifier que vos notes)." };
  revalidatePath(`/leads/${data[0]!.lead_id}`);
  return { ok: true };
}
export async function deleteNoteAction(input: unknown): Promise<ActionResult> {
  const g = await guard("leads.edit", "leads-notes");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idOnly.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lead_notes").delete().eq("id", p.data.id).eq("org_id", g.s.org.id).select("lead_id");
  if (error || !data?.length) return { ok: false, error: "Suppression refusée." };
  revalidatePath(`/leads/${data[0]!.lead_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------- appels
export async function addCallAction(input: unknown): Promise<ActionResult> {
  const g = await guard("leads.edit", "leads-calls");
  if ("error" in g) return { ok: false, error: g.error };
  const p = callSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { error } = await supabase.from("lead_calls").insert({
    org_id: g.s.org.id, lead_id: p.data.leadId, caller_id: g.s.user.id, outcome: p.data.outcome,
    duration_seconds: p.data.durationMinutes * 60, notes: p.data.notes || null,
  });
  if (error) return { ok: false, error: mapDbError(error.message, "Enregistrement impossible.") };
  revalidatePath(`/leads/${p.data.leadId}`);
  return { ok: true };
}

// ---------------------------------------------------------------- fichiers
export async function uploadFileAction(formData: FormData): Promise<ActionResult> {
  const g = await guard("leads.edit", "leads-files");
  if ("error" in g) return { ok: false, error: g.error };
  const leadId = z.uuid().safeParse(formData.get("leadId"));
  const file = formData.get("file");
  if (!leadId.success || !(file instanceof File)) return { ok: false, error: "Fichier invalide." };
  const bad = validateUpload(file.name, file.size, file.type);
  if (bad) return { ok: false, error: bad };
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (!matchesSignature(file.type, head)) return { ok: false, error: "Le contenu du fichier ne correspond pas à son type." };
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("id").eq("id", leadId.data).eq("org_id", g.s.org.id).maybeSingle();
  if (!lead) return { ok: false, error: "Lead introuvable." };
  const path = `${g.s.org.id}/${leadId.data}/${randomUUID()}-${safeFileName(file.name)}`;
  const up = await supabase.storage.from("lead-files").upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return { ok: false, error: "Envoi impossible." };
  const { error } = await supabase.from("lead_files").insert({
    org_id: g.s.org.id, lead_id: leadId.data, uploaded_by: g.s.user.id, path, name: file.name.slice(0, 200), size_bytes: file.size, mime_type: file.type,
  });
  if (error) {
    await supabase.storage.from("lead-files").remove([path]);
    return { ok: false, error: "Enregistrement du fichier impossible." };
  }
  revalidatePath(`/leads/${leadId.data}`);
  return { ok: true };
}
export async function deleteFileAction(input: unknown): Promise<ActionResult> {
  const g = await guard("leads.edit", "leads-files");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idOnly.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data: f } = await supabase.from("lead_files").select("path, lead_id").eq("id", p.data.id).eq("org_id", g.s.org.id).maybeSingle();
  if (!f) return { ok: false, error: "Fichier introuvable." };
  const { data, error } = await supabase.from("lead_files").delete().eq("id", p.data.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Suppression refusée." };
  await supabase.storage.from("lead-files").remove([f.path]);
  revalidatePath(`/leads/${f.lead_id}`);
  return { ok: true };
}
export async function fileUrlAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  const g = await guard([], "leads-file-url");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idOnly.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data: f } = await supabase.from("lead_files").select("path, name").eq("id", p.data.id).eq("org_id", g.s.org.id).maybeSingle();
  if (!f) return { ok: false, error: "Fichier introuvable." };
  const { data, error } = await supabase.storage.from("lead-files").createSignedUrl(f.path, 60, { download: f.name });
  if (error || !data) return { ok: false, error: "Lien indisponible." };
  return { ok: true, data: { url: data.signedUrl } };
}

// ---------------------------------------------------------------- tâches & notifications
export async function toggleTaskAction(input: unknown): Promise<ActionResult> {
  const g = await guard([], "tasks");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid(), done: z.boolean() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").update({ done: p.data.done, done_at: p.data.done ? new Date().toISOString() : null }).eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Modification refusée." };
  revalidatePath("/tasks");
  return { ok: true };
}

export interface NotificationItem { id: string; type: string; payload: Record<string, unknown>; read_at: string | null; created_at: string }
export async function listNotificationsAction(): Promise<ActionResult<{ items: NotificationItem[]; unread: number }>> {
  const g = await guard([], "notifications");
  if ("error" in g) return { ok: false, error: g.error };
  const supabase = await createClient();
  const [list, unread] = await Promise.all([
    supabase.from("notifications").select("id, type, payload, read_at, created_at").eq("org_id", g.s.org.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("org_id", g.s.org.id).is("read_at", null),
  ]);
  return { ok: true, data: { items: (list.data ?? []) as NotificationItem[], unread: unread.count ?? 0 } };
}
export async function markNotificationsReadAction(): Promise<ActionResult> {
  const g = await guard([], "notifications");
  if ("error" in g) return { ok: false, error: g.error };
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("org_id", g.s.org.id).is("read_at", null);
  return { ok: true };
}
