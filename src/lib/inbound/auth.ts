import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { verifySignature } from "@/lib/automation/signature";

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** Jeton public opaque (dans l'URL) : 256 bits. */
export const generateToken = () => randomBytes(32).toString("base64url");
/** Secret : affiché une seule fois ; seul son hachage est conservé. */
export function generateSecret(): { secret: string; hash: string; prefix: string } {
  const secret = `lfs_${randomBytes(32).toString("base64url")}`;
  return { secret, hash: sha256Hex(secret), prefix: secret.slice(0, 8) };
}

/** Comparaison en temps constant de deux chaînes hexadécimales de même longueur. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Le secret présenté (en-tête, verify_token, google_key) correspond-il au hachage stocké ? */
export function verifySecret(provided: string | null | undefined, storedHash: string): boolean {
  if (!provided || provided.length > 200) return false;
  return safeEqualHex(sha256Hex(provided), storedHash);
}

/**
 * Signature HMAC optionnelle : `X-LeadForge-Signature: t=<ts>,v1=<hmac>` calculée sur `ts.corps` avec le SECRET
 * de l'endpoint comme clé. Le serveur le re-dérive (HKDF) : la base ne contient que son hachage, inutilisable pour signer.
 * Une signature valide peut être rejouée pendant 5 minutes (tolérance d'horloge) ; le dédoublonnage limite l'effet.
 */
export function verifyBodySignature(header: string | null, secret: string, body: string, nowSeconds?: number): boolean {
  if (!header) return false;
  return verifySignature(secret, header, body, 300, nowSeconds);
}

export function ipHash(ip: string | null, salt: string): string {
  return sha256Hex(`${salt}:${ip ?? "unknown"}`).slice(0, 32);
}

/** IP client : en-tête de proxy uniquement si TRUSTED_PROXY=1 (sinon inconnue). */
export function ipFromHeaders(get: (name: string) => string | null, env: Record<string, string | undefined> = process.env): string | null {
  if (env.TRUSTED_PROXY !== "1") return null;
  const parts = get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean);
  return parts?.[parts.length - 1] ?? get("x-real-ip") ?? null;
}

// ---------------------------------------------------------------- clé d'application
const DEV_KEY = "leadforge-dev-inbound-key-not-for-production";

/**
 * Clé maîtresse INBOUND_SECRET_KEY (32 caractères minimum). Exigée en production ; la valeur de développement y est refusée.
 * Hors production, repli sur le sel de signature, puis sur une constante locale.
 */
export function inboundKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.INBOUND_SECRET_KEY;
  const prod = env.NODE_ENV === "production";
  if (raw && raw !== DEV_KEY && raw.length >= 32) return Buffer.from(raw, "utf8");
  if (prod) throw new Error("INBOUND_SECRET_KEY manquante, trop courte (32 caractères minimum) ou égale à la valeur de développement.");
  return Buffer.from(raw && raw.length >= 32 ? raw : (env.WEBHOOK_SIGNING_SALT ?? DEV_KEY).padEnd(32, "x"), "utf8");
}

const hkdf = (key: Buffer, salt: string, info: string, len = 32) => Buffer.from(hkdfSync("sha256", key, salt, info, len));

/** Secret d'un endpoint : dérivé (jamais stocké en clair) ; régénéré en incrémentant la version. */
export function deriveEndpointSecret(endpointId: string, version: number, env: Record<string, string | undefined> = process.env): string {
  return `lfs_${hkdf(inboundKey(env), endpointId, `leadforge-inbound-secret:v${version}`).toString("base64url")}`;
}
export function newEndpointSecret(endpointId: string, version: number, env?: Record<string, string | undefined>) {
  const secret = deriveEndpointSecret(endpointId, version, env);
  return { secret, hash: sha256Hex(secret), prefix: secret.slice(0, 8) };
}

/** Chiffrement AES-256-GCM (secret d'application Meta). Format : v1.<iv>.<tag>.<données>. */
export function encryptSecret(plain: string, env: Record<string, string | undefined> = process.env): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", hkdf(inboundKey(env), "app-secret", "leadforge-inbound-aes"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}
export function decryptSecret(blob: string, env: Record<string, string | undefined> = process.env): string | null {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", hkdf(inboundKey(env), "app-secret", "leadforge-inbound-aes"), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** X-Hub-Signature-256 de Meta : sha256=<hex(HMAC(app secret, corps brut))>. */
export function verifyMetaSignature(header: string | null, appSecret: string, body: string): boolean {
  const m = header?.match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  return safeEqualHex(createHmac("sha256", appSecret).update(body).digest("hex"), m[1]!);
}

/** Sel du hachage d'IP : obligatoire en production (pas de valeur par défaut devinable). */
export function ipSalt(env: Record<string, string | undefined> = process.env): string {
  const s = env.WEBHOOK_SIGNING_SALT;
  if (s && s.length >= 16 && s !== "dev-insecure-salt") return s;
  if (env.NODE_ENV === "production") throw new Error("WEBHOOK_SIGNING_SALT manquant ou trop faible.");
  return "dev-ip-salt";
}
