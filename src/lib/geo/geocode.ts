import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeFetch } from "@/lib/net/safe-fetch";
import { limiter } from "@/lib/rate-limit";
import { banGeocoder, mockGeocoder, nominatimGeocoder, type FetchJson, type GeoResult, type Geocoder } from "./providers";
import { normalizeAddress } from "./normalize";

const UA = `LeadForgeCRM/1.0 (+${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}; contact: ${process.env.GEOCODER_CONTACT ?? "admin@leadforge.local"})`;
const TTL_FOUND_MS = 30 * 86_400_000;
const TTL_MISS_MS = 86_400_000;

/**
 * Appels sortants : uniquement vers deux hôtes fixes (api-adresse.data.gouv.fr, nominatim.openstreetmap.org),
 * construits côté serveur à partir de constantes, et toujours via safeFetch (https, IP publique épinglée, timeout).
 */
const fetchJson: FetchJson = (url) => safeFetch(url, { method: "GET", headers: { "user-agent": UA, accept: "application/json" }, timeoutMs: 4000, maxBytes: 200_000 });

export function activeGeocoders(): Geocoder[] {
  if (process.env.GEOCODER === "mock") {
    // Le mock fabrique des coordonnées : interdit en production (sauf banc d'essai e2e explicitement déclaré).
    if (process.env.NODE_ENV === "production" && process.env.E2E_ALLOW_MOCK_GEOCODER !== "1") {
      throw new Error("GEOCODER=mock est interdit en production.");
    }
    return [mockGeocoder()];
  }
  return [banGeocoder(fetchJson), nominatimGeocoder(fetchJson)];
}

export function addressKey(address: string): string {
  return createHash("sha256").update(normalizeAddress(address)).digest("hex");
}

export type GeocodeOutcome = { found: true; result: GeoResult; cached: boolean } | { found: false; cached: boolean };

export async function geocodeAddress(address: string, geocoders: Geocoder[] = activeGeocoders()): Promise<GeocodeOutcome> {
  const q = address.trim().slice(0, 300);
  if (normalizeAddress(q).length < 3) return { found: false, cached: false };
  const key = addressKey(q);
  const admin = createAdminClient();
  const { data: hit } = await admin.from("geocode_cache").select("lat, lng, label, provider, found, expires_at, precision, score").eq("key", key).maybeSingle();
  if (hit && new Date(hit.expires_at) > new Date()) {
    return hit.found && hit.lat !== null && hit.lng !== null
      ? { found: true, cached: true, result: { lat: hit.lat, lng: hit.lng, label: hit.label ?? q, provider: hit.provider, precision: (hit.precision as GeoResult["precision"]) ?? undefined, score: hit.score === null ? undefined : Number(hit.score) } }
      : { found: false, cached: true };
  }
  let result: GeoResult | null = null;
  let failed = false;
  for (const g of geocoders) {
    // Nominatim impose 1 requête/seconde au plus.
    if (g.name === "nominatim" && !(await limiter.check("geocode:nominatim", { limit: 1, windowMs: 1000 })).ok) continue;
    try {
      result = await g.geocode(q);
      if (result) break;
    } catch {
      failed = true; // indisponibilité : on tente le fournisseur suivant
    }
  }
  if (!result && failed) return { found: false, cached: false }; // pas de cache négatif sur panne
  await admin.from("geocode_cache").upsert({
    key,
    lat: result?.lat ?? null,
    lng: result?.lng ?? null,
    label: result?.label ?? null,
    provider: result?.provider ?? geocoders[0]?.name ?? "none",
    found: !!result,
    precision: result?.precision ?? null,
    score: result?.score ?? null,
    expires_at: new Date(Date.now() + (result ? TTL_FOUND_MS : TTL_MISS_MS)).toISOString(),
  });
  return result ? { found: true, cached: false, result } : { found: false, cached: false };
}
