import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_MS = 60_000;
export const PROOF_TTL_MS = 30 * 60_000;
export const PROOF_COOKIE = "lf_email_proof";

/** Clé de signature : EMAIL_CODE_SECRET (obligatoire en production) ; en développement, repli sur la clé de service locale. */
const key = (env: Record<string, string | undefined> = process.env): string => {
  const k = env.EMAIL_CODE_SECRET || (env.NODE_ENV !== "production" ? env.SUPABASE_SERVICE_ROLE_KEY : undefined);
  if (!k || k.length < 16) throw new Error("EMAIL_CODE_SECRET manquant");
  return k;
};
const hmac = (data: string, k: string) => createHmac("sha256", k).update(data).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
/** Empreinte NON réversible d'une adresse (suivi de conversion : relie les étapes sans stocker l'adresse). */
export const visitorKey = (email: string, k = key()) => hmac(`visitor:${normalizeEmail(email)}`, k).slice(0, 24);
/** Jeton signé « cette organisation » : lien de désinscription des relances (aucune session requise). */
export const orgToken = (purpose: string, orgId: string, k = key()) => hmac(`${purpose}:${orgId}`, k).slice(0, 32);
export const orgTokenValid = (purpose: string, orgId: string, token: string, k = key()) => same(token, orgToken(purpose, orgId, k));
/** Empreinte du code, liée à l'adresse : un code ne sert que pour l'adresse qui l'a reçu. */
export const hashCode = (email: string, code: string, k = key()) => hmac(`code:${normalizeEmail(email)}:${code}`, k);

/** Preuve signée « adresse vérifiée » (cookie httpOnly), valable 30 min et liée à l'adresse. */
export function signProof(email: string, now = Date.now(), k = key()): string {
  const body = Buffer.from(`${normalizeEmail(email)}|${now + PROOF_TTL_MS}`).toString("base64url");
  return `${body}.${hmac(`proof:${body}`, k)}`;
}
export function verifyProof(token: string | undefined, email: string, now = Date.now(), k = key()): boolean {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig || !same(sig, hmac(`proof:${body}`, k))) return false;
  const [mail, exp] = Buffer.from(body, "base64url").toString().split("|");
  return mail === normalizeEmail(email) && Number(exp) > now;
}

export type IssueResult = { ok: true; code: string } | { ok: false; reason: "cooldown"; retryInSec: number };

/** Émet un nouveau code (6 chiffres) pour l'adresse ; un renvoi n'est possible qu'après 60 s. */
export async function issueCode(rawEmail: string, now = Date.now()): Promise<IssueResult> {
  const email = normalizeEmail(rawEmail);
  const db = createAdminClient();
  const { data: row } = await db.from("email_verifications").select("last_sent_at").eq("email", email).maybeSingle();
  if (row) {
    const wait = new Date(row.last_sent_at as string).getTime() + RESEND_MS - now;
    if (wait > 0) return { ok: false, reason: "cooldown", retryInSec: Math.ceil(wait / 1000) };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await db.from("email_verifications").upsert({ email, code_hash: hashCode(email, code), expires_at: new Date(now + CODE_TTL_MS).toISOString(), attempts: 0, last_sent_at: new Date(now).toISOString() });
  if (error) throw new Error("email_verifications");
  return { ok: true, code };
}

export type CheckResult = "ok" | "invalid" | "expired" | "locked";

/** Vérifie le code saisi. Chaque essai est compté AVANT la comparaison, de façon ATOMIQUE en base (RPC : 5 maximum même en parallèle) ; un code juste est consommé. */
export async function checkCode(rawEmail: string, code: string, now = Date.now()): Promise<CheckResult> {
  const email = normalizeEmail(rawEmail);
  const db = createAdminClient();
  const { data, error } = await db.rpc("consume_email_attempt", { p_email: email, p_max: MAX_ATTEMPTS, p_now: new Date(now).toISOString() });
  if (error) throw new Error("email_verifications"); // échec fermé : jamais de comparaison sans essai compté
  const row = (Array.isArray(data) ? data[0] : data) as { state: string; code_hash: string | null } | null;
  if (!row || row.state === "expired") return "expired";
  if (row.state === "locked" || !row.code_hash) return "locked";
  if (!/^\d{6}$/.test(code) || !same(hashCode(email, code), row.code_hash)) return "invalid";
  await db.from("email_verifications").delete().eq("email", email).eq("code_hash", row.code_hash);
  return "ok";
}
