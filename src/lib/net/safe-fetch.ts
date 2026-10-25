import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { isForbiddenHost } from "./ip";

export { isForbiddenHost } from "./ip";

export class UnsafeUrlError extends Error {}

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Lit le corps (UTF-8) jusqu'à maxBytes ; sinon le corps est ignoré. */
  maxBytes?: number;
}
export interface SafeFetchResult {
  status: number;
  body?: string;
}

/**
 * Appel HTTPS sortant protégé contre le SSRF et le DNS rebinding :
 * https uniquement, une seule résolution DNS, toutes les IP doivent être publiques, la connexion
 * est faite sur l'IP validée (Host et SNI = nom d'origine), aucune redirection suivie, corps ignoré.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("URL invalide.");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new UnsafeUrlError("URL https publique requise.");
  if (isForbiddenHost(url.hostname)) throw new UnsafeUrlError("Adresse non autorisée.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isForbiddenHost(a.address))) throw new UnsafeUrlError("Adresse non autorisée.");
  const pinned = addrs[0]!;

  return new Promise<SafeFetchResult>((resolve, reject) => {
    // Délai TOTAL (connexion + en-têtes + corps) : le `timeout` du socket n'est qu'un délai d'inactivité.
    const total = setTimeout(() => req.destroy(new Error("timeout")), opts.timeoutMs ?? 5000);
    const done = <T,>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(total);
      fn(v);
    };
    const req = request(
      {
        protocol: "https:",
        hostname: host,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: opts.method ?? "POST",
        headers: { ...opts.headers, ...(opts.body ? { "content-length": Buffer.byteLength(opts.body) } : {}) },
        servername: isIP(host) ? undefined : host,
        timeout: opts.timeoutMs ?? 5000,
        // Pas de seconde résolution : on renvoie l'IP déjà validée.
        lookup: (_h, options, cb) => {
          if ((options as { all?: boolean }).all) (cb as unknown as (e: null, a: unknown) => void)(null, [pinned]);
          else cb(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (!opts.maxBytes) {
          done(resolve)({ status });
          res.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes!) {
            res.destroy();
            done(reject)(new Error("réponse trop volumineuse"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => done(resolve)({ status, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", done(reject));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", done(reject));
    req.end(opts.body);
  });
}
