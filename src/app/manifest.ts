import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} CRM`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: "fr-FR",
    start_url: "/",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#2b59ff",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  };
}
