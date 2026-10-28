import { serializeJsonLd } from "@/lib/seo";

/** Données structurées JSON-LD : bloc de données non exécutable (compatible CSP à nonce). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
