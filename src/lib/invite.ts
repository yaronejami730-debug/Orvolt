import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site";

/**
 * Invitation sûre : le compte est créé avec un mot de passe aléatoire que personne ne connaît (inutilisable),
 * puis un lien de récupération Supabase à usage unique permet à la personne de choisir le sien.
 * Le jeton n'est consommé qu'à la soumission de /reset (POST), pas au clic : les scanners de liens ne le brûlent pas.
 */
export async function createInvitedUser(d: { email: string; fullName: string; orgId: string }): Promise<{ userId: string } | null> {
  const { data, error } = await createAdminClient().auth.admin.createUser({
    email: d.email,
    password: randomBytes(48).toString("base64url"),
    email_confirm: true,
    user_metadata: { full_name: d.fullName },
    app_metadata: { provisioned_org: d.orgId },
  });
  return error || !data.user ? null : { userId: data.user.id };
}

/** Lien « Choisir mon mot de passe » (usage unique) ; null si Supabase refuse. La durée de validité est celle de l'OTP Supabase (Auth > Email > OTP expiry). */
export async function inviteLink(email: string): Promise<string | null> {
  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return null;
  return `${siteUrl()}/reset?token_hash=${encodeURIComponent(tokenHash)}&invite=1`;
}
