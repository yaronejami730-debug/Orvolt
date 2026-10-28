"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-guard";
import { invalidateEntitlement } from "@/lib/billing/access";
import { BILLING_INTERVALS, PLAN_IDS, TRIAL_DAYS, planSeats } from "@/lib/billing/plans";
import { simulateBilling } from "@/lib/onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/session";

/**
 * SIMULATION du démarrage d'essai (sans Stripe) : applique à l'organisation ce que le webhook Stripe appliquerait.
 * Refusée dès que la facturation est configurée ou en production : jamais un moyen d'obtenir un abonnement gratuit.
 */
export async function simulateTrialAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  if (!simulateBilling()) return { ok: false, error: "Simulation indisponible." };
  if (!s.isAdmin || s.org.parent_org_id) return { ok: false, error: "Action réservée au super administrateur." };
  const p = z.object({ plan: z.enum(PLAN_IDS), interval: z.enum(BILLING_INTERVALS) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Formule inconnue." };
  const end = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
  const { error } = await createAdminClient().from("organizations").update({
    plan: p.data.plan, subscription_status: "trialing", seat_limit: planSeats(p.data.plan), trial_ends_at: end, current_period_end: end, onboarded_at: new Date().toISOString(),
  }).eq("id", s.org.id);
  if (error) return { ok: false, error: "Simulation impossible." };
  invalidateEntitlement(s.org.id);
  revalidatePath("/", "layout");
  return { ok: true };
}
