import "server-only";
import Stripe from "stripe";

/**
 * Client Stripe. Clé : STRIPE_SECRET_KEY (sk_test_… en développement).
 * STRIPE_API_BASE (ex. http://127.0.0.1:12111) redirige le SDK vers stripe-mock : ignoré en production.
 * Sans clé ni base de test : null (la facturation affiche « non configurée »).
 */
export function getStripe(env: Record<string, string | undefined> = process.env): Stripe | null {
  // stripe-mock : jamais en production (sauf banc d'essai e2e explicitement déclaré par E2E_ALLOW_STRIPE_MOCK=1).
  const base = env.NODE_ENV === "production" && env.E2E_ALLOW_STRIPE_MOCK !== "1" ? undefined : env.STRIPE_API_BASE || undefined;
  const key = env.STRIPE_SECRET_KEY || (base ? "sk_test_mock" : "");
  if (!key) return null;
  if (env.NODE_ENV === "production" && !key.startsWith("sk_live_") && !key.startsWith("sk_test_")) return null;
  if (base) {
    const u = new URL(base);
    return new Stripe(key, { host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80"), protocol: u.protocol.replace(":", "") as "http" | "https", maxNetworkRetries: 0, timeout: 8000 });
  }
  return new Stripe(key, { maxNetworkRetries: 1, timeout: 10_000 });
}

export const isBillingConfigured = (env: Record<string, string | undefined> = process.env) => getStripe(env) !== null;

/** Instance sans appel réseau, pour la vérification des signatures de webhook. */
export function webhookVerifier(): Stripe {
  return new Stripe("sk_test_signature_only");
}
