import "server-only";
import { safeFetch } from "@/lib/net/safe-fetch";
import { limiter } from "@/lib/rate-limit";
import { mapboxProvider, tomtomProvider, withTtlCache, type TrafficFetch, type TrafficProvider } from "./traffic";

const fetchJson: TrafficFetch = async (url) => {
  // Quota local (les offres gratuites sont plafonnées) ; dépassement => repli silencieux sur l'estimation horaire.
  if (!(await limiter.check("traffic:external", { limit: 120, windowMs: 60_000 })).ok) return { status: 429 };
  return safeFetch(url, { method: "GET", headers: { accept: "application/json" }, timeoutMs: 4000, maxBytes: 300_000 });
};

let cached: { id: string; p: TrafficProvider } | null = null;

/** TRAFFIC_PROVIDER = none | tomtom | mapbox ; TRAFFIC_API_KEY. Jamais obligatoire ; la clé ne quitte pas le serveur. */
export function configuredTraffic(env: NodeJS.ProcessEnv = process.env): TrafficProvider | null {
  const kind = env.TRAFFIC_PROVIDER ?? "none";
  const key = env.TRAFFIC_API_KEY;
  if (!key || (kind !== "tomtom" && kind !== "mapbox")) return null;
  const id = `${kind}:${key.length}`;
  if (cached?.id !== id) cached = { id, p: withTtlCache(kind === "tomtom" ? tomtomProvider(key, fetchJson) : mapboxProvider(key, fetchJson)) };
  return cached.p;
}
