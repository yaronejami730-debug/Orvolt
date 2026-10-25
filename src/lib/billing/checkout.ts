import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlanId, lookupKeyFor, PLANS, TRIAL_DAYS, type BillingInterval, type PlanId } from "./plans";

export class BillingError extends Error {}

const appUrl = (env: Record<string, string | undefined> = process.env) => (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const priceEnv: Record<PlanId, string> = { starter: "STRIPE_PRICE_STARTER", pro: "STRIPE_PRICE_PRO", business: "STRIPE_PRICE_BUSINESS" };

/** Prix Stripe d'un plan : variable d'environnement (STRIPE_PRICE_*, suffixe _YEARLY pour l'annuel), sinon recherche par lookup_key. */
export async function resolvePriceId(stripe: Stripe, plan: PlanId, env: Record<string, string | undefined> = process.env, interval: BillingInterval = "month"): Promise<string> {
  const fromEnv = env[interval === "year" ? `${priceEnv[plan]}_YEARLY` : priceEnv[plan]];
  if (fromEnv) return fromEnv;
  const list = await stripe.prices.list({ lookup_keys: [lookupKeyFor(PLANS[plan], interval)], active: true, limit: 1 });
  const id = list.data[0]?.id;
  if (!id) throw new BillingError("Le prix de ce plan n'existe pas dans Stripe : lancez « npm run stripe:setup ».");
  return id;
}

export interface OrgBilling {
  id: string;
  name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
}

/** Client Stripe lié à l'organisation (créé au besoin, métadonnée org_id). */
export async function ensureCustomer(stripe: Stripe, org: OrgBilling, email: string): Promise<string> {
  if (org.stripe_customer_id) return org.stripe_customer_id;
  const c = await stripe.customers.create({ email, name: org.name, metadata: { org_id: org.id } });
  const { error } = await createAdminClient().from("organizations").update({ stripe_customer_id: c.id }).eq("id", org.id).is("stripe_customer_id", null);
  if (error) throw new BillingError("Impossible de lier le client Stripe.");
  return c.id;
}

/**
 * Session Checkout d'abonnement. L'organisation vient de la session serveur (jamais du client).
 * Essai de 14 jours avec carte requise, uniquement pour une organisation qui n'a jamais souscrit.
 * Les moyens de paiement sont automatiques (Apple Pay / Google Pay via Checkout sur un domaine HTTPS vérifié).
 */
export function buildCheckoutParams(org: OrgBilling, plan: PlanId, priceId: string, customerId: string, env?: Record<string, string | undefined>): Stripe.Checkout.SessionCreateParams {
  const meta = { org_id: org.id, plan };
  return {
    mode: "subscription",
    customer: customerId,
    client_reference_id: org.id,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: meta,
    payment_method_collection: "always",
    subscription_data: { metadata: meta, ...(org.stripe_subscription_id ? {} : { trial_period_days: TRIAL_DAYS }) },
    locale: "fr",
    success_url: `${appUrl(env)}/settings/billing?checkout=success`,
    cancel_url: `${appUrl(env)}/settings/billing?checkout=cancel`,
  };
}

export async function createCheckout(stripe: Stripe, org: OrgBilling, plan: string, email: string, env?: Record<string, string | undefined>, interval: BillingInterval = "month"): Promise<string> {
  if (!isPlanId(plan)) throw new BillingError("Plan inconnu.");
  if (["active", "trialing", "past_due"].includes(org.subscription_status) && org.stripe_subscription_id) throw new BillingError("Un abonnement existe déjà : utilisez « Changer de plan » ou le portail.");
  const price = await resolvePriceId(stripe, plan, env, interval);
  const customer = await ensureCustomer(stripe, org, email);
  const session = await stripe.checkout.sessions.create(buildCheckoutParams(org, plan, price, customer, env));
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
  const price = await resolvePriceId(stripe, plan, env, interval);
  const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  const item = sub.items.data[0];
  if (!item) throw new BillingError("Abonnement invalide.");
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, price }],
    proration_behavior: "create_prorations",
    metadata: { org_id: org.id, plan },
  });
}

/** Adresse Stripe acceptable pour une redirection (https sur stripe.com ; n'importe quel https avec stripe-mock en développement). */
export function safeRedirect(url: string, mock = !!process.env.STRIPE_API_BASE && (process.env.NODE_ENV !== "production" || process.env.E2E_ALLOW_STRIPE_MOCK === "1")): string {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new BillingError("Adresse de paiement invalide.");
  if (!mock && !/(^|\.)stripe\.com$/.test(u.hostname)) throw new BillingError("Adresse de paiement invalide.");
  return u.toString();
}
