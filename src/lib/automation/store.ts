import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeFetch } from "@/lib/net/safe-fetch";
import { orgWebhookSecret, requireSigningSalt } from "./signature";
import { runActions, type AutomationStore, type Deps, type LeadSnapshot, type RunContext, type StoredAction } from "./engine";

export function createSupabaseStore(admin: SupabaseClient): AutomationStore {
  return {
    async claim(key, run) {
      const { error } = await admin.from("action_runs").insert({
        org_id: run.orgId, status_id: run.statusId, lead_id: run.leadId, action_id: run.actionId, type: run.type, dedupe_key: key,
      });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(error.message);
    },
    async finish(key, result, error, attempts) {
      await admin.from("action_runs").update({ result, error, attempts, finished_at: new Date().toISOString() }).eq("dedupe_key", key);
    },
    async getLead(leadId, orgId) {
      const { data } = await admin
        .from("leads")
        .select("id, org_id, status_id, assigned_to, first_name, last_name, email, phone, value")
        .eq("id", leadId)
        .eq("org_id", orgId)
        .maybeSingle();
      return (data as LeadSnapshot | null) ?? null;
    },
    async statusName(statusId) {
      const { data } = await admin.from("statuses").select("name").eq("id", statusId).maybeSingle();
      return data?.name ?? "";
    },
    async activeMembers(orgId, roleId) {
      let q = admin.from("memberships").select("user_id").eq("org_id", orgId).eq("status", "active");
      if (roleId) q = q.eq("role_id", roleId);
      const { data } = await q;
      return (data ?? []).map((m) => m.user_id);
    },
    async lastAssigned(orgId, userIds) {
      const out: Record<string, string | null> = Object.fromEntries(userIds.map((u) => [u, null]));
      if (userIds.length === 0) return out;
      const { data } = await admin
        .from("lead_events")
        .select("payload, created_at")
        .eq("org_id", orgId)
        .eq("type", "assigned")
        .in("payload->>to", userIds)
        .order("created_at", { ascending: false })
        .limit(500);
      for (const e of data ?? []) {
        const to = (e.payload as { to?: string }).to;
        if (to && out[to] === null) out[to] = e.created_at;
      }
      return out;
    },
    async setAssignee(orgId, leadId, userId) {
      const { error } = await admin.from("leads").update({ assigned_to: userId }).eq("id", leadId).eq("org_id", orgId);
      if (error) throw new Error(error.message);
    },
    async addNotification(n) {
      const { error } = await admin.from("notifications").insert({ org_id: n.orgId, user_id: n.userId, type: n.type, payload: n.payload, dedupe_key: n.dedupeKey });
      if (error && error.code !== "23505") throw new Error(error.message);
    },
    async secretVersion(orgId) {
      const { data } = await admin.from("organizations").select("webhook_secret_version").eq("id", orgId).maybeSingle();
      return data?.webhook_secret_version ?? 1;
    },
    async webhookRunsSince(orgId, sinceIso) {
      const { count } = await admin.from("action_runs").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("type", "webhook").gte("created_at", sinceIso);
      return count ?? 0;
    },
    async addTask(t) {
      const { error } = await admin.from("tasks").insert({
        org_id: t.orgId, lead_id: t.leadId, assigned_to: t.assignedTo, title: t.title, due_at: t.dueAt, dedupe_key: t.dedupeKey, created_by: null,
      });
      if (error && error.code !== "23505") throw new Error(error.message);
    },
  };
}

/** Dépendances de production : store service_role, safeFetch (anti-SSRF, IP épinglée), secret dérivé du sel. */
export function productionDeps(): Deps {
  return {
    store: createSupabaseStore(createAdminClient()),
    fetch: (url, o) => safeFetch(url, { method: o.method, headers: o.headers, body: o.body, timeoutMs: o.timeoutMs }),
    secret: (orgId, version = 1) => orgWebhookSecret(requireSigningSalt(), orgId, version),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.info(m),
  };
}

export async function runStatusActions(ctx: RunContext, actions: StoredAction[]) {
  return runActions(ctx, actions, productionDeps());
}
