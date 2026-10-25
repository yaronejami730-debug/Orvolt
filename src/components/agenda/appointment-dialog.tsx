"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, HelpCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { createAppointmentAction, createPendingAppointmentAction, previewAppointmentAction, updateAppointmentAction, type ApptRow } from "@/app/(app)/agenda/actions";
import { listLeadsAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { addDays } from "@/lib/dispatch/time";
import { fmtFull, toLocalInputs } from "./status";

export interface DialogLead {
  id: string;
  label: string;
  address: string;
  assignedTo: string | null;
}
const DURATIONS = [30, 60, 90, 120];

function useDebounced<T>(value: T, ms = 500): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AppointmentDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: { id: string; name: string }[];
  userId: string;
  canAssignOthers: boolean;
  lead?: DialogLead; // fiche lead : lead fixé
  editing?: ApptRow | null;
  defaultStart?: Date;
  defaultAssignee?: string;
  onSaved?: () => void;
}) {
  const { open, onOpenChange, members, userId, canAssignOthers, editing } = props;
  const qc = useQueryClient();
  const init = editing ? new Date(editing.starts_at) : (props.defaultStart ?? new Date(Date.now() + 86_400_000));
  const inputs = toLocalInputs(init);
  const [leadId, setLeadId] = useState(props.lead?.id ?? editing?.lead_id ?? "");
  const [date, setDate] = useState(inputs.date);
  const [time, setTime] = useState(inputs.time);
  const initMin = editing ? Math.round((new Date(editing.ends_at).getTime() - new Date(editing.starts_at).getTime()) / 60000) : 60;
  const [duration, setDuration] = useState(initMin);
  const [custom, setCustom] = useState(!DURATIONS.includes(initMin));
  const [assignee, setAssignee] = useState(editing?.assigned_to ?? props.defaultAssignee ?? props.lead?.assignedTo ?? userId);
  const [location, setLocation] = useState(editing?.location_address ?? props.lead?.address ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [forcing, setForcing] = useState(!!editing?.distance_override);
  const [reason, setReason] = useState(editing?.override_reason ?? "");
  const [pastOk, setPastOk] = useState(false);
  // Télépro : « RDV à attribuer » (fenêtre de jours souhaitée, le confirmateur choisit commercial et heure).
  const canPend = !canAssignOthers && !editing;
  const [toAssign, setToAssign] = useState(false);
  const [wishTo, setWishTo] = useState(addDays(inputs.date, 4));
  const pendMode = canPend && toAssign;
  const [fe, setFe] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const leadsQ = useQuery({
    enabled: open && !props.lead && !editing,
    queryKey: ["leads", "picker"],
    queryFn: async () => (await listLeadsAction({ pageSize: 100, sort: "updated_at", dir: "desc" })).data?.rows ?? [],
  });
  const lead = props.lead ?? (leadsQ.data?.find((l) => l.id === leadId) ? (() => {
    const l = leadsQ.data!.find((x) => x.id === leadId)!;
    return { id: l.id, label: `${l.first_name} ${l.last_name}`.trim() || l.company || "Lead", address: [l.address, l.postal_code, l.city].filter(Boolean).join(", "), assignedTo: l.assigned_to } as DialogLead;
  })() : undefined);

  // Pré-remplit le lieu / le commercial quand le lead est choisi dans l'agenda.
  useEffect(() => {
    if (!props.lead && !editing && lead) {
      setLocation(lead.address);
      if (lead.assignedTo && canAssignOthers) setAssignee(lead.assignedTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, leadsQ.data]);

  const startsAt = useMemo(() => {
    const d = new Date(`${date}T${time}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }, [date, time]);
  const q = useDebounced({ leadId, assignedTo: assignee, address: location, startsAt, duration });
  const preview = useQuery({
    enabled: open && !!q.leadId && !!q.startsAt && !pendMode,
    queryKey: ["appt-preview", q, editing?.id],
    queryFn: async () => {
      const r = await previewAppointmentAction({ leadId: q.leadId, assignedTo: q.assignedTo, address: q.address || undefined, startsAt: q.startsAt!, durationMin: q.duration, excludeId: editing?.id });
      if (!r.ok || !r.data) throw new Error(r.error ?? "Calcul impossible.");
      return r.data;
    },
    staleTime: 10_000,
  });
  const d = preview.data?.distance;
  const conflicts = preview.data?.conflicts ?? [];
  const settled = q.leadId === leadId && q.assignedTo === assignee && q.address === location && q.startsAt === startsAt && q.duration === duration;
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "—";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pendMode) {
      start(async () => {
        const res = await createPendingAppointmentAction({ leadId, wishFrom: date, wishTo, durationMin: duration, location: location.trim(), notes: notes.trim() || null });
        if (res.ok) {
          toast.success("Demande enregistrée : le confirmateur choisira le commercial et l'heure.");
          qc.invalidateQueries({ queryKey: ["appts"] });
          props.onSaved?.();
          onOpenChange(false);
        } else {
          setFe(res.fieldErrors ?? {});
          setError(res.fieldErrors ? undefined : res.error);
        }
      });
      return;
    }
    if (!startsAt) return setFe({ date: "Date ou heure invalide." });
    const payload = { assignedTo: assignee, startsAt, durationMin: duration, location: location.trim() || null, notes: notes.trim() || null, overrideReason: forcing && reason.trim() ? reason.trim() : undefined };
    start(async () => {
      const res = editing ? await updateAppointmentAction({ id: editing.id, ...payload }) : await createAppointmentAction({ leadId, ...payload });
      if (res.ok) {
        toast.success(editing ? "Rendez-vous modifié." : "Rendez-vous planifié.");
        qc.invalidateQueries({ queryKey: ["appts"] });
        qc.invalidateQueries({ queryKey: ["leads"] });
        props.onSaved?.();
        onOpenChange(false);
      } else {
        setFe(res.fieldErrors ?? {});
        if (res.code === "over_radius") setForcing(true);
        setError(res.fieldErrors ? undefined : res.error);
        qc.invalidateQueries({ queryKey: ["appt-preview"] });
      }
    });
  }

  const isPast = !!startsAt && new Date(startsAt).getTime() < Date.now() && !editing;
  const blocked = pendMode ? !leadId || location.trim().length < 3 || !date || !wishTo || wishTo < date
    : (isPast && !pastOk) || !leadId || !startsAt || conflicts.length > 0 || (d?.status === "over_radius" && (!forcing || reason.trim().length < 3));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier le rendez-vous" : "Prendre RDV"}</DialogTitle>
          <DialogDescription>{props.lead ? props.lead.label : "Choisissez le lead, le créneau et le commercial."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {!props.lead && !editing && (
            <div className="space-y-2">
              <Label htmlFor="ap-lead">Lead</Label>
              <Select id="ap-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)} aria-invalid={fe.leadId ? true : undefined}>
                <option value="">Choisir un lead…</option>
                {(leadsQ.data ?? []).map((l) => <option key={l.id} value={l.id}>{`${l.first_name} ${l.last_name}`.trim() || l.company}</option>)}
              </Select>
              <FieldError id="ap-lead-error" message={fe.leadId} />
            </div>
          )}
          {canPend && (
            <label className="flex items-start gap-2 rounded-lg border p-3 text-sm" data-testid="to-assign-toggle">
              <input type="checkbox" checked={toAssign} onChange={(e) => {
                setToAssign(e.target.checked);
                // Un RDV à attribuer vise au plus tôt demain : on avance la fenêtre au lieu de laisser « Du » invalide.
                if (e.target.checked) { const t = toLocalInputs(new Date(Date.now() + 86_400_000)).date; if (date < t) { setDate(t); setWishTo(addDays(t, 4)); } }
              }} className="mt-0.5 accent-[var(--accent)]" />
              <span><strong>RDV à attribuer</strong> : je ne choisis ni le commercial ni l&apos;heure, le confirmateur et la répartition automatique s&apos;en chargent (jours souhaités + durée).</span>
            </label>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="ap-date">{pendMode ? "Du" : "Date"}</Label><Input id="ap-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={fe.date || fe.startsAt || fe.wishFrom ? true : undefined} /><FieldError id="ap-date-error" message={fe.date ?? fe.startsAt ?? fe.wishFrom} /></div>
            {pendMode
              ? <div className="space-y-2"><Label htmlFor="ap-wish-to">Au</Label><Input id="ap-wish-to" type="date" value={wishTo} onChange={(e) => setWishTo(e.target.value)} /></div>
              : <div className="space-y-2"><Label htmlFor="ap-time">Heure</Label><Input id="ap-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></div>}
            <div className="space-y-2">
              <Label htmlFor="ap-duration">Durée</Label>
              <Select id="ap-duration" value={custom ? "custom" : String(duration)} onChange={(e) => { if (e.target.value === "custom") setCustom(true); else { setCustom(false); setDuration(Number(e.target.value)); } }}>
                <option value="30">30 min</option><option value="60">1 h</option><option value="90">1 h 30</option><option value="120">2 h</option><option value="custom">Personnalisée</option>
              </Select>
            </div>
          </div>
          {custom && (
            <div className="space-y-2"><Label htmlFor="ap-custom">Durée (minutes)</Label><Input id="ap-custom" type="number" min={15} max={480} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-invalid={fe.durationMin ? true : undefined} /><FieldError id="ap-custom-error" message={fe.durationMin} /></div>
          )}
          {!pendMode && (
            <div className="space-y-2">
              <Label htmlFor="ap-assignee">Commercial</Label>
              <Select id="ap-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!canAssignOthers}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="ap-location">Lieu</Label>
            <Input id="ap-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Adresse du rendez-vous" aria-invalid={fe.location ? true : undefined} />
            <FieldError id="ap-location-error" message={fe.location} />
          </div>

          <div aria-live="polite" data-testid="distance-banner">
            {!leadId || pendMode ? null : preview.isLoading || preview.isFetching || !settled ? (
              <div className="space-y-2"><Skeleton className="h-12 w-full" /><p className="text-xs text-muted-foreground">Calcul…</p></div>
            ) : preview.isError ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span>Calcul impossible.</span><Button size="sm" variant="outline" type="button" onClick={() => preview.refetch()}>Réessayer</Button></div>
            ) : d?.status === "ok" ? (
              <div className="flex gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm" data-status="ok"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />À {d.distance_km} km de la zone de {d.zoneOwner ?? memberName(assignee)} (rayon {d.radius_km} km)</div>
            ) : d?.status === "over_radius" ? (
              <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-status="over_radius">
                <p className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />{d.distance_km} km, au-delà du rayon de {d.radius_km} km</p>
                {!forcing ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setForcing(true)}>Forcer quand même</Button>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="ap-reason">Motif de la dérogation (obligatoire)</Label>
                    <Input id="ap-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={fe.overrideReason ? true : undefined} />
                    <FieldError id="ap-reason-error" message={fe.overrideReason} />
                  </div>
                )}
              </div>
            ) : d?.status === "no_geocode" ? (
              <div className="space-y-2 rounded-lg border bg-muted/50 p-3 text-sm" data-status="no_geocode">
                <p className="flex gap-2"><HelpCircle className="mt-0.5 size-4 shrink-0" aria-hidden />Adresse introuvable : distance non vérifiée. Corrigez le lieu (rue, ville) ou planifiez sans contrôle.</p>
                <Button type="button" size="sm" variant="outline" onClick={() => preview.refetch()}>Relancer le calcul</Button>
              </div>
            ) : d ? (
              <div className="flex gap-2 rounded-lg border bg-muted/50 p-3 text-sm" data-status="no_zone"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{memberName(assignee)} n&apos;a pas de zone d&apos;intervention : distance non vérifiée. <Link href="/settings/members" className="text-link hover:underline">Définir une zone</Link></span></div>
            ) : null}
          </div>

          {isPast && !pendMode && (
            <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="past-warning">
              <input type="checkbox" checked={pastOk} onChange={(e) => setPastOk(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span><AlertTriangle className="mr-1 inline size-4 text-warning-text" aria-hidden />Ce créneau est dans le passé. Je confirme vouloir enregistrer ce rendez-vous à cette date.</span>
            </label>
          )}
          {conflicts.length > 0 && settled && !pendMode && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert" data-testid="conflict-banner">
              <p className="font-medium">Conflit d&apos;agenda : {memberName(assignee)} a déjà un rendez-vous sur ce créneau.</p>
              <ul className="mt-1 list-disc pl-5">{conflicts.map((c) => <li key={c.id}>{fmtFull(c.starts_at)} · {c.lead_name}</li>)}</ul>
              <p className="mt-1 text-xs text-muted-foreground">Choisissez un autre créneau ou un autre commercial.</p>
            </div>
          )}

          <div className="space-y-2"><Label htmlFor="ap-notes">Notes</Label><Textarea id="ap-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></div>
          {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
          <Button type="submit" className="w-full" loading={pending} disabled={blocked}>{editing ? "Enregistrer" : pendMode ? "Demander l'attribution" : "Planifier"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const distanceBadgeTone = (s: string) => (s === "ok" ? "success" : s === "over_radius" ? "warning" : "neutral") as "success" | "warning" | "neutral";
