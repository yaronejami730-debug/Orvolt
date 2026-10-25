import { describe, expect, it } from "vitest";
import { planDispatch } from "@/lib/dispatch/engine";
import { DEFAULT_TRAFFIC } from "@/lib/dispatch/traffic";
import { fakeRoad } from "@/lib/routing/providers";
import { addDays } from "@/lib/dispatch/time";
import { baseId, type DispatchInput, type DispatchRep, type DispatchRequest } from "@/lib/dispatch/types";

const MON = "2026-03-02";
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(MON, i));
const pauline: DispatchRep = {
  id: "u-pauline", name: "Pauline Roche", base: { lat: 45.7578, lng: 4.832 }, radiusKm: 40, workStartMin: 9 * 60, workEndMin: 19 * 60,
  targetPerDay: 4, comfortMax: 5, absoluteMax: 6, workDays: [1, 2, 3, 4, 5], travelMinPerKm: 1.2, travelMarginMin: 10,
};
const karim: DispatchRep = { ...pauline, id: "u-karim", name: "Karim Benali", base: { lat: 45.6977, lng: 4.8869 }, radiusKm: 25, workStartMin: 10 * 60, workEndMin: 20 * 60 };
const PLACES: [number, number][] = [
  [45.7597, 4.8422], [45.7719, 4.8902], [45.6977, 4.8869], [45.7369, 4.9132], [45.7956, 4.8467],
  [45.7742, 4.7708], [45.7157, 4.8076], [45.6958, 4.9456], [45.7708, 4.9588], [45.7603, 4.7507],
];
const req = (i: number, over: Partial<DispatchRequest> = {}): DispatchRequest => ({
  id: `r${String(i).padStart(2, "0")}`, label: `Client ${i}`, lat: PLACES[i % 10]![0], lng: PLACES[i % 10]![1], durationMin: 60, wishFrom: MON, wishTo: addDays(MON, 4), ...over,
});
const mk = (reps: DispatchRep[], requests: DispatchRequest[]): DispatchInput => {
  const pos = new Map<string, { lat: number; lng: number }>();
  for (const r of reps) pos.set(baseId(r.id), r.base);
  for (const q of requests) if (q.lat !== null && q.lng !== null) pos.set(q.id, { lat: q.lat, lng: q.lng });
  return {
    reps, requests, existing: [], days: DAYS, maxLegKm: 60, maxLegMin: 60, maxBaseMin: 90, maxExtraMin: 20, traffic: DEFAULT_TRAFFIC,
    leg: (a, b) => { const x = pos.get(a); const y = pos.get(b); return x && y && a !== b ? fakeRoad(x, y) : { durationS: 0, distanceM: 0 }; },
  };
};

const run = (n: number, reps = [pauline, karim], over: (q: DispatchRequest, i: number) => Partial<DispatchRequest> = () => ({})) =>
  planDispatch(mk(reps, Array.from({ length: n }, (_, i) => req(i, over(req(i), i)))));
const counts = (r: ReturnType<typeof planDispatch>) => r.stats.map((s) => s.count).sort((a, b) => b - a);

describe("remplissage des journées jusqu'à la norme (4/5/6)", () => {
  it("10 RDV, Pauline + Karim : journées ouvertes remplies à 4 avant d'en ouvrir une autre (4+4+2, pas 4+4+1+1)", () => {
    const r = run(10);
    expect(r.assignments).toHaveLength(10);
    expect(r.unassigned).toEqual([]);
    expect(counts(r)).toEqual([4, 4, 2]);
  });
  it("12 et 16 RDV : que des journées à la norme, nombre de journées minimal", () => {
    expect(counts(run(12))).toEqual([4, 4, 4]);
    expect(counts(run(16))).toEqual([4, 4, 4, 4]);
  });
  it("10 RDV pour une seule commerciale (Pauline) : 4+4+2 sur 3 jours", () => {
    expect(counts(run(10, [pauline]))).toEqual([4, 4, 2]);
  });
  it("jamais plus de journées ouvertes que ceil(n/norme) + 1, quel que soit n", () => {
    for (let n = 1; n <= 24; n++) {
      const r = run(n);
      expect(r.assignments.length + r.proposed.length + r.unassigned.length).toBe(n);
      expect(r.stats.length).toBeLessThanOrEqual(Math.ceil(n / 4) + 1);
    }
  });
  it("équilibre entre commerciaux quand la distance est comparable : 8 RDV => 4 + 4 le même jour", () => {
    const r = run(8);
    expect(r.stats.map((s) => `${s.repId}:${s.count}`).sort()).toEqual(["u-karim:4", "u-pauline:4"]);
  });
  it("un RDV très éloigné ne force pas une journée à 4 : il ouvre une autre journée plutôt qu'un grand détour", () => {
    const r = run(5, [pauline], (_q, i) => (i === 4 ? { lat: 45.9, lng: 5.1 } : {}));
    expect(r.assignments.length + r.unassigned.length).toBe(5);
    const far = r.assignments.find((a) => a.requestId === "r04");
    if (far) expect(r.assignments.filter((a) => a.day === far.day && a.repId === far.repId).length).toBeLessThanOrEqual(2);
  });
});

describe("invariants du moteur (déterminisme, chevauchement, zone, horaires, journée pleine)", () => {
  it("déterministe : ordre des commerciaux et des demandes mélangé => même résultat", () => {
    const a = run(10);
    const reqs = Array.from({ length: 10 }, (_, i) => req(i)).reverse();
    const b = planDispatch(mk([karim, pauline], reqs));
    expect(b.assignments).toEqual(a.assignments);
    expect(planDispatch(mk([pauline, karim], reqs))).toEqual(planDispatch(mk([karim, pauline], reqs)));
  });
  it("anti-chevauchement et horaires 09-19 (Pauline) / 10-20 (Karim)", () => {
    const r = run(16);
    for (const a of r.assignments) {
      const rep = a.repId === "u-karim" ? karim : pauline;
      expect(a.startMin).toBeGreaterThanOrEqual(rep.workStartMin);
      expect(a.endMin).toBeLessThanOrEqual(rep.workEndMin);
    }
    for (const s of r.stats) for (let i = 1; i < s.stops.length; i++) expect(s.stops[i]!.startMin).toBeGreaterThanOrEqual(s.stops[i - 1]!.endMin);
  });
  it("hors zone : refusé avec le code out_of_zone", () => {
    const r = run(4, [pauline, karim], (_q, i) => (i === 0 ? { lat: 48.85, lng: 2.35 } : {}));
    expect(r.unassigned.map((u) => u.code)).toEqual(["out_of_zone"]);
    expect(r.assignments).toHaveLength(3);
  });
  it("journée pleine : 6 max/jour sur un seul jour, jamais plus de 5 attribués, le reste proposé ou refusé", () => {
    const one = (q: DispatchRequest) => ({ wishTo: q.wishFrom });
    const r = run(9, [pauline], one);
    expect(r.assignments.length).toBeLessThanOrEqual(5);
    expect(r.assignments.length + r.proposed.length + r.unassigned.length).toBe(9);
    expect(r.proposed.length + r.assignments.length).toBeLessThanOrEqual(6);
    expect(r.stats.every((s) => s.count <= 5)).toBe(true);
  });
});
