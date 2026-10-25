import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { estimateProvider, fakeProvider, osrmProvider } from "./providers";
import type { Point, RoadMatrix, RoutingProvider } from "./types";

const CACHE_TTL_MS = 7 * 86_400_000;

/** Clé de cache de trajet : coordonnées arrondies à 4 décimales (identique à `route_key` en SQL). */
export const routeKey = (a: Point, b: Point) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

const httpText = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  return { status: r.status, body: await r.text() };
};

/**
 * Fournisseur configuré : ROUTING_PROVIDER = osrm | fake | estimate. Par défaut : osrm si ROUTING_URL, sinon fake en mode test
 * (GEOCODER=mock), sinon estimation. `fake` est interdit en production (sauf banc d'essai e2e déclaré).
 */
export function configuredRouting(env: NodeJS.ProcessEnv = process.env): RoutingProvider {
  const kind = env.ROUTING_PROVIDER || (env.ROUTING_URL ? "osrm" : env.GEOCODER === "mock" ? "fake" : "estimate");
  if (kind === "osrm") return osrmProvider(env.ROUTING_URL || "http://127.0.0.1:56500", httpText);
  if (kind === "fake") {
    if (env.NODE_ENV === "production" && env.E2E_ALLOW_MOCK_GEOCODER !== "1") throw new Error("ROUTING_PROVIDER=fake est interdit en production.");
    return fakeProvider();
  }
  return estimateProvider();
}

export interface ResolvedMatrix {
  matrix: RoadMatrix;
  provider: RoutingProvider;
  /** Le service de routage a échoué : repli sur l'estimation (étiquetée, pas d'application automatique). */
  fellBack: boolean;
}

export async function resolveMatrix(points: Point[]): Promise<ResolvedMatrix> {
  const provider = configuredRouting();
  try {
    return { matrix: await provider.matrix(points), provider, fellBack: false };
  } catch (e) {
    console.error("[routing] indisponible, repli estimation :", e instanceof Error ? e.message : e);
    const est = estimateProvider();
    return { matrix: await est.matrix(points), provider: est, fellBack: provider.kind !== "estimate" };
  }
}

/** Enregistre les trajets réels utilisés (relus par `apply_dispatch` pour rejouer la validation en base). Jamais d'estimation. */
export async function cacheLegs(provider: RoutingProvider, legs: { a: Point; b: Point; durationS: number; distanceM: number }[]) {
  if (provider.estimated || legs.length === 0) return;
  const rows = new Map<string, { key: string; duration_s: number; distance_m: number; provider: string; expires_at: string }>();
  for (const l of legs) {
    const key = routeKey(l.a, l.b);
    rows.set(key, { key, duration_s: Math.round(l.durationS), distance_m: Math.round(l.distanceM), provider: provider.kind, expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString() });
  }
  const admin = createAdminClient();
  const all = [...rows.values()];
  for (let i = 0; i < all.length; i += 200) {
    const { error } = await admin.from("routing_cache").upsert(all.slice(i, i + 200));
    if (error) throw new Error(`routing_cache : ${error.message}`);
  }
}
