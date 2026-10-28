import type { MetadataRoute } from "next";
import { PRIVATE_PREFIXES, siteUrl } from "@/lib/site";

/**
 * Robots publics (Google, Bing) et robots d'IA légitimes : tous autorisés sur les pages publiques, car le site veut être
 * trouvé, cité et résumé par les moteurs et assistants. L'application et l'API restent interdites à tous.
 * Une règle propre à un robot remplace la règle « * » : la liste d'exclusion est donc répétée dans chaque groupe.
 * Les pages de connexion/inscription ne sont PAS bloquées ici : elles restent explorables pour que leur en-tête
 * `X-Robots-Tag: noindex` soit lu (une page bloquée peut être indexée sans contenu si des liens y mènent).
 */
const AI_AND_SEARCH_BOTS = [
  "Googlebot", "Bingbot", "Applebot", "DuckDuckBot",
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",
  "ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai",
  "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  const rule = { allow: "/", disallow: PRIVATE_PREFIXES };
  return {
    rules: [{ userAgent: "*", ...rule }, ...AI_AND_SEARCH_BOTS.map((userAgent) => ({ userAgent, ...rule }))],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

