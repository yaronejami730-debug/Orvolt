"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { sendMail } from "@/lib/mailer";
import { landingConfirmationMail, landingNotificationMail } from "@/lib/mail/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow, clientIp } from "@/lib/rate-limit-server";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { CONSENT_TEXT_VERSION, SLOT_LABELS, displayPhone, signupPrefillHref, type Slot } from "@/lib/landing/fields";
import { hashIp } from "@/lib/landing/ip-hash";
import { submitTiming, validateLanding } from "@/lib/validation/landing";

export interface LandingState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  fieldValues?: Record<string, string>;
}

const FIELDS = ["kind", "firstName", "lastName", "email", "phone", "company", "slot", "trade", "consent", "campaign", "referrer", "landingPath", "startedAt", "website"] as const;
const WRITE_ERROR = "Votre demande n'a pas pu être enregistrée. Réessayez dans un instant.";

/**
 * Prospect d'une page d'acquisition (/lp/*) : validé côté serveur, limité en débit, enregistré (service role) dans landing_leads.
 * E-mails (confirmation + alerte interne) hors chemin critique : un échec d'envoi n'affecte jamais l'enregistrement.
 * Aucune donnée personnelle dans les journaux.
 */
export async function landingAction(_: LandingState, fd: FormData): Promise<LandingState> {
  const raw: Record<string, string> = {};
  for (const k of FIELDS) raw[k] = typeof fd.get(k) === "string" ? (fd.get(k) as string) : "";
  const { website, startedAt, ...values } = raw; // sans le champ piège ni l'horodatage dans l'état renvoyé
  const keep = { firstName: values.firstName!, lastName: values.lastName!, email: values.email!, phone: values.phone!, company: values.company!, slot: values.slot!, consent: values.consent! };

  // Champ piège : un humain ne le voit pas. Faux succès, rien d'enregistré, aucun e-mail.
  if (website) return values.kind === "essai" ? redirect("/signup") : { ok: true };

  const checked = validateLanding(values);
  if (!checked.ok) return { fieldErrors: checked.fieldErrors, fieldValues: keep };
  if (submitTiming(startedAt) === "too_fast") return { error: "Merci de réessayer dans un instant.", fieldValues: keep };
  const d = checked.data;

  // IP inconnue : clé par e-mail seul, jamais de seau partagé « unknown » (un tiers épuiserait les demandes des autres).
  const ip = await clientIp();
  const allowed = ip
    ? (await allow("landing", ip, RULES.landing)) && (await allow("landing-email", d.email, RULES.landingEmail)) && (await allow("landing-global", "all", RULES.landingGlobal))
    : await allow("landing-email", d.email, RULES.landingEmail);
  if (!allowed) return { error: RATE_LIMIT_MESSAGE, fieldValues: keep };

  const slot: Slot | null = d.kind === "rappel" ? (d.slot ?? "peu-importe") : null;
  const { error } = await createAdminClient().from("landing_leads").insert({
    kind: d.kind,
    first_name: d.firstName,
    last_name: d.lastName,
    email: d.email,
    phone: d.phoneE164,
    company: d.company || null,
    trade: d.trade ?? null,
    preferred_slot: slot,
    consent_at: d.kind === "rappel" ? new Date().toISOString() : null,
    consent_text_version: CONSENT_TEXT_VERSION,
    utm: d.campaign,
    referrer: d.referrer,
    landing_path: d.landingPath,
    ip_hash: hashIp(ip),
  });
  if (error) {
    console.error("[landing] enregistrement impossible", error.code ?? "");
    return { error: WRITE_ERROR, fieldValues: keep };
  }

  const name = `${d.firstName} ${d.lastName}`;
  after(async () => {
    await sendMail({ to: d.email, ...landingConfirmationMail({ firstName: d.firstName, kind: d.kind, trialDays: TRIAL_DAYS }) }).catch(() => undefined);
    const to = process.env.LEADS_NOTIFY_EMAIL?.trim();
    if (!to) { console.warn("[landing] LEADS_NOTIFY_EMAIL absent : aucune alerte interne envoyée."); return; }
    const c = d.campaign;
    const campaign = [c.utm_source, c.utm_medium, c.utm_campaign].filter(Boolean).join(" / ") || (c.gclid ? "Google Ads (gclid)" : c.fbclid ? "Meta Ads (fbclid)" : "");
    await sendMail({
      to,
      ...landingNotificationMail({ kind: d.kind, name, phone: d.phoneE164, phoneDisplay: displayPhone(d.phoneE164), email: d.email, company: d.company, slot: slot ? SLOT_LABELS[slot] : null, trade: d.trade, campaign, landingPath: d.landingPath }),
    }).catch(() => undefined);
  });

  if (d.kind === "essai") redirect(signupPrefillHref({ email: d.email, firstName: d.firstName, lastName: d.lastName }));
  return { ok: true };
}
