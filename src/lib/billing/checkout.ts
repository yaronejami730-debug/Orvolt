import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { EXTRA_SEAT_LOOKUP_PREFIX, extraSeatLookupKey, isPlanId, lookupKeyFor, MAX_EXTRA_SEATS, PLANS, supportsExtraSeats, TRIAL_DAYS, type BillingInterval, type PlanId } from "./plans";
import { premiumLookupKey, premiumMonthAt, premiumTierIndex } from "./premium-tiers";

export class BillingError extends Error {}

const appUrl = (env: Record<string, string | undefined> = process.env) => (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const priceEnv: Record<PlanId, string> = { starter: "STRIPE_PRICE_STARTER", pro: "STRIPE_PRICE_PRO", business: "STRIPE_PRICE_BUSINESS", premium: "STRIPE_PRICE_PREMIUM" };

/**
 * Prix Stripe d'un plan : variable d'environnement (STRIPE_PRICE_*, suffixe _YEARLY pour l'annuel), sinon recherche par lookup_key.
 * Premium : `premiumMonth` (mois de facturation, 1 par défaut) choisit le prix du palier d'ancienneté ; la variable d'environnement ne vaut que pour le premier palier.
 */
export async function resolvePriceId(stripe: Stripe, plan: PlanId, env: Record<string, string | undefined> = process.env, interval: BillingInterval = "month", premiumMonth = 1): Promise<string> {
  const tier = plan === "premium" ? premiumTierIndex(premiumMonth) : 0;
  const fromEnv = tier === 0 ? env[interval === "year" ? `${priceEnv[plan]}_YEARLY` : priceEnv[plan]] : undefined;
  if (fromEnv) return fromEnv;
  const key = lookupKeyFor(PLANS[plan], interval);
  const list = await stripe.prices.list({ lookup_keys: [tier === 0 ? key : premiumLookupKey(key, tier)], active: true, limit: 1 });
  const id = list.data[0]?.id;
  if (!id) throw new BillingError("Le prix de ce plan n'existe pas dans Stripe : lancez « npm run stripe:setup ».");
  return id;
}

/** Prix Stripe de l'utilisateur supplémentaire d'un plan : variable STRIPE_PRICE_EXTRA_SEAT_<PLAN>[_YEARLY], sinon lookup_key. */
export async function resolveExtraSeatPriceId(stripe: Stripe, plan: PlanId, env: Record<string, string | undefined> = process.env, interval: BillingInterval = "month"): Promise<string> {
  const fromEnv = env[`STRIPE_PRICE_EXTRA_SEAT_${plan.toUpperCase()}${interval === "year" ? "_YEARLY" : ""}`];
  if (fromEnv) return fromEnv;
  const list = await stripe.prices.list({ lookup_keys: [extraSeatLookupKey(PLANS[plan], interval)], active: true, limit: 1 });
  const id = list.data[0]?.id;
  if (!id) throw new BillingError("Le prix de l'utilisateur supplémentaire n'existe pas dans Stripe : lancez « npm run stripe:setup ».");
  return id;
}

const isExtraSeatItem = (it: Stripe.SubscriptionItem) => !!it.price.lookup_key?.startsWith(EXTRA_SEAT_LOOKUP_PREFIX);

export interface OrgBilling {
  id: string;
  name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  plan?: string | null;
  premium_since?: string | null;
  /** Fin de l'essai applicatif : passée, l'essai est consommé (pas de nouvel essai Stripe). */
  trial_ends_at?: string | null;
}

/** Client Stripe lié à l'organisation (créé au besoin, métadonnée org_id). */
export async function ensureCustomer(stripe: Stripe, org: OrgBilling, email: string): Promise<string> {
  if (org.stripe_customer_id) return org.stripe_customer_id;
  const c = await stripe.customers.create({ email, name: org.name, metadata: { org_id: org.id } });
  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").update({ stripe_customer_id: c.id }).eq("id", org.id).is("stripe_customer_id", null).select("id");
  if (error) throw new BillingError("Impossible de lier le client Stripe.");
  if (!data?.length) {
    // Course : un appel concurrent a déjà lié un client. On l'utilise et on supprime le doublon (un seul client par organisation).
    const { data: cur } = await admin.from("organizations").select("stripe_customer_id").eq("id", org.id).single();
    await stripe.customers.del(c.id).catch(() => undefined);
    if (!cur?.stripe_customer_id) throw new BillingError("Impossible de lier le client Stripe.");
    return cur.stripe_customer_id as string;
  }
  return c.id;
}

/**
 * Session Checkout d'abonnement. L'organisation vient de la session serveur (jamais du client).
 * Essai de 14 jours avec carte requise, uniquement pour une organisation qui n'a jamais souscrit.
 * Les moyens de paiement sont automatiques (Apple Pay / Google Pay via Checkout sur un domaine HTTPS vérifié).
 */
/** Essai déjà utilisé : l'essai applicatif de l'organisation est terminé. */
export const trialConsumed = (org: Pick<OrgBilling, "trial_ends_at">, now = Date.now()) => !!org.trial_ends_at && new Date(org.trial_ends_at).getTime() < now;

export function buildCheckoutParams(org: OrgBilling, plan: PlanId, priceId: string, customerId: string, env?: Record<string, string | undefined>, extra?: { priceId: string; quantity: number }, flow?: "onboarding", interval: BillingInterval = "month"): Stripe.Checkout.SessionCreateParams {
  const back = flow === "onboarding" ? "/onboarding/plan" : "/settings/billing";
  const meta = { org_id: org.id, plan };
  return {
    mode: "subscription",
    customer: customerId,
    client_reference_id: org.id,
    line_items: [{ price: priceId, quantity: 1 }, ...(extra && extra.quantity > 0 ? [{ price: extra.priceId, quantity: extra.quantity }] : [])],
    metadata: meta,
    payment_method_collection: "always",
    subscription_data: { metadata: meta, ...(org.stripe_subscription_id || trialConsumed(org) ? {} : { trial_period_days: TRIAL_DAYS }) },
    locale: "fr",
    success_url: `${appUrl(env)}${back}?checkout=success`,
    // Annulation depuis l'onboarding : on revient sur la formule choisie (plan + fréquence) pour réessayer en un clic.
    cancel_url: `${appUrl(env)}${back}?checkout=cancel${flow === "onboarding" ? `&plan=${plan}&interval=${interval}` : ""}`,
  };
}

export async function createCheckout(stripe: Stripe, org: OrgBilling, plan: string, email: string, env?: Record<string, string | undefined>, interval: BillingInterval = "month", extraSeats = 0, flow?: "onboarding"): Promise<string> {
  if (!isPlanId(plan)) throw new BillingError("Plan inconnu.");
  if (extraSeats && (!Number.isInteger(extraSeats) || extraSeats < 0 || extraSeats > MAX_EXTRA_SEATS || !supportsExtraSeats(PLANS[plan]))) throw new BillingError("Nombre d'utilisateurs supplémentaires invalide.");
  if (["active", "trialing", "past_due"].includes(org.subscription_status) && org.stripe_subscription_id) throw new BillingError("Un abonnement existe déjà : utilisez « Changer de plan » ou le portail.");
  const price = await resolvePriceId(stripe, plan, env, interval);
  const customer = await ensureCustomer(stripe, org, email);
  const session = await stripe.checkout.sessions.create(buildCheckoutParams(org, plan, price, customer, env, extraSeats > 0 ? { priceId: await resolveExtraSeatPriceId(stripe, plan, env, interval), quantity: extraSeats } : undefined, flow, interval));
  if (!session.url) throw new BillingError("Stripe n'a pas renvoyé d'adresse de paiement.");
  return session.url;
}

export async function createPortal(stripe: Stripe, org: OrgBilling, env?: Record<string, string | undefined>): Promise<string> {
  if (!org.stripe_customer_id) throw new BillingError("Aucun abonnement à gérer pour le moment.");
  const s = await stripe.billingPortal.sessions.create({ customer: org.stripe_customer_id, return_url: `${appUrl(env)}/settings/billing` });
  return s.url;
}

/** Changement de plan d'un abonnement existant (proratisé). Les sièges sont mis à jour par le webhook. */
export async function changePlan(stripe: Stripe, org: OrgBilling, plan: string, env?: Record<string, string | undefined>, interval: BillingInterval = "month"): Promise<void> {
  if (!isPlanId(plan)) throw new BillingError("Plan inconnu.");
  if (!org.stripe_subscription_id) throw new BillingError("Aucun abonnement actif : souscrivez d'abord.");
  // Un Premium qui change de fréquence garde son palier d'ancienneté.
  const month = plan === "premium" && org.plan === "premium" && org.premium_since ? premiumMonthAt(new Date(org.premium_since), new Date()) : 1;
  const price = await resolvePriceId(stripe, plan, env, interval, month);
  const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  const item = sub.items.data[0];
  if (!item) throw new BillingError("Abonnement invalide.");
  const baseItem = sub.items.data.find((it) => !isExtraSeatItem(it)) ?? item;
  const extraItem = sub.items.data.find(isExtraSeatItem);
  // Utilisateurs en plus : conservés (au tarif de la nouvelle fréquence), supprimés pour le Premium (illimité).
  const extraChange: Stripe.SubscriptionUpdateParams.Item[] = !extraItem ? [] : supportsExtraSeats(PLANS[plan])
    ? [{ id: extraItem.id, price: await resolveExtraSeatPriceId(stripe, plan, env, interval) }]
    : [{ id: extraItem.id, deleted: true }];
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: baseItem.id, price }, ...extraChange],
    proration_behavior: "create_prorations",
    metadata: { org_id: org.id, plan },
  });
}

/** Fixe le nombre d'utilisateurs supplémentaires (0 = aucun) d'un abonnement Starter, Pro ou Business. Proratisé ; les sièges sont mis à jour par le webhook. */
export async function setExtraSeats(stripe: Stripe, org: OrgBilling, quantity: number, env?: Record<string, string | undefined>): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_EXTRA_SEATS) throw new BillingError("Nombre d'utilisateurs invalide.");
  if (!org.stripe_subscription_id) throw new BillingError("Aucun abonnement actif : souscrivez d'abord.");
  if (!isPlanId(org.plan ?? "") || !supportsExtraSeats(PLANS[org.plan as PlanId])) throw new BillingError("Les utilisateurs supplémentaires ne sont pas disponibles avec ce plan.");
  const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  const baseItem = sub.items.data.find((it) => !isExtraSeatItem(it));
  const extraItem = sub.items.data.find(isExtraSeatItem);
  const interval = baseItem?.price.recurring?.interval === "year" ? "year" : "month";
  let items: Stripe.SubscriptionUpdateParams.Item[];
  if (extraItem) items = [quantity === 0 ? { id: extraItem.id, deleted: true } : { id: extraItem.id, quantity }];
  else if (quantity > 0) items = [{ price: await resolveExtraSeatPriceId(stripe, org.plan as PlanId, env, interval), quantity }];
  else return;
  await stripe.subscriptions.update(sub.id, { items, proration_behavior: "create_prorations" });
}

/** Adresse Stripe acceptable pour une redirection (https sur stripe.com ; n'importe quel https avec stripe-mock en développement). */
export function safeRedirect(url: string, mock = !!process.env.STRIPE_API_BASE && (process.env.NODE_ENV !== "production" || process.env.E2E_ALLOW_STRIPE_MOCK === "1")): string {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new BillingError("Adresse de paiement invalide.");
  if (!mock && !/(^|\.)stripe\.com$/.test(u.hostname)) throw new BillingError("Adresse de paiement invalide.");
  return u.toString();
}
