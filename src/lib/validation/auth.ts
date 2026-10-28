import { z } from "zod";
import { ENABLED_TEMPLATE_IDS } from "@/lib/templates";
import { PERMISSIONS } from "@/lib/permissions";

const email = z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide."));
const password = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
  .max(72, "Le mot de passe est trop long.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Mot de passe requis."),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas." });

/** SIRET : 14 chiffres (espaces tolérés), clé de Luhn valide ; les établissements de La Poste (SIREN 356 000 000) suivent un total divisible par 5. */
export function isValidSiret(raw: string): boolean {
  const d = raw.replace(/\s/g, "");
  if (!/^\d{14}$/.test(d)) return false;
  const sum = [...d].reduce((acc, ch, i) => { let n = Number(ch); if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; } return acc + n; }, 0);
  return d.startsWith("356000000") ? [...d].reduce((a, c) => a + Number(c), 0) % 5 === 0 : sum % 10 === 0;
}
const siret = z.string().trim().refine(isValidSiret, "Numéro de SIRET invalide (14 chiffres).").transform((v) => v.replace(/\s/g, ""));
const phone = z.string().trim().regex(/^\+?[0-9 .()-]{6,20}$/, "Numéro de téléphone invalide.");
/** Téléphone facultatif à l'inscription (modifiable ensuite) : vide accepté, sinon même règle. */
const optionalPhone = z.union([z.literal(""), phone]).transform((v) => v || null);

export const signupSchema = z.object({
  firstName: z.string().trim().min(2, "Prénom trop court.").max(40, "Prénom trop long."),
  lastName: z.string().trim().min(2, "Nom trop court.").max(40, "Nom trop long."),
  email,
  password,
  orgName: z.string().trim().min(2, "Nom d'entreprise trop court.").max(80, "Nom d'entreprise trop long."),
  siret,
  phone: optionalPhone,
  /** Activité : installateur ou régie (remplace l'ancienne étape d'onboarding « activité »). */
  orgType: z.enum(["installer", "agency"], "Choisissez installateur ou régie."),
  // Spécialiste de l'énergie : plus de choix de métier à l'inscription.
  template: z.enum(ENABLED_TEMPLATE_IDS).default("energie"),
});

export const createMemberSchema = z.object({
  fullName: z.string().trim().min(2, "Nom trop court.").max(80),
  email,
  roleId: z.uuid("Rôle invalide."),
  /** Domaines de travail (facultatif, plan Pro+) : voir src/lib/call-programming.ts. */
  domainIds: z.array(z.uuid()).max(10, "10 domaines au maximum.").optional(),
});

export const updateMemberRoleSchema = z.object({ membershipId: z.uuid(), roleId: z.uuid() });
export const memberStatusSchema = z.object({ membershipId: z.uuid(), status: z.enum(["active", "disabled"]) });

export const roleSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Nom trop court.").max(40, "Nom trop long."),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  /** Rôle terrain (commercial) : zone d'intervention et rendez-vous répartis. Exige « Gérer ses rendez-vous ». */
  isField: z.boolean().default(false),
}).refine((r) => !r.isField || r.permissions.includes("appointments.manage_own"), {
  message: "Un rôle terrain doit pouvoir « Gérer ses rendez-vous ».",
  path: ["isField"],
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Première erreur lisible d'un résultat Zod. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Données invalides.";
}

/** Première erreur par champ : { champ: message }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
