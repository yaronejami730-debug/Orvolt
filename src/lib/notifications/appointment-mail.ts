import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site";
import { appointmentAssignedMail, appointmentCancelledMail } from "@/lib/mail/templates";
import { activeContacts, deliver } from "./recipients";

export type AppointmentMailKind = "assigned" | "cancelled";

const name = (l: { first_name: string | null; last_name: string | null; company: string | null } | null) =>
  l ? (`${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || l.company || "Sans nom") : "Lead";

/**
 * Mail « RDV attribué » ou « RDV annulé » à l'assigné. Jamais à soi-même (`actorId`), jamais pour une simulation
 * ni un RDV sans créneau. `userId` force le destinataire (ancien commercial lors d'une réattribution).
 * Ne lève jamais : à appeler dans `after(() => ...)`.
 */
export async function mailAppointment(kind: AppointmentMailKind, appointmentId: string, actorId: string, opts: { userId?: string; startsAt?: string } = {}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: a } = await admin.from("appointments")
      .select("id, org_id, lead_id, assigned_to, starts_at, status, location_address, is_simulation, dispatch_status, lead:leads(first_name, last_name, company, phone)")
      .eq("id", appointmentId).maybeSingle();
    const to = opts.userId ?? (a?.assigned_to as string | null);
    const startsAt = opts.startsAt ?? (a?.starts_at as string | null);
    if (!a || a.is_simulation || !to || !startsAt || to === actorId) return;
    if (kind === "assigned" && opts.userId && opts.userId !== a.assigned_to) return; // le RDV a été pris par quelqu'un d'autre entre-temps
    if (kind === "assigned" && (a.dispatch_status !== "assigned" || !["planned", "confirmed"].includes(a.status as string))) return;
    const contact = (await activeContacts(admin, a.org_id as string, [to])).get(to);
    if (!contact) return;
    const lead = a.lead as unknown as { first_name: string | null; last_name: string | null; company: string | null; phone: string | null } | null;
    const data = { recipientName: contact.firstName, leadName: name(lead), startsAt, address: a.location_address as string | null, phone: lead?.phone ?? null, agentName: contact.name, appointmentUrl: `${siteUrl()}/leads/${a.lead_id}` };
    await deliver(contact.email, kind === "assigned" ? appointmentAssignedMail(data) : appointmentCancelledMail(data));
  } catch { /* un e-mail raté ne bloque jamais l'action */ }
}
