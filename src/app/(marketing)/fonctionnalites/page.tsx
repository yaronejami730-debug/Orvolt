import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { Block, PageHero, RelatedLinks } from "@/components/marketing/page-sections";
import { PaymentSecurity } from "@/components/marketing/payment-security";
import { CtaBand, FinalCta } from "@/components/marketing/sections";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { isSignedIn } from "@/lib/marketing-session";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("/fonctionnalites");

export default async function FeaturesPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <Breadcrumbs trail={[{ name: "Fonctionnalités", path: "/fonctionnalites" }]} />
      <PageHero
        signedIn={signedIn}
        title="Les fonctionnalités du CRM Orvolt pour les équipes de terrain"
        intro="Orvolt suit chaque lead de l'appel à la signature : statuts sur mesure, rôles, agenda, répartition automatique des rendez-vous, import et webhooks. Voici ce que fait l'application."
      />
      <Block
        id="leads"
        title="Suivre chaque lead jusqu'à la signature"
        items={[
          { title: "Kanban et statuts programmables", feature: "status_tracking", text: "Vous définissez vos étapes, leurs couleurs et qui peut faire passer un lead de l'une à l'autre. Un passage peut assigner le lead, prévenir quelqu'un, créer une tâche ou appeler un webhook." },
          { title: "Champs personnalisés", text: "Texte, nombre, date, liste, fichier, adresse : la fiche lead reflète votre activité, pas celle d'un autre métier." },
          { title: "Trames d'appel", text: "Le téléprospecteur suit pendant l'appel un formulaire de questions que vous avez préparé : réponse courte ou longue, nombre, oui ou non, choix unique ou multiples, date." },
          { title: "Tâches et rappels", text: "Chaque personne retrouve ses tâches. L'application prévient dans l'interface et envoie par e-mail des rappels de rendez-vous et de tâches échues." },
        ]}
      />
      <Block
        id="equipe"
        title="Une équipe, chacun son rôle"
        items={[
          { title: "Rôles et permissions", feature: "specialized_roles", text: "Super administrateur, administrateur, membre, prospecteur, confirmateur, commercial et poseur : chacun voit et fait ce qu'il doit, rien de plus. Les formules Starter proposent les rôles Administrateur et Membre." },
          { title: "Rôles personnalisés", feature: "custom_roles", text: "Créez vos propres rôles et réglez leurs droits un par un." },
          { title: "Espaces séparés", text: "Chaque entreprise a son espace. Les données d'une entreprise ne se croisent jamais avec celles d'une autre." },
          { title: "Régies partenaires", text: "Chaque régie partenaire a son propre espace, ses rôles et ses membres, et ne voit jamais votre régie. Vous y accédez en tant que super administrateur." },
        ]}
      />
      <Block
        id="rendez-vous"
        title="Planifier et répartir les rendez-vous"
        intro="Le confirmateur valide, le moteur propose, vous gardez la décision."
        items={[
          { title: "Répartition automatique des rendez-vous", text: "Dès que le confirmateur valide, le moteur propose le commercial et l'heure de chaque rendez-vous : rayon autour de la base, temps de route réel, horaires et maximum par jour réglés par commercial. Vous voyez la proposition avant de la valider." },
          { title: "Agenda par commercial", text: "Les rendez-vous attribués tombent dans la journée du commercial, avec le trajet et la durée affichés entre deux rendez-vous." },
          { title: "Zones d'intervention et contrôle de distance", feature: "distance_control", text: "Si le lieu d'un rendez-vous sort de la zone d'intervention du commercial, une alerte s'affiche, et toute dérogation est tracée." },
          { title: "Confirmation des rendez-vous", text: "Le confirmateur dispose d'un écran dédié pour confirmer les rendez-vous planifiés avant leur répartition." },
        ]}
      />
      <Block
        id="alimentation"
        title="Alimenter le CRM sans ressaisie"
        items={[
          { title: "Import CSV", text: "Déposez le fichier, associez les colonnes aux champs, simulez l'import et récupérez un rapport d'erreurs. Les doublons sont repérés avant l'import." },
          { title: "Webhooks Meta Lead Ads et Google Ads", text: "Vos leads Meta et Google arrivent seuls dans le CRM. Un point d'entrée générique reçoit aussi les leads de vos autres formulaires." },
        ]}
      />
      <Block
        id="pilotage"
        title="Piloter l'activité"
        items={[
          { title: "Tableau de bord et statistiques", feature: "analytics", text: "Leads par statut et par source, taux de conversion, rendez-vous, résultats par personne, sur la période de votre choix." },
          { title: "Modèle énergie prêt à l'emploi", text: "Pompe à chaleur, panneaux solaires, isolation : statuts, champs du logement et sources de leads sont créés à l'inscription. Vous gardez ce qui vous sert, vous changez le reste." },
        ]}
      />
      <div className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8 sm:pb-24">
        <h2 className="text-2xl font-bold tracking-[-0.04em] sm:text-4xl">Abonnement simple, paiement sécurisé</h2>
        <p className="mt-4 max-w-2xl text-muted-foreground sm:text-lg">Quatre formules selon la taille de l&apos;équipe, {TRIAL_DAYS} jours d&apos;essai avec toutes les fonctionnalités, résiliation depuis le portail de facturation.</p>
        <PaymentSecurity as="h3" />
      </div>
      <CtaBand signedIn={signedIn} title="Essayez-le avec vos propres leads." />
      <RelatedLinks
        links={[
          { href: "/pricing", label: "Tarifs", text: "Starter, Pro, Business et Premium, mensuel ou annuel." },
          { href: "/solutions/installateurs-energie", label: "CRM pour installateurs d'énergie", text: "Solaire, pompe à chaleur, isolation : le modèle prêt à l'emploi." },
          { href: "/solutions/regies-prospection", label: "CRM pour régies de prospection", text: "Prospecteurs, confirmateurs, commerciaux et régies partenaires." },
          { href: "/#faq", label: "Questions fréquentes", text: "Essai, paiement, import, rôles : les réponses." },
          { href: "/contact", label: "Être recontacté", text: "Laissez vos coordonnées, un conseiller vous rappelle." },
        ]}
      />
      <FinalCta signedIn={signedIn} />
    </>
  );
}
