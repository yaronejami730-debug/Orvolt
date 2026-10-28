"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow } from "@/lib/rate-limit-server";
import { isWritable } from "@/lib/billing/access";
import { featureError } from "@/lib/billing/feature-guard";
import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlement";
import { requireSession, sessionCan } from "@/lib/session";
import { fieldErrors, firstError, roleSchema } from "@/lib/validation/auth";
import type { ActionResult } from "../members/actions";

const DENIED: ActionResult = { ok: false, error: "Permission insuffisante." };

/** Messages des garde-fous de la base (anti-escalade). */
function roleDbError(code: string | undefined, message: string | undefined, fallback: string): string {
  if (code === "23505") return "Ce nom est déjà utilisé.";
  if (/administrator_role_locked|super_admin_only/.test(message ?? "")) return "Seul le super administrateur peut modifier ce rôle.";
  if (/self_escalation/.test(message ?? "")) return "Vous ne pouvez pas vous accorder de nouveaux droits.";
  if (/permission_escalation/.test(message ?? "")) return "Vous ne pouvez pas accorder des permissions que vous ne possédez pas.";
  return fallback;
}

export async function saveRoleAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  if (!sessionCan(s, "roles.manage")) return DENIED;
  if (!(await allow("roles", s.user.id, RULES.sensitive))) return { ok: false, error: RATE_LIMIT_MESSAGE };
  if (!(await isWritable(s.org.id))) return { ok: false, error: READ_ONLY_MESSAGE };
  const locked = await featureError(s.org.id, "custom_roles");
  if (locked) return { ok: false, error: locked };
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrors(parsed.error) };
  const { id, name, description, permissions, isField } = parsed.data;
  const supabase = await createClient();

  if (id) {
    const { data: existing } = await supabase.from("roles").select("is_admin, is_system, system_key").eq("id", id).eq("org_id", s.org.id).maybeSingle();
    if (!existing) return { ok: false, error: "Rôle introuvable." };
    if (existing.is_admin) return { ok: false, error: "Le rôle Super administrateur ne peut pas être modifié." };
    if (existing.system_key === "administrator" && !s.isAdmin) return { ok: false, error: "Seul le super administrateur peut modifier le rôle Administrateur." };
    // is_field : si le rôle cesse d'être terrain (case décochée ou permission retirée), un trigger SQL désactive les zones
    // de ses membres (20260202000001) ; la répartition ignore de toute façon les zones de non-terrain.
    const patch = existing.is_system ? { description: description ?? null, permissions, is_field: isField } : { name, description: description ?? null, permissions, is_field: isField };
    const { data, error } = await supabase.from("roles").update(patch).eq("id", id).eq("org_id", s.org.id).select("id");
    if (error || !data?.length) return { ok: false, error: roleDbError(error?.code, error?.message, "Enregistrement impossible.") };
  } else {
    const { error } = await supabase
      .from("roles")
      .insert({ org_id: s.org.id, name, description: description ?? null, permissions, is_system: false, is_admin: false, is_field: isField });
    if (error) return { ok: false, error: roleDbError(error.code, error.message, "Création impossible.") };
  }
  revalidatePath("/settings/roles");
  return { ok: true };
}

export async function deleteRoleAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  if (!sessionCan(s, "roles.manage")) return DENIED;
  if (!(await allow("roles", s.user.id, RULES.sensitive))) return { ok: false, error: RATE_LIMIT_MESSAGE };
  if (!(await isWritable(s.org.id))) return { ok: false, error: READ_ONLY_MESSAGE };
  const locked = await featureError(s.org.id, "custom_roles");
  if (locked) return { ok: false, error: locked };
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("is_system").eq("id", parsed.data.id).eq("org_id", s.org.id).maybeSingle();
  if (!role) return { ok: false, error: "Rôle introuvable." };
  if (role.is_system) return { ok: false, error: "Un rôle système ne peut pas être supprimé." };
  const { data, error } = await supabase.from("roles").delete().eq("id", parsed.data.id).eq("org_id", s.org.id).select("id");
  if (error?.code === "23503") return { ok: false, error: "Ce rôle est encore attribué à des membres." };
  if (error || !data?.length) return { ok: false, error: "Suppression impossible." };
  revalidatePath("/settings/roles");
  return { ok: true };
}
