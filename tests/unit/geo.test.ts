import { describe, expect, it, vi } from "vitest";
import { checkDistance, haversineKm, overlaps } from "@/lib/geo/haversine";
import { normalizeAddress } from "@/lib/geo/normalize";
import { banGeocoder, banResponseSchema, mockGeocoder, nominatimGeocoder, nominatimResponseSchema } from "@/lib/geo/providers";
import { addressKey } from "@/lib/geo/geocode";
import { appointmentInputSchema, previewSchema, rangeSchema, zoneSchema } from "@/lib/validation/appointments";

const PARIS = { lat: 48.8566, lng: 2.3522 };
const LYON = { lat: 45.764, lng: 4.8357 };
const VERSAILLES = { lat: 48.8014, lng: 2.1301 };

describe("haversine", () => {
  it("distances connues", () => {
    expect(haversineKm(PARIS, LYON)).toBeGreaterThan(390);
    expect(haversineKm(PARIS, LYON)).toBeLessThan(395);
    expect(haversineKm(PARIS, VERSAILLES)).toBeGreaterThan(16);
    expect(haversineKm(PARIS, VERSAILLES)).toBeLessThan(18);
  });
  it("identité, symétrie, antipodes", () => {
    expect(haversineKm(PARIS, PARIS)).toBe(0);
    expect(haversineKm(PARIS, LYON)).toBeCloseTo(haversineKm(LYON, PARIS), 9);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(20015.1, 0);
    expect(haversineKm({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 })).toBeLessThan(25); // anti-méridien
  });
});

describe("checkDistance", () => {
  const zone = { base_lat: PARIS.lat, base_lng: PARIS.lng, radius_km: 30, active: true };
  it("ok / over_radius", () => {
    expect(checkDistance(VERSAILLES, zone)).toMatchObject({ status: "ok", radius_km: 30 });
    const far = checkDistance(LYON, zone);
    expect(far.status).toBe("over_radius");
    expect(far.distance_km).toBeGreaterThan(390);
  });
  it("limite incluse : distance == rayon => ok", () => {
    const d = checkDistance(VERSAILLES, zone).distance_km!;
    expect(checkDistance(VERSAILLES, { ...zone, radius_km: d }).status).toBe("ok");
    expect(checkDistance(VERSAILLES, { ...zone, radius_km: d - 0.1 }).status).toBe("over_radius");
  });
  it("no_zone : absente, inactive, rayon invalide ; no_geocode : adresse non résolue ou coordonnées invalides", () => {
    expect(checkDistance(VERSAILLES, null).status).toBe("no_zone");
    expect(checkDistance(VERSAILLES, { ...zone, active: false }).status).toBe("no_zone");
    expect(checkDistance(VERSAILLES, { ...zone, radius_km: 0 }).status).toBe("no_zone");
    expect(checkDistance(VERSAILLES, { ...zone, base_lat: 99 }).status).toBe("no_zone");
    expect(checkDistance(null, zone).status).toBe("no_geocode");
    expect(checkDistance({ lat: NaN, lng: 1 }, zone).status).toBe("no_geocode");
    expect(checkDistance({ lat: 120, lng: 1 }, zone).status).toBe("no_geocode");
    expect(checkDistance(null, null).status).toBe("no_zone"); // sans zone, aucun contrôle possible
  });
});

describe("chevauchement", () => {
  const t = (h: number) => new Date(Date.UTC(2031, 0, 1, h));
  it("détecte les recoupements, pas les bornes contiguës", () => {
    expect(overlaps({ start: t(9), end: t(11) }, { start: t(10), end: t(12) })).toBe(true);
    expect(overlaps({ start: t(9), end: t(12) }, { start: t(10), end: t(11) })).toBe(true);
    expect(overlaps({ start: t(9), end: t(10) }, { start: t(10), end: t(11) })).toBe(false);
    expect(overlaps({ start: t(11), end: t(12) }, { start: t(9), end: t(10) })).toBe(false);
    expect(overlaps({ start: t(9).toISOString(), end: t(10).toISOString() }, { start: t(9), end: t(10) })).toBe(true);
  });
});

describe("normalisation et clé de cache", () => {
  it("accents, casse, ponctuation, espaces", () => {
    expect(normalizeAddress("  10, Rue de l'Église — 75001  PARIS ")).toBe("10 rue de l eglise 75001 paris");
    expect(normalizeAddress("Épinay-sur-Seine")).toBe("epinay sur seine");
  });
  it("clé = sha256 stable, insensible à la forme", () => {
    const k = addressKey("10 Rue de l'Église, Paris");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(addressKey("10 rue de l eglise PARIS")).toBe(k);
    expect(addressKey("11 rue de l eglise PARIS")).not.toBe(k);
  });
});

describe("fournisseurs de géocodage", () => {
  it("BAN : réponse valide, aucune réponse, score faible, réponse hostile", async () => {
    const ok = JSON.stringify({ features: [{ geometry: { coordinates: [2.35, 48.85] }, properties: { label: "10 Rue de Rivoli 75004 Paris", score: 0.9 } }] });
    expect(await banGeocoder(async () => ({ status: 200, body: ok })).geocode("x")).toMatchObject({ lat: 48.85, lng: 2.35, provider: "ban" });
    expect(await banGeocoder(async () => ({ status: 200, body: '{"features":[]}' })).geocode("x")).toBeNull();
    const low = JSON.stringify({ features: [{ geometry: { coordinates: [2, 48] }, properties: { label: "x", score: 0.1 } }] });
    expect(await banGeocoder(async () => ({ status: 200, body: low })).geocode("x")).toBeNull();
    await expect(banGeocoder(async () => ({ status: 200, body: '{"features":[{"geometry":{"coordinates":[500,48]},"properties":{"label":"x"}}]}' })).geocode("x")).rejects.toThrow();
    await expect(banGeocoder(async () => ({ status: 503 })).geocode("x")).rejects.toThrow(/503/);
    expect(banResponseSchema.safeParse({ features: "nope" }).success).toBe(false);
  });
  it("Nominatim : lat/lon en chaînes, validation des bornes", async () => {
    const ok = JSON.stringify([{ lat: "45.76", lon: "4.83", display_name: "Lyon, France" }]);
    expect(await nominatimGeocoder(async () => ({ status: 200, body: ok })).geocode("lyon")).toMatchObject({ lat: 45.76, lng: 4.83, provider: "nominatim" });
    expect(await nominatimGeocoder(async () => ({ status: 200, body: "[]" })).geocode("zz")).toBeNull();
    expect(nominatimResponseSchema.safeParse([{ lat: "95", lon: "1", display_name: "x" }]).success).toBe(false);
  });
  it("mock déterministe : villes connues, introuvable, hachage stable", async () => {
    const g = mockGeocoder();
    expect(await g.geocode("1 place d'Armes, Versailles")).toMatchObject({ lat: 48.8014, provider: "mock" });
    expect(await g.geocode("Adresse introuvable zzz")).toBeNull();
    expect(await g.geocode("")).toBeNull();
    expect(await g.geocode("12 rue X, Ville Inconnue")).toEqual(await g.geocode("12 rue X, Ville Inconnue"));
  });
  it("le fournisseur de repli peut être appelé quand le premier échoue (ordre des appels)", async () => {
    const calls: string[] = [];
    const first = vi.fn(async () => { calls.push("ban"); throw new Error("down"); });
    const second = vi.fn(async () => { calls.push("nominatim"); return { lat: 1, lng: 1, label: "x", provider: "nominatim" }; });
    let result = null;
    for (const g of [first, second]) { try { result = await g(); if (result) break; } catch { /* suivant */ } }
    expect(calls).toEqual(["ban", "nominatim"]);
    expect(result).not.toBeNull();
  });
});

describe("schémas Zod rendez-vous", () => {
  const base = { leadId: crypto.randomUUID(), assignedTo: crypto.randomUUID(), startsAt: "2031-06-10T09:00:00.000Z", durationMin: 60 };
  it("accepte une saisie valide", () => expect(appointmentInputSchema.safeParse({ ...base, location: "10 rue de Rivoli, Paris" }).success).toBe(true));
  it("refuse durée hors bornes, date invalide, motif trop court, lieu trop court", () => {
    expect(appointmentInputSchema.safeParse({ ...base, durationMin: 10 }).success).toBe(false);
    expect(appointmentInputSchema.safeParse({ ...base, durationMin: 600 }).success).toBe(false);
    expect(appointmentInputSchema.safeParse({ ...base, startsAt: "demain" }).success).toBe(false);
    expect(appointmentInputSchema.safeParse({ ...base, overrideReason: "ok" }).success).toBe(false);
    expect(appointmentInputSchema.safeParse({ ...base, location: "ab" }).success).toBe(false);
    expect(appointmentInputSchema.safeParse({ ...base, assignedTo: "x" }).success).toBe(false);
  });
  it("aperçu, période, zone", () => {
    expect(previewSchema.safeParse({ leadId: base.leadId, assignedTo: base.assignedTo }).success).toBe(true);
    expect(rangeSchema.safeParse({ from: "2031-01-01T00:00:00Z", to: "2031-06-01T00:00:00Z" }).success).toBe(false);
    expect(rangeSchema.safeParse({ from: "2031-01-01T00:00:00Z", to: "2031-01-08T00:00:00Z" }).success).toBe(true);
    expect(zoneSchema.safeParse({ userId: base.assignedTo, baseAddress: "Paris 75001", radiusKm: 4 }).success).toBe(false);
    expect(zoneSchema.safeParse({ userId: base.assignedTo, baseAddress: "Paris 75001", radiusKm: 30 }).success).toBe(true);
    expect(zoneSchema.safeParse({ userId: base.assignedTo, baseAddress: "Paris 75001", radiusKm: 201 }).success).toBe(false);
  });
});
