"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, Lock, LockOpen, Pencil, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { editDispatchedAction, setLockAction, swapDispatchedAction, unassignDispatchedAction } from "@/app/(app)/agenda/repartition/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface DispatchedRow {
  id: string;
  lead_name: string;
  rep_id: string;
  rep_name: string;
  day: string;
  start: string; // HH:MM
  end: string;
  durationMin: number;
  locked: boolean;
  lockedByName: string | null;
  issue: string | null;
  response: "assigned";
}

const dayShort = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

/** Suivi des RDV répartis : le confirmateur a le dernier mot (changer commercial/heure, échanger, retirer, verrouiller). */
export function DispatchedPlanning({ rows, reps }: { rows: DispatchedRow[]; reps: { id: string; name: string }[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<DispatchedRow | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, close = false) => start(async () => {
    const r = await fn();
    if (r.ok) { toast.success(ok); if (close) setEdit(null); router.refresh(); } else toast.error(r.error);
  });
  if (rows.length === 0) return null;
  const days = [...new Set(rows.map((r) => r.day))].sort();
  return (
    <Card data-testid="dispatched">
      <CardHeader>
        <CardTitle>Planning réparti ({rows.length})</CardTitle>
        <p className="text-sm text-muted-foreground">Vous avez le dernier mot : toute modification manuelle est verrouillée et n&apos;est jamais défaite par un nouveau calcul du moteur.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {days.map((d) => (
          <div key={d} className="space-y-1.5">
            <h3 className="text-sm font-semibold capitalize">{dayShort(d)}</h3>
            <ul className="divide-y rounded-lg border">
              {rows.filter((r) => r.day === d).map((r) => (
                <li key={r.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="dispatched-row">
                  <span className="min-w-0">
                    <span className="tabular-nums font-medium">{r.start}–{r.end}</span> {r.lead_name} <span className="text-muted-foreground">· {r.rep_name}</span>
                    {r.locked && <Badge tone="accent" className="ml-2" data-testid="locked-badge"><Lock className="size-3" /> Verrouillé{r.lockedByName ? ` par ${r.lockedByName}` : ""}</Badge>}
                    {r.issue && <span className="mt-1 flex items-start gap-1 text-xs text-warning-text" data-testid="issue"><AlertTriangle className="mt-0.5 size-3 shrink-0" />Problème signalé : {r.issue}</span>}
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEdit(r)} data-testid="edit-open"><Pencil className="size-3.5" /> Modifier</Button>
                    <Button size="sm" variant="ghost" disabled={pending} aria-label={r.locked ? "Déverrouiller" : "Verrouiller"} onClick={() => run(() => setLockAction({ id: r.id, locked: !r.locked }), r.locked ? "Déverrouillé." : "Verrouillé.")}>
                      {r.locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
      {edit && <EditDialog row={edit} rows={rows} reps={reps} pending={pending} onClose={() => setEdit(null)} run={run} />}
    </Card>
  );
}

function EditDialog({ row, rows, reps, pending, onClose, run }: {
  row: DispatchedRow; rows: DispatchedRow[]; reps: { id: string; name: string }[]; pending: boolean; onClose: () => void;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, close?: boolean) => void;
}) {
  const [rep, setRep] = useState(row.rep_id);
  const [day, setDay] = useState(row.day);
  const [time, setTime] = useState(row.start);
  const [dur, setDur] = useState(row.durationMin);
  const [other, setOther] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier — {row.lead_name}</DialogTitle>
          <DialogDescription>Votre décision est verrouillée : le moteur ne la modifiera plus.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => editDispatchedAction({ id: row.id, userId: rep, day, start: time, durationMin: dur }), "RDV modifié et verrouillé.", true); }}>
          <div className="space-y-2"><Label htmlFor="ed-rep">Commercial</Label>
            <Select id="ed-rep" value={rep} onChange={(e) => setRep(e.target.value)}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="ed-day">Jour</Label><Input id="ed-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="ed-time">Heure</Label><Input id="ed-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="ed-dur">Durée (min)</Label><Input id="ed-dur" type="number" min={15} max={480} step={5} value={dur} onChange={(e) => setDur(Number(e.target.value))} /></div>
          <Button type="submit" className="w-full" loading={pending} data-testid="edit-save">Enregistrer et verrouiller</Button>
        </form>
        <div className="space-y-2 border-t pt-3">
          <Label htmlFor="ed-swap">Échanger avec un autre RDV</Label>
          <div className="flex gap-2">
            <Select id="ed-swap" value={other} onChange={(e) => setOther(e.target.value)} className="flex-1">
              <option value="">Choisir…</option>
              {rows.filter((r) => r.id !== row.id).map((r) => <option key={r.id} value={r.id}>{dayShort(r.day)} {r.start} · {r.lead_name} ({r.rep_name})</option>)}
            </Select>
            <Button variant="outline" disabled={!other || pending} onClick={() => run(() => swapDispatchedAction({ a: row.id, b: other }), "RDV échangés et verrouillés.", true)}><ArrowLeftRight className="size-4" /> Échanger</Button>
          </div>
          <Button variant="ghost" className="w-full text-destructive-text" disabled={pending} onClick={() => run(() => unassignDispatchedAction({ id: row.id }), "RDV retiré : il repasse à attribuer.", true)} data-testid="unassign"><Undo2 className="size-4" /> Retirer de la tournée (repasse à attribuer)</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
