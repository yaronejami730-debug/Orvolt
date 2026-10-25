import { haversineKm } from "@/lib/geo/haversine";
import { isFrenchHoliday } from "./holidays";
import { fmtMin, isoWeekday } from "./time";
import { overrideKey, peakCoef, trafficMinutes } from "./traffic";
import {
  baseId,
  type Assignment, type DispatchInput, type DispatchRep, type DispatchRequest, type DispatchResult, type LatLng, type RouteStat, type RouteStop, type Unassigned,
} from "./types";

/** Pas de planification des heures de début (minutes). */
const GRID = 5;
/** Pénalités (équivalent minutes de route) : remplir les journées déjà ouvertes avant d'en ouvrir une, équilibrer la charge. */
const OPEN_DAY_PENALTY = 60;
const LOAD_PENALTY = 6;
const DAY_INDEX_PENALTY = 0.5;
const MAX_PERMUTE = 7;

const ceilGrid = (m: number) => Math.ceil(m / GRID) * GRID;
const round1 = (n: number) => Math.round(n * 10) / 10;

interface Stop {
  kind: "new" | "existing";
  id: string;
  label: string;
  start: number;
  end: number;
  at: LatLng | null;
}

const pt = (r: { lat: number | null; lng: number | null }): LatLng | null => (r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null);

/**
 * Répartition automatique (pure, déterministe, sans réseau) sur itinéraires routiers réels.
 * - Zone : rayon à vol d'oiseau (pré-filtre) puis temps de route réel depuis la base <= maxBaseMin.
 * - Trajets : durée de conduite réelle (matrice routière) x coefficient de pointe x marge de sécurité, + marge fixe du commercial ;
 *   un trajet de plus de maxLegMin minutes ou maxLegKm km entre deux RDV est refusé.
 * - Insertion gloutonne (demandes les plus contraintes d'abord) minimisant le temps de route ajouté, puis ordre optimal des tournées
 *   sans RDV existant (permutations exactes jusqu'à 7 arrêts).
 * - Respecte jours/horaires/max par jour, indisponibilités et RDV existants (dont ceux verrouillés par le confirmateur).
 */
export function planDispatch(input: DispatchInput): DispatchResult {
  const reps = [...input.reps].sort((a, b) => a.id.localeCompare(b.id));
  const days = [...new Set(input.days)].sort();
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  const repById = new Map(reps.map((r) => [r.id, r]));
  const { leg, traffic } = input;
  const over = input.trafficOverrides ?? {};

  const unav = new Map<string, { startMin: number; endMin: number }[]>(); // clé rep|jour ; journée entière => [0,1440]
  for (const u of input.unavailability ?? []) {
    const k = `${u.repId}|${u.day}`;
    const l = unav.get(k) ?? [];
    l.push({ startMin: u.startMin ?? 0, endMin: u.endMin ?? 1440 });
    unav.set(k, l);
  }

  /** Minutes planifiées d'un trajet partant à `depart` (hors marge fixe) : max(coefficient horaire, service de trafic) x marge de sécurité. */
  const driveMin = (from: string, to: string, day: string, depart: number): number => {
    const l = leg(from, to);
    const est = trafficMinutes(l.durationS, day, depart, traffic);
    const ext = over[overrideKey(from, to, day, depart)];
    return ext !== undefined ? Math.max(est, Math.ceil(ext * (1 + traffic.safetyPct / 100))) : est;
  };
  const baseMin = (from: string, to: string) => leg(from, to).durationS / 60;
  const kmRoad = (from: string, to: string) => leg(from, to).distanceM / 1000;

  const routes = new Map<string, Stop[]>();
  const key = (repId: string, day: string) => `${repId}|${day}`;
  for (const e of [...input.existing].sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id))) {
    if (!repById.has(e.repId)) continue;
    const k = key(e.repId, e.day);
    const list = routes.get(k) ?? [];
    list.push({ kind: "existing", id: e.id, label: e.label ?? "RDV existant", start: e.startMin, end: e.endMin, at: pt(e) });
    routes.set(k, list);
  }
  const load = new Map<string, number>();
  const notes = new Map<string, { n: number; extra?: number }>();

  const windowDays = (q: DispatchRequest) => days.filter((d) => d >= q.wishFrom && d <= q.wishTo);
  const inRadius = (r: DispatchRep, p: LatLng) => haversineKm(r.base, p) <= r.radiusKm + 1e-9;
  const covers = (r: DispatchRep, q: DispatchRequest, p: LatLng) => inRadius(r, p) && baseMin(baseId(r.id), q.id) <= input.maxBaseMin + 1e-9;
  const staticOptions = (q: DispatchRequest) => {
    const p = pt(q);
    if (!p) return 0;
    let n = 0;
    for (const r of reps) if (covers(r, q, p)) for (const d of windowDays(q)) if (r.workDays.includes(isoWeekday(d)) && !isFrenchHoliday(d)) n++;
    return n;
  };
  const clashUnav = (r: DispatchRep, d: string, s: number, e: number) => (unav.get(key(r.id, d)) ?? []).find((u) => u.startMin < e && u.endMin > s);

  const requests = [...input.requests].sort((a, b) => staticOptions(a) - staticOptions(b) || a.wishFrom.localeCompare(b.wishFrom) || a.id.localeCompare(b.id));
  const unassigned: Unassigned[] = [];
  const maxExtra = input.maxExtraMin;

  interface Ev { r: DispatchRep; d: string; n: number; best: { pos: number; start: number; cost: number } | null; legFail: boolean; slotFail: boolean }
  /** Meilleure insertion de la demande dans la tournée (rep, jour) de `map`, toutes contraintes de route/horaires respectées. */
  const evalDay = (map: Map<string, Stop[]>, r: DispatchRep, d: string, q: DispatchRequest): Ev => {
    const stops = map.get(key(r.id, d)) ?? [];
    const ev: Ev = { r, d, n: stops.length, best: null, legFail: false, slotFail: false };
    if (stops.length >= r.absoluteMax) return ev;
    for (let i = 0; i <= stops.length; i++) {
      const prev = i > 0 ? stops[i - 1]! : null;
      const next = i < stops.length ? stops[i]! : null;
      const fromId = prev ? prev.id : baseId(r.id);
      if (prev && prev.at && (baseMin(fromId, q.id) > input.maxLegMin || kmRoad(fromId, q.id) > input.maxLegKm)) { ev.legFail = true; continue; }
      if (next && next.at && (baseMin(q.id, next.id) > input.maxLegMin || kmRoad(q.id, next.id) > input.maxLegKm)) { ev.legFail = true; continue; }
      const departPrev = prev ? prev.end : r.workStartMin;
      let start = ceilGrid(departPrev + driveMin(fromId, q.id, d, departPrev) + r.travelMarginMin);
      let end = start + q.durationMin;
      let guard = 0;
      for (let c = clashUnav(r, d, start, end); c && guard < 6; c = clashUnav(r, d, start, end), guard++) {
        start = ceilGrid(Math.max(start, c.endMin));
        end = start + q.durationMin;
      }
      if (end > r.workEndMin || clashUnav(r, d, start, end)) { ev.slotFail = true; continue; }
      if (next && end + driveMin(q.id, next.id, d, end) + r.travelMarginMin > next.start) { ev.slotFail = true; continue; }
      const cost = driveMin(fromId, q.id, d, departPrev) + (next ? driveMin(q.id, next.id, d, end) - driveMin(fromId, next.id, d, departPrev) : 0);
      if (!ev.best || cost < ev.best.cost - 1e-9 || (Math.abs(cost - ev.best.cost) <= 1e-9 && start < ev.best.start)) ev.best = { pos: i, start, cost };
    }
    return ev;
  };
  /**
   * Score (minutes équivalentes, plus petit = mieux) : détour de route + pénalité d'ouverture d'une journée vide (remplir d'abord les journées
   * déjà ouvertes jusqu'à la norme) + écart de charge RELATIF au commercial le moins chargé parmi les candidats (la charge cumulée absolue
   * ne doit jamais faire ouvrir un nouveau jour : seul l'écart entre commerciaux compte) + léger biais vers les premiers jours.
   */
  const pickBest = (evs: Ev[]) => {
    if (evs.length === 0) return null;
    const minLoad = Math.min(...evs.map((ev) => load.get(ev.r.id) ?? 0));
    const scoreOf = (ev: Ev) => ev.best!.cost + (ev.n === 0 ? OPEN_DAY_PENALTY : 0) + ((load.get(ev.r.id) ?? 0) - minLoad) * LOAD_PENALTY + (dayIdx.get(ev.d) ?? 0) * DAY_INDEX_PENALTY;
    return evs.reduce<Ev | null>((b, ev) => (!b || scoreOf(ev) < scoreOf(b) - 1e-9 ? ev : b), null);
  };
  const place = (map: Map<string, Stop[]>, q: DispatchRequest, p: LatLng, ev: Ev) => {
    const k = key(ev.r.id, ev.d);
    const list = map.get(k) ?? [];
    list.splice(ev.best!.pos, 0, { kind: "new", id: q.id, label: q.label, start: ev.best!.start, end: ev.best!.start + q.durationMin, at: p });
    map.set(k, list);
  };

  // Étape 0 : motifs de refus immédiats (position, zone, horizon). Les autres demandes passent par les 3 étapes de charge.
  interface Cand { q: DispatchRequest; p: LatLng; covering: DispatchRep[]; wDays: string[] }
  let todo: Cand[] = [];
  for (const q of requests) {
    const p = pt(q);
    if (!p) {
      unassigned.push({ requestId: q.id, label: q.label, code: "no_geocode", reason: "Adresse non géocodée : précisez la rue et la ville." });
      continue;
    }
    if (reps.length === 0) {
      unassigned.push({ requestId: q.id, label: q.label, code: "no_rep", reason: "Aucun commercial actif avec une zone d'intervention." });
      continue;
    }
    const covering = reps.filter((r) => covers(r, q, p));
    if (covering.length === 0) {
      const nearest = reps.map((r) => ({ r, min: baseMin(baseId(r.id), q.id), crow: haversineKm(r.base, p) })).sort((a, b) => a.min - b.min)[0]!;
      const roadTxt = nearest.min > 0 ? `${Math.round(nearest.min)} min de route (${round1(kmRoad(baseId(nearest.r.id), q.id))} km)` : `${round1(nearest.crow)} km`;
      unassigned.push({
        requestId: q.id, label: q.label, code: "out_of_zone",
        reason: inRadius(nearest.r, p)
          ? `Hors zone : ${roadTxt} de la base de ${nearest.r.name}, au-delà de la limite de ${input.maxBaseMin} min.`
          : `Hors zone : ${roadTxt} de la base la plus proche (${nearest.r.name}, rayon ${nearest.r.radiusKm} km).`,
      });
      continue;
    }
    const wDays = windowDays(q);
    if (wDays.length === 0) {
      unassigned.push({ requestId: q.id, label: q.label, code: "out_of_horizon", reason: `Jour souhaité (${q.wishFrom}) hors de l'horizon de répartition.` });
      continue;
    }
    todo.push({ q, p, covering, wDays });
  }
  const evalAll = (map: Map<string, Stop[]>, c: Cand) => {
    const evs: Ev[] = [];
    let off = 0;
    let holiday = 0;
    for (const r of c.covering) for (const d of c.wDays) {
      if (!r.workDays.includes(isoWeekday(d))) continue;
      if (isFrenchHoliday(d)) { holiday++; continue; } // jour férié : aucun RDV, comme un jour non travaillé
      if ((unav.get(key(r.id, d)) ?? []).some((u) => u.startMin === 0 && u.endMin === 1440)) { off++; continue; }
      evs.push(evalDay(map, r, d, c.q));
    }
    return { evs, off, holiday };
  };

  // Étape 1 : tout le monde jusqu'à la norme (targetPerDay, 4 par défaut), en équilibrant.
  const rest1: Cand[] = [];
  for (const c of todo) {
    const { evs } = evalAll(routes, c);
    const best = pickBest(evs.filter((ev) => ev.best && ev.n < ev.r.targetPerDay));
    if (!best) { rest1.push(c); continue; }
    place(routes, c.q, c.p, best);
    load.set(best.r.id, (load.get(best.r.id) ?? 0) + 1);
    notes.set(c.q.id, { n: best.n + 1 });
  }
  // Étape 2 : un RDV de plus (jusqu'au confort, 5 par défaut) seulement si le détour est faible, si tout tient dans les horaires et si personne de moins chargé ne peut le prendre.
  const rest2: Cand[] = [];
  for (const c of rest1) {
    const { evs } = evalAll(routes, c);
    const ok = evs.filter((ev) => ev.best && ev.n >= ev.r.targetPerDay && ev.n < ev.r.comfortMax && ev.best.cost <= maxExtra);
    const best = pickBest(ok);
    if (!best) { rest2.push(c); continue; }
    place(routes, c.q, c.p, best);
    load.set(best.r.id, (load.get(best.r.id) ?? 0) + 1);
    notes.set(c.q.id, { n: best.n + 1, extra: Math.round(best.best!.cost) });
  }
  // Étape 3 : au-delà du confort (6e par défaut) : PROPOSÉ seulement, jamais attribué ; calculé sur une copie de travail.
  const shadow = new Map([...routes.entries()].map(([k, v]) => [k, v.map((s) => ({ ...s }))]));
  const proposedRaw: { q: DispatchRequest; ev: Ev; p: LatLng }[] = [];
  for (const c of rest2) {
    const { evs, off, holiday } = evalAll(shadow, c);
    const best = pickBest(evs.filter((ev) => ev.best && ev.n >= ev.r.comfortMax && ev.n < ev.r.absoluteMax));
    if (best) {
      place(shadow, c.q, c.p, best);
      proposedRaw.push({ q: c.q, ev: best, p: c.p });
      continue;
    }
    // Aucun placement possible : raison la plus parlante.
    const feasibleBeyondNorm = evs.filter((ev) => ev.best && ev.n >= ev.r.targetPerDay && ev.n < ev.r.comfortMax);
    const fails = { full: evs.filter((ev) => ev.n >= ev.r.absoluteMax).length, leg: evs.filter((ev) => ev.legFail && !ev.best).length, slot: evs.filter((ev) => ev.slotFail && !ev.best && !ev.legFail).length };
    const workable = evs.length;
    if (workable === 0) {
      unassigned.push({ requestId: c.q.id, label: c.q.label, code: "no_workday", reason: off > 0 ? "Commerciaux indisponibles (congé ou créneau bloqué) sur la période souhaitée." : holiday > 0 ? "Jour férié sur la période souhaitée : aucun RDV n'est planifié ces jours-là." : "Aucun jour travaillé par un commercial de la zone sur la période souhaitée." });
    } else if (feasibleBeyondNorm.length > 0) {
      const minExtra = Math.round(Math.min(...feasibleBeyondNorm.map((ev) => ev.best!.cost)));
      unassigned.push({ requestId: c.q.id, label: c.q.label, code: "detour", reason: `Journées à la norme (${Math.max(...c.covering.map((r) => r.targetPerDay))} RDV) : un RDV de plus demanderait +${minExtra} min de route (limite ${maxExtra} min).` });
    } else if (fails.full > 0 && fails.full >= fails.leg + fails.slot) {
      const mx = Math.max(...c.covering.map((r) => r.absoluteMax));
      unassigned.push({ requestId: c.q.id, label: c.q.label, code: "full", reason: `Journées pleines : maximum ${mx} RDV par jour atteint sur toute la période.` });
    } else if (fails.leg > 0 && fails.leg >= fails.slot) {
      unassigned.push({ requestId: c.q.id, label: c.q.label, code: "leg_too_long", reason: `Trajet trop long : plus de ${input.maxLegMin} min de route (ou ${input.maxLegKm} km) entre deux RDV.` });
    } else {
      const r0 = c.covering[0]!;
      unassigned.push({ requestId: c.q.id, label: c.q.label, code: "no_slot", reason: `Aucun créneau libre dans les horaires (${fmtMin(r0.workStartMin)}–${fmtMin(r0.workEndMin)}) en tenant compte des trajets.` });
    }
  }
  todo = [];

  // Ordre optimal des tournées composées uniquement de nouveaux RDV (permutations exactes, <= 7 arrêts).
  for (const [k, stops] of routes) {
    if (stops.length < 3 || stops.length > MAX_PERMUTE || stops.some((s) => s.kind === "existing")) continue;
    const [repId, day] = k.split("|") as [string, string];
    const r = repById.get(repId)!;
    if ((unav.get(k) ?? []).length) continue;
    const pack = (order: Stop[]): { stops: Stop[]; drive: number } | null => {
      let cur = r.workStartMin;
      let from = baseId(r.id);
      let drive = 0;
      const out: Stop[] = [];
      for (const s of order) {
        if (out.length > 0 && (baseMin(from, s.id) > input.maxLegMin || kmRoad(from, s.id) > input.maxLegKm)) return null;
        const dm = driveMin(from, s.id, day, cur);
        const start = ceilGrid(cur + dm + r.travelMarginMin);
        const end = start + (s.end - s.start);
        if (end > r.workEndMin) return null;
        drive += dm;
        out.push({ ...s, start, end });
        cur = end;
        from = s.id;
      }
      return { stops: out, drive };
    };
    const current = pack(stops);
    let best = current;
    const perm = (rest: Stop[], acc: Stop[]) => {
      if (rest.length === 0) {
        const c = pack(acc);
        if (c && (!best || c.drive < best.drive - 1e-9 || (Math.abs(c.drive - best.drive) <= 1e-9 && c.stops[c.stops.length - 1]!.end < best.stops[best.stops.length - 1]!.end))) best = c;
        return;
      }
      rest.forEach((s, i) => perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, s]));
    };
    perm([...stops].sort((a, b) => a.id.localeCompare(b.id)), []);
    if (best && (!current || best.drive < current.drive - 1e-9)) routes.set(k, best.stops);
  }

  // Résultats finaux (trajets recalculés sur l'ordre définitif).
  const assignments: Assignment[] = [];
  const stats: RouteStat[] = [];
  for (const [k, stops] of [...routes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!stops.some((s) => s.kind === "new")) continue;
    const [repId, day] = k.split("|") as [string, string];
    const r = repById.get(repId)!;
    let from = baseId(r.id);
    let departFrom = r.workStartMin;
    let totalKm = 0;
    let totalDrive = 0;
    const out: RouteStop[] = [];
    stops.forEach((s, i) => {
      const known = s.at !== null;
      const lk = known ? round1(kmRoad(from, s.id)) : 0;
      const bm = known ? Math.round(baseMin(from, s.id)) : 0;
      const dm = known ? driveMin(from, s.id, day, departFrom) : 0;
      const coef = known ? peakCoef(day, departFrom, leg(from, s.id).durationS, traffic) : 1;
      const overridden = over[overrideKey(from, s.id, day, departFrom)] !== undefined;
      totalKm += known ? kmRoad(from, s.id) : 0;
      totalDrive += dm;
      const nt = notes.get(s.id);
      const note = nt && nt.extra !== undefined ? `${nt.n}e RDV ajouté : +${nt.extra} min de route seulement` : undefined;
      out.push({
        kind: s.kind, id: s.id, label: s.label, startMin: s.start, endMin: s.end, legKm: lk, legBaseMin: bm, legMin: dm, note,
        trafficSource: overridden ? "provider" : coef > 1 ? "peak-estimate" : "free-flow", lat: s.at?.lat ?? null, lng: s.at?.lng ?? null,
      });
      if (s.kind === "new") assignments.push({ requestId: s.id, repId, day, startMin: s.start, endMin: s.end, order: i + 1, legKm: lk, legBaseMin: bm, legMin: dm, dayCount: stops.length, note, extraMin: nt?.extra });
      if (known) { from = s.id; }
      departFrom = s.end;
    });
    stats.push({
      repId, day, count: stops.length, newCount: stops.filter((s) => s.kind === "new").length, target: r.targetPerDay, comfort: r.comfortMax, absolute: r.absoluteMax,
      totalKm: round1(totalKm), totalDriveMin: totalDrive, endMin: Math.max(...stops.map((s) => s.end)), stops: out,
    });
  }
  assignments.sort((a, b) => a.day.localeCompare(b.day) || a.repId.localeCompare(b.repId) || a.startMin - b.startMin);
  stats.sort((a, b) => a.day.localeCompare(b.day) || a.repId.localeCompare(b.repId));
  unassigned.sort((a, b) => a.requestId.localeCompare(b.requestId));
  // Propositions au-delà du confort : positions calculées sur la copie de travail (après les RDV attribués, sans les perturber).
  const proposed: Assignment[] = proposedRaw.map(({ q, ev }) => {
    const stops = shadow.get(key(ev.r.id, ev.d))!;
    const i = stops.findIndex((s) => s.id === q.id);
    const s = stops[i]!;
    const prev = i > 0 ? stops[i - 1]! : null;
    const fromId = prev ? prev.id : baseId(ev.r.id);
    const lk = round1(kmRoad(fromId, q.id));
    const extra = Math.round(ev.best!.cost);
    return {
      requestId: q.id, repId: ev.r.id, day: ev.d, startMin: s.start, endMin: s.end, order: i + 1, legKm: lk, legBaseMin: Math.round(baseMin(fromId, q.id)),
      legMin: driveMin(fromId, q.id, ev.d, prev ? prev.end : ev.r.workStartMin), dayCount: stops.length,
      note: `${stops.length}e RDV : journée chargée (+${extra} min de route)`, extraMin: extra,
    };
  }).sort((a, b) => a.day.localeCompare(b.day) || a.repId.localeCompare(b.repId) || a.startMin - b.startMin);
  const warnings: DispatchResult["warnings"] = [];
  for (const [k, stops] of [...routes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [repId, day] = k.split("|") as [string, string];
    const r = repById.get(repId);
    if (r && stops.length > r.comfortMax) warnings.push({ repId, day, count: stops.length, comfort: r.comfortMax });
  }
  return { assignments, unassigned, stats, proposed, warnings };
}
