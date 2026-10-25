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

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Nom trop court.").max(80, "Nom trop long."),
  email,
  password,
  orgName: z.string().trim().min(2, "Nom d'entreprise trop court.").max(80, "Nom d'entreprise trop long."),
  template: z.enum(ENABLED_TEMPLATE_IDS, { error: "Choisissez un métier." }),
});

export const createMemberSchema = z.object({
  fullName: z.string().trim().min(2, "Nom trop court.").max(80),
  email,
  password,
  roleId: z.uuid("Rôle invalide."),
});

export const updateMemberRoleSchema = z.object({ membershipId: z.uuid(), roleId: z.uuid() });
export const memberStatusSchema = z.object({ membershipId: z.uuid(), status: z.enum(["active", "disabled"]) });

export const roleSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Nom trop court.").max(40, "Nom trop long."),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
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
