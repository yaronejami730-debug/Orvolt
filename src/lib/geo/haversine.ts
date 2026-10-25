export interface Point {
  lat: number;
  lng: number;
}
const R = 6371.0088; // rayon moyen de la Terre (km)
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance orthodromique en km (formule de haversine). */
export function haversineKm(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface ZoneLike {
  base_lat: number;
  base_lng: number;
  radius_km: number;
  active?: boolean;
}
export type DistanceStatus = "ok" | "over_radius" | "no_geocode" | "no_zone";
export interface DistanceResult {
  status: DistanceStatus;
  distance_km: number | null;
  radius_km: number | null;
}

const valid = (p: Point | null | undefined): p is Point =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/**
 * Contrôle de distance entre le lieu du rendez-vous et la zone du commercial.
 * - sans zone active (ou rayon invalide) : no_zone ; adresse non géocodée : no_geocode ;
 * - distance <= rayon : ok (la limite est incluse) ; sinon over_radius. Distances arrondies à 0,1 km.
 */
export function checkDistance(lead: Point | null | undefined, zone: ZoneLike | null | undefined): DistanceResult {
  if (!zone || zone.active === false || !(zone.radius_km > 0) || !valid({ lat: zone.base_lat, lng: zone.base_lng })) {
    return { status: "no_zone", distance_km: null, radius_km: zone && zone.radius_km > 0 ? zone.radius_km : null };
  }
  if (!valid(lead)) return { status: "no_geocode", distance_km: null, radius_km: zone.radius_km };
  const km = Math.round(haversineKm(lead, { lat: zone.base_lat, lng: zone.base_lng }) * 10) / 10;
  return { status: km <= zone.radius_km ? "ok" : "over_radius", distance_km: km, radius_km: zone.radius_km };
}

/** Deux créneaux [début, fin[ se chevauchent-ils ? (bornes contiguës = pas de chevauchement) */
export function overlaps(a: { start: Date | string; end: Date | string }, b: { start: Date | string; end: Date | string }): boolean {
  const [as, ae, bs, be] = [a.start, a.end, b.start, b.end].map((d) => new Date(d).getTime()) as [number, number, number, number];
  return as < be && bs < ae;
}
