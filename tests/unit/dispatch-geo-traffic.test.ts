import { describe, expect, it, vi } from "vitest";
import { mapboxProvider, tomtomProvider, withTtlCache } from "@/lib/dispatch/traffic";
import { googleMapsRoute, wazeTo } from "@/lib/dispatch/links";
import { assessPoint, mockSuggest, resolveManualAddress, suggestAddresses } from "@/lib/geo/resolve";
import { banGeocoder, mockGeocoder, type Geocoder } from "@/lib/geo/providers";
import { estimateProvider, fakeProvider, osrmProvider } from "@/lib/routing/providers";
import { configuredRouting } from "@/lib/routing/service";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const A = { lat: 45.76, lng: 4.84 };
const B = { lat: 45.77, lng: 4.89 };

describe("trafic externe optionnel : repli et secret", () => {
  const SECRET = "SECRET-KEY-123";
  it("TomTom : durée avec trafic, la clé ne sert que dans l'URL sortante", async () => {
    const seen: string[] = [];
    const p = tomtomProvider(SECRET, async (url) => { seen.push(url); return { status: 200, body: JSON.stringify({ routes: [{ summary: { travelTimeInSeconds: 1800 } }] }) }; });
    expect(await p.duration({ from: A, to: B, departAt: "2026-03-02T07:30:00Z" })).toBe(1800);
    expect(seen[0]).toContain("departAt=2026-03-02T07%3A30%3A00Z");
    expect(JSON.stringify({ name: p.name, label: p.label })).not.toContain(SECRET);
  });
  it("Mapbox : driving-traffic avec depart_at", async () => {
    const p = mapboxProvider(SECRET, async (url) => { expect(url).toContain("driving-traffic"); expect(url).toContain("depart_at="); return { status: 200, body: JSON.stringify({ routes: [{ duration: 900.5 }] }) }; });
    expect(await p.duration({ from: A, to: B, departAt: "2026-03-02T07:30:00Z" })).toBe(900.5);
  });
  it("repli (null) sur erreur HTTP, délai dépassé, JSON invalide ou quota — sans fuite de clé", async () => {
    for (const f of [
      async () => ({ status: 500 }), async () => ({ status: 429 }), async () => ({ status: 200, body: "pas du json" }),
      async () => { throw new Error(`timeout https://x/?key=${SECRET}`); },
    ]) {
      const r = await tomtomProvider(SECRET, f).duration({ from: A, to: B, departAt: "2026-03-02T07:30:00Z" });
      expect(r).toBeNull();
    }
  });
  it("cache court (TTL) : un seul appel puis expiration", async () => {
    let calls = 0; let now = 0;
    const p = withTtlCache(tomtomProvider("k", async () => { calls++; return { status: 200, body: JSON.stringify({ routes: [{ summary: { travelTimeInSeconds: 60 } }] }) }; }), 15 * 60_000, () => now);
    const leg = { from: A, to: B, departAt: "2026-03-02T07:30:00Z" };
    await p.duration(leg); await p.duration(leg);
    expect(calls).toBe(1);
    now = 16 * 60_000;
    await p.duration(leg);
    expect(calls).toBe(2);
  });
});

describe("routage", () => {
  it("OSRM : matrice durées + distances, erreur => exception (repli géré par le service)", async () => {
    const ok = osrmProvider("http://x", async (url) => {
      expect(url).toContain("/table/v1/driving/4.840000,45.760000;4.890000,45.770000?annotations=duration,distance");
      return { status: 200, body: JSON.stringify({ code: "Ok", durations: [[0, 600], [620, 0]], distances: [[0, 8000], [8100, 0]] }) };
    });
    const m = await ok.matrix([A, B]);
    expect(m.durations[0]![1]).toBe(600);
    expect(m.distances[1]![0]).toBe(8100);
    await expect(osrmProvider("http://x", async () => ({ status: 500 })).matrix([A, B])).rejects.toThrow();
    await expect(osrmProvider("http://x", async () => ({ status: 200, body: JSON.stringify({ code: "Ok", durations: [[0, null], [1, 0]], distances: [[0, 1], [1, 0]] }) })).matrix([A, B])).rejects.toThrow(/non routable/);
  });
  it("snap OSRM : distance à la route, NoSegment = non routable", async () => {
    expect(await osrmProvider("http://x", async () => ({ status: 200, body: JSON.stringify({ code: "Ok", waypoints: [{ distance: 612 }] }) })).snap!(A)).toBe(612);
    expect(await osrmProvider("http://x", async () => ({ status: 400, body: '{"code":"NoSegment"}' })).snap!(A)).toBe("unroutable");
    expect(await osrmProvider("http://x", async () => ({ status: 500 })).snap!(A)).toBeNull();
  });
  it("estimation = vol d'oiseau x 1,4, étiquetée ; fake non euclidien", async () => {
    const e = estimateProvider();
    expect(e.estimated).toBe(true);
    const m = await e.matrix([A, B]);
    expect(m.distances[0]![1]).toBeGreaterThan(5000);
    const f = fakeProvider();
    expect(f.estimated).toBe(false);
    expect((await f.snap!({ lat: 45.8, lng: 4.91 }))).toBe(2000);
    expect((await f.snap!(A))).toBe(0);
  });
  it("sélection du fournisseur selon l'environnement", () => {
    expect(configuredRouting({ ROUTING_URL: "http://127.0.0.1:56500" } as unknown as NodeJS.ProcessEnv).kind).toBe("osrm");
    expect(configuredRouting({ GEOCODER: "mock" } as unknown as NodeJS.ProcessEnv).kind).toBe("fake");
    expect(configuredRouting({} as unknown as NodeJS.ProcessEnv).kind).toBe("estimate");
    expect(() => configuredRouting({ ROUTING_PROVIDER: "fake", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
  it("liens Google Maps / Waze", () => {
    const u = googleMapsRoute(A, [B, { lat: 45.7, lng: 4.8 }])!;
    expect(u).toContain("origin=45.760000,4.840000");
    expect(u).toContain("destination=45.700000,4.800000");
    expect(u).toContain("waypoints=45.770000,4.890000");
    expect(googleMapsRoute(A, [])).toBeNull();
    expect(wazeTo(B)).toBe("https://waze.com/ul?ll=45.770000,4.890000&navigate=yes");
  });
});

describe("adresses : précision, repli en chaîne, seuils", () => {
  const none: Geocoder = { name: "ban", geocode: async () => null };
  const boom: Geocoder = { name: "nominatim", geocode: async () => { throw new Error("down"); } };
  const city = async () => ({ lat: 45.74, lng: 4.72, label: "Craponne", provider: "ban", precision: "municipality" as const });
  it("BAN : précision housenumber/street/locality/municipality et score", async () => {
    const g = banGeocoder(async () => ({ status: 200, body: JSON.stringify({ features: [{ geometry: { coordinates: [4.83, 45.76] }, properties: { label: "12 Rue X 69002 Lyon", score: 0.96, type: "housenumber", citycode: "69382" } }] }) }));
    expect(await g.geocode("12 rue X lyon")).toMatchObject({ precision: "housenumber", score: 0.96, insee: "69382", provider: "ban" });
  });
  it("saisie manuelle : BAN -> Nominatim -> centre de commune (municipality)", async () => {
    const ok: Geocoder = { name: "nominatim", geocode: async () => ({ lat: 1, lng: 2, label: "x", provider: "nominatim", precision: "street" }) };
    expect(await resolveManualAddress({ text: "lieu-dit X", postcode: "69290", city: "Craponne" }, [none, ok], city)).toMatchObject({ source: "nominatim", precision: "street" });
    expect(await resolveManualAddress({ text: "lieu-dit X", postcode: "69290", city: "Craponne" }, [none, boom], city)).toMatchObject({ source: "ban", precision: "municipality", lat: 45.74 });
    expect(await resolveManualAddress({ text: "lieu-dit X", postcode: "69290", city: "Craponne" }, [none, boom], async () => null)).toBeNull();
  });
  it("assessPoint : pas de position, approximative (sauf acceptée), hors route, non routable", () => {
    const base = { lat: 45.7, lng: 4.8, precision: "housenumber" as const, accepted: false, snapM: 30 as number | null | "unroutable" };
    expect(assessPoint(base)).toMatchObject({ ok: true, approximate: false });
    expect(assessPoint({ ...base, lat: null, lng: null })).toMatchObject({ ok: false, code: "no_position" });
    expect(assessPoint({ ...base, precision: "municipality" })).toMatchObject({ ok: false, code: "approximate" });
    expect(assessPoint({ ...base, precision: "municipality", accepted: true })).toMatchObject({ ok: true, approximate: true });
    expect(assessPoint({ ...base, snapM: 500 })).toMatchObject({ ok: true });
    const off = assessPoint({ ...base, snapM: 629 });
    expect(off).toMatchObject({ ok: false, code: "off_road" });
    expect(!off.ok && off.reason).toContain("629 m");
    expect(assessPoint({ ...base, snapM: "unroutable" })).toMatchObject({ ok: false, code: "unroutable" });
    expect(assessPoint({ ...base, snapM: null })).toMatchObject({ ok: true });
  });
  it("autocomplétion : réponse Géoplateforme, repli d'URL, mock déterministe", async () => {
    const urls: string[] = [];
    const r = await suggestAddresses("12 rue de la republique lyon", async (url) => {
      urls.push(url);
      return urls.length === 1 ? { status: 503 } : { status: 200, body: JSON.stringify({ features: [{ geometry: { coordinates: [4.8357, 45.7651] }, properties: { label: "12 Rue de la République 69002 Lyon", score: 0.97, type: "housenumber", citycode: "69382", city: "Lyon", postcode: "69002" } }] }) };
    });
    expect(urls[0]).toContain("data.geopf.fr/geocodage/search");
    expect(urls[1]).toContain("api-adresse.data.gouv.fr");
    expect(r[0]).toMatchObject({ precision: "housenumber", insee: "69382" });
    expect(await suggestAddresses("ab", async () => { throw new Error("jamais appelé"); })).toEqual([]);
    expect(mockSuggest("12 rue Voltaire Oullins")[0]).toMatchObject({ precision: "housenumber" });
    expect(mockSuggest("rue Voltaire Oullins")[0]!.precision).toBe("street");
    expect(mockSuggest("Bro")[0]!.precision).toBe("municipality");
    expect(mockSuggest("introuvable")).toEqual([]);
    expect(mockSuggest("12 rue Voltaire Oullins")).toEqual(mockSuggest("12 rue Voltaire Oullins"));
    const g = await mockGeocoder().geocode("12 rue Voltaire, 69600 Oullins");
    expect(g).toMatchObject({ precision: "housenumber" });
  });
});
