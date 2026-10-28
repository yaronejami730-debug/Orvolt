import Link from "next/link";
import { Button } from "@/components/ui/button";
import { minPlanFor, type PlanFeature } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { TrialCta } from "./trial-cta";

/** En-tête des pages d'information : un seul h1, accroche, bouton d'essai unique (TrialCta) et lien vers les tarifs. */
export function PageHero({ title, intro, signedIn }: { title: string; intro: string; signedIn: boolean }) {
  return (
    <section aria-labelledby="page-title" className="relative isolate overflow-hidden">
      <div className="mk-fluid -z-10" aria-hidden><i /><i /><i /></div>
      <div className="mx-auto w-full max-w-6xl px-5 pb-14 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
        <h1 id="page-title" className="max-w-4xl text-balance text-4xl font-bold leading-[1.05] tracking-[-0.05em] sm:text-6xl">{title}</h1>
        <p className="mt-6 max-w-2xl text-pretty text-base text-foreground/75 sm:text-lg">{intro}</p>
        <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:gap-3">
          <TrialCta signedIn={signedIn} hint="below" className="items-start" />
          <Button asChild size="lg" variant="secondary"><Link href="/pricing">Voir les tarifs</Link></Button>
        </div>
      </div>
    </section>
  );
}

export interface Item { title: string; text: string; /** Fonctionnalité réservée à un plan : affiche « Dès <plan> » (lu dans PLAN_FEATURES, jamais écrit en dur). */ feature?: PlanFeature }

/** Bloc thématique : h2, accroche, liste d'éléments (aucun `article` : la landing d'accueil en compte un nombre fixe). */
export function Block({ id, title, intro, items, cols = 2 }: { id: string; title: string; intro?: string; items: Item[]; cols?: 2 | 3 }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 pb-16 sm:pb-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <h2 id={`${id}-title`} className="max-w-3xl text-balance text-2xl font-bold tracking-[-0.04em] sm:text-4xl">{title}</h2>
        {intro && <p className="mt-4 max-w-2xl text-muted-foreground sm:text-lg">{intro}</p>}
        <ul className={cn("mt-10 grid gap-4", cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
          {items.map((it) => (
            <li key={it.title} className="rounded-2xl border bg-card p-6">
              <h3 className="text-lg font-semibold tracking-[-0.02em]">{it.title}</h3>
              {it.feature && <p className="mt-1 text-xs font-medium text-muted-foreground">Dès la formule {minPlanFor(it.feature).name} (inclus pendant l&apos;essai)</p>}
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Liens internes explicites (maillage) vers les autres pages du site. */
export function RelatedLinks({ links }: { links: { href: string; label: string; text: string }[] }) {
  return (
    <nav aria-labelledby="related-title" className="pb-16 sm:pb-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <h2 id="related-title" className="text-2xl font-bold tracking-[-0.04em] sm:text-3xl">Pour aller plus loin</h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="block h-full rounded-2xl border bg-card p-5 transition-colors hover:bg-muted/60">
                <span className="font-semibold underline-offset-4">{l.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{l.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
