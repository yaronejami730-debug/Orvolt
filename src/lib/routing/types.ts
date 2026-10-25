export interface Point {
  lat: number;
  lng: number;
}
export interface RoadMatrix {
  /** durations[i][j] en secondes, distances[i][j] en mètres (i -> j). */
  durations: number[][];
  distances: number[][];
}
export type RoutingKind = "osrm" | "fake" | "estimate";

/** Fournisseur d'itinéraires routiers. */
export interface RoutingProvider {
  kind: RoutingKind;
  /** Libellé affiché dans l'interface. */
  label: string;
  /** true : ce n'est PAS un vrai itinéraire (estimation) ; l'application automatique est refusée. */
  estimated: boolean;
  matrix(points: Point[]): Promise<RoadMatrix>;
  /** Distance (m) du point à la route la plus proche ; "unroutable" si aucune route ; absent si non supporté. */
  snap?(p: Point): Promise<number | "unroutable" | null>;
  route(a: Point, b: Point): Promise<{ durationS: number; distanceM: number }>;
}
