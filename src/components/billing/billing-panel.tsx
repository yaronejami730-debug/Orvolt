"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { changePlanAction, openPortalAction, startCheckoutAction } from "@/app/(app)/settings/billing/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IntervalToggle } from "@/components/marketing/pricing-plans";
import { formatPrice, monthlyEquivalentCents, PLAN_LIST, TRIAL_DAYS, YEARLY_FREE_MONTHS, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

export interface BillingView {
  state: "trialing" | "active" | "past_due" | "trial_expired" | "canceled";
  plan: string;
  trialDaysLeft: number | null;
  graceEndsAt: string | null;
  seatLimit: number | null;
  seatsUsed: number;
  seatsOver: number;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
  configured: boolean;
}
const STATE_LABEL: Record<BillingView["state"], string> = { trialing: "Essai en cours", active: "Actif", past_due: "Paiement échoué", trial_expired: "Essai terminé", canceled: "Annulé" };
const STATE_TONE = { trialing: "accent", active: "success", past_due: "destructive", trial_expired: "destructive", canceled: "destructive" } as const;
const dateFr = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(iso));

export function BillingPanel({ b, checkout }: { b: BillingView; checkout?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [freq, setFreq] = useState<BillingInterval>("month");
  const [waiting, setWaiting] = useState(checkout === "success" && b.state !== "active");

  // Retour de Checkout : l'activation arrive par webhook, on rafraîchit quelques secondes.
  useEffect(() => {
    if (!waiting) return;
    if (b.state === "active" || b.state === "trialing" && b.hasSubscription) { setWaiting(false); return; }
    let n = 0;
    const t = setInterval(() => { router.refresh(); if (++n >= 15) { clearInterval(t); setWaiting(false); } }, 2000);
    return () => clearInterval(t);
  }, [waiting, b.state, b.hasSubscription, router]);

  const go = (fn: () => Promise<{ ok: boolean; error?: string; data?: { url: string } }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok && r.data) window.location.href = r.data.url;
      else toast.error(r.error);
    });
  const subscribe = (plan: PlanId) => go(() => startCheckoutAction({ plan, interval: freq }));
  const change = (plan: PlanId) => {
    if (!window.confirm(`Passer au plan ${PLAN_LIST.find((p) => p.id === plan)!.name} ? Facturation ${freq === "year" ? "annuelle" : "mensuelle"}, changement proratisé.`)) return;
    start(async () => {
      const r = await changePlanAction({ plan, interval: freq });
      if (r.ok) { toast.success("Changement de plan demandé."); setWaiting(true); router.refresh(); } else toast.error(r.error);
    });
  };

  return (
    <div className="space-y-6">
      {checkout === "success" && <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm" data-testid="checkout-success">{waiting ? "Paiement reçu : activation de votre abonnement en cours…" : "Merci ! Votre abonnement est à jour."}</p>}
      {checkout === "cancel" && <p role="status" className="rounded-lg border p-3 text-sm">Paiement annulé : aucun changement n&apos;a été effectué.</p>}
      {!b.configured && <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">La facturation n&apos;est pas configurée sur ce serveur (clé Stripe manquante).</p>}

      <Card className="space-y-4 p-5" data-testid="billing-status">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Plan {b.plan === "trial" ? "Essai" : PLAN_LIST.find((p) => p.id === b.plan)?.name ?? b.plan}</h2>
          <Badge tone={STATE_TONE[b.state]} data-testid="billing-state">{STATE_LABEL[b.state]}</Badge>
          {b.cancelAtPeriodEnd && <Badge tone="warning">Annulation en fin de période</Badge>}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Utilisateurs</dt><dd className="font-medium" data-testid="billing-seats">{b.seatsUsed} / {b.seatLimit ?? "∞"}{b.seatsOver > 0 && <span className="ml-2 text-warning-text">({b.seatsOver} de trop : <Link href="/settings/members" className="underline">désactiver des membres</Link>)</span>}</dd></div>
          {b.trialDaysLeft !== null && <div><dt className="text-muted-foreground">Essai</dt><dd className="font-medium" data-testid="billing-trial">{b.trialDaysLeft} jour(s) restant(s)</dd></div>}
          {b.periodEnd && <div><dt className="text-muted-foreground">{b.cancelAtPeriodEnd ? "Fin de l'abonnement" : "Prochaine facture"}</dt><dd className="font-medium">{dateFr(b.periodEnd)}</dd></div>}
          {b.graceEndsAt && <div><dt className="text-muted-foreground">Fin du délai de grâce</dt><dd className="font-medium text-destructive-text">{dateFr(b.graceEndsAt)}</dd></div>}
        </dl>
        {b.hasSubscription && <Button variant="outline" loading={pending} disabled={!b.configured} onClick={() => go(openPortalAction)}><CreditCard className="size-4" /> Gérer l&apos;abonnement <ExternalLink className="size-3.5" /></Button>}
      </Card>

      <IntervalToggle value={freq} onChange={setFreq} />

      <div className="grid gap-4 md:grid-cols-3" data-testid="plans">
        {PLAN_LIST.map((p) => {
          const current = b.hasSubscription && b.plan === p.id && b.state !== "canceled";
          return (
            <Card key={p.id} data-testid={`plan-${p.id}`} className={cn("flex flex-col gap-4 p-5", p.highlighted && "border-accent shadow-glow")}>
              <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{p.name}</h3>{p.highlighted && <Badge tone="accent">Recommandé</Badge>}</div>
              <div><p className="text-3xl font-semibold tabular-nums">{formatPrice(freq === "year" ? p.yearlyPriceCents : p.priceCents)}<span className="text-sm font-normal text-muted-foreground">{freq === "year" ? " / an" : " / mois"}</span></p>{freq === "year" && <p className="mt-1 text-xs text-muted-foreground">soit {formatPrice(monthlyEquivalentCents(p))} par mois, {YEARLY_FREE_MONTHS} mois offerts</p>}</div>
              <ul className="flex-1 space-y-1.5 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />{f}</li>)}</ul>
              {current ? <Button disabled variant="secondary">Plan actuel</Button>
                : b.hasSubscription && b.state !== "canceled" ? <Button variant="outline" loading={pending} disabled={!b.configured} onClick={() => change(p.id)}>Passer à {p.name}</Button>
                : <Button loading={pending} disabled={!b.configured} onClick={() => subscribe(p.id)}>{b.state === "canceled" ? "Réactiver" : "Souscrire"}</Button>}
              {!b.hasSubscription && b.state !== "canceled" && <p className="text-xs text-muted-foreground">Essai gratuit {TRIAL_DAYS} jours · annulation en un clic.</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
