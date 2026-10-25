import "server-only";
import { RATE_LIMIT_MESSAGE, RULES } from "@/lib/rate-limit";
import { allow } from "@/lib/rate-limit-server";
import type { Permission } from "@/lib/permissions";
import { isWritable } from "@/lib/billing/access";
import { READ_ONLY_MESSAGE } from "@/lib/billing/entitlement";
import { requireSession, sessionCan, type AppSession } from "@/lib/session";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  code?: string;
  data?: T;
}

export const DENIED = "Permission insuffisante.";

/**
 * Lecture seule (abonnement inactif) : TOUTE action est bloquée sauf ces portées de lecture ou de facturation.
 * (Liste blanche : une nouvelle action d'écriture est bloquée par défaut.)
 */
const READ_SCOPES = new Set(["leads-list", "agenda-list", "agenda-preview", "dispatch-preview", "notifications", "import-report", "webhook-test", "billing", "leads-file-url"]);

/** Session + permission(s) serveur + rate limit. */
export async function guard(perms: Permission | Permission[], scope: string): Promise<{ s: AppSession } | { error: string }> {
  const s = await requireSession();
  const list = Array.isArray(perms) ? perms : [perms];
  if (!list.every((p) => sessionCan(s, p))) return { error: DENIED };
  if (!(await allow(scope, s.user.id, RULES.sensitive))) return { error: RATE_LIMIT_MESSAGE };
  if (!READ_SCOPES.has(scope) && !(await isWritable(s.org.id))) return { error: READ_ONLY_MESSAGE };
  return { s };
}

export function mapDbError(message: string | undefined, fallback = "Opération impossible. Réessayez."): string {
  if (!message) return fallback;
  if (message.includes("duplicate key") || message.includes("23505")) return "Ce nom est déjà utilisé.";
  if (message.includes("row-level security") || message.includes("forbidden")) return DENIED;
  if (message.includes("final_status_no_outgoing")) return "Un statut final n'a pas de transition sortante.";
  if (message.includes("transition_forbidden")) return "Transition non autorisée pour votre rôle.";
  if (message.includes("invalid_assignee")) return "Ce membre ne peut pas être assigné (inactif).";
  if (message.includes("violates foreign key") || message.includes("23503")) return "Référence invalide (statut, source ou membre).";
  if (/grants_escalation|grants_locked_role|grants_forbidden/.test(message)) return "Vous ne pouvez accorder que des statuts que vous pouvez vous-même poser (et pas à votre propre rôle ni à l'Administrateur).";
  if (message.includes("org_read_only")) return READ_ONLY_MESSAGE;
  if (message.includes("system_source")) return "Cette source système est verrouillée.";
  return fallback;
}

/** Session + au moins UNE des permissions + rate limit. */
export async function guardAny(perms: Permission[], scope: string): Promise<{ s: AppSession } | { error: string }> {
  const s = await requireSession();
  if (!perms.some((p) => sessionCan(s, p))) return { error: DENIED };
  if (!(await allow(scope, s.user.id, RULES.sensitive))) return { error: RATE_LIMIT_MESSAGE };
  if (!READ_SCOPES.has(scope) && !(await isWritable(s.org.id))) return { error: READ_ONLY_MESSAGE };
  return { s };
}
