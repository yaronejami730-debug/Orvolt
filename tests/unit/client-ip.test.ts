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
