import { TRIAL_DAYS } from "@/lib/billing/plans";
import { SITE_NAME } from "@/lib/site";

/** Micro-texte de réassurance : uniquement ce que le code et la FAQ confirment (essai, résiliation en un clic, Stripe). */
export const LP_HINT = `${TRIAL_DAYS} jours d'essai · annulation en un clic · paiements sécurisés par Stripe`;

export interface LandingCopy {
  kind: "essai" | "rappel";
  trade?: "installateurs" | "regies";
  path: string;
  /** <title> (le gabarit ajoute le nom du site). */
  metaTitle: string;
  metaDescription: string;
  title: string;
  lead: string;
  points: { title: string; text: string }[];
  submitLabel: string;
  /** Lien secondaire sous le formulaire. */
  alt: { label: string; href: string };
}

export const LANDING_PAGES: Record<"essai" | "rappel" | "installateurs" | "regies", LandingCopy> = {
  essai: {
    kind: "essai",
    path: "/lp/essai",
    metaTitle: `Testez gratuitement ${TRIAL_DAYS} jours`,
    metaDescription: `Essayez ${SITE_NAME} ${TRIAL_DAYS} jours avec votre équipe : leads, statuts, agenda et rôles.`,
    title: `Testez gratuitement ${TRIAL_DAYS} jours`,
    lead: `${SITE_NAME} suit chaque lead de l'appel à la signature. Laissez vos coordonnées : votre inscription est prête en deux minutes.`,
    points: [
      { title: "Des leads bien suivis", text: "Statuts sur mesure, champs personnalisés et rôles pour chaque membre de l'équipe." },
      { title: "Un agenda qui sait où aller", text: "Rendez-vous avec zone d'intervention et répartition automatique entre vos commerciaux." },
      { title: "Vos leads arrivent seuls", text: "Import CSV et webhooks Meta Lead Ads, Google Ads ou personnalisés." },
    ],
    submitLabel: "Démarrer l'essai",
    alt: { label: "Je crée mon compte tout de suite", href: "/signup" },
  },
  rappel: {
    kind: "rappel",
    path: "/lp/rappel",
    metaTitle: "Être rappelé",
    metaDescription: `Laissez votre numéro : un conseiller ${SITE_NAME} vous rappelle dans les meilleurs délais.`,
    title: "Être rappelé",
    lead: `Laissez votre numéro : un conseiller ${SITE_NAME} vous rappelle dans les meilleurs délais, au moment qui vous arrange.`,
    points: [],
    submitLabel: "Être rappelé",
    alt: { label: "Je préfère démarrer l'essai maintenant", href: "/lp/essai" },
  },
  installateurs: {
    kind: "essai",
    trade: "installateurs",
    path: "/lp/installateurs",
    metaTitle: "Le CRM des installateurs",
    metaDescription: `Agenda, répartition automatique des rendez-vous par zones et rôle poseur : essayez ${SITE_NAME} ${TRIAL_DAYS} jours.`,
    title: "Vos rendez-vous répartis par zone, automatiquement",
    lead: `Chaque rendez-vous arrive dans l'agenda du bon commercial, selon sa zone d'intervention. Essayez ${SITE_NAME} ${TRIAL_DAYS} jours avec votre équipe.`,
    points: [
      { title: "Un agenda partagé", text: "Rendez-vous, adresses et zone d'intervention de chaque commercial au même endroit." },
      { title: "Répartition automatique par zones", text: "Les rendez-vous sont attribués selon la zone d'intervention de chacun de vos commerciaux." },
      { title: "Un rôle pour vos poseurs", text: "Chacun voit ce qui le concerne, rien de plus. Vous gardez la main sur les droits." },
    ],
    submitLabel: "Démarrer l'essai",
    alt: { label: "Je préfère être rappelé", href: "/lp/rappel" },
  },
  regies: {
    kind: "essai",
    trade: "regies",
    path: "/lp/regies",
    metaTitle: "Le CRM des régies de prospection",
    metaDescription: `Leads, rôles prospecteur et confirmateur, webhooks Meta et Google, sous-régies : essayez ${SITE_NAME} ${TRIAL_DAYS} jours.`,
    title: "Chaque lead suivi, de la prospection à la confirmation",
    lead: `Prospecteurs, confirmateurs, sous-régies : chacun travaille dans son périmètre, vous suivez tout. Essayez ${SITE_NAME} ${TRIAL_DAYS} jours.`,
    points: [
      { title: "Des rôles adaptés", text: "Prospecteur, confirmateur, commercial : chaque rôle voit uniquement ce qui le concerne." },
      { title: "Des leads qui arrivent seuls", text: "Webhooks Meta Lead Ads et Google Ads, import CSV, et un lien de webhook personnalisé." },
      { title: "Des sous-régies rattachées", text: "Invitez une régie partenaire : vous suivez l'avancement de chaque lead en temps réel." },
    ],
    submitLabel: "Démarrer l'essai",
    alt: { label: "Je préfère être rappelé", href: "/lp/rappel" },
  },
};
