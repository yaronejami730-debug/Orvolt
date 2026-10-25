"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addUnavailabilityAction, deleteUnavailabilityAction } from "@/app/(app)/agenda/repartition/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface UnavailRow { id: string; rep_name: string; day: string; startMin: number | null; endMin: number | null; reason: string | null }
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dayShort = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

/** Congés / créneaux bloqués d'un commercial, saisis par le confirmateur ou l'admin : toujours respectés par le moteur. */
export function UnavailabilityCard({ rows, reps }: { rows: UnavailRow[]; reps: { id: string; name: string }[] }) {
  const router = useRouter();
  const [rep, setRep] = useState(reps[0]?.id ?? "");
  const [day, setDay] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [reason, setReason] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, startT] = useTransition();
  if (reps.length === 0) return null;
  return (
    <Card data-testid="unavailability">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarOff className="size-4" />Indisponibilités des commerciaux</CardTitle>
        <p className="text-sm text-muted-foreground">Congés ou créneaux bloqués : le moteur ne place jamais de RDV dessus.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_auto_auto_1fr_auto] lg:items-end" onSubmit={(e) => {
          e.preventDefault();
          startT(async () => {
            const r = await addUnavailabilityAction({ userId: rep, day, allDay, start: allDay ? undefined : start, end: allDay ? undefined : end, reason: reason || undefined });
            if (r.ok) { toast.success("Indisponibilité enregistrée."); setDay(""); setReason(""); setFe({}); router.refresh(); }
            else { setFe(r.fieldErrors ?? {}); toast.error(r.error); }
          });
        }}>
          <div className="space-y-1"><Label htmlFor="un-rep">Commercial</Label><Select id="un-rep" value={rep} onChange={(e) => setRep(e.target.value)}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></div>
          <div className="space-y-1"><Label htmlFor="un-day">Jour</Label><Input id="un-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required aria-invalid={fe.day ? true : undefined} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Journée entière</label>
          {!allDay ? (
            <div className="flex items-end gap-2">
              <div className="space-y-1"><Label htmlFor="un-s">De</Label><Input id="un-s" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="un-e">à</Label><Input id="un-e" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={fe.end ? true : undefined} /></div>
            </div>
          ) : <span className="hidden lg:block" />}
          <div className="space-y-1"><Label htmlFor="un-r">Motif (facultatif)</Label><Input id="un-r" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Congé, formation…" /></div>
          <Button type="submit" loading={pending} data-testid="unavail-add">Ajouter</Button>
          <FieldError id="un-err" message={fe.end ?? fe.day} />
        </form>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucune indisponibilité à venir.</p> : (
          <ul className="divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 p-3 text-sm" data-testid="unavail-row">
                <span><span className="font-medium">{r.rep_name}</span> · {dayShort(r.day)} · {r.startMin === null ? "journée entière" : `${hm(r.startMin)}–${hm(r.endMin!)}`}{r.reason ? ` · ${r.reason}` : ""}</span>
                <Button size="sm" variant="ghost" aria-label="Supprimer" disabled={pending} onClick={() => startT(async () => { const x = await deleteUnavailabilityAction({ id: r.id }); if (x.ok) router.refresh(); else toast.error(x.error); })}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
