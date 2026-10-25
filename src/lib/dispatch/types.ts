/** Types du moteur de répartition (TS pur, sans réseau ni base). Heures = minutes depuis minuit, heure locale (Europe/Paris). */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface DispatchRep {
  id: string;
  name: string;
  /** Base de la zone (départ du 1er RDV de la journée). */
  base: LatLng;
  radiusKm: number;
  workStartMin: number;
  workEndMin: number;
  /** Règle de charge : norme (4 par défaut), confort (5, détour faible seulement), maximum absolu (6, jamais automatique). */
  targetPerDay: number;
  comfortMax: number;
  absoluteMax: number;
  /** Jours travaillés, ISO : 1 = lundi … 7 = dimanche. */
  workDays: number[];
  /** Vitesse de repli (min/km, utilisée seulement pour l'estimation sans itinéraire) et marge fixe par trajet (minutes). */
  travelMinPerKm: number;
  travelMarginMin: number;
}

export interface DispatchRequest {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  durationMin: number;
  /** Fenêtre de jours souhaitée (AAAA-MM-JJ, bornes incluses). */
  wishFrom: string;
  wishTo: string;
}

export interface ExistingAppt {
  id: string;
  repId: string;
  day: string;
  startMin: number;
  endMin: number;
  lat: number | null;
  lng: number | null;
  label?: string;
}

/** Trajet routier A -> B (ids de points) : durée de conduite sans trafic (s) et distance (m). Inconnu => 0. */
export type LegLookup = (fromId: string, toId: string) => { durationS: number; distanceM: number };

export interface TrafficParams {
  morningCoef: number;
  eveningCoef: number;
  /** Marge de sécurité en % ajoutée à chaque trajet. */
  safetyPct: number;
}

export interface Unavailability {
  repId: string;
  day: string;
  /** null = journée entière. */
  startMin: number | null;
  endMin: number | null;
}

export const baseId = (repId: string) => `base:${repId}`;

export interface DispatchInput {
  reps: DispatchRep[];
  requests: DispatchRequest[];
  existing: ExistingAppt[];
  /** Jours candidats (horizon), AAAA-MM-JJ, triés ou non. */
  days: string[];
  /** Trajet maximal entre deux RDV consécutifs (km). */
  maxLegKm: number;
  /** Trajet maximal entre deux RDV et depuis la base, en minutes de conduite réelles. */
  maxLegMin: number;
  maxBaseMin: number;
  /** Détour maximal (minutes de conduite avec marge) pour ajouter un RDV au-delà de la norme. */
  maxExtraMin: number;
  /** Itinéraires routiers (ids : `base:<repId>`, id de la demande, id du RDV existant). */
  leg: LegLookup;
  traffic: TrafficParams;
  unavailability?: Unavailability[];
  /** Durées « avec trafic » fournies par un service externe, en minutes : clé `from|to|jour|quart d'heure de départ`. */
  trafficOverrides?: Record<string, number>;
}

export interface Assignment {
  requestId: string;
  repId: string;
  day: string;
  startMin: number;
  endMin: number;
  /** Rang dans la tournée du jour (1 = premier RDV). */
  order: number;
  /** Km routiers depuis le RDV précédent (ou la base pour le 1er). */
  legKm: number;
  /** Minutes de conduite réelles (sans trafic) et avec circulation estimée + marge de sécurité. */
  legBaseMin: number;
  legMin: number;
  /** Charge de la journée après ajout et explication (« 5e RDV ajouté : +12 min de route seulement »). */
  dayCount?: number;
  note?: string;
  extraMin?: number;
}

export interface Unassigned {
  requestId: string;
  label: string;
  reason: string;
 code: "no_geocode" | "detour" | "no_rep" | "out_of_zone" | "no_workday" | "full" | "leg_too_long" | "no_slot" | "out_of_horizon";
}

export interface RouteStop {
  kind: "new" | "existing";
  id: string;
  label: string;
  startMin: number;
  endMin: number;
  legKm: number;
  legBaseMin: number;
  legMin: number;
  note?: string;
  trafficSource: "free-flow" | "peak-estimate" | "provider";
  lat: number | null;
  lng: number | null;
}

export interface RouteStat {
  repId: string;
  day: string;
  count: number;
  newCount: number;
  /** Seuils de charge de ce commercial : norme / confort / maximum absolu. */
  target: number;
  comfort: number;
  absolute: number;
  totalKm: number;
  /** Conduite totale (minutes, avec circulation estimée). */
  totalDriveMin: number;
  /** Fin du dernier RDV (minutes). */
  endMin: number;
  stops: RouteStop[];
}

export interface DispatchResult {
  assignments: Assignment[];
  unassigned: Unassigned[];
  /** Une entrée par commercial et par jour ayant au moins un nouveau RDV. */
  stats: RouteStat[];
  /** Au-delà du confort : proposés, JAMAIS attribués automatiquement (case à cocher décochée par défaut). */
  proposed: Assignment[];
  /** Journées déjà au-delà du confort à cause de RDV posés/verrouillés : non modifiées, signalées. */
  warnings: { repId: string; day: string; count: number; comfort: number }[];
}
