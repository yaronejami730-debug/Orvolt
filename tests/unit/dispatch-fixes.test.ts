import { describe, expect, it } from "vitest";
import { planDispatch } from "@/lib/dispatch/engine";
import { guardClientPoint, CONFIRM_TOLERANCE_KM } from "@/lib/dispatch/point-guard";
import { checkWishWindow } from "@/lib/dispatch/pending";
import { MAX_PENDING, overLimit, truncationWarnings } from "@/lib/dispatch/truncation";
import { pendingInputSchema } from "@/lib/validation/appointments";
import { easterSunday, frenchHolidays, holidayName, isFrenchHoliday } from "@/lib/dispatch/holidays";
import { DEFAULT_TRAFFIC } from "@/lib/dispatch/traffic";
import { addDays } from "@/lib/dispatch/time";
import { fakeRoad } from "@/lib/routing/providers";
import { baseId, type DispatchInput, type DispatchRep, type DispatchRequest, type LegLookup } from "@/lib/dispatch/types";

// ------------------------------------------------------------------ MOYEN 8 : jours fériés
describe("jours fériés français", () => {
  it("Pâques (algorithme grégorien) : dates connues", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2031)).toBe("2031-04-13");
  });
  it("11 fériés par an : 8 fixes + lundi de Pâques, Ascension, lundi de Pentecôte", () => {
    const h = frenchHolidays(2026);
    expect([...h.keys()].sort()).toEqual([
      "2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25",
    ]);
    expect(holidayName("2026-05-14")).toBe("Ascension");
    expect(holidayName("2026-05-25")).toBe("Lundi de Pentecôte");
  });
  it("un jour ordinaire n'est pas férié", () => {
    expect(isFrenchHoliday("2026-05-05")).toBe(false);
    expect(isFrenchHoliday("2026-12-24")).toBe(false);
    expect(isFrenchHoliday("2026-12-25")).toBe(true);
  });
});

const rep: DispatchRep = {
  id: "u-pauline", name: "Pauline Roche", base: { lat: 45.7578, lng: 4.832 }, radiusKm: 40,
  workStartMin: 9 * 60, workEndMin: 19 * 60, targetPerDay: 4, comfortMax: 5, absoluteMax: 6, workDays: [1, 2, 3, 4, 5], travelMinPerKm: 1.2, travelMarginMin: 10,
};
const MON = "2026-05-04"; // lundi ; vendredi 8 mai = férié, jeudi 14 mai = Ascension
const DAYS = Array.from({ length: 14 }, (_, i) => addDays(MON, i));
const mk = (over: Partial<DispatchRequest>): DispatchRequest => ({ id: "r1", label: "Client", lat: 45.7597, lng: 4.8422, durationMin: 60, wishFrom: MON, wishTo: MON, ...over });
const plan = (requests: DispatchRequest[]) => {
  const pos = new Map<string, { lat: number; lng: number }>([[baseId(rep.id), rep.base]]);
  for (const q of requests) pos.set(q.id, { lat: q.lat!, lng: q.lng! });
  const leg: LegLookup = (a, b) => { const x = pos.get(a); const y = pos.get(b); return x && y && a !== b ? fakeRoad(x, y) : { durationS: 0, distanceM: 0 }; };
  const input: DispatchInput = { reps: [rep], requests, existing: [], days: DAYS, maxLegKm: 60, maxLegMin: 60, maxBaseMin: 90, maxExtraMin: 20, leg, traffic: DEFAULT_TRAFFIC };
  return planDispatch(input);
};

describe("moteur : jours fériés", () => {
  it("un RDV souhaité uniquement un jour férié n'est pas planifié, avec une raison explicite", () => {
    const res = plan([mk({ wishFrom: "2026-05-08", wishTo: "2026-05-08" })]);
    expect(res.assignments).toHaveLength(0);
    expect(res.unassigned[0]).toMatchObject({ code: "no_workday" });
    expect(res.unassigned[0]!.reason).toContain("férié");
  });
  it("fenêtre jeudi 7 -> vendredi 8 mai : placé le jeudi, jamais le 8", () => {
    const res = plan([mk({ wishFrom: "2026-05-07", wishTo: "2026-05-08" })]);
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0]!.day).toBe("2026-05-07");
  });
  it("Ascension (jeudi 14 mai) évitée même avec une fenêtre qui la couvre seule", () => {
    const res = plan([mk({ wishFrom: "2026-05-14", wishTo: "2026-05-14" })]);
    expect(res.assignments).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ MOYEN 4 : revalidation serveur des points client
describe("guardClientPoint", () => {
  const lyon = { lat: 45.7597, lng: 4.8422, precision: "housenumber" as const };
  it("refuse un point hors de France (même pour le confirmateur)", () => {
    for (const dispatcher of [true, false]) {
      expect(guardClientPoint({ lat: 0, lng: 0, precision: "housenumber" }, null, dispatcher)).toMatchObject({ ok: false });
      expect(guardClientPoint({ lat: Number.NaN, lng: 4, precision: "street" }, null, dispatcher)).toMatchObject({ ok: false });
    }
  });
  it("confirmateur : point conservé tel quel", () => {
    expect(guardClientPoint(lyon, null, true)).toMatchObject({ ok: true, precision: "housenumber", capped: false, fromServer: false });
  });
  it("autre utilisateur sans confirmation serveur : précision plafonnée à « commune » (impossible de forcer housenumber)", () => {
    expect(guardClientPoint(lyon, null, false)).toMatchObject({ ok: true, precision: "municipality", capped: true });
    expect(guardClientPoint({ ...lyon, precision: "manual_pin" }, null, false)).toMatchObject({ precision: "municipality" });
  });
  it("coordonnées sans rapport avec le libellé géocodé par le serveur : plafonné", () => {
    const paris = { lat: 48.8566, lng: 2.3522, precision: "housenumber" as const };
    expect(guardClientPoint(paris, lyon, false)).toMatchObject({ ok: true, precision: "municipality", capped: true, lat: paris.lat });
  });
  it("point client proche du résultat serveur : le résultat serveur fait foi (coordonnées et précision)", () => {
    const near = { lat: lyon.lat + 0.005, lng: lyon.lng, precision: "housenumber" as const };
    const r = guardClientPoint(near, { ...lyon, precision: "street" }, false);
    expect(r).toMatchObject({ ok: true, precision: "street", lat: lyon.lat, capped: false, fromServer: true });
    expect(CONFIRM_TOLERANCE_KM).toBeGreaterThan(0.5);
  });
});

// ------------------------------------------------------------------ HAUT 1 : RDV « à attribuer » d'un télépro
describe("fenêtre souhaitée d'un RDV à attribuer", () => {
  it("à partir de demain, ordre des dates, 31 jours au plus", () => {
    expect(checkWishWindow("2026-05-05", "2026-05-09", "2026-05-04")).toBeNull();
    expect(checkWishWindow("2026-05-04", "2026-05-09", "2026-05-04")).toContain("demain");
    expect(checkWishWindow("2026-05-01", "2026-05-09", "2026-05-04")).toContain("demain");
    expect(checkWishWindow("2026-05-09", "2026-05-06", "2026-05-04")).toContain("après le premier");
    expect(checkWishWindow("2026-05-05", "2026-06-04", "2026-05-04")).toBeNull(); // 30 jours d'écart
    expect(checkWishWindow("2026-05-05", "2026-06-06", "2026-05-04")).toContain("31 jours");
    expect(checkWishWindow("pas-une-date", "2026-06-06", "2026-05-04")).toContain("invalides");
  });
  const base = { leadId: "6f1b1c0e-5b1e-4c0e-8f6e-0a1b2c3d4e5f", wishFrom: "2026-05-05", wishTo: "2026-05-09", durationMin: 60, location: "12 rue Test, Lyon" };
  it("schéma d'entrée : durée 15-480, adresse >= 3 caractères, point borné", () => {
    expect(pendingInputSchema.safeParse(base).success).toBe(true);
    expect(pendingInputSchema.safeParse({ ...base, durationMin: 10 }).success).toBe(false);
    expect(pendingInputSchema.safeParse({ ...base, durationMin: 500 }).success).toBe(false);
    expect(pendingInputSchema.safeParse({ ...base, location: "ab" }).success).toBe(false);
    expect(pendingInputSchema.safeParse({ ...base, point: { lat: 91, lng: 4, precision: "street" } }).success).toBe(false);
    expect(pendingInputSchema.safeParse({ ...base, point: { lat: 45.7, lng: 4.8, precision: "inconnue" } }).success).toBe(false);
    expect(pendingInputSchema.safeParse({ ...base, point: { lat: 45.7, lng: 4.8, precision: "street" } }).success).toBe(true);
  });
});

// ------------------------------------------------------------------ MOYEN 9 : troncatures visibles
describe("troncatures de chargement", () => {
  it("aucun avertissement sous les limites", () => {
    expect(overLimit(100, MAX_PENDING)).toBeNull();
    expect(overLimit(null, MAX_PENDING)).toBeNull();
    expect(truncationWarnings({ pending: null, existing: null, unavailability: null })).toEqual([]);
  });
  it("un avertissement français par limite dépassée, avec le total réel", () => {
    expect(overLimit(101, MAX_PENDING)).toBe(101);
    const w = truncationWarnings({ pending: 250, existing: 1400, unavailability: 900 });
    expect(w).toHaveLength(3);
    expect(w[0]).toContain("250 RDV à attribuer");
    expect(w[1]).toContain("1400 RDV déjà attribués");
    expect(w[2]).toContain("900 indisponibilités");
  });
});
