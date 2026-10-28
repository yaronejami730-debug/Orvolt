import { PUBLIC_PAGES, SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/site";

/** Résumé du site pour les assistants IA (format llms.txt). Facultatif, ignoré par Google ; généré depuis PUBLIC_PAGES, donc toujours à jour. */
export function GET() {
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "## Pages",
    ...PUBLIC_PAGES.map((p) => `- [${p.title}](${absoluteUrl(p.path)}) : ${p.description}`),
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
