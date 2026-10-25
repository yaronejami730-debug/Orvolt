import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { BillingPanel, type BillingView } from "@/components/billing/billing-panel";
import { getEntitlement } from "@/lib/billing/access";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Facturation" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const s = await requireSession();
  if (!sessionCan(s, "billing.manage")) return <AccessDenied />;
  const e = await getEntitlement(s.org.id, true);
  const view: BillingView = {
    state: e.state, plan: e.plan, trialDaysLeft: e.trialDaysLeft, graceEndsAt: e.graceEndsAt?.toISOString() ?? null, seatLimit: e.seatLimit,
    seatsUsed: e.seatsUsed, seatsOver: e.seatsOver, periodEnd: e.periodEnd?.toISOString() ?? null, cancelAtPeriodEnd: e.cancelAtPeriodEnd,
    hasSubscription: e.hasSubscription, configured: isBillingConfigured(),
  };
  return <BillingPanel b={view} checkout={(await searchParams).checkout} />;
}
