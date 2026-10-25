"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow } from "@/lib/rate-limit-server";
import { isWritable } from "@/lib/billing/access";
import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlement";
import { requireSession, sessionCan } from "@/lib/session";
import { createMemberSchema, fieldErrors, firstError, memberStatusSchema, updateMemberRoleSchema } from "@/lib/validation/auth";

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const DENIED: ActionResult = { ok: false, error: "Permission insuffisante." };

function mapDbError(message: string | undefined): string {
  if (message?.includes("seat_limit_reached")) return "Limite de sièges atteinte. Passez à un plan supérieur.";
  if (message?.includes("last_admin")) return "Il doit rester au moins un administrateur actif.";
  if (message?.includes("org_read_only")) return READ_ONLY_MESSAGE;
  if (message?.includes("row-level security")) return DENIED.error!;
  if (message?.includes("role_above_caller")) return "Ce rôle dépasse vos propres droits : seul un rôle égal ou inférieur au vôtre peut être attribué.";
  if (message?.includes("self_role_change")) return "Vous ne pouvez pas changer votre propre rôle.";
  return "Opération impossible. Réessayez.";
}

async function activeAdminCount(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("id, role:roles!inner(is_admin)")
    .eq("org_id", orgId)
    .eq("status", "active")
    .eq("role.is_admin", true);
  return data?.length ?? 0;
}

export async function createMemberAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  if (!sessionCan(s, "members.manage")) return DENIED;
  if (!(await allow("members", s.user.id, RULES.sensitive))) return { ok: false, error: RATE_LIMIT_MESSAGE };
  if (!(await isWritable(s.org.id))) return { ok: false, error: READ_ONLY_MESSAGE };
  const parsed = createMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrors(parsed.error) };
  const { fullName, email, password, roleId } = parsed.data;

  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id, is_admin").eq("id", roleId).eq("org_id", s.org.id).maybeSingle();
  if (!role) return { ok: false, error: "Rôle introuvable." };
  if (role.is_admin && !s.isAdmin) return DENIED;

  if (s.org.seat_limit !== null) {
    const { count } = await supabase
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("org_id", s.org.id)
      .eq("status", "active");
    if ((count ?? 0) >= s.org.seat_limit) return { ok: false, error: mapDbError("seat_limit_reached") };
  }

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { provisioned_org: s.org.id },
  });
  if (createError || !created.user) {
    const exists = createError?.message.toLowerCase().includes("already");
    return { ok: false, error: exists ? "Un compte existe déjà avec cet e-mail." : "Création du compte impossible." };
  }

  const { error } = await supabase
    .from("memberships")
    .insert({ org_id: s.org.id, user_id: created.user.id, role_id: roleId, status: "active" });
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: mapDbError(error.message) };
  }
  revalidatePath("/settings/members");
  return { ok: true };
}

async function loadTarget(membershipId: string, orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("id, user_id, status, role:roles(is_admin)")
    .eq("id", membershipId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data as unknown as { id: string; user_id: string; status: string; role: { is_admin: boolean } } | null;
}

export async function updateMemberRoleAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  if (!sessionCan(s, "members.manage")) return DENIED;
  if (!(await allow("members", s.user.id, RULES.sensitive))) return { ok: false, error: RATE_LIMIT_MESSAGE };
  if (!(await isWritable(s.org.id))) return { ok: false, error: READ_ONLY_MESSAGE };
  const parsed = updateMemberRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const target = await loadTarget(parsed.data.membershipId, s.org.id);
  if (!target) return { ok: false, error: "Membre introuvable." };

  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("is_admin").eq("id", parsed.data.roleId).eq("org_id", s.org.id).maybeSingle();
  if (!role) return { ok: false, error: "Rôle introuvable." };
  if (target.role.is_admin && !role.is_admin && target.status === "active" && (await activeAdminCount(s.org.id)) <= 1) {
    return { ok: false, error: "Il doit rester au moins un administrateur actif." };
  }
  const { data, error } = await supabase
    .from("memberships")
    .update({ role_id: parsed.data.roleId })
    .eq("id", target.id)
    .eq("org_id", s.org.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: mapDbError(error?.message ?? "row-level security") };
  revalidatePath("/settings/members");
  return { ok: true };
}

export async function setMemberStatusAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  if (!sessionCan(s, "members.manage")) return DENIED;
  if (!(await allow("members", s.user.id, RULES.sensitive))) return { ok: false, error: RATE_LIMIT_MESSAGE };
  const parsed = memberStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  // Lecture seule : seule la désactivation reste permise (repasser sous le quota de sièges).
  if (parsed.data.status !== "disabled" && !(await isWritable(s.org.id))) return { ok: false, error: READ_ONLY_MESSAGE };
  const target = await loadTarget(parsed.data.membershipId, s.org.id);
  if (!target) return { ok: false, error: "Membre introuvable." };
  if (target.user_id === s.user.id) return { ok: false, error: "Vous ne pouvez pas modifier votre propre accès." };
  if (parsed.data.status === "disabled" && target.role.is_admin && (await activeAdminCount(s.org.id)) <= 1) {
    return { ok: false, error: "Il doit rester au moins un administrateur actif." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .update({ status: parsed.data.status })
    .eq("id", target.id)
    .eq("org_id", s.org.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: mapDbError(error?.message ?? "row-level security") };
  revalidatePath("/settings/members");
  return { ok: true };
}
