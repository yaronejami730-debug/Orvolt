import "server-only";
import { SITE_NAME } from "@/lib/site";

export interface Mail { to: string; subject: string; text: string; html?: string }
export type MailResult = { ok: true; dev: boolean } | { ok: false };

/**
 * Le code de développement n'est exposé (`dev: true`) que si ALLOW_DEV_CODE=1 ET hors production ET hors déploiement Vercel
 * (production comme preview). Sinon le message reste dans les logs serveur uniquement.
 */
export const devCodeAllowed = (env: Record<string, string | undefined> = process.env) =>
  env.ALLOW_DEV_CODE === "1" && env.NODE_ENV !== "production" && !env.VERCEL_ENV && !env.VERCEL;

/**
 * Envoi d'e-mails transactionnels via Brevo (BREVO_API_KEY + BREVO_SENDER_EMAIL, BREVO_SENDER_NAME facultatif).
 * Sans clé : en développement uniquement, le message est écrit dans les logs du serveur (dev: true seulement si devCodeAllowed) ; en production : échec (jamais d'envoi simulé).
 */
export async function sendMail(mail: Mail, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Promise<MailResult> {
  const key = env.BREVO_API_KEY;
  if (!key) {
    if (env.NODE_ENV === "production") return { ok: false };
    console.info(`[mail dev] à ${mail.to} · ${mail.subject}\n${mail.text}`);
    return { ok: true, dev: devCodeAllowed(env) };
  }
  const sender = env.BREVO_SENDER_EMAIL;
  if (!sender) return { ok: false };
  try {
    const r = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { email: sender, name: env.BREVO_SENDER_NAME ?? SITE_NAME }, to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text, ...(mail.html ? { htmlContent: mail.html } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? { ok: true, dev: false } : { ok: false };
  } catch {
    return { ok: false };
  }
}
