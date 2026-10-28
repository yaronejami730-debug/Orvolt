import type { Metadata } from "next";
import type { FaqItem } from "@/components/marketing/faq-data";
import { PLAN_LIST, TRIAL_DAYS, type Plan } from "@/lib/billing/plans";
import { legalValue } from "@/lib/legal";
import { PUBLIC_PAGES, SITE_DESCRIPTION, SITE_NAME, SOCIAL_LINKS, absoluteUrl, siteUrl, type PublicPage } from "@/lib/site";

const pageOf = (path: string): PublicPage => {
  const p = PUBLIC_PAGES.find((x) => x.path === path);
  if (!p) throw new Error(`Page publique inconnue : ${path} (à ajouter dans PUBLIC_PAGES).`);
  return p;
};

/**
 * Métadonnées d'une page publique : title, description, canonical, hreflang, Open Graph et Twitter.
 * L'image de partage (src/app/opengraph-image.tsx) est déclarée explicitement ; Twitter la reprend de Open Graph.
 */
export function pageMetadata(path: string): Metadata {
  const { title, description } = pageOf(path);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path, languages: { "fr-FR": path, "x-default": path } },
    openGraph: { type: "website", url: path, siteName: SITE_NAME, title, description, locale: "fr_FR", images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${SITE_NAME}, le CRM des équipes de terrain` }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Pages sans valeur de référencement (connexion, inscription, rappel…) : exclues de l'index, liens non suivis. */
export const NOINDEX_METADATA = { robots: { index: false, follow: false } } satisfies Metadata;

const orgId = () => `${siteUrl()}/#organization`;
const siteId = () => `${siteUrl()}/#website`;

/** Organisation : uniquement des faits connus. Les coordonnées juridiques n'apparaissent que si le propriétaire les a renseignées (src/lib/legal.ts). */
export function organizationSchema() {
  const legalName = legalValue("raisonSociale");
  const email = legalValue("emailContact");
  return {
    "@type": "Organization",
    "@id": orgId(),
    name: SITE_NAME,
    ...(legalName ? { legalName } : {}),
    url: absoluteUrl("/"),
    logo: { "@type": "ImageObject", url: `${siteUrl()}/icon.png`, width: 512, height: 512 },
    description: SITE_DESCRIPTION,
    ...(SOCIAL_LINKS.length ? { sameAs: SOCIAL_LINKS } : {}),
    ...(email ? { contactPoint: { "@type": "ContactPoint", contactType: "customer support", email, availableLanguage: "French" } } : {}),
  };
}

export function websiteSchema() {
  return { "@type": "WebSite", "@id": siteId(), name: SITE_NAME, url: absoluteUrl("/"), inLanguage: "fr-FR", publisher: { "@id": orgId() } };
}

/** Une offre par formule et par fréquence, prix EXACTS de PLANS (Premium : prix de départ d'un tarif dégressif). */
export function planOffers(plans: Plan[] = PLAN_LIST) {
  const url = absoluteUrl("/pricing");
  return plans.flatMap((p) =>
    (["month", "year"] as const).map((interval) => {
      const cents = interval === "year" ? p.yearlyPriceCents : p.priceCents;
      const price = (cents / 100).toFixed(2);
      const seats = p.seats === null ? "utilisateurs illimités" : `${p.seats} utilisateurs inclus`;
      const premium = p.priceFrom ? " Prix de départ : le tarif baisse selon l'ancienneté." : "";
      return {
        "@type": "Offer",
        name: `${p.name} ${interval === "year" ? "annuel" : "mensuel"}`,
        description: `${p.tagline} ${seats[0].toUpperCase()}${seats.slice(1)}. Essai gratuit ${TRIAL_DAYS} jours.${premium}`,
        price,
        priceCurrency: "EUR",
        url,
        priceSpecification: { "@type": "UnitPriceSpecification", price, priceCurrency: "EUR", unitCode: interval === "year" ? "ANN" : "MON" },
      };
    }),
  );
}

/** Logiciel en ligne. Aucune note, avis ni chiffre client : seulement le produit et ses prix. */
export function softwareSchema() {
  return {
    "@type": "SoftwareApplication",
    "@id": `${siteUrl()}/#software`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: absoluteUrl("/"),
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "CRM",
    operatingSystem: "Web",
    inLanguage: "fr-FR",
    publisher: { "@id": orgId() },
    offers: planOffers(),
  };
}

/** FAQ : les questions et réponses doivent être celles affichées sur la page (le texte est dans le HTML, y compris volets fermés). */
export function faqSchema(items: FaqItem[]) {
  return { "@type": "FAQPage", mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
}

export interface Crumb { name: string; path: string }

/** Fil d'Ariane (le dernier maillon est la page courante). */
export function breadcrumbSchema(crumbs: Crumb[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absoluteUrl(c.path) })),
  };
}

/** Enveloppe schema.org : un seul bloc @graph par page. */
export const graph = (...nodes: object[]) => ({ "@context": "https://schema.org", "@graph": nodes });

/** JSON-LD en texte sûr pour une balise <script> : `<` et séparateurs de ligne Unicode sont échappés (aucune sortie de balise possible). */
export const serializeJsonLd = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, "\\u003c").replace(new RegExp("[\\u2028\\u2029]", "g"), (c) => `\\u${c.charCodeAt(0).toString(16)}`);
