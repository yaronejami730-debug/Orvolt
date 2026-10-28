import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/app/access-denied";
import { BillingPanel, type BillingView } from "@/components/billing/billing-panel";
import { getEntitlement } from "@/lib/billing/access";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { simulateBilling } from "@/lib/onboarding";
import { requireSession, sessionCan } from "@/lib/session";

export const metadata: Metadata = { title: "Facturation" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const s = await requireSession();
  if (!sessionCan(s, "billing.manage")) return <AccessDenied />;
  if (s.org.parent_org_id) return <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground" data-testid="billing-managed">L&apos;abonnement et les places de cette régie sont gérés par votre régie maître.</p>;
  const e = await getEntitlement(s.org.id, true);
  const view: BillingView = {
    state: e.state, plan: e.plan, trialDaysLeft: e.trialDaysLeft, graceEndsAt: e.graceEndsAt?.toISOString() ?? null, seatLimit: e.seatLimit, extraSeats: e.extraSeats,
    seatsUsed: e.seatsUsed, seatsOver: e.seatsOver, periodEnd: e.periodEnd?.toISOString() ?? null, cancelAtPeriodEnd: e.cancelAtPeriodEnd,
    hasSubscription: e.hasSubscription, configured: isBillingConfigured(), simulated: simulateBilling(),
  };
  return (
    <>
      <BillingPanel b={view} checkout={(await searchParams).checkout} />
      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground" data-testid="billing-reassurance"><Lock className="size-3.5 shrink-0" aria-hidden />Paiements sécurisés par Stripe : vos coordonnées bancaires ne transitent pas par nos serveurs.</p>
    </>
  );
}
