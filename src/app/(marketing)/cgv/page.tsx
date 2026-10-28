import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/marketing/legal-page";
import { PLAN_LIST, TRIAL_DAYS, extraSeatPriceCents, formatPrice } from "@/lib/billing/plans";
import { SITE_NAME } from "@/lib/site";
import { legalText as t, legalValue } from "@/lib/legal";
import { PREMIUM_TIERS } from "@/lib/billing/premium-tiers";

export const metadata: Metadata = pageMetadata("/cgv");

export default function Page() {
  return (
    <LegalPage title="Conditions générales de vente" updated="octobre 2026" path="/cgv">
      <section><h2>Objet</h2><p>Les présentes conditions encadrent l&apos;abonnement au service {SITE_NAME} par les professionnels.</p></section>
      <section><h2>Essai et abonnement</h2><p>Un essai gratuit de {TRIAL_DAYS} jours est proposé. L&apos;abonnement, mensuel ou annuel (2 mois offerts), est proposé en quatre formules (Starter, Pro, Business, Premium) selon le nombre d&apos;utilisateurs et les fonctionnalités, et se renouvelle tacitement à chaque échéance.</p></section>
      <section>
        <h2>Prix et paiement</h2>
        <p>Les prix sont indiqués en euros {t("regimePrix")}. Le paiement s&apos;effectue par carte bancaire ou Apple Pay via Stripe, prestataire de paiement certifié PCI DSS niveau 1, sur sa page de paiement sécurisée : vos coordonnées bancaires ne transitent pas par les serveurs de {SITE_NAME} et n&apos;y sont pas conservées. L&apos;authentification 3-D Secure est demandée lorsque votre banque l&apos;exige. Chaque facture mentionne le prix exact facturé pour la période.</p>
        <ul>{PLAN_LIST.filter((p) => !p.priceFrom).map((p) => <li key={p.id}>{p.name} : {formatPrice(p.priceCents)} par mois ou {formatPrice(p.yearlyPriceCents)} par an.</li>)}</ul>
      </section>
      <section><h2>Utilisateurs supplémentaires</h2><p>Sur les formules Starter, Pro et Business, chaque utilisateur au-delà du nombre inclus est facturé en supplément, quel que soit son rôle : {PLAN_LIST.filter((p) => p.extraSeatCents !== null).map((p) => `${p.name} ${formatPrice(extraSeatPriceCents(p, "month")!)} par mois (${formatPrice(extraSeatPriceCents(p, "year")!)} par an)`).join(", ")}. Les ajouts et retraits en cours de période sont proratisés. La formule Premium inclut des utilisateurs illimités.</p></section>
      <section>
        <h2>Formule Premium : tarif dégressif</h2>
        <p>Le prix du Premium baisse par paliers d&apos;ancienneté continue, sans démarche de votre part. Le nouveau tarif s&apos;applique à la première facture suivant le début du palier. L&apos;abonnement annuel compte dans l&apos;ancienneté. En cas de résiliation, l&apos;ancienneté est perdue : une reprise du Premium repart au prix de départ. Grille mensuelle des paliers (formule mensuelle ; la formule annuelle correspond à dix mensualités du palier en cours au début de l&apos;année) :</p>
        <table>
          <thead><tr><th scope="col">À partir du mois d&apos;abonnement</th><th scope="col">Prix mensuel</th></tr></thead>
          <tbody>{PREMIUM_TIERS.map((t, i) => <tr key={t.fromMonth}><td>Mois {t.fromMonth}{i === PREMIUM_TIERS.length - 1 ? " et suivants" : ""}</td><td>{formatPrice(t.cents)}</td></tr>)}</tbody>
        </table>
      </section>
      <section><h2>Résiliation</h2><p>Vous pouvez résilier à tout moment depuis le portail de facturation ; l&apos;accès reste ouvert jusqu&apos;à la fin de la période payée. Aucun remboursement prorata sauf disposition légale contraire.</p></section>
      <section><h2>Responsabilité et droit applicable</h2><p>{legalValue("clauseResponsabilite") ?? "Les conditions de responsabilité, de disponibilité du service et le droit applicable ne sont pas encore renseignés."}</p></section>
    </LegalPage>
  );
}
