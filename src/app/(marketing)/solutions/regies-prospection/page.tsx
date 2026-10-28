import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { Block, PageHero, RelatedLinks } from "@/components/marketing/page-sections";
import { CtaBand, FinalCta } from "@/components/marketing/sections";
import { isSignedIn } from "@/lib/marketing-session";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("/solutions/regies-prospection");

export default async function ProspectingAgenciesPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <Breadcrumbs trail={[{ name: "Régies de prospection", path: "/solutions/regies-prospection" }]} />
      <PageHero
        signedIn={signedIn}
        title="Le CRM des régies de leads et de prospection"
        intro="Prospecteurs, confirmateurs et commerciaux travaillent sur le même dossier, chacun avec les droits de son rôle. Les rendez-vous sont répartis automatiquement, et chaque régie partenaire garde son espace."
      />
      <Block
        id="roles"
        title="Chaque maillon de la chaîne a son rôle"
        intro="Les rôles spécialisés sont disponibles à partir de la formule Pro, et pendant l'essai."
        items={[
          { title: "Prospecteur", feature: "specialized_roles", text: "Il appelle, qualifie et ne voit que ses leads." },
          { title: "Confirmateur", feature: "specialized_roles", text: "Il confirme les rendez-vous posés et lance leur répartition." },
          { title: "Commercial", feature: "specialized_roles", text: "Il suit son agenda, ses trajets et ses devis." },
          { title: "Administrateur", text: "Il gère toute l'équipe, les statuts, les sources et les droits de chaque rôle." },
        ]}
      />
      <Block
        id="regies-partenaires"
        title="Plusieurs régies, des espaces séparés"
        items={[
          { title: "Un espace par régie partenaire", text: "Chaque régie partenaire a son propre espace, ses rôles et ses membres. Elle ne voit jamais votre régie." },
          { title: "Une vue d'ensemble pour vous", text: "Vous accédez à chaque régie partenaire à tout moment en tant que super administrateur. Ses utilisateurs comptent dans vos places." },
        ]}
      />
      <Block
        id="du-lead-au-rdv"
        title="Du lead au rendez-vous réparti"
        items={[
          { title: "Des leads qui arrivent seuls", text: "Meta Lead Ads et Google Ads alimentent le CRM par webhook. Les fichiers CSV s'importent avec association des colonnes et détection des doublons." },
          { title: "Des trames d'appel", text: "Vos prospecteurs suivent un formulaire de questions préparé par vos soins pendant l'appel." },
          { title: "Une répartition automatique", text: "Le moteur propose le commercial et l'heure de chaque rendez-vous selon la zone, le temps de route réel et les horaires. Vous validez la proposition." },
          { title: "Un suivi chiffré", feature: "analytics", text: "Leads par statut et par source, taux de conversion et résultats par personne, sur la période de votre choix." },
        ]}
      />
      <CtaBand signedIn={signedIn} title="Essayez avec votre équipe de prospection." />
      <RelatedLinks
        links={[
          { href: "/fonctionnalites", label: "Toutes les fonctionnalités", text: "Statuts, rôles, agenda, répartition, import et webhooks." },
          { href: "/solutions/installateurs-energie", label: "CRM pour installateurs d'énergie", text: "Le modèle solaire, pompe à chaleur et isolation." },
          { href: "/pricing", label: "Tarifs", text: "Utilisateurs illimités en Premium, paiement sécurisé par Stripe." },
          { href: "/#faq", label: "Questions fréquentes", text: "Essai, paiement, import, rôles : les réponses." },
          { href: "/contact", label: "Être recontacté", text: "Laissez vos coordonnées, un conseiller vous rappelle." },
        ]}
      />
      <FinalCta signedIn={signedIn} />
    </>
  );
}
