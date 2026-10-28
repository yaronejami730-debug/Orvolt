/** Limiteur à fenêtre glissante. Le store est une interface : brancher Redis = implémenter RateLimitStore. */
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}
export interface RateLimitStore {
  /** Enregistre un hit pour `key` et retourne les horodatages (ms) encore dans la fenêtre, hit inclus. */
  hit(key: string, now: number, windowMs: number): Promise<number[]>;
  /** Annule le dernier hit (requête refusée : elle ne doit pas prolonger le blocage). */
  undo(key: string, now: number): Promise<void>;
}

export class MemoryStore implements RateLimitStore {
  private hits = new Map<string, number[]>();
  private calls = 0;

  async hit(key: string, now: number, windowMs: number) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    this.hits.set(key, list);
    if (++this.calls % 500 === 0) this.sweep(now, windowMs);
    return list;
  }
  async undo(key: string, now: number) {
    const list = this.hits.get(key);
    const i = list ? list.lastIndexOf(now) : -1;
    if (list && i >= 0) list.splice(i, 1);
  }
  private sweep(now: number, windowMs: number) {
    for (const [k, v] of this.hits) if (v.every((t) => now - t >= windowMs)) this.hits.delete(k);
  }
}

/** Décision d'un store distant atomique (Postgres) ; null = indisponible, repli sur le store mémoire. */
export type RemoteCheck = (key: string, rule: RateLimitRule) => Promise<RateLimitResult | null>;

export class RateLimiter {
  constructor(
    private store: RateLimitStore = new MemoryStore(),
    private clock: () => number = Date.now,
    private remote?: RemoteCheck,
  ) {}

  async check(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    if (this.remote) {
      try {
        const r = await this.remote(key, rule);
        if (r) return r;
      } catch {
        // base indisponible : repli mémoire (limite par instance, mieux que rien)
      }
    }
    const now = this.clock();
    const list = await this.store.hit(key, now, rule.windowMs);
    if (list.length > rule.limit) {
      const oldestAllowed = list[list.length - 1 - rule.limit]!;
      await this.store.undo(key, now);
      return { ok: false, remaining: 0, retryAfterMs: Math.max(0, oldestAllowed + rule.windowMs - now) };
    }
    return { ok: true, remaining: rule.limit - list.length, retryAfterMs: 0 };
  }
}

export const RULES = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  /** IP inconnue (TRUSTED_PROXY absent) : clé par e-mail seul, plus tolérante pour limiter le blocage ciblé d'un compte. */
  loginNoIp: { limit: 30, windowMs: 15 * 60_000 },
  signup: { limit: 5, windowMs: 60 * 60_000 },
  signupGlobal: { limit: 60, windowMs: 60 * 60_000 },
  sensitive: { limit: 30, windowMs: 60_000 },
  /** Lectures (liste des leads, agenda…) : recherche en frappe et pagination rapide ne doivent pas déclencher le blocage. */
  read: { limit: 300, windowMs: 60_000 },
  siret: { limit: 30, windowMs: 10 * 60_000 },
  signupCode: { limit: 5, windowMs: 60 * 60_000 },
  signupCodeIp: { limit: 30, windowMs: 60 * 60_000 },
  signupVerify: { limit: 15, windowMs: 15 * 60_000 },
  passwordReset: { limit: 3, windowMs: 60 * 60_000 },
  passwordResetIp: { limit: 20, windowMs: 60 * 60_000 },
  passwordResetApply: { limit: 10, windowMs: 15 * 60_000 },
  contact: { limit: 5, windowMs: 60 * 60_000 },
  contactGlobal: { limit: 100, windowMs: 60 * 60_000 },
  /** Pages d'acquisition /lp/* : par IP, par e-mail (empêche de saturer la boîte d'un tiers) et plafond global. */
  landing: { limit: 5, windowMs: 60 * 60_000 },
  landingEmail: { limit: 2, windowMs: 60 * 60_000 },
  landingGlobal: { limit: 200, windowMs: 60 * 60_000 },
} satisfies Record<string, RateLimitRule>;

/** Limiteur de base (mémoire, par instance) : tests et développement. En production, voir rate-limit-server.ts (persistant). */
export const limiter = new RateLimiter();

export const RATE_LIMIT_MESSAGE = "Trop de tentatives. Réessayez dans quelques minutes.";
