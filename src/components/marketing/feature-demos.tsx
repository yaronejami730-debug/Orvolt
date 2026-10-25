"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileSpreadsheet, MapPin, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spotlight } from "./spotlight";
import { MapBase } from "./engine-map";
import { MAP_OUT, MAP_REPS, M_PER_UNIT, VIEW } from "./lyon-map-data";

/* Trois démos animées. Agenda : boucle CSS (marketing.css). Moteur et import : scènes pilotées par une horloge (useClock),
   qui ne tourne que lorsque la démo est visible. Sans animation (ou mouvement réduit), la scène affiche son état final. Données fictives. */

const BLUE = "#4170ff";
const AMBER = "#e8b052";
const GREY = "#8a93a6";
const RED = "#ef6a6a";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const POP = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/** Horloge d'une scène : t va de 0 à len + hold (ms), par pas de 40 ms ; `fade` couvre la dernière demi-seconde avant le redémarrage. */
function useClock(len: number, hold: number, step = 40) {
  const ref = useRef<HTMLDivElement>(null);
  const cycle = len + hold;
  const [t, setT] = useState(len);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let start = 0;
    let last = -1;
    const tick = (now: number) => {
      if (!start) start = now;
      const e = Math.floor(((now - start) % cycle) / step) * step;
      if (e !== last) { last = e; setT(e); }
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([en]) => {
      cancelAnimationFrame(raf);
      if (en?.isIntersecting) { start = 0; last = -1; raf = requestAnimationFrame(tick); } else setT(len);
    }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [len, cycle, step]);
  return { ref, t, fade: t > cycle - 500, reset: t < 120 };
}

function Cursor({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6 drop-shadow", className)} style={style} aria-hidden>
      <path d="M5 3l14 8-6 1.8L10.5 19z" fill="#fff" stroke="#05070d" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ agenda */

const s = (n: number) => `mk-d-s${n}`;

function AgendaDemo() {
  const rows = [
    { t: "9 h 00", who: "M. Roux", city: "Lyon 3e", km: null },
    { t: "10 h 45", who: "Mme Fontaine", city: "Villeurbanne", km: "6 km · 14 min" },
    { t: "13 h 30", who: "SCI Duval", city: "Caluire", km: "8 km · 17 min" },
    { t: "16 h 00", who: "M. Vidal", city: "Bron", km: "11 km · 22 min" },
  ];
  return (
    <div className="mx-auto w-full max-w-md space-y-1.5 text-sm" role="img" aria-label="Exemple d'agenda : quatre rendez-vous dans la journée avec la distance entre chacun">
      <div className="flex items-center justify-between pb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Pauline, lundi</span>
        <span className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => <i key={i} className="mk-d-dot size-2 rounded-full bg-accent" style={{ animationName: s(i + 1) }} />)}
          <span className="ml-1 tabular-nums">4/4</span>
        </span>
      </div>
      {rows.map((r, i) => (
        <div key={r.t}>
          {r.km && <p className="mk-d-item ml-3 border-l border-dashed pl-3 text-[11px] text-muted-foreground" style={{ animationName: s(i + 1) }}>{r.km}</p>}
          <div className="mk-d-item flex items-center gap-3 rounded-lg border bg-background/60 px-3 py-2" style={{ animationName: s(i + 1) }}>
            <span className="w-12 shrink-0 text-xs font-medium tabular-nums">{r.t}</span>
            <span className="min-w-0 flex-1 truncate">{r.who}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" aria-hidden />{r.city}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

type Pt = [number, number];

/* ------------------------------------------------------------------ moteur de répartition (vraie carte OSM de Lyon) */

const REP_COLORS = [BLUE, AMBER];
const ZONE_R = 4500 / M_PER_UNIT; // rayon de zone affiché : 4,5 km
const SEG0 = 6000, SEG_GAP = 1500, REP_LAG = 300;
const OUT_AT = 7500;
const ENGINE_LEN = 12600;
const ENGINE_HOLD = 1400;
/* Ordre de chute des épingles : [commercial, rang] ou [-1] pour le RDV hors zone. */
const DROP: [number, number][] = [[0, 0], [1, 0], [0, 1], [-1, 0], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]];
const dropAt = (r: number, k: number) => 900 + DROP.findIndex((d) => d[0] === r && d[1] === k) * 270;

type Leg = { pts: Pt[]; cum: number[]; total: number; mid: Pt; min: number; km: number; start: number; dur: number };
const LEGS: Leg[][] = MAP_REPS.map((rep, r) =>
  rep.legs.map((l, k) => {
    const pts = l.pts as Pt[];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    const total = cum[cum.length - 1]!;
    return { pts, cum, total, mid: pointAt({ pts, cum, total }, 0.5), min: l.min, km: l.km, start: SEG0 + k * SEG_GAP + r * REP_LAG, dur: 900 + l.min * 45 };
  }),
);

function pointAt(l: { pts: Pt[]; cum: number[]; total: number }, f: number): Pt {
  const d = l.total * f;
  let i = 1;
  while (i < l.cum.length - 1 && l.cum[i]! < d) i++;
  const a = l.pts[i - 1]!, b = l.pts[i]!, span = l.cum[i]! - l.cum[i - 1]! || 1;
  const q = (d - l.cum[i - 1]!) / span;
  return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q];
}
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const prog = (t: number, l: Leg) => ease((t - l.start) / l.dur);
const legD = (l: Leg) => l.pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
const HOUSE = "M-5.5 1.5 L0 -4.5 L5.5 1.5 M-3.8 0.2 V5.2 H3.8 V0.2";
const PIN = "M0 0 C-4 -7 -10 -12 -10 -20 a10 10 0 0 1 20 0 c0 8 -6 13 -10 20z";

function EngineDemo() {
  const { ref, t, fade, reset } = useClock(ENGINE_LEN, ENGINE_HOLD, 16);
  const svgRef = useRef<SVGSVGElement>(null);
  const [px, setPx] = useState(600);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx(Math.max(260, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const u = VIEW[2] / px;
  const compact = px < 440;
  const live = t < ENGINE_LEN;
  const on = (at: number) => t >= at;
  const placed = (r: number) => LEGS[r]!.filter((l) => on(l.start)).length;
  const lastEnd = Math.max(...LEGS.flat().map((l) => l.start + l.dur));
  const done = on(Math.min(lastEnd, ENGINE_LEN)); // l'état final (mouvement réduit : t = ENGINE_LEN) doit toujours être « terminé »
  const running = on(5300) && !done;
  const pressed = t >= 4850 && t < 5250;
  const mk = (x: number, y: number, extra = "") => `translate(${x} ${y}) scale(${u}) ${extra}`;

  return (
    <div ref={ref} className={cn("w-full", reset && "mk-reset")} style={{ opacity: fade ? 0 : 1, transition: "opacity 450ms ease" }} role="img" aria-label="Exemple de répartition automatique sur une vraie carte de Lyon : neuf rendez-vous confirmés. Pauline, partie de la place Bellecour, et Karim, parti de la place Léon Sublet à Vénissieux, reçoivent chacun quatre rendez-vous selon leur zone et le temps de route réel. Un rendez-vous à Saint-Étienne est refusé car hors zone, avec la raison.">
      <div className="flex items-center justify-between gap-3 pb-3 text-xs">
        <p className="flex min-w-0 items-center gap-2">
          {done ? (
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-white"><Check className="size-3" strokeWidth={3} aria-hidden /></span>
          ) : (
            <span className={cn("size-2 shrink-0 rounded-full", running ? "bg-accent" : "bg-muted-foreground")} style={running ? { animation: "pulse 1s ease-in-out infinite" } : undefined} aria-hidden />
          )}
          <span className="truncate">{done ? "8 attribués, 1 hors zone" : running ? "Calcul des routes et des horaires" : "9 RDV confirmés à attribuer"}</span>
        </p>
        <div className="relative shrink-0">
          <span
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-foreground"
            style={{ transform: pressed ? "scale(0.94)" : "scale(1)", boxShadow: pressed ? `0 0 0 6px ${BLUE}33` : "0 0 0 0 transparent", transition: "transform 160ms ease, box-shadow 260ms ease" }}
          >
            <Sparkles className="size-3.5" aria-hidden />{compact ? "Répartir" : "Répartir automatiquement"}
          </span>
          <Cursor
            className="absolute -bottom-3 left-1/2"
            style={{ opacity: t >= 3700 && t < 5500 ? 1 : 0, transform: t < 3900 ? "translate(70px, 50px)" : "translate(0, 0)", transition: `transform 900ms ${EASE}, opacity 300ms ease` }}
          />
        </div>
      </div>

      <div className="mk-map relative overflow-hidden rounded-xl border">
        <svg ref={svgRef} viewBox={VIEW.join(" ")} className="block h-auto w-full" aria-hidden>
          <MapBase u={u} compact={compact} />

          {/* zones : rayon autour de la base, avec onde du moteur */}
          {MAP_REPS.map((rep, r) => {
            const c = REP_COLORS[r]!;
            return (
              <g key={`z${r}`}>
                <circle cx={rep.base.xy[0]} cy={rep.base.xy[1]} r={ZONE_R} fill={c} fillOpacity="0.07" stroke={c} strokeOpacity="0.55" strokeWidth={1.4 * u} strokeDasharray={`${5 * u} ${6 * u}`} style={{ opacity: on(250 + r * 300) ? 1 : 0, transition: "opacity 700ms ease" }} />
                {live && t >= 5300 && t < 6400 && <circle cx={rep.base.xy[0]} cy={rep.base.xy[1]} r={ZONE_R} fill="none" stroke={c} strokeWidth={2.4 * u} className="mk-radar" />}
              </g>
            );
          })}

          {/* itinéraires sur les vraies rues */}
          {LEGS.map((legs, r) => legs.map((l, k) => {
            const p = prog(t, l);
            const c = REP_COLORS[r]!;
            return (
              <g key={`l${r}${k}`} style={{ opacity: p > 0 ? 1 : 0 }} fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d={legD(l)} pathLength={1} stroke="var(--map-route-casing)" strokeWidth={7.5 * u} strokeDasharray="1" strokeDashoffset={1 - p} />
                <path d={legD(l)} pathLength={1} stroke={c} strokeWidth={4.2 * u} strokeDasharray="1" strokeDashoffset={1 - p} />
              </g>
            );
          }))}

          {/* bases */}
          {MAP_REPS.map((rep, r) => (
            <g key={`b${r}`} transform={mk(rep.base.xy[0], rep.base.xy[1])} style={{ opacity: on(250 + r * 300) ? 1 : 0, transition: "opacity 500ms ease" }}>
              <rect x="-12" y="-12" width="24" height="24" rx="7" fill={REP_COLORS[r]} stroke="#fff" strokeWidth="2" />
              <path d={HOUSE} fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              <g transform="translate(0 -28)">
                <rect x={-(rep.name.length * 6.2 + 14) / 2} y="-9" width={rep.name.length * 6.2 + 14} height="18" rx="9" fill="var(--card)" stroke={REP_COLORS[r]} strokeWidth="1.4" />
                <text y="3.6" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--foreground)">{rep.name}</text>
              </g>
            </g>
          ))}

          {/* étiquettes de trajet réelles */}
          {LEGS.map((legs, r) => legs.map((l, k) => {
            const shown = prog(t, l) > 0.55;
            const label = compact ? `${l.min} min` : `${l.min} min · ${String(l.km).replace(".", ",")} km`;
            const w = label.length * 5.4 + 12;
            const pa = pointAt(l, 0.44), pb = pointAt(l, 0.56);
            const dl = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
            const sg = (k + r) % 2 ? 1 : -1;
            const ox = (-(pb[1] - pa[1]) / dl) * 19 * sg, oy = ((pb[0] - pa[0]) / dl) * 19 * sg;
            return (
              <g key={`t${r}${k}`} transform={mk(l.mid[0], l.mid[1], `translate(${ox} ${oy})`)} style={{ opacity: shown ? 1 : 0, transition: "opacity 300ms ease" }}>
                <g style={{ transform: shown ? "scale(1)" : "scale(0.6)", transition: `transform 350ms ${POP}` }}>
                  <rect x={-w / 2} y="-8" width={w} height="16" rx="8" fill="var(--card)" stroke={REP_COLORS[r]} strokeWidth="1.5" />
                  <text y="3.3" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--foreground)">{label}</text>
                </g>
              </g>
            );
          }))}

          {/* épingles de RDV : chute avec rebond, puis couleur du commercial et numéro d'ordre */}
          {MAP_REPS.map((rep, r) => rep.stops.map((st, k) => {
            const pop = dropAt(r, k);
            const leg = LEGS[r]![k]!;
            const assigned = on(leg.start);
            const c = REP_COLORS[r]!;
            if (!on(pop)) return null;
            return (
              <g key={`p${r}${k}`} transform={mk(st.xy[0], st.xy[1])}>
                <ellipse rx="6" ry="2.2" fill="#000" opacity="0.28" />
                {assigned && live && t < leg.start + 800 && <circle r="10" cy="-20" fill="none" stroke={c} strokeWidth="2" className="mk-ring" />}
                <g className={live && t < pop + 900 ? "mk-pin-drop" : undefined}>
                  <path d={PIN} fill={assigned ? c : GREY} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" style={{ transition: "fill 380ms ease" }} />
                  {assigned ? <text y="-16.4" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">{k + 1}</text> : <circle cy="-20" r="3.4" fill="#fff" opacity="0.9" />}
                  <text x="14" y="-12" fontSize={compact ? 9 : 10} fontWeight="600" fill="var(--foreground)" stroke="var(--map-land)" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round" style={{ opacity: on(pop + 350) ? 1 : 0, transition: "opacity 400ms ease" }}>{st.commune.startsWith("Lyon") ? st.label : st.commune}</text>
                </g>
              </g>
            );
          }))}

          {/* véhicules */}
          {LEGS.map((legs, r) => {
            const first = legs[0]!, last = legs[legs.length - 1]!;
            const end = last.start + last.dur;
            let pos: Pt = first.pts[0]!;
            for (const l of legs) {
              if (t >= l.start + l.dur) pos = l.pts[l.pts.length - 1]!;
              else if (t >= l.start) { pos = pointAt(l, prog(t, l)); break; }
              else break;
            }
            const show = t >= SEG0 - 400 + r * REP_LAG && t < end + 500;
            return (
              <g key={`v${r}`} transform={mk(pos[0], pos[1])} style={{ opacity: show ? 1 : 0, transition: "opacity 300ms ease" }}>
                <circle r="12" fill={REP_COLORS[r]} opacity="0.25"><animate attributeName="r" values="8;15;8" dur="1.4s" repeatCount="indefinite" /></circle>
                <circle r="6" fill="#fff" stroke={REP_COLORS[r]} strokeWidth="3.2" />
              </g>
            );
          })}

          {/* RDV hors zone : indicateur en bord de carte, refusé avec sa raison */}
          {on(dropAt(-1, 0)) && (
            <g transform={mk(MAP_OUT.edge[0], MAP_OUT.edge[1])}>
              <g className={live && t < dropAt(-1, 0) + 900 ? "mk-pin-drop" : undefined}>
                <g className={live && t >= OUT_AT && t < OUT_AT + 600 ? "mk-shake" : undefined}>
                  <circle r="14" fill={on(OUT_AT) ? RED : GREY} stroke="#fff" strokeWidth="2" style={{ transition: "fill 300ms ease" }} />
                  <path d="M-5 0 H5 M1 -4.5 L5.5 0 L1 4.5" transform={`rotate(${MAP_OUT.angle})`} fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </g>
              <g style={{ opacity: on(OUT_AT + 200) ? 1 : 0, transform: on(OUT_AT + 200) ? "translateY(0)" : "translateY(6px)", transition: "opacity 350ms ease, transform 400ms ease" }}>
                <rect x="20" y="-20" width={compact ? 172 : 184} height="40" rx="10" fill="var(--card)" stroke={RED} strokeWidth="1.5" />
                <text x="30" y="-3" fontSize="10.5" fontWeight="700" fill={RED}>Refusé : hors zone</text>
                <text x="30" y="12" fontSize="10" fill="var(--muted-foreground)">{MAP_OUT.label} · {MAP_OUT.min} min (max 30)</text>
              </g>
            </g>
          )}
        </svg>
        <span className="pointer-events-none absolute bottom-1 right-1.5 rounded bg-card/80 px-1 text-[9px] leading-4 text-muted-foreground">© OpenStreetMap contributors</span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {MAP_REPS.map((rep, r) => {
          const n = placed(r);
          const c = REP_COLORS[r]!;
          return (
            <div key={rep.name} className="flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-2 text-xs">
              <span className="size-2 rounded-full" style={{ background: c }} aria-hidden />
              <span className="min-w-0 truncate font-medium">{rep.name}<span className="ml-1.5 font-normal text-muted-foreground">{rep.base.label}</span></span>
              <span className="ml-auto flex items-center gap-1" aria-hidden>
                {[0, 1, 2, 3].map((d) => <i key={d} className="size-2 rounded-full" style={{ background: d < n ? c : "var(--muted)", transform: d === n - 1 ? "scale(1.25)" : "scale(1)", transition: `background 300ms ease, transform 300ms ${POP}` }} />)}
              </span>
              <span className="w-7 text-right tabular-nums text-muted-foreground">{n}/4</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground" style={{ opacity: on(OUT_AT + 400) ? 1 : 0, transition: "opacity 400ms ease" }}>
        <TriangleAlert className="mt-px size-3 shrink-0" style={{ color: RED }} aria-hidden />Le RDV hors zone n&apos;est jamais attribué : il reste à traiter, avec la raison.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ import CSV */

const CSV_FILE_COLS = ["telephone", "nom_complet", "origine", "commune", "col_5"];
const CSV_FIELDS = ["Nom", "Téléphone", "Ville", "Source", "Ignorée"];
const CSV_MAP = [1, 0, 3, 2, 4]; // colonne du fichier -> champ du CRM
const CSV_ROWS: { v: [string, string, string, string]; dup?: boolean }[] = [
  { v: ["Camille Roux", "06 12 ·· ·· 34", "Lyon", "Meta"] },
  { v: ["Hugo Martin", "06 48 ·· ·· 71", "Nantes", "Google"] },
  { v: ["Léa Bernard", "07 22 ·· ·· 05", "Lille", "Salon"], dup: true },
  { v: ["Nathan Petit", "06 90 ·· ·· 18", "Tours", "Meta"] },
  { v: ["Inès Moreau", "07 51 ·· ·· 66", "Rennes", "Google"], dup: true },
  { v: ["Louis Girard", "06 30 ·· ·· 92", "Annecy", "Meta"] },
];
const CSV_LEADS = [CSV_ROWS[0]!, CSV_ROWS[1]!, CSV_ROWS[3]!, CSV_ROWS[5]!];
const CSV_LEN = 12400;
const CSV_HOLD = 1600;
const STEPS = ["Fichier", "Colonnes", "Contrôle", "Pipeline"];
const ROW_H = 28, ROW_GAP = 6;
const rowY = (i: number) => i * (ROW_H + ROW_GAP) + ROW_H / 2;
const MAP_AT = (i: number) => 1900 + i * 480;
const SCAN_AT = (i: number) => 5000 + i * 470;
const LEAD_AT = (i: number) => 9700 + i * 330;

function ImportDemo() {
  const { ref, t, fade, reset } = useClock(CSV_LEN, CSV_HOLD);
  const on = (at: number) => t >= at;
  const step = t < 2000 ? 0 : t < 4700 ? 1 : t < 9200 ? 2 : 3;
  const p = ease((t - 5000) / 3100);
  const count = Math.round(148 * p);
  const leads = Math.round(142 * ease((t - 9700) / 1900));
  const stage = (active: boolean): React.CSSProperties => ({ opacity: active ? 1 : 0, transform: active ? "translateY(0)" : "translateY(8px)", pointerEvents: "none", transition: `opacity 420ms ease, transform 480ms ${EASE}` });
  const reveal = (at: number): React.CSSProperties => ({ opacity: on(at) ? 1 : 0, transform: on(at) ? "translateY(0)" : "translateY(8px)", transition: `opacity 400ms ease, transform 450ms ${EASE}` });
  const summary = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1"><span className="grid size-4 place-items-center rounded-full bg-success text-white"><Check className="size-2.5" strokeWidth={3} aria-hidden /></span>142 importés</span>
      <span className="inline-flex items-center rounded-full border px-2.5 py-1" style={{ color: AMBER, borderColor: `${AMBER}66` }}>6 doublons ignorés</span>
    </div>
  );

  return (
    <div ref={ref} className={cn("w-full space-y-4 text-sm", reset && "mk-reset")} style={{ opacity: fade ? 0 : 1, transition: "opacity 450ms ease" }} role="img" aria-label="Exemple d'import CSV en quatre étapes : le fichier de 148 lignes est déposé, ses colonnes sont associées aux champs du CRM, chaque ligne est contrôlée et six doublons sont repérés, puis 142 leads arrivent dans la colonne À rappeler du pipeline.">
      {/* étapes */}
      <ol className="flex items-center gap-1.5 text-[11px]" aria-hidden>
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5 last:flex-none [&:not(:last-child)]:flex-1">
            <span className="grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold tabular-nums" style={{ background: step > i ? "var(--success)" : step === i ? "var(--accent)" : "transparent", borderColor: step >= i ? "transparent" : undefined, color: step >= i ? "#fff" : "var(--muted-foreground)", transform: step === i ? "scale(1.12)" : "scale(1)", transition: `background 300ms ease, transform 350ms ${POP}` }}>
              {step > i ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("hidden transition-colors sm:inline", step === i ? "font-medium text-foreground" : "text-muted-foreground")}>{s}</span>
            {i < STEPS.length - 1 && <span className="relative h-px min-w-3 flex-1 bg-border"><span className="absolute inset-y-0 left-0 w-full origin-left bg-accent" style={{ transform: step > i ? "scaleX(1)" : "scaleX(0)", transition: "transform 500ms ease" }} /></span>}
          </li>
        ))}
      </ol>

      <div className="grid">
        {/* 1-2 : fichier et colonnes */}
        <div className="col-start-1 row-start-1 space-y-3" style={stage(t < 4700)}>
          <div className="grid">
            <div className="col-start-1 row-start-1 flex h-11 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground" style={{ opacity: t < 1100 ? 1 : 0, borderColor: t >= 250 && t < 800 ? BLUE : undefined, background: t >= 250 && t < 800 ? `${BLUE}14` : undefined, transition: "opacity 350ms ease, background 250ms ease, border-color 250ms ease" }}>
              <Upload className="size-3.5" aria-hidden />Déposez votre fichier CSV
            </div>
            <div className="col-start-1 row-start-1 flex h-11 items-center gap-2 rounded-lg border bg-background/60 px-3" style={{ opacity: on(500) ? 1 : 0, transform: on(500) ? "translateY(0) rotate(0)" : "translateY(-30px) rotate(-3deg)", transition: `opacity 250ms ease, transform 700ms ${POP}` }}>
              <FileSpreadsheet className="size-4 shrink-0 text-success-text" aria-hidden />
              <span className="min-w-0 flex-1 truncate">leads-octobre.csv</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">148 lignes · 5 colonnes</span>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_clamp(36px,16%,80px)_1fr] text-[11px]" style={{ opacity: on(1500) ? 1 : 0, transition: "opacity 400ms ease" }}>
            <p className="pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Colonnes du fichier</p>
            <span />
            <p className="pb-1.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Champs du CRM</p>
            <div className="flex flex-col" style={{ gap: ROW_GAP }}>
              {CSV_FILE_COLS.map((c, i) => (
                <code key={c} className="flex items-center truncate rounded-md bg-muted px-2" style={{ height: ROW_H, boxShadow: on(MAP_AT(i)) && t < MAP_AT(i) + 450 ? `0 0 0 2px ${BLUE}` : "0 0 0 0 transparent", transition: "box-shadow 250ms ease" }}>{c}</code>
              ))}
            </div>
            <svg className="h-full w-full" viewBox={`0 0 100 ${5 * ROW_H + 4 * ROW_GAP}`} preserveAspectRatio="none" aria-hidden>
              {CSV_FILE_COLS.map((c, i) => {
                const a = rowY(i), b = rowY(CSV_MAP[i]!);
                const ignored = i === 4;
                return <path key={c} d={`M0 ${a} C 55 ${a}, 45 ${b}, 100 ${b}`} fill="none" stroke={ignored ? GREY : BLUE} strokeWidth="2" strokeLinecap="round" strokeDasharray={ignored ? "4 4" : undefined} vectorEffect="non-scaling-stroke" style={{ clipPath: on(MAP_AT(i)) ? "inset(-4px 0 -4px 0)" : "inset(-4px 100% -4px 0)", transition: "clip-path 520ms cubic-bezier(0.65, 0, 0.35, 1)" }} />;
              })}
            </svg>
            <div className="flex flex-col" style={{ gap: ROW_GAP }}>
              {CSV_FIELDS.map((f, fi) => {
                const src = CSV_MAP.indexOf(fi);
                const mapped = on(MAP_AT(src) + 450);
                const ignored = fi === 4;
                return (
                  <span key={f} className="flex items-center justify-end gap-1.5 rounded-md border px-2 font-medium" style={{ height: ROW_H, borderStyle: mapped ? "solid" : "dashed", borderColor: mapped ? (ignored ? GREY : BLUE) : undefined, background: mapped && !ignored ? `${BLUE}1a` : undefined, color: mapped && ignored ? GREY : undefined, transition: "border-color 300ms ease, background 300ms ease, color 300ms ease" }}>
                    <span className="truncate">{f}</span>
                    <Check className="size-3 shrink-0" strokeWidth={3} style={{ opacity: mapped && !ignored ? 1 : 0, color: BLUE, transform: mapped ? "scale(1)" : "scale(0.3)", transition: `opacity 250ms ease, transform 350ms ${POP}` }} aria-hidden />
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3 : contrôle ligne par ligne */}
        <div className="col-start-1 row-start-1 space-y-3" style={stage(t >= 4700 && t < 9200)}>
          <div className="rounded-lg border bg-background/60 p-1.5">
            {CSV_ROWS.map((r, i) => {
              const at = SCAN_AT(i);
              const scanning = t >= at && t < at + 320;
              const checked = on(at + 320);
              const dimmed = r.dup && on(8300);
              return (
                <div key={r.v[0]} className="grid grid-cols-[1.5fr_0.9fr_0.8fr_auto] items-center sm:grid-cols-[1.25fr_1.25fr_0.9fr_0.8fr_auto] gap-1.5 rounded-md px-1.5 text-[11px]" style={{ height: 30, background: scanning ? `${BLUE}24` : r.dup && checked ? `${AMBER}1f` : "transparent", opacity: dimmed ? 0.5 : 1, transition: "background 220ms ease, opacity 400ms ease" }}>
                  <span className={cn("truncate font-medium", dimmed && "line-through")}>{r.v[0]}</span>
                  <span className="hidden truncate tabular-nums text-muted-foreground sm:block">{r.v[1]}</span>
                  <span className="truncate text-muted-foreground">{r.v[2]}</span>
                  <span className="truncate text-muted-foreground">{r.v[3]}</span>
                  <span className="grid h-4 min-w-14 place-items-center justify-self-end">
                    <span className="col-start-1 row-start-1" style={{ opacity: checked ? 1 : 0, transform: checked ? "scale(1)" : "scale(0.4)", transition: `opacity 250ms ease, transform 350ms ${POP}` }}>
                      {r.dup ? <span className="rounded px-1 text-[10px] font-semibold" style={{ background: `${AMBER}33`, color: AMBER }}>Doublon</span> : <Check className="size-3.5 text-success-text" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="col-start-1 row-start-1 size-1.5 rounded-full bg-muted-foreground/40" style={{ opacity: checked ? 0 : 1, transform: scanning ? "scale(1.8)" : "scale(1)", background: scanning ? BLUE : undefined, transition: "opacity 200ms ease, transform 250ms ease" }} />
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full w-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${p})`, transition: "transform 60ms linear" }} /></div>
            <span className="w-28 text-right tabular-nums text-muted-foreground">{count} / 148 lignes</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={reveal(8400)}><span className="grid size-4 place-items-center rounded-full bg-success text-white"><Check className="size-2.5" strokeWidth={3} aria-hidden /></span>142 prêts à importer</span>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1" style={{ ...reveal(8650), color: AMBER, borderColor: `${AMBER}66` }}>6 doublons écartés</span>
          </div>
        </div>

        {/* 4 : arrivée dans le pipeline */}
        <div className="col-start-1 row-start-1 space-y-3" style={stage(t >= 9200)}>
          {summary}
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {[["Nouveau", 0], ["À rappeler", 1], ["Contacté", 2]].map(([name, ci]) => {
              const hot = ci === 1;
              return (
                <div key={name as string} className="min-w-0 rounded-lg border p-1 sm:p-1.5" style={{ background: hot ? `${BLUE}12` : "color-mix(in srgb, var(--muted) 45%, transparent)", borderColor: hot ? `${BLUE}88` : undefined, boxShadow: hot && t >= 9500 && t < 11700 ? `0 0 0 3px ${BLUE}22` : "0 0 0 0 transparent", transition: "box-shadow 400ms ease, border-color 300ms ease" }}>
                  <div className="mb-1.5 flex items-center justify-between gap-1 px-0.5">
                    <span className="truncate text-[10.5px] font-medium sm:text-[11px]">{name}</span>
                    {hot && <span className="rounded-full bg-accent px-1 text-[9px] font-semibold tabular-nums text-accent-foreground">{leads}</span>}
                  </div>
                  <div className="space-y-1.5">
                    {hot ? CSV_LEADS.map((l, i) => (
                      <div key={l.v[0]} className="rounded-md border bg-card px-1.5 py-1" style={{ opacity: on(LEAD_AT(i)) ? 1 : 0, transform: on(LEAD_AT(i)) ? "translate(0, 0) scale(1)" : "translate(-46px, -14px) scale(0.92)", transition: `opacity 350ms ease, transform 600ms ${EASE}` }}>
                        <p className="truncate font-medium">{l.v[0]}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{l.v[2]} · {l.v[3]}</p>
                      </div>
                    )) : [0, 1].slice(0, ci === 0 ? 2 : 1).map((g) => (
                      <div key={g} className="rounded-md border border-dashed px-1.5 py-1.5 opacity-60"><span className="block h-1.5 w-3/4 rounded bg-muted-foreground/25" /><span className="mt-1 block h-1.5 w-1/2 rounded bg-muted-foreground/15" /></div>
                    ))}
                    {hot && <p className="px-0.5 pt-0.5 text-[10px] text-muted-foreground" style={reveal(LEAD_AT(4))}>+ 138 autres leads</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ section */

const DEMOS: { id: string; title: string; text: string; points: string[]; visual: React.ReactNode; flip?: boolean }[] = [
  {
    id: "moteur", title: "Le moteur de répartition",
    text: "Dès que le confirmateur valide, le moteur choisit le commercial et l'heure de chaque rendez-vous. Vous voyez la proposition avant de valider.",
    points: ["Zone : rayon autour de la base et temps de route réel", "Distance : trajets les plus courts entre deux rendez-vous", "Horaires : début, fin et maximum par jour, réglés par commercial"],
    visual: <EngineDemo />,
  },
  {
    id: "import", flip: true, title: "Import CSV, sans ressaisie",
    text: "Déposez le fichier, associez les colonnes une fois, et les doublons sont repérés avant l'import.",
    points: ["Association des colonnes aux champs", "Contrôle ligne par ligne", "Doublons écartés, le reste importé"],
    visual: <ImportDemo />,
  },
  {
    id: "agenda", title: "Un agenda qui se remplit seul",
    text: "Les rendez-vous attribués tombent dans la journée du commercial, avec le trajet réel entre chacun.",
    points: ["Environ 4 rendez-vous par jour", "Trajet et durée affichés entre deux rendez-vous"],
    visual: <AgendaDemo />,
  },
];

export function FeatureDemos() {
  return (
    <section id="demos" aria-labelledby="demos-title" className="scroll-mt-20 pb-20 sm:pb-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <h2 id="demos-title" className="max-w-2xl text-balance text-3xl font-bold tracking-[-0.045em] sm:text-5xl">Voyez-le travailler</h2>
        <p className="mt-4 max-w-xl text-muted-foreground sm:text-lg">Exemples animés avec des données fictives.</p>
        <div className="mt-12 space-y-4">
          {DEMOS.map((d) => (
            <Spotlight as="article" key={d.id} className="p-6 sm:p-8 md:grid md:grid-cols-5 md:items-center md:gap-10">
              <div className={cn("md:col-span-2", d.flip && "md:order-2")}>
                <h3 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl">{d.title}</h3>
                <p className="mt-3 text-muted-foreground">{d.text}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {d.points.map((x) => (
                    <li key={x} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={3} aria-hidden />{x}</li>
                  ))}
                </ul>
              </div>
              <div className={cn("mt-8 md:col-span-3 md:mt-0", d.flip && "md:order-1")}>{d.visual}</div>
            </Spotlight>
          ))}
        </div>
      </div>
    </section>
  );
}
