"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { saveOrgSettingsAction, saveWorkSettingsAction } from "@/app/(app)/agenda/repartition/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WEEKDAY_LABELS } from "@/lib/dispatch/settings";

export interface WorkView {
  workStart: string;
  workEnd: string;
  /** Surcharges de la règle de charge (null = valeur de l'organisation). */
  targetPerDay: number | null;
  comfortMax: number | null;
  absoluteMax: number | null;
  workDays: number[];
  durationMin: number;
  travelMinPerKm: number;
  travelMarginMin: number;
}

/** Horaires et contraintes de répartition d'un commercial (à côté de la zone). */
export function WorkSettingsEditor({ userId, name, work, hasZone }: { userId: string; name: string; work: WorkView; hasZone: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<WorkView>(work);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof WorkView>(k: K, val: WorkView[K]) => { setV((p) => ({ ...p, [k]: val })); setFe({}); };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`Horaires de ${name}`} disabled={!hasZone} title={hasZone ? undefined : "Définissez d'abord la zone"}>
        <Clock className="size-3.5" /> {work.workStart}–{work.workEnd}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Horaires de répartition de {name}</DialogTitle>
            <DialogDescription>Le moteur n&apos;attribue que dans ces horaires, ces jours, avec ce nombre maximal de RDV par jour.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveWorkSettingsAction({ userId, ...v });
              if (r.ok) { toast.success("Horaires enregistrés."); setOpen(false); router.refresh(); }
              else { setFe(r.fieldErrors ?? {}); if (!r.fieldErrors) toast.error(r.error); }
            });
          }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`ws-start-${userId}`}>Début de journée</Label>
                <Input id={`ws-start-${userId}`} type="time" value={v.workStart} onChange={(e) => set("workStart", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`ws-end-${userId}`}>Fin de journée</Label>
                <Input id={`ws-end-${userId}`} type="time" value={v.workEnd} onChange={(e) => set("workEnd", e.target.value)} aria-invalid={fe.workEnd ? true : undefined} />
                <FieldError id={`ws-end-err-${userId}`} message={fe.workEnd} />
              </div>
              {(["targetPerDay", "comfortMax", "absoluteMax"] as const).map((k) => (
                <div key={k} className="space-y-2">
                  <Label htmlFor={`ws-${k}-${userId}`}>{k === "targetPerDay" ? "Norme (RDV/jour)" : k === "comfortMax" ? "Confort (+1 si détour faible)" : "Maximum (au-delà : manuel)"}</Label>
                  <Input id={`ws-${k}-${userId}`} type="number" min={1} max={10} placeholder="Organisation" value={v[k] ?? ""} onChange={(e) => set(k, e.target.value === "" ? null : Number(e.target.value))} aria-invalid={fe[k] ? true : undefined} />
                  <FieldError id={`ws-${k}-err-${userId}`} message={fe[k]} />
                </div>
              ))}
              <div className="space-y-2">
                <Label htmlFor={`ws-dur-${userId}`}>Durée d&apos;un RDV (min)</Label>
                <Input id={`ws-dur-${userId}`} type="number" min={15} max={480} step={5} value={v.durationMin} onChange={(e) => set("durationMin", Number(e.target.value))} aria-invalid={fe.durationMin ? true : undefined} />
                <FieldError id={`ws-dur-err-${userId}`} message={fe.durationMin} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`ws-rate-${userId}`}>Vitesse de repli (min/km)</Label>
                <Input id={`ws-rate-${userId}`} type="number" min={0.1} max={10} step={0.1} value={v.travelMinPerKm} onChange={(e) => set("travelMinPerKm", Number(e.target.value))} aria-invalid={fe.travelMinPerKm ? true : undefined} />
                <FieldError id={`ws-rate-err-${userId}`} message={fe.travelMinPerKm} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`ws-margin-${userId}`}>Marge par trajet (min)</Label>
                <Input id={`ws-margin-${userId}`} type="number" min={0} max={120} value={v.travelMarginMin} onChange={(e) => set("travelMarginMin", Number(e.target.value))} />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Jours travaillés</legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((lbl, i) => {
                  const d = i + 1;
                  const on = v.workDays.includes(d);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => set("workDays", on ? v.workDays.filter((x) => x !== d) : [...v.workDays, d].sort())}
                      className={`h-9 min-w-11 rounded-md border px-3 text-sm font-medium transition-colors ${on ? "border-transparent bg-accent text-accent-foreground" : "bg-transparent text-muted-foreground hover:bg-muted"}`}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
              <FieldError id={`ws-days-err-${userId}`} message={fe.workDays} />
            </fieldset>
            <Button type="submit" className="w-full" loading={pending}>Enregistrer les horaires</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface OrgView { targetPerDay: number; comfortMax: number; absoluteMax: number; maxExtraMin: number; maxLegKm: number; horizonDays: number; maxLegMin: number; maxBaseMin: number; morningCoef: number; eveningCoef: number; safetyPct: number }

/** Réglages d'organisation : trajets maximaux (km, minutes de route réelle), horizon, circulation et marge de sécurité. */
export function OrgSettingsEditor(init: OrgView) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<OrgView>({ targetPerDay: init.targetPerDay, comfortMax: init.comfortMax, absoluteMax: init.absoluteMax, maxExtraMin: init.maxExtraMin, maxLegKm: init.maxLegKm, horizonDays: init.horizonDays, maxLegMin: init.maxLegMin, maxBaseMin: init.maxBaseMin, morningCoef: init.morningCoef, eveningCoef: init.eveningCoef, safetyPct: init.safetyPct });
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof OrgView>(k: K, val: number) => { setV((p) => ({ ...p, [k]: val })); setFe({}); };
  const field = (k: keyof OrgView, label: string, props: { min: number; max: number; step?: number }) => (
    <div className="space-y-2">
      <Label htmlFor={`org-${k}`}>{label}</Label>
      <Input id={`org-${k}`} type="number" {...props} value={v[k]} onChange={(e) => set(k, Number(e.target.value))} aria-invalid={fe[k] ? true : undefined} />
      <FieldError id={`org-${k}-err`} message={fe[k]} />
    </div>
  );
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><SlidersHorizontal className="size-3.5" /> Réglages de la répartition</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Réglages de la répartition</DialogTitle>
            <DialogDescription>Valables pour toute l&apos;organisation. Les durées reposent sur les itinéraires routiers réels.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveOrgSettingsAction(v);
              if (r.ok) { toast.success("Réglages enregistrés."); setOpen(false); router.refresh(); }
              else { setFe(r.fieldErrors ?? {}); if (!r.fieldErrors) toast.error(r.error); }
            });
          }}>
            <div className="grid grid-cols-2 gap-3">
              {field("targetPerDay", "Norme (RDV par jour)", { min: 1, max: 10 })}
              {field("comfortMax", "Confort (1 RDV de plus si détour faible)", { min: 1, max: 10 })}
              {field("absoluteMax", "Maximum (au-delà du confort : jamais auto)", { min: 1, max: 10 })}
              {field("maxExtraMin", "Détour max pour le RDV de confort (min)", { min: 0, max: 120 })}
              {field("maxLegMin", "Trajet max entre 2 RDV (min de route)", { min: 5, max: 300 })}
              {field("maxBaseMin", "Trajet max depuis la base (min)", { min: 5, max: 480 })}
              {field("maxLegKm", "Trajet max entre 2 RDV (km)", { min: 1, max: 300 })}
              {field("horizonDays", "Horizon (jours, dès demain)", { min: 1, max: 30 })}
              {field("morningCoef", "Pointe du matin 7h30–9h30 (×)", { min: 1, max: 3, step: 0.05 })}
              {field("eveningCoef", "Pointe du soir 16h30–19h30 (×)", { min: 1, max: 3, step: 0.05 })}
              {field("safetyPct", "Marge de sécurité (%)", { min: 0, max: 100 })}
            </div>
            <p className="text-xs text-muted-foreground">Les coefficients s&apos;appliquent en semaine aux trajets de plus de 15 min : estimation selon l&apos;heure, pas du trafic en temps réel.</p>
            <Button type="submit" className="w-full" loading={pending}>Enregistrer</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
