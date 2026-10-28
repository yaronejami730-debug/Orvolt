"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { saveScriptRunAction } from "@/app/(app)/leads/script-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatAnswer, visibleQuestions, YES_NO, type AnswerValue, type Answers, type ScriptQuestion } from "@/lib/call-scripts";
import { ago } from "./format";

export interface LeadScript { id: string; name: string; description: string | null; domainId: string | null; isDefault: boolean; reason: string; questions: ScriptQuestion[] }
export interface ScriptRun { id: string; script_name: string; domain_name: string | null; user_id: string | null; answers: { question: string; label: string; value: AnswerValue }[]; created_at: string }

function QuestionInput({ q, value, onChange, error }: { q: ScriptQuestion; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void; error?: string }) {
  const id = `q-${q.id}`;
  const bad = { "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined } as const;
  const str = typeof value === "string" ? value : "";
  let input: React.ReactNode;
  switch (q.type) {
    case "long_text": input = <Textarea id={id} value={str} onChange={(e) => onChange(e.target.value)} maxLength={2000} {...bad} />; break;
    case "number": input = <Input id={id} type="number" step="any" value={str} onChange={(e) => onChange(e.target.value)} {...bad} />; break;
    case "date": input = <Input id={id} type="date" value={str} onChange={(e) => onChange(e.target.value)} {...bad} />; break;
    case "yes_no":
      input = <Select id={id} value={str} onChange={(e) => onChange(e.target.value)} {...bad}><option value="">—</option>{YES_NO.map((o) => <option key={o} value={o}>{o}</option>)}</Select>; break;
    case "single":
      input = <Select id={id} value={str} onChange={(e) => onChange(e.target.value)} {...bad}><option value="">—</option>{q.choices.map((o) => <option key={o} value={o}>{o}</option>)}</Select>; break;
    case "multi": {
      const cur = Array.isArray(value) ? value : [];
      input = (
        <div className="flex flex-wrap gap-3">
          {q.choices.map((c) => <label key={c} className="flex items-center gap-2 text-sm"><Checkbox checked={cur.includes(c)} aria-label={c} onCheckedChange={(v) => onChange(v === true ? [...cur, c] : cur.filter((x) => x !== c))} /> {c}</label>)}
        </div>
      ); break;
    }
    default: input = <Input id={id} value={str} onChange={(e) => onChange(e.target.value)} maxLength={300} {...bad} />;
  }
  return (
    <div className="space-y-1.5" data-testid="script-question">
      <Label htmlFor={id}>{q.label}{q.required && " *"}</Label>
      {q.help && <p className="text-xs text-muted-foreground">{q.help}</p>}
      {input}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** Onglet « Formulaire » de la fiche lead : le formulaire applicable s'ouvre directement ; seuls les formulaires proposés au membre sont listés. */
export function ScriptRunner({ leadId, scripts, runs, canEdit, members }: { leadId: string; scripts: LeadScript[]; runs: ScriptRun[]; canEdit: boolean; members: { id: string; name: string }[] }) {
  const router = useRouter();
  const [scriptId, setScriptId] = useState(scripts.find((s) => s.isDefault)?.id ?? scripts[0]?.id ?? "");
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const script = scripts.find((s) => s.id === scriptId);
  const shown = script ? visibleQuestions(script.questions, answers) : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!script) return;
    start(async () => {
      const res = await saveScriptRunAction({ leadId, scriptId: script.id, answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)) });
      if (res.ok) { toast.success("Formulaire enregistré."); setAnswers({}); setErrors({}); router.refresh(); }
      else { setErrors(res.data?.errors ?? {}); toast.error(res.error); }
    });
  };

  return (
    <div className="mt-4 space-y-6">
      {scripts.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Aucun formulaire pour vous" description="Aucun formulaire d'appel ne vous est proposé en ce moment." />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate data-testid="script-form">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="script-select">Formulaire</Label>
              <Select id="script-select" value={scriptId} onChange={(e) => { setScriptId(e.target.value); setAnswers({}); setErrors({}); }} className="min-w-56">
                {scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            {script?.isDefault && scripts.length > 1 && <Badge tone="accent">Proposé par défaut</Badge>}
          </div>
          {script?.description && <p className="text-sm text-muted-foreground">{script.description}</p>}
          <h3 className="text-base font-semibold" data-testid="script-title">{script?.name}</h3>
          {shown.map((q) => <QuestionInput key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />)}
          {canEdit ? <Button type="submit" loading={pending}>Enregistrer les réponses</Button> : <p className="text-sm text-muted-foreground">Vous n&apos;avez pas le droit de modifier ce lead.</p>}
        </form>
      )}
      {runs.length > 0 && (
        <section className="space-y-2" aria-label="Saisies précédentes">
          <h3 className="text-sm font-semibold">Saisies précédentes</h3>
          <ul className="space-y-2" data-testid="script-runs">
            {runs.map((r) => (
              <li key={r.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.script_name}</span>
                  {r.domain_name && <Badge>{r.domain_name}</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{members.find((m) => m.id === r.user_id)?.name ?? "—"} · {ago(r.created_at)}</span>
                </div>
                <dl className="mt-2 space-y-1">
                  {r.answers.map((a) => <div key={a.question}><dt className="text-xs text-muted-foreground">{a.label}</dt><dd>{formatAnswer(a.value)}</dd></div>)}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
