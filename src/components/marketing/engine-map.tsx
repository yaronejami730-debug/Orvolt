import { memo } from "react";
import { MAP_LABELS, MAP_PATHS } from "./lyon-map-data";

/* Fond de carte réel de l'agglomération lyonnaise (© OpenStreetMap contributors, ODbL), pré-généré par scripts/gen-lyon-map.mjs.
   Aucun appel réseau, aucune clé, aucune tuile. Couleurs : variables --map-* (marketing.css), sombre et clair.
   `u` = unités de carte par pixel écran : les traits et textes gardent une taille constante quel que soit le zoom d'affichage. */

function MapBaseImpl({ u, compact }: { u: number; compact: boolean }) {
  const P = MAP_PATHS;
  const roads: [string, string, number, string?, number?][] = [
    [P.minor, "var(--map-street)", 0.9],
    [P.tertiary, "var(--map-road3)", 1.4],
    [P.secondary, "var(--map-road2)", 2.1, "var(--map-casing)", 3.2],
    [P.primary, "var(--map-road1)", 2.9, "var(--map-casing)", 4.2],
    [P.motorway, "var(--map-motorway)", 3.6, "var(--map-casing)", 5],
  ];
  return (
    <g>
      <rect x="-60" y="-60" width="1000" height="880" fill="var(--map-land)" />
      <path d={P.parks} fill="var(--map-park)" />
      <path d={P.water} fill="var(--map-water)" stroke="var(--map-bank)" strokeWidth={1.2 * u} strokeLinejoin="round" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {roads.map(([d, c, w, cc, cw], i) => (
          <g key={i}>
            {cc && <path d={d} stroke={cc} strokeWidth={cw! * u} />}
            <path d={d} stroke={c} strokeWidth={w * u} />
          </g>
        ))}
      </g>
      <g fontWeight="600" textAnchor="middle" fill="var(--map-label)" stroke="var(--map-land)" strokeWidth={3 * u} paintOrder="stroke" strokeLinejoin="round" style={{ fontSize: `${(compact ? 8 : 9.5) * u}px`, letterSpacing: `${1.2 * u}px` }}>
        {MAP_LABELS.map((l) => (
          <text key={l.t} x={l.xy[0]} y={l.xy[1]} fontStyle={l.t === "Rhône" || l.t === "Saône" ? "italic" : undefined} fill={l.t === "Rhône" || l.t === "Saône" ? "var(--map-water-text)" : undefined} stroke={l.t === "Rhône" || l.t === "Saône" ? "var(--map-water)" : undefined}>
            {l.t === "Rhône" || l.t === "Saône" ? l.t : l.t.toUpperCase()}
          </text>
        ))}
      </g>
    </g>
  );
}

export const MapBase = memo(MapBaseImpl);
