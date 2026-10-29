import { PLANS, TRIAL_DAYS, formatPrice } from "@/lib/billing/plans";

/** URL publique du site (SEO : canonical, sitemap, Open Graph). */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  // Hors production seulement : repli local. En production, NEXT_PUBLIC_APP_URL est obligatoire (.env.example).
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

/** URL absolue d'un chemin du site. L'accueil garde sa barre finale, comme le canonical que Next en déduit. */
export function absoluteUrl(path: string): string {
  return path === "/" ? `${siteUrl()}/` : `${siteUrl()}${path}`;
}

export const SITE_NAME = "Orvolt";
export const SITE_DESCRIPTION =
  "CRM pour installateurs d'énergie et régies de leads : statuts sur mesure, agenda terrain, répartition automatique des rendez-vous. Essai gratuit 14 jours.";

/** Profils officiels du site (LinkedIn, etc.) pour le balisage Organization. Vide tant que le propriétaire n'en a pas créé : on n'en invente aucun. */
export const SOCIAL_LINKS: string[] = [];

export type ChangeFrequency = "weekly" | "monthly" | "yearly";

/**
 * Pages publiques INDEXABLES : source unique du sitemap.xml, des balises title/description et des tests SEO.
 * `lastModified` = date (AAAA-MM-JJ) de la dernière vraie modification du contenu de la page : à mettre à jour avec elle.
 * Titres : 60 caractères au plus ; descriptions : 120 à 160 caractères.
 */
export interface PublicPage {
  path: string;
  title: string;
  description: string;
  priority: number;
  changeFrequency: ChangeFrequency;
  lastModified: string;
}

const { starter } = PLANS;

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: "/",
    title: "Orvolt : CRM pour l'énergie et les équipes de terrain",
    description: SITE_DESCRIPTION,
    priority: 1, changeFrequency: "weekly", lastModified: "2026-10-28",
  },
  {
    path: "/fonctionnalites",
    title: "Fonctionnalités du CRM Orvolt pour équipes terrain",
    description: "Statuts programmables, rôles, agenda avec zones d'intervention, répartition automatique des rendez-vous, import CSV et webhooks Meta et Google Ads.",
    priority: 0.9, changeFrequency: "monthly", lastModified: "2026-10-28",
  },
  {
    path: "/solutions/installateurs-energie",
    title: "CRM pour installateurs solaire et pompe à chaleur",
    description: "Suivez vos leads solaire, pompe à chaleur et isolation, du rendez-vous à la pose, et signez plus vite. Modèle énergie prêt à l'emploi.",
    priority: 0.8, changeFrequency: "monthly", lastModified: "2026-10-29",
  },
  {
    path: "/solutions/regies-prospection",
    title: "CRM pour régie de leads et de prospection",
    description: "Prospecteurs, confirmateurs et commerciaux sur un même dossier : rendez-vous répartis automatiquement, espaces séparés par régie partenaire.",
    priority: 0.8, changeFrequency: "monthly", lastModified: "2026-10-28",
  },
  {
    path: "/pricing",
    title: `Tarifs Orvolt : CRM dès ${formatPrice(starter.priceCents)} par mois`,
    description: `Starter, Pro, Business et Premium, mensuel ou annuel (2 mois offerts). Essai gratuit ${TRIAL_DAYS} jours, annulation en un clic, paiement sécurisé par Stripe.`,
    priority: 0.9, changeFrequency: "monthly", lastModified: "2026-10-28",
  },
  {
    path: "/mentions-legales",
    title: "Mentions légales · Orvolt",
    description: "Mentions légales du site Orvolt : identité de l'éditeur, hébergeur, propriété intellectuelle et adresse de contact pour toute question.",
    priority: 0.2, changeFrequency: "yearly", lastModified: "2026-10-01",
  },
  {
    path: "/confidentialite",
    title: "Politique de confidentialité · Orvolt",
    description: "Données collectées par Orvolt, finalités, durées de conservation, sous-traitants (dont Stripe pour les paiements) et exercice de vos droits.",
    priority: 0.2, changeFrequency: "yearly", lastModified: "2026-10-28",
  },
  {
    path: "/cgv",
    title: "Conditions générales de vente · Orvolt",
    description: "Conditions d'abonnement à Orvolt : essai gratuit, prix, paiement sécurisé par Stripe, utilisateurs supplémentaires, tarif Premium et résiliation.",
    priority: 0.2, changeFrequency: "yearly", lastModified: "2026-10-28",
  },
];

/** Pages publiques volontairement HORS index (noindex) : connexion, inscription, mot de passe, demande de rappel. Explorables, pour que le noindex soit lu. */
export const NOINDEX_PAGES = ["/login", "/signup", "/forgot", "/reset", "/contact"];

/**
 * Zones privées : application, API, aperçus internes. Interdites dans robots.txt ET servies avec `X-Robots-Tag: noindex`.
 * Chaque dossier racine de src/app/(app) doit y figurer (contrôlé par tests/unit/seo.test.ts), sinon une page privée
 * échapperait à l'en-tête noindex.
 */
export const PRIVATE_PREFIXES = ["/api/", "/dashboard", "/leads", "/agenda", "/import", "/settings", "/onboarding", "/confirmation", "/tasks", "/no-access", "/design"];

/** Fichiers techniques publics servis par l'application (explorés par les robots, sans connexion). */
export const SEO_FILES = ["/sitemap.xml", "/robots.txt", "/llms.txt", "/manifest.webmanifest", "/opengraph-image", "/apple-icon.png", "/icon.png"];

/** Le chemin appartient-il à une zone privée ? (préfixe de dossier : `/leads` couvre `/leads/12`, pas `/leadership`) */
export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}
