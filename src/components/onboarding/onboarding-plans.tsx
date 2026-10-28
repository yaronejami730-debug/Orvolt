"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { startCheckoutAction } from "@/app/(app)/settings/billing/actions";
import { simulateTrialAction } from "@/app/(onboarding)/onboarding/plan/actions";
import { IntervalToggle } from "@/components/marketing/pricing-plans";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePollRefresh } from "@/components/use-poll-refresh";
import { PLANS, PLAN_LIST, TRIAL_DAYS, YEARLY_FREE_MONTHS, extraSeatPriceCents, formatPrice, monthlyEquivalentCents, supportsExtraSeats, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/** Choix de la formule pendant l'onboarding : le clic ouvre Stripe Checkout avec les 14 jours d'essai (carte requise, 0 € aujourd'hui). */
export function OnboardingPlans({ waiting, cancelled, simulated = false, next = "/onboarding", initialPlan = null, initialInterval = "month" }: { waiting: boolean; cancelled: boolean; simulated?: boolean; next?: string; initialPlan?: PlanId | null; initialInterval?: BillingInterval }) {
  const router = useRouter();
  const [freq, setFreq] = useState<BillingInterval>(initialInterval);
  // Formule présélectionnée (lien du site, étape précédente ou retour d'annulation) : un récapitulatif remplace la grille ; « Changer » la rouvre.
  const [selected] = useState<PlanId | null>(initialPlan);
  const [showAll, setShowAll] = useState(!initialPlan);
  const [slow, setSlow] = useState(false);
  const [pending, start] = useTransition();
  // Première échéance = fin de l'essai : aujourd'hui + 14 jours (même règle que le Checkout Stripe).
  const [firstCharge] = useState(() => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(new Date(Date.now() + TRIAL_DAYS * 86_400_000)));
  const [picked, setPicked] = useState<PlanId | null>(null);
  const [sim, setSim] = useState<PlanId | null>(null); // formule affichée dans la fausse fenêtre de paiement
  // Retour de Stripe : l'abonnement arrive par webhook ; on rafraîchit jusqu'à ce que la page nous redirige.
  usePollRefresh({ everyMs: 1500, maxMs: 120_000, enabled: waiting });
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(t);
  }, [waiting]);

  const confirmSim = () => start(async () => {
    const r = await simulateTrialAction({ plan: sim, interval: freq });
    if (r.ok) { router.push(next); router.refresh(); } else toast.error(r.error);
  });

  const choose = (plan: PlanId) => {
    if (simulated) { setSim(plan); return; }
    setPicked(plan);
    start(async () => {
      const r = await startCheckoutAction({ plan, interval: freq, flow: "onboarding" });
      if (r.ok && r.data) { window.location.href = r.data.url; return; }
      setPicked(null);
      toast.error(r.error ?? "Paiement indisponible.");
    });
  };

  const rec = selected ? PLANS[selected] : null;
  const recPrice = rec ? formatPrice(freq === "year" ? rec.yearlyPriceCents : rec.priceCents) : "";

  if (waiting) {
    return (
      <div role="status" className="max-w-xl space-y-3 rounded-xl border bg-card p-5" data-testid="plan-waiting">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 shrink-0 animate-spin text-link" aria-hidden />
          <div><p className="font-medium">Paiement reçu : activation de votre essai en cours…</p><p className="text-sm text-muted-foreground">Quelques secondes en général : vous arrivez dans votre espace automatiquement.</p></div>
        </div>
        {slow && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm" data-testid="plan-waiting-slow">
            <p>Cela prend un peu plus de temps que d&apos;habitude. Rien n&apos;est perdu : vous pouvez fermer cette page, l&apos;essai s&apos;activera dès la confirmation de Stripe et vous retrouverez votre espace à la reconnexion. Aucun prélèvement n&apos;a lieu avant la fin de l&apos;essai.</p>
            <Button variant="outline" size="sm" onClick={() => router.refresh()}>Actualiser maintenant</Button>
          </div>
        )}
        {!slow && <Button variant="ghost" size="sm" className="-ml-3" onClick={() => router.refresh()}>Actualiser</Button>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {cancelled && <p role="status" className="rounded-lg border p-3 text-sm" data-testid="plan-cancelled">Le paiement n&apos;a pas abouti ou a été annulé : aucun essai n&apos;a démarré et rien n&apos;a été prélevé. {rec ? `Votre formule ${rec.name} est conservée : vous pouvez réessayer, avec la même carte ou une autre (en cas de refus ou d'authentification bancaire échouée, vérifiez les informations ou changez de carte).` : "Choisissez une formule pour réessayer."}</p>}
      <IntervalToggle value={freq} onChange={setFreq} />
      {rec && !showAll && (
        <section className="max-w-xl space-y-4 rounded-2xl border-2 border-accent bg-card p-5" data-testid="plan-recap" aria-label="Récapitulatif de votre formule">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm text-muted-foreground">Votre formule</p><h2 className="text-xl font-semibold">{rec.name}</h2><p className="text-sm text-muted-foreground">{rec.seats === null ? "Utilisateurs illimités" : `Jusqu'à ${rec.seats} utilisateurs`} · {rec.tagline}</p></div>
            <p className="text-right tabular-nums"><span className="text-2xl font-bold tracking-[-0.04em]">{recPrice}</span><span className="block text-xs text-muted-foreground">{freq === "year" ? "par an" : "par mois"}</span></p>
          </div>
          <dl className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
            <div className="flex justify-between gap-3"><dt>À payer aujourd&apos;hui</dt><dd className="font-semibold" data-testid="recap-today">0 €</dd></div>
            <div className="flex justify-between gap-3"><dt>Premier prélèvement le {firstCharge}</dt><dd className="font-semibold tabular-nums" data-testid="recap-then">{recPrice}</dd></div>
            <div className="flex justify-between gap-3 text-muted-foreground"><dt>Ensuite</dt><dd className="text-right">{freq === "year" ? `chaque année (soit ${formatPrice(monthlyEquivalentCents(rec))} / mois, ${YEARLY_FREE_MONTHS} mois offerts)` : "chaque mois"}</dd></div>
          </dl>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />Annulable en un clic dans Paramètres &gt; Facturation avant le {firstCharge} : vous ne payez rien.</li>
            <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />Une carte est demandée sur la page Stripe pour lancer l&apos;essai ; Apple Pay, Google Pay ou Link s&apos;y affichent si votre appareil les propose.</li>
            <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />Le montant exact, taxes comprises le cas échéant, est affiché sur la page de paiement avant que vous validiez.</li>
            <li className="flex gap-2"><Lock className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />Vos données bancaires sont saisies chez Stripe : elles ne transitent jamais par nos serveurs.</li>
          </ul>
          <Button size="lg" className="w-full" loading={pending && picked === rec.id} disabled={pending} onClick={() => choose(rec.id)} data-testid="recap-continue">Continuer vers le paiement sécurisé</Button>
          <button type="button" className="text-sm text-link hover:underline" onClick={() => setShowAll(true)} data-testid="plan-change">Choisir une autre formule</button>
        </section>
      )}
      <div className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-4", rec && !showAll && "hidden")} data-testid="onboarding-plans">
        {PLAN_LIST.map((p) => {
          const yearly = freq === "year";
          const extra = supportsExtraSeats(p) ? extraSeatPriceCents(p, freq) : null;
          return (
            <article key={p.id} data-plan={p.id} className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-5", p.highlighted && "border-2 border-accent")}>
              <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{p.name}</h2>{p.highlighted && <span className="rounded-sm bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Le plus choisi</span>}</div>
              <p className="text-sm text-muted-foreground">{p.tagline}</p>
              <p className="tabular-nums">{p.priceFrom && <span className="mr-1 text-sm text-muted-foreground">dès</span>}<span className="text-3xl font-bold tracking-[-0.04em]">{formatPrice(yearly ? p.yearlyPriceCents : p.priceCents)}</span><span className="ml-1 text-sm text-muted-foreground">{yearly ? "/ an" : "/ mois"}</span></p>
              <p className="-mt-1 rounded-md bg-accent-soft px-2 py-1.5 text-sm font-medium" data-testid={`today-${p.id}`}>0 € aujourd&apos;hui, puis {formatPrice(yearly ? p.yearlyPriceCents : p.priceCents)} {yearly ? "par an" : "par mois"} à partir du {firstCharge}</p>
              {yearly && <p className="-mt-2 text-xs text-muted-foreground">soit {formatPrice(monthlyEquivalentCents(p))} / mois, {YEARLY_FREE_MONTHS} mois offerts</p>}
              <ul className="flex-1 space-y-1.5 text-sm">
                <li className="flex gap-2 font-medium"><Check className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />{p.seats === null ? "Utilisateurs illimités" : `Jusqu'à ${p.seats} utilisateurs`}</li>
                {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />{f}</li>)}
                {extra !== null && <li className="text-xs text-muted-foreground">En supplément : + {formatPrice(extra)} {yearly ? "/ an" : "/ mois"} par utilisateur en plus.</li>}
              </ul>
              <Button variant={p.highlighted ? "primary" : "secondary"} className="h-auto min-h-10 whitespace-normal py-2 text-center leading-tight" loading={pending && picked === p.id} disabled={pending} onClick={() => choose(p.id)} data-testid={`choose-${p.id}`}>Essayer {TRIAL_DAYS} jours gratuitement</Button>
            </article>
          );
        })}
      </div>
      <Dialog open={sim !== null} onOpenChange={(o) => { if (!o && !pending) setSim(null); }}>
        <DialogContent data-testid="sim-checkout">
          {sim && (
            <>
              <DialogHeader>
                <DialogTitle>Paiement sécurisé · {PLANS[sim].name}</DialogTitle>
                <DialogDescription>Simulation : aucune carte réelle, aucun prélèvement.</DialogDescription>
              </DialogHeader>
              <dl className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between"><dt>À payer aujourd&apos;hui</dt><dd className="font-semibold" data-testid="sim-today">0 €</dd></div>
                <div className="flex justify-between"><dt>Le {firstCharge}, puis chaque {freq === "year" ? "année" : "mois"}</dt><dd className="font-semibold tabular-nums" data-testid="sim-then">{formatPrice(freq === "year" ? PLANS[sim].yearlyPriceCents : PLANS[sim].priceCents)}</dd></div>
              </dl>
              <div className="space-y-1.5"><label htmlFor="sim-card" className="text-sm font-medium">Carte bancaire</label><input id="sim-card" readOnly value="4242 4242 4242 4242" className="h-10 w-full rounded-md border bg-muted/40 px-3 text-sm tabular-nums" /></div>
              <p className="text-xs text-muted-foreground">Annulable en un clic avant le {firstCharge} : vous ne payez rien.</p>
              <Button size="lg" loading={pending} onClick={confirmSim} data-testid="sim-confirm">Démarrer mon essai gratuit de {TRIAL_DAYS} jours</Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">Paiement sécurisé par Stripe (carte ou Apple Pay). Aucun prélèvement pendant l&apos;essai ; ensuite la formule choisie, annulable à tout moment.</p>
    </div>
  );
}
