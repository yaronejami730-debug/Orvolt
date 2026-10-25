import { haversineKm } from "@/lib/geo/haversine";
import type { Point, RoadMatrix, RoutingProvider } from "./types";

export type FetchText = (url: string) => Promise<{ status: number; body?: string }>;

/** OSRM auto-hébergé (`/table/v1/driving` avec durées et distances). */
export function osrmProvider(baseUrl: string, fetchText: FetchText): RoutingProvider {
  const root = baseUrl.replace(/\/+$/, "");
  const coords = (pts: Point[]) => pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    kind: "osrm", label: "Itinéraires routiers réels (OSRM)", estimated: false,
    async matrix(points) {
      if (points.length === 0) return { durations: [], distances: [] };
      if (points.length === 1) return { durations: [[0]], distances: [[0]] };
      const res = await fetchText(`${root}/table/v1/driving/${coords(points)}?annotations=duration,distance`);
      if (res.status !== 200 || !res.body) throw new Error(`OSRM HTTP ${res.status}`);
      const j = JSON.parse(res.body) as { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
      if (j.code !== "Ok" || !j.durations || !j.distances) throw new Error(`OSRM ${j.code ?? "réponse invalide"}`);
      const fix = (m: (number | null)[][], i: number, k: number) => {
        const v = num(m[i]?.[k]);
        if (v === null) throw new Error("OSRM : point non routable");
        return v;
      };
      return {
        durations: points.map((_, i) => points.map((__, k) => fix(j.durations!, i, k))),
        distances: points.map((_, i) => points.map((__, k) => fix(j.distances!, i, k))),
      };
    },
    async snap(p) {
      try {
        const res = await fetchText(`${root}/nearest/v1/driving/${p.lng.toFixed(6)},${p.lat.toFixed(6)}?number=1`);
        if (res.status === 400 && res.body?.includes("NoSegment")) return "unroutable";
        if (res.status !== 200 || !res.body) return null;
        const j = JSON.parse(res.body) as { code?: string; waypoints?: { distance?: number }[] };
        if (j.code === "NoSegment") return "unroutable";
        const d = j.waypoints?.[0]?.distance;
        return typeof d === "number" ? d : null;
      } catch { return null; }
    },
    async route(a, b) {
      const m = await this.matrix([a, b]);
      return { durationS: m.durations[0]![1]!, distanceM: m.distances[0]![1]! };
    },
  };
}

/**
 * Fournisseur déterministe pour tests / CI : réseau routier synthétique NON euclidien.
 * Un « fleuve » (méridien 4.95) ne se franchit que par un pont (45.75, 4.95) : traverser impose le détour, comme un vrai réseau.
 * Une « montagne » (au-dessus de 45.9 de latitude) ralentit à 30 km/h ; ailleurs 50 km/h ; sinuosité 1,3.
 */
export const FAKE_RIVER_LNG = 4.95;
export const FAKE_BRIDGE: Point = { lat: 45.75, lng: FAKE_RIVER_LNG };
export function fakeRoad(a: Point, b: Point): { durationS: number; distanceM: number } {
  if (a.lat === b.lat && a.lng === b.lng) return { durationS: 0, distanceM: 0 };
  const sides = (a.lng < FAKE_RIVER_LNG) !== (b.lng < FAKE_RIVER_LNG);
  const km = (sides ? haversineKm(a, FAKE_BRIDGE) + haversineKm(FAKE_BRIDGE, b) : haversineKm(a, b)) * 1.3;
  const mountain = Math.max(a.lat, b.lat) > 45.9;
  return { durationS: Math.round((km / (mountain ? 30 : 50)) * 3600), distanceM: Math.round(km * 1000) };
}
/** Zone « hors route » synthétique (étang) : snap à 2 km. */
export const FAKE_OFFROAD = { latMin: 45.795, latMax: 45.805, lngMin: 4.905, lngMax: 4.915 };
export function fakeProvider(): RoutingProvider {
  return {
    async snap(p) {
      const o = FAKE_OFFROAD;
      return p.lat >= o.latMin && p.lat <= o.latMax && p.lng >= o.lngMin && p.lng <= o.lngMax ? 2000 : 0;
    },
    kind: "fake", label: "Itinéraires de test (réseau synthétique, aucun réseau)", estimated: false,
    async matrix(points) {
      const durations = points.map((a) => points.map((b) => fakeRoad(a, b).durationS));
      const distances = points.map((a) => points.map((b) => fakeRoad(a, b).distanceM));
      return { durations, distances } satisfies RoadMatrix;
    },
    async route(a, b) { return fakeRoad(a, b); },
  };
}

/** Repli visible : vol d'oiseau x 1,4 à 50 km/h. ÉTIQUETÉ estimation ; ne permet pas la validation automatique. */
export function estimateProvider(): RoutingProvider {
  const road = (a: Point, b: Point) => {
    const km = haversineKm(a, b) * 1.4;
    return { durationS: Math.round((km / 50) * 3600), distanceM: Math.round(km * 1000) };
  };
  return {
    kind: "estimate", label: "Estimation (itinéraire indisponible)", estimated: true,
    async matrix(points) {
      return { durations: points.map((a) => points.map((b) => road(a, b).durationS)), distances: points.map((a) => points.map((b) => road(a, b).distanceM)) };
    },
    async route(a, b) { return road(a, b); },
  };
}
