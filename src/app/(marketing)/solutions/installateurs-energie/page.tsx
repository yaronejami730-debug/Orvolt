import Link from "next/link";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { Block, PageHero, RelatedLinks } from "@/components/marketing/page-sections";
import { CtaBand, FinalCta } from "@/components/marketing/sections";
import { PLANS, formatPrice } from "@/lib/billing/plans";
import { isSignedIn } from "@/lib/marketing-session";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("/solutions/installateurs-energie");

export default async function EnergyInstallersPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <Breadcrumbs trail={[{ name: "Installateurs d'énergie", path: "/solutions/installateurs-energie" }]} />
      <PageHero
        signedIn={signedIn}
        title="Le CRM des installateurs de panneaux solaires, pompes à chaleur et isolation"
        intro="Du premier appel à la signature du devis, toute l'équipe travaille sur le même dossier. Le modèle énergie est déjà en place : vous n'avez qu'à l'adapter à votre façon de vendre."
      />
      <Block
        id="modele"
        title="Un modèle énergie prêt dès l'inscription"
        intro="Statuts (Nouveau, À qualifier, RDV pris, Devis envoyé, Signé), champs du logement et sources de leads sont créés à l'inscription."
        cols={3}
        items={[
          { title: "Pompe à chaleur", text: "Type de chauffage, surface, classe DPE." },
          { title: "Panneaux solaires", text: "Toiture, facture d'énergie, propriétaire ou locataire." },
          { title: "Isolation", text: "Surface habitable, adresse du logement, devis." },
        ]}
      />
      <Block
        id="parcours"
        title="De l'appel au rendez-vous, du rendez-vous à la pose"
        items={[
          { title: "Le prospecteur qualifie", text: "Il suit une trame d'appel préparée par vos soins et ne voit que ses leads." },
          { title: "Le confirmateur valide le rendez-vous", text: "Il confirme les rendez-vous posés avant qu'ils partent chez un commercial." },
          { title: "Le moteur répartit", text: "Il propose le commercial et l'heure de chaque rendez-vous selon la zone, le temps de route réel et les horaires. Vous voyez la proposition avant de la valider." },
          { title: "Le commercial suit son agenda", text: "Il retrouve ses rendez-vous de la journée avec le trajet entre chacune, fait avancer le lead jusqu'au devis envoyé puis signé." },
        ]}
      />
      <Block
        id="leads-entrants"
        title="Vos leads arrivent seuls"
        items={[
          { title: "Meta Lead Ads et Google Ads", text: "Les formulaires de vos campagnes alimentent le CRM par webhook, sans ressaisie." },
          { title: "Import de vos fichiers", text: "Un fichier CSV, une association de colonnes, un contrôle ligne par ligne : les doublons sont écartés, le reste est importé." },
        ]}
      />
      <Block
        id="adapter"
        title="Adaptable à votre activité"
        items={[
          { title: "Vos statuts, vos règles", feature: "status_tracking", text: "Renommez une étape, ajoutez-en, choisissez qui peut passer un lead de l'une à l'autre et ce que le passage déclenche." },
          { title: "Vos zones d'intervention", feature: "distance_control", text: "Définissez la zone de chaque commercial : une alerte s'affiche quand un rendez-vous en sort." },
        ]}
      />
      <div className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8 sm:pb-24">
        <p className="max-w-2xl text-muted-foreground sm:text-lg">À partir de {formatPrice(PLANS.starter.priceCents)} par mois, avec un essai gratuit. Retrouvez le détail des formules sur la page <Link className="underline underline-offset-4 hover:text-foreground" href="/pricing">tarifs</Link>.</p>
      </div>
      <CtaBand signedIn={signedIn} title="Testez-le sur vos prochains chantiers." />
      <RelatedLinks
        links={[
          { href: "/fonctionnalites", label: "Toutes les fonctionnalités", text: "Statuts, rôles, agenda, répartition, import et webhooks." },
          { href: "/solutions/regies-prospection", label: "CRM pour régies de prospection", text: "Si vous produisez les rendez-vous pour des installateurs." },
          { href: "/pricing", label: "Tarifs", text: "Paiement sécurisé par Stripe, résiliation en un clic." },
          { href: "/#faq", label: "Questions fréquentes", text: "Essai, paiement, import, rôles : les réponses." },
          { href: "/contact", label: "Être recontacté", text: "Laissez vos coordonnées, un conseiller vous rappelle." },
        ]}
      />
      <FinalCta signedIn={signedIn} />
    </>
  );
}
