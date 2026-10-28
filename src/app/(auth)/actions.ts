"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors, firstError, forgotSchema, loginSchema, resetSchema, signupSchema } from "@/lib/validation/auth";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow, clientIp } from "@/lib/rate-limit-server";
import { applyTemplate } from "@/lib/apply-template";
import { lookupSiret } from "@/lib/siret-lookup";
import { checkCode, issueCode, PROOF_COOKIE, PROOF_TTL_MS, signProof, verifyProof } from "@/lib/email-verification";
import { sendMail } from "@/lib/mailer";
import { passwordResetMail, verificationCodeMail, welcomeMail } from "@/lib/mail/templates";
import { siteUrl } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { parsePlanIntent, sanitizeSource } from "@/lib/funnel/intent";
import { trackFunnel } from "@/lib/funnel/track";
import { planRequired } from "@/lib/onboarding";
import { after } from "next/server";
import { z } from "zod";
import { ORG_COOKIE, ORG_COOKIE_OPTIONS } from "@/lib/session";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  fieldValues?: Record<string, string>;
}

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: str(fd, "email"), password: str(fd, "password") });
  if (!parsed.success) return { error: firstError(parsed.error), fieldErrors: fieldErrors(parsed.error), fieldValues: { email: str(fd, "email") } };
  if (!(await allow("login", `${(await clientIp()) ?? "unknown"}:${parsed.data.email}`, RULES.login))) return { error: RATE_LIMIT_MESSAGE, fieldValues: { email: parsed.data.email } };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "E-mail ou mot de passe incorrect.", fieldValues: { email: parsed.data.email } };
  redirect("/dashboard");
}

export async function signupAction(_: FormState, fd: FormData): Promise<FormState> {
  const raw = {
    firstName: str(fd, "firstName"),
    lastName: str(fd, "lastName"),
    email: str(fd, "email"),
    password: str(fd, "password"),
    orgName: str(fd, "orgName"),
    siret: str(fd, "siret"),
    phone: str(fd, "phone"),
    orgType: str(fd, "orgType"),
  };
  // Intention de formule et source d'acquisition (liens des CTA / de la page tarifs) : revalidées, jamais prises telles quelles.
  const intent = parsePlanIntent(str(fd, "plan"), str(fd, "interval"));
  const source = sanitizeSource(str(fd, "src"));
  const keep = { firstName: raw.firstName, lastName: raw.lastName, email: raw.email, orgName: raw.orgName, siret: raw.siret, phone: raw.phone, orgType: raw.orgType };
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) return { error: firstError(parsed.error), fieldErrors: fieldErrors(parsed.error), fieldValues: keep };
  const { firstName, lastName, email, password, orgName, siret, phone, orgType, template } = parsed.data;
  // IP inconnue : clé par e-mail (pas de seau « global » partagé que n'importe qui pourrait épuiser).
  const ip = await clientIp();
  if (!(await allow(ip ? "signup" : "signup-email", ip ?? email, RULES.signup))) return { error: RATE_LIMIT_MESSAGE, fieldValues: keep };
  const fullName = `${firstName} ${lastName}`;

  // L'adresse doit avoir été vérifiée (code à 6 chiffres) : preuve signée, liée à cette adresse, posée par verifySignupCodeAction.
  if (!verifyProof((await cookies()).get(PROOF_COOKIE)?.value, email)) return { error: "Vérifiez d'abord votre adresse e-mail avec le code reçu.", fieldErrors: { email: "Adresse e-mail non vérifiée." }, fieldValues: keep };

  // Compte créé déjà confirmé (adresse vérifiée par nos soins), puis ouverture de session.
  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (created.error || !created.data.user) {
    // Énumération de comptes : message volontairement neutre ; l'UX « e-mail déjà pris » est sacrifiée.
    return { error: "Inscription impossible avec ces informations. Si vous avez déjà un compte, connectez-vous.", fieldValues: keep };
  }
  const supabase = await createClient();
  const signed = await supabase.auth.signInWithPassword({ email, password });
  const data = { user: created.data.user };
  if (signed.error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    return { error: "Inscription impossible. Réessayez.", fieldValues: keep };
  }
  (await cookies()).delete(PROOF_COOKIE);

  const { data: orgId, error: rpcError } = await supabase.rpc("create_organization", { p_name: orgName, p_template: template });
  if (rpcError || !orgId) {
    // Nettoyage : évite un compte orphelin sans organisation.
    await createAdminClient().auth.admin.deleteUser(data.user.id);
    await supabase.auth.signOut();
    const capped = rpcError?.message.includes("org_limit_reached");
    return { error: capped ? "Limite d'organisations atteinte." : "Création de l'entreprise impossible. Réessayez.", fieldValues: keep };
  }
  // Activité (installateur / régie) et intention de formule : une seule saisie, plus d'écran d'onboarding dédié.
  const { error: profileErr } = await supabase.rpc("set_org_profile", { p_org: orgId, p_type: orgType, p_answers: { ...(intent.plan ? { planIntent: intent.plan, intervalIntent: intent.interval } : {}) } });
  (await cookies()).set(ORG_COOKIE, orgId as string, ORG_COOKIE_OPTIONS);
  // Identité immédiate (sans réseau) + modèle métier en parallèle ; la relecture SIRET (réseau) passe APRÈS la réponse.
  // Échec non bloquant : l'écran d'onboarding propose de réessayer, l'identité reste modifiable.
  await Promise.all([
    admin.from("organizations").update({ siret, phone, siret_verified: false }).eq("id", orgId as string).then(() => undefined),
    applyTemplate(orgId as string, template),
  ]);
  after(async () => {
    // Le SIRET est « vérifié » si l'API publique le reconnaît (jamais d'après ce que le navigateur prétend) ; infos d'entreprise issues de la même relecture serveur.
    try {
      const found = await lookupSiret(siret);
      if (found.status === "found") {
        const companyInfo = { addressLine: found.addressLine, postalCode: found.postalCode, city: found.city, legalForm: found.legalForm, legalFormCode: found.legalFormCode, nafCode: found.nafCode, nafLabel: found.nafLabel, createdAt: found.createdAt, active: found.active };
        const { error } = await admin.from("organizations").update({ siret_verified: true, company_info: companyInfo }).eq("id", orgId as string);
        // Colonne company_info absente (migration non appliquée) : on enregistre au moins la vérification.
        if (error) await admin.from("organizations").update({ siret_verified: true }).eq("id", orgId as string);
      }
    } catch { /* non bloquant */ }
    await trackFunnel("account_created", { orgId: orgId as string, email, plan: intent.plan, interval: intent.interval, source });
    if (!profileErr) await trackFunnel("onboarding_done", { orgId: orgId as string, email, plan: intent.plan, interval: intent.interval, source });
  });
  // Bienvenue : envoi après la réponse, un échec d'e-mail ne bloque jamais l'inscription.
  after(() => sendMail({ to: email, ...welcomeMail({ firstName, orgName, trialDays: TRIAL_DAYS }) }).then(() => undefined, () => undefined));
  // Formule exigée : on enchaîne directement sur le choix de formule (la page lit l'intention enregistrée) ; sinon synthèse de l'espace.
  redirect(profileErr ? "/onboarding/activite" : planRequired() ? "/onboarding/plan" : "/onboarding");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ORG_COOKIE);
  redirect("/login");
}

// ---------------------------------------------------------------- mot de passe oublié
export interface ResetState extends FormState { sent?: boolean }

/**
 * Envoie un lien de réinitialisation. Réponse toujours identique (compte existant ou non) pour ne pas révéler les adresses inscrites.
 * Le jeton vient de Supabase (generateLink, usage unique, 1 h) ; le mail est envoyé par notre propre fournisseur, au design du site.
 */
export async function forgotPasswordAction(_: ResetState, fd: FormData): Promise<ResetState> {
  const parsed = forgotSchema.safeParse({ email: str(fd, "email") });
  if (!parsed.success) return { error: firstError(parsed.error), fieldErrors: fieldErrors(parsed.error), fieldValues: { email: str(fd, "email") } };
  const { email } = parsed.data;
  // IP inconnue : seule la clé par e-mail s'applique (pas de seau « global » partagé).
  const ip = await clientIp();
  const ok = ip ? (await allow("password-reset", `${ip}:${email}`, RULES.passwordReset)) && (await allow("password-reset-ip", ip, RULES.passwordResetIp)) : await allow("password-reset-email", email, RULES.passwordReset);
  if (!ok) return { error: RATE_LIMIT_MESSAGE, fieldValues: { email } };

  // Tout le travail (génération du jeton + envoi) se fait après la réponse : durée identique, compte existant ou non.
  after(async () => {
    try {
      const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) return;
      const fullName = typeof data.user?.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : "";
      const resetUrl = `${siteUrl()}/reset?token_hash=${encodeURIComponent(tokenHash)}`;
      await sendMail({ to: email, ...passwordResetMail({ firstName: fullName.split(" ")[0] || null, resetUrl }) });
    } catch {
      // échec silencieux : la réponse est identique dans tous les cas
    }
  });
  return { sent: true, fieldValues: { email } };
}

/** Applique le nouveau mot de passe. Le jeton n'est consommé qu'ici (POST), jamais au chargement de la page : les scanners de liens des messageries ne le brûlent pas. */
export async function resetPasswordAction(_: ResetState, fd: FormData): Promise<ResetState> {
  const parsed = resetSchema.safeParse({ password: str(fd, "password"), confirm: str(fd, "confirm") });
  if (!parsed.success) return { error: firstError(parsed.error), fieldErrors: fieldErrors(parsed.error) };
  const tokenHash = str(fd, "token_hash");
  if (!tokenHash) return { error: "Lien invalide ou expiré. Demandez un nouveau lien." };
  // IP inconnue : seau par jeton (jamais « global »).
  if (!(await allow("password-reset-apply", (await clientIp()) ?? `tok:${tokenHash.slice(0, 64)}`, RULES.passwordResetApply))) return { error: RATE_LIMIT_MESSAGE };

  const supabase = await createClient();
  const verified = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (verified.error) return { error: "Lien invalide ou expiré. Demandez un nouveau lien." };
  const updated = await supabase.auth.updateUser({ password: parsed.data.password });
  if (updated.error) {
    await supabase.auth.signOut();
    return { error: "Mot de passe non modifié. Demandez un nouveau lien." };
  }
  // Toute autre session ouverte avec l'ancien mot de passe est coupée.
  await supabase.auth.signOut({ scope: "others" });
  redirect("/dashboard");
}

// ---------------------------------------------------------------- vérification de l'adresse e-mail (code à 6 chiffres)
export interface CodeState { ok?: boolean; error?: string; retryInSec?: number; devCode?: string }
const emailOnly = z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide."));

/** Envoie un code à 6 chiffres (valable 10 min). `devCode` n'est renvoyé qu'en développement sans fournisseur d'e-mail. */
export async function sendSignupCodeAction(rawEmail: string, meta?: { plan?: string; interval?: string; src?: string }): Promise<CodeState> {
  const email = emailOnly.safeParse(rawEmail);
  if (!email.success) return { error: "Adresse e-mail invalide." };
  const ip = await clientIp();
  const ok = ip ? (await allow("signup-code", `${ip}:${email.data}`, RULES.signupCode)) && (await allow("signup-code-ip", ip, RULES.signupCodeIp)) : await allow("signup-code-email", email.data, RULES.signupCode);
  if (!ok) return { error: RATE_LIMIT_MESSAGE };
  const issued = await issueCode(email.data);
  if (!issued.ok) return { error: `Un code vient d'être envoyé. Patientez ${issued.retryInSec} s avant d'en redemander un.`, retryInSec: issued.retryInSec };
  const sent = await sendMail({ to: email.data, ...verificationCodeMail({ code: issued.code }) });
  if (!sent.ok) return { error: "L'e-mail n'a pas pu être envoyé. Réessayez dans un instant." };
  const intent = parsePlanIntent(meta?.plan, meta?.interval);
  after(() => trackFunnel("signup_started", { email: email.data, plan: intent.plan, interval: intent.plan ? intent.interval : null, source: sanitizeSource(meta?.src) }));
  return { ok: true, ...(sent.dev ? { devCode: issued.code } : {}) };
}

/** Vérifie le code ; en cas de succès, pose la preuve signée (cookie httpOnly, 30 min) exigée par signupAction. */
export async function verifySignupCodeAction(rawEmail: string, code: string, meta?: { plan?: string; interval?: string; src?: string }): Promise<CodeState> {
  const email = emailOnly.safeParse(rawEmail);
  if (!email.success) return { error: "Adresse e-mail invalide." };
  // Clé par e-mail aussi sans IP : le blocage du code (« locked ») protège déjà l'adresse.
  const ip = await clientIp();
  if (!(await allow("signup-verify", ip ? `${ip}:${email.data}` : `email:${email.data}`, RULES.signupVerify))) return { error: RATE_LIMIT_MESSAGE };
  const r = await checkCode(email.data, code.trim());
  if (r !== "ok") return { error: r === "invalid" ? "Code incorrect." : r === "locked" ? "Trop d'essais : demandez un nouveau code." : "Code expiré : demandez-en un nouveau." };
  (await cookies()).set(PROOF_COOKIE, signProof(email.data), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: PROOF_TTL_MS / 1000 });
  const intent = parsePlanIntent(meta?.plan, meta?.interval);
  after(() => trackFunnel("email_verified", { email: email.data, plan: intent.plan, interval: intent.plan ? intent.interval : null, source: sanitizeSource(meta?.src) }));
  return { ok: true };
}
