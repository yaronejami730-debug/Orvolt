import { describe, expect, it } from "vitest";
import { haversineKm } from "@/lib/geo/haversine";
import { planDispatch } from "@/lib/dispatch/engine";
import { DEFAULT_TRAFFIC, trafficMinutes } from "@/lib/dispatch/traffic";
import { fakeRoad } from "@/lib/routing/providers";
import { addDays, fmtMin, isoWeekday, localDay, localMinutes, zonedToUtc } from "@/lib/dispatch/time";
import { DEFAULT_ORG, DEFAULT_WORK, orgSettingsSchema, workSettingsSchema } from "@/lib/dispatch/settings";
import { baseId, type DispatchInput, type DispatchRep, type DispatchRequest, type ExistingAppt, type LegLookup } from "@/lib/dispatch/types";

// 2026-03-02 = lundi
const MON = "2026-03-02";
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(MON, i)); // lun..dim

const pauline: DispatchRep = {
  id: "u-pauline", name: "Pauline Roche", base: { lat: 45.7578, lng: 4.832 }, radiusKm: 40,
  workStartMin: 9 * 60, workEndMin: 19 * 60, targetPerDay: 3, comfortMax: 4, absoluteMax: 5, workDays: [1, 2, 3, 4, 5], travelMinPerKm: 1.2, travelMarginMin: 10,
};
const karim: DispatchRep = {
  ...pauline, id: "u-karim", name: "Karim Benali", base: { lat: 45.6977, lng: 4.8869 }, radiusKm: 25, workStartMin: 10 * 60, workEndMin: 20 * 60,
};

const PLACES: [string, number, number][] = [
  ["Lyon 3e", 45.7597, 4.8422], ["Villeurbanne", 45.7719, 4.8902], ["Vénissieux", 45.6977, 4.8869], ["Bron", 45.7369, 4.9132],
  ["Caluire", 45.7956, 4.8467], ["Écully", 45.7742, 4.7708], ["Oullins", 45.7157, 4.8076], ["Saint-Priest", 45.6958, 4.9456],
  ["Décines", 45.7708, 4.9588], ["Tassin", 45.7603, 4.7507],
];
const req = (i: number, over: Partial<DispatchRequest> = {}): DispatchRequest => ({
  id: `r${String(i).padStart(2, "0")}`, label: `Client ${i}`, lat: PLACES[i % 10]![1], lng: PLACES[i % 10]![2], durationMin: 60, wishFrom: MON, wishTo: addDays(MON, 4), ...over,
});
/** Itinéraires de test : réseau synthétique non euclidien (fleuve à 4.95 franchissable par un pont), construit depuis les positions de l'entrée. */
const legFor = (reps: DispatchRep[], requests: DispatchRequest[], existing: ExistingAppt[]): LegLookup => {
  const pos = new Map<string, { lat: number; lng: number }>();
  for (const r of reps) pos.set(baseId(r.id), r.base);
  for (const q of requests) if (q.lat !== null && q.lng !== null) pos.set(q.id, { lat: q.lat, lng: q.lng });
  for (const e of existing) if (e.lat !== null && e.lng !== null) pos.set(e.id, { lat: e.lat, lng: e.lng });
  return (a, b) => { const x = pos.get(a); const y = pos.get(b); return x && y && a !== b ? fakeRoad(x, y) : { durationS: 0, distanceM: 0 }; };
};
const base = (over: Partial<DispatchInput> = {}): DispatchInput => {
  const reps = over.reps ?? [pauline];
  const requests = over.requests ?? Array.from({ length: 10 }, (_, i) => req(i));
  const existing = over.existing ?? [];
  return { reps, requests, existing, days: DAYS, maxLegKm: 60, maxLegMin: 60, maxBaseMin: 90, maxExtraMin: 20, leg: legFor(reps, requests, existing), traffic: DEFAULT_TRAFFIC, ...over, ...(over.leg ? {} : { leg: legFor(reps, requests, existing) }) };
};

describe("planDispatch : cas Pauline, 10 RDV confirmés", () => {
  const res = planDispatch(base());
  it("attribue les 10 RDV à la norme : 3 par jour (3+3+3+1), jamais plus de 3 tant que la norme suffit", () => {
    expect(res.assignments).toHaveLength(10);
    expect(res.unassigned).toEqual([]);
    expect(res.proposed).toEqual([]);
    const perDay = res.stats.map((s) => s.count).sort();
    expect(perDay).toEqual([1, 3, 3, 3]);
    expect(res.stats.every((s) => s.count <= s.target && s.target === 3)).toBe(true);
  });
  it("respecte les horaires 09:00-19:00 et ne chevauche jamais", () => {
    for (const a of res.assignments) {
      expect(a.startMin).toBeGreaterThanOrEqual(9 * 60);
      expect(a.endMin).toBeLessThanOrEqual(19 * 60);
      expect(a.startMin % 5).toBe(0);
    }
    for (const s of res.stats) {
      for (let i = 1; i < s.stops.length; i++) expect(s.stops[i]!.startMin).toBeGreaterThanOrEqual(s.stops[i - 1]!.endMin);
    }
  });
  it("laisse le temps de trajet réel (avec circulation) entre deux RDV et depuis la base", () => {
    const input = base();
    for (const s of res.stats) {
      s.stops.forEach((st, i) => {
        const prev = i === 0 ? null : s.stops[i - 1]!;
        const from = prev ? prev.id : baseId(pauline.id);
        const depart = prev ? prev.endMin : 9 * 60;
        const need = trafficMinutes(input.leg(from, st.id).durationS, s.day, depart, DEFAULT_TRAFFIC) + pauline.travelMarginMin;
        expect(st.startMin - depart).toBeGreaterThanOrEqual(need);
      });
    }
  });
  it("calcule km, fin de journée et rang", () => {
    for (const s of res.stats) {
      expect(s.totalKm).toBeGreaterThan(0);
      expect(s.endMin).toBe(Math.max(...s.stops.map((x) => x.endMin)));
    }
    expect(res.assignments.filter((a) => a.day === res.stats[0]!.day).map((a) => a.order)).toEqual([1, 2, 3, 4].slice(0, res.stats[0]!.count));
  });
  it("n'attribue que des jours de la fenêtre et travaillés (pas de week-end)", () => {
    for (const a of res.assignments) expect(isoWeekday(a.day)).toBeLessThanOrEqual(5);
  });
});

describe("planDispatch : refus motivés", () => {
  it("hors zone avec raison en français et distance", () => {
    const r = planDispatch(base({ requests: [req(0, { lat: 48.8566, lng: 2.3522 })] }));
    expect(r.assignments).toHaveLength(0);
    expect(r.unassigned[0]).toMatchObject({ code: "out_of_zone" });
    expect(r.unassigned[0]!.reason).toMatch(/^Hors zone : /);
    expect(r.unassigned[0]!.reason).toContain("Pauline Roche");
  });
  it("sans géocodage", () => {
    const r = planDispatch(base({ requests: [req(0, { lat: null, lng: null })] }));
    expect(r.unassigned[0]).toMatchObject({ code: "no_geocode" });
  });
  it("aucun commercial", () => {
    expect(planDispatch(base({ reps: [] })).unassigned.every((u) => u.code === "no_rep")).toBe(true);
  });
  it("journée pleine : 3 + 4e proche, le 5e est PROPOSÉ (jamais attribué), le 6e refusé", () => {
    const requests = Array.from({ length: 6 }, (_, i) => req(i, { wishTo: MON }));
    const r = planDispatch(base({ requests }));
    expect(r.assignments).toHaveLength(4);
    expect(r.proposed).toHaveLength(1);
    expect(r.proposed[0]!.note).toContain("5e RDV : journée chargée");
    expect(r.unassigned).toHaveLength(1);
    expect(r.unassigned[0]!.code).toBe("full");
    expect(r.unassigned[0]!.reason).toContain("maximum 5");
    expect(r.stats[0]!.count).toBe(4);
  });
  it("jour souhaité non travaillé (week-end)", () => {
    const r = planDispatch(base({ requests: [req(0, { wishFrom: addDays(MON, 5), wishTo: addDays(MON, 6) })] }));
    expect(r.unassigned[0]!.code).toBe("no_workday");
  });
  it("hors horizon", () => {
    const r = planDispatch(base({ requests: [req(0, { wishFrom: "2027-01-04", wishTo: "2027-01-05" })] }));
    expect(r.unassigned[0]!.code).toBe("out_of_horizon");
  });
  it("trajet trop long entre deux RDV (minutes de route réelles)", () => {
    // Écully (ouest) et Décines (est du fleuve) : le détour par le pont dépasse 20 min de route
    const rs = [req(5, { id: "a", wishTo: MON }), req(8, { id: "b", wishTo: MON })];
    const r = planDispatch(base({ requests: rs, maxLegMin: 20 }));
    expect(r.assignments).toHaveLength(1);
    expect(r.unassigned[0]!.code).toBe("leg_too_long");
    expect(r.unassigned[0]!.reason).toContain("20 min");
  });
  it("proche à vol d'oiseau mais 2 h de route : refusé (hors zone) puis séparé des autres", () => {
    const rs = [req(0, { id: "near" })];
    const reps = [pauline];
    // matrice synthétique : le point est à 3 km à vol d'oiseau mais 125 min de route (fleuve sans pont, montagne…)
    const leg: LegLookup = (a, b) => (a === baseId(pauline.id) && b === "near") || (b === baseId(pauline.id) && a === "near") ? { durationS: 125 * 60, distanceM: 90_000 } : { durationS: 0, distanceM: 0 };
    const r = planDispatch(base({ reps, requests: rs.map((q) => ({ ...q, lat: pauline.base.lat + 0.02, lng: pauline.base.lng + 0.02 })), leg }));
    expect(r.assignments).toHaveLength(0);
    expect(r.unassigned[0]).toMatchObject({ code: "out_of_zone" });
    expect(r.unassigned[0]!.reason).toMatch(/125 min de route/);
  });
  it("le fleuve change le résultat : mêmes distances à vol d'oiseau, routes différentes", () => {
    const a = { lat: 45.85, lng: 4.94 };
    const b = { lat: 45.85, lng: 4.96 }; // de l'autre côté du fleuve
    const crow = haversineKm(a, b);
    expect(fakeRoad(a, b).distanceM / 1000).toBeGreaterThan(crow * 1.3 * 2); // détour par le pont
    expect(fakeRoad(a, { lat: 45.85, lng: 4.9 }).distanceM / 1000).toBeLessThan(crow * 1.3 * 3); // même rive : trajet direct
  });
  it("indisponibilités : journée entière et créneau bloqué toujours respectés", () => {
    const requests = Array.from({ length: 4 }, (_, i) => req(i, { wishTo: MON }));
    const full = planDispatch(base({ requests, unavailability: [{ repId: "u-pauline", day: MON, startMin: null, endMin: null }] }));
    expect(full.assignments).toHaveLength(0);
    expect(full.unassigned[0]!.reason).toContain("indisponibles");
    const slot = planDispatch(base({ requests, unavailability: [{ repId: "u-pauline", day: MON, startMin: 9 * 60, endMin: 13 * 60 }] }));
    expect(slot.assignments.length).toBeGreaterThan(0);
    for (const a of slot.assignments) expect(a.startMin).toBeGreaterThanOrEqual(13 * 60);
  });
  it("RDV verrouillés/existants jamais déplacés lors d'une relance", () => {
    const first = planDispatch(base({ requests: Array.from({ length: 4 }, (_, i) => req(i, { wishTo: MON })) }));
    const existing: ExistingAppt[] = first.assignments.slice(0, 2).map((a) => {
      const q = req(Number(a.requestId.slice(1)));
      return { id: `lock-${a.requestId}`, repId: a.repId, day: a.day, startMin: a.startMin, endMin: a.endMin, lat: q.lat, lng: q.lng };
    });
    const again = planDispatch(base({ existing, requests: Array.from({ length: 4 }, (_, i) => req(i + 4, { wishTo: MON })) }));
    for (const e of existing) {
      const stop = again.stats.find((s) => s.day === e.day)?.stops.find((s) => s.id === e.id);
      expect(stop).toMatchObject({ kind: "existing", startMin: e.startMin, endMin: e.endMin });
    }
    expect(again.assignments.every((a) => !existing.some((e) => e.day === a.day && a.startMin < e.endMin && e.startMin < a.endMin))).toBe(true);
  });
  it("durée trop longue pour la journée : aucun créneau", () => {
    const r = planDispatch(base({ requests: [req(0, { durationMin: 11 * 60 })] }));
    expect(r.unassigned[0]!.code).toBe("no_slot");
    expect(r.unassigned[0]!.reason).toContain("09:00–19:00");
  });
});

describe("planDispatch : horaires 10h-20h, équilibrage, existants", () => {
  it("respecte les horaires du commercial (10:00-20:00)", () => {
    const r = planDispatch(base({ reps: [karim], requests: Array.from({ length: 4 }, (_, i) => req(i, { wishTo: MON })) }));
    expect(r.assignments).toHaveLength(4);
    for (const a of r.assignments) {
      expect(a.startMin).toBeGreaterThanOrEqual(10 * 60);
      expect(a.endMin).toBeLessThanOrEqual(20 * 60);
    }
    expect(fmtMin(Math.min(...r.assignments.map((a) => a.startMin)))).toMatch(/^10:|^11:/);
  });
  it("équilibre entre deux commerciaux et respecte chaque zone", () => {
    const r = planDispatch(base({ reps: [pauline, karim], requests: Array.from({ length: 10 }, (_, i) => req(i)) }));
    expect(r.assignments).toHaveLength(10);
    const by = (id: string) => r.assignments.filter((a) => a.repId === id).length;
    expect(by("u-pauline")).toBeGreaterThan(0);
    expect(by("u-karim")).toBeGreaterThan(0);
    expect(Math.abs(by("u-pauline") - by("u-karim"))).toBeLessThanOrEqual(6);
    for (const s of r.stats) expect(s.count).toBeLessThanOrEqual(4);
  });
  it("anti-chevauchement avec les RDV existants et décompte dans le max/jour", () => {
    const existing = [
      { id: "e1", repId: "u-pauline", day: MON, startMin: 9 * 60 + 30, endMin: 10 * 60 + 30, lat: 45.7597, lng: 4.8422 },
      { id: "e2", repId: "u-pauline", day: MON, startMin: 14 * 60, endMin: 15 * 60, lat: 45.7719, lng: 4.8902 },
    ];
    const r = planDispatch(base({ existing, requests: Array.from({ length: 5 }, (_, i) => req(i, { wishTo: MON })) }));
    expect(r.assignments.length).toBeGreaterThanOrEqual(1);
    const s = r.stats.find((x) => x.day === MON)!;
    expect(s.count).toBeLessThanOrEqual(4);
    expect(s.stops.map((x) => x.kind).filter((k) => k === "existing")).toHaveLength(2);
    for (let i = 1; i < s.stops.length; i++) expect(s.stops[i]!.startMin).toBeGreaterThanOrEqual(s.stops[i - 1]!.endMin + 10);
    expect(r.assignments.length + r.proposed.length + r.unassigned.length).toBe(5);
  });
  it("une journée entièrement occupée par un RDV existant n'est pas utilisée", () => {
    const existing = [{ id: "big", repId: "u-pauline", day: MON, startMin: 9 * 60, endMin: 19 * 60, lat: 45.76, lng: 4.84 }];
    const r = planDispatch(base({ existing, requests: [req(0, { wishTo: MON })] }));
    expect(r.assignments).toHaveLength(0);
    expect(r.unassigned[0]!.code).toBe("no_slot");
  });
});

describe("règle de charge : norme 3, confort 4, 5e jamais automatique", () => {
  const day = (r: ReturnType<typeof planDispatch>, rep: string) => r.stats.filter((x) => x.repId === rep).map((x) => x.count);
  it("3 par défaut : 6 RDV proches sur un jour avec deux commerciaux => 3 + 3 (équilibrage)", () => {
    const r = planDispatch(base({ reps: [pauline, karim], requests: Array.from({ length: 6 }, (_, i) => req(i, { wishTo: MON })) }));
    expect(r.assignments).toHaveLength(6);
    expect(day(r, "u-pauline")).toEqual([3]);
    expect(day(r, "u-karim")).toEqual([3]);
    expect(r.assignments.every((a) => a.note === undefined)).toBe(true);
  });
  it("4e RDV ajouté quand les RDV sont proches, avec la raison « +x min de route seulement »", () => {
    const r = planDispatch(base({ requests: Array.from({ length: 4 }, (_, i) => req(i, { wishTo: MON })) }));
    expect(r.assignments).toHaveLength(4);
    const fourth = r.assignments.find((a) => a.note)!;
    expect(fourth.dayCount).toBe(4);
    expect(fourth.note).toMatch(/^4e RDV ajouté : \+\d+ min de route seulement$/);
    expect(fourth.extraMin).toBeLessThanOrEqual(20);
    expect(r.proposed).toEqual([]);
  });
  it("4e RDV refusé quand le détour est grand (au-delà de maxExtraMin), avec la raison", () => {
    const requests = [req(0, { id: "a", wishTo: MON }), req(1, { id: "b", wishTo: MON }), req(2, { id: "c", wishTo: MON }), req(7, { id: "d", wishTo: MON })];
    const r = planDispatch(base({ requests, maxExtraMin: 2 }));
    expect(r.assignments).toHaveLength(3);
    const d = r.unassigned.find((u) => u.code === "detour") ?? r.proposed[0];
    expect(d).toBeTruthy();
    expect(r.assignments.every((a) => a.dayCount! <= 3)).toBe(true);
    expect(r.proposed).toEqual([]);
  });
  it("le 4e RDV passe à un autre commercial moins chargé plutôt que d'alourdir la journée", () => {
    const r = planDispatch(base({ reps: [pauline, karim], requests: Array.from({ length: 7 }, (_, i) => req(i, { wishTo: MON })) }));
    expect(r.assignments).toHaveLength(7);
    expect(Math.max(...r.stats.map((s) => s.count))).toBeLessThanOrEqual(4);
    expect(r.stats.filter((s) => s.count === 4)).toHaveLength(1); // une seule journée à 4, l'autre reste à la norme
  });
  it("5e RDV : jamais attribué automatiquement, seulement proposé (hors de assignments)", () => {
    const r = planDispatch(base({ requests: Array.from({ length: 5 }, (_, i) => req(i, { wishTo: MON })) }));
    expect(r.assignments).toHaveLength(4);
    expect(r.proposed).toHaveLength(1);
    expect(r.assignments.some((a) => a.requestId === r.proposed[0]!.requestId)).toBe(false);
    expect(r.proposed[0]!.dayCount).toBe(5);
    expect(r.unassigned).toEqual([]);
  });
  it("seuils réglables par commercial (norme 2, confort 2, maximum 3)", () => {
    const small = { ...pauline, targetPerDay: 2, comfortMax: 2, absoluteMax: 3 };
    const r = planDispatch(base({ reps: [small], requests: Array.from({ length: 3 }, (_, i) => req(i, { wishTo: MON })) }));
    expect(r.assignments).toHaveLength(2);
    expect(r.proposed).toHaveLength(1);
  });
  it("journée déjà surchargée par des RDV posés/verrouillés : non modifiée, signalée", () => {
    const existing: ExistingAppt[] = [9, 11, 13, 15, 17].map((h, i) => ({ id: `e${i}`, repId: "u-pauline", day: MON, startMin: h * 60, endMin: h * 60 + 45, lat: 45.76, lng: 4.84 }));
    const r = planDispatch(base({ existing, requests: [req(0, { wishTo: MON })] }));
    expect(r.warnings).toEqual([{ repId: "u-pauline", day: MON, count: 5, comfort: 4 }]); // signalée, non modifiée
    expect(r.assignments).toHaveLength(0);
    const r2 = planDispatch(base({ existing, requests: [req(0, { wishTo: addDays(MON, 1) })] }));
    expect(r2.assignments[0]!.day).toBe(addDays(MON, 1));
    expect(r2.stats.every((s) => s.day !== MON)).toBe(true);
    const r3 = planDispatch(base({ existing: [...existing.slice(0, 4), { ...existing[0]!, id: "z", startMin: 18 * 60 + 5, endMin: 18 * 60 + 40 }], requests: [req(0, { wishFrom: MON, wishTo: addDays(MON, 1) })] }));
    expect(r3.warnings.length + r3.assignments.length).toBeGreaterThan(0);
  });
  it("respect des horaires 10h-20h avec la règle de charge", () => {
    const r = planDispatch(base({ reps: [karim], requests: Array.from({ length: 4 }, (_, i) => req(i, { wishTo: MON })) }));
    for (const a of r.assignments) { expect(a.startMin).toBeGreaterThanOrEqual(10 * 60); expect(a.endMin).toBeLessThanOrEqual(20 * 60); }
  });
});

describe("planDispatch : déterminisme", () => {
  it("même entrée (ordre mélangé) => même résultat", () => {
    const a = planDispatch(base({ reps: [pauline, karim] }));
    const input = base({ reps: [karim, pauline] });
    input.requests = [...input.requests].reverse();
    input.days = [...input.days].reverse();
    expect(planDispatch(input)).toEqual(a);
    expect(planDispatch(base({ reps: [pauline, karim] }))).toEqual(a);
  });
});

describe("circulation estimée selon l'heure", () => {
  it("coefficient de pointe seulement en semaine, aux heures de pointe, pour les trajets > 15 min", () => {
    const t = DEFAULT_TRAFFIC; // ×1,25 matin, ×1,4 soir, +10 %
    expect(trafficMinutes(30 * 60, MON, 8 * 60, t)).toBe(Math.ceil(30 * 1.25 * 1.1)); // pointe du matin
    expect(trafficMinutes(30 * 60, MON, 17 * 60, t)).toBe(Math.ceil(30 * 1.4 * 1.1)); // pointe du soir
    expect(trafficMinutes(30 * 60, MON, 11 * 60, t)).toBe(Math.ceil(30 * 1.1)); // creux
    expect(trafficMinutes(30 * 60, addDays(MON, 5), 8 * 60, t)).toBe(Math.ceil(30 * 1.1)); // samedi
    expect(trafficMinutes(10 * 60, MON, 8 * 60, t)).toBe(Math.ceil(10 * 1.1)); // trajet court
  });
  it("la marge de sécurité augmente l'écart entre deux RDV", () => {
    const tight = planDispatch(base({ traffic: { ...DEFAULT_TRAFFIC, safetyPct: 0 }, requests: [req(0, { wishTo: MON }), req(5, { wishTo: MON })] }));
    const safe = planDispatch(base({ traffic: { ...DEFAULT_TRAFFIC, safetyPct: 100 }, requests: [req(0, { wishTo: MON }), req(5, { wishTo: MON })] }));
    expect(safe.stats[0]!.endMin).toBeGreaterThanOrEqual(tight.stats[0]!.endMin);
  });
  it("une durée de trafic externe plus longue décale les RDV, jamais l'inverse", () => {
    const b = base({ requests: [req(0, { wishTo: MON })] });
    const plain = planDispatch(b);
    const a = plain.assignments[0]!;
    const key = `${baseId("u-pauline")}|r00|${MON}|${Math.floor(9 * 60 / 15)}`;
    const slow = planDispatch({ ...b, trafficOverrides: { [key]: 90 } });
    expect(slow.assignments[0]!.startMin).toBeGreaterThan(a.startMin);
    const fast = planDispatch({ ...b, trafficOverrides: { [key]: 1 } });
    expect(fast.assignments[0]!.startMin).toBe(a.startMin);
  });
});

describe("temps et réglages", () => {
  it("convertit heure locale Paris <-> UTC (été et hiver)", () => {
    expect(zonedToUtc("2026-01-15", 9 * 60).toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(zonedToUtc("2026-07-15", 9 * 60).toISOString()).toBe("2026-07-15T07:00:00.000Z");
    const d = zonedToUtc("2026-07-15", 14 * 60 + 35);
    expect([localDay(d), localMinutes(d)]).toEqual(["2026-07-15", 14 * 60 + 35]);
  });
  it("valide les réglages", () => {
    const ok = { userId: crypto.randomUUID(), workStart: "10:00", workEnd: "20:00", targetPerDay: null, comfortMax: null, absoluteMax: null, workDays: [1, 2], durationMin: 60, travelMinPerKm: 1.2, travelMarginMin: 10 };
    expect(workSettingsSchema.safeParse(ok).success).toBe(true);
    expect(workSettingsSchema.safeParse({ ...ok, workEnd: "09:00" }).success).toBe(false);
    expect(workSettingsSchema.safeParse({ ...ok, targetPerDay: 11 }).success).toBe(false);
    expect(workSettingsSchema.safeParse({ ...ok, targetPerDay: 5, comfortMax: 4 }).success).toBe(false);
    expect(workSettingsSchema.safeParse({ ...ok, targetPerDay: 3, comfortMax: 4, absoluteMax: 5 }).success).toBe(true);
    expect(workSettingsSchema.safeParse({ ...ok, workDays: [] }).success).toBe(false);
    const org = { targetPerDay: 3, comfortMax: 4, absoluteMax: 5, maxExtraMin: 20, maxLegKm: 40, horizonDays: 7, maxLegMin: 45, maxBaseMin: 75, morningCoef: 1.25, eveningCoef: 1.4, safetyPct: 10 };
    expect(orgSettingsSchema.safeParse(org).success).toBe(true);
    expect(orgSettingsSchema.safeParse({ ...org, horizonDays: 31 }).success).toBe(false);
    expect(orgSettingsSchema.safeParse({ ...org, morningCoef: 0.5 }).success).toBe(false);
    expect(orgSettingsSchema.safeParse({ ...org, comfortMax: 2 }).success).toBe(false);
  });
  it("défauts : norme 4 RDV/jour, confort 5 (détour faible), maximum 6 (jamais automatique), cohérents entre organisation et commercial", () => {
    expect(DEFAULT_ORG).toMatchObject({ targetPerDay: 4, comfortMax: 5, absoluteMax: 6, maxExtraMin: 20 });
    expect(DEFAULT_WORK).toMatchObject({ targetPerDay: 4, comfortMax: 5, absoluteMax: 6 });
    expect(orgSettingsSchema.safeParse({ ...DEFAULT_ORG, morningCoef: 1.25, eveningCoef: 1.4, safetyPct: 10 }).success).toBe(true);
  });
  it("avec les défauts (4/5/6) : 10 RDV = 4+4+2, jamais plus de 4 tant que la norme suffit", () => {
    const reps = [{ ...pauline, targetPerDay: DEFAULT_ORG.targetPerDay, comfortMax: DEFAULT_ORG.comfortMax, absoluteMax: DEFAULT_ORG.absoluteMax }];
    const res = planDispatch(base({ reps }));
    expect(res.assignments).toHaveLength(10);
    expect(res.unassigned).toEqual([]);
    expect(res.proposed).toHaveLength(0);
    expect(res.stats.map((s) => s.count).sort((a, b) => b - a)).toEqual([4, 4, 2]);
    expect(res.stats.every((s) => s.target === 4 && s.comfort === 5 && s.absolute === 6)).toBe(true);
  });
});
