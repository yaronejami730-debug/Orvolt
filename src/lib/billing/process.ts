import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { dashboardCache } from "@/lib/dashboard/cache";
import { invalidateEntitlement } from "./access";
import { mapStripeEvent, type Mapped } from "./events";
import { sendBillingMails } from "./mails";
import type { PlanId } from "./plans";
import { trackFunnel } from "@/lib/funnel/track";

/** Un événement « processing » plus ancien que ça est considéré comme planté et peut être repris. */
export const STUCK_AFTER_MS = 5 * 60_000;

export type ProcessResult = { result: "processed" | "duplicate" | "ignored"; reason?: string; orgId?: string };

const priceIdsFromEnv = (): Partial<Record<PlanId, string | undefined>> => ({
  starter: process.env.STRIPE_PRICE_STARTER || undefined,
  pro: process.env.STRIPE_PRICE_PRO || undefined,
  business: process.env.STRIPE_PRICE_BUSINESS || undefined,
  premium: process.env.STRIPE_PRICE_PREMIUM || undefined,
});

/**
 * Applique un événement Stripe DÉJÀ vérifié (signature). Idempotent (stripe_events.id) et ordonné
 * (un événement plus ancien que le dernier appliqué à l'organisation est ignoré).
 * En cas d'erreur, la trace est retirée (Stripe rejoue) ; si le processus plante avant, la ligne reste « processing » et est reprise après 5 min.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<ProcessResult> {
  const admin = createAdminClient();
  const created = new Date(event.created * 1000).toISOString();
  const ins = await admin.from("stripe_events").insert({ id: event.id, type: event.type, event_created: created, status: "processing", processing_at: new Date().toISOString() });
  if (ins.error) {
    if (ins.error.code !== "23505") throw new Error("stripe_events");
    // Doublon : seul un événement resté « processing » depuis > 5 min (plantage en cours de traitement) est repris, atomiquement
    // (un seul rejeu gagne l'UPDATE conditionnel) ; un événement traité ou en cours récent reste un doublon.
    const stale = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const re = await admin.from("stripe_events").update({ processing_at: new Date().toISOString() }).eq("id", event.id).eq("status", "processing").lt("processing_at", stale).select("id");
    if (re.error) throw new Error("stripe_events");
    if (!re.data?.length) return { result: "duplicate" };
  }
  const finish = async (status: "processed" | "ignored", detail: string | null, orgId?: string) => {
    await admin.from("stripe_events").update({ status, detail, org_id: orgId ?? null, processed_at: new Date().toISOString() }).eq("id", event.id);
  };
  try {
    const mapped = mapStripeEvent(event, priceIdsFromEnv());
    if (!mapped) { await finish("ignored", "unhandled_or_unknown_plan"); return { result: "ignored", reason: "unhandled" }; }

    // Organisation : métadonnées posées par l'application, sinon client Stripe déjà lié ; jamais une valeur brute non vérifiée.
    const cols = "id, subscription_status, past_due_since, stripe_subscription_id, stripe_customer_id, stripe_event_at, seat_limit, name, plan, premium_since, cancel_at_period_end";
    let org = mapped.orgId ? (await admin.from("organizations").select(cols).eq("id", mapped.orgId).maybeSingle()).data : null;
    if (!org && mapped.customerId) org = (await admin.from("organizations").select(cols).eq("stripe_customer_id", mapped.customerId).maybeSingle()).data;
    if (!org) { await finish("ignored", "org_not_found"); return { result: "ignored", reason: "org_not_found" }; }

    const reject = async (reason: string) => { await finish("ignored", reason, org!.id); return { result: "ignored", reason, orgId: org!.id } as ProcessResult; };
    if (mapped.customerId && org.stripe_customer_id && org.stripe_customer_id !== mapped.customerId) return reject("customer_mismatch");
    // La liaison client Stripe <-> organisation déjà stockée prime sur metadata.org_id : un client lié à une autre organisation est refusé.
    if (mapped.customerId && mapped.orgId) {
      const owner = (await admin.from("organizations").select("id").eq("stripe_customer_id", mapped.customerId).maybeSingle()).data;
      if (owner && owner.id !== org.id) return reject("customer_owned_by_other_org"); // consigné dans stripe_events.detail
    }
    if (org.stripe_event_at && new Date(created) < new Date(org.stripe_event_at)) return reject("out_of_order");
    if (!subscriptionCoherent(mapped, org.stripe_subscription_id, event.type)) return reject("other_subscription");

    const patch = mapped.patch({ subscription_status: org.subscription_status, past_due_since: org.past_due_since, stripe_subscription_id: org.stripe_subscription_id, stripe_customer_id: org.stripe_customer_id, plan: org.plan, premium_since: org.premium_since });
    if (patch && Object.keys(patch).length) {
      const { error } = await admin.from("organizations").update({ ...patch, stripe_event_at: created }).eq("id", org.id);
      if (error) throw new Error("org_update");
    }
    // Suivi de conversion (jamais bloquant) : essai démarré / abonnement actif.
    if (patch?.subscription_status === "trialing") await trackFunnel("trial_started", { orgId: org.id, plan: patch.plan ?? org.plan });
    else if (patch?.subscription_status === "active") await trackFunnel("subscription_active", { orgId: org.id, plan: patch?.plan ?? org.plan });
    await notify(mapped, org.id, patch?.seat_limit);
    await sendBillingMails(mapped, org, patch); // e-mail aux administrateurs ; ne lève jamais
    invalidateEntitlement(org.id);
    dashboardCache.clear();
    await finish("processed", null, org.id);
    return { result: "processed", orgId: org.id };
  } catch (e) {
    await admin.from("stripe_events").delete().eq("id", event.id); // Stripe réessaiera
    throw e;
  }
}

/** Un abonnement remplacé ne doit pas écraser l'état de l'abonnement courant. */
function subscriptionCoherent(m: Mapped, currentSub: string | null, type: string): boolean {
  if (m.concerns !== "subscription" || !m.subscriptionId || !currentSub || m.subscriptionId === currentSub) return true;
  return type === "customer.subscription.created"; // un nouvel abonnement peut remplacer l'ancien ; ses mises à jour/suppressions anciennes sont ignorées
}

async function notify(m: Mapped, orgId: string, newSeatLimit: number | null | undefined) {
  const admin = createAdminClient();
  let message: string | null = null;
  if (m.kind === "payment_failed") message = "Le paiement de votre abonnement a échoué : mettez à jour votre moyen de paiement (7 jours de grâce).";
  else if (m.kind === "trial_will_end") message = "Votre période d'essai se termine dans 3 jours.";
  else if (m.kind === "subscription" && newSeatLimit !== undefined && newSeatLimit !== null) {
    const { count } = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active");
    if ((count ?? 0) > newSeatLimit) message = `Votre plan inclut ${newSeatLimit} utilisateurs mais ${count} sont actifs : désactivez ${(count ?? 0) - newSeatLimit} membre(s) dans Paramètres > Membres.`;
  }
  if (!message) return;
  const { data: admins } = await admin.from("memberships").select("user_id, role:roles!inner(is_admin)").eq("org_id", orgId).eq("status", "active").eq("role.is_admin", true).limit(5);
  for (const a of admins ?? []) {
    await admin.from("notifications").insert({ org_id: orgId, user_id: a.user_id, type: "billing", payload: { message }, dedupe_key: `billing:${m.kind}:${orgId}:${a.user_id}:${new Date().toISOString().slice(0, 10)}` });
  }
}
