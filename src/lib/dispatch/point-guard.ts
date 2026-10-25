import { haversineKm } from "@/lib/geo/haversine";
import { plausibleInFrance } from "@/lib/geo/coords";
import type { GeoPrecision } from "@/lib/geo/providers";

export interface ClientPoint {
  lat: number;
  lng: number;
  precision: GeoPrecision;
}
export type GuardedPoint =
  | { ok: true; lat: number; lng: number; precision: GeoPrecision; /** vrai si la position client a été dégradée (non confirmée par le serveur) */ capped: boolean; fromServer: boolean }
  | { ok: false; error: string };

/** Écart maximal (km) toléré entre le point envoyé par le client et le géocodage serveur de son libellé. */
export const CONFIRM_TOLERANCE_KM = 1.5;

/**
 * Revalide côté serveur un point reçu d'un client (suggestion d'adresse) : jamais cru sur parole.
 * - hors France => refus ; confirmateur (dispatch.manage) => point conservé tel quel ;
 * - autre utilisateur : le libellé est re-géocodé par le serveur (`server`). Si le point client est à moins de CONFIRM_TOLERANCE_KM
 *   du résultat serveur, c'est le résultat serveur (coordonnées + précision) qui est enregistré ; sinon la précision est plafonnée à
 *   « commune » (RDV « à vérifier » tant que le confirmateur n'a pas accepté l'approximation) : impossible de contourner assessPoint.
 */
export function guardClientPoint(client: ClientPoint, server: ClientPoint | null, dispatcher: boolean): GuardedPoint {
  if (!Number.isFinite(client.lat) || !Number.isFinite(client.lng) || !plausibleInFrance(client.lat, client.lng)) {
    return { ok: false, error: "Position hors de France : vérifiez les coordonnées." };
  }
  if (dispatcher) return { ok: true, ...client, capped: false, fromServer: false };
  if (server && plausibleInFrance(server.lat, server.lng) && haversineKm(client, server) <= CONFIRM_TOLERANCE_KM) {
    return { ok: true, lat: server.lat, lng: server.lng, precision: server.precision, capped: false, fromServer: true };
  }
  return { ok: true, lat: client.lat, lng: client.lng, precision: "municipality", capped: client.precision !== "municipality", fromServer: false };
}
