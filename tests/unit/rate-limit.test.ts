import { describe, expect, it } from "vitest";
import { MemoryStore, RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  const rule = { limit: 3, windowMs: 1000 };
  it("autorise jusqu'à la limite puis bloque", async () => {
    const t = 0;
    const l = new RateLimiter(new MemoryStore(), () => t);
    for (let i = 0; i < 3; i++) expect((await l.check("k", rule)).ok).toBe(true);
    const blocked = await l.check("k", rule);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
  it("la fenêtre glisse : libère après expiration", async () => {
    let t = 0;
    const l = new RateLimiter(new MemoryStore(), () => t);
    for (let i = 0; i < 3; i++) await l.check("k", rule);
    t = 500;
    expect((await l.check("k", rule)).ok).toBe(false);
    t = 1001;
    expect((await l.check("k", rule)).ok).toBe(true);
  });
  it("les clés sont indépendantes et les refus ne prolongent pas le blocage", async () => {
    let t = 0;
    const l = new RateLimiter(new MemoryStore(), () => t);
    for (let i = 0; i < 10; i++) await l.check("a", rule);
    expect((await l.check("b", rule)).ok).toBe(true);
    t = 1001;
    expect((await l.check("a", rule)).ok).toBe(true);
  });
  it("remaining décroît", async () => {
    const l = new RateLimiter();
    expect((await l.check("r", rule)).remaining).toBe(2);
    expect((await l.check("r", rule)).remaining).toBe(1);
  });
});
