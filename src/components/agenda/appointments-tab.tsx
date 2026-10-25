"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, MapPin, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { setAppointmentStatusAction, type ApptRow } from "@/app/(app)/agenda/actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { APPT_STATUSES, type ApptStatus } from "@/lib/validation/appointments";
import { AppointmentDialog, distanceBadgeTone, type DialogLead } from "./appointment-dialog";
import { DIST_LABEL, fmtFull, STATUS_COLOR, STATUS_LABEL } from "./status";

export function AppointmentsTab({ appts, lead, members, userId, canAssignOthers, canManage }: {
  appts: ApptRow[]; lead: DialogLead; members: { id: string; name: string }[]; userId: string; canAssignOthers: boolean; canManage: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ editing: ApptRow | null } | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const now = Date.now();
  const upcoming = appts.filter((a) => new Date(a.ends_at).getTime() >= now && a.status !== "cancelled" && a.status !== "done").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = appts.filter((a) => !upcoming.includes(a)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "—";
  const setStatus = (id: string, status: ApptStatus) =>
    start(async () => {
      const r = await setAppointmentStatusAction({ id, status });
      if (r.ok) { toast.success("Statut mis à jour."); router.refresh(); } else toast.error(r.error);
    });

  const row = (a: ApptRow) => (
    <li key={a.id} data-testid="appt-row" className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{fmtFull(a.starts_at)}</span>
        <span className="text-muted-foreground">{Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)} min</span>
        <Badge color={STATUS_COLOR[a.status]} dot className={a.status === "cancelled" ? "line-through" : ""}>{STATUS_LABEL[a.status]}</Badge>
        <Badge tone={distanceBadgeTone(a.distance_status)} data-testid="distance-badge">{DIST_LABEL[a.distance_status]}{a.distance_km !== null && a.distance_status !== "no_zone" ? ` · ${a.distance_km} km` : ""}</Badge>
        {a.distance_override && <Badge tone="warning" title={a.override_reason ?? undefined}>Dérogation</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
        <span className="flex items-center gap-1.5"><Avatar name={name(a.assigned_to)} size="sm" />{name(a.assigned_to)}</span>
        {a.location_address && <span className="flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{a.location_address}</span>}
      </div>
      {a.override_reason && <p className="text-xs">Motif de dérogation : {a.override_reason}</p>}
      {a.notes && <p className="whitespace-pre-wrap">{a.notes}</p>}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setDialog({ editing: a })}><Pencil className="size-3.5" /> Modifier</Button>
          <Select aria-label="Changer le statut du rendez-vous" value={a.status} disabled={pending} className="h-8 w-36 text-xs" onChange={(e) => setStatus(a.id, e.target.value as ApptStatus)}>
            {APPT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          {a.status !== "cancelled" && <Button size="sm" variant="ghost" onClick={() => setCancelId(a.id)}><X className="size-3.5" /> Annuler</Button>}
        </div>
      )}
    </li>
  );

  return (
    <div className="mt-4 space-y-5">
      {canManage && <Button size="sm" onClick={() => setDialog({ editing: null })}><CalendarPlus className="size-4" /> Prendre RDV</Button>}
      {appts.length === 0 ? (
        <EmptyState title="Aucun rendez-vous" description="Planifiez un rendez-vous pour ce lead." />
      ) : (
        <>
          <section><h3 className="mb-2 text-sm font-semibold">À venir</h3>{upcoming.length ? <ul className="space-y-3" data-testid="appts-upcoming">{upcoming.map(row)}</ul> : <p className="text-sm text-muted-foreground">Aucun rendez-vous à venir.</p>}</section>
          {past.length > 0 && <section><h3 className="mb-2 text-sm font-semibold">Passés</h3><ul className="space-y-3">{past.map(row)}</ul></section>}
        </>
      )}
      {dialog && (
        <AppointmentDialog key={dialog.editing?.id ?? "new"} open onOpenChange={(o) => !o && setDialog(null)} members={members} userId={userId} canAssignOthers={canAssignOthers}
          lead={lead} editing={dialog.editing} onSaved={() => router.refresh()} />
      )}
      <Dialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Annuler ce rendez-vous ?</DialogTitle><DialogDescription>Le créneau sera libéré pour le commercial.</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelId(null)}>Retour</Button>
            <Button variant="destructive" loading={pending} onClick={() => { setStatus(cancelId!, "cancelled"); setCancelId(null); }}>Annuler le rendez-vous</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
