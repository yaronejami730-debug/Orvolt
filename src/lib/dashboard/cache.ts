/** Cache mémoire à durée de vie courte. La clé inclut OBLIGATOIREMENT organisation, utilisateur et périmètre de permissions. */
export interface CacheScope {
  org: string;
  user: string;
  scope: "all" | "own";
}
export const scopeKey = (s: CacheScope, name: string, params: unknown) => `${s.org}|${s.user}|${s.scope}|${name}|${JSON.stringify(params)}`;

export class TtlCache {
  private store = new Map<string, { exp: number; size: number; value: unknown }>();
  private bytes = 0;
  /** ttlMs : durée de vie ; max : nombre d'entrées ; maxBytes : taille totale approximative (clés + valeurs). */
  constructor(private ttlMs = 15_000, private max = 500, private now: () => number = Date.now, private maxBytes = 4_000_000, private maxKey = 2_000) {}
  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.exp > this.now()) return hit.value as T;
    if (hit) this.drop(key);
    const value = await load();
    const size = key.length + JSON.stringify(value ?? null).length;
    // Une clé démesurée ou une valeur trop grosse n'est jamais mise en cache (protège la mémoire du process).
    if (key.length > this.maxKey || size > this.maxBytes / 10) return value;
    while (this.store.size >= this.max || (this.bytes + size > this.maxBytes && this.store.size > 0)) this.drop(this.store.keys().next().value!);
    this.store.set(key, { exp: this.now() + this.ttlMs, size, value });
    this.bytes += size;
    return value;
  }
  private drop(key: string) {
    const e = this.store.get(key);
    if (e) this.bytes -= e.size;
    this.store.delete(key);
  }
  clear() { this.store.clear(); this.bytes = 0; }
  get size() { return this.store.size; }
  get totalBytes() { return this.bytes; }
}
export const dashboardCache = new TtlCache();
