import { z } from "zod";
import { LEAD_KINDS, MIN_SUBMIT_MS, SLOTS, TRADES, cleanText, isEmail, normalizePhone, sanitizeCampaign, sanitizeLandingPath, sanitizeReferrer } from "@/lib/landing/fields";

const name = (label: string) => z.string().trim().min(1, `${label} requis.`).max(60, `${label} trop long.`).refine((v) => !/[<>]/.test(v), `${label} invalide.`);

const base = z.object({
  kind: z.enum(LEAD_KINDS),
  firstName: name("Prénom"),
  lastName: name("Nom"),
  email: z.string().trim().toLowerCase().min(1, "Adresse e-mail requise.").refine(isEmail, "Adresse e-mail invalide."),
  phone: z.string().trim().min(1, "Numéro de téléphone requis.").refine((v) => normalizePhone(v).ok, "Numéro de téléphone invalide."),
  company: z.string().trim().max(120, "Nom trop long.").optional(),
  slot: z.enum(SLOTS).optional(),
  trade: z.enum(TRADES).optional(),
  consent: z.string().optional(),
});

/** Le rappel exige un consentement explicite (case décochée par défaut). */
export const landingSchema = base.superRefine((v, ctx) => {
  if (v.kind === "rappel" && v.consent !== "on") ctx.addIssue({ code: "custom", path: ["consent"], message: "Merci d'accepter d'être rappelé pour continuer." });
});

export type LandingInput = z.infer<typeof landingSchema> & { phone: string };

export type LandingResult =
  | { ok: true; data: LandingInput & { phoneE164: string; campaign: ReturnType<typeof sanitizeCampaign>; referrer: string | null; landingPath: string | null } }
  | { ok: false; fieldErrors: Record<string, string> };

const emptyToUndef = (v: string | undefined) => (v ? v : undefined);

/** Valide et assainit les valeurs brutes du formulaire (chaînes). Source de vérité côté serveur. */
export function validateLanding(raw: Record<string, string>): LandingResult {
  const parsed = landingSchema.safeParse({
    kind: raw.kind,
    firstName: cleanText(raw.firstName, 80),
    lastName: cleanText(raw.lastName, 80),
    email: raw.email ?? "",
    phone: raw.phone ?? "",
    company: emptyToUndef(cleanText(raw.company, 200)),
    slot: emptyToUndef(raw.slot),
    trade: emptyToUndef(raw.trade),
    consent: raw.consent,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, fieldErrors };
  }
  const phone = normalizePhone(parsed.data.phone);
  return {
    ok: true,
    data: {
      ...parsed.data,
      phoneE164: phone.ok ? phone.e164 : "",
      campaign: sanitizeCampaign(raw.campaign),
      referrer: sanitizeReferrer(raw.referrer),
      landingPath: sanitizeLandingPath(raw.landingPath),
    },
  };
}

/** Anti-robot, volet « délai » : horodatage posé par le navigateur à l'affichage ; trop récent ou absent = refusé. */
export function submitTiming(startedAt: string | undefined, now = Date.now()): "ok" | "too_fast" {
  const t = Number(startedAt);
  if (!Number.isFinite(t) || t <= 0) return "too_fast";
  return now - t >= MIN_SUBMIT_MS ? "ok" : "too_fast";
}
