import "server-only";
import { SITE_NAME } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { orgAdminContacts, deliver, type Contact } from "@/lib/notifications/recipients";
import { seatMailDue } from "@/lib/notifications/windows";
import { paymentFailedMail, seatLimitReachedMail, subscriptionActiveMail, subscriptionCanceledMail, trialEndingMail } from "@/lib/mail/templates";
import { GRACE_DAYS, PLANS, planSeats, type PlanId } from "./plans";
import type { Mapped, OrgPatch } from "./events";

export interface BillingOrgBefore { id: string; name: string; plan: string | null; subscription_status: string; cancel_at_period_end?: boolean | null }

export type BillingMailKind = "payment_failed" | "trial_ending" | "subscription_active" | "subscription_canceled";

/**
 * Quel mail d'abonnement un événement Stripe appelle-t-il ? (pure)
 * - invoice.payment_failed -> paiement échoué ; trial_will_end -> fin d'essai ;
 * - abonnement passé à « active » depuis un autre état (hors reprise après impayé) -> abonnement actif ;
 * - suppression de l'abonnement, ou résiliation en fin de période nouvellement demandée -> résilié.
 */
export function billingMailKind(m: Pick<Mapped, "kind">, before: Pick<BillingOrgBefore, "subscription_status" | "cancel_at_period_end">, patch: OrgPatch | null): BillingMailKind | null {
  // Stripe relance 3 à 4 fois : seul le premier échec (avant « past_due ») prévient, la période de grâce court dès lors.
  if (m.kind === "payment_failed") return before.subscription_status === "past_due" ? null : "payment_failed";
  if (m.kind === "trial_will_end") return "trial_ending";
  if (m.kind === "deleted") return before.subscription_status === "canceled" ? null : "subscription_canceled";
  if (m.kind === "subscription" && patch) {
    if (patch.cancel_at_period_end === true && !before.cancel_at_period_end) return "subscription_canceled";
    if (patch.subscription_status === "active" && !["active", "past_due", "unpaid"].includes(before.subscription_status)) return "subscription_active";
  }
  return null;
}

/** Envoie le mail d'abonnement aux administrateurs de l'organisation. L'idempotence est celle de stripe_events (un événement = un traitement). Ne lève jamais. */
export async function sendBillingMails(m: Mapped, org: BillingOrgBefore, patch: OrgPatch | null, now = new Date()): Promise<void> {
  try {
    const kind = billingMailKind(m, org, patch);
    if (!kind) return;
    const to: Contact[] = await orgAdminContacts(org.id);
    const plan = (patch?.plan ?? org.plan) as PlanId | null;
    const planName = plan && plan in PLANS ? PLANS[plan].name : null;
    await Promise.all(to.map(async (c) => {
      const first = c.firstName;
      const body =
        kind === "payment_failed" ? paymentFailedMail({ firstName: first, orgName: org.name, graceEndsAt: new Date(now.getTime() + GRACE_DAYS * 86_400_000) })
        : kind === "trial_ending" ? trialEndingMail({ firstName: first, orgName: org.name, daysLeft: 3, planName })
        : kind === "subscription_canceled" ? subscriptionCanceledMail({ firstName: first, orgName: org.name, endsAt: patch?.current_period_end ?? null })
        : subscriptionActiveMail({ firstName: first, planName: planName ?? SITE_NAME, seats: plan ? planSeats(plan) : null, nextBillingAt: patch?.current_period_end ?? null });
      await deliver(c.email, body);
    }));
  } catch { /* un e-mail raté ne fait jamais échouer le webhook */ }
}

/**
 * Prévient les administrateurs que toutes les places sont prises (une invitation vient d'être refusée).
 * Anti-spam : au plus un mail par semaine et par organisation (réservation atomique de seat_limit_mail_sent_at). Ne lève jamais.
 */
export async function notifySeatLimitReached(orgId: string, seats: number): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: self } = await admin.from("organizations").select("id, name, plan, parent_org_id, seat_limit_mail_sent_at").eq("id", orgId).maybeSingle();
    if (!self) return;
    // La régie maître paie : c'est elle qu'on prévient.
    const billingId = (self.parent_org_id as string | null) ?? orgId;
    const { data: bill } = billingId === orgId ? { data: self } : await admin.from("organizations").select("id, name, plan, seat_limit_mail_sent_at").eq("id", billingId).maybeSingle();
    if (!bill) return;
    const now = new Date();
    if (!seatMailDue(bill.seat_limit_mail_sent_at as string | null, now)) return;
    const prior = bill.seat_limit_mail_sent_at as string | null;
    const q = admin.from("organizations").update({ seat_limit_mail_sent_at: now.toISOString() }).eq("id", billingId);
    const { data: won } = await (prior ? q.eq("seat_limit_mail_sent_at", prior) : q.is("seat_limit_mail_sent_at", null)).select("id");
    if (!won?.length) return; // une autre requête vient de prévenir
    const plan = bill.plan as PlanId | null;
    for (const c of await orgAdminContacts(billingId)) {
      await deliver(c.email, seatLimitReachedMail({ firstName: c.firstName, orgName: bill.name as string, planName: plan && plan in PLANS ? PLANS[plan].name : "actuelle", seats }));
    }
  } catch { /* ignoré */ }
}
