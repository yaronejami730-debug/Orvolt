import "server-only";
import { headers } from "next/headers";
import { RateLimiter, MemoryStore, RULES, type RateLimitResult, type RateLimitRule } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Store persistant : RPC Postgres atomique `rate_limit_hit` (partagé entre toutes les instances serverless).
 * Actif en production (ou RATE_LIMIT_STORE=pg) ; en développement et tests : mémoire. Base indisponible : repli mémoire.
 */
const pgEnabled = () => (process.env.RATE_LIMIT_STORE === "pg" || process.env.NODE_ENV === "production") && process.env.RATE_LIMIT_STORE !== "memory" && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

async function pgCheck(key: string, rule: RateLimitRule): Promise<RateLimitResult | null> {
  if (!pgEnabled()) return null;
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key.slice(0, 300), p_limit: rule.limit, p_window_ms: rule.windowMs });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return null;
  return { ok: !!row.allowed, remaining: Number(row.remaining), retryAfterMs: Number(row.retry_after_ms) };
}

export const serverLimiter = new RateLimiter(new MemoryStore(), Date.now, pgCheck);

/**
 * IP du client, ou null si inconnue. X-Forwarded-For est forgeable : il n'est lu que si
 * TRUSTED_PROXY=1 (déploiement derrière un proxy de confiance qui AJOUTE l'IP du client à droite).
 */
export async function clientIp(): Promise<string | null> {
  // Vercel pose lui-même x-vercel-forwarded-for (écrasé côté plateforme, non forgeable par le client).
  if (process.env.VERCEL === "1") {
    const v = (await headers()).get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (v) return v;
  }
  if (process.env.TRUSTED_PROXY !== "1") return null;
  const h = await headers();
  const parts = h.get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean);
  return parts?.[parts.length - 1] ?? h.get("x-real-ip") ?? null;
}

let warnedNoIp = false;
/**
 * IP pour un seau par IP sans identifiant de repli (ex. API publique) : jamais de seau « global » partagé.
 * IP inconnue : développement/tests → « local » ; production → null (l'appelant refuse) + avertissement de config manquante.
 */
export async function ipOrDeny(): Promise<string | null> {
  const ip = await clientIp();
  if (ip) return ip;
  if (process.env.NODE_ENV !== "production") return "local";
  if (!warnedNoIp) {
    warnedNoIp = true;
    console.warn("[rate-limit] IP client inconnue : définissez TRUSTED_PROXY=1 (derrière un proxy de confiance) ; requêtes publiques refusées.");
  }
  return null;
}

/**
 * true si la requête est autorisée.
 * IP inconnue (TRUSTED_PROXY absent) : pas de seau global partagé pour la connexion ; la clé reste « unknown:<email> »
 * avec une limite plus tolérante (un tiers ne peut pas verrouiller un compte en 10 essais). Activez TRUSTED_PROXY=1 derrière Vercel.
 */
export async function allow(scope: string, id: string, rule: RateLimitRule): Promise<boolean> {
  if (scope === "login" && id.startsWith("unknown:") && rule === RULES.login) rule = RULES.loginNoIp;
  return (await serverLimiter.check(`${scope}:${id}`, rule)).ok;
}
