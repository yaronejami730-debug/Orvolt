import { describe, expect, it } from "vitest";
import { TtlCache, scopeKey } from "@/lib/dashboard/cache";
import { conversionRate, delta, deltaPoints, fmtEuro, fmtPercent } from "@/lib/dashboard/format";
import { PeriodError, parisToday, resolvePeriod, shiftDay, startOfParisDay } from "@/lib/dashboard/period";
import { dashParamsSchema } from "@/lib/validation/dashboard";

describe("périodes (Europe/Paris)", () => {
  const now = new Date("2031-03-15T10:30:00Z");
  it("minuit de Paris : heure d'été (UTC+2) et d'hiver (UTC+1), changement d'heure", () => {
    expect(startOfParisDay("2031-07-01").toISOString()).toBe("2031-06-30T22:00:00.000Z");
    expect(startOfParisDay("2031-01-10").toISOString()).toBe("2031-01-09T23:00:00.000Z");
    expect(startOfParisDay("2031-03-30").toISOString()).toBe("2031-03-29T23:00:00.000Z"); // dernier dimanche de mars : veille en UTC+1
    expect(startOfParisDay("2031-03-31").toISOString()).toBe("2031-03-30T22:00:00.000Z"); // lendemain en UTC+2
  });
  it("7 / 30 / 90 jours : n jours calendaires, aujourd'hui inclus", () => {
    const p = resolvePeriod({ preset: "7d" }, now);
    expect(p.fromDay).toBe("2031-03-09");
    expect(p.toDay).toBe("2031-03-16");
    expect(p.days).toBe(7);
    expect(resolvePeriod({ preset: "30d" }, now).days).toBe(30);
    expect(resolvePeriod({ preset: "90d" }, now).days).toBe(90);
  });
  it("mois en cours : du 1er à aujourd'hui inclus", () => {
    const p = resolvePeriod({ preset: "month" }, now);
    expect(p.fromDay).toBe("2031-03-01");
    expect(p.toDay).toBe("2031-03-16");
    expect(p.days).toBe(15);
  });
  it("période précédente : même durée, immédiatement avant, sans trou ni chevauchement", () => {
    for (const preset of ["7d", "30d", "month"] as const) {
      const p = resolvePeriod({ preset }, now);
      expect(p.prevTo.getTime()).toBe(p.from.getTime());
      expect(p.prevTo.getTime() - p.prevFrom.getTime()).toBeGreaterThan(0);
    }
    const p = resolvePeriod({ preset: "7d" }, now);
    expect(p.prevFrom.toISOString()).toBe(startOfParisDay("2031-03-02").toISOString());
  });
  it("personnalisée : fin incluse, bornes validées (≤ 366 jours, fin ≥ début)", () => {
    const p = resolvePeriod({ preset: "custom", from: "2031-01-01", to: "2031-01-31" }, now);
    expect(p.days).toBe(31);
    expect(p.toDay).toBe("2031-02-01");
    expect(resolvePeriod({ preset: "custom", from: "2031-01-05", to: "2031-01-05" }, now).days).toBe(1);
    expect(resolvePeriod({ preset: "custom", from: "2030-03-01", to: "2031-02-28" }, now).days).toBe(365);
    expect(() => resolvePeriod({ preset: "custom", from: "2030-01-01", to: "2031-03-01" }, now)).toThrow(/ne peut pas dépasser 366 jours/);
    expect(() => resolvePeriod({ preset: "custom", from: "2031-02-02", to: "2031-02-01" }, now)).toThrow(PeriodError);
    expect(() => resolvePeriod({ preset: "custom", from: "2031-02-30", to: "2031-03-01" }, now)).toThrow(/invalide/);
    expect(() => resolvePeriod({ preset: "custom", from: "x", to: "y" }, now)).toThrow(PeriodError);
    expect(() => resolvePeriod({ preset: "custom" }, now)).toThrow(/début et de fin/);
  });
  it("granularité : jour jusqu'à 62 jours, sinon semaine", () => {
    expect(resolvePeriod({ preset: "30d" }, now).bucket).toBe("day");
    expect(resolvePeriod({ preset: "90d" }, now).bucket).toBe("week");
  });
  it("jour de Paris proche de minuit UTC", () => {
    expect(parisToday(new Date("2031-06-30T22:30:00Z"))).toBe("2031-07-01");
    expect(parisToday(new Date("2031-06-30T21:30:00Z"))).toBe("2031-06-30");
    expect(shiftDay("2031-03-01", -1)).toBe("2031-02-28");
  });
  it("schéma Zod des paramètres", () => {
    expect(dashParamsSchema.safeParse({ preset: "30d" }).success).toBe(true);
    expect(dashParamsSchema.safeParse({ preset: "1an" }).success).toBe(false);
    expect(dashParamsSchema.safeParse({ preset: "custom", from: "demain" }).success).toBe(false);
    expect(dashParamsSchema.safeParse({ preset: "7d", user: "pas-un-uuid" }).success).toBe(false);
    expect(dashParamsSchema.safeParse({ preset: "7d", source: crypto.randomUUID(), user: null }).success).toBe(true);
  });
});

describe("deltas et taux", () => {
  it("delta en % avec cas limites", () => {
    expect(delta(150, 100)).toEqual({ pct: 50, direction: "up" });
    expect(delta(50, 100)).toEqual({ pct: -50, direction: "down" });
    expect(delta(100, 100)).toEqual({ pct: 0, direction: "flat" });
    expect(delta(0, 0)).toEqual({ pct: 0, direction: "flat" });
    expect(delta(5, 0)).toEqual({ pct: null, direction: "up" }); // « nouveau »
    expect(delta(0, 8)).toEqual({ pct: -100, direction: "down" });
    expect(delta(1, 3).pct).toBe(-66.7);
  });
  it("taux de conversion = gagnés / (gagnés + perdus), null sans clôture", () => {
    expect(conversionRate(3, 2)).toBe(0.6);
    expect(conversionRate(0, 4)).toBe(0);
    expect(conversionRate(5, 0)).toBe(1);
    expect(conversionRate(0, 0)).toBeNull();
  });
  it("écart en points", () => {
    expect(deltaPoints(0.6, 0.5)).toBe(10);
    expect(deltaPoints(0.5, 0.6)).toBe(-10);
    expect(deltaPoints(null, 0.5)).toBeNull();
    expect(deltaPoints(0.5, null)).toBeNull();
  });
  it("formats français", () => {
    expect(fmtPercent(0.6)).toMatch(/^60\s%$/);
    expect(fmtPercent(null)).toBe("–");
    expect(fmtPercent(0.3333)).toMatch(/^33,3\s%$/);
    expect(fmtEuro(7000)).toMatch(/^7\s000\s€$/);
  });
});

describe("cache : aucune fuite entre organisations / utilisateurs / périmètres", () => {
  const params = { preset: "30d" };
  const a = { org: "orgA", user: "u1", scope: "all" as const };
  it("clés distinctes par org, utilisateur et périmètre", () => {
    const keys = new Set([
      scopeKey(a, "kpi", params), scopeKey({ ...a, org: "orgB" }, "kpi", params), scopeKey({ ...a, user: "u2" }, "kpi", params),
      scopeKey({ ...a, scope: "own" }, "kpi", params), scopeKey(a, "status", params), scopeKey(a, "kpi", { preset: "7d" }),
    ]);
    expect(keys.size).toBe(6);
  });
  it("durée de vie courte et chargement unique pendant la validité", async () => {
    let t = 0, loads = 0;
    const c = new TtlCache(1000, 10, () => t);
    const load = async () => ++loads;
    expect(await c.get("k", load)).toBe(1);
    expect(await c.get("k", load)).toBe(1);
    t = 1500;
    expect(await c.get("k", load)).toBe(2);
    expect(await c.get(scopeKey({ ...a, org: "orgB" }, "kpi", params), load)).toBe(3); // autre org : jamais le résultat de la première
  });
  it("borne la taille", async () => {
    const c = new TtlCache(1000, 3);
    for (let i = 0; i < 10; i++) await c.get(`k${i}`, async () => i);
    expect(c.size).toBeLessThanOrEqual(3);
  });
});

describe("cache : plafonds mémoire", () => {
  it("borne la taille totale (octets) et refuse les valeurs ou clés démesurées", async () => {
    const c = new TtlCache(60_000, 1000, () => 0, 10_000, 200);
    for (let i = 0; i < 50; i++) await c.get(`k${i}`, async () => "x".repeat(900));
    expect(c.totalBytes).toBeLessThanOrEqual(10_000);
    expect(c.size).toBeLessThan(50);
    await c.get("y".repeat(300), async () => 1); // clé trop longue
    await c.get("gros", async () => "z".repeat(5000)); // valeur > 10 % du plafond
    expect(c.size).toBeLessThan(50);
    const before = c.size;
    await c.get("y".repeat(300), async () => 1);
    expect(c.size).toBe(before);
    c.clear();
    expect(c.totalBytes).toBe(0);
  });
});
