import type { LatLng } from "./types";

const f = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Itinéraire de la journée dans Google Maps (départ = base, étapes dans l'ordre, arrivée = dernier RDV). */
export function googleMapsRoute(base: LatLng, stops: LatLng[]): string | null {
  if (stops.length === 0) return null;
  const dest = stops[stops.length - 1]!;
  const way = stops.slice(0, -1);
  const q = new URLSearchParams({ api: "1", origin: f(base), destination: f(dest), travelmode: "driving" });
  if (way.length) q.set("waypoints", way.map(f).join("|"));
  return `https://www.google.com/maps/dir/?${q.toString().replace(/%2C/g, ",").replace(/%7C/g, "|")}`;
}

/** Navigation Waze vers un RDV. */
export const wazeTo = (p: LatLng) => `https://waze.com/ul?ll=${f(p)}&navigate=yes`;
