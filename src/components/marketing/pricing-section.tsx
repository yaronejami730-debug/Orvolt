import Link from "next/link";
import { TRIAL_DAYS, YEARLY_FREE_MONTHS } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { PaymentSecurity } from "./payment-security";
import { PricingPlans } from "./pricing-plans";

/** Section partagée par `/` et `/pricing`. Tarif par nombre d'utilisateurs, facturation mensuelle ou annuelle. */
export function PricingSection({ page = false, signedIn = false }: { page?: boolean; signedIn?: boolean }) {
  const H = page ? "h1" : "h2";
  return (
    <section id="tarifs" aria-labelledby="pricing-title" className={cn("scroll-mt-20", page ? "pb-20 pt-20 sm:pb-28 sm:pt-28" : "pb-20 sm:pb-28")}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <H id="pricing-title" className="max-w-3xl text-balance text-3xl font-bold tracking-[-0.045em] sm:text-5xl">Une formule claire, qui grandit avec votre équipe</H>
        <p className="mt-4 max-w-xl text-muted-foreground sm:text-lg">Tous les plans commencent par {TRIAL_DAYS} jours d&apos;essai gratuit. Vous annulez en un clic. Facturation mensuelle, ou annuelle avec {YEARLY_FREE_MONTHS} mois offerts.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2" data-testid="roles-explainer">
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold tracking-[-0.02em]">Starter</h3>
            <p className="mt-1 text-sm text-muted-foreground">Toute l&apos;équipe travaille ensemble avec deux rôles : l&apos;Administrateur, qui gère tout, et le Membre, qui saisit et suit les leads et son agenda.</p>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <h3 className="font-semibold tracking-[-0.02em]">Pro</h3>
            <p className="mt-1 text-sm text-muted-foreground">Chaque personne a un rôle adapté à son métier (prospecteur, confirmateur, commercial, poseur) et voit ce qui la concerne.</p>
          </div>
        </div>
        <PricingPlans signedIn={signedIn} />
        <PaymentSecurity as={page ? "h2" : "h3"} />
        <p className="mt-8 text-sm text-muted-foreground">Détail des conditions et du tarif dégressif Premium dans nos <Link href="/cgv" className="underline underline-offset-4 hover:text-foreground">CGV</Link>. Une question ? <Link href={page ? "#faq" : "/#faq"} className="underline underline-offset-4 hover:text-foreground">Consultez la FAQ</Link> ou <Link href="/contact" className="underline underline-offset-4 hover:text-foreground">demandez à être recontacté</Link>.</p>
      </div>
    </section>
  );
}
