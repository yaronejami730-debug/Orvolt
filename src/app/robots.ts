import type { MetadataRoute } from "next";
import { PRIVATE_PREFIXES, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PREFIXES }], sitemap: `${siteUrl()}/sitemap.xml`, host: siteUrl() };
}
