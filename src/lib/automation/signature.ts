import { createHmac, timingSafeEqual } from "node:crypto";

/** Secret de signature propre à une organisation, dérivé du sel serveur. */
export function orgWebhookSecret(salt: string, orgId: string, version = 1): string {
  return createHmac("sha256", salt).update(version <= 1 ? `org:${orgId}` : `org:${orgId}:v${version}`).digest("hex");
}

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** En-tête X-LeadForge-Signature : t=<timestamp>,v1=<hmac hex>. */
export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;
}

export function verifySignature(secret: string, header: string, body: string, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const m = header.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(signPayload(secret, ts, body), "hex");
  const got = Buffer.from(m[2]!, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

const DEV_SALT = "dev-insecure-salt";
/** Sel de signature obligatoire (quel que soit l'environnement) ; refuse le sel de développement historique. */
export function requireSigningSalt(env: Record<string, string | undefined> = process.env): string {
  const salt = env.WEBHOOK_SIGNING_SALT;
  if (!salt || salt === DEV_SALT || salt.length < 16) {
    throw new Error("WEBHOOK_SIGNING_SALT manquant ou trop faible (16 caractères minimum, hors valeur par défaut).");
  }
  return salt;
}
