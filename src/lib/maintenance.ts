import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "imports";

/**
 * Supprime les fichiers CSV (données personnelles) des imports abandonnés ou en échec, puis purge la base.
 * Un import `uploaded`/`validated` sans exécution depuis plus d'une heure est considéré abandonné.
 */
export async function purgeImportFiles(olderThanMs = 3_600_000): Promise<number> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data } = await admin.from("import_jobs").select("id, file_path, status").not("file_path", "is", null).lt("created_at", cutoff).in("status", ["uploaded", "validated", "failed", "running"]).limit(500);
  const paths = (data ?? []).map((j) => j.file_path as string);
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
  for (const j of data ?? []) {
    await admin.from("import_jobs").update({ file_path: null, status: j.status === "done" ? "done" : "failed", finished_at: new Date().toISOString() }).eq("id", j.id);
  }
  return paths.length;
}

/** Supprime les fichiers d'un utilisateur dont l'import n'a jamais abouti (nouvel envoi = ancien fichier inutile). */
export async function dropUnfinishedImports(orgId: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("import_jobs").select("id, file_path").eq("org_id", orgId).eq("user_id", userId).in("status", ["uploaded", "validated"]).not("file_path", "is", null);
  const paths = (data ?? []).map((j) => j.file_path as string);
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
  for (const j of data ?? []) await admin.from("import_jobs").update({ file_path: null, status: "failed" }).eq("id", j.id);
}

export interface MaintenanceReport {
  inboundEventsDeleted: number;
  importFilesRemoved: number;
  importJobsDeleted: number;
}

/** Tâche planifiée : rétention des événements entrants, fichiers d'import orphelins, jobs anciens. */
export async function runMaintenance(): Promise<MaintenanceReport> {
  const admin = createAdminClient();
  const importFilesRemoved = await purgeImportFiles();
  const ev = await admin.rpc("purge_inbound_events", { p_days: 90, p_mask_days: 14 });
  const jobs = await admin.rpc("purge_import_jobs", { p_days: 30 });
  return { inboundEventsDeleted: Number(ev.data ?? 0), importFilesRemoved, importJobsDeleted: Number(jobs.data ?? 0) };
}
