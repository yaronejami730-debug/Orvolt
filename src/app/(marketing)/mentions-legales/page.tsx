import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Mentions légales", alternates: { canonical: "/mentions-legales" } };

export default function Page() {
  return (
    <LegalPage title="Mentions légales" updated="octobre 2026">
      <section><h2>Éditeur du site</h2><p>LeadForge, édité par [raison sociale], [forme juridique] au capital de [montant] €, immatriculée au RCS de [ville] sous le numéro [numéro], dont le siège est situé [adresse]. Directeur de la publication : [nom]. Contact : [adresse e-mail].</p></section>
      <section><h2>Hébergement</h2><p>Le site et l&apos;application sont hébergés par [hébergeur], [adresse de l&apos;hébergeur].</p></section>
      <section><h2>Propriété intellectuelle</h2><p>L&apos;ensemble des contenus, marques et logiciels de LeadForge est protégé. Toute reproduction non autorisée est interdite.</p></section>
      <section><h2>Contact</h2><p>Pour toute question, écrivez-nous à [adresse e-mail de contact].</p></section>
    </LegalPage>
  );
}
