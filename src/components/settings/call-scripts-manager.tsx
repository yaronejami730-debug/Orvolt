"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarClock, ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteDomainAction, deleteScriptAction, saveDomainAction, saveScriptAction } from "@/app/(app)/settings/call-scripts/actions";
import { AssignmentRows, type ProgContext } from "@/components/settings/call-assignments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Assignment } from "@/lib/call-programming";
import { answerOptions, canBeCondition, hasChoices, QUESTION_TYPE_LABELS, QUESTION_TYPES, type QuestionType, type ScriptQuestion } from "@/lib/call-scripts";

export interface ScriptRow { id: string; name: string; description: string | null; active: boolean; domainId: string | null; questions: ScriptQuestion[] }

const blankQuestion = (): ScriptQuestion => ({ id: crypto.randomUUID(), label: "", help: null, type: "short_text", choices: [], required: false, showIf: null });

export function CallScriptsManager({ scripts, assignments, ctx, canBuild, canProgram, programmingOn, now }: {
  scripts: ScriptRow[]; assignments: Assignment[]; ctx: ProgContext; canBuild: boolean; canProgram: boolean; programmingOn: boolean; now: string;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<ScriptRow | "new" | null>(null);
  const [prog, setProg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const domain = (id: string | null) => ctx.domains.find((d) => d.id === id);
  const progScript = scripts.find((s) => s.id === prog);

  return (
    <section className="space-y-3" aria-labelledby="scripts-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="scripts-title" className="text-lg font-semibold">Formulaires d&apos;appel</h2>
          <p className="text-sm text-muted-foreground">Les questions que le téléprospecteur suit pendant l&apos;appel.</p>
        </div>
        {canBuild && <Button onClick={() => setEdit("new")}><Plus className="size-4" /> Nouveau formulaire</Button>}
      </div>
      {scripts.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Aucun formulaire" description="Créez un premier formulaire d'appel, par exemple pour la pompe à chaleur." />
      ) : (
        <ul className="space-y-2" data-testid="scripts">
          {scripts.map((s) => {
            const d = domain(s.domainId);
            const n = assignments.filter((a) => a.scriptId === s.id).length;
            return (
              <li key={s.id} data-testid={`script-${s.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.questions.length} question{s.questions.length > 1 ? "s" : ""}{programmingOn ? ` · ${n === 0 ? "ouvert à tous (non programmé)" : `${n} programmation${n > 1 ? "s" : ""}`}` : ""}</p>
                </div>
                {d ? <Badge color={d.color ?? undefined}>{d.name}</Badge> : programmingOn && <Badge>Générique</Badge>}
                {!s.active && <Badge tone="warning">Inactif</Badge>}
                {programmingOn && canProgram && <Button size="sm" variant="outline" onClick={() => setProg(s.id)}><CalendarClock className="size-4" /> Qui / quand</Button>}
                {canBuild && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={`Modifier ${s.name}`} onClick={() => setEdit(s)}><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Supprimer ${s.name}`} disabled={pending} onClick={() => {
                      if (window.confirm(`Supprimer le formulaire « ${s.name} » ? Les saisies déjà faites restent dans l'historique des leads.`)) start(async () => { const r = await deleteScriptAction({ id: s.id }); if (r.ok) { toast.success("Formulaire supprimé."); router.refresh(); } else toast.error(r.error); });
                    }}><Trash2 className="size-4" /></Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {edit && <ScriptEditor key={edit === "new" ? "new" : edit.id} script={edit === "new" ? null : edit} ctx={ctx} programmingOn={programmingOn} onClose={() => setEdit(null)} />}
      <Dialog open={!!progScript} onOpenChange={(o) => !o && setProg(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Qui utilise « {progScript?.name} » et quand</DialogTitle>
            <DialogDescription>Sans programmation, le formulaire reste ouvert à tous. Dès qu&apos;il en a une, seuls les membres concernés le voient, dans la fenêtre indiquée (heure de Paris).</DialogDescription>
          </DialogHeader>
          {progScript && <AssignmentRows items={assignments.filter((a) => a.scriptId === progScript.id)} ctx={ctx} now={now} show="script" fixed={{ scriptId: progScript.id }} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ScriptEditor({ script, ctx, programmingOn, onClose }: { script: ScriptRow | null; ctx: ProgContext; programmingOn: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(script?.name ?? "");
  const [description, setDescription] = useState(script?.description ?? "");
  const [active, setActive] = useState(script?.active ?? true);
  const [domainId, setDomainId] = useState(script?.domainId ?? "");
  const [questions, setQuestions] = useState<ScriptQuestion[]>(script?.questions ?? [blankQuestion()]);
  const [error, setError] = useState<string>();
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const setQ = (i: number, patch: Partial<ScriptQuestion>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => setQuestions((qs) => { const a = [...qs]; const j = i + d; if (j < 0 || j >= a.length) return qs; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const remove = (i: number) => setQuestions((qs) => qs.filter((_, j) => j !== i).map((q) => (q.showIf?.question === qs[i].id ? { ...q, showIf: null } : q)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      // Une condition ne peut viser qu'une question située plus haut (sinon on la retire).
      const clean = questions.map((q, i) => ({ ...q, help: q.help || null, showIf: q.showIf && questions.slice(0, i).some((p) => p.id === q.showIf!.question) ? q.showIf : null }));
      const res = await saveScriptAction({ id: script?.id ?? null, name, description, active, domainId: domainId || null, questions: clean });
      if (res.ok) { toast.success("Formulaire enregistré."); router.refresh(); onClose(); } else { setFe(res.fieldErrors ?? {}); setError(res.error); }
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{script ? "Modifier le formulaire" : "Nouveau formulaire"}</DialogTitle>
          <DialogDescription>Nom, domaine d&apos;activité et questions posées pendant l&apos;appel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="sc-name">Nom</Label><Input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={fe.name ? true : undefined} /><FieldError id="sc-name-error" message={fe.name} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-domain">Domaine</Label>
              <Select id="sc-domain" value={domainId} onChange={(e) => setDomainId(e.target.value)} disabled={!programmingOn}>
                <option value="">Générique (tous domaines)</option>
                {ctx.domains.map((d) => <option key={d.id} value={d.id}>{d.name}{d.active ? "" : " (inactif)"}</option>)}
              </Select>
              {!programmingOn && <p className="text-xs text-muted-foreground">Disponible avec le plan Pro.</p>}
            </div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="sc-desc">Description (facultatif)</Label><Textarea id="sc-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} aria-label="Formulaire actif" /> Formulaire actif</label>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Questions</h3>
            {questions.map((q, i) => (
              <div key={q.id} className="space-y-2 rounded-lg border p-3" data-testid="question-editor">
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label={`Question ${i + 1}`} placeholder="Intitulé de la question" value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} maxLength={200} className="min-w-48 flex-1" />
                  <Select aria-label="Type de réponse" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as QuestionType, choices: hasChoices(e.target.value as QuestionType) ? q.choices : [] })} className="w-44">
                    {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
                  </Select>
                  <Button type="button" size="icon" variant="ghost" aria-label="Monter" onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Descendre" onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Supprimer la question" onClick={() => remove(i)}><Trash2 className="size-4" /></Button>
                </div>
                {hasChoices(q.type) && (
                  <Textarea aria-label="Réponses préfaites (une par ligne)" placeholder={"Une réponse par ligne"} rows={3} value={q.choices.join("\n")} onChange={(e) => setQ(i, { choices: e.target.value.split("\n").map((c) => c.trim()).filter(Boolean) })} />
                )}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2"><Switch checked={q.required} onCheckedChange={(v) => setQ(i, { required: v })} aria-label="Réponse obligatoire" /> Obligatoire</label>
                  {i > 0 && questions.slice(0, i).some(canBeCondition) && (
                    <span className="flex flex-wrap items-center gap-2">
                      Afficher si
                      <Select aria-label="Question condition" value={q.showIf?.question ?? ""} className="h-9 w-44" onChange={(e) => {
                        const target = questions.find((x) => x.id === e.target.value);
                        setQ(i, { showIf: target ? { question: target.id, equals: answerOptions(target)[0] ?? "" } : null });
                      }}>
                        <option value="">toujours</option>
                        {questions.slice(0, i).filter(canBeCondition).map((p) => <option key={p.id} value={p.id}>{p.label || "Sans titre"}</option>)}
                      </Select>
                      {q.showIf && (
                        <Select aria-label="Valeur condition" value={q.showIf.equals} className="h-9 w-36" onChange={(e) => setQ(i, { showIf: { question: q.showIf!.question, equals: e.target.value } })}>
                          {answerOptions(questions.find((x) => x.id === q.showIf!.question) ?? q).map((o) => <option key={o} value={o}>{o}</option>)}
                        </Select>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])} disabled={questions.length >= 40}><Plus className="size-4" /> Ajouter une question</Button>
          </div>
          {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
            <Button type="submit" loading={pending}>Enregistrer</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Domaines d'activité de l'organisation : création, renommage, couleur, activation, suppression. */
export function DomainsManager({ domains }: { domains: ProgContext["domains"] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string> }>, ok?: string, onFail?: (e: string) => void) =>
    start(async () => { const r = await fn(); if (r.ok) { if (ok) toast.success(ok); router.refresh(); } else (onFail ?? toast.error)(r.fieldErrors?.name ?? r.error ?? "Opération impossible."); });
  return (
    <section className="space-y-3" aria-labelledby="domains-title">
      <div>
        <h2 id="domains-title" className="text-lg font-semibold">Domaines d&apos;activité</h2>
        <p className="text-sm text-muted-foreground">Pompe à chaleur, photovoltaïque… Rattachez-y vos formulaires et vos téléprospecteurs.</p>
      </div>
      <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); run(() => saveDomainAction({ name }), undefined, setError); setName(""); setError(undefined); }}>
        <div className="flex gap-2">
          <Input aria-label="Nouveau domaine" placeholder="Nom du domaine" value={name} onChange={(e) => { setName(e.target.value); setError(undefined); }} maxLength={60} />
          <Button type="submit" loading={pending}><Plus className="size-4" /> Ajouter</Button>
        </div>
        <FieldError id="domain-error" message={error} />
      </form>
      {domains.length === 0 ? <p className="text-sm text-muted-foreground">Aucun domaine.</p> : (
        <ul className="space-y-2" data-testid="domains">
          {domains.map((d) => (
            <li key={d.id} data-testid={`domain-${d.name}`} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
              <span className="size-3 shrink-0 rounded-full border" style={{ backgroundColor: d.color ?? "transparent" }} aria-hidden />
              {editId === d.id ? (
                <form className="flex min-w-0 flex-1 flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveDomainAction({ id: d.id, name: editName, color: editColor }), "Domaine enregistré.", toast.error); setEditId(null); }}>
                  <Input aria-label="Renommer le domaine" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={60} className="h-9" autoFocus />
                  <ColorPicker value={editColor} onChange={setEditColor} />
                  <div className="flex gap-2"><Button size="sm" type="submit">Valider</Button><Button size="sm" type="button" variant="ghost" onClick={() => setEditId(null)}>Annuler</Button></div>
                </form>
              ) : (
                <>
                  <span className={`min-w-0 flex-1 truncate font-medium ${d.active ? "" : "text-muted-foreground line-through"}`}>{d.name}</span>
                  <Switch checked={d.active} disabled={pending} aria-label={`Domaine ${d.name} actif`} onCheckedChange={(v) => run(() => saveDomainAction({ id: d.id, name: d.name, active: v }), v ? "Domaine activé." : "Domaine désactivé.")} />
                  <Button size="icon" variant="ghost" aria-label={`Modifier ${d.name}`} onClick={() => { setEditId(d.id); setEditName(d.name); setEditColor(d.color); }}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Supprimer ${d.name}`} disabled={pending} onClick={() => { if (window.confirm(`Supprimer le domaine « ${d.name} » ? Les formulaires et leads rattachés deviennent génériques.`)) run(() => deleteDomainAction({ id: d.id }), "Domaine supprimé."); }}><Trash2 className="size-4" /></Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
