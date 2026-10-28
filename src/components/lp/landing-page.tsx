import type { Metadata } from "next";
import Link from "next/link";
import { LandingForm } from "@/components/lp/landing-form";
import { LANDING_PAGES, LP_HINT, type LandingCopy } from "@/lib/landing/copy";

type PageId = keyof typeof LANDING_PAGES;

/** Métadonnées d'une page d'acquisition : hors index, canonical vers elle-même. */
export function landingMetadata(id: PageId): Metadata {
  const c = LANDING_PAGES[id];
  return { title: c.metaTitle, description: c.metaDescription, alternates: { canonical: c.path }, robots: { index: false, follow: false } };
}

/** Une promesse, un formulaire, trois arguments : tout le reste a été retiré. */
export function LandingPage({ id }: { id: PageId }) {
  const c: LandingCopy = LANDING_PAGES[id];
  return (
    <div className="mx-auto w-full max-w-xl px-5 pb-24 pt-10 sm:px-8 sm:pt-20">
      <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl">{c.title}</h1>
      <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">{c.lead}</p>

      <div className="mt-10 sm:mt-12">
        <LandingForm kind={c.kind} trade={c.trade} submitLabel={c.submitLabel} hint={LP_HINT} path={c.path} />
        <p className="mt-6 text-center text-sm">
          <Link href={c.alt.href} className="text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground" data-track-cta="alt">{c.alt.label}</Link>
        </p>
      </div>

      {c.points.length > 0 && (
        <ul className="mt-20 space-y-8 border-t pt-12">
          {c.points.map((p) => (
            <li key={p.title}>
              <h2 className="text-base font-semibold tracking-[-0.02em]">{p.title}</h2>
              <p className="mt-1.5 text-muted-foreground">{p.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
