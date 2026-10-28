import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/billing/access";
import { siteUrl } from "@/lib/site";
import { orgToken } from "@/lib/email-verification";
import { planRequired } from "@/lib/onboarding";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { onboardingReminderMail, appointmentCustomerReminderMail, appointmentReminderMail, taskReminderMail, trialEndingMail, trialExpiredMail } from "@/lib/mail/templates";
import { activeContacts, deliver, orgAdminContacts } from "./recipients";
import { dayWindow, dueOnboardingReminder, onboardingReminderWindow, dueReminders, hourWindow, taskWindow, trialDaysLeft, trialEndingWindow, trialExpiredWindow, type ReminderKind } from "./windows";

export interface NotificationsReport {
  apptDay: number; apptHour: number; apptCustomer: number; tasks: number; trialEnding: number; trialExpired: number; skippedReadOnly: number; onboardingReminder1: number; onboardingReminder2: number;
}
const BATCH = 500;
type Admin = ReturnType<typeof createAdminClient>;

/**
 * Réserve un envoi : UPDATE ... WHERE colonne IS NULL. Un seul passage (même concurrent) gagne la réservation.
 * Si l'envoi échoue, la réservation est relâchée pour que le passage suivant réessaie (dans la fenêtre de rattrapage).
 */
async function claim(admin: Admin, table: string, id: string, col: string): Promise<boolean> {
  const { data } = await admin.from(table).update({ [col]: new Date().toISOString() }).eq("id", id).is(col, null).select("id");
  return !!data?.length;
}
async function sendClaimed(admin: Admin, table: string, id: string, col: string, send: () => Promise<boolean>): Promise<boolean> {
  if (!(await claim(admin, table, id, col))) return false;
  const ok = await send().catch(() => false);
  if (!ok) await admin.from(table).update({ [col]: null }).eq("id", id);
  return ok;
}

/** Une organisation en lecture seule (essai ou abonnement terminé) ne reçoit plus de rappels d'activité. */
function writableCache() {
  const m = new Map<string, boolean>();
  return async (orgId: string) => {
    if (!m.has(orgId)) m.set(orgId, await getEntitlement(orgId).then((e) => e.writable, () => true));
    return m.get(orgId)!;
  };
}

type LeadBits = { first_name: string | null; last_name: string | null; company: string | null };
const fullName = (l: LeadBits | null) => (l ? `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() : "");
const leadLabel = (l: LeadBits | null) => fullName(l) || l?.company || (l ? "Sans nom" : "Lead");

async function appointmentReminders(admin: Admin, now: Date, r: NotificationsReport, writable: (o: string) => Promise<boolean>) {
  const { data } = await admin.from("appointments")
    .select("id, org_id, lead_id, assigned_to, starts_at, status, location_address, reminder_day_sent_at, reminder_hour_sent_at, customer_reminder_sent_at, lead:leads(first_name, last_name, company, phone, email, archived_at), org:organizations(name, phone)")
    .eq("is_simulation", false).eq("dispatch_status", "assigned").in("status", ["planned", "confirmed"])
    .gt("starts_at", hourWindow(now).from.toISOString()).lte("starts_at", dayWindow(now).to.toISOString()).order("starts_at").limit(BATCH);
  for (const a of data ?? []) {
    const lead = a.lead as unknown as (LeadBits & { phone: string | null; email: string | null; archived_at: string | null }) | null;
    const org = a.org as unknown as { name: string; phone: string | null } | null;
    const email = lead && !lead.archived_at ? lead.email?.trim() || null : null;
    const due = dueReminders(a, now, !!email);
    if (!due.length) continue;
    if (!(await writable(a.org_id as string))) { r.skippedReadOnly++; continue; }
    const contact = (await activeContacts(admin, a.org_id as string, [a.assigned_to as string])).get(a.assigned_to as string);
    const startsAt = a.starts_at as string;
    const address = a.location_address as string | null;
    const base = { recipientName: contact?.firstName ?? null, leadName: leadLabel(lead), startsAt, address, phone: lead?.phone ?? null, agentName: contact?.name ?? null, appointmentUrl: `${siteUrl()}/leads/${a.lead_id}` };
    const run = async (k: ReminderKind) => {
      if (k === "customer") {
        if (!email || !org) return;
        const sent = await sendClaimed(admin, "appointments", a.id as string, "customer_reminder_sent_at",
          () => deliver(email, appointmentCustomerReminderMail({ customerName: fullName(lead) || null, companyName: org.name, startsAt, address, agentName: contact?.name ?? null, contactPhone: org.phone })));
        if (sent) r.apptCustomer++;
        return;
      }
      if (!contact) return;
      const col = k === "hour" ? "reminder_hour_sent_at" : "reminder_day_sent_at";
      if (await sendClaimed(admin, "appointments", a.id as string, col, () => deliver(contact.email, appointmentReminderMail({ ...base, when: k })))) {
        if (k === "hour") r.apptHour++; else r.apptDay++;
      }
    };
    for (const k of due) await run(k);
  }
}

async function taskReminders(admin: Admin, now: Date, r: NotificationsReport, writable: (o: string) => Promise<boolean>) {
  const w = taskWindow(now);
  const { data } = await admin.from("tasks")
    .select("id, org_id, title, due_at, assigned_to, lead:leads(first_name, last_name, company)")
    .eq("done", false).is("reminder_sent_at", null).not("assigned_to", "is", null)
    .gt("due_at", w.from.toISOString()).lte("due_at", w.to.toISOString()).order("due_at").limit(BATCH);
  for (const t of data ?? []) {
    if (!(await writable(t.org_id as string))) { r.skippedReadOnly++; continue; }
    const contact = (await activeContacts(admin, t.org_id as string, [t.assigned_to as string])).get(t.assigned_to as string);
    if (!contact) continue;
    const lead = t.lead as unknown as LeadBits | null;
    const ok = await sendClaimed(admin, "tasks", t.id as string, "reminder_sent_at",
      () => deliver(contact.email, taskReminderMail({ recipientName: contact.firstName, title: t.title as string, dueAt: t.due_at as string, leadName: lead ? leadLabel(lead) : null, taskUrl: `${siteUrl()}/tasks` })));
    if (ok) r.tasks++;
  }
}

/** Essais applicatifs (sans abonnement Stripe) : les essais Stripe passent par customer.subscription.trial_will_end. */
async function trialMails(admin: Admin, now: Date, r: NotificationsReport) {
  const base = () => admin.from("organizations").select("id, name, trial_ends_at").eq("subscription_status", "trialing").is("stripe_subscription_id", null).is("parent_org_id", null);
  const ending = trialEndingWindow(now), expired = trialExpiredWindow(now);
  const [{ data: soon }, { data: past }] = await Promise.all([
    base().is("trial_ending_mail_sent_at", null).gt("trial_ends_at", ending.from.toISOString()).lte("trial_ends_at", ending.to.toISOString()).limit(BATCH),
    base().is("trial_expired_mail_sent_at", null).gt("trial_ends_at", expired.from.toISOString()).lte("trial_ends_at", expired.to.toISOString()).limit(BATCH),
  ]);
  for (const o of soon ?? []) {
    const to = await orgAdminContacts(o.id as string);
    if (!to.length) continue;
    const days = trialDaysLeft(o.trial_ends_at as string, now);
    const ok = await sendClaimed(admin, "organizations", o.id as string, "trial_ending_mail_sent_at",
      async () => (await Promise.all(to.map((c) => deliver(c.email, trialEndingMail({ firstName: c.firstName, orgName: o.name as string, daysLeft: days }))))).some(Boolean));
    if (ok) r.trialEnding++;
  }
  for (const o of past ?? []) {
    const to = await orgAdminContacts(o.id as string);
    if (!to.length) continue;
    const ok = await sendClaimed(admin, "organizations", o.id as string, "trial_expired_mail_sent_at",
      async () => (await Promise.all(to.map((c) => deliver(c.email, trialExpiredMail({ firstName: c.firstName, orgName: o.name as string }))))).some(Boolean));
    if (ok) r.trialExpired++;
  }
}

/**
 * Relances d'inscription : compte créé mais formule / essai jamais finalisé. Une relance vers 24 h, une vers 72 h, jamais plus
 * (colonnes *_sent_at réservées avant l'envoi), jamais après désinscription. Message de service, sans publicité.
 */
async function onboardingReminders(admin: Admin, now: Date, r: NotificationsReport) {
  if (!planRequired()) return; // sans formule exigée, il n'y a rien à « reprendre »
  for (const n of [1, 2] as const) {
    const col = n === 1 ? "onboarding_reminder1_sent_at" : "onboarding_reminder2_sent_at";
    const w = onboardingReminderWindow(now, n);
    const { data } = await admin.from("organizations")
      .select("id, name, created_at, plan, onboarded_at, stripe_subscription_id, onboarding_reminder1_sent_at, onboarding_reminder2_sent_at, reminders_optout_at")
      .is("parent_org_id", null).is("onboarded_at", null).is("stripe_subscription_id", null).eq("plan", "trial").is("reminders_optout_at", null).is(col, null)
      .gt("created_at", w.from.toISOString()).lte("created_at", w.to.toISOString()).order("created_at").limit(BATCH);
    for (const o of data ?? []) {
      const due = dueOnboardingReminder({ created_at: o.created_at as string, reminder1_sent_at: o.onboarding_reminder1_sent_at as string | null, reminder2_sent_at: o.onboarding_reminder2_sent_at as string | null, optout_at: o.reminders_optout_at as string | null, stripe_subscription_id: null, plan: o.plan as string, onboarded_at: null }, now);
      if (due !== n) continue;
      const [to] = await orgAdminContacts(o.id as string, 1); // le propriétaire seulement
      if (!to) continue;
      const stopUrl = `${siteUrl()}/api/relance/stop?o=${o.id}&t=${orgToken("relance", o.id as string)}`;
      const ok = await sendClaimed(admin, "organizations", o.id as string, col,
        () => deliver(to.email, onboardingReminderMail({ firstName: to.firstName, orgName: o.name as string, step: n, trialDays: TRIAL_DAYS, resumeUrl: `${siteUrl()}/onboarding/plan`, stopUrl })));
      if (ok) { if (n === 1) r.onboardingReminder1++; else r.onboardingReminder2++; }
    }
  }
}

/** Tâche planifiée (toutes les 15 min) : rappels de RDV (veille, 1 h, client), tâches échues, fin et fin d'essai. Idempotent. */
export async function runNotifications(now = new Date()): Promise<NotificationsReport> {
  const admin = createAdminClient();
  const r: NotificationsReport = { apptDay: 0, apptHour: 0, apptCustomer: 0, tasks: 0, trialEnding: 0, trialExpired: 0, skippedReadOnly: 0, onboardingReminder1: 0, onboardingReminder2: 0 };
  const writable = writableCache();
  // Chaque volet est isolé : une erreur sur l'un n'empêche pas les autres.
  for (const step of [() => appointmentReminders(admin, now, r, writable), () => taskReminders(admin, now, r, writable), () => trialMails(admin, now, r), () => onboardingReminders(admin, now, r)]) {
    try { await step(); } catch (e) { console.error("[cron notifications]", e instanceof Error ? e.message : e); }
  }
  return r;
}
