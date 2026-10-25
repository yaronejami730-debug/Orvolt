"use server";

import type { ActionResult } from "@/lib/action-guard";
import { dashboardCache, scopeKey } from "@/lib/dashboard/cache";
import { PeriodError, resolvePeriod } from "@/lib/dashboard/period";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { allow } from "@/lib/rate-limit-server";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";
import { dashParamsSchema } from "@/lib/validation/dashboard";

export interface Kpi {
  created: number; won: number; lost: number; won_value: number; cohort_won: number; cohort_lost: number; appts_planned: number; appts_done: number;
}
export interface KpiResult {
  current: Kpi;
  previous: Kpi;
  period: { from: string; to: string; prevFrom: string; prevTo: string; days: number; bucket: "day" | "week" };
}
export interface StatusRow { status_id: string; name: string; color: string; kind: string; position: number; n: number }
export interface TimeRow { bucket: string; created: number; won: number }
export interface SourceRow { source_id: string | null; name: string; n: number; won: number }
export interface UserRow { user_id: string | null; name: string; leads: number; appts_planned: number; appts_done: number; won: number; lost: number; won_value: number }

const num = (v: unknown) => Number(v ?? 0);

/** Contexte commun : permission dashboard.view, débit, période et filtres (le serveur borne l'utilisateur au périmètre autorisé). */
async function prepare(input: unknown) {
  const s = await requireSession();
  if (!sessionCan(s, "dashboard.view")) return { error: "Permission insuffisante." } as const;
  if (!(await allow("dashboard", s.user.id, { limit: 150, windowMs: 60_000 }))) return { error: RATE_LIMIT_MESSAGE } as const;
  // Entrée bornée avant analyse : objet plat de quelques clés (les champs inconnus sont ignorés par Zod, jamais utilisés en clé de cache).
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 12) return { error: "Paramètres invalides." } as const;
  const p = dashParamsSchema.safeParse(input);
  if (!p.success) return { error: "Paramètres invalides." } as const;
  let period;
  try {
    period = resolvePeriod({ preset: p.data.preset, from: p.data.from, to: p.data.to });
  } catch (e) {
    return { error: e instanceof PeriodError ? e.message : "Période invalide." } as const;
  }
  const all = sessionCan(s, "leads.view_all");
  // Hors managers : le filtre utilisateur est ignoré (la RLS ne montre de toute façon que leurs propres leads).
  const user = all ? (p.data.user ?? null) : null;
  const source = p.data.source ?? null;
  const supabase = await createClient();
  const scope = { org: s.org.id, user: s.user.id, scope: all ? ("all" as const) : ("own" as const) };
  // Clé de cache : uniquement les paramètres VALIDÉS et normalisés (jamais l'entrée brute).
  const norm = { from: period.fromDay, to: period.toDay, bucket: period.bucket, source, user };
  return { s, period, user, source, supabase, scope, all, norm } as const;
}

type Prep = Exclude<Awaited<ReturnType<typeof prepare>>, { error: string }>;
const args = (c: Prep, from: Date, to: Date) => ({ p_org: c.s.org.id, p_from: from.toISOString(), p_to: to.toISOString(), p_source: c.source, p_user: c.user });

export async function dashKpiAction(input: unknown): Promise<ActionResult<KpiResult>> {
  const c = await prepare(input);
  if ("error" in c) return { ok: false, error: c.error };
  try {
    const data = await dashboardCache.get(scopeKey(c.scope, "kpi", c.norm), async () => {
      const [cur, prev] = await Promise.all([
        c.supabase.rpc("kpi_summary", args(c, c.period.from, c.period.to)),
        c.supabase.rpc("kpi_summary", args(c, c.period.prevFrom, c.period.prevTo)),
      ]);
      if (cur.error || prev.error) throw new Error("rpc");
      const k = (r: Record<string, unknown>): Kpi => ({
        created: num(r.created), won: num(r.won), lost: num(r.lost), won_value: num(r.won_value), cohort_won: num(r.cohort_won),
        cohort_lost: num(r.cohort_lost), appts_planned: num(r.appts_planned), appts_done: num(r.appts_done),
      });
      return {
        current: k(cur.data as Record<string, unknown>), previous: k(prev.data as Record<string, unknown>),
        period: { from: c.period.from.toISOString(), to: c.period.to.toISOString(), prevFrom: c.period.prevFrom.toISOString(), prevTo: c.period.prevTo.toISOString(), days: c.period.days, bucket: c.period.bucket },
      } satisfies KpiResult;
    });
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Données indisponibles." };
  }
}

export async function dashStatusAction(input: unknown): Promise<ActionResult<{ rows: StatusRow[] }>> {
  const c = await prepare(input);
  if ("error" in c) return { ok: false, error: c.error };
  try {
    const rows = await dashboardCache.get(scopeKey(c.scope, "status", c.norm), async () => {
      const r = await c.supabase.rpc("leads_by_status", args(c, c.period.from, c.period.to));
      if (r.error) throw new Error("rpc");
      return (r.data as StatusRow[]).map((x) => ({ ...x, n: num(x.n) }));
    });
    return { ok: true, data: { rows } };
  } catch {
    return { ok: false, error: "Données indisponibles." };
  }
}

export async function dashTimeAction(input: unknown): Promise<ActionResult<{ rows: TimeRow[]; bucket: "day" | "week" }>> {
  const c = await prepare(input);
  if ("error" in c) return { ok: false, error: c.error };
  try {
    const rows = await dashboardCache.get(scopeKey(c.scope, "time", c.norm), async () => {
      const r = await c.supabase.rpc("leads_over_time", { ...args(c, c.period.from, c.period.to), p_bucket: c.period.bucket });
      if (r.error) throw new Error("rpc");
      return (r.data as TimeRow[]).map((x) => ({ bucket: x.bucket, created: num(x.created), won: num(x.won) }));
    });
    return { ok: true, data: { rows, bucket: c.period.bucket } };
  } catch {
    return { ok: false, error: "Données indisponibles." };
  }
}

export async function dashSourceAction(input: unknown): Promise<ActionResult<{ rows: SourceRow[] }>> {
  const c = await prepare(input);
  if ("error" in c) return { ok: false, error: c.error };
  try {
    const rows = await dashboardCache.get(scopeKey(c.scope, "source", c.norm), async () => {
      const r = await c.supabase.rpc("leads_by_source", args(c, c.period.from, c.period.to));
      if (r.error) throw new Error("rpc");
      return (r.data as SourceRow[]).map((x) => ({ ...x, n: num(x.n), won: num(x.won) }));
    });
    return { ok: true, data: { rows } };
  } catch {
    return { ok: false, error: "Données indisponibles." };
  }
}

/** Réservé aux managers (leads.view_all) : la base refuse les autres. */
export async function dashUsersAction(input: unknown): Promise<ActionResult<{ rows: UserRow[] }>> {
  const c = await prepare(input);
  if ("error" in c) return { ok: false, error: c.error };
  if (!c.all) return { ok: false, error: "Réservé aux managers." };
  try {
    const rows = await dashboardCache.get(scopeKey(c.scope, "users", { ...c.norm, user: null }), async () => {
      const r = await c.supabase.rpc("user_performance", { p_org: c.s.org.id, p_from: c.period.from.toISOString(), p_to: c.period.to.toISOString(), p_source: c.source });
      if (r.error) throw new Error("rpc");
      return (r.data as UserRow[]).map((x) => ({ ...x, leads: num(x.leads), appts_planned: num(x.appts_planned), appts_done: num(x.appts_done), won: num(x.won), lost: num(x.lost), won_value: num(x.won_value) }));
    });
    return { ok: true, data: { rows } };
  } catch {
    return { ok: false, error: "Données indisponibles." };
  }
}
