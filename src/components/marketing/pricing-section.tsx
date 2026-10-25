import { TRIAL_DAYS, YEARLY_FREE_MONTHS } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { PricingPlans } from "./pricing-plans";

/** Section partagée par `/` et `/pricing`. Tarif par nombre d'utilisateurs, facturation mensuelle ou annuelle. */
export function PricingSection({ page = false, signedIn = false }: { page?: boolean; signedIn?: boolean }) {
  const H = page ? "h1" : "h2";
  return (
    <section id="tarifs" aria-labelledby="pricing-title" className={cn("scroll-mt-20", page ? "pb-20 pt-20 sm:pb-28 sm:pt-28" : "pb-20 sm:pb-28")}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <H id="pricing-title" className="max-w-3xl text-balance text-3xl font-bold tracking-[-0.045em] sm:text-5xl">Un prix simple, selon la taille de votre équipe</H>
        <p className="mt-4 max-w-xl text-muted-foreground sm:text-lg">Tous les plans commencent par {TRIAL_DAYS} jours d&apos;essai gratuit. Vous annulez en un clic. Facturation mensuelle, ou annuelle avec {YEARLY_FREE_MONTHS} mois offerts.</p>
        <PricingPlans signedIn={signedIn} />
        <p className="mt-6 text-sm text-muted-foreground">Paiement par carte bancaire ou Apple Pay, via Stripe.</p>
      </div>
    </section>
  );
}
