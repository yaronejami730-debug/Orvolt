import { afterEach, describe, expect, it, vi } from "vitest";

let hdrs: Record<string, string> = {};
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => hdrs[k.toLowerCase()] ?? null }) }));

afterEach(() => { delete process.env.TRUSTED_PROXY; hdrs = {}; });

describe("clientIp", () => {
  it("ignore X-Forwarded-For sans TRUSTED_PROXY", async () => {
    hdrs = { "x-forwarded-for": "6.6.6.6" };
    const { clientIp } = await import("@/lib/rate-limit-server");
    expect(await clientIp()).toBeNull();
  });
  it("avec TRUSTED_PROXY=1 prend l'entrée de droite (ajoutée par le proxy)", async () => {
    process.env.TRUSTED_PROXY = "1";
    hdrs = { "x-forwarded-for": "6.6.6.6, 203.0.113.9" };
    const { clientIp } = await import("@/lib/rate-limit-server");
    expect(await clientIp()).toBe("203.0.113.9");
  });
});

describe("ipOrDeny / Vercel", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it("sur Vercel, lit x-vercel-forwarded-for (non forgeable)", async () => {
    vi.stubEnv("VERCEL", "1");
    hdrs = { "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "6.6.6.6" };
    const { clientIp } = await import("@/lib/rate-limit-server");
    expect(await clientIp()).toBe("198.51.100.7");
  });
  it("IP inconnue : « local » hors production, refus (null) en production", async () => {
    const { ipOrDeny } = await import("@/lib/rate-limit-server");
    expect(await ipOrDeny()).toBe("local");
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await ipOrDeny()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
