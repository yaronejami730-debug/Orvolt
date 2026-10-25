"use client";

import Link from "next/link";
import { Fragment, useId, useState } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAN_LIST, TRIAL_DAYS, formatPrice, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/** Valeur d'une cellule : vrai/faux (coche ou tiret) ou texte. Les lignes reprennent les fonctionnalités listées dans PLANS. */
type Cell = boolean | string;
const ROWS: { label: string; values: Record<PlanId, Cell>; group?: string }[] = [
  { group: "Équipe", label: "Utilisateurs inclus", values: { starter: "3", pro: "10", business: "Illimités" } },
  { label: "Essai gratuit", values: { starter: `${TRIAL_DAYS} jours`, pro: `${TRIAL_DAYS} jours`, business: `${TRIAL_DAYS} jours` } },
  { group: "Leads et rendez-vous", label: "Leads, Kanban et tableau illimités", values: { starter: true, pro: true, business: true } },
  { label: "Import CSV et webhooks entrants", values: { starter: true, pro: true, business: true } },
  { label: "Agenda et contrôle de distance", values: { starter: true, pro: true, business: true } },
  { label: "Statuts programmables et champs personnalisés", values: { starter: true, pro: true, business: true } },
  { label: "Répartition automatique des rendez-vous (zone, distance, horaires)", values: { starter: true, pro: true, business: true } },
  { group: "Pilotage", label: "Tableau de bord et performance par utilisateur", values: { starter: false, pro: true, business: true } },
  { label: "Actions automatiques et webhooks sortants", values: { starter: false, pro: true, business: true } },
  { group: "Organisation", label: "Espace séparé et sécurisé par entreprise", values: { starter: true, pro: true, business: true } },
  { label: "Rôles et permissions avancés", values: { starter: false, pro: false, business: true } },
  { label: "Support prioritaire", values: { starter: false, pro: false, business: true } },
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
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-8">
      <Button type="button" variant="secondary" size="lg" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)} data-testid="compare-toggle">
        {open ? "Masquer la comparaison" : "Comparer les plans"}
        <ChevronDown className={cn("size-4 transition-transform duration-300", open && "rotate-180")} aria-hidden />
      </Button>

      <div id={panelId} className="grid transition-[grid-template-rows,opacity] duration-500 ease-out" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }} inert={!open}>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <div className="relative mt-6 overflow-x-auto rounded-xl border" data-testid="compare-table">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="sr-only">Comparaison des plans Starter, Pro et Business</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-4 text-left font-normal text-muted-foreground">Plan</th>
                  {PLAN_LIST.map((p) => (
                    <th key={p.id} scope="col" className={cn("px-4 py-4 text-center align-bottom", p.highlighted && "bg-accent-soft")}>
                      <span className="block text-base font-semibold tracking-[-0.02em]">{p.name}</span>
                      <span className="mt-1 block text-xl font-bold tabular-nums tracking-[-0.04em]">{formatPrice(interval === "year" ? p.yearlyPriceCents : p.priceCents)}<span className="ml-1 text-xs font-normal text-muted-foreground">{interval === "year" ? "par an" : "par mois"}</span></span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <Fragment key={r.label}>
                    {r.group && (
                      <tr>
                        <th scope="colgroup" colSpan={4} className="sticky left-0 bg-muted/50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.group}</th>
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
                      <Button asChild size="sm" variant={p.highlighted ? "primary" : "secondary"}>
                        <Link href={signedIn ? "/settings/billing" : "/signup"}>{signedIn ? `Choisir ${p.name}` : "Essai gratuit"}</Link>
                      </Button>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground sm:hidden">Faites défiler le tableau pour voir tous les plans.</p>
        </div>
      </div>
    </div>
  );
}
