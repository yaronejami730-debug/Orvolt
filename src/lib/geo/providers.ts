import { z } from "zod";
import { normalizeAddress } from "./normalize";

export type GeoPrecision = "housenumber" | "street" | "locality" | "municipality" | "manual_pin" | "manual_coords";
export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
  provider: string;
  precision?: GeoPrecision;
  score?: number;
  insee?: string;
  postcode?: string;
  city?: string;
}
export const GEO_PRECISION_LABEL: Record<GeoPrecision, string> = {
  housenumber: "Numéro exact", street: "Rue", locality: "Lieu-dit", municipality: "Position approximative (commune)",
  manual_pin: "Pin posé à la main", manual_coords: "Coordonnées saisies",
};
/** Rayon d'incertitude indicatif (km) selon la précision. */
export const PRECISION_UNCERTAINTY_KM: Record<GeoPrecision, number> = { housenumber: 0.05, street: 0.3, locality: 1, municipality: 4, manual_pin: 0.05, manual_coords: 0.02 };
export interface Geocoder {
  name: string;
  geocode(query: string): Promise<GeoResult | null>;
}

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** Réponse de l'API Adresse (BAN) : GeoJSON FeatureCollection. */
export const banResponseSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([lng, lat]) }),
      properties: z.object({
        label: z.string().max(300), score: z.number().optional(), type: z.string().optional(), citycode: z.string().optional(),
        postcode: z.string().optional(), city: z.string().optional(),
      }),
    }),
  ),
});
/** Réponse Nominatim (jsonv2) : lat/lon en chaînes. */
export const nominatimResponseSchema = z.array(
  z.object({ lat: z.coerce.number().pipe(lat), lon: z.coerce.number().pipe(lng), display_name: z.string().max(500), addresstype: z.string().optional() }),
);

export type FetchJson = (url: string) => Promise<{ status: number; body?: string }>;

export function banPrecision(type: string | undefined): GeoPrecision {
  return type === "housenumber" ? "housenumber" : type === "street" ? "street" : type === "locality" ? "locality" : "municipality";
}

/** API Géoplateforme (successeur de api-adresse.data.gouv.fr, sans clé) ; l'ancienne URL reste en repli. */
export const BAN_URLS = ["https://data.geopf.fr/geocodage/search", "https://api-adresse.data.gouv.fr/search/"] as const;

export function banGeocoder(fetchJson: FetchJson): Geocoder {
  return {
    name: "ban",
    async geocode(query) {
      let res = await fetchJson(`${BAN_URLS[0]}?q=${encodeURIComponent(query)}&limit=1&autocomplete=0`);
      if (res.status !== 200 || !res.body) res = await fetchJson(`${BAN_URLS[1]}?q=${encodeURIComponent(query)}&limit=1&autocomplete=0`);
      if (res.status !== 200 || !res.body) throw new Error(`BAN HTTP ${res.status}`);
      const parsed = banResponseSchema.parse(JSON.parse(res.body));
      const f = parsed.features[0];
      if (!f || (f.properties.score ?? 1) < 0.3) return null;
      return {
        lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: f.properties.label, provider: "ban",
        precision: banPrecision(f.properties.type), score: f.properties.score, insee: f.properties.citycode, postcode: f.properties.postcode, city: f.properties.city,
      };
    },
  };
}

export function nominatimGeocoder(fetchJson: FetchJson): Geocoder {
  return {
    name: "nominatim",
    async geocode(query) {
      const res = await fetchJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=fr`);
      if (res.status !== 200 || !res.body) throw new Error(`Nominatim HTTP ${res.status}`);
      const parsed = nominatimResponseSchema.parse(JSON.parse(res.body));
      const r = parsed[0];
      const t = r?.addresstype;
      const precision: GeoPrecision = t === "house" || t === "building" ? "housenumber" : t === "road" || t === "street" ? "street" : t === "hamlet" || t === "neighbourhood" || t === "suburb" || t === "isolated_dwelling" ? "locality" : "municipality";
      return r ? { lat: r.lat, lng: r.lon, label: r.display_name, provider: "nominatim", precision } : null;
    },
  };
}

export const MOCK_CITIES: Record<string, [number, number]> = {
  // Agglomération lyonnaise (testées avant « lyon » : « rue de Lyon, Villeurbanne » doit donner Villeurbanne)
  villeurbanne: [45.7719, 4.8902],
  venissieux: [45.6977, 4.8869],
  bron: [45.7369, 4.9132],
  "caluire et cuire": [45.7956, 4.8467],
  ecully: [45.7742, 4.7708],
  oullins: [45.7157, 4.8076],
  "saint priest": [45.6958, 4.9456],
  "decines charpieu": [45.7708, 4.9588],
  "tassin la demi lune": [45.7603, 4.7507],
  "vaulx en velin": [45.7767, 4.9186],
  meyzieu: [45.7667, 5.0],
  paris: [48.8566, 2.3522],
  versailles: [48.8014, 2.1301],
  lyon: [45.764, 4.8357],
  marseille: [43.2965, 5.3698],
  lille: [50.6292, 3.0573],
  bordeaux: [44.8378, -0.5792],
  nantes: [47.2184, -1.5536],
  toulouse: [43.6047, 1.4442],
};

/** Géocodeur déterministe pour tests / CI (GEOCODER=mock). « introuvable » ou « zzz » => aucune réponse. */
export function mockGeocoder(): Geocoder {
  return {
    name: "mock",
    async geocode(query) {
      const n = normalizeAddress(query);
      if (!n || n.includes("introuvable") || n.includes("zzz")) return null;
      for (const [city, [la, lo]] of Object.entries(MOCK_CITIES)) {
        if (` ${n} `.includes(` ${city} `)) {
          const hasNumber = /\b\d{1,4}\b/.test(n.replace(/\b\d{5}\b/g, ""));
          return { lat: la, lng: lo, label: query.trim(), provider: "mock", precision: hasNumber ? "housenumber" : n.split(" ").length > 2 ? "street" : "municipality", score: 0.9, city };
        }
      }
      let h = 0;
      for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return { lat: 43 + (h % 5000) / 1000, lng: -1 + ((h >>> 8) % 6000) / 1000, label: query.trim(), provider: "mock" };
    },
  };
}
