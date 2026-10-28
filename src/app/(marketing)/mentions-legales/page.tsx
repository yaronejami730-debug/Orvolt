import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "@/components/marketing/legal-page";
import { SITE_NAME } from "@/lib/site";
import { legalText as t } from "@/lib/legal";

export const metadata: Metadata = pageMetadata("/mentions-legales");

export default function Page() {
  return (
    <LegalPage title="Mentions légales" updated="octobre 2026" path="/mentions-legales">
      <section><h2>Éditeur du site</h2><p>{SITE_NAME}, édité par {t("raisonSociale")}, {t("formeJuridique")} au capital de {t("capital")} €, immatriculée au RCS de {t("rcsVille")} sous le numéro {t("rcsNumero")} (SIRET {t("siret")}), dont le siège est situé {t("siege")}. Directeur de la publication : {t("directeurPublication")}. Contact : {t("emailContact")}.</p></section>
      <section><h2>Hébergement</h2><p>Le site et l&apos;application sont hébergés par {t("hebergeurNom")}, {t("hebergeurAdresse")}.</p></section>
      <section><h2>Propriété intellectuelle</h2><p>L&apos;ensemble des contenus, marques et logiciels de {SITE_NAME} est protégé. Toute reproduction non autorisée est interdite.</p></section>
      <section><h2>Contact</h2><p>Pour toute question, écrivez-nous à {t("emailContact")}.</p></section>
    </LegalPage>
  );
}
