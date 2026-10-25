import { describe, expect, it } from "vitest";
import { googleMapsSearchUrl, parseCoordinates, plausibleInFrance } from "@/lib/geo/coords";

const ok = (s: string, near?: { lat: number; lng: number }) => {
  const r = parseCoordinates(s, near);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("parseCoordinates (Google Maps, tolérant)", () => {
  it.each([
    ["43.9493, 5.7826"], ["43,9493 ; 5,7826"], ["43.9493 5.7826"], ["43.9493,5.7826"], ["  43,9493  5,7826 "], ["43.9493°, 5.7826°"],
    ["https://www.google.com/maps/place/Gordes/@43.9493,5.7826,15z/data=!3m1"], ["https://www.google.com/maps?q=43.9493,5.7826"],
    ["https://www.google.com/maps/place/x/data=!3d43.9493!4d5.7826"], ["https://maps.google.com/?ll=43.9493,5.7826&z=12"],
  ])("lit %s", (s) => {
    const r = ok(s);
    expect(r.lat).toBeCloseTo(43.9493, 4);
    expect(r.lng).toBeCloseTo(5.7826, 4);
  });
  it("longitude négative et DOM", () => {
    expect(ok("47.2184, -1.5536").lng).toBeCloseTo(-1.5536, 4);
    expect(ok("-21.1151, 55.5364").lat).toBeCloseTo(-21.1151, 4);
  });
  it("refuse : vide, format inconnu, hors bornes, hors de France, inversé", () => {
    expect(parseCoordinates("").ok).toBe(false);
    expect(parseCoordinates("Gordes").ok).toBe(false);
    expect(parseCoordinates("95, 5").ok).toBe(false);
    expect(parseCoordinates("40.7128, -74.0060")).toMatchObject({ ok: false, error: expect.stringContaining("hors de France") });
    expect(parseCoordinates("5.7826, 43.9493")).toMatchObject({ ok: false, error: expect.stringContaining("inversées") });
  });
  it("liens courts jamais résolus (anti-SSRF) : on demande les coordonnées", () => {
    const r = parseCoordinates("https://maps.app.goo.gl/AbCdEf123");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("liens courts") });
  });
  it("avertit si la position est loin de la commune / du point actuel", () => {
    expect(ok("43.9493, 5.7826", { lat: 43.95, lng: 5.78 }).warnings).toEqual([]);
    expect(ok("43.9493, 5.7826", { lat: 45.76, lng: 4.83 }).warnings[0]).toMatch(/à \d+ km/);
  });
  it("plausibilité et lien de recherche", () => {
    expect(plausibleInFrance(45.76, 4.83)).toBe(true);
    expect(plausibleInFrance(0, 0)).toBe(false);
    expect(googleMapsSearchUrl("Les Granges, 69590")).toBe("https://maps.google.com/?q=Les%20Granges%2C%2069590");
  });
});
