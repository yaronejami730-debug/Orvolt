import { CreditCard, Lock, Receipt, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Réassurance paiement. Chaque phrase est vérifiable dans le code : Stripe Checkout hébergé (src/lib/billing/checkout.ts),
 * aucun champ de carte dans l'application, portail client Stripe pour la carte, les factures et la résiliation.
 */
const POINTS = [
  { icon: ShieldCheck, title: "Traité par Stripe", text: "Le règlement se fait sur la page de paiement hébergée par Stripe, prestataire certifié PCI DSS niveau 1, le plus haut niveau de sécurité des paiements par carte." },
  { icon: Lock, title: "Aucune donnée bancaire chez nous", text: "Vos coordonnées bancaires ne transitent pas par nos serveurs et ne sont jamais stockées par Orvolt. L'authentification 3-D Secure est demandée quand votre banque l'exige." },
  { icon: CreditCard, title: "Carte bancaire ou Apple Pay", text: "Vous payez par carte bancaire ou Apple Pay, en euros, avec une facture pour chaque période." },
  { icon: Receipt, title: "Vous gardez la main", text: "Changement de carte, factures et résiliation en autonomie depuis le portail de facturation Stripe, sans passer par un conseiller." },
];

export function PaymentSecurity({ as: H = "h3", className }: { as?: "h2" | "h3"; className?: string }) {
  return (
    <section aria-labelledby="paiement-securise-title" data-testid="payment-security" className={cn("mt-10 rounded-2xl border bg-card p-6 sm:p-8", className)}>
      <H id="paiement-securise-title" className="flex items-center gap-2.5 text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
        <Lock className="size-5 shrink-0" aria-hidden />Paiement 100&nbsp;% sécurisé
      </H>
      <p className="mt-2 max-w-2xl text-muted-foreground">Tous les paiements passent par Stripe, un système de paiement sécurisé. Orvolt ne voit ni ne conserve votre numéro de carte.</p>
      <ul className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-3">
            <p.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">{p.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{p.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
