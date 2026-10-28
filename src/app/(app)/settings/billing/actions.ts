"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guard, type ActionResult } from "@/lib/action-guard";
import { invalidateEntitlement } from "@/lib/billing/access";
import { BillingError, changePlan, createCheckout, createPortal, safeRedirect, setExtraSeats, type OrgBilling } from "@/lib/billing/checkout";
import { BILLING_INTERVALS, MAX_EXTRA_SEATS, PLAN_IDS, planSeats } from "@/lib/billing/plans";
import { getStripe } from "@/lib/billing/stripe";
import { simulateBilling } from "@/lib/onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackFunnel } from "@/lib/funnel/track";
import { after } from "next/server";

const planSchema = z.object({ plan: z.enum(PLAN_IDS), interval: z.enum(BILLING_INTERVALS).default("month"), extraSeats: z.number().int().min(0).max(MAX_EXTRA_SEATS).default(0), flow: z.enum(["onboarding"]).optional() });
const seatsSchema = z.object({ quantity: z.number().int().min(0).max(MAX_EXTRA_SEATS) });
const SUBORG_BILLING = "Cette régie partenaire est facturée par sa régie maître.";
const NOT_CONFIGURED = "La facturation n'est pas configurée sur ce serveur (STRIPE_SECRET_KEY).";

async function context() {
  // L'organisation vient TOUJOURS de la session ; billing.manage est exigé côté serveur.
  const g = await guard("billing.manage", "billing");
  if ("error" in g) return { error: g.error } as const;
  // Une sous-régie n'a pas d'abonnement propre : la régie maître paie (aucun paiement ni changement de plan depuis une sous-régie).
  if (g.s.org.parent_org_id) return { error: SUBORG_BILLING } as const;
  const stripe = getStripe();
  if (!stripe) return { error: NOT_CONFIGURED } as const;
  const { data } = await createAdminClient().from("organizations").select("id, name, stripe_customer_id, stripe_subscription_id, subscription_status, plan, premium_since, trial_ends_at").eq("id", g.s.org.id).single();
  return { s: g.s, stripe, org: data as OrgBilling } as const;
}
const fail = (e: unknown): ActionResult<never> => ({ ok: false, error: e instanceof BillingError ? e.message : "Stripe est momentanément indisponible. Réessayez." });

export async function startCheckoutAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  const c = await context();
  if ("error" in c) return { ok: false, error: c.error };
  const p = planSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Plan inconnu." };
  try {
    const url = safeRedirect(await createCheckout(c.stripe, c.org, p.data.plan, c.s.user.email, undefined, p.data.interval, p.data.extraSeats, p.data.flow));
    after(() => trackFunnel("checkout_opened", { orgId: c.org.id, plan: p.data.plan, interval: p.data.interval }));
    return { ok: true, data: { url } };
  } catch (e) {
    return fail(e);
  }
}

export async function openPortalAction(): Promise<ActionResult<{ url: string }>> {
  const c = await context();
  if ("error" in c) return { ok: false, error: c.error };
  try {
    return { ok: true, data: { url: safeRedirect(await createPortal(c.stripe, c.org)) } };
  } catch (e) {
    return fail(e);
  }
}

export async function changePlanAction(input: unknown): Promise<ActionResult> {
  const c = await context();
  if ("error" in c) return { ok: false, error: c.error };
  const p = planSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Plan inconnu." };
  try {
    await changePlan(c.stripe, c.org, p.data.plan, undefined, p.data.interval);
    invalidateEntitlement(c.org.id);
    revalidatePath("/settings/billing");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Utilisateurs supplémentaires (prix mensuel propre au plan, voir extraSeatCents ; quel que soit le rôle). */
export async function setExtraSeatsAction(input: unknown): Promise<ActionResult> {
  const c = await context();
  if ("error" in c) return { ok: false, error: c.error };
  const p = seatsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Nombre d'utilisateurs invalide." };
  try {
    await setExtraSeats(c.stripe, c.org, p.data.quantity);
    invalidateEntitlement(c.org.id);
    revalidatePath("/settings/billing");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * SIMULATION d'un abonnement payant (sans Stripe, hors production) : applique ce que le webhook appliquerait après paiement.
 * Refusée dès que la facturation est configurée ou en production : jamais un moyen d'obtenir un abonnement gratuit.
 */
export async function simulateSubscribeAction(input: unknown): Promise<ActionResult> {
  if (!simulateBilling()) return { ok: false, error: "Simulation indisponible." };
  const g = await guard("billing.manage", "billing");
  if ("error" in g) return { ok: false, error: g.error };
  if (g.s.org.parent_org_id) return { ok: false, error: SUBORG_BILLING };
  const p = z.object({ plan: z.enum(PLAN_IDS), interval: z.enum(BILLING_INTERVALS).default("month") }).safeParse(input);
  if (!p.success) return { ok: false, error: "Formule inconnue." };
  const end = new Date(Date.now() + (p.data.interval === "year" ? 365 : 30) * 86_400_000).toISOString();
  const { error } = await createAdminClient().from("organizations").update({
    plan: p.data.plan, subscription_status: "active", seat_limit: planSeats(p.data.plan), current_period_end: end, past_due_since: null, cancel_at_period_end: false,
  }).eq("id", g.s.org.id);
  if (error) return { ok: false, error: "Simulation impossible." };
  invalidateEntitlement(g.s.org.id);
  revalidatePath("/", "layout");
  return { ok: true };
}
