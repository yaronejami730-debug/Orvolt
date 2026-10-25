import { UnsafeUrlError } from "@/lib/net/safe-fetch";
import { actionInputSchema } from "@/lib/validation/workflow";
import { signatureHeader } from "./signature";
import { pickRoundRobin } from "./round-robin";

export interface LeadSnapshot {
  id: string;
  org_id: string;
  status_id: string;
  assigned_to: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  value: number | null;
}
export interface RunContext {
  orgId: string;
  orgSlug: string;
  leadId: string;
  fromStatusId: string;
  toStatusId: string;
  eventId: string;
  actorId: string | null;
}
export interface StoredAction {
  id: string;
  type: string;
  config: unknown;
  position: number;
}
export interface AutomationStore {
  /** Réserve l'exécution (idempotence) : false si déjà prise. */
  claim(key: string, run: { orgId: string; statusId: string; leadId: string; actionId: string; type: string }): Promise<boolean>;
  finish(key: string, result: "success" | "failed" | "skipped", error: string | null, attempts: number): Promise<void>;
  getLead(leadId: string, orgId: string): Promise<LeadSnapshot | null>;
  statusName(statusId: string): Promise<string>;
  /** Membres actifs de l'org (filtrés par rôle si fourni). */
  activeMembers(orgId: string, roleId?: string): Promise<string[]>;
  lastAssigned(orgId: string, userIds: string[]): Promise<Record<string, string | null>>;
  setAssignee(orgId: string, leadId: string, userId: string): Promise<void>;
  addNotification(n: { orgId: string; userId: string; type: string; payload: Record<string, unknown>; dedupeKey: string }): Promise<void>;
  /** Version du secret de signature de l'organisation (régénérable). */
  secretVersion(orgId: string): Promise<number>;
  /** Nombre d'exécutions webhook de l'org créées depuis `sinceIso` (quota d'egress). */
  webhookRunsSince(orgId: string, sinceIso: string): Promise<number>;
  addTask(t: { orgId: string; leadId: string; assignedTo: string | null; title: string; dueAt: string; dedupeKey: string }): Promise<void>;
}
export interface Deps {
  store: AutomationStore;
  fetch: (url: string, opts: { method: "POST"; headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<{ status: number }>;
  secret: (orgId: string, version?: number) => string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
}
export interface RunSummary {
  actionId: string;
  type: string;
  result: "success" | "failed" | "skipped" | "duplicate";
  error?: string;
}

export const WEBHOOK_MAX_ATTEMPTS = 3;
export const WEBHOOK_TIMEOUT_MS = 5000;
/** Plafond d'egress : exécutions de webhook par organisation et par minute. */
export const WEBHOOK_PER_MINUTE = 30;

class Skip extends Error {}

function leadName(l: LeadSnapshot): string {
  return `${l.first_name} ${l.last_name}`.trim() || "Lead";
}

/**
 * Exécute les actions automatiques d'un statut après un déplacement.
 * Chaque action est indépendante : un échec n'interrompt ni les suivantes ni le déplacement (déjà fait).
 * Idempotent : la clé `${eventId}:${actionId}` n'est exécutée qu'une fois.
 */
export async function runActions(ctx: RunContext, actions: StoredAction[], deps: Deps): Promise<RunSummary[]> {
  const out: RunSummary[] = [];
  const lead0 = await deps.store.getLead(ctx.leadId, ctx.orgId);
  if (!lead0) return out;

  for (const a of [...actions].sort((x, y) => x.position - y.position)) {
    const key = `${ctx.eventId}:${a.id}`;
    const claimed = await deps.store.claim(key, { orgId: ctx.orgId, statusId: ctx.toStatusId, leadId: ctx.leadId, actionId: a.id, type: a.type });
    if (!claimed) {
      out.push({ actionId: a.id, type: a.type, result: "duplicate" });
      continue;
    }
    let attempts = 1;
    try {
      // Jamais de confiance au jsonb stocké : revalidation complète.
      const parsed = actionInputSchema.safeParse({ type: a.type, enabled: true, config: a.config });
      if (!parsed.success) throw new Error(`Configuration invalide : ${parsed.error.issues[0]?.message ?? ""}`);
      const lead = (await deps.store.getLead(ctx.leadId, ctx.orgId)) ?? lead0; // état courant (assignation précédente)
      const action = parsed.data;

      if (action.type === "assign") {
        const c = action.config;
        let userId: string | null = null;
        if (c.mode === "user") {
          const members = await deps.store.activeMembers(ctx.orgId);
          userId = c.userId && members.includes(c.userId) ? c.userId : null;
        } else {
          const candidates = await deps.store.activeMembers(ctx.orgId, c.roleId);
          userId = pickRoundRobin(candidates, await deps.store.lastAssigned(ctx.orgId, candidates));
        }
        if (!userId) throw new Skip("Aucun membre actif à assigner.");
        await deps.store.setAssignee(ctx.orgId, ctx.leadId, userId);
      } else if (action.type === "notify") {
        const c = action.config;
        let targets: string[] = [];
        if (c.recipient === "assignee") targets = lead.assigned_to ? [lead.assigned_to] : [];
        else if (c.recipient === "role") targets = await deps.store.activeMembers(ctx.orgId, c.roleId);
        else if (c.userId) targets = (await deps.store.activeMembers(ctx.orgId)).filter((id) => id === c.userId);
        if (targets.length === 0) throw new Skip("Aucun destinataire actif.");
        const statusName = await deps.store.statusName(ctx.toStatusId);
        for (const userId of targets) {
          await deps.store.addNotification({
            orgId: ctx.orgId,
            userId,
            type: "automation",
            payload: { lead_id: ctx.leadId, lead_name: leadName(lead), status: statusName, message: c.message },
            dedupeKey: `${key}:${userId}`,
          });
          deps.log(`[email-log] to=${userId} subject="${c.message}" lead=${ctx.leadId}`);
        }
      } else if (action.type === "create_task") {
        const c = action.config;
        const ms = c.delay * (c.unit === "hours" ? 3_600_000 : 86_400_000);
        const assignedTo = c.assignee === "user" ? (c.userId ?? null) : (lead.assigned_to ?? ctx.actorId);
        await deps.store.addTask({
          orgId: ctx.orgId,
          leadId: ctx.leadId,
          assignedTo,
          title: c.title,
          dueAt: new Date(deps.now().getTime() + ms).toISOString(),
          dedupeKey: key,
        });
      } else {
        const c = action.config;
        const recent = await deps.store.webhookRunsSince(ctx.orgId, new Date(deps.now().getTime() - 60_000).toISOString());
        if (recent > WEBHOOK_PER_MINUTE) throw new Error(`Quota de webhooks dépassé (${WEBHOOK_PER_MINUTE}/min) : appel non effectué.`);
        const secret = deps.secret(ctx.orgId, await deps.store.secretVersion(ctx.orgId));
        const [fromName, toName] = await Promise.all([deps.store.statusName(ctx.fromStatusId), deps.store.statusName(ctx.toStatusId)]);
        const body = JSON.stringify({
          version: 1,
          event: "lead.status_changed",
          id: key,
          occurred_at: deps.now().toISOString(),
          org: { id: ctx.orgId, slug: ctx.orgSlug },
          lead: { id: lead.id, first_name: lead.first_name, last_name: lead.last_name, email: lead.email, phone: lead.phone, value: lead.value, assigned_to: lead.assigned_to },
          from_status: { id: ctx.fromStatusId, name: fromName },
          to_status: { id: ctx.toStatusId, name: toName },
        });
        let lastError = "";
        let delivered = false;
        for (attempts = 1; attempts <= WEBHOOK_MAX_ATTEMPTS; attempts++) {
          const ts = Math.floor(deps.now().getTime() / 1000);
          try {
            const res = await deps.fetch(c.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "user-agent": "LeadForge-Webhook/1",
                "x-leadforge-event": "lead.status_changed",
                "x-leadforge-delivery": key,
                "x-leadforge-signature": signatureHeader(secret, ts, body),
              },
              body,
              timeoutMs: WEBHOOK_TIMEOUT_MS,
            });
            if (res.status < 400) {
              delivered = true;
              break;
            }
            lastError = `HTTP ${res.status}`;
            if (res.status < 500 && res.status !== 429) break; // erreur client : inutile de réessayer
          } catch (e) {
            lastError = e instanceof Error ? e.message : "erreur réseau";
            if (e instanceof UnsafeUrlError) break;
          }
          if (attempts < WEBHOOK_MAX_ATTEMPTS) await deps.sleep(200 * 2 ** (attempts - 1));
        }
        attempts = Math.min(attempts, WEBHOOK_MAX_ATTEMPTS);
        if (!delivered) throw new Error(`Webhook en échec (${lastError}).`);
      }
      await deps.store.finish(key, "success", null, attempts);
      out.push({ actionId: a.id, type: a.type, result: "success" });
    } catch (e) {
      if (e instanceof Skip) {
        await deps.store.finish(key, "skipped", e.message, attempts);
        out.push({ actionId: a.id, type: a.type, result: "skipped", error: e.message });
      } else {
        const msg = (e instanceof Error ? e.message : "Erreur inconnue").slice(0, 500);
        await deps.store.finish(key, "failed", msg, attempts).catch(() => undefined);
        out.push({ actionId: a.id, type: a.type, result: "failed", error: msg });
      }
    }
  }
  return out;
}
