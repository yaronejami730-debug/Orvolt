import { timingSafeEqual } from "node:crypto";
import { sha256Hex } from "@/lib/inbound/auth";

/** Autorisation `Authorization: Bearer <CRON_SECRET>` en temps constant. Sans secret (16 caractères minimum) : refusée. */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const m = header?.match(/^Bearer (.+)$/);
  if (!m) return false;
  return timingSafeEqual(Buffer.from(sha256Hex(m[1]!), "hex"), Buffer.from(sha256Hex(secret), "hex"));
}
