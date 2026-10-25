import "server-only";
import { headers } from "next/headers";
import { limiter, type RateLimitRule } from "@/lib/rate-limit";

/**
 * IP du client, ou null si inconnue. X-Forwarded-For est forgeable : il n'est lu que si
 * TRUSTED_PROXY=1 (déploiement derrière un proxy de confiance qui AJOUTE l'IP du client à droite).
 */
export async function clientIp(): Promise<string | null> {
  if (process.env.TRUSTED_PROXY !== "1") return null;
  const h = await headers();
  const parts = h.get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean);
  return parts?.[parts.length - 1] ?? h.get("x-real-ip") ?? null;
}

/** true si la requête est autorisée. */
export async function allow(scope: string, id: string, rule: RateLimitRule): Promise<boolean> {
  return (await limiter.check(`${scope}:${id}`, rule)).ok;
}
