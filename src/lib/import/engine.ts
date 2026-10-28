import type { CustomFieldDef, FieldCtx } from "@/lib/custom-fields";
import { pickRoundRobin } from "@/lib/automation/round-robin";
import { dedupeKeys, validateRow, type DuplicateKey, type DuplicateMode, type Mapping, type ParsedLead, type RowIssue } from "./mapping";

export interface ImportOptions {
  duplicateMode: DuplicateMode;
  duplicateBy: DuplicateKey;
  sourceId: string | null;
  fieldDefaults?: Record<string, string>;
  assign: { mode: "none" } | { mode: "user"; userId: string } | { mode: "role"; roleId: string };
}

export interface ExistingIndex {
  byEmail: Map<string, string>;
  byPhone: Map<string, string>;
}
export interface InsertRow {
  status_id: string;
  source_id: string | null;
  call_domain_id?: string | null;
  assigned_to: string | null;
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  value: number | null;
  custom: Record<string, unknown>;
}
export interface ImportStore {
  initialStatusId(): Promise<string>;
  sourcesByName(): Promise<Map<string, string>>; // nom en minuscules -> id
  validSourceId(id: string): Promise<boolean>;
  /** Domaines d'activité actifs, nom en minuscules -> id (facultatif). */
  domainsByName?(): Promise<Map<string, string>>;
  activeMembers(roleId?: string): Promise<string[]>;
  lastAssigned(userIds: string[]): Promise<Record<string, string | null>>;
  findExisting(emails: string[], phones: string[]): Promise<ExistingIndex>;
  insertLeads(rows: InsertRow[]): Promise<string[]>; // ids dans l'ordre ; lève en cas d'échec du lot
  updateLead(id: string, patch: Record<string, unknown>, custom: Record<string, unknown>): Promise<void>;
  tagImportEvents(leadIds: string[]): Promise<void>;
}

export type PlanAction = "create" | "update" | "skip" | "error";
export interface PlanRow {
  line: number;
  action: PlanAction;
  lead?: ParsedLead;
  existingId?: string;
  sourceId?: string | null;
  domainId?: string | null;
  assignedTo?: string | null;
  mergeInto?: number; // index d'une ligne du plan créée plus tôt dans le fichier (doublon interne)
}
export interface Analysis {
  plan: PlanRow[];
  issues: RowIssue[];
  counts: { total: number; created: number; updated: number; skipped: number; failed: number };
}

export const MAX_REPORTED_ISSUES = 1000;

/** Analyse (simulation) : aucune écriture. */
export async function analyze(
  store: ImportStore,
  headers: string[],
  rows: string[][],
  mapping: Mapping,
  options: ImportOptions,
  fields: CustomFieldDef[],
  ctx: FieldCtx,
): Promise<Analysis> {
  const issues: RowIssue[] = [];
  const plan: PlanRow[] = [];
  const sources = await store.sourcesByName();
  if (options.sourceId && !(await store.validSourceId(options.sourceId))) {
    return { plan: [], issues: [{ line: 1, column: "—", reason: "Source par défaut invalide." }], counts: { total: rows.length, created: 0, updated: 0, skipped: 0, failed: rows.length } };
  }

  const domains = (await store.domainsByName?.()) ?? new Map<string, string>();
  const valid: { i: number; lead: ParsedLead; sourceId: string | null }[] = [];
  rows.forEach((row, idx) => {
    const line = idx + 2;
    const { lead, issues: rowIssues } = validateRow(headers, row, mapping, line, fields, ctx, options.fieldDefaults ?? {});
    let sourceId = options.sourceId;
    if (lead?.source_name) {
      const id = sources.get(lead.source_name.toLowerCase());
      if (id) sourceId = id;
      else rowIssues.push({ line, column: headers.find((h) => mapping[h] === "source") ?? "source", reason: `Source inconnue : « ${lead.source_name} ».` });
    }
    let domainId: string | null = null;
    if (lead?.domain_name) {
      domainId = domains.get(lead.domain_name.toLowerCase()) ?? null;
      if (!domainId) rowIssues.push({ line, column: headers.find((h) => mapping[h] === "domain") ?? "domain", reason: `Domaine inconnu : « ${lead.domain_name} ».` });
    }
    if (rowIssues.length || !lead) {
      issues.push(...rowIssues);
      plan.push({ line, action: "error" });
    } else {
      plan.push({ line, action: "create", lead, sourceId, domainId });
      valid.push({ i: plan.length - 1, lead, sourceId });
    }
  });

  // Doublons avec la base
  const emails = new Set<string>(), phones = new Set<string>();
  for (const v of valid) {
    const k = dedupeKeys(v.lead, options.duplicateBy);
    if (k.email) emails.add(k.email);
    if (k.phone) phones.add(k.phone);
  }
  const existing = emails.size || phones.size ? await store.findExisting([...emails], [...phones]) : { byEmail: new Map<string, string>(), byPhone: new Map<string, string>() };

  const firstInFile = new Map<string, number>(); // clé -> index du plan
  for (const v of valid) {
    const k = dedupeKeys(v.lead, options.duplicateBy);
    const keys = [k.email ? `e:${k.email}` : null, k.phone ? `p:${k.phone}` : null].filter(Boolean) as string[];
    const dbId = (k.email && existing.byEmail.get(k.email)) || (k.phone && existing.byPhone.get(k.phone)) || undefined;
    const earlier = keys.map((x) => firstInFile.get(x)).find((x) => x !== undefined);
    const row = plan[v.i]!;
    if (options.duplicateMode !== "create" && (dbId || earlier !== undefined)) {
      if (options.duplicateMode === "skip") row.action = "skip";
      else if (dbId) { row.action = "update"; row.existingId = dbId; }
      else { row.action = "update"; row.mergeInto = earlier; }
    }
    if (row.action === "create" || row.mergeInto === undefined) for (const x of keys) if (!firstInFile.has(x)) firstInFile.set(x, v.i);
  }

  // Assignation (créations uniquement)
  if (options.assign.mode !== "none") {
    let order: string[] = [];
    if (options.assign.mode === "user") order = (await store.activeMembers()).filter((id) => id === (options.assign as { userId: string }).userId);
    else {
      const cands = await store.activeMembers(options.assign.roleId);
      const last = await store.lastAssigned(cands);
      const first = pickRoundRobin(cands, last);
      order = first ? [...cands].sort((a, b) => (last[a] ? new Date(last[a]!).getTime() : -Infinity) - (last[b] ? new Date(last[b]!).getTime() : -Infinity) || a.localeCompare(b)) : [];
    }
    if (order.length === 0) {
      return { plan, issues: [{ line: 1, column: "—", reason: "Aucun membre actif pour l'assignation choisie." }, ...issues], counts: count(plan, rows.length) };
    }
    let n = 0;
    for (const r of plan) if (r.action === "create") r.assignedTo = order[n++ % order.length]!;
  }
  return { plan, issues: issues.slice(0, MAX_REPORTED_ISSUES), counts: count(plan, rows.length) };
}

function count(plan: PlanRow[], total: number) {
  const c = { total, created: 0, updated: 0, skipped: 0, failed: 0 };
  for (const r of plan) {
    if (r.action === "create") c.created++;
    else if (r.action === "update") c.updated++;
    else if (r.action === "skip") c.skipped++;
    else c.failed++;
  }
  return c;
}

const BATCH = 200;

/** Exécution par lots : insertions groupées ; si un lot échoue, repli ligne à ligne (les autres lignes passent). */
export async function execute(store: ImportStore, analysis: Analysis): Promise<{ created: number; updated: number; failedLines: RowIssue[] }> {
  const statusId = await store.initialStatusId();
  const failedLines: RowIssue[] = [];
  let created = 0, updated = 0;

  const toInsert = analysis.plan.filter((r) => r.action === "create" && r.lead);
  const toRow = (r: PlanRow): InsertRow => ({
    status_id: statusId, source_id: r.sourceId ?? null, call_domain_id: r.domainId ?? null, assigned_to: r.assignedTo ?? null,
    first_name: r.lead!.first_name, last_name: r.lead!.last_name, company: r.lead!.company, email: r.lead!.email, phone: r.lead!.phone,
    address: r.lead!.address, city: r.lead!.city, postal_code: r.lead!.postal_code, value: r.lead!.value, custom: r.lead!.custom,
  });
  const createdIds: string[] = [];
  const idByPlan = new Map<PlanRow, string>();
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    try {
      const ids = await store.insertLeads(chunk.map(toRow));
      chunk.forEach((r, k) => idByPlan.set(r, ids[k]!));
      createdIds.push(...ids);
      created += ids.length;
    } catch {
      for (const r of chunk) {
        try {
          const [id] = await store.insertLeads([toRow(r)]);
          idByPlan.set(r, id!);
          createdIds.push(id!);
          created++;
        } catch {
          failedLines.push({ line: r.line, column: "—", reason: "Enregistrement refusé par la base." });
        }
      }
    }
  }
  if (createdIds.length) await store.tagImportEvents(createdIds);

  for (const r of analysis.plan.filter((x) => x.action === "update" && x.lead)) {
    const id = r.existingId ?? (r.mergeInto !== undefined ? idByPlan.get(analysis.plan[r.mergeInto]!) : undefined);
    if (!id) { failedLines.push({ line: r.line, column: "—", reason: "Ligne d'origine non importée : fusion impossible." }); continue; }
    const l = r.lead!;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ first_name: l.first_name, last_name: l.last_name, company: l.company, email: l.email, phone: l.phone, address: l.address, city: l.city, postal_code: l.postal_code, value: l.value })) {
      if (v !== null && v !== "") patch[k] = v;
    }
    if (r.sourceId) patch.source_id = r.sourceId;
    if (r.domainId) patch.call_domain_id = r.domainId;
    try {
      await store.updateLead(id, patch, l.custom);
      updated++;
    } catch {
      failedLines.push({ line: r.line, column: "—", reason: "Mise à jour refusée par la base." });
    }
  }
  return { created, updated, failedLines };
}
