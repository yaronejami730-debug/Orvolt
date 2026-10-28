"use server";

import { revalidatePath } from "next/cache";
import { featureError } from "@/lib/billing/feature-guard";
import { guard, mapDbError, type ActionResult } from "@/lib/action-guard";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, firstError } from "@/lib/validation/auth";
import {
  createStatusSchema,
  deleteStatusSchema,
  reorderSchema,
  saveActionsSchema,
  saveGrantsSchema,
  saveTransitionsSchema,
  setInitialSchema,
  updateStatusSchema,
  webhookUrlSchema,
} from "@/lib/validation/workflow";
import { safeFetch, UnsafeUrlError } from "@/lib/net/safe-fetch";

const done = (): ActionResult => {
  revalidatePath("/settings/statuses");
  return { ok: true };
};
const invalid = (e: import("zod").ZodError): ActionResult => ({ ok: false, error: firstError(e), fieldErrors: fieldErrors(e) });

export async function createStatusAction(input: unknown): Promise<ActionResult> {
  const g = await guard("statuses.manage", "statuses");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "status_tracking");
  if (locked) return { ok: false, error: locked };
  const p = createStatusSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data: last } = await supabase.from("statuses").select("position").eq("org_id", g.s.org.id).order("position", { ascending: false }).limit(1);
  const { count } = await supabase.from("statuses").select("id", { count: "exact", head: true }).eq("org_id", g.s.org.id);
  if ((count ?? 0) >= 30) return { ok: false, error: "Limite de 30 statuts atteinte." };
  const { error } = await supabase.from("statuses").insert({
    org_id: g.s.org.id,
    ...p.data,
    position: (last?.[0]?.position ?? -1) + 1,
    is_initial: (count ?? 0) === 0 && p.data.kind === "normal",
  });
  if (error) return { ok: false, error: mapDbError(error.message, "Création impossible."), fieldErrors: error.code === "23505" ? { name: "Ce nom est déjà utilisé." } : undefined };
  return done();
}

export async function updateStatusAction(input: unknown): Promise<ActionResult> {
  const g = await guard("statuses.manage", "statuses");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "status_tracking");
  if (locked) return { ok: false, error: locked };
  const p = updateStatusSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data: cur } = await supabase.from("statuses").select("kind, is_initial").eq("id", p.data.id).eq("org_id", g.s.org.id).maybeSingle();
  if (!cur) return { ok: false, error: "Statut introuvable." };
  if (cur.is_initial && p.data.kind !== "normal") return { ok: false, error: "Le statut initial doit rester de type Normal." };
  if (cur.kind !== "normal" && p.data.kind !== cur.kind) {
    const { count } = await supabase.from("statuses").select("id", { count: "exact", head: true }).eq("org_id", g.s.org.id).eq("kind", cur.kind);
    if ((count ?? 0) <= 1) return { ok: false, error: `Il doit rester au moins un statut ${cur.kind === "won" ? "gagné" : "perdu"}.` };
  }
  const { id, ...patch } = p.data;
  const { data, error } = await supabase.from("statuses").update(patch).eq("id", id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: mapDbError(error?.message, "Enregistrement impossible."), fieldErrors: error?.code === "23505" ? { name: "Ce nom est déjà utilisé." } : undefined };
  return done();
}

export async function deleteStatusAction(input: unknown): Promise<ActionResult> {
  const g = await guard("statuses.manage", "statuses");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "status_tracking");
  if (locked) return { ok: false, error: locked };
  const p = deleteStatusSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { data: cur } = await supabase.from("statuses").select("kind, is_initial").eq("id", p.data.id).eq("org_id", g.s.org.id).maybeSingle();
  if (!cur) return { ok: false, error: "Statut introuvable." };
  if (cur.is_initial) return { ok: false, error: "Définissez un autre statut initial avant de supprimer celui-ci." };
  if (cur.kind !== "normal") {
    const { count } = await supabase.from("statuses").select("id", { count: "exact", head: true }).eq("org_id", g.s.org.id).eq("kind", cur.kind);
    if ((count ?? 0) <= 1) return { ok: false, error: `Il doit rester au moins un statut ${cur.kind === "won" ? "gagné" : "perdu"}.` };
  }
  const { data: counts } = await supabase.rpc("status_lead_counts", { p_org: g.s.org.id });
  const used = Number((counts as { status_id: string; n: number }[] | null)?.find((c) => c.status_id === p.data.id)?.n ?? 0);
  if (used > 0 && !p.data.replacementId) return { ok: false, error: `${used} lead(s) utilisent ce statut : choisissez un statut de remplacement.` };
  const { error } = await supabase.rpc("delete_status_replace", { p_org: g.s.org.id, p_status: p.data.id, p_replacement: p.data.replacementId ?? null });
  if (error) return { ok: false, error: mapDbError(error.message, "Suppression impossible.") };
  return done();
}

export async function reorderStatusesAction(input: unknown): Promise<ActionResult> {
  const g = await guard("statuses.manage", "statuses");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "status_tracking");
  if (locked) return { ok: false, error: locked };
  const p = reorderSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_statuses", { org: g.s.org.id, ids: p.data.ids });
  if (error) return { ok: false, error: mapDbError(error.message, "Réordonnancement impossible.") };
  return done();
}

export async function setInitialStatusAction(input: unknown): Promise<ActionResult> {
  const g = await guard("statuses.manage", "statuses");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "status_tracking");
  if (locked) return { ok: false, error: locked };
  const p = setInitialSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_initial_status", { org: g.s.org.id, status: p.data.id });
  if (error) return { ok: false, error: "Statut initial invalide (un statut final ne peut pas être initial)." };
  return done();
}

/** Remplace les transitions sortantes d'un statut. */
export async function saveTransitionsAction(input: unknown): Promise<ActionResult> {
  const g = await guard("statuses.manage", "statuses");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "status_tracking");
  if (locked) return { ok: false, error: locked };
  const p = saveTransitionsSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const orgId = g.s.org.id;
  const supabase = await createClient();
  const { data: from } = await supabase.from("statuses").select("kind").eq("id", p.data.fromId).eq("org_id", orgId).maybeSingle();
  if (!from) return { ok: false, error: "Statut introuvable." };
  if (from.kind !== "normal" && p.data.targets.length) return { ok: false, error: "Un statut final n'a pas de transition sortante." };
  const { error } = await supabase.rpc("save_transitions", {
    org: orgId,
    from_status: p.data.fromId,
    targets: p.data.targets.map((t) => ({ to: t.toId, roles: t.roles === "all" ? null : t.roles })),
  });
  if (error) return { ok: false, error: mapDbError(error.message, "Enregistrement impossible (statut ou rôle invalide).") };
  return done();
}

export async function saveActionsAction(input: unknown): Promise<ActionResult> {
  const g = await guard("statuses.manage", "statuses");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "status_tracking");
  if (locked) return { ok: false, error: locked };
  const p = saveActionsSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const orgId = g.s.org.id;
  const supabase = await createClient();
  const { data: st } = await supabase.from("statuses").select("id").eq("id", p.data.statusId).eq("org_id", orgId).maybeSingle();
  if (!st) return { ok: false, error: "Statut introuvable." };
  const roleIds = new Set<string>();
  const userIds = new Set<string>();
  for (const a of p.data.actions) {
    const c = a.config as { roleId?: string; userId?: string };
    if (c.roleId) roleIds.add(c.roleId);
    if (c.userId) userIds.add(c.userId);
  }
  if (roleIds.size) {
    const { data } = await supabase.from("roles").select("id").eq("org_id", orgId).in("id", [...roleIds]);
    if ((data?.length ?? 0) !== roleIds.size) return { ok: false, error: "Rôle invalide." };
  }
  if (userIds.size) {
    const { data } = await supabase.from("memberships").select("user_id").eq("org_id", orgId).eq("status", "active").in("user_id", [...userIds]);
    if ((data?.length ?? 0) !== userIds.size) return { ok: false, error: "Utilisateur invalide." };
  }
  const { error } = await supabase.rpc("save_status_actions", { org: orgId, status: p.data.statusId, actions: p.data.actions });
  if (error) return { ok: false, error: mapDbError(error.message, "Enregistrement impossible : vérifiez les rôles, utilisateurs et URL.") };
  return done();
}

/** Envoie un POST de test (sans données sensibles) via safeFetch (anti-SSRF / DNS rebinding). */
export async function testWebhookAction(input: unknown): Promise<ActionResult<{ status: number }>> {
  const g = await guard("statuses.manage", "webhook-test");
  if ("error" in g) return { ok: false, error: g.error };
  const p = webhookUrlSchema.safeParse((input as { url?: unknown })?.url);
  if (!p.success) return { ok: false, error: "URL https publique requise.", fieldErrors: { url: "URL https publique requise." } };
  try {
    const res = await safeFetch(p.data, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "LeadForge-Webhook-Test" },
      body: JSON.stringify({ event: "test", org: g.s.org.slug }),
    });
    return { ok: true, data: { status: res.status } };
  } catch (e) {
    return { ok: false, error: e instanceof UnsafeUrlError ? e.message : "Le webhook n'a pas répondu." };
  }
}

/** Matrice « qui peut poser quel statut » : remplacement atomique (la base refuse toute escalade). */
export async function saveStatusGrantsAction(input: unknown): Promise<ActionResult> {
  const g = await guard("statuses.manage", "statuses");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "status_tracking");
  if (locked) return { ok: false, error: locked };
  const p = saveGrantsSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_status_grants", {
    org: g.s.org.id,
    grants: p.data.grants.map((x) => ({ status: x.statusId, role: x.roleId, place: x.place, create: x.place && x.create })),
  });
  if (error) return { ok: false, error: mapDbError(error.message, "Enregistrement impossible (statut ou rôle invalide).") };
  return done();
}
