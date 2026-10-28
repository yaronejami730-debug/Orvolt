import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/marketing/legal-page";
import { SITE_NAME } from "@/lib/site";
import { legalText as t } from "@/lib/legal";

export const metadata: Metadata = pageMetadata("/confidentialite");

export default function Page() {
  return (
    <LegalPage title="Politique de confidentialité" updated="octobre 2026" path="/confidentialite">
      <section><h2>Responsable de traitement</h2><p>{t("raisonSociale")}, {t("siege")}. Délégué à la protection des données : {t("dpoContact")}.</p></section>
      <section><h2>Données collectées</h2><ul><li>Compte : nom, adresse e-mail, mot de passe (stocké haché).</li><li>Données de vos leads que vous saisissez ou importez dans l&apos;outil : vous en restez responsable de traitement, {SITE_NAME} agit comme sous-traitant.</li><li>Données de facturation traitées par notre prestataire de paiement Stripe.</li></ul></section>
      <section><h2>Paiement et sous-traitants</h2><p>Les paiements sont traités par Stripe, notre sous-traitant pour le paiement et la facturation, certifié PCI DSS niveau 1. Vos coordonnées bancaires sont saisies sur la page de paiement hébergée par Stripe : elles ne transitent pas par nos serveurs et ne sont pas conservées par {SITE_NAME}. Nous gardons uniquement l&apos;identifiant client Stripe et l&apos;état de votre abonnement. Le traitement effectué par Stripe est décrit dans sa propre politique de confidentialité.</p></section>
      <section><h2>Finalités et durées</h2><p>Fourniture du service, sécurité, facturation et support. Les journaux techniques sont conservés pour une durée limitée ({t("dureeJournaux")}). Les données du compte sont supprimées à la clôture, sous {t("delaiSuppression")}.</p></section>
      <section><h2>Vos droits</h2><p>Accès, rectification, effacement, limitation, portabilité et opposition : écrivez à {t("emailContact")}. Vous pouvez saisir la CNIL en cas de difficulté.</p></section>
      <section><h2>Cookies</h2><p>{SITE_NAME} n&apos;utilise que des cookies nécessaires au fonctionnement (session, thème). Aucun traceur publicitaire.</p></section>
    </LegalPage>
  );
}
