"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifySeatLimitReached } from "@/lib/billing/mails";
import { sendMail } from "@/lib/mailer";
import { partnerInviteMail } from "@/lib/mail/templates";
import { z } from "zod";
import { getEntitlement, isWritable } from "@/lib/billing/access";
import { applyTemplate } from "@/lib/apply-template";
import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlement";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow } from "@/lib/rate-limit-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createInvitedUser, inviteLink } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/session";
import { ENABLED_TEMPLATE_IDS } from "@/lib/templates";
import { fieldErrors, firstError, isValidSiret } from "@/lib/validation/auth";
import { lookupSiret } from "@/lib/siret-lookup";
import type { ActionResult } from "@/lib/action-guard";

const DENIED_MSG = "Action réservée au super administrateur de la régie maître.";
const DENIED: ActionResult = { ok: false, error: DENIED_MSG };
const email = z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide."));
const manager = z.object({
  fullName: z.string().trim().min(2, "Nom trop court.").max(80, "Nom trop long."),
  email,
});
const createSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court.").max(80, "Nom trop long."),
  template: z.enum(ENABLED_TEMPLATE_IDS).optional(),
  siret: z.string().trim().refine((v) => v === "" || isValidSiret(v), "Numéro de SIRET invalide (14 chiffres).").transform((v) => v.replace(/\s/g, "")).nullish(),
  phone: z.string().trim().regex(/^(\+?[0-9 .()-]{6,20})?$/, "Numéro de téléphone invalide.").nullish(),
  manager: manager.nullish(),
});

const ERRORS: [string, string][] = [
  ["partner_limit", "Limite de 50 régies partenaires atteinte."],
  ["partner_depth", "Une régie partenaire ne peut pas gérer elle-même de régies."],
  ["org_read_only", READ_ONLY_MESSAGE],
  ["forbidden", DENIED_MSG],
  ["seat_limit_reached", "Plus de place disponible : ajoutez des utilisateurs à votre abonnement."],
];
const mapError = (m?: string) => ERRORS.find(([k]) => m?.includes(k))?.[1] ?? "Opération impossible. Réessayez.";

/** Contexte commun : super administrateur d'une régie maître (pas d'une sous-régie), abonnement actif, débit limité. */
async function master() {
  const s = await requireSession();
  if (!s.isAdmin || s.org.parent_org_id) return { ok: false as const, error: DENIED };
  if (!(await allow("partners", s.user.id, RULES.sensitive))) return { ok: false as const, error: { ok: false, error: RATE_LIMIT_MESSAGE } as ActionResult };
  if (!(await isWritable(s.org.id))) return { ok: false as const, error: { ok: false, error: READ_ONLY_MESSAGE } as ActionResult };
  return { ok: true as const, s };
}

/** Invitation du responsable de la sous-régie (lien à usage unique pour choisir son mot de passe), envoyée après la réponse ; un échec n'est jamais bloquant. */
function inviteManager(to: string, resetUrl: string, parentOrgName: string, partnerOrgName: string, inviterName: string) {
  after(() => sendMail({ to, ...partnerInviteMail({ parentOrgName, partnerOrgName, inviterName, resetUrl }) }).then(() => undefined, () => undefined));
}

/** Crée le compte du responsable d'une sous-régie : super administrateur de CETTE sous-régie uniquement. */
async function addManager(parentId: string, orgId: string, m: z.infer<typeof manager>): Promise<ActionResult & { resetUrl?: string }> {
  const seats = await getEntitlement(parentId, true);
  if (seats.seatLimit !== null && seats.seatsUsed >= seats.seatLimit) {
    after(() => notifySeatLimitReached(parentId, seats.seatLimit!)); // prévient les administrateurs (au plus 1 mail / semaine)
    return { ok: false, error: mapError("seat_limit_reached") };
  }
  const admin = createAdminClient();
  const { data: role } = await admin.from("roles").select("id").eq("org_id", orgId).eq("system_key", "super_admin").single();
  if (!role) return { ok: false, error: "Rôle introuvable." };
  // Compte sans mot de passe utilisable ; le responsable le choisit via un lien à usage unique.
  const created = await createInvitedUser({ email: m.email, fullName: m.fullName, orgId });
  // Message neutre : ne révèle pas si l'adresse a déjà un compte (énumération inter-organisations).
  if (!created) return { ok: false, error: "Création impossible avec cette adresse. Si la personne a déjà un compte, demandez-lui de vous le confirmer." };
  const { error } = await admin.from("memberships").insert({ org_id: orgId, user_id: created.userId, role_id: role.id, status: "active" });
  if (error) { await admin.auth.admin.deleteUser(created.userId); return { ok: false, error: mapError(error.message) }; }
  const resetUrl = await inviteLink(m.email);
  if (!resetUrl) { await admin.auth.admin.deleteUser(created.userId); return { ok: false, error: "Invitation impossible pour le moment. Réessayez." }; }
  return { ok: true, resetUrl };
}

/** Crée une régie partenaire (sous-régie), avec son responsable si fourni. La régie maître y accède automatiquement. */
export async function createPartnerAction(input: unknown): Promise<ActionResult> {
  const c = await master();
  if (!c.ok) return c.error;
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const { data: orgId, error } = await (await createClient()).rpc("create_partner_organization", { p_parent: c.s.org.id, p_name: p.data.name, p_template: p.data.template ?? c.s.org.template });
  if (error || !orgId) return { ok: false, error: mapError(error?.message) };
  if (p.data.siret || p.data.phone) {
    const verified = p.data.siret ? (await lookupSiret(p.data.siret)).status === "found" : false;
    await createAdminClient().from("organizations").update({ siret: p.data.siret || null, phone: p.data.phone || null, siret_verified: verified }).eq("id", orgId as string);
  }
  // Statuts, champs et sources du métier (comme à l'inscription ; échec non bloquant, réessayable depuis la régie).
  await applyTemplate(orgId as string, p.data.template ?? c.s.org.template);
  if (p.data.manager) {
    const r = await addManager(c.s.org.id, orgId as string, p.data.manager);
    if (r.ok && r.resetUrl) inviteManager(p.data.manager.email, r.resetUrl, c.s.org.name, p.data.name, c.s.profile.full_name ?? c.s.user.email);
    if (!r.ok) { revalidatePath("/settings/partners"); return { ok: false, error: `La régie « ${p.data.name} » est créée, mais son responsable non : ${r.error}` }; }
  }
  revalidatePath("/settings/partners");
  return { ok: true };
}

/** Ajoute le responsable d'une régie partenaire existante. */
export async function addPartnerManagerAction(input: unknown): Promise<ActionResult> {
  const c = await master();
  if (!c.ok) return c.error;
  const p = z.object({ orgId: z.uuid(), manager }).safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const { data: child } = await createAdminClient().from("organizations").select("id, name").eq("id", p.data.orgId).eq("parent_org_id", c.s.org.id).maybeSingle();
  if (!child) return { ok: false, error: "Régie introuvable." };
  const r = await addManager(c.s.org.id, child.id as string, p.data.manager);
  if (r.ok && r.resetUrl) { inviteManager(p.data.manager.email, r.resetUrl, c.s.org.name, child.name as string, c.s.profile.full_name ?? c.s.user.email); revalidatePath("/settings/partners"); }
  return r.ok ? { ok: true } : { ok: false, error: r.error }; // jamais le lien d'invitation vers le navigateur
}

/**
 * Questions de l'onboarding. Installateur : gère-t-il des poseurs ? travaille-t-il avec des régies ? est-il aussi une régie ?
 * Régie : gère-t-elle des sous-régies ? Les réponses orientent l'espace de configuration ; elles ne bloquent rien.
 */
const profileSchema = z.object({
  type: z.enum(["installer", "agency"]),
  managesInstallers: z.boolean().default(false),
  worksWithAgencies: z.boolean().default(false),
  alsoAgency: z.boolean().default(false),
  managesSubAgencies: z.boolean().default(false),
});
export async function saveProfileAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  const p = profileSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Choisissez installateur ou régie." };
  if (!s.isAdmin || s.org.parent_org_id) return DENIED;
  const { type, ...answers } = p.data;
  const { error } = await (await createClient()).rpc("set_org_profile", { p_org: s.org.id, p_type: type, p_answers: type === "installer" ? { managesInstallers: answers.managesInstallers, worksWithAgencies: answers.worksWithAgencies, alsoAgency: answers.alsoAgency } : { managesSubAgencies: answers.managesSubAgencies } });
  if (error) return { ok: false, error: mapError(error.message) };
  revalidatePath("/onboarding");
  return { ok: true };
}
