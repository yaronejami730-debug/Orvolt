"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Car, CheckCircle2, ChevronDown, ExternalLink, Home, Info, Navigation } from "lucide-react";
import type { PreviewData } from "@/app/(app)/agenda/repartition/actions";
import type { RouteStat } from "@/lib/dispatch/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMin } from "@/lib/dispatch/time";
import { googleMapsRoute, wazeTo } from "@/lib/dispatch/links";
import { TRAFFIC_WARNING } from "@/lib/dispatch/traffic";
import { DAY_COLORS, RouteMap, type MapDay } from "./dispatch-map";

const dayLabel = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const dayShort = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Ville d'une adresse française : texte après le code postal, sinon dernier segment. */
export function cityOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.match(/\b\d{5}\s+([^,]+)/);
  if (m) return m[1]!.trim();
  const parts = address.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : null;
}

const UNASSIGNED_HINT: Record<string, string> = {
  no_geocode: "Corrigez la position du RDV (carte) puis relancez.",
  detour: "Le détour serait trop long pour la journée du commercial.",
  no_rep: "Aucun commercial n'est disponible sur la période souhaitée.",
  out_of_zone: "L'adresse est hors de la zone de tous les commerciaux.",
  no_workday: "Aucun jour travaillé dans la fenêtre souhaitée.",
  full: "Toutes les journées possibles sont déjà complètes.",
  leg_too_long: "Le trajet depuis le RDV voisin ou la base serait trop long.",
  no_slot: "Aucun créneau libre dans les horaires de travail.",
  out_of_horizon: "La date souhaitée est hors de la période calculée.",
};

export function Proposal({ data, busy, onApply, onCancel, fifth, setFifth }: { data: PreviewData; busy: boolean; onApply: () => void; onCancel: () => void; fifth: string[]; setFifth: (ids: string[]) => void }) {
  const { plan, reps } = data;
  const byRep = reps.map((r) => ({ rep: r, routes: plan.stats.filter((s) => s.repId === r.id) })).filter((x) => x.routes.length > 0);
  const total = plan.assignments.length;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // La proposition apparaît sous le pli : on la montre (défilement doux, sauf préférence « réduire les animations ») et on y place le focus.
  useEffect(() => {
    const h = headingRef.current;
    if (!h) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    h.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    h.focus({ preventScroll: true });
  }, [data.planHash]);
  return (
    <section aria-label="Proposition de répartition" className="space-y-5" data-testid="proposal">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 ref={headingRef} tabIndex={-1} className="scroll-mt-20 text-lg font-semibold tracking-tight outline-none" data-testid="proposal-heading">{data.mode === "rebalance" ? "Proposition de rééquilibrage" : "Proposition de répartition"}</h2>
          <p className="text-sm text-foreground/80" data-testid="proposal-summary">{total} RDV proposés sur {plan.stats.length} journée(s){plan.unassigned.length > 0 ? ` · ${plan.unassigned.length} non attribué(s)` : ""}. Rien n&apos;est enregistré tant que vous n&apos;avez pas validé.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Annuler</Button>
          <Button onClick={onApply} loading={busy} disabled={(total === 0 && fifth.length === 0) || data.routing.estimated} data-testid="dispatch-apply"><CheckCircle2 className="size-4" /> {data.mode === "rebalance" ? "Valider le rééquilibrage" : "Valider la répartition"}</Button>
        </div>
      </div>

      {data.mode === "rebalance" && <RebalanceDiff data={data} />}
      {data.truncations.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md bg-warning/15 px-3 py-2 text-xs text-warning-text" data-testid="preview-truncation">
          {data.truncations.map((t) => <p key={t} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{t}</p>)}
        </div>
      )}
      <RoutingBanner data={data} />
      {byRep.map(({ rep, routes }) => <RepCard key={rep.id} data={data} rep={rep} routes={routes} />)}

      {plan.warnings.length > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-text" data-testid="overload-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Journée déjà au-delà du confort à cause de RDV posés ou verrouillés (non modifiée) : {plan.warnings.map((w) => `${reps.find((r) => r.id === w.repId)?.name ?? "—"} le ${dayShort(w.day)} (${w.count} RDV)`).join(", ")}.</p>
      )}
      {plan.proposed.length > 0 && (
        <Card data-testid="fifth">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning-text" />Au-delà du confort : journée chargée ({plan.proposed.length})</CardTitle>
            <p className="text-sm text-foreground/80">Jamais attribués automatiquement. Cochez ceux que vous acceptez : votre décision sera verrouillée.</p></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {plan.proposed.map((a) => (
                <li key={a.requestId} className="p-3 text-sm">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={fifth.includes(a.requestId)} data-testid="fifth-check"
                      onChange={(e) => setFifth(e.target.checked ? [...fifth, a.requestId] : fifth.filter((x) => x !== a.requestId))} />
                    <span className="min-w-0"><span className="font-medium">{data.requests[a.requestId]?.label ?? "RDV"}</span> <Badge tone="warning" className="ml-1">{a.dayCount ? `${a.dayCount}e RDV` : "Au-delà du confort"} : journée chargée</Badge>
                      <span className="block text-xs text-foreground/70">{reps.find((r) => r.id === a.repId)?.name} · {dayShort(a.day)} {fmtMin(a.startMin)}–{fmtMin(a.endMin)} · {a.legBaseMin} min · {a.legKm} km depuis le RDV précédent</span>
                      <span className="block text-xs text-warning-text">{a.note}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {plan.unassigned.length > 0 && (
        <Card data-testid="unassigned">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning-text" />Non attribués ({plan.unassigned.length})</CardTitle>
            <p className="text-sm text-foreground/80">Ces RDV n&apos;ont pas pu être placés automatiquement. Ils restent à attribuer ; la raison est indiquée pour chacun.</p></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {plan.unassigned.map((u) => (
                <li key={u.requestId} className="p-3 text-sm"><span className="font-medium">{u.label}</span><span className="block text-foreground/80">{u.reason}</span>
                  {UNASSIGNED_HINT[u.code] && <span className="block text-xs text-warning-text">{UNASSIGNED_HINT[u.code]}</span>}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function RepCard({ data, rep, routes }: { data: PreviewData; rep: PreviewData["reps"][number]; routes: RouteStat[] }) {
  const [activeDay, setActiveDay] = useState<string | "all">(routes[0]?.day ?? "all");
  const [selected, setSelected] = useState<string | null>(null);
  const newTotal = routes.reduce((n, r) => n + r.newCount, 0);
  const km = Math.round(routes.reduce((n, r) => n + r.totalKm, 0));
  const color = (day: string) => DAY_COLORS[routes.findIndex((r) => r.day === day) % DAY_COLORS.length]!;
  const mapDays: MapDay[] = routes.map((r) => ({
    day: r.day, color: color(r.day),
    stops: r.stops.flatMap((s, k) => (s.lat !== null && s.lng !== null ? [{ id: s.id, lat: s.lat, lng: s.lng, n: k + 1, kind: s.kind, title: `${k + 1}. ${s.label}` }] : [])),
  }));
  const hidden = routes.reduce((n, r) => n + r.stops.filter((s) => s.lat === null || s.lng === null).length, 0);
  const shown = activeDay === "all" ? routes : routes.filter((r) => r.day === activeDay);
  const pickDay = (d: string | "all") => { setActiveDay(d); setSelected(null); };
  const pickStop = (id: string, day: string) => { setActiveDay((cur) => (cur === "all" ? cur : day)); setSelected((cur) => (cur === id ? null : id)); };

  return (
    <Card data-testid={`rep-${rep.name}`}>
      <CardHeader className="gap-1.5">
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">{rep.name}
          <Badge tone="accent">{plural(newTotal, "nouveau RDV", "nouveaux RDV")}</Badge>
        </CardTitle>
        <p className="text-base text-foreground" data-testid="rep-summary">{rep.name} : {plural(newTotal, "nouveau RDV", "nouveaux RDV")} sur {plural(routes.length, "jour", "jours")}, {km} km au total.</p>
        <p className="flex items-start gap-1.5 text-sm text-foreground/75"><Home className="mt-0.5 size-3.5 shrink-0" /><span>Départ de la base : {rep.baseAddress}</span></p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div role="tablist" aria-label={`Jours de ${rep.name}`} className="flex flex-wrap gap-2">
            {routes.map((r) => {
              const on = activeDay === r.day;
              return (
                <button key={r.day} type="button" role="tab" aria-selected={on} onClick={() => pickDay(r.day)} data-testid="day-chip"
                  className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium capitalize transition-colors ${on ? "border-transparent bg-foreground text-background" : "bg-card text-foreground hover:bg-muted"}`}>
                  <span className="inline-block size-3 rounded-full" style={{ background: color(r.day) }} />{dayShort(r.day)}
                </button>
              );
            })}
            {routes.length > 1 && (
              <button type="button" role="tab" aria-selected={activeDay === "all"} onClick={() => pickDay("all")} data-testid="day-chip"
                className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors ${activeDay === "all" ? "border-transparent bg-foreground text-background" : "bg-card text-foreground hover:bg-muted"}`}>Tous les jours</button>
            )}
          </div>
          <RouteMapBlock rep={rep} mapDays={mapDays} activeDay={activeDay} selected={selected} onSelect={pickStop} />
          <Legend />
          {hidden > 0 && <p className="text-xs text-warning-text"><AlertTriangle className="mr-1 inline size-3.5" />{plural(hidden, "RDV n'a", "RDV n'ont")} pas de position GPS : {hidden > 1 ? "ils sont listés mais absents" : "il est listé mais absent"} de la carte.</p>}
        </div>

        <div className="space-y-4">
          {shown.map((r) => <DayList key={r.day} data={data} rep={rep} route={r} color={color(r.day)} selected={selected} onSelect={pickStop} />)}
        </div>

        <details className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none font-medium text-foreground/90">Détails de la zone</summary>
          <p className="mt-2 text-foreground/75">Rayon {rep.radiusKm} km · horaires {fmtMin(rep.workStartMin)}–{fmtMin(rep.workEndMin)} · norme {rep.targetPerDay} RDV/jour · confort {rep.comfortMax} · maximum {rep.absoluteMax}.</p>
        </details>
      </CardContent>
    </Card>
  );
}

function RouteMapBlock({ rep, mapDays, activeDay, selected, onSelect }: { rep: PreviewData["reps"][number]; mapDays: MapDay[]; activeDay: string | "all"; selected: string | null; onSelect: (id: string, day: string) => void }) {
  const n = mapDays.reduce((a, d) => a + d.stops.length, 0);
  return <RouteMap base={rep.base} baseName={rep.baseAddress} days={mapDays} activeDay={activeDay} selectedId={selected} onSelect={onSelect} ariaLabel={`Carte des rendez-vous de ${rep.name} : ${n} point(s). La liste ci-dessous contient les mêmes informations.`} />;
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-foreground/85" aria-label="Légende de la carte" data-testid="map-legend">
      <li className="flex items-center gap-1.5"><span className="flex size-5 items-center justify-center rounded-full border-2 border-white bg-[#4f7cff] text-[10px] font-bold text-white">1</span>Nouveau RDV</li>
      <li className="flex items-center gap-1.5"><span className="flex size-5 items-center justify-center rounded-full border-2 border-white bg-gray-500 text-[10px] font-bold text-white">2</span>Déjà planifié</li>
      <li className="flex items-center gap-1.5"><span className="flex size-5 items-center justify-center rounded-md border-2 border-white bg-gray-900 text-white"><Home className="size-3" /></span>Base</li>
    </ul>
  );
}

function DayList({ data, rep, route: r, color, selected, onSelect }: { data: PreviewData; rep: PreviewData["reps"][number]; route: RouteStat; color: string; selected: string | null; onSelect: (id: string, day: string) => void }) {
  const over = r.count > r.comfort;
  const pts = r.stops.filter((s): s is typeof s & { lat: number; lng: number } => s.lat !== null && s.lng !== null);
  const g = googleMapsRoute(rep.base, pts);
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4" data-testid={`route-${rep.name}-${r.day}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-base font-semibold capitalize"><span className="inline-block size-3 rounded-full" style={{ background: color }} />{dayLabel(r.day)}</h3>
        {g && (
          <span className="flex items-center gap-1">
            <a href={g} target="_blank" rel="noopener noreferrer" aria-label="Ouvrir l'itinéraire dans Google Maps" title="Ouvrir l'itinéraire dans Google Maps" data-testid="open-route"
              className="inline-flex size-9 items-center justify-center rounded-md border text-link hover:bg-muted"><ExternalLink className="size-4" /></a>
            <a href={wazeTo(pts[0]!)} target="_blank" rel="noopener noreferrer" aria-label="Waze : aller au 1er RDV" title="Waze : aller au 1er RDV"
              className="inline-flex size-9 items-center justify-center rounded-md border text-link hover:bg-muted"><Navigation className="size-4" /></a>
          </span>
        )}
      </div>
      <p data-testid="gauge" className={`mt-1 text-sm ${over ? "font-medium text-warning-text" : "text-foreground/85"}`} aria-label={`${r.count} RDV sur ${r.target} possibles`}>
        {r.count} RDV sur {r.target} possibles · {r.totalDriveMin} min de route · fini à {hm(r.endMin)}
      </p>

      <ol className="mt-3">
        {r.stops.map((s, k) => {
          const sel = selected === s.id;
          const addr = data.requests[s.id]?.address;
          const city = cityOf(addr);
          const name = data.requests[s.id]?.label ?? s.label;
          return (
            <li key={s.id} data-testid="stop">
              <div className="flex items-center gap-2 pl-[15px] text-sm text-foreground/70" aria-label={`${s.legBaseMin} minutes de route`}>
                <span className="h-6 w-0.5 rounded bg-border" aria-hidden />
                <Car className="size-3.5" aria-hidden /> {s.legBaseMin} min{k === 0 ? " depuis la base" : ""}
              </div>
              <button type="button" onClick={() => onSelect(s.id, r.day)} aria-pressed={sel}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${sel ? "border-foreground/60 bg-muted" : "border-transparent hover:bg-muted/60"} ${s.kind === "existing" ? "opacity-85" : ""}`}>
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-white text-sm font-bold text-white ${s.kind === "new" ? "" : "bg-gray-500"}`} style={s.kind === "new" ? { background: color } : undefined}>{k + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-base font-bold tabular-nums text-foreground">{fmtMin(s.startMin)}</span>
                    <span className="break-words text-[15px] font-medium text-foreground">{name}</span>
                    {city && <span className="text-sm text-foreground/75">{city}</span>}
                  </span>
                  {s.note && <span className="mt-0.5 block text-xs text-link" data-testid="load-note">{s.note}</span>}
                </span>
                {s.kind === "new" ? <Badge tone="accent" className="shrink-0">Nouveau</Badge> : <Badge tone="neutral" className="shrink-0">Déjà planifié</Badge>}
              </button>
            </li>
          );
        })}
      </ol>

      <details className="group mt-3 text-sm">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-foreground/75 hover:text-foreground"><ChevronDown className="size-4 transition-transform group-open:rotate-180" />Détails</summary>
        <ul className="mt-2 space-y-1.5 border-l-2 pl-3 text-xs text-foreground/75">
          {r.stops.map((s, k) => (
            <li key={s.id} data-testid="leg">
              {k + 1}. {k === 0 ? "depuis la base" : "depuis le RDV précédent"} : {s.legBaseMin} min · {s.legKm} km
              {s.legMin > s.legBaseMin && <span> (≈ {s.legMin} min avec circulation, {trafficNote(s.trafficSource, data)})</span>}
              {" "}· {fmtMin(s.startMin)}–{fmtMin(s.endMin)}
            </li>
          ))}
          <li>Total : {r.totalKm} km · conduite ≈ {r.totalDriveMin} min · fin {fmtMin(r.endMin)}.</li>
        </ul>
      </details>
    </div>
  );
}

function trafficNote(src: "free-flow" | "peak-estimate" | "provider", data: PreviewData): string {
  return src === "provider" ? `trafic ${data.routing.trafficLabel ?? "externe"}` : "estimation selon l'heure";
}

function RoutingBanner({ data }: { data: PreviewData }) {
  const r = data.routing;
  return (
    <div className="space-y-2" data-testid="routing-banner">
      {r.estimated && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive-text" data-testid="estimate-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {r.fellBack ? "Service de routage indisponible" : "Aucun service de routage configuré"} : durées et distances = estimation (vol d&apos;oiseau × 1,4). Aperçu seulement : la validation est désactivée.
        </p>
      )}
      <details className="group rounded-md bg-muted px-3 py-2 text-sm text-foreground/85">
        <summary className="flex cursor-pointer select-none items-center gap-2">
          <Info className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{r.estimated ? "Trajets estimés" : "Trajets calculés sur routes réelles"} ({r.label}). La circulation peut varier.</span>
          <span className="inline-flex items-center gap-1 text-xs text-link" title="Voir le détail du calcul">Détails<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></span>
        </summary>
        <div className="mt-2 space-y-2 text-xs text-foreground/75">
          <p><strong className="text-foreground">{r.label}</strong>. Circulation : {r.trafficLabel ? `trafic ${r.trafficLabel} à l'heure de départ` : `estimation selon l'heure (pointes ×${data.traffic.morningCoef} le matin, ×${data.traffic.eveningCoef} le soir, trajets > 15 min)`}, marge de sécurité +{data.traffic.safetyPct} %. Trajet max {data.maxLegMin} min entre RDV, {data.maxBaseMin} min depuis la base.</p>
          <p className="flex items-start gap-2 font-medium text-warning-text" data-testid="traffic-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{TRAFFIC_WARNING}</p>
        </div>
      </details>
    </div>
  );
}

function RebalanceDiff({ data }: { data: PreviewData }) {
  const rows = data.diff;
  const changed = rows.filter((r) => r.changed).length;
  return (
    <Card data-testid="rebalance-diff">
      <CardHeader><CardTitle>Avant / après ({changed} changement{changed > 1 ? "s" : ""})</CardTitle>
        <p className="text-sm text-foreground/80">Seuls les RDV à attribuer ou à rééquilibrer sont recalculés ; les RDV verrouillés et les autres RDV ne bougent pas.</p></CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="space-y-0.5 p-3 text-sm" data-testid="diff-row">
              <span className="font-medium">{r.label}</span>
              <span className="block text-xs text-foreground/70">Avant : {r.from ? `${r.from.rep} · ${dayShort(r.from.day)} ${fmtMin(r.from.start)}` : "non attribué"}</span>
              <span className={`block text-xs ${r.to ? (r.changed ? "text-link" : "text-foreground/70") : "text-warning-text"}`}>Après : {r.to ? `${r.to.rep} · ${dayShort(r.to.day)} ${fmtMin(r.to.start)}${r.changed ? "" : " (inchangé)"}` : "reste tel quel (aucun créneau)"}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
