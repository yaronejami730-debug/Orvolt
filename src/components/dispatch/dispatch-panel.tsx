"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarCheck, CheckCircle2, FlaskConical, Info, MapPin, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  applyDispatchAction, clearSimulationAction, confirmPendingAction, launchSimulationAction, previewDispatchAction, type PreviewData,
} from "@/app/(app)/agenda/repartition/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ToCheck } from "@/lib/dispatch/server";
import { LocationFixDialog } from "./location-fix-dialog";
import { rebalanceMessage } from "@/lib/dispatch/rebalance-message";
import { usePollRefresh } from "@/components/use-poll-refresh";
import { Proposal } from "./proposal";

export interface PendingView {
  id: string;
  lead_name: string;
  address: string | null;
  status: string;
  wishFrom: string;
  wishTo: string;
  durationMin: number;
}

const dayShort = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const wishLabel = (a: string, b: string) => (a === b ? dayShort(a) : `${dayShort(a)} → ${dayShort(b)}`);

const SIM_URL = "/agenda/repartition?vue=simulation";

export function DispatchPanel({ pending, repCount, canSimulate, hasSimulation, simulationView, truncations, toCheck, fixedCount, unavailCount = 0 }: { pending: PendingView[]; repCount: number; canSimulate: boolean; hasSimulation: boolean; simulationView: boolean; truncations: string[]; toCheck: ToCheck[]; fixedCount: number; unavailCount?: number }) {
  const router = useRouter();
  // La liste « À confirmer » / « RDV confirmés à attribuer » vit côté serveur : on la rafraîchit toutes les 30 s (onglet visible, pas pendant un calcul).
  usePollRefresh({ everyMs: 30_000 });
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
          <span className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0 text-link" />{rebalanceMessage(fixedCount, unavailCount)} Les RDV que vous avez verrouillés ne bougent pas.</span>
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
