"use client";

import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAN_LIST, TRIAL_DAYS, YEARLY_FREE_MONTHS, formatPrice, monthlyEquivalentCents, type BillingInterval } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { PlanCompare } from "./plan-compare";

/** Bascule Mensuel / Annuel. L'annuel offre 2 mois : 10 mensualités facturées d'un coup. */
export function IntervalToggle({ value, onChange, className }: { value: BillingInterval; onChange: (v: BillingInterval) => void; className?: string }) {
  const opts: { id: BillingInterval; label: string }[] = [{ id: "month", label: "Mensuel" }, { id: "year", label: "Annuel" }];
  return (
    <div className={cn("inline-flex items-center gap-3", className)}>
      <div role="radiogroup" aria-label="Fréquence de facturation" className="inline-flex rounded-lg border bg-card p-1" data-testid="interval-toggle">
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn("h-8 rounded-md px-4 text-sm font-medium transition-colors", value === o.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="rounded-sm bg-success/15 px-2 py-0.5 text-xs font-medium text-success-text">{YEARLY_FREE_MONTHS} mois offerts</span>
    </div>
  );
}

export function PricingPlans({ signedIn = false }: { signedIn?: boolean }) {
  const [freq, setFreq] = useState<BillingInterval>("month");
  const yearly = freq === "year";
  return (
    <>
      <IntervalToggle value={freq} onChange={setFreq} className="mt-8" />
      <div className="mt-8 divide-y border-y">
        {PLAN_LIST.map((plan) => (
          <article
            key={plan.id}
            data-plan={plan.id}
            className={cn("grid gap-6 py-8 md:grid-cols-[1fr_1.2fr_auto] md:items-start md:gap-10", plan.highlighted && "relative -mx-5 bg-accent-soft px-5 sm:-mx-8 sm:px-8 md:rounded-xl md:-mx-6 md:px-6")}
          >
            <div>
              <h3 className="flex items-center gap-3 text-xl font-semibold tracking-[-0.03em]">
                {plan.name}
                {plan.highlighted && <span className="rounded-sm bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Le plus choisi</span>}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
              <p className="mt-5 flex items-baseline gap-1.5">
                <span className="text-5xl font-bold tracking-[-0.05em] tabular-nums" data-testid={`price-${plan.id}`}>{formatPrice(yearly ? plan.yearlyPriceCents : plan.priceCents)}</span>
                <span className="text-sm text-muted-foreground">{yearly ? "par an" : "par mois"}</span>
              </p>
              <p className="mt-1 h-5 text-sm text-muted-foreground">{yearly ? `soit ${formatPrice(monthlyEquivalentCents(plan))} par mois, ${YEARLY_FREE_MONTHS} mois offerts` : " "}</p>
              <p className="mt-1 text-sm font-medium">{plan.seats === null ? "Utilisateurs illimités" : `Jusqu'à ${plan.seats} utilisateurs`}</p>
            </div>
            <ul className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant={plan.highlighted ? "primary" : "secondary"} size="lg" className="w-full md:w-auto">
              <Link href={signedIn ? "/settings/billing" : "/signup"}>{signedIn ? `Choisir ${plan.name}` : `Essai gratuit ${TRIAL_DAYS} jours`}</Link>
            </Button>
          </article>
        ))}
      </div>
      <PlanCompare signedIn={signedIn} interval={freq} />
    </>
  );
}
