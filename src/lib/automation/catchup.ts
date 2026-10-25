import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { productionDeps } from "./store";
import { runActions } from "./engine";

const lastRun = new Map<string, number>();
const GRACE_MS = 60_000; // laisse le chemin normal (move_lead) terminer avant de rattraper
const WINDOW_MS = 24 * 3_600_000;

/**
 * Rattrapage : exécute les actions des changements de statut survenus hors RPC move_lead
 * (UPDATE REST direct). Idempotent (clé `événement:action`), limité à 24 h et 50 événements par passage.
 */
export async function runMissedActions(orgId: string, orgSlug: string, opts: { force?: boolean } = {}): Promise<number> {
  const now = Date.now();
  if (!opts.force && now - (lastRun.get(orgId) ?? 0) < 60_000) return 0;
  lastRun.set(orgId, now);
  const admin = createAdminClient();
  const { data: events } = await admin
    .from("lead_events")
    .select("id, lead_id, actor_id, payload, created_at")
    .eq("org_id", orgId)
    .eq("type", "status_changed")
    .gte("created_at", new Date(now - WINDOW_MS).toISOString())
    .lte("created_at", new Date(now - (opts.force ? 0 : GRACE_MS)).toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  let executed = 0;
  const deps = productionDeps();
  for (const ev of events ?? []) {
    const to = (ev.payload as { to?: string }).to;
    const from = (ev.payload as { from?: string }).from;
    if (!to || !from) continue;
    const { count } = await admin.from("action_runs").select("id", { count: "exact", head: true }).like("dedupe_key", `${ev.id}:%`);
    if ((count ?? 0) > 0) continue;
    const { data: actions } = await admin.from("status_actions").select("id, type, config, position").eq("status_id", to).eq("org_id", orgId).eq("enabled", true);
    if (!actions?.length) continue;
    const res = await runActions(
      { orgId, orgSlug, leadId: ev.lead_id, fromStatusId: from, toStatusId: to, eventId: ev.id, actorId: ev.actor_id },
      actions,
      deps,
    );
    executed += res.filter((r) => r.result !== "duplicate").length;
  }
  return executed;
}
