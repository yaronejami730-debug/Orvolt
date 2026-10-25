import { banPrecision, MOCK_CITIES, PRECISION_UNCERTAINTY_KM, type FetchJson, type GeoPrecision, type GeoResult, type Geocoder } from "./providers";
import { normalizeAddress } from "./normalize";

/** Position d'un lieu telle qu'enregistrée sur un lead / RDV. */
export interface GeoPoint {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  score: number | null;
  source: "ban" | "nominatim" | "manual";
  insee: string | null;
  label: string;
}

export interface Suggestion {
  label: string;
  lat: number;
  lng: number;
  precision: GeoPrecision;
  score: number;
  insee: string | null;
  city: string | null;
  postcode: string | null;
  source: "ban";
}

const SUGGEST_URL = "https://data.geopf.fr/geocodage/search";
const SUGGEST_FALLBACK = "https://api-adresse.data.gouv.fr/search/";

/** Suggestions d'adresses (autocomplétion). Seul le texte saisi est envoyé à l'API publique. */
export async function suggestAddresses(q: string, fetchJson: FetchJson): Promise<Suggestion[]> {
  const text = q.trim().slice(0, 200);
  if (text.length < 3) return [];
  const qs = `?q=${encodeURIComponent(text)}&limit=6&autocomplete=1`;
  let res = await fetchJson(SUGGEST_URL + qs);
  if (res.status !== 200 || !res.body) res = await fetchJson(SUGGEST_FALLBACK + qs);
  if (res.status !== 200 || !res.body) throw new Error(`BAN HTTP ${res.status}`);
  const j = JSON.parse(res.body) as { features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }[] };
  const out: Suggestion[] = [];
  for (const f of j.features ?? []) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || typeof c[0] !== "number" || typeof c[1] !== "number" || typeof p.label !== "string") continue;
    out.push({
      label: p.label.slice(0, 200), lng: c[0], lat: c[1], precision: banPrecision(typeof p.type === "string" ? p.type : undefined),
      score: typeof p.score === "number" ? p.score : 0.5, insee: typeof p.citycode === "string" ? p.citycode : null,
      city: typeof p.city === "string" ? p.city : null, postcode: typeof p.postcode === "string" ? p.postcode : null, source: "ban",
    });
  }
  return out;
}

/** Autocomplétion déterministe pour GEOCODER=mock (aucun réseau). */
export function mockSuggest(q: string): Suggestion[] {
  const n = normalizeAddress(q);
  if (n.length < 3 || n.includes("introuvable") || n.includes("zzz")) return [];
  const num = /^(\d{1,4})\s/.exec(q.trim())?.[1];
  const entries = Object.entries(MOCK_CITIES);
  const hit = entries.filter(([city]) => ` ${n} `.includes(` ${city} `));
  const cities = hit.length ? hit : entries.filter(([city]) => city.startsWith(n.split(" ").pop() ?? "~"));
  return cities.slice(0, 5).map(([city, [lat, lng]], i) => {
    const street = hit.length ? q.trim().replace(new RegExp(city.replace(/ /g, "[ -]"), "i"), "").replace(/[,\s]+$/, "").trim() : "";
    const label = hit.length && street ? `${street}, ${city.replace(/\b\w/g, (m) => m.toUpperCase())}` : city.replace(/\b\w/g, (m) => m.toUpperCase());
    const precision: GeoPrecision = !hit.length || !street ? "municipality" : num ? "housenumber" : "street";
    return { label, lat: lat + (street ? 0.002 * (i + 1) : 0), lng: lng + (street ? 0.002 * (i + 1) : 0), precision, score: precision === "municipality" ? 0.5 : 0.9, insee: null, city, postcode: null, source: "ban" as const };
  });
}

/**
 * Repli en chaîne pour une adresse saisie à la main : géocodeurs (BAN -> Nominatim) sur « texte, code postal commune »,
 * puis centre de la commune (code postal + commune). Le résultat final est `municipality` (approximatif) dans le dernier cas.
 */
export async function resolveManualAddress(
  input: { text: string; postcode: string; city: string },
  geocoders: Geocoder[],
  communeCenter: (postcode: string, city: string) => Promise<GeoResult | null>,
): Promise<GeoPoint | null> {
  const full = `${input.text}, ${input.postcode} ${input.city}`.trim();
  for (const g of geocoders) {
    try {
      const r = await g.geocode(full);
      // Un résultat BAN de simple commune pour une adresse précise est un repli, pas une vraie position.
      if (r) return { lat: r.lat, lng: r.lng, precision: r.precision ?? "street", score: r.score ?? null, source: g.name === "nominatim" ? "nominatim" : "ban", insee: r.insee ?? null, label: r.label };
    } catch { /* fournisseur indisponible : suivant */ }
  }
  try {
    const c = await communeCenter(input.postcode, input.city);
    if (c) return { lat: c.lat, lng: c.lng, precision: "municipality", score: c.score ?? null, source: "ban", insee: c.insee ?? null, label: `${input.postcode} ${input.city}` };
  } catch { /* aucun centre */ }
  return null;
}

export type GeoCheck =
  | { ok: true; approximate: boolean; uncertaintyKm: number }
  | { ok: false; code: "no_position" | "approximate" | "off_road" | "unroutable"; reason: string };

export const SNAP_LIMIT_M = 500;

/**
 * Un RDV est-il utilisable par le moteur ? Jamais d'échec silencieux : chaque refus a une raison en français.
 * - pas de point : « à vérifier » ; commune seule : à vérifier sauf si le confirmateur a accepté l'approximation ;
 * - snap OSRM : point à plus de 500 m de toute route => à vérifier ; null = service indisponible/non applicable.
 */
export function assessPoint(p: { lat: number | null; lng: number | null; precision: GeoPrecision | null; accepted: boolean; snapM: number | null | "unroutable" }): GeoCheck {
  if (p.lat === null || p.lng === null) return { ok: false, code: "no_position", reason: "Pas de position GPS : adresse à vérifier." };
  if (p.snapM === "unroutable") return { ok: false, code: "unroutable", reason: "Point non routable : aucune route proche." };
  if (typeof p.snapM === "number" && p.snapM > SNAP_LIMIT_M) {
    return { ok: false, code: "off_road", reason: `Point hors route : ${p.snapM >= 1000 ? (p.snapM / 1000).toFixed(1) + " km" : Math.round(p.snapM) + " m"} de la route la plus proche.` };
  }
  const prec = p.precision ?? "street";
  if (prec === "municipality" && !p.accepted) {
    return { ok: false, code: "approximate", reason: `Position approximative (commune seule, ±${PRECISION_UNCERTAINTY_KM.municipality} km) : corrigez l'adresse ou acceptez l'approximation.` };
  }
  return { ok: true, approximate: prec === "municipality", uncertaintyKm: PRECISION_UNCERTAINTY_KM[prec] };
}
