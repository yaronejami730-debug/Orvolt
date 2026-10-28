import Link from "next/link";
import { breadcrumbSchema, graph, type Crumb } from "@/lib/seo";
import { JsonLd } from "./json-ld";

/** Fil d'Ariane visible + balisage BreadcrumbList identique. Le dernier maillon est la page courante. */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const all: Crumb[] = [{ name: "Accueil", path: "/" }, ...trail];
  return (
    <nav aria-label="Fil d'Ariane" className="mx-auto w-full max-w-6xl px-5 pt-6 sm:px-8">
      <JsonLd data={graph(breadcrumbSchema(all))} />
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {all.map((c, i) => (
          <li key={c.path} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden>/</span>}
            {i === all.length - 1 ? <span aria-current="page" className="text-foreground">{c.name}</span> : <Link href={c.path} className="underline-offset-4 hover:text-foreground hover:underline">{c.name}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
