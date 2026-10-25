import type { PreviewData } from "@/app/(app)/agenda/repartition/actions";
import type { RouteStat } from "@/lib/dispatch/types";

export const DAY_COLORS = ["#5b80ff", "#2fa866", "#e8b052", "#c084fc", "#f472b6", "#2dd4bf", "#fb923c"];

/** Carte SVG simple (sans clé API) : base de la zone, rayon et points numérotés par tournée. Projection locale en km. */
export function DispatchMap({ rep, routes }: { rep: PreviewData["reps"][number]; routes: RouteStat[] }) {
  const kx = 111.32 * Math.cos((rep.base.lat * Math.PI) / 180);
  const ky = 110.57;
  const proj = (lat: number, lng: number) => ({ x: (lng - rep.base.lng) * kx, y: -(lat - rep.base.lat) * ky });
  const pts = routes.flatMap((r) => r.stops.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ s, ...proj(s.lat!, s.lng!) })));
  const extent = Math.max(rep.radiusKm, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.08;
  const days = routes.map((r) => r.day);
  const unit = extent / 100;
  return (
    <svg viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`} role="img" aria-label={`Carte de la zone de ${rep.name} : rayon ${rep.radiusKm} km, ${pts.length} rendez-vous`}
      className="aspect-square w-full max-w-[420px] rounded-lg border bg-muted" data-testid="dispatch-map">
      <circle cx={0} cy={0} r={rep.radiusKm} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={unit * 0.8} strokeDasharray={`${unit * 3} ${unit * 2}`} />
      {routes.map((r, di) => {
        const line = [{ x: 0, y: 0 }, ...r.stops.filter((s) => s.lat !== null).map((s) => proj(s.lat!, s.lng!))];
        return <polyline key={r.day} points={line.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={DAY_COLORS[days.indexOf(r.day) % DAY_COLORS.length]} strokeWidth={unit * 0.9} opacity={0.7 + 0 * di} />;
      })}
      <rect x={-unit * 2.2} y={-unit * 2.2} width={unit * 4.4} height={unit * 4.4} fill="var(--foreground)" />
      <text x={unit * 3.5} y={unit * 1.2} fontSize={unit * 4} fill="var(--muted-foreground)">Base</text>
      {routes.map((r) => r.stops.map((s, i) => {
        if (s.lat === null || s.lng === null) return null;
        const p = proj(s.lat, s.lng);
        const color = DAY_COLORS[days.indexOf(r.day) % DAY_COLORS.length];
        return (
          <g key={`${r.day}-${s.id}`}>
            <circle cx={p.x} cy={p.y} r={unit * 3.4} fill={s.kind === "new" ? color : "var(--muted-foreground)"} stroke="var(--background)" strokeWidth={unit * 0.6} />
            <text x={p.x} y={p.y + unit * 1.5} textAnchor="middle" fontSize={unit * 4.2} fontWeight={700} fill="#fff">{i + 1}</text>
          </g>
        );
      }))}
      <text x={-extent + unit * 2} y={extent - unit * 2} fontSize={unit * 4} fill="var(--muted-foreground)">Rayon {rep.radiusKm} km</text>
    </svg>
  );
}
