import type { ReactNode } from "react";
import { LEGAL_LABELS, missingLegalFields } from "@/lib/legal";
import { Breadcrumbs } from "./breadcrumbs";

/** Mise en page des pages légales. Hors production, un bandeau liste les informations manquantes de src/lib/legal.ts. */
export function LegalPage({ title, updated, path, children }: { title: string; updated: string; /** Chemin de la page, pour le fil d'Ariane. */ path: string; children: ReactNode }) {
  const missing = process.env.NODE_ENV === "production" ? [] : missingLegalFields();
  return (
    <>
    <Breadcrumbs trail={[{ name: title, path }]} />
    <article className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">Dernière mise à jour : {updated}</p>
      {missing.length > 0 && (
        <p className="mt-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground" data-testid="legal-missing">
          Développement : informations légales à renseigner dans src/lib/legal.ts avant la mise en production ({missing.map((k) => LEGAL_LABELS[k]).join(", ")}).
        </p>
      )}
      <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-muted-foreground [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5">{children}</div>
    </article>
    </>
  );
}
