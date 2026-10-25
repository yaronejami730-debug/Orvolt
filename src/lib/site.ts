/** URL publique du site (SEO : canonical, sitemap, Open Graph). */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  // Hors production seulement : repli local. En production, NEXT_PUBLIC_APP_URL est obligatoire (.env.example).
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

export const SITE_NAME = "LeadForge";
export const SITE_DESCRIPTION =
  "LeadForge est un CRM pour les équipes de terrain : suivez chaque lead de l'appel à la signature avec des statuts sur mesure, des rôles, un agenda avec zone d'intervention, l'import CSV et les webhooks. Essai gratuit 14 jours.";

/** Public routes listed in sitemap.xml. */
export const PUBLIC_PAGES: { path: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/signup", priority: 0.8, changeFrequency: "monthly" },
  { path: "/login", priority: 0.4, changeFrequency: "yearly" },
  { path: "/mentions-legales", priority: 0.2, changeFrequency: "yearly" },
  { path: "/confidentialite", priority: 0.2, changeFrequency: "yearly" },
  { path: "/cgv", priority: 0.2, changeFrequency: "yearly" },
];

/** Prefixes kept out of the index (authenticated app, API). */
export const PRIVATE_PREFIXES = ["/api/", "/dashboard", "/leads", "/agenda", "/import", "/settings", "/onboarding", "/no-access", "/design"];
