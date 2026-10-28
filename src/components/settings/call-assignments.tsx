"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAssignmentAction, saveAssignmentAction, toggleAssignmentAction } from "@/app/(app)/settings/call-scripts/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { assignmentStatus, describeWindow, SCOPE_LABELS, SCOPES, STATUS_LABELS, type Assignment, type AssignmentScope, type CallDomain, type ScriptLite } from "@/lib/call-programming";

export interface ProgContext {
  scripts: ScriptLite[];
  domains: CallDomain[];
  members: { id: string; name: string }[];
}
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_FULL = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const STATUS_TONE = { inactive: "neutral", expired: "neutral", upcoming: "info", live: "success", later: "warning" } as const;

export function targetLabel(a: Pick<Assignment, "scope" | "userId" | "domainId">, ctx: ProgContext): string {
  if (a.scope === "all") return "Tout le monde";
  if (a.scope === "domain") return `Domaine « ${ctx.domains.find((d) => d.id === a.domainId)?.name ?? "?"} »`;
  return ctx.members.find((m) => m.id === a.userId)?.name ?? "Téléprospecteur";
}

/** Formulaire d'ajout / modification d'une programmation. `fixed` fige le formulaire ou le membre (selon l'écran appelant). */
export function AssignmentForm({ ctx, initial, fixed, onDone, onCancel }: {
  ctx: ProgContext; initial?: Assignment; fixed?: { scriptId?: string; userId?: string }; onDone: () => void; onCancel: () => void;
}) {
  const router = useRouter();
  const [scriptId, setScriptId] = useState(initial?.scriptId ?? fixed?.scriptId ?? ctx.scripts[0]?.id ?? "");
  const [scope, setScope] = useState<AssignmentScope>(initial?.scope ?? (fixed?.userId ? "member" : "domain"));
  const [userId, setUserId] = useState(initial?.userId ?? fixed?.userId ?? ctx.members[0]?.id ?? "");
  const [domainId, setDomainId] = useState(initial?.domainId ?? ctx.domains.find((d) => d.active)?.id ?? "");
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const [days, setDays] = useState<number[]>(initial?.days ?? []);
  const [timeFrom, setTimeFrom] = useState(initial?.timeFrom ?? "");
  const [timeTo, setTimeTo] = useState(initial?.timeTo ?? "");
  const [priority, setPriority] = useState(String(initial?.priority ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const scopes = fixed?.userId ? (["member"] as const) : SCOPES;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveAssignmentAction({
        id: initial?.id ?? null, scriptId, scope, userId: scope === "member" ? userId : null, domainId: scope === "domain" ? domainId : null,
        startsOn, endsOn, days: days.length ? days : null, timeFrom, timeTo, active, priority: Number(priority),
      });
      if (res.ok) {
        if (res.data?.warning) toast.warning(res.data.warning, { duration: 9000 }); else toast.success("Programmation enregistrée.");
        router.refresh();
        onDone();
      } else { setFe(res.fieldErrors ?? {}); setError(res.fieldErrors ? undefined : res.error); }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-muted/30 p-4" noValidate data-testid="assignment-form">
      <div className="grid gap-3 sm:grid-cols-2">
        {!fixed?.scriptId && (
          <div className="space-y-1.5">
            <Label htmlFor="as-script">Formulaire</Label>
            <Select id="as-script" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
              {ctx.scripts.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (inactif)"}</option>)}
            </Select>
            <FieldError id="as-script-error" message={fe.scriptId} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="as-scope">Pour qui ?</Label>
          <Select id="as-scope" value={scope} onChange={(e) => setScope(e.target.value as AssignmentScope)} disabled={!!fixed?.userId}>
            {scopes.map((k) => <option key={k} value={k}>{SCOPE_LABELS[k]}</option>)}
          </Select>
        </div>
        {scope === "member" && !fixed?.userId && (
          <div className="space-y-1.5">
            <Label htmlFor="as-user">Téléprospecteur</Label>
            <Select id="as-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {ctx.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <FieldError id="as-user-error" message={fe.userId} />
          </div>
        )}
        {scope === "domain" && (
          <div className="space-y-1.5">
            <Label htmlFor="as-domain">Domaine</Label>
            <Select id="as-domain" value={domainId} onChange={(e) => setDomainId(e.target.value)}>
              {ctx.domains.length === 0 && <option value="">Aucun domaine</option>}
              {ctx.domains.map((d) => <option key={d.id} value={d.id}>{d.name}{d.active ? "" : " (inactif)"}</option>)}
            </Select>
            <FieldError id="as-domain-error" message={fe.domainId} />
          </div>
        )}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Période (facultatif)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="as-start">Du</Label><Input id="as-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /><FieldError id="as-start-error" message={fe.startsOn} /></div>
          <div className="space-y-1.5"><Label htmlFor="as-end">Au (inclus)</Label><Input id="as-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-invalid={fe.endsOn ? true : undefined} /><FieldError id="as-end-error" message={fe.endsOn} /></div>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Jours et horaires, heure de Paris (facultatif)</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Jours de la semaine">
          {DAYS.map((d, i) => {
            const on = days.includes(i + 1);
            return (
              <button key={i} type="button" aria-pressed={on} aria-label={DAY_FULL[i]} title={DAY_FULL[i]}
                onClick={() => setDays(on ? days.filter((x) => x !== i + 1) : [...days, i + 1])}
                className={`size-9 rounded-full border text-sm font-medium transition-colors ${on ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground"}`}>{d}</button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Aucun jour choisi = tous les jours.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="as-from">De</Label><Input id="as-from" type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="as-to">À (exclu)</Label><Input id="as-to" type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} aria-invalid={fe.timeTo ? true : undefined} /><FieldError id="as-to-error" message={fe.timeTo} /></div>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="as-prio">Priorité (0 à 100)</Label>
          <Input id="as-prio" type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(e.target.value)} className="w-28" />
          <FieldError id="as-prio-error" message={fe.priority} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={active} onCheckedChange={setActive} aria-label="Programmation active" /> Active</label>
      </div>
      <p className="text-xs text-muted-foreground">Si plusieurs formulaires sont proposés au même moment, la priorité la plus haute passe en premier.</p>
      {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>Enregistrer</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>
      </div>
    </form>
  );
}

/** Liste lisible des programmations, avec modification, activation et suppression. */
export function AssignmentRows({ items, ctx, now, show, fixed }: { items: Assignment[]; ctx: ProgContext; now: string; show: "target" | "script"; fixed?: { scriptId?: string; userId?: string } }) {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const at = new Date(now);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error); });
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-muted-foreground" data-testid="assignments-empty">Aucune programmation.</p>}
      <ul className="space-y-2" data-testid="assignments">
        {items.map((a) => {
          const st = assignmentStatus(a, at);
          if (editId === a.id) return <li key={a.id}><AssignmentForm ctx={ctx} initial={a} fixed={fixed} onDone={() => setEditId(null)} onCancel={() => setEditId(null)} /></li>;
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card p-3 text-sm" data-testid="assignment-row">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{show === "script" ? targetLabel(a, ctx) : (ctx.scripts.find((s) => s.id === a.scriptId)?.name ?? "Formulaire")}</p>
                <p className="text-xs text-muted-foreground">{describeWindow(a)}{a.priority > 0 ? ` · priorité ${a.priority}` : ""}</p>
              </div>
              <Badge tone={STATUS_TONE[st]} dot>{STATUS_LABELS[st]}</Badge>
              <Switch checked={a.active} disabled={pending} aria-label="Programmation active" onCheckedChange={(v) => run(() => toggleAssignmentAction({ id: a.id, active: v }), v ? "Programmation activée." : "Programmation désactivée.")} />
              <Button size="icon" variant="ghost" aria-label="Modifier la programmation" onClick={() => setEditId(a.id)}><Pencil className="size-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="Supprimer la programmation" disabled={pending} onClick={() => { if (window.confirm("Supprimer cette programmation ?")) run(() => deleteAssignmentAction({ id: a.id }), "Programmation supprimée."); }}><Trash2 className="size-4" /></Button>
            </li>
          );
        })}
      </ul>
      {adding ? <AssignmentForm ctx={ctx} fixed={fixed} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} /> : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={ctx.scripts.length === 0}><Plus className="size-4" /> Ajouter une programmation</Button>
      )}
    </div>
  );
}
