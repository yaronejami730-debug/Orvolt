import "server-only";
import { createHmac } from "node:crypto";

let warned = false;
/**
 * IP hachée (HMAC-SHA256 avec sel LANDING_IP_SALT) : jamais l'IP en clair. Sans sel ou sans IP : null
 * (on ne stocke pas un hachage non salé, trivial à inverser sur l'espace IPv4).
 */
export function hashIp(ip: string | null, salt = process.env.LANDING_IP_SALT): string | null {
  if (!ip) return null;
  if (!salt) {
    if (!warned) { warned = true; console.warn("[landing] LANDING_IP_SALT absent : IP non enregistrée."); }
    return null;
  }
  return createHmac("sha256", salt).update(ip).digest("hex");
}
