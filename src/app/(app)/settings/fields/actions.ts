"use server";

import { revalidatePath } from "next/cache";
import { guard, mapDbError, type ActionResult } from "@/lib/action-guard";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, firstError } from "@/lib/validation/auth";
import { fieldInputSchema, idSchema, reorderSchema, slugifyKey } from "@/lib/validation/workflow";

const done = (): ActionResult => {
  revalidatePath("/settings/fields");
  return { ok: true };
};

export async function saveFieldAction(input: unknown): Promise<ActionResult> {
  const g = await guard("fields.manage", "fields");
  if ("error" in g) return { ok: false, error: g.error };
  const p = fieldInputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const f = p.data;
  const orgId = g.s.org.id;
  const supabase = await createClient();

  // Les rôles référencés doivent appartenir à l'org.
  const roleIds = [...new Set([...(f.visibleRoles ?? []), ...(f.editableRoles ?? [])])];
  if (roleIds.length) {
    const { data } = await supabase.from("roles").select("id").eq("org_id", orgId).in("id", roleIds);
    if ((data?.length ?? 0) !== roleIds.length) return { ok: false, error: "Rôle invalide." };
  }
  const options =
    f.type === "select"
      ? { choices: f.choices ?? [], multiple: f.multiple ?? false }
      : f.type === "number"
        ? { ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) }
        : {};

  if (f.id) {
    const { data, error } = await supabase
      .from("custom_fields")
      .update({ label: f.label, options, required: f.required, visible_roles: f.visibleRoles, editable_roles: f.editableRoles })
      .eq("id", f.id)
      .eq("org_id", orgId)
      .select("id");
    if (error || !data?.length) return { ok: false, error: mapDbError(error?.message, "Enregistrement impossible."), fieldErrors: error?.code === "23505" ? { label: "Ce nom est déjà utilisé." } : undefined };
    return done();
  }

  const { data: existing } = await supabase.from("custom_fields").select("key, position").eq("org_id", orgId);
  if ((existing?.length ?? 0) >= 50) return { ok: false, error: "Limite de 50 champs atteinte." };
  const taken = new Set((existing ?? []).map((e) => e.key));
  const base = slugifyKey(f.label);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 36)}_${i}`;
  const position = Math.max(-1, ...(existing ?? []).map((e) => e.position)) + 1;
  const { error } = await supabase.from("custom_fields").insert({
    org_id: orgId,
    key,
    label: f.label,
    type: f.type,
    options,
    required: f.required,
    position,
    visible_roles: f.visibleRoles,
    editable_roles: f.editableRoles,
  });
  if (error) return { ok: false, error: mapDbError(error.message, "Création impossible."), fieldErrors: error.code === "23505" ? { label: "Ce nom est déjà utilisé." } : undefined };
  return done();
}

export async function deleteFieldAction(input: unknown): Promise<ActionResult> {
  const g = await guard("fields.manage", "fields");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("custom_fields").delete().eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Suppression impossible." };
  return done();
}

export async function reorderFieldsAction(input: unknown): Promise<ActionResult> {
  const g = await guard("fields.manage", "fields");
  if ("error" in g) return { ok: false, error: g.error };
  const p = reorderSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_fields", { org: g.s.org.id, ids: p.data.ids });
  if (error) return { ok: false, error: mapDbError(error.message, "Réordonnancement impossible.") };
  return done();
}
