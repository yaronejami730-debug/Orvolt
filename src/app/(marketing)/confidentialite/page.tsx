import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = { title: "Politique de confidentialité", alternates: { canonical: "/confidentialite" } };

export default function Page() {
  return (
    <LegalPage title="Politique de confidentialité" updated="octobre 2026">
      <section><h2>Responsable de traitement</h2><p>[Raison sociale], [adresse]. Délégué à la protection des données : [contact].</p></section>
      <section><h2>Données collectées</h2><ul><li>Compte : nom, adresse e-mail, mot de passe (stocké haché).</li><li>Données de vos leads que vous saisissez ou importez dans l&apos;outil : vous en restez responsable de traitement, LeadForge agit comme sous-traitant.</li><li>Données de facturation traitées par notre prestataire de paiement Stripe.</li></ul></section>
      <section><h2>Finalités et durées</h2><p>Fourniture du service, sécurité, facturation et support. Les journaux techniques sont conservés pour une durée limitée [durée]. Les données du compte sont supprimées à la clôture, sous [délai].</p></section>
      <section><h2>Vos droits</h2><p>Accès, rectification, effacement, limitation, portabilité et opposition : écrivez à [adresse e-mail]. Vous pouvez saisir la CNIL en cas de difficulté.</p></section>
      <section><h2>Cookies</h2><p>LeadForge n&apos;utilise que des cookies nécessaires au fonctionnement (session, thème). Aucun traceur publicitaire.</p></section>
    </LegalPage>
  );
}
