"use server";

import { z } from "zod";
import { after } from "next/server";
import { sendMail } from "@/lib/mailer";
import { contactConfirmationMail } from "@/lib/mail/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow, clientIp } from "@/lib/rate-limit-server";
import { hasFeature } from "@/lib/billing/feature-guard";
import { getSession } from "@/lib/session";

export interface ContactState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  fieldValues?: Record<string, string>;
}

const schema = z.object({
  name: z.string().trim().min(2, "Nom trop court.").max(80, "Nom trop long."),
  email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide.")).pipe(z.string().max(160)),
  phone: z.string().trim().regex(/^[0-9+()\s.-]{6,30}$/, "Numéro de téléphone invalide."),
  company: z.string().trim().max(120, "Nom trop long.").optional(),
  message: z.string().trim().max(1000, "Message trop long (1000 caractères maximum).").optional(),
  consent: z.literal("on", { error: "Merci d'accepter d'être recontacté." }),
});

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");

/** Demande « être recontacté » : validée côté serveur, limitée en débit, enregistrée dans contact_requests. */
export async function contactAction(_: ContactState, fd: FormData): Promise<ContactState> {
  const values = { name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone"), company: str(fd, "company"), message: str(fd, "message") };
  // Champ piège : un humain ne le voit pas. On répond « ok » sans rien enregistrer.
  if (str(fd, "website")) return { ok: true };
  const parsed = schema.safeParse({ ...values, consent: str(fd, "consent") });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors, fieldValues: values };
  }
  const { name, email, phone, company, message } = parsed.data;
  // IP inconnue : clé par e-mail seul, jamais de seau partagé « unknown/global » (un tiers épuiserait les demandes des autres).
  const ip = await clientIp();
  const allowed = ip ? (await allow("contact", ip, RULES.contact)) && (await allow("contact-global", "all", RULES.contactGlobal)) : await allow("contact-email", email, RULES.contact);
  if (!allowed) return { error: RATE_LIMIT_MESSAGE, fieldValues: values };
  // Support prioritaire : abonné Premium connecté (déterminé ici, côté serveur, jamais par le formulaire).
  const session = await getSession().catch(() => null);
  const priority = session ? await hasFeature(session.org.id, "priority_support") : false;
  const { error } = await createAdminClient().from("contact_requests").insert({ name, email, phone, company: company || null, message: message || null, priority, org_id: priority ? session!.org.id : null });
  if (error) return { error: "Votre demande n'a pas pu être enregistrée. Réessayez dans un instant.", fieldValues: values };
  after(() => sendMail({ to: email, ...contactConfirmationMail({ name }) }).then(() => undefined, () => undefined)); // accusé de réception ; un échec n'affecte pas la demande
  return { ok: true };
}
