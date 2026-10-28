"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { sendMail } from "@/lib/mailer";
import { memberAccountMail } from "@/lib/mail/templates";
import { notifySeatLimitReached } from "@/lib/billing/mails";
import { createAdminClient } from "@/lib/supabase/admin";
import { createInvitedUser, inviteLink } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow } from "@/lib/rate-limit-server";
import { getEntitlement, isWritable } from "@/lib/billing/access";
import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlement";
import { featureError, roleError } from "@/lib/billing/feature-guard";
import { isFieldRole } from "@/lib/permissions";
import { requireSession, sessionCan } from "@/lib/session";
import { createMemberSchema, fieldErrors, firstError, memberStatusSchema, updateMemberRoleSchema } from "@/lib/validation/auth";

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const DENIED: ActionResult = { ok: false, error: "Permission insuffisante." };
const ACCOUNT_CREATE_FAILED = "Création impossible avec cette adresse. Si la personne a déjà un compte, demandez-lui de vous le confirmer.";

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
  const { fullName, email, roleId, domainIds } = parsed.data;

  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id, name, is_admin, is_system, system_key").eq("id", roleId).eq("org_id", s.org.id).maybeSingle();
  if (!role) return { ok: false, error: "Rôle introuvable." };
  if (role.is_admin && !s.isAdmin) return DENIED;
  // Rôles spécialisés / sur mesure : Pro et au-dessus (essai : tout est permis). Seules les NOUVELLES attributions sont bloquées.
  const roleLocked = await roleError(s.org.id, role);
  if (roleLocked) return { ok: false, error: roleLocked };

  // Places : celles de la régie maître si l'organisation est une sous-régie (la maître paie pour toutes).
  const seats = await getEntitlement(s.org.id, true);
  if (seats.seatLimit !== null && seats.seatsUsed >= seats.seatLimit) {
    after(() => notifySeatLimitReached(s.org.id, seats.seatLimit!)); // prévient les administrateurs (au plus 1 mail / semaine)
    return { ok: false, error: mapDbError("seat_limit_reached") };
  }

  const admin = createAdminClient();
  // Compte sans mot de passe utilisable : la personne le choisit via le lien d'invitation à usage unique.
  const created = await createInvitedUser({ email, fullName, orgId: s.org.id });
  // Message neutre : ne révèle pas si l'adresse a déjà un compte (énumération inter-organisations).
  if (!created) return { ok: false, error: ACCOUNT_CREATE_FAILED };

  const { error } = await supabase
    .from("memberships")
    .insert({ org_id: s.org.id, user_id: created.userId, role_id: roleId, status: "active" });
  if (error) {
    await admin.auth.admin.deleteUser(created.userId);
    return { ok: false, error: mapDbError(error.message) };
  }
  // Domaines de travail (facultatif, plan Pro+) : un échec n'annule pas l'invitation, l'administrateur les règle ensuite dans la fiche du membre.
  if (domainIds?.length && !(await featureError(s.org.id, "call_script_programming")) && (sessionCan(s, "members.manage") || sessionCan(s, "settings.manage"))) {
    await supabase.from("member_call_domains").insert(domainIds.map((domain_id) => ({ org_id: s.org.id, user_id: created.userId, domain_id })));
  }
  const resetUrl = await inviteLink(email);
  if (!resetUrl) {
    await admin.auth.admin.deleteUser(created.userId); // sans lien, le compte serait inaccessible : on annule (cascade sur le siège)
    return { ok: false, error: "Invitation impossible pour le moment. Réessayez." };
  }
  revalidatePath("/settings/members");
  // Invitation envoyée après la réponse ; un échec d'e-mail ne remet pas en cause la création (le membre peut utiliser « Mot de passe oublié »).
  after(() => sendMail({ to: email, ...memberAccountMail({ memberName: fullName, orgName: s.org.name, inviterName: s.profile.full_name ?? s.user.email, roleName: role.name, email, resetUrl }) }).then(() => undefined, () => undefined));
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
  const { data: role } = await supabase.from("roles").select("name, is_admin, is_system, system_key, is_field, permissions").eq("id", parsed.data.roleId).eq("org_id", s.org.id).maybeSingle();
  if (!role) return { ok: false, error: "Rôle introuvable." };
  // Gating par plan : on bloque seulement la nouvelle attribution (un membre déjà Pro après un downgrade garde son rôle, mais ne peut pas le reprendre une fois changé).
  const roleLocked = await roleError(s.org.id, role);
  if (roleLocked) return { ok: false, error: roleLocked };
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
  // Les zones ne concernent que les rôles terrain : le nouveau rôle n'en est pas un, on désactive la zone (le trigger SQL
  // 20260202000001 le fait aussi ; ceci couvre l'intervalle avant migration). Échec ignoré : la répartition filtre de toute façon.
  if (!isFieldRole({ is_admin: role.is_admin, is_field: role.is_field, permissions: role.permissions ?? [] })) {
    await supabase.from("sales_zones").update({ active: false }).eq("org_id", s.org.id).eq("user_id", target.user_id).eq("active", true);
  }
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
