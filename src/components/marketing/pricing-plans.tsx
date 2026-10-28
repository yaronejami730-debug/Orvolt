"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, TrendingDown } from "lucide-react";
import { PLAN_LIST, TRIAL_DAYS, YEARLY_FREE_MONTHS, extraSeatPriceCents, formatPrice, monthlyEquivalentCents, type BillingInterval, supportsExtraSeats, type Plan, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { Reveal, Swap } from "./motion";
import { PlanCompare } from "./plan-compare";
import { TrialCta } from "./trial-cta";
import { PricingSimulator } from "./pricing-simulator";

/** Bascule Mensuel / Annuel. L'annuel offre 2 mois : 10 mensualités facturées d'un coup. */
export function IntervalToggle({ value, onChange, className }: { value: BillingInterval; onChange: (v: BillingInterval) => void; className?: string }) {
  const reduce = useReducedMotion();
  const uid = useId();
  const opts: { id: BillingInterval; label: string }[] = [{ id: "month", label: "Mensuel" }, { id: "year", label: `Annuel (${YEARLY_FREE_MONTHS} mois offerts)` }];
  return (
    <div className={cn("inline-flex", className)}>
      <div role="radiogroup" aria-label="Fréquence de facturation" className="inline-flex rounded-lg border bg-card p-1" data-testid="interval-toggle">
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn("relative h-8 rounded-md px-4 text-sm font-medium transition-colors duration-200", value === o.id ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {value === o.id && <motion.span layoutId={`${uid}-pill`} className="absolute inset-0 rounded-md bg-accent" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const BADGES: Partial<Record<PlanId, string>> = { business: "Le plus choisi", premium: "Le plus rentable sur la durée" };

function PlanRow({ plan, yearly, interval, signedIn, index }: { plan: Plan; yearly: boolean; interval: BillingInterval; signedIn: boolean; index: number }) {
  const reduce = useReducedMotion();
  const premium = plan.id === "premium";
  const badge = BADGES[plan.id];
  return (
    <Reveal
      as="article"
      index={index}
      data-plan={plan.id}
      className={cn("grid gap-6 py-8 md:grid-cols-2 md:items-start md:gap-x-10 lg:grid-cols-[1fr_1.2fr_auto]", plan.highlighted && "relative -mx-5 bg-accent-soft px-5 sm:-mx-8 sm:px-8 md:-mx-6 md:rounded-xl md:px-6")}
    >
      <div>
        <h3 className="flex flex-wrap items-center gap-3 text-xl font-semibold tracking-[-0.03em]">
          {plan.name}
          {badge && <span className="rounded-sm bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{badge}</span>}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
        <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
          {plan.priceFrom && <span className="basis-full text-sm text-muted-foreground">à partir de</span>}
          <Swap value={interval} className="text-5xl font-bold tracking-[-0.05em] tabular-nums" data-testid={`price-${plan.id}`}>{formatPrice(yearly ? plan.yearlyPriceCents : plan.priceCents)}</Swap>
          <span className="text-sm text-muted-foreground">{yearly ? "par an" : "par mois"}</span>
        </p>
        <p className="mt-1 h-5 text-sm text-muted-foreground">{yearly ? `soit ${formatPrice(monthlyEquivalentCents(plan))} par mois, ${YEARLY_FREE_MONTHS} mois offerts` : " "}</p>
        <p className="mt-1 text-sm font-medium">{plan.seats === null ? "Utilisateurs illimités" : `Jusqu'à ${plan.seats} utilisateurs`}</p>
        {supportsExtraSeats(plan) && (
          <p className="mt-1 text-sm text-muted-foreground" data-testid={`extra-seat-${plan.id}`}>En supplément : + {formatPrice(extraSeatPriceCents(plan, interval)!)} {yearly ? "/ an" : "/ mois"} par utilisateur en plus, quel que soit son rôle.</p>
        )}
      </div>
      <div>
        <ul className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
          {plan.features.map((f, k) => (
            <li key={f} className="flex gap-2.5">
              <motion.span
                className="mt-0.5 shrink-0"
                initial={reduce ? false : { scale: 0, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.25 + (index * 0.08) + k * 0.06 }}
              >
                <Check className="size-4 text-link" aria-hidden />
              </motion.span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
        {premium && (
          <div className="mt-5 rounded-lg border bg-muted/50 p-4 text-sm" data-testid="premium-loyalty">
            <p className="flex items-center gap-2 font-medium"><TrendingDown className="size-4 text-link" aria-hidden />Plus vous restez, moins vous payez.</p>
            <p className="mt-1.5 text-muted-foreground">Chaque palier de fidélité fait baisser votre tarif. En cas de résiliation, votre tarif repart au prix de départ.</p>
          </div>
        )}
      </div>
      <TrialCta
        signedIn={signedIn}
        plan={plan.id}
        interval={interval}
        variant={plan.highlighted ? "primary" : "secondary"}
        signedInLabel="Choisir ce plan"
        className="items-stretch md:col-span-2 md:items-start md:justify-self-start lg:col-span-1 lg:justify-self-auto"
        buttonClassName="w-full md:w-auto"
      />
    </Reveal>
  );
}

export function PricingPlans({ signedIn = false }: { signedIn?: boolean }) {
  const [freq, setFreq] = useState<BillingInterval>("month");
  const yearly = freq === "year";
  return (
    <>
      <IntervalToggle value={freq} onChange={setFreq} className="mt-8" />

      <div className="mt-8 divide-y border-y" data-testid="plans">
        {PLAN_LIST.map((plan, i) => (
          <PlanRow key={plan.id} plan={plan} yearly={yearly} interval={freq} signedIn={signedIn} index={i} />
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">{TRIAL_DAYS} jours d&apos;essai gratuit · annulation en un clic · paiement par carte ou Apple Pay via Stripe.</p>

      <PricingSimulator signedIn={signedIn} interval={freq} />
      <PlanCompare signedIn={signedIn} interval={freq} />
    </>
  );
}
