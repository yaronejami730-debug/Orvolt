import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { isInterval, lookupKeyFor, PLANS } from "./plans";
import { premiumLookupKey, premiumMonthAt, premiumTierIndex } from "./premium-tiers";

export interface PremiumSyncReport {
  checked: number;
  updated: number;
  errors: number;
}

const periodEndOf = (sub: Stripe.Subscription): number | null => {
  const item = sub.items.data[0] as unknown as { current_period_end?: number } | undefined;
  return item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
};

/**
 * Tarif dégressif : aligne le prix de chaque abonnement Premium sur le palier de la PROCHAINE facture.
 * Le changement s'applique à l'échéance suivante, sans prorata ni facture intermédiaire ; la facture Stripe
 * affiche le prix exact du mois. À exécuter chaque jour (idempotent : un abonnement déjà au bon palier n'est pas touché).
 */
export async function syncPremiumPrices(stripe: Stripe): Promise<PremiumSyncReport> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("id, stripe_subscription_id, premium_since")
    .eq("plan", "premium")
    .in("subscription_status", ["active", "trialing", "past_due"])
    .not("premium_since", "is", null)
    .not("stripe_subscription_id", "is", null)
    .limit(1000);
  const report: PremiumSyncReport = { checked: 0, updated: 0, errors: 0 };
  for (const org of data ?? []) {
    report.checked += 1;
    try {
      const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id as string);
      const item = sub.items.data[0];
      const end = periodEndOf(sub);
      const interval = item?.price.recurring?.interval;
      // Résiliation programmée : plus de facture à venir, rien à ajuster.
      if (!item || end === null || !isInterval(interval) || sub.cancel_at_period_end || sub.status === "canceled") continue;
      const tier = premiumTierIndex(premiumMonthAt(new Date(org.premium_since as string), new Date(end * 1000)));
      const key = premiumLookupKey(lookupKeyFor(PLANS.premium, interval), tier);
      if (item.price.lookup_key === key) continue;
      const found = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
      const price = found.data[0];
      if (!price) throw new Error(`price_missing:${key}`);
      await stripe.subscriptions.update(
        sub.id,
        { items: [{ id: item.id, price: price.id }], proration_behavior: "none" },
        { idempotencyKey: `premium-tier:${sub.id}:${key}:${end}` },
      );
      report.updated += 1;
    } catch {
      report.errors += 1; // la prochaine exécution réessaie
    }
  }
  return report;
}
