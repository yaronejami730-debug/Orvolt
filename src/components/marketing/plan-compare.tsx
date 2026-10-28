"use client";

import { Fragment } from "react";
import { Check, Minus } from "lucide-react";
import { Reveal } from "./motion";
import { TrialCta } from "./trial-cta";
import { PLAN_LIST, PLANS, TRIAL_DAYS, formatPrice, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/** Valeur d'une cellule : vrai/faux (coche ou tiret) ou texte. */
type Cell = boolean | string;
const ROWS: { label: string; values: Record<PlanId, Cell>; group?: string }[] = [
  { group: "Équipe", label: "Utilisateurs inclus", values: { starter: "3", pro: "8", business: "20", premium: "Illimités" } },
  { label: "Essai gratuit", values: { starter: `${TRIAL_DAYS} jours`, pro: `${TRIAL_DAYS} jours`, business: `${TRIAL_DAYS} jours`, premium: `${TRIAL_DAYS} jours` } },
  { group: "Leads et rendez-vous", label: "Gestion des leads", values: { starter: true, pro: true, business: true, premium: true } },
  { label: "Agenda des rendez-vous", values: { starter: true, pro: true, business: true, premium: true } },
  { label: "Rôles Administrateur et Membre", values: { starter: true, pro: true, business: true, premium: true } },
  { label: "Rôles prospecteur, confirmateur, commercial et poseur", values: { starter: false, pro: true, business: true, premium: true } },
  { label: "Suivi des statuts", values: { starter: false, pro: true, business: true, premium: true } },
  { label: "Programmation des formulaires par téléprospecteur et par domaine", values: { starter: false, pro: true, business: true, premium: true } },
  { group: "Pilotage", label: "Contrôle des distances par commercial", values: { starter: false, pro: false, business: true, premium: true } },
  { label: "Statistiques et tableaux de bord", values: { starter: false, pro: false, business: true, premium: true } },
  { label: "Utilisateur en plus (quel que soit le rôle)", values: { starter: `+ ${formatPrice(PLANS.starter.extraSeatCents!)} / mois`, pro: `+ ${formatPrice(PLANS.pro.extraSeatCents!)} / mois`, business: `+ ${formatPrice(PLANS.business.extraSeatCents!)} / mois`, premium: "Inclus" } },
  { group: "Premium", label: "Toutes les fonctionnalités", values: { starter: false, pro: false, business: false, premium: true } },
  { label: "Support prioritaire", values: { starter: false, pro: false, business: false, premium: true } },
  { label: "Tarif qui baisse avec la fidélité", values: { starter: false, pro: false, business: false, premium: true } },
];

function CellView({ v, name }: { v: Cell; name: string }) {
  if (typeof v === "string") return <span className="font-medium tabular-nums">{v}</span>;
  return v ? (
    <>
      <Check className="mx-auto size-4 text-link" strokeWidth={3} aria-hidden />
      <span className="sr-only">Inclus dans {name}</span>
    </>
  ) : (
    <>
      <Minus className="mx-auto size-4 text-muted-foreground/60" aria-hidden />
      <span className="sr-only">Non inclus dans {name}</span>
    </>
  );
}

export function PlanCompare({ signedIn = false, interval = "month" }: { signedIn?: boolean; interval?: BillingInterval }) {
  return (
    <Reveal as="section" aria-labelledby="compare-title" className="mt-20">
      <h2 id="compare-title" className="text-2xl font-bold tracking-[-0.04em] sm:text-3xl">Comparer les formules en détail</h2>
      <div className="relative mt-6 overflow-x-auto rounded-3xl border bg-card shadow-sm" data-testid="compare-table">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Comparaison des formules Starter, Pro, Business et Premium</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-4 text-left font-normal text-muted-foreground">Formule</th>
              {PLAN_LIST.map((p) => (
                <th key={p.id} scope="col" className={cn("px-4 py-4 text-center align-bottom", p.highlighted && "bg-accent-soft")}>
                  <span className="block text-base font-semibold tracking-[-0.02em]">{p.name}</span>
                  <span className="mt-1 block text-xl font-bold tabular-nums tracking-[-0.04em]">
                    {p.priceFrom && <span className="mr-1 text-xs font-normal text-muted-foreground">dès</span>}
                    {formatPrice(interval === "year" ? p.yearlyPriceCents : p.priceCents)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">{interval === "year" ? "/ an" : "/ mois"}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <Fragment key={r.label}>
                {r.group && (
                  <tr>
                    <th scope="colgroup" colSpan={5} className="sticky left-0 bg-muted/50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.group}</th>
                  </tr>
                )}
                <tr className="border-t">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-normal">{r.label}</th>
                  {PLAN_LIST.map((p) => (
                    <td key={p.id} className={cn("px-4 py-3 text-center", p.highlighted && "bg-accent-soft")}><CellView v={r.values[p.id]} name={p.name} /></td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t">
              <td className="sticky left-0 bg-card" />
              {PLAN_LIST.map((p) => (
                <td key={p.id} className={cn("px-4 py-4 text-center", p.highlighted && "bg-accent-soft")}>
                  <TrialCta signedIn={signedIn} plan={p.id} interval={interval} size="sm" variant={p.highlighted ? "primary" : "secondary"} signedInLabel="Choisir ce plan" />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground sm:hidden">Faites défiler le tableau pour voir toutes les formules.</p>
    </Reveal>
  );
}
