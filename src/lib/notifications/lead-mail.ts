import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site";
import { leadAssignedMail } from "@/lib/mail/templates";
import { activeContacts, deliver } from "./recipients";

/** Au-delà, une attribution en masse ne génère plus un mail par lead (la cloche de l'application reste la référence). */
export const MAX_LEAD_MAILS = 5;

/**
 * Mail « lead attribué » à l'assigné. Jamais à soi-même (`actorId`) ; leads de simulation et archivés ignorés ;
 * l'assigné doit être membre actif de l'organisation. Ne lève jamais : à appeler dans `after(() => ...)`.
 */
export async function mailLeadsAssigned(orgId: string, leadIds: string[], assigneeId: string | null | undefined, actorId: string): Promise<void> {
  try {
    if (!assigneeId || assigneeId === actorId || !leadIds.length) return;
    const admin = createAdminClient();
    const contact = (await activeContacts(admin, orgId, [assigneeId])).get(assigneeId);
    if (!contact) return;
    const { data } = await admin.from("leads")
      .select("id, first_name, last_name, company, phone, city, assigned_to, archived_at, is_simulation, source_id")
      .eq("org_id", orgId).eq("assigned_to", assigneeId).in("id", leadIds.slice(0, MAX_LEAD_MAILS));
    const srcIds = [...new Set((data ?? []).map((l) => l.source_id as string | null).filter((x): x is string => !!x))];
    const sources = new Map<string, string>();
    if (srcIds.length) for (const x of (await admin.from("lead_sources").select("id, name").eq("org_id", orgId).in("id", srcIds)).data ?? []) sources.set(x.id as string, x.name as string);
    for (const l of data ?? []) {
      if (l.archived_at || l.is_simulation) continue;
      const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || (l.company as string | null) || "Sans nom";
      const source = (l.source_id && sources.get(l.source_id as string)) || null;
      await deliver(contact.email, leadAssignedMail({ recipientName: contact.firstName, leadName: name, source, phone: l.phone as string | null, city: l.city as string | null, leadUrl: `${siteUrl()}/leads/${l.id}` }));
    }
  } catch { /* un e-mail raté ne bloque jamais l'action */ }
}
