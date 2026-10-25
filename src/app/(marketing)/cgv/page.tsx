import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Conditions générales de vente", alternates: { canonical: "/cgv" } };

export default function Page() {
  return (
    <LegalPage title="Conditions générales de vente" updated="octobre 2026">
      <section><h2>Objet</h2><p>Les présentes conditions encadrent l&apos;abonnement au service LeadForge par les professionnels.</p></section>
      <section><h2>Essai et abonnement</h2><p>Un essai gratuit de 14 jours est proposé. L&apos;abonnement est mensuel, tarifé selon le nombre d&apos;utilisateurs (Starter, Pro, Business), et se renouvelle tacitement chaque mois.</p></section>
      <section><h2>Prix et paiement</h2><p>Les prix sont indiqués en euros [HT/TTC]. Le paiement s&apos;effectue par carte bancaire ou Apple Pay via Stripe.</p></section>
      <section><h2>Résiliation</h2><p>Vous pouvez résilier à tout moment depuis le portail de facturation ; l&apos;accès reste ouvert jusqu&apos;à la fin de la période payée. Aucun remboursement prorata sauf disposition légale contraire.</p></section>
      <section><h2>Responsabilité et droit applicable</h2><p>[Clause de responsabilité, de disponibilité du service et de droit applicable à compléter.]</p></section>
    </LegalPage>
  );
}
