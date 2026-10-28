import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, absoluteUrl } from "@/lib/site";

/** Pages indexables uniquement (jamais l'application, la connexion ni l'inscription), avec leur vraie date de modification. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((p) => ({ url: absoluteUrl(p.path), lastModified: p.lastModified, changeFrequency: p.changeFrequency, priority: p.priority }));
}
