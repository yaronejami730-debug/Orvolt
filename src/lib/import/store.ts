import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingIndex, ImportStore } from "./engine";

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Accès base de l'import : service_role, strictement borné à l'organisation du job. */
export function supabaseImportStore(admin: SupabaseClient, orgId: string, userId: string, jobId: string): ImportStore {
  return {
    async initialStatusId() {
      const { data, error } = await admin.from("statuses").select("id").eq("org_id", orgId).eq("is_initial", true).single();
      if (error || !data) throw new Error("Aucun statut initial.");
      return data.id;
    },
    async sourcesByName() {
      const { data } = await admin.from("lead_sources").select("id, name").eq("org_id", orgId).eq("archived", false);
      return new Map((data ?? []).map((s) => [s.name.toLowerCase(), s.id]));
    },
    async validSourceId(id) {
      const { data } = await admin.from("lead_sources").select("id").eq("org_id", orgId).eq("id", id).eq("archived", false).maybeSingle();
      return !!data;
    },
    async activeMembers(roleId) {
      let q = admin.from("memberships").select("user_id").eq("org_id", orgId).eq("status", "active");
      if (roleId) q = q.eq("role_id", roleId);
      return ((await q).data ?? []).map((m) => m.user_id);
    },
    async lastAssigned(ids) {
      const out: Record<string, string | null> = Object.fromEntries(ids.map((i) => [i, null]));
      if (!ids.length) return out;
      const { data } = await admin.from("lead_events").select("payload, created_at").eq("org_id", orgId).eq("type", "assigned").in("payload->>to", ids).order("created_at", { ascending: false }).limit(500);
      for (const e of data ?? []) {
        const to = (e.payload as { to?: string }).to;
        if (to && out[to] === null) out[to] = e.created_at;
      }
      return out;
    },
    async findExisting(emails, phones): Promise<ExistingIndex> {
      const byEmail = new Map<string, string>(), byPhone = new Map<string, string>();
      for (const c of chunks(emails, 150)) {
        const { data } = await admin.from("leads").select("id, email_norm").eq("org_id", orgId).in("email_norm", c);
        for (const r of data ?? []) if (r.email_norm && !byEmail.has(r.email_norm)) byEmail.set(r.email_norm, r.id);
      }
      for (const c of chunks(phones, 150)) {
        const { data } = await admin.from("leads").select("id, phone_norm").eq("org_id", orgId).in("phone_norm", c);
        for (const r of data ?? []) if (r.phone_norm && !byPhone.has(r.phone_norm)) byPhone.set(r.phone_norm, r.id);
      }
      return { byEmail, byPhone };
    },
    async insertLeads(rows) {
      const { data, error } = await admin.from("leads").insert(rows.map((r) => ({ ...r, org_id: orgId, created_by: userId }))).select("id");
      if (error || !data || data.length !== rows.length) throw new Error(error?.message ?? "insert");
      return data.map((d) => d.id);
    },
    async updateLead(id, patch, custom) {
      let merged: Record<string, unknown> | undefined;
      if (Object.keys(custom).length) {
        const { data } = await admin.from("leads").select("custom").eq("id", id).eq("org_id", orgId).single();
        merged = { ...((data?.custom as Record<string, unknown>) ?? {}), ...custom };
      }
      const upd = { ...patch, ...(merged ? { custom: merged } : {}) };
      if (!Object.keys(upd).length) return;
      const { error } = await admin.from("leads").update(upd).eq("id", id).eq("org_id", orgId);
      if (error) throw new Error(error.message);
    },
    async tagImportEvents(leadIds) {
      // Tous les leads importés sont créés dans le statut initial : un seul UPDATE par lot.
      const { data: st } = await admin.from("statuses").select("id").eq("org_id", orgId).eq("is_initial", true).single();
      for (const c of chunks(leadIds, 200)) {
        await admin.from("lead_events").update({ payload: { status_id: st?.id, via: "import", import_job_id: jobId } }).eq("org_id", orgId).eq("type", "created").in("lead_id", c);
      }
    },
  };
}
