"use server";

import { revalidatePath } from "next/cache";
import { dashboardCache } from "@/lib/dashboard/cache";
import { guard, type ActionResult } from "@/lib/action-guard";
import { canEditField, type CustomFieldDef } from "@/lib/custom-fields";
import { analyze, execute, MAX_REPORTED_ISSUES, type Analysis } from "@/lib/import/engine";
import { CsvError, IMPORT_MAX_BYTES, parseCsv, toCsv } from "@/lib/import/csv";
import { autoMap, type Mapping, type NativeKey, type RowIssue } from "@/lib/import/mapping";
import { supabaseImportStore } from "@/lib/import/store";
import { dropUnfinishedImports } from "@/lib/maintenance";
import { loadFieldDefs } from "@/lib/leads/meta";
import { neutralizeFormula } from "@/lib/leads/normalize";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors, firstError } from "@/lib/validation/auth";
import { dryRunSchema, jobIdSchema } from "@/lib/validation/import";
import type { AppSession } from "@/lib/session";

const BUCKET = "imports";
const OK_MIME = new Set(["", "text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"]);
const PERM = "leads.import" as const;

export interface UploadResult {
  jobId: string;
  filename: string;
  headers: string[];
  preview: string[][];
  total: number;
  delimiter: string;
  encoding: string;
  mapping: Mapping;
  customTargets: { key: string; label: string; required: boolean; type: string; choices?: string[] }[];
}
export interface Report {
  counts: { total: number; created: number; updated: number; skipped: number; failed: number };
  issues: RowIssue[];
  truncated: boolean;
}

async function loadJob(s: AppSession, jobId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("import_jobs").select("*").eq("id", jobId).eq("org_id", s.org.id).eq("user_id", s.user.id).maybeSingle();
  return data;
}
const ctxOf = (s: AppSession) => ({ roleId: s.role.id, isAdmin: s.isAdmin });
const editable = (defs: CustomFieldDef[], s: AppSession) => defs.filter((f) => f.type !== "file" && canEditField(f, ctxOf(s)));

export async function uploadCsvAction(formData: FormData): Promise<ActionResult<UploadResult>> {
  const g = await guard(PERM, "import-upload");
  if ("error" in g) return { ok: false, error: g.error };
  const { s } = g;
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Aucun fichier reçu." };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, error: "Fichier trop volumineux (5 Mo maximum)." };
  if (!/\.(csv|txt)$/i.test(file.name) || !OK_MIME.has(file.type)) return { ok: false, error: "Format non supporté : déposez un fichier .csv." };
  let parsed;
  try {
    parsed = parseCsv(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return { ok: false, error: e instanceof CsvError ? e.message : "Fichier illisible." };
  }
  const defs = editable(await loadFieldDefs(s.org.id), s);
  await dropUnfinishedImports(s.org.id, s.user.id); // l'ancien fichier abandonné (données personnelles) est supprimé
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("import_jobs")
    .insert({ org_id: s.org.id, user_id: s.user.id, filename: file.name.slice(0, 200), total: parsed.rows.length })
    .select("id")
    .single();
  if (error || !job) return { ok: false, error: "Import impossible." };
  const path = `${s.org.id}/${job.id}.csv`;
  const up = await admin.storage.from(BUCKET).upload(path, new Blob([await file.arrayBuffer()], { type: "text/csv" }), { contentType: "text/csv", upsert: false });
  if (up.error) {
    await admin.from("import_jobs").delete().eq("id", job.id);
    return { ok: false, error: "Enregistrement du fichier impossible." };
  }
  await admin.from("import_jobs").update({ file_path: path }).eq("id", job.id);
  return {
    ok: true,
    data: {
      jobId: job.id, filename: file.name, headers: parsed.headers, preview: parsed.rows.slice(0, 5), total: parsed.rows.length,
      delimiter: parsed.delimiter, encoding: parsed.encoding, mapping: autoMap(parsed.headers, defs),
      customTargets: defs.map((f) => ({ key: f.key, label: f.label, required: f.required, type: f.type, choices: f.options?.choices })),
    },
  };
}

async function analysisFor(s: AppSession, job: NonNullable<Awaited<ReturnType<typeof loadJob>>>, mapping: Mapping, options: ReturnType<typeof dryRunSchema.parse>["options"]) {
  const admin = createAdminClient();
  const dl = await admin.storage.from(BUCKET).download(job.file_path!);
  if (dl.error || !dl.data) throw new CsvError("Le fichier n'est plus disponible : renvoyez-le.");
  const parsed = parseCsv(new Uint8Array(await dl.data.arrayBuffer()));
  const store = supabaseImportStore(admin, s.org.id, s.user.id, job.id);
  const defs = await loadFieldDefs(s.org.id);
  const analysis = await analyze(store, parsed.headers, parsed.rows, mapping, options, defs, ctxOf(s));
  return { analysis, store, headers: parsed.headers, defs };
}

function checkMapping(headers: string[], mapping: Mapping, defs: CustomFieldDef[], s: AppSession, defaults: Record<string, string> = {}): string | null {
  const targets = new Set<string>();
  for (const [h, t] of Object.entries(mapping)) {
    if (!headers.includes(h)) return `Colonne inconnue : ${h}.`;
    if (t === "ignore") continue;
    if (targets.has(t)) return "Un même champ ne peut pas être associé à deux colonnes.";
    targets.add(t);
    if (t.startsWith("custom:")) {
      const f = defs.find((x) => x.key === t.slice(7));
      if (!f || !canEditField(f, ctxOf(s)) || f.type === "file") return `Champ personnalisé non disponible : ${t.slice(7)}.`;
    }
  }
  const missing = defs.filter((f) => f.required && f.type !== "file" && canEditField(f, ctxOf(s)) && !targets.has(`custom:${f.key}`) && !(defaults[f.key] ?? "").trim());
  if (missing.length) return `Champs obligatoires non associés : ${missing.map((f) => f.label).join(", ")}. Associez une colonne du fichier ou définissez une valeur par défaut.`;
  const need: NativeKey[] = ["first_name", "last_name", "company"];
  if (!need.some((k) => targets.has(k))) return "Associez au moins une colonne Prénom, Nom ou Société.";
  return null;
}

export async function dryRunAction(input: unknown): Promise<ActionResult<Report>> {
  const g = await guard(PERM, "import-run");
  if ("error" in g) return { ok: false, error: g.error };
  const { s } = g;
  const p = dryRunSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const job = await loadJob(s, p.data.jobId);
  if (!job || !job.file_path || !["uploaded", "validated"].includes(job.status)) return { ok: false, error: "Import introuvable ou déjà exécuté." };
  try {
    const defs = await loadFieldDefs(s.org.id);
    const dl = await createAdminClient().storage.from(BUCKET).download(job.file_path);
    if (dl.error || !dl.data) return { ok: false, error: "Le fichier n'est plus disponible : renvoyez-le." };
    const parsed = parseCsv(new Uint8Array(await dl.data.arrayBuffer()));
    const mapping = p.data.mapping as Mapping;
    const bad = checkMapping(parsed.headers, mapping, defs, s, p.data.options.fieldDefaults);
    if (bad) return { ok: false, error: bad };
    const { analysis } = await analysisFor(s, job, mapping, p.data.options);
    await createAdminClient().from("import_jobs").update({
      status: "validated", mapping, options: p.data.options, total: analysis.counts.total,
      created_count: analysis.counts.created, updated_count: analysis.counts.updated, skipped_count: analysis.counts.skipped, failed_count: analysis.counts.failed,
      error_report: analysis.issues,
    }).eq("id", job.id);
    return { ok: true, data: { counts: analysis.counts, issues: analysis.issues.slice(0, 200), truncated: analysis.issues.length > 200 } };
  } catch (e) {
    return { ok: false, error: e instanceof CsvError ? e.message : "Simulation impossible." };
  }
}

export async function runImportAction(input: unknown): Promise<ActionResult<Report & { jobId: string }>> {
  const g = await guard(PERM, "import-run");
  if ("error" in g) return { ok: false, error: g.error };
  const { s } = g;
  const p = jobIdSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const job = await loadJob(s, p.data.jobId);
  if (!job || !job.file_path) return { ok: false, error: "Import introuvable." };
  const admin = createAdminClient();
  // Idempotence : un job ne s'exécute qu'une fois (transition atomique validated -> running).
  const { data: claimed } = await admin.from("import_jobs").update({ status: "running" }).eq("id", job.id).eq("status", "validated").select("id");
  if (!claimed?.length) return { ok: false, error: "Cet import a déjà été exécuté ou n'a pas été validé." };
  try {
    const { analysis, store } = await analysisFor(s, job, job.mapping as Mapping, job.options as ReturnType<typeof dryRunSchema.parse>["options"]);
    const res = await execute(store, analysis);
    const failedExtra = res.failedLines;
    const counts = {
      total: analysis.counts.total, created: res.created, updated: res.updated, skipped: analysis.counts.skipped,
      failed: analysis.counts.failed + failedExtra.length,
    };
    const issues = [...analysis.issues, ...failedExtra].slice(0, MAX_REPORTED_ISSUES);
    await admin.from("import_jobs").update({
      status: "done", created_count: counts.created, updated_count: counts.updated, skipped_count: counts.skipped, failed_count: counts.failed,
      error_report: issues, finished_at: new Date().toISOString(), file_path: null,
    }).eq("id", job.id);
    await admin.storage.from(BUCKET).remove([job.file_path]); // données personnelles : fichier supprimé dès la fin
    dashboardCache.clear();
  revalidatePath("/leads");
    return { ok: true, data: { jobId: job.id, counts, issues: issues.slice(0, 200), truncated: issues.length > 200 } };
  } catch (e) {
    // Échec : le CSV (données personnelles) est supprimé du Storage.
    await admin.storage.from(BUCKET).remove([job.file_path]).catch(() => undefined);
    await admin.from("import_jobs").update({ status: "failed", finished_at: new Date().toISOString(), file_path: null }).eq("id", job.id);
    return { ok: false, error: e instanceof CsvError ? e.message : "L'import a échoué." };
  }
}

/** Rapport d'erreurs au format CSV (UTF-8 BOM, formules neutralisées). */
export async function errorReportCsvAction(input: unknown): Promise<ActionResult<{ csv: string }>> {
  const g = await guard(PERM, "import-report");
  if ("error" in g) return { ok: false, error: g.error };
  const p = jobIdSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const job = await loadJob(g.s, p.data.jobId);
  if (!job) return { ok: false, error: "Import introuvable." };
  const issues = (job.error_report as RowIssue[]) ?? [];
  const csv = toCsv([["Ligne", "Colonne", "Motif"], ...issues.map((i) => [i.line, i.column, i.reason])], neutralizeFormula);
  return { ok: true, data: { csv } };
}

export type { Analysis };
