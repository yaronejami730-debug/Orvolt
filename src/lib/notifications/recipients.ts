import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/mailer";
import type { MailBody } from "@/lib/mail/templates";

type Admin = ReturnType<typeof createAdminClient>;
export interface Contact { id: string; email: string; name: string | null; firstName: string | null }

const first = (n: string | null | undefined) => n?.trim().split(/\s+/)[0] || null;

/** Envoi sans exception : un échec d'e-mail ne casse jamais l'appelant. */
export async function deliver(to: string | null | undefined, body: MailBody): Promise<boolean> {
  if (!to) return false;
  try { return (await sendMail({ to, ...body })).ok; } catch { return false; }
}

/** Coordonnées des membres ACTIFS d'une organisation (un membre désactivé ne reçoit plus rien). */
export async function activeContacts(admin: Admin, orgId: string, userIds: string[]): Promise<Map<string, Contact>> {
  const out = new Map<string, Contact>();
  if (!userIds.length) return out;
  const { data: ms } = await admin.from("memberships").select("user_id").eq("org_id", orgId).eq("status", "active").in("user_id", userIds);
  const ids = (ms ?? []).map((m) => m.user_id as string);
  if (!ids.length) return out;
  const { data: ps } = await admin.from("profiles").select("id, full_name, email").in("id", ids);
  for (const p of ps ?? []) if (p.email) out.set(p.id as string, { id: p.id as string, email: p.email as string, name: (p.full_name as string | null) ?? null, firstName: first(p.full_name as string | null) });
  return out;
}

/** Administrateurs actifs (propriétaire en tête) : destinataires des mails d'abonnement. Accès hérités d'une régie maître exclus. */
export async function orgAdminContacts(orgId: string, limit = 3): Promise<Contact[]> {
  const admin = createAdminClient();
  const [{ data: org }, { data: ms }] = await Promise.all([
    admin.from("organizations").select("created_by").eq("id", orgId).maybeSingle(),
    admin.from("memberships").select("user_id, role:roles!inner(is_admin)").eq("org_id", orgId).eq("status", "active").eq("via_parent", false).eq("role.is_admin", true).limit(20),
  ]);
  const ids = (ms ?? []).map((m) => m.user_id as string);
  const owner = org?.created_by as string | null | undefined;
  const ordered = owner && ids.includes(owner) ? [owner, ...ids.filter((i) => i !== owner)] : ids;
  const contacts = await activeContacts(admin, orgId, ordered);
  return ordered.map((i) => contacts.get(i)).filter((c): c is Contact => !!c).slice(0, limit);
}
