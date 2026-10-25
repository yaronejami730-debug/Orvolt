import "server-only";
import { createHash } from "node:crypto";
import { assessPoint } from "@/lib/geo/resolve";
import type { GeoPrecision } from "@/lib/geo/providers";
import { createClient } from "@/lib/supabase/server";
import { leadName } from "@/lib/leads/types";
import { planDispatch } from "./engine";
import { cacheLegs, configuredRouting, resolveMatrix } from "@/lib/routing/service";
import type { RoutingProvider } from "@/lib/routing/types";
import { configuredTraffic } from "./traffic-service";
import { overrideKey } from "./traffic";
import { DEFAULT_ORG, DEFAULT_WORK } from "./settings";
import { MAX_EXISTING, MAX_PENDING, MAX_UNAVAILABILITY, overLimit, type Truncated } from "./truncation";
import { DEFAULT_TRAFFIC } from "./traffic";
import { addDays, dayRange, localDay, localMinutes, parseTimeToMin, zonedToUtc } from "./time";
import { baseId, type DispatchRep, type DispatchRequest, type DispatchResult, type ExistingAppt, type LegLookup, type TrafficParams, type Unavailability } from "./types";

type SB = Awaited<ReturnType<typeof createClient>>;

export interface PendingRow {
  id: string;
  lead_id: string;
  lead_name: string;
  address: string | null;
  status: string;
  wishFrom: string;
  wishTo: string;
  durationMin: number;
  lat: number | null;
  lng: number | null;
  precision: GeoPrecision | null;
  accepted: boolean;
  /** RDV déjà réparti dont la position a été corrigée (à rééquilibrer) : emplacement actuel. */
  current?: { repId: string; day: string; startMin: number; endMin: number };
}
export interface ToCheck {
  id: string;
  lead_id: string;
  lead_name: string;
  address: string | null;
  code: "no_position" | "approximate" | "off_road" | "unroutable";
  reason: string;
  lat: number | null;
  lng: number | null;
  precision: GeoPrecision | null;
}
export interface RepRow extends DispatchRep {
  baseAddress: string;
  workDaysLabel: string;
}
export interface DispatchContext {
  orgSettings: { maxLegKm: number; horizonDays: number; maxLegMin: number; maxBaseMin: number; targetPerDay: number; comfortMax: number; absoluteMax: number; maxExtraMin: number } & TrafficParams;
  reps: RepRow[];
  pending: PendingRow[];
  days: string[];
  existing: ExistingAppt[];
  unavailability: Unavailability[];
  /** RDV répartis non verrouillés dont la position a été corrigée. */
  flagged: PendingRow[];
  /** RDV à attribuer dont la position vient d'être corrigée (bandeau « relancer la répartition »). */
  fixedPending: number;
  /** Limites de chargement atteintes (jamais silencieuses) : nombre total en base quand il dépasse ce qui est pris en compte. */
  truncated: Truncated;
  /** Vue simulation : lignes is_simulation uniquement (+ RDV réels des commerciaux comme contraintes) ; sinon jamais de simulation. */
  simulation: boolean;
}
export interface RoutingInfo {
  label: string;
  estimated: boolean;
  fellBack: boolean;
  kind: RoutingProvider["kind"];
  /** Fournisseur de trafic externe réellement utilisé (sinon null : estimation selon l'heure). */
  trafficLabel: string | null;
}
export interface PlanBundle {
  ctx: DispatchContext;
  rows: PendingRow[];
  requests: DispatchRequest[];
  result: DispatchResult;
  planHash: string;
  /** RDV confirmés non répartissables en l'état : position absente, approximative, hors route… (jamais ignorés en silence). */
  toCheck: ToCheck[];
  routing: RoutingInfo;
  /** Trajets utilisés (pour le cache lu par apply_dispatch). */
  usedLegs: { a: { lat: number; lng: number }; b: { lat: number; lng: number }; durationS: number; distanceM: number }[];
  provider: RoutingProvider;
}

export async function loadContext(supabase: SB, orgId: string, opts: { simulation?: boolean } = {}): Promise<DispatchContext> {
  const sim = opts.simulation === true;
  const [{ data: st }, { data: zones }, { data: raw, count: pendingTotal }] = await Promise.all([
    supabase.from("dispatch_settings").select("max_leg_km, horizon_days, max_leg_min, max_base_min, traffic_morning_coef, traffic_evening_coef, safety_margin_pct, target_per_day, comfort_max, absolute_max, max_extra_minutes").eq("org_id", orgId).maybeSingle(),
    supabase.from("sales_zones").select("user_id, base_address, base_lat, base_lng, radius_km, active, work_start, work_end, target_per_day, comfort_max, absolute_max, work_days, default_duration_min, travel_min_per_km, travel_margin_min").eq("org_id", orgId).eq("active", true),
    supabase.from("appointments").select("id, lead_id, status, location_address, lat, lng, geo_precision, geo_accepted, wish_from, wish_to, duration_min, lead:leads(first_name, last_name, company, address, city, postal_code)", { count: "exact" }).eq("org_id", orgId).eq("is_simulation", sim).eq("dispatch_status", "unassigned").in("status", ["planned", "confirmed"]).order("wish_from").order("created_at").limit(MAX_PENDING),
  ]);
  const orgSettings = {
    maxLegKm: Number(st?.max_leg_km ?? DEFAULT_ORG.maxLegKm), horizonDays: st?.horizon_days ?? DEFAULT_ORG.horizonDays,
    maxLegMin: st?.max_leg_min ?? DEFAULT_ORG.maxLegMin, maxBaseMin: st?.max_base_min ?? DEFAULT_ORG.maxBaseMin,
    morningCoef: Number(st?.traffic_morning_coef ?? DEFAULT_TRAFFIC.morningCoef), eveningCoef: Number(st?.traffic_evening_coef ?? DEFAULT_TRAFFIC.eveningCoef),
    safetyPct: st?.safety_margin_pct ?? DEFAULT_TRAFFIC.safetyPct,
    targetPerDay: st?.target_per_day ?? DEFAULT_ORG.targetPerDay, comfortMax: st?.comfort_max ?? DEFAULT_ORG.comfortMax,
    absoluteMax: st?.absolute_max ?? DEFAULT_ORG.absoluteMax, maxExtraMin: st?.max_extra_minutes ?? DEFAULT_ORG.maxExtraMin,
  };
  const memberIds = (zones ?? []).map((z) => z.user_id);
  const [{ data: members }, { data: profiles }] = await Promise.all([
    memberIds.length ? supabase.from("memberships").select("user_id").eq("org_id", orgId).eq("status", "active").in("user_id", memberIds) : Promise.resolve({ data: [] as { user_id: string }[] }),
    memberIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", memberIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
  ]);
  const active = new Set((members ?? []).map((m) => m.user_id));
  const name = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "—"]));
  const reps: RepRow[] = (zones ?? []).filter((z) => active.has(z.user_id)).map((z) => ({
    id: z.user_id, name: name.get(z.user_id) ?? "—", base: { lat: z.base_lat, lng: z.base_lng }, radiusKm: Number(z.radius_km),
    workStartMin: parseTimeToMin(z.work_start), workEndMin: parseTimeToMin(z.work_end), targetPerDay: z.target_per_day ?? orgSettings.targetPerDay, comfortMax: Math.max(z.target_per_day ?? orgSettings.targetPerDay, z.comfort_max ?? orgSettings.comfortMax),
    absoluteMax: Math.max(z.comfort_max ?? orgSettings.comfortMax, z.absolute_max ?? orgSettings.absoluteMax),
    workDays: (z.work_days as number[]) ?? DEFAULT_WORK.workDays, travelMinPerKm: Number(z.travel_min_per_km), travelMarginMin: z.travel_margin_min,
    baseAddress: z.base_address, workDaysLabel: "",
  })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const today = localDay(new Date());
  const days = dayRange(addDays(today, 1), orgSettings.horizonDays);

  type Raw = { id: string; lead_id: string; status: string; location_address: string | null; lat: number | null; lng: number | null; geo_precision: GeoPrecision | null; geo_accepted: boolean; wish_from: string | null; wish_to: string | null; duration_min: number | null; lead: { first_name: string; last_name: string; company: string | null; address: string | null; city: string | null; postal_code: string | null } | null };
  const pending: PendingRow[] = ((raw ?? []) as unknown as Raw[]).map((r) => {
    const l = r.lead;
    const fallback = l ? [l.address, l.postal_code, l.city].filter(Boolean).join(" ") : "";
    return {
      id: r.id, lead_id: r.lead_id, lead_name: l ? leadName(l) : "Lead", status: r.status, address: r.location_address ?? (fallback || null),
      wishFrom: r.wish_from ?? days[0]!, wishTo: r.wish_to ?? r.wish_from ?? days[0]!, durationMin: r.duration_min ?? DEFAULT_WORK.durationMin,
      lat: r.lat, lng: r.lng, precision: r.geo_precision, accepted: r.geo_accepted,
    };
  });

  // RDV déjà attribués des commerciaux sur l'horizon (pour éviter chevauchements et respecter le max par jour).
  let existing: ExistingAppt[] = [];
  let existingTotal: number | null = null;
  if (reps.length && days.length) {
    const from = zonedToUtc(days[0]!, 0).toISOString();
    const to = zonedToUtc(addDays(days[days.length - 1]!, 1), 0).toISOString();
    // Vue réelle : les RDV de simulation ne comptent pas ; vue simulation : RDV réels + simulés (même règle que apply_dispatch).
    let exq = supabase.from("appointments").select("id, assigned_to, starts_at, ends_at, lat, lng, lead:leads(first_name, last_name, company)", { count: "exact" })
      .eq("org_id", orgId).eq("dispatch_status", "assigned").neq("status", "cancelled").in("assigned_to", reps.map((r) => r.id)).gte("starts_at", from).lt("starts_at", to);
    if (!sim) exq = exq.eq("is_simulation", false);
    const { data: ex, count: exCount } = await exq.limit(MAX_EXISTING);
    existingTotal = overLimit(exCount, MAX_EXISTING);
    existing = ((ex ?? []) as unknown as { id: string; assigned_to: string; starts_at: string; ends_at: string; lat: number | null; lng: number | null; lead: { first_name: string; last_name: string; company: string | null } | null }[]).map((e) => {
      const s = new Date(e.starts_at);
      const en = new Date(e.ends_at);
      return { id: e.id, repId: e.assigned_to, day: localDay(s), startMin: localMinutes(s), endMin: localDay(en) === localDay(s) ? localMinutes(en) : 24 * 60, lat: e.lat, lng: e.lng, label: e.lead ? leadName(e.lead) : "RDV" };
    });
  }
  let unavailability: Unavailability[] = [];
  let unavailTotal: number | null = null;
  if (reps.length && days.length) {
    const { data: un, count: unCount } = await supabase.from("sales_unavailability").select("user_id, day, start_min, end_min", { count: "exact" }).eq("org_id", orgId).gte("day", days[0]!).lte("day", days[days.length - 1]!).limit(MAX_UNAVAILABILITY);
    unavailTotal = overLimit(unCount, MAX_UNAVAILABILITY);
    unavailability = (un ?? []).map((u) => ({ repId: u.user_id, day: u.day, startMin: u.start_min, endMin: u.end_min }));
  }
  const { data: fl } = await supabase.from("appointments").select("id, lead_id, status, location_address, lat, lng, geo_precision, geo_accepted, wish_from, wish_to, starts_at, ends_at, assigned_to, lead:leads(first_name, last_name, company)")
    .eq("org_id", orgId).eq("is_simulation", sim).eq("dispatch_status", "assigned").eq("needs_rebalance", true).eq("locked_by_dispatcher", false).in("status", ["planned", "confirmed"]).gte("starts_at", new Date().toISOString()).limit(100);
  const flagged: PendingRow[] = ((fl ?? []) as unknown as { id: string; lead_id: string; status: string; location_address: string | null; lat: number | null; lng: number | null; geo_precision: GeoPrecision | null; geo_accepted: boolean; wish_from: string | null; wish_to: string | null; starts_at: string; ends_at: string; assigned_to: string; lead: { first_name: string; last_name: string; company: string | null } | null }[]).map((r) => {
    const st = new Date(r.starts_at);
    const en = new Date(r.ends_at);
    const day = localDay(st);
    const from = day > days[0]! ? (day < (days[days.length - 1] ?? day) ? day : days[days.length - 1]!) : days[0]!;
    return {
      id: r.id, lead_id: r.lead_id, lead_name: r.lead ? leadName(r.lead) : "Lead", address: r.location_address, status: "confirmed",
      wishFrom: from, wishTo: addDays(from, 4), durationMin: Math.max(15, Math.round((en.getTime() - st.getTime()) / 60000)),
      lat: r.lat, lng: r.lng, precision: r.geo_precision, accepted: r.geo_accepted,
      current: { repId: r.assigned_to, day, startMin: localMinutes(st), endMin: localMinutes(en) },
    };
  });
  const { count: fixedPending } = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("is_simulation", sim).eq("dispatch_status", "unassigned").eq("status", "confirmed").not("geo_fixed_at", "is", null);
  const truncated = { pending: overLimit(pendingTotal, MAX_PENDING), existing: existingTotal, unavailability: unavailTotal };
  return { orgSettings, reps, pending, days, existing, unavailability, flagged, fixedPending: fixedPending ?? 0, truncated, simulation: sim };
}

/** Sépare les RDV confirmés répartissables de ceux « à vérifier » (raison en français). */
export async function classifyPending(ctx: DispatchContext, rows: PendingRow[] = ctx.pending): Promise<{ requests: DispatchRequest[]; toCheck: ToCheck[] }> {
  const confirmed = rows.filter((p) => p.status === "confirmed");
  // Les points GPS sont fixés à la saisie : le moteur ne géocode plus. On contrôle chaque position (snap routier compris).
  const provider0 = configuredRouting();
  const snaps = new Map<string, number | "unroutable" | null>();
  for (let i = 0; i < confirmed.length; i += 10) {
    await Promise.all(confirmed.slice(i, i + 10).map(async (p) => {
      if (p.lat !== null && p.lng !== null && provider0.snap) snaps.set(p.id, await provider0.snap({ lat: p.lat, lng: p.lng }));
    }));
  }
  const requests: DispatchRequest[] = [];
  const toCheck: ToCheck[] = [];
  for (const p of confirmed) {
    const chk = assessPoint({ lat: p.lat, lng: p.lng, precision: p.precision, accepted: p.accepted, snapM: snaps.get(p.id) ?? null });
    if (!chk.ok) {
      toCheck.push({ id: p.id, lead_id: p.lead_id, lead_name: p.lead_name, address: p.address, code: chk.code, reason: chk.reason, lat: p.lat, lng: p.lng, precision: p.precision });
      continue;
    }
    // Position approximative acceptée : marge de durée plus grande (+20 min).
    requests.push({ id: p.id, label: chk.approximate ? `${p.lead_name} (position approximative)` : p.lead_name, lat: p.lat, lng: p.lng, durationMin: p.durationMin + (chk.approximate ? 20 : 0), wishFrom: p.wishFrom, wishTo: p.wishTo });
  }
  return { requests, toCheck };
}

/** Calcule la proposition (géocodage via le cache src/lib/geo ; itinéraires routiers réels ; aucune écriture sur les RDV). */
export async function buildPlan(supabase: SB, orgId: string, opts: { rebalance?: boolean; simulation?: boolean } = {}): Promise<PlanBundle> {
  const ctx = await loadContext(supabase, orgId, { simulation: opts.simulation });
  const rows = opts.rebalance ? [...ctx.pending, ...ctx.flagged] : ctx.pending;
  // Rééquilibrage : les RDV corrigés sont re-planifiés ; tous les autres (dont les verrouillés) restent des points fixes.
  if (opts.rebalance) ctx.existing = ctx.existing.filter((e) => !ctx.flagged.some((f) => f.id === e.id));
  const { requests, toCheck } = await classifyPending(ctx, rows);

  // Matrice routière entre toutes les positions utiles.
  const ids: string[] = [];
  const pts: { lat: number; lng: number }[] = [];
  const add = (id: string, lat: number | null, lng: number | null) => { if (lat !== null && lng !== null) { ids.push(id); pts.push({ lat, lng }); } };
  for (const r of ctx.reps) add(baseId(r.id), r.base.lat, r.base.lng);
  for (const q of requests) add(q.id, q.lat, q.lng);
  for (const e of ctx.existing) add(e.id, e.lat, e.lng);
  const { matrix, provider, fellBack } = await resolveMatrix(pts);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const leg: LegLookup = (a, b) => {
    const i = idx.get(a);
    const k = idx.get(b);
    if (i === undefined || k === undefined || a === b) return { durationS: 0, distanceM: 0 };
    return { durationS: matrix.durations[i]![k]!, distanceM: matrix.distances[i]![k]! };
  };
  const o = ctx.orgSettings;
  const base = { reps: ctx.reps, requests, existing: ctx.existing, days: ctx.days, maxLegKm: o.maxLegKm, maxLegMin: o.maxLegMin, maxBaseMin: o.maxBaseMin, maxExtraMin: o.maxExtraMin, leg, traffic: { morningCoef: o.morningCoef, eveningCoef: o.eveningCoef, safetyPct: o.safetyPct }, unavailability: ctx.unavailability };
  let result = planDispatch(base);

  // Trafic externe optionnel (TomTom / Mapbox) : uniquement pour les trajets des tournées proposées ; repli silencieux sur l'estimation horaire.
  let trafficLabel: string | null = null;
  const tp = provider.estimated ? null : configuredTraffic();
  if (tp && result.stats.length) {
    const overrides: Record<string, number> = {};
    const coord = (id: string) => (idx.has(id) ? pts[idx.get(id)!]! : null);
    const calls: Promise<void>[] = [];
    for (const st of result.stats) {
      let from = baseId(st.repId);
      let depart = ctx.reps.find((r) => r.id === st.repId)!.workStartMin;
      for (const s of st.stops) {
        const a = coord(from);
        const b = coord(s.id);
        if (a && b && s.lat !== null) {
          const dep = depart;
          const day = st.day;
          const fromId = from;
          calls.push((async () => {
            const sec = await tp.duration({ from: a, to: b, departAt: zonedToUtc(day, dep).toISOString() });
            if (sec !== null) overrides[overrideKey(fromId, s.id, day, dep)] = sec / 60;
          })());
        }
        if (s.lat !== null) from = s.id;
        depart = s.endMin;
      }
    }
    await Promise.all(calls);
    if (Object.keys(overrides).length > 0) { trafficLabel = tp.label; result = planDispatch({ ...base, trafficOverrides: overrides }); }
  }

  // Trajets à mémoriser : toutes les paires ordonnées d'une tournée + base -> chaque arrêt.
  const usedLegs: PlanBundle["usedLegs"] = [];
  const routesToCache = new Map<string, { repId: string; ids: string[] }>();
  for (const st of result.stats) routesToCache.set(`${st.repId}|${st.day}`, { repId: st.repId, ids: st.stops.map((s) => s.id) });
  for (const pr of result.proposed) { // RDV proposés au-delà du confort : leurs trajets doivent aussi être connus de la base si le confirmateur les approuve
    const k = `${pr.repId}|${pr.day}`;
    const cur = routesToCache.get(k) ?? { repId: pr.repId, ids: ctx.existing.filter((e) => e.repId === pr.repId && e.day === pr.day).map((e) => e.id) };
    cur.ids.push(pr.requestId);
    routesToCache.set(k, cur);
  }
  for (const { repId, ids: stopIds } of routesToCache.values()) {
    const seq = [baseId(repId), ...stopIds].filter((id) => idx.has(id));
    for (const a of seq) for (const b of seq) {
      if (a === b) continue;
      const l = leg(a, b);
      usedLegs.push({ a: pts[idx.get(a)!]!, b: pts[idx.get(b)!]!, durationS: l.durationS, distanceM: l.distanceM });
    }
  }
  const planHash = createHash("sha256").update(JSON.stringify([result.assignments, result.proposed].map((l) => l.map((a) => [a.requestId, a.repId, a.day, a.startMin, a.endMin])))).digest("hex").slice(0, 32);
  return {
    ctx, rows, requests, result, planHash, toCheck, usedLegs, provider,
    routing: { label: provider.label, estimated: provider.estimated, fellBack, kind: provider.kind, trafficLabel },
  };
}

export { cacheLegs };
export { truncationWarnings } from "./truncation";
