"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { changePlanAction, openPortalAction, setExtraSeatsAction, simulateSubscribeAction, startCheckoutAction } from "@/app/(app)/settings/billing/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IntervalToggle } from "@/components/marketing/pricing-plans";
import { formatPrice, MAX_EXTRA_SEATS, monthlyEquivalentCents, PLAN_LIST, PLANS, supportsExtraSeats, TRIAL_DAYS, YEARLY_FREE_MONTHS, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { usePollRefresh } from "@/components/use-poll-refresh";
import { cn } from "@/lib/utils";

export interface BillingView {
  state: "trialing" | "active" | "past_due" | "trial_expired" | "canceled";
  plan: string;
  trialDaysLeft: number | null;
  graceEndsAt: string | null;
  seatLimit: number | null;
  extraSeats: number;
  seatsUsed: number;
  seatsOver: number;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
  configured: boolean;
  /** Sans clé Stripe hors production : l'abonnement est simulé (aucun paiement). */
  simulated?: boolean;
}
const STATE_LABEL: Record<BillingView["state"], string> = { trialing: "Essai en cours", active: "Actif", past_due: "Paiement échoué", trial_expired: "Essai terminé", canceled: "Annulé" };
const STATE_TONE = { trialing: "accent", active: "success", past_due: "destructive", trial_expired: "destructive", canceled: "destructive" } as const;
const PORTAL_FLAG = "lf-billing-portal";
/** Empreinte de l'état d'abonnement : si elle change, le webhook Stripe est passé. */
export const billingSignature = (b: BillingView) => [b.state, b.plan, b.hasSubscription, b.cancelAtPeriodEnd, b.periodEnd, b.seatLimit, b.extraSeats].join("|");
export const BILLING_POLL_MS = 5000;
export const BILLING_POLL_MAX_MS = 60_000;
const dateFr = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(iso));

export function BillingPanel({ b, checkout }: { b: BillingView; checkout?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [freq, setFreq] = useState<BillingInterval>("month");
  const [waiting, setWaiting] = useState(checkout === "success" && b.state !== "active");
  const baseline = useRef(billingSignature(b));
  const sig = billingSignature(b);
  const [extra, setExtra] = useState(b.extraSeats);
  useEffect(() => setExtra(b.extraSeats), [b.extraSeats]);
  const plan = PLAN_LIST.find((p) => p.id === b.plan);
  const canBuyExtra = !!plan && supportsExtraSeats(plan) && b.hasSubscription && b.state !== "canceled";

  // Retour du portail Stripe : on a posé un repère avant de partir, on sonde le temps que le webhook arrive.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(PORTAL_FLAG)) { sessionStorage.removeItem(PORTAL_FLAG); setWaiting(true); }
    } catch { /* stockage indisponible : pas de sondage au retour du portail */ }
  }, []);
  // Retour de Checkout, retour du portail ou changement de plan : l'état arrive par webhook. Léger rafraîchissement (5 s, 60 s au plus), arrêté dès que l'état change.
  usePollRefresh({ everyMs: BILLING_POLL_MS, maxMs: BILLING_POLL_MAX_MS, enabled: waiting });
  useEffect(() => {
    if (!waiting) return;
    if (sig !== baseline.current) { setWaiting(false); baseline.current = sig; return; }
    const t = setTimeout(() => setWaiting(false), BILLING_POLL_MAX_MS + BILLING_POLL_MS);
    return () => clearTimeout(t);
  }, [waiting, sig]);

  const go = (fn: () => Promise<{ ok: boolean; error?: string; data?: { url: string } }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok && r.data) {
        if (fn === openPortalAction) { try { sessionStorage.setItem(PORTAL_FLAG, "1"); } catch { /* sans effet */ } }
        window.location.href = r.data.url;
      }
      else toast.error(r.error);
    });
  const saveExtra = () =>
    start(async () => {
      const r = await setExtraSeatsAction({ quantity: extra });
      if (r.ok) { toast.success("Utilisateurs mis à jour."); baseline.current = sig; setWaiting(true); router.refresh(); } else toast.error(r.error);
    });
  const subscribe = (plan: PlanId) => {
    if (!b.simulated) return go(() => startCheckoutAction({ plan, interval: freq }));
    start(async () => {
      const r = await simulateSubscribeAction({ plan, interval: freq });
      if (r.ok) { toast.success("Abonnement simulé : actif."); router.refresh(); } else toast.error(r.error);
    });
  };
  const change = (plan: PlanId) => {
    if (!window.confirm(`Passer au plan ${PLAN_LIST.find((p) => p.id === plan)!.name} ? Facturation ${freq === "year" ? "annuelle" : "mensuelle"}, changement proratisé.`)) return;
    start(async () => {
      const r = await changePlanAction({ plan, interval: freq });
      if (r.ok) { toast.success("Changement de plan demandé."); baseline.current = sig; setWaiting(true); router.refresh(); } else toast.error(r.error);
    });
  };

  return (
    <div className="space-y-6">
      {checkout === "success" && <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm" data-testid="checkout-success">{waiting ? "Paiement reçu : activation de votre abonnement en cours…" : "Merci ! Votre abonnement est à jour."}</p>}
      {checkout === "cancel" && <p role="status" className="rounded-lg border p-3 text-sm">Paiement annulé : aucun changement n&apos;a été effectué.</p>}
      {!b.configured && <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{b.simulated ? "Simulation : la clé Stripe n'est pas configurée, « Souscrire » active l'abonnement sans paiement." : "La facturation n'est pas configurée sur ce serveur (clé Stripe manquante)."}</p>}

      <Card className="space-y-4 p-5" data-testid="billing-status">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Plan {b.plan === "trial" ? "Essai" : PLAN_LIST.find((p) => p.id === b.plan)?.name ?? b.plan}</h2>
          <Badge tone={STATE_TONE[b.state]} data-testid="billing-state">{STATE_LABEL[b.state]}</Badge>
          {b.cancelAtPeriodEnd && <Badge tone="warning">Annulation en fin de période</Badge>}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Utilisateurs</dt><dd className="font-medium" data-testid="billing-seats">{b.seatsUsed} / {b.seatLimit ?? "∞"}{b.seatsOver > 0 && <span className="ml-2 text-warning-text">({b.seatsOver} de trop : <Link href="/settings/members" className="underline">désactiver des membres</Link>)</span>}</dd></div>
          {b.trialDaysLeft !== null && <div><dt className="text-muted-foreground">Essai</dt><dd className="font-medium" data-testid="billing-trial">{b.trialDaysLeft} jour(s) restant(s)</dd></div>}
          {b.periodEnd && (b.state === "active" || b.state === "past_due" || b.state === "trialing") && <div><dt className="text-muted-foreground">{b.cancelAtPeriodEnd ? "Fin de l'abonnement" : "Prochaine facture"}</dt><dd className="font-medium">{dateFr(b.periodEnd)}</dd></div>}
          {b.graceEndsAt && <div><dt className="text-muted-foreground">Fin du délai de grâce</dt><dd className="font-medium text-destructive-text">{dateFr(b.graceEndsAt)}</dd></div>}
        </dl>
        {b.hasSubscription && <Button variant="outline" loading={pending} disabled={!b.configured} onClick={() => go(openPortalAction)}><CreditCard className="size-4" /> Gérer l&apos;abonnement <ExternalLink className="size-3.5" /></Button>}
      </Card>

      {canBuyExtra && plan && (
        <Card className="space-y-3 p-5" data-testid="extra-seats">
          <h2 className="text-lg font-semibold">Utilisateurs supplémentaires</h2>
          <p className="text-sm text-muted-foreground">Votre plan {plan.name} inclut {PLANS[plan.id].seats} utilisateurs. Chaque utilisateur en plus coûte {formatPrice(plan.extraSeatCents!)} par mois (tarif annuel : 10 mensualités), quel que soit son rôle. Changement proratisé.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="icon" aria-label="Retirer un utilisateur" disabled={pending || extra <= 0} onClick={() => setExtra((n) => Math.max(0, n - 1))}>−</Button>
            <output className="min-w-10 text-center text-xl font-semibold tabular-nums" data-testid="extra-count">{extra}</output>
            <Button variant="outline" size="icon" aria-label="Ajouter un utilisateur" disabled={pending || extra >= MAX_EXTRA_SEATS} onClick={() => setExtra((n) => n + 1)}>+</Button>
            <span className="text-sm text-muted-foreground">{extra > 0 ? `+ ${formatPrice(extra * plan.extraSeatCents!)} par mois` : "Aucun utilisateur en plus"}</span>
            <Button loading={pending} disabled={!b.configured || extra === b.extraSeats} onClick={saveExtra}>Enregistrer</Button>
          </div>
        </Card>
      )}

      <IntervalToggle value={freq} onChange={setFreq} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="plans">
        {PLAN_LIST.map((p) => {
          const current = b.hasSubscription && b.plan === p.id && b.state !== "canceled";
          return (
            <Card key={p.id} data-testid={`plan-${p.id}`} className={cn("flex flex-col gap-4 p-5", p.highlighted && "border-accent shadow-glow")}>
              <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{p.name}</h3>{p.highlighted && <Badge tone="accent">Recommandé</Badge>}</div>
              <div><p className="text-3xl font-semibold tabular-nums">{p.priceFrom && <span className="mr-1.5 text-sm font-normal text-muted-foreground">dès</span>}{formatPrice(freq === "year" ? p.yearlyPriceCents : p.priceCents)}<span className="text-sm font-normal text-muted-foreground">{freq === "year" ? " / an" : " / mois"}</span></p>{freq === "year" && <p className="mt-1 text-xs text-muted-foreground">soit {formatPrice(monthlyEquivalentCents(p))} par mois, {YEARLY_FREE_MONTHS} mois offerts</p>}</div>
              <ul className="flex-1 space-y-1.5 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success-text" aria-hidden />{f}</li>)}</ul>
              {current ? <Button disabled variant="secondary">Plan actuel</Button>
                : b.hasSubscription && b.state !== "canceled" ? <Button variant="outline" loading={pending} disabled={!b.configured} onClick={() => change(p.id)}>Passer à {p.name}</Button>
                : <Button loading={pending} disabled={!b.configured && !b.simulated} onClick={() => subscribe(p.id)}>{b.state === "canceled" ? "Réactiver" : "Souscrire"}</Button>}
              {!b.hasSubscription && b.state !== "canceled" && b.state !== "trial_expired" && <p className="text-xs text-muted-foreground">Essai gratuit {TRIAL_DAYS} jours · annulation en un clic.</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
