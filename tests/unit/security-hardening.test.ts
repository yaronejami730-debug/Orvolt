import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboard/cache", () => ({ dashboardCache: { clear: () => undefined } }));
vi.mock("@/lib/billing/access", () => ({ invalidateEntitlement: () => undefined }));

// Faux client admin : RPC compteur atomique + table stripe_events minimale.
const state = { attempts: 0, rows: new Map<string, { status: string; processing_at: string }>(), rpcCalls: 0 };
const admin = {
  rpc: async (fn: string) => {
    if (fn === "consume_email_attempt") {
      state.rpcCalls++;
      if (state.attempts >= 5) return { data: [{ state: "locked", code_hash: null }], error: null };
      state.attempts++; // atomique côté base : un seul incrément par appel
      return { data: [{ state: "ok", code_hash: "0".repeat(64) }], error: null };
    }
    return { data: null, error: { message: "unknown" } };
  },
  from: (table: string) => ({
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    insert: async (row: { id: string; status: string; processing_at: string }) => {
      if (table !== "stripe_events") return { error: null };
      if (state.rows.has(row.id)) return { error: { code: "23505" } };
      state.rows.set(row.id, { status: row.status, processing_at: row.processing_at });
      return { error: null };
    },
    update: (patch: Record<string, unknown>) => {
      const f: Record<string, unknown> = {};
      const q = {
        eq: (c: string, v: unknown) => { f[c] = v; return q; },
        lt: (c: string, v: string) => { f[`lt:${c}`] = v; return q; },
        select: async () => {
          const r = state.rows.get(f.id as string);
          if (!r || r.status !== f.status || !(r.processing_at < (f["lt:processing_at"] as string))) return { data: [], error: null };
          Object.assign(r, patch);
          return { data: [{ id: f.id }], error: null };
        },
      };
      return q;
    },
  }),
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const { checkCode, MAX_ATTEMPTS } = await import("@/lib/email-verification");
const { processStripeEvent } = await import("@/lib/billing/process");
const { RateLimiter, MemoryStore } = await import("@/lib/rate-limit");

beforeEach(() => { state.attempts = 0; state.rows.clear(); });

describe("checkCode : essais atomiques", () => {
  it("20 requêtes parallèles : au plus 5 comparaisons, les autres sont verrouillées", async () => {
    process.env.EMAIL_CODE_SECRET = "k".repeat(32);
    const res = await Promise.all(Array.from({ length: 20 }, () => checkCode("a@x.fr", "000000")));
    expect(res.filter((r) => r === "invalid")).toHaveLength(MAX_ATTEMPTS);
    expect(res.filter((r) => r === "locked")).toHaveLength(20 - MAX_ATTEMPTS);
  });
});

describe("processStripeEvent : reprise des événements bloqués", () => {
  const ev = { id: "evt_123456", type: "unhandled.type", created: 1_800_000_000 } as never;
  it("un événement récent en processing reste un doublon", async () => {
    state.rows.set("evt_123456", { status: "processing", processing_at: new Date().toISOString() });
    expect((await processStripeEvent(ev)).result).toBe("duplicate");
  });
  it("un événement bloqué > 5 min est repris puis traité", async () => {
    state.rows.set("evt_123456", { status: "processing", processing_at: new Date(Date.now() - 6 * 60_000).toISOString() });
    expect((await processStripeEvent(ev)).result).toBe("ignored");
  });
  it("un événement déjà traité reste un doublon", async () => {
    state.rows.set("evt_123456", { status: "processed", processing_at: new Date(Date.now() - 3_600_000).toISOString() });
    expect((await processStripeEvent(ev)).result).toBe("duplicate");
  });
});

describe("RateLimiter distant", () => {
  const rule = { limit: 2, windowMs: 1000 };
  it("utilise la décision du store distant", async () => {
    const l = new RateLimiter(new MemoryStore(), Date.now, async () => ({ ok: false, remaining: 0, retryAfterMs: 42 }));
    expect(await l.check("k", rule)).toEqual({ ok: false, remaining: 0, retryAfterMs: 42 });
  });
  it("repli mémoire si le distant échoue ou renvoie null", async () => {
    for (const remote of [async () => null, async () => { throw new Error("db"); }]) {
      const l = new RateLimiter(new MemoryStore(), Date.now, remote);
      expect((await l.check("k", rule)).ok).toBe(true);
      await l.check("k", rule);
      expect((await l.check("k", rule)).ok).toBe(false);
    }
  });
});
