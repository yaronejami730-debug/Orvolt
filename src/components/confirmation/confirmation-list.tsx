"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, CheckCircle2, MapPin, Phone, UserRound } from "lucide-react";
import { toast } from "sonner";
import { confirmAppointmentAction, setConfirmerAction } from "@/app/(app)/confirmation/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export interface ConfirmationRow {
  id: string;
  leadId: string | null;
  leadName: string;
  company: string | null;
  phone: string | null;
  address: string | null;
  startsAt: string | null;
  endsAt: string | null;
  wishFrom: string | null;
  wishTo: string | null;
  durationMin: number | null;
  commercial: string | null;
  confirmerId: string | null;
  confirmerName: string | null;
  distanceStatus: string | null;
  distanceKm: number | null;
  notes: string | null;
}
export interface ConfirmerOption { id: string; name: string }

const day = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const hour = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const wishDay = (iso: string) => day.format(new Date(`${iso}T12:00:00`));

/** Quand : heure fixée (RDV déjà placé) ou fenêtre de souhait (RDV à répartir). */
function when(r: ConfirmationRow): { key: string; label: string } {
  if (r.startsAt) { const d = new Date(r.startsAt); return { key: day.format(d), label: `${hour.format(d)}${r.endsAt ? ` – ${hour.format(new Date(r.endsAt))}` : ""}` }; }
  if (r.wishFrom) return { key: wishDay(r.wishFrom), label: r.wishTo && r.wishTo !== r.wishFrom ? `jusqu'au ${wishDay(r.wishTo)}` : "heure à définir" };
  return { key: "Sans date", label: "date à définir" };
}

export function ConfirmationList({ rows, confirmers, isAdmin, done, meId }: { rows: ConfirmationRow[]; confirmers: ConfirmerOption[]; isAdmin: boolean; done: boolean; meId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setBusy(id);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (r.ok) { toast.success(okMsg); router.refresh(); } else toast.error(r.error);
    });
  };

  const groups = new Map<string, ConfirmationRow[]>();
  for (const r of rows) { const k = when(r).key; groups.set(k, [...(groups.get(k) ?? []), r]); }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Vue">
        <Button asChild size="sm" variant={done ? "outline" : "primary"}><Link href="/confirmation">À confirmer{!done ? ` (${rows.length})` : ""}</Link></Button>
        <Button asChild size="sm" variant={done ? "primary" : "outline"}><Link href="/confirmation?vue=confirmes">Confirmés (7 jours){done ? ` (${rows.length})` : ""}</Link></Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={done ? "Aucun rendez-vous confirmé récemment" : "Rien à confirmer"} description={done ? "Les rendez-vous confirmés ces 7 derniers jours apparaissent ici." : "Dès qu'un rendez-vous est pris, il arrive ici automatiquement."} />
      ) : (
        [...groups.entries()].map(([k, list]) => (
          <section key={k} aria-label={k} className="space-y-2" data-testid="confirmation-day">
            <h2 className="text-sm font-semibold capitalize text-muted-foreground">{k}</h2>
            <ul className="divide-y rounded-xl border bg-card">
              {list.map((r) => (
                <li key={r.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center" data-testid="confirmation-row">
                  <div className="min-w-0 space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.leadName}</span>
                      {r.company && <span className="text-sm text-muted-foreground">{r.company}</span>}
                      {r.distanceStatus === "over_radius" && <Badge tone="warning">Hors zone{r.distanceKm ? ` · ${r.distanceKm} km` : ""}</Badge>}
                      {!r.confirmerId && !done && <Badge tone="warning">Sans confirmateur</Badge>}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4" aria-hidden />{when(r).label}{r.durationMin ? ` · ${r.durationMin} min` : ""}</span>
                      {r.address && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden />{r.address}</span>}
                      {r.phone && <a href={`tel:${r.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 text-link hover:underline"><Phone className="size-4" aria-hidden />{r.phone}</a>}
                      <span className="inline-flex items-center gap-1.5"><UserRound className="size-4" aria-hidden />{r.commercial ? `Commercial : ${r.commercial}` : "Commercial à attribuer"}</span>
                    </p>
                    {r.notes && <p className="text-sm text-muted-foreground">{r.notes}</p>}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    {isAdmin && !done && (
                      <label className="flex items-center gap-2 text-sm">
                        <span className="sr-only md:not-sr-only md:text-muted-foreground">Confirmateur</span>
                        <select
                          aria-label={`Confirmateur de ${r.leadName}`}
                          className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                          value={r.confirmerId ?? ""}
                          disabled={pending && busy === r.id}
                          onChange={(e) => run(r.id, () => setConfirmerAction({ id: r.id, userId: e.target.value || null }), "Confirmateur mis à jour.")}
                        >
                          <option value="">Automatique</option>
                          {confirmers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </label>
                    )}
                    {done ? (
                      <Badge tone="success"><CheckCircle2 className="mr-1 size-3.5" aria-hidden />Confirmé</Badge>
                    ) : (
                      <>
                        {r.leadId && <Button asChild size="sm" variant="ghost"><Link href={`/leads/${r.leadId}`}>Ouvrir la fiche</Link></Button>}
                        <Button size="sm" loading={pending && busy === r.id} disabled={pending} onClick={() => run(r.id, () => confirmAppointmentAction({ id: r.id }), "Rendez-vous confirmé.")}>
                          <CheckCircle2 className="size-4" aria-hidden />Confirmer
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {!isAdmin && !done && <p className="text-xs text-muted-foreground" data-me={meId}>Seuls vos rendez-vous et ceux sans confirmateur s&apos;affichent.</p>}
    </div>
  );
}
