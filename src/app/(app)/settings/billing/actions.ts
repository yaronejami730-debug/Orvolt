"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guard, type ActionResult } from "@/lib/action-guard";
import { invalidateEntitlement } from "@/lib/billing/access";
import { BillingError, changePlan, createCheckout, createPortal, safeRedirect, type OrgBilling } from "@/lib/billing/checkout";
import { BILLING_INTERVALS, PLAN_IDS } from "@/lib/billing/plans";
import { getStripe } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

const planSchema = z.object({ plan: z.enum(PLAN_IDS), interval: z.enum(BILLING_INTERVALS).default("month") });
const NOT_CONFIGURED = "La facturation n'est pas configurée sur ce serveur (STRIPE_SECRET_KEY).";

async function context() {
  // L'organisation vient TOUJOURS de la session ; billing.manage est exigé côté serveur.
  const g = await guard("billing.manage", "billing");
  if ("error" in g) return { error: g.error } as const;
  const stripe = getStripe();
  if (!stripe) return { error: NOT_CONFIGURED } as const;
  const { data } = await createAdminClient().from("organizations").select("id, name, stripe_customer_id, stripe_subscription_id, subscription_status").eq("id", g.s.org.id).single();
  return { s: g.s, stripe, org: data as OrgBilling } as const;
}
const fail = (e: unknown): ActionResult<never> => ({ ok: false, error: e instanceof BillingError ? e.message : "Stripe est momentanément indisponible. Réessayez." });

export async function startCheckoutAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  const c = await context();
  if ("error" in c) return { ok: false, error: c.error };
  const p = planSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Plan inconnu." };
  try {
    const url = safeRedirect(await createCheckout(c.stripe, c.org, p.data.plan, c.s.user.email, undefined, p.data.interval));
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
