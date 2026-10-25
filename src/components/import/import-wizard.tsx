"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileUp } from "lucide-react";
import { toast } from "sonner";
import { dryRunAction, errorReportCsvAction, runImportAction, uploadCsvAction, type Report, type UploadResult } from "@/app/(app)/import/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { NATIVE_TARGETS, type Mapping, type Target } from "@/lib/import/mapping";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/import/csv";
import { cn } from "@/lib/utils";

interface Props {
  sources: { id: string; name: string }[];
  members: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  initialStatus: string;
}
const STEPS = ["Fichier", "Mappage", "Options", "Résultat"];
const TEMPLATE = "Prénom;Nom;Société;E-mail;Téléphone;Adresse;Ville;Code postal;Valeur;Source\nJean;Dupont;ACME;jean.dupont@example.com;06 12 34 56 78;1 rue de la Paix;Paris;75002;12000;Salon\n";

export function ImportWizard({ sources, members, roles, initialStatus }: Props) {
  const [step, setStep] = useState(0);
  const [up, setUp] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dupMode, setDupMode] = useState<"skip" | "update" | "create">("skip");
  const [dupBy, setDupBy] = useState<"email" | "phone" | "either">("either");
  const [sourceId, setSourceId] = useState("");
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [assign, setAssign] = useState<"none" | "user" | "role">("none");
  const [assignId, setAssignId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [result, setResult] = useState<(Report & { jobId: string }) | null>(null);
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function upload(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    if (file.size > IMPORT_MAX_BYTES) return setError("Fichier trop volumineux (5 Mo maximum).");
    if (!/\.(csv|txt)$/i.test(file.name)) return setError("Format non supporté : déposez un fichier .csv.");
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const r = await uploadCsvAction(fd);
      if (r.ok && r.data) { setUp(r.data); setMapping(r.data.mapping); setReport(null); setStep(1); } else setError(r.error);
    });
  }

  const targets = (up?.customTargets ?? []).map((c) => ({ value: `custom:${c.key}`, label: `${c.label} (champ personnalisé)` }));
  const mapped = new Set<string>(Object.values(mapping).filter((v) => v !== "ignore"));
  const unmappedRequired = (up?.customTargets ?? []).filter((c) => c.required && !mapped.has(`custom:${c.key}`));
  const missingDefault = unmappedRequired.filter((c) => !(defaults[c.key] ?? "").trim());
  const hasName = ["first_name", "last_name", "company"].some((k) => mapped.has(k));
  const optionsPayload = () => ({
    duplicateMode: dupMode, duplicateBy: dupBy, sourceId: sourceId || null,
    fieldDefaults: Object.fromEntries(Object.entries(defaults).filter(([, v]) => v.trim())),
    assign: assign === "none" || !assignId ? { mode: "none" as const } : assign === "user" ? { mode: "user" as const, userId: assignId } : { mode: "role" as const, roleId: assignId },
  });

  function validate() {
    setError(undefined);
    start(async () => {
      const r = await dryRunAction({ jobId: up!.jobId, mapping, options: optionsPayload() });
      if (r.ok && r.data) setReport(r.data); else { setReport(null); setError(r.error); }
    });
  }
  function run() {
    setError(undefined);
    start(async () => {
      const r = await runImportAction({ jobId: up!.jobId });
      if (r.ok && r.data) { setResult(r.data); setStep(3); toast.success("Import terminé."); } else setError(r.error);
    });
  }
  async function download() {
    const r = await errorReportCsvAction({ jobId: (result?.jobId ?? up!.jobId) });
    if (!r.ok || !r.data) return toast.error(r.error);
    const url = URL.createObjectURL(new Blob([r.data.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "rapport-erreurs-import.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([`﻿${TEMPLATE}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "modele-import-leads.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Étapes">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-sm", i === step && "border-accent bg-accent-soft text-link", i < step && "text-muted-foreground")}>
            <span className="font-semibold">{i + 1}</span> {s}
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-text">{error}</p>}

      {step === 0 && (
        <Card className="space-y-4 p-6">
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
            className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center", drag && "border-accent bg-accent-soft")}>
            <FileUp className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">Glissez votre fichier CSV ici</p>
            <Button loading={pending} onClick={() => input.current?.click()}>Choisir un fichier</Button>
            <input ref={input} type="file" accept=".csv,.txt,text/csv" aria-label="Fichier CSV" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
            <p className="text-xs text-muted-foreground">CSV (UTF-8 ou Windows-1252), séparateur détecté automatiquement. {IMPORT_MAX_BYTES / 1024 / 1024} Mo et {IMPORT_MAX_ROWS.toLocaleString("fr-FR")} lignes maximum.</p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="size-4" /> Télécharger un modèle CSV</Button>
        </Card>
      )}

      {step === 1 && up && (
        <Card className="space-y-4 p-6">
          <p className="text-sm text-muted-foreground">{up.filename} · {up.total} ligne(s) · séparateur « {up.delimiter === "\t" ? "tabulation" : up.delimiter} » · {up.encoding}</p>
          <div className="space-y-3">
            {up.headers.map((h, i) => (
              <div key={h} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_2fr] sm:items-center">
                <span className="font-medium">{h}</span>
                <Select aria-label={`Champ pour ${h}`} value={mapping[h] ?? "ignore"} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value as Target })}>
                  <option value="ignore">Ignorer</option>
                  {NATIVE_TARGETS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <span className="truncate text-xs text-muted-foreground">{up.preview.map((r) => r[i]).filter(Boolean).slice(0, 3).join(" · ")}</span>
              </div>
            ))}
          </div>
          {unmappedRequired.length > 0 && (
            <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4" data-testid="required-defaults">
              <p className="flex gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />Ces champs sont obligatoires et ne sont associés à aucune colonne : associez une colonne ci-dessus ou définissez une valeur appliquée à toutes les lignes.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {unmappedRequired.map((c) => (
                  <div key={c.key} className="space-y-1">
                    <Label htmlFor={`def-${c.key}`}>{c.label} (valeur par défaut)</Label>
                    {c.choices ? (
                      <Select id={`def-${c.key}`} value={defaults[c.key] ?? ""} onChange={(e) => { setDefaults({ ...defaults, [c.key]: e.target.value }); setReport(null); }}>
                        <option value="">Choisir…</option>{c.choices.map((x) => <option key={x} value={x}>{x}</option>)}
                      </Select>
                    ) : (
                      <input id={`def-${c.key}`} type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"} value={defaults[c.key] ?? ""} onChange={(e) => { setDefaults({ ...defaults, [c.key]: e.target.value }); setReport(null); }} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!hasName && <p className="flex gap-2 text-sm text-destructive-text"><AlertTriangle className="size-4" aria-hidden />Associez au moins une colonne Prénom, Nom ou Société.</p>}
          {hasName && !mapped.has("email") && !mapped.has("phone") && <p className="flex gap-2 text-sm text-warning-text"><AlertTriangle className="size-4" aria-hidden />Ni e-mail ni téléphone associé : la détection des doublons sera impossible.</p>}
          <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(0)}>Retour</Button><Button disabled={!hasName || missingDefault.length > 0} onClick={() => setStep(2)}>Continuer</Button></div>
        </Card>
      )}

      {step === 2 && up && (
        <Card className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="imp-source">Source par défaut</Label>
              <Select id="imp-source" value={sourceId} onChange={(e) => { setSourceId(e.target.value); setReport(null); }}><option value="">Aucune</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            <div className="space-y-2"><Label>Statut initial</Label><p className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm">{initialStatus} (verrouillé)</p></div>
            <div className="space-y-2"><Label htmlFor="imp-assign">Assignation</Label>
              <Select id="imp-assign" value={assign} onChange={(e) => { setAssign(e.target.value as typeof assign); setAssignId(""); setReport(null); }}><option value="none">Personne</option><option value="user">Un membre</option><option value="role">Répartition équitable par rôle</option></Select></div>
            {assign !== "none" && (
              <div className="space-y-2"><Label htmlFor="imp-assignee">{assign === "user" ? "Membre" : "Rôle"}</Label>
                <Select id="imp-assignee" value={assignId} onChange={(e) => { setAssignId(e.target.value); setReport(null); }}><option value="">Choisir…</option>{(assign === "user" ? members : roles).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
            )}
            <div className="space-y-2"><Label htmlFor="imp-dup">Doublons</Label>
              <Select id="imp-dup" value={dupMode} onChange={(e) => { setDupMode(e.target.value as typeof dupMode); setReport(null); }}><option value="skip">Ignorer</option><option value="update">Mettre à jour</option><option value="create">Créer quand même</option></Select></div>
            <div className="space-y-2"><Label htmlFor="imp-dupby">Détection sur</Label>
              <Select id="imp-dupby" value={dupBy} onChange={(e) => { setDupBy(e.target.value as typeof dupBy); setReport(null); }}><option value="either">E-mail ou téléphone</option><option value="email">E-mail</option><option value="phone">Téléphone</option></Select></div>
          </div>
          <Button variant="outline" onClick={validate} loading={pending}><CheckCircle2 className="size-4" /> Valider (simulation, sans écriture)</Button>
          {report && (
            <div className="space-y-3" data-testid="dry-report">
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">{report.counts.created} à créer</Badge><Badge tone="accent">{report.counts.updated} à mettre à jour</Badge>
                <Badge>{report.counts.skipped} ignorés</Badge><Badge tone={report.counts.failed ? "destructive" : "neutral"}>{report.counts.failed} en erreur</Badge>
              </div>
              {report.issues.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-lg border">
                  <table className="w-full text-sm"><thead className="bg-muted/50 text-left text-xs"><tr><th className="p-2">Ligne</th><th className="p-2">Colonne</th><th className="p-2">Motif</th></tr></thead>
                    <tbody>{report.issues.map((i, k) => <tr key={k} className="border-t"><td className="p-2 tabular-nums">{i.line}</td><td className="p-2">{i.column}</td><td className="p-2">{i.reason}</td></tr>)}</tbody></table>
                </div>
              )}
              {report.truncated && <p className="text-xs text-muted-foreground">Seules les premières erreurs sont affichées ; le rapport complet est téléchargeable après l&apos;import.</p>}
            </div>
          )}
          <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(1)}>Retour</Button><Button disabled={!report || report.counts.created + report.counts.updated === 0 || (assign !== "none" && !assignId)} loading={pending} onClick={run}>Lancer l&apos;import</Button></div>
        </Card>
      )}

      {step === 3 && result && (
        <Card className="space-y-4 p-6" data-testid="import-result">
          <h2 className="text-lg font-semibold">Import terminé</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone="success" data-testid="n-created">{result.counts.created} créés</Badge><Badge tone="accent" data-testid="n-updated">{result.counts.updated} mis à jour</Badge>
            <Badge data-testid="n-skipped">{result.counts.skipped} ignorés</Badge><Badge tone={result.counts.failed ? "destructive" : "neutral"} data-testid="n-failed">{result.counts.failed} en erreur</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild><Link href="/leads">Voir les leads</Link></Button>
            {result.counts.failed > 0 && <Button variant="outline" onClick={download}><Download className="size-4" /> Télécharger le rapport d&apos;erreurs (CSV)</Button>}
            <Button variant="ghost" onClick={() => { setStep(0); setUp(null); setResult(null); setReport(null); }}>Nouvel import</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
