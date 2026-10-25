"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarCheck, CheckCircle2, ExternalLink, FlaskConical, Info, MapPin, Navigation, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  applyDispatchAction, clearSimulationAction, confirmPendingAction, launchSimulationAction, previewDispatchAction, type PreviewData,
} from "@/app/(app)/agenda/repartition/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtMin } from "@/lib/dispatch/time";
import { googleMapsRoute, wazeTo } from "@/lib/dispatch/links";
import { TRAFFIC_WARNING } from "@/lib/dispatch/traffic";
import type { ToCheck } from "@/lib/dispatch/server";
import { LocationFixDialog } from "./location-fix-dialog";
import { DAY_COLORS, DispatchMap } from "./dispatch-map";

export interface PendingView {
  id: string;
  lead_name: string;
  address: string | null;
  status: string;
  wishFrom: string;
  wishTo: string;
  durationMin: number;
}

const dayLabel = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const dayShort = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const wishLabel = (a: string, b: string) => (a === b ? dayShort(a) : `${dayShort(a)} → ${dayShort(b)}`);

const SIM_URL = "/agenda/repartition?vue=simulation";

export function DispatchPanel({ pending, repCount, canSimulate, hasSimulation, simulationView, truncations, toCheck, fixedCount }: { pending: PendingView[]; repCount: number; canSimulate: boolean; hasSimulation: boolean; simulationView: boolean; truncations: string[]; toCheck: ToCheck[]; fixedCount: number }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ applied: number; unassigned: number } | null>(null);
  const [fifth, setFifth] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const checkIds = new Set(toCheck.map((c) => c.id));
  const confirmed = pending.filter((p) => p.status === "confirmed" && !checkIds.has(p.id));
  const toConfirm = pending.filter((p) => p.status !== "confirmed");

  const run = (rebalance = false) => start(async () => {
    setError(null); setDone(null);
    const r = await previewDispatchAction({ ...(rebalance ? { rebalance: true } : {}), ...(simulationView ? { simulation: true } : {}) });
    if (r.ok && r.data) setPreview(r.data); else { setPreview(null); setError(r.error ?? "Calcul impossible."); }
  });
  const apply = () => start(async () => {
    if (!preview) return;
    const r = await applyDispatchAction({ planHash: preview.planHash, rebalance: preview.mode === "rebalance", includeFifth: fifth, ...(simulationView ? { simulation: true } : {}) });
    if (r.ok && r.data) {
      toast.success(`${r.data.applied} RDV attribué(s).`);
      setDone({ applied: r.data.applied, unassigned: r.data.unassigned });
      setPreview(null); setFifth([]);
      router.refresh();
    } else {
      toast.error(r.error ?? "Répartition impossible.");
      if (r.code === "stale" || r.code === "rejected") { setPreview(null); setError(r.error ?? null); router.refresh(); }
    }
  });
  const simulate = () => start(async () => {
    const r = await launchSimulationAction();
    if (r.ok && r.data) { toast.success(`Simulation : ${r.data.created} RDV confirmés créés (zone de ${r.data.zoneOwner}). Ceux dont la position est à vérifier sont signalés séparément.`); setPreview(null); setDone(null); setFifth([]); router.push(SIM_URL); router.refresh(); }
    else toast.error(r.error);
  });
  const clearSim = () => start(async () => {
    const r = await clearSimulationAction();
    if (r.ok && r.data) {
      toast.success(r.data.assignedRemoved > 0 ? `Simulation supprimée, dont ${r.data.assignedRemoved} RDV simulé(s) déjà attribué(s) (aucun vrai RDV concerné).` : "Simulation supprimée.");
      setPreview(null); setDone(null);
      if (simulationView) router.push("/agenda/repartition");
      router.refresh();
    } else toast.error(r.error ?? "Suppression impossible.");
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>RDV confirmés à attribuer <Badge tone="accent" data-testid="pending-count" className="ml-1">{confirmed.length}</Badge></CardTitle>
            {toCheck.length > 0 && <p className="text-sm font-medium text-warning-text" data-testid="pending-split"><AlertTriangle className="mr-1 inline size-3.5" />{confirmed.length} à répartir · {toCheck.length} à vérifier ({confirmed.length + toCheck.length} RDV confirmés au total). Les {toCheck.length} à vérifier sont listés plus bas : corrigez leur position pour les inclure.</p>}
            <p className="text-sm text-muted-foreground">Le moteur choisit le commercial (zone, distance) et l&apos;heure de début de chaque RDV.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSimulate && (
              <Button variant="outline" onClick={simulate} loading={busy} data-testid="sim-launch"><FlaskConical className="size-4" /> Lancer une simulation</Button>
            )}
            {canSimulate && hasSimulation && !simulationView && (
              <Button asChild variant="outline"><Link href={SIM_URL} data-testid="sim-open"><FlaskConical className="size-4" /> Voir la simulation</Link></Button>
            )}
            {canSimulate && hasSimulation && (
              <Button variant="ghost" onClick={clearSim} disabled={busy} data-testid="sim-clear"><Trash2 className="size-4" /> Supprimer la simulation</Button>
            )}
            <Button onClick={() => run()} loading={busy} disabled={(confirmed.length === 0 && toCheck.length === 0) || repCount === 0} data-testid="dispatch-run"><Sparkles className="size-4" /> Répartir automatiquement</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {simulationView && (
            <p className="flex flex-col gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-text sm:flex-row sm:items-center sm:justify-between" data-testid="sim-banner">
              <span><FlaskConical className="mr-1 inline size-4" />Vue simulation : données fictives, invisibles dans l&apos;agenda, les listes et les tableaux de bord. Valider n&apos;envoie aucune notification et ne change aucun propriétaire de lead.</span>
              <Button asChild size="sm" variant="outline"><Link href="/agenda/repartition" data-testid="sim-back">Retour aux RDV réels</Link></Button>
            </p>
          )}
          {canSimulate && !simulationView && <p className="rounded-md bg-warning/15 px-3 py-2 text-xs text-warning-text" data-testid="sim-note"><FlaskConical className="mr-1 inline size-3.5" />Simulation : crée 10 leads « [SIMULATION] » avec un RDV confirmé non attribué autour de la zone d&apos;un commercial, pour essayer le moteur. Ils sont isolés des vrais RDV (invisibles hors de la vue simulation, sans notification) ; un seul jeu à la fois, supprimable à tout moment.</p>}
          {truncations.length > 0 && (
            <div role="alert" className="space-y-1 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-text" data-testid="truncation-warning">
              {truncations.map((t) => <p key={t} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{t}</p>)}
            </div>
          )}
          {repCount === 0 && <p className="flex items-start gap-2 text-sm text-warning-text"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Aucun commercial avec une zone active : définissez une zone et des horaires dans Réglages &gt; Membres.</p>}
          {confirmed.length === 0 ? (
            <EmptyState icon={CalendarCheck} title={toCheck.length > 0 ? "Aucun RDV prêt à répartir" : "Aucun RDV confirmé à attribuer"} description={toCheck.length > 0 ? `${toCheck.length} RDV confirmé(s) attendent une vérification de position (carte ci-dessous).` : "Dès qu'un RDV est confirmé sans commercial, il apparaît ici. Vous pouvez aussi lancer une simulation."} />
          ) : (
            <ul className="divide-y rounded-lg border" data-testid="pending-list">
              {confirmed.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0"><span className="font-medium">{p.lead_name}</span> <span className="block truncate text-xs text-muted-foreground sm:inline"><MapPin className="mr-0.5 inline size-3" />{p.address ?? "Adresse manquante"}</span></span>
                  <span className="shrink-0 text-xs text-muted-foreground">{wishLabel(p.wishFrom, p.wishTo)} · {p.durationMin} min</span>
                </li>
              ))}
            </ul>
          )}
          {toConfirm.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">À confirmer avant répartition ({toConfirm.length})</h3>
              <ul className="divide-y rounded-lg border">
                {toConfirm.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <span className="min-w-0 truncate">{p.lead_name} <span className="text-xs text-muted-foreground">· {wishLabel(p.wishFrom, p.wishTo)}</span></span>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => { const r = await confirmPendingAction({ id: p.id }); if (r.ok) { toast.success("RDV confirmé."); router.refresh(); } else toast.error(r.error); })}>Confirmer</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {hasSimulation && <SimulationSteps hasPreview={!!preview} toCheck={toCheck.length} fixed={fixedCount} done={!!done} />}
      {fixedCount > 0 && (
        <p className="flex flex-col gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="rebalance-banner">
          <span className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0 text-link" />Position corrigée sur {fixedCount} RDV : relancer la répartition. Les RDV que vous avez verrouillés ne bougent pas.</span>
          <Button size="sm" onClick={() => run(true)} loading={busy} data-testid="rebalance-run"><Sparkles className="size-3.5" /> Rééquilibrer</Button>
        </p>
      )}
      {toCheck.length > 0 && (
        <Card data-testid="to-check">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning-text" />À vérifier avant répartition ({toCheck.length})</CardTitle>
            <p className="text-sm text-muted-foreground">Ces RDV ne sont pas ignorés : leur position GPS est absente, approximative ou hors route. Corrigez-les en un clic.</p></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {toCheck.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="to-check-row">
                  <span className="min-w-0"><span className="font-medium">{c.lead_name}</span>
                    {c.precision === "municipality" && <Badge tone="warning" className="ml-2">Position approximative</Badge>}
                    <span className="block truncate text-xs text-muted-foreground">{c.address ?? "Adresse manquante"}</span>
                    <span className="block text-xs text-warning-text">{c.reason}</span></span>
                  <LocationFixDialog target={{ id: c.id, lead_name: c.lead_name, address: c.address, reason: c.reason, precision: c.precision, lat: c.lat, lng: c.lng }} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {error && <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive-text" data-testid="dispatch-error"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</p>}
      {done && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-success/15 px-3 py-2 text-sm text-success-text" data-testid="dispatch-done">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />{done.applied} RDV attribué(s){simulationView ? " (simulation : aucun commercial notifié)" : " et notifiés aux commerciaux"}.{done.unassigned > 0 ? ` ${done.unassigned} restent à attribuer.` : ""} Retrouvez-les dans l&apos;Agenda.
        </p>
      )}
      {preview && <Proposal data={preview} busy={busy} onApply={apply} onCancel={() => { setPreview(null); setFifth([]); }} fifth={fifth} setFifth={setFifth} />}
    </div>
  );
}

function Proposal({ data, busy, onApply, onCancel, fifth, setFifth }: { data: PreviewData; busy: boolean; onApply: () => void; onCancel: () => void; fifth: string[]; setFifth: (ids: string[]) => void }) {
  const { plan, reps } = data;
  const byRep = reps.map((r) => ({ rep: r, routes: plan.stats.filter((s) => s.repId === r.id) })).filter((x) => x.routes.length > 0);
  const total = plan.assignments.length;
  return (
    <section aria-label="Proposition de répartition" className="space-y-4" data-testid="proposal">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{data.mode === "rebalance" ? "Proposition de rééquilibrage" : "Proposition de répartition"}</h2>
          <p className="text-sm text-muted-foreground" data-testid="proposal-summary">{total} RDV proposés sur {plan.stats.length} journée(s){plan.unassigned.length > 0 ? ` · ${plan.unassigned.length} non attribué(s)` : ""}. Rien n&apos;est enregistré tant que vous n&apos;avez pas validé.</p>
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
      {byRep.map(({ rep, routes }) => (
        <Card key={rep.id} data-testid={`rep-${rep.name}`}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">{rep.name}
              <Badge tone="neutral">{routes.reduce((n, r) => n + r.newCount, 0)} nouveau(x) RDV</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">Base : {rep.baseAddress} · rayon {rep.radiusKm} km · {fmtMin(rep.workStartMin)}–{fmtMin(rep.workEndMin)} · norme {rep.targetPerDay}/jour · confort {rep.comfortMax} · maximum {rep.absoluteMax}</p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-2">
              <DispatchMap rep={rep} routes={routes} />
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {routes.map((r, i) => <li key={r.day} className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full" style={{ background: DAY_COLORS[i % DAY_COLORS.length] }} />{dayShort(r.day)}</li>)}
              </ul>
            </div>
            <div className="min-w-0 space-y-3">
              {routes.map((r, i) => (
                <div key={r.day} className="rounded-lg border p-3" data-testid={`route-${rep.name}-${r.day}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold capitalize"><span className="inline-block size-2.5 rounded-full" style={{ background: DAY_COLORS[i % DAY_COLORS.length] }} />{dayLabel(r.day)}</h3>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span data-testid="gauge" aria-label={`${r.count} RDV, norme ${r.target}`} className={`font-medium ${r.count > r.comfort ? "text-warning-text" : r.count > r.target ? "text-link" : "text-foreground"}`}>{r.count}/{r.target}</span>
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden><span className={`block h-full rounded-full ${r.count > r.comfort ? "bg-warning" : r.count > r.target ? "bg-accent" : "bg-muted-foreground"}`} style={{ width: `${Math.min(100, (r.count / r.target) * 100)}%` }} /></span>
                      · {r.totalKm} km · conduite ≈ {r.totalDriveMin} min · fin {fmtMin(r.endMin)}
                    </span>
                  </div>
                  <RouteLinks base={rep.base} stops={r.stops} />
                  <ol className="mt-2 space-y-1.5">
                    {r.stops.map((s, k) => (
                      <li key={s.id} className="flex items-start gap-2 text-sm" data-testid="stop">
                        <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${s.kind === "new" ? "" : "bg-muted-foreground"}`} style={s.kind === "new" ? { background: DAY_COLORS[i % DAY_COLORS.length] } : undefined}>{k + 1}</span>
                        <span className="min-w-0 flex-1"><span className="tabular-nums font-medium">{fmtMin(s.startMin)}–{fmtMin(s.endMin)}</span> <span className="break-words">{s.label}</span>
                          {s.kind === "existing" && <span className="ml-1 text-xs text-muted-foreground">(déjà planifié)</span>}
                          <span className="block text-xs text-muted-foreground" data-testid="leg">{k === 0 ? "depuis la base" : "depuis le RDV précédent"} : {s.legBaseMin} min · {s.legKm} km
                            {s.legMin > s.legBaseMin && <span> (≈ {s.legMin} min avec circulation, {trafficNote(s.trafficSource, data)})</span>}</span>
                          {s.note && <span className="block text-xs text-link" data-testid="load-note">{s.note}</span>}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {plan.warnings.length > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-warning/15 px-3 py-2 text-xs text-warning-text" data-testid="overload-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Journée déjà au-delà du confort à cause de RDV posés ou verrouillés (non modifiée) : {plan.warnings.map((w) => `${reps.find((r) => r.id === w.repId)?.name ?? "—"} le ${dayShort(w.day)} (${w.count} RDV)`).join(", ")}.</p>
      )}
      {plan.proposed.length > 0 && (
        <Card data-testid="fifth">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning-text" />Au-delà du confort : journée chargée ({plan.proposed.length})</CardTitle>
            <p className="text-sm text-muted-foreground">Jamais attribués automatiquement. Cochez ceux que vous acceptez : votre décision sera verrouillée.</p></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {plan.proposed.map((a) => (
                <li key={a.requestId} className="p-3 text-sm">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={fifth.includes(a.requestId)} data-testid="fifth-check"
                      onChange={(e) => setFifth(e.target.checked ? [...fifth, a.requestId] : fifth.filter((x) => x !== a.requestId))} />
                    <span className="min-w-0"><span className="font-medium">{data.requests[a.requestId]?.label ?? "RDV"}</span> <Badge tone="warning" className="ml-1">{a.dayCount ? `${a.dayCount}e RDV` : "Au-delà du confort"} : journée chargée</Badge>
                      <span className="block text-xs text-muted-foreground">{reps.find((r) => r.id === a.repId)?.name} · {dayShort(a.day)} {fmtMin(a.startMin)}–{fmtMin(a.endMin)} · {a.legBaseMin} min · {a.legKm} km depuis le RDV précédent</span>
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
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning-text" />Non attribués ({plan.unassigned.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {plan.unassigned.map((u) => (
                <li key={u.requestId} className="p-3 text-sm"><span className="font-medium">{u.label}</span><span className="block text-muted-foreground">{u.reason}</span></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
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
          {r.fellBack ? "Service de routage indisponible" : "Aucun service de routage configuré"} : durées et distances ci-dessous = estimation (vol d&apos;oiseau × 1,4), pas des itinéraires réels. Aperçu seulement : la validation automatique est désactivée.
        </p>
      )}
      <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span><strong className="text-foreground">{r.label}</strong>. Circulation : {r.trafficLabel ? `trafic ${r.trafficLabel} à l'heure de départ` : `estimation selon l'heure (pointes ×${data.traffic.morningCoef} le matin, ×${data.traffic.eveningCoef} le soir, trajets > 15 min)`}, marge de sécurité +{data.traffic.safetyPct} %. Trajet max {data.maxLegMin} min entre RDV, {data.maxBaseMin} min depuis la base.</span>
      </p>
      <p className="flex items-start gap-2 text-xs font-medium text-warning-text" data-testid="traffic-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{TRAFFIC_WARNING}</p>
    </div>
  );
}

function RouteLinks({ base, stops }: { base: { lat: number; lng: number }; stops: { lat: number | null; lng: number | null }[] }) {
  const pts = stops.filter((s): s is { lat: number; lng: number } => s.lat !== null && s.lng !== null);
  const g = googleMapsRoute(base, pts);
  if (!g) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-3 text-xs">
      <a href={g} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-link underline-offset-2 hover:underline" data-testid="open-route"><ExternalLink className="size-3" />Ouvrir l&apos;itinéraire (Google Maps)</a>
      <a href={wazeTo(pts[0]!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-link underline-offset-2 hover:underline"><Navigation className="size-3" />Waze : 1er RDV</a>
    </p>
  );
}

function RebalanceDiff({ data }: { data: PreviewData }) {
  const rows = data.diff;
  const changed = rows.filter((r) => r.changed).length;
  return (
    <Card data-testid="rebalance-diff">
      <CardHeader><CardTitle>Avant / après ({changed} changement{changed > 1 ? "s" : ""})</CardTitle>
        <p className="text-sm text-muted-foreground">Seuls les RDV à attribuer ou à rééquilibrer sont recalculés ; les RDV verrouillés et les autres RDV ne bougent pas.</p></CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="space-y-0.5 p-3 text-sm" data-testid="diff-row">
              <span className="font-medium">{r.label}</span>
              <span className="block text-xs text-muted-foreground">Avant : {r.from ? `${r.from.rep} · ${dayShort(r.from.day)} ${fmtMin(r.from.start)}` : "non attribué"}</span>
              <span className={`block text-xs ${r.to ? (r.changed ? "text-link" : "text-muted-foreground") : "text-warning-text"}`}>Après : {r.to ? `${r.to.rep} · ${dayShort(r.to.day)} ${fmtMin(r.to.start)}${r.changed ? "" : " (inchangé)"}` : "reste tel quel (aucun créneau)"}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Scénario guidé de la simulation : étapes affichées avec l'état courant. */
function SimulationSteps({ hasPreview, toCheck, fixed, done }: { hasPreview: boolean; toCheck: number; fixed: number; done: boolean }) {
  const steps = [
    { label: "Répartir automatiquement", ok: hasPreview || done },
    { label: toCheck > 0 ? `${toCheck} RDV à vérifier (sans point, approximatif, hors route)` : "Aucun RDV à vérifier", ok: toCheck === 0 },
    { label: "Corriger avec les coordonnées Google Maps", ok: toCheck === 0 && (fixed > 0 || done) },
    { label: "Rééquilibrer", ok: done && fixed === 0 },
    { label: "Valider", ok: done },
  ];
  return (
    <Card data-testid="sim-steps">
      <CardHeader><CardTitle className="flex items-center gap-2"><FlaskConical className="size-4" />Scénario de simulation</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-1.5 text-sm">
          {steps.map((st, i) => (
            <li key={st.label} className="flex items-start gap-2" data-testid="sim-step">
              <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${st.ok ? "bg-success text-white" : "bg-muted text-muted-foreground"}`}>{st.ok ? "✓" : i + 1}</span>
              <span className={st.ok ? "text-muted-foreground" : "font-medium"}>{st.label}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
