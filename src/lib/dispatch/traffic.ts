import type { TrafficParams } from "./types";
import { isoWeekday } from "./time";

export const DEFAULT_TRAFFIC: TrafficParams = { morningCoef: 1.25, eveningCoef: 1.4, safetyPct: 10 };
/** Heures de pointe en semaine (minutes depuis minuit) : 7h30-9h30 et 16h30-19h30. */
export const PEAKS = { morning: [450, 570], evening: [990, 1170] } as const;
export const TRAFFIC_WARNING = "Attention : les conditions réelles de circulation peuvent varier.";

/** Coefficient horaire de circulation (1 hors pointe, week-end ou trajet <= 15 min). */
export function peakCoef(day: string, departMin: number, baseSeconds: number, t: TrafficParams): number {
  if (baseSeconds <= 900 || isoWeekday(day) > 5) return 1;
  if (departMin >= PEAKS.morning[0] && departMin < PEAKS.morning[1]) return t.morningCoef;
  if (departMin >= PEAKS.evening[0] && departMin < PEAKS.evening[1]) return t.eveningCoef;
  return 1;
}

/** Durée planifiée d'un trajet (minutes entières) : base x coefficient horaire x (1 + marge de sécurité). Même formule que `traffic_minutes` en SQL. */
export function trafficMinutes(baseSeconds: number, day: string, departMin: number, t: TrafficParams): number {
  return Math.ceil((baseSeconds / 60) * peakCoef(day, departMin, baseSeconds, t) * (1 + t.safetyPct / 100));
}

export const overrideKey = (from: string, to: string, day: string, departMin: number) => `${from}|${to}|${day}|${Math.floor(departMin / 15)}`;

// ------------------------------------------------------------------ fournisseurs optionnels (clé gratuite)
export interface TrafficLeg {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  /** Instant de départ ISO (UTC). */
  departAt: string;
}
export interface TrafficProvider {
  name: "tomtom" | "mapbox";
  label: string;
  /** Durée avec trafic (secondes) ou null (échec, quota, délai dépassé). Ne lève jamais. */
  duration(leg: TrafficLeg): Promise<number | null>;
}
export type TrafficFetch = (url: string) => Promise<{ status: number; body?: string }>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** TomTom Routing API (calculateRoute, traffic=true, departAt). La clé n'apparaît que dans l'URL sortante côté serveur. */
export function tomtomProvider(key: string, fetchJson: TrafficFetch): TrafficProvider {
  return {
    name: "tomtom", label: "TomTom",
    async duration({ from, to, departAt }) {
      try {
        const url = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lng}:${to.lat},${to.lng}/json?key=${encodeURIComponent(key)}&traffic=true&routeType=fastest&departAt=${encodeURIComponent(departAt)}`;
        const r = await fetchJson(url);
        if (r.status !== 200 || !r.body) return null;
        const j = JSON.parse(r.body) as { routes?: { summary?: { travelTimeInSeconds?: number } }[] };
        return num(j.routes?.[0]?.summary?.travelTimeInSeconds);
      } catch { return null; }
    },
  };
}

/** Mapbox Directions `driving-traffic` (depart_at). */
export function mapboxProvider(key: string, fetchJson: TrafficFetch): TrafficProvider {
  return {
    name: "mapbox", label: "Mapbox",
    async duration({ from, to, departAt }) {
      try {
        const depart = departAt.slice(0, 16); // AAAA-MM-JJTHH:MM (UTC)
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&depart_at=${encodeURIComponent(depart)}&access_token=${encodeURIComponent(key)}`;
        const r = await fetchJson(url);
        if (r.status !== 200 || !r.body) return null;
        const j = JSON.parse(r.body) as { routes?: { duration?: number }[] };
        return num(j.routes?.[0]?.duration);
      } catch { return null; }
    },
  };
}

/** Cache court en mémoire (TTL) : les CGU des fournisseurs limitent le stockage durable des résultats. */
export function withTtlCache(p: TrafficProvider, ttlMs = 15 * 60_000, now: () => number = Date.now): TrafficProvider {
  const store = new Map<string, { at: number; v: number | null }>();
  return {
    name: p.name, label: p.label,
    async duration(leg) {
      const k = `${leg.from.lat.toFixed(4)},${leg.from.lng.toFixed(4)}>${leg.to.lat.toFixed(4)},${leg.to.lng.toFixed(4)}@${leg.departAt.slice(0, 15)}`;
      const hit = store.get(k);
      if (hit && now() - hit.at < ttlMs) return hit.v;
      const v = await p.duration(leg);
      if (v !== null) store.set(k, { at: now(), v });
      if (store.size > 2000) store.clear();
      return v;
    },
  };
}
