"use client";

import { useId, useState } from "react";
import { ArrowDownRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { TrialCta } from "./trial-cta";
import { Reveal, Swap } from "./motion";
import { PLAN_LIST, PLANS, extraSeatPriceCents, formatPrice, type BillingInterval, type PlanId } from "@/lib/billing/plans";

const MAX_USERS = 40;
const MAX_SALES = 50;

export interface Recommendation { plan: PlanId; extraSeats: number }

/**
 * Plus petite formule dont le nombre d'utilisateurs couvre l'équipe. Au-delà de Business : Business + utilisateurs
 * supplémentaires tant que c'est moins cher que le Premium (illimité), puis Premium.
 */
export function recommend(users: number): Recommendation {
  const fit = PLAN_LIST.find((p) => p.seats === null || users <= p.seats)!;
  if (fit.seats !== null) return { plan: fit.id, extraSeats: 0 };
  const biz = PLANS.business;
  const extraSeats = users - biz.seats!;
  return biz.priceCents + extraSeats * biz.extraSeatCents! < PLANS.premium.priceCents ? { plan: "business", extraSeats } : { plan: "premium", extraSeats: 0 };
}

function Slider({ label, value, max, min, onChange, display }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; display: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <output htmlFor={id} className="text-2xl font-bold tabular-nums tracking-[-0.04em]">{display}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 h-2 w-full cursor-pointer accent-[var(--accent)]"
      />
    </div>
  );
}

/** Jauge « Votre tarif baisse avec le temps » : aucun montant, seulement la tendance. */
function LoyaltyGauge() {
  const reduce = useReducedMotion();
  return (
    <div data-testid="premium-gauge" className="mt-5 rounded-2xl bg-foreground p-5 text-background">
      <p className="flex items-center gap-2 text-sm font-medium"><ArrowDownRight className="size-4 text-background" aria-hidden />Votre tarif baisse avec le temps</p>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-background/20" role="img" aria-label="Le tarif diminue à chaque palier de fidélité">
        <motion.div
          className="h-full w-full origin-left rounded-full bg-gradient-to-r from-accent to-link"
          style={{ clipPath: "polygon(0 0, 100% 35%, 100% 100%, 0 100%)" }}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-background/70"><span>Prix de départ</span><span>Palier fidélité</span></div>
    </div>
  );
}

export function PricingSimulator({ signedIn = false, interval = "month" }: { signedIn?: boolean; interval?: BillingInterval }) {
  const [users, setUsers] = useState(5);
  const [sales, setSales] = useState(10);
  const rec = recommend(users);
  const plan = PLANS[rec.plan];
  const total = (interval === "year" ? plan.yearlyPriceCents : plan.priceCents) + rec.extraSeats * (extraSeatPriceCents(plan, interval) ?? 0);
  const monthlyTotal = plan.priceCents + rec.extraSeats * (plan.extraSeatCents ?? 0);
  const premium = plan.id === "premium";
  const perSale = sales > 0 ? monthlyTotal / sales : null;
  return (
    <Reveal as="section" aria-labelledby="sim-title" className="mt-20 rounded-3xl border bg-card p-6 shadow-sm sm:p-10" data-testid="pricing-simulator">
      <h2 id="sim-title" className="text-2xl font-bold tracking-[-0.04em] sm:text-3xl">Combien vous coûte votre CRM ?</h2>
      <p className="mt-2 text-muted-foreground">Indiquez la taille de votre équipe et votre rythme de ventes.</p>

      <div className="mt-8 grid gap-10 md:grid-cols-2 md:gap-14">
        <div className="space-y-8">
          <Slider label="Utilisateurs" min={1} max={MAX_USERS} value={users} onChange={setUsers} display={users === MAX_USERS ? `${MAX_USERS}+` : String(users)} />
          <Slider label="Ventes par mois" min={0} max={MAX_SALES} value={sales} onChange={setSales} display={sales === MAX_SALES ? `${MAX_SALES}+` : String(sales)} />
        </div>

        <div className="rounded-2xl bg-accent-soft p-6" aria-live="polite">
          <p className="text-sm text-muted-foreground">Formule recommandée</p>
          <p className="mt-1 text-3xl font-bold tracking-[-0.04em]"><Swap value={plan.id} data-testid="sim-plan">{plan.name}</Swap></p>
          {premium ? (
            <LoyaltyGauge />
          ) : (
            <p className="mt-2 tabular-nums" data-testid="sim-price">
              <span className="text-xl font-semibold">{formatPrice(total)}</span>
              <span className="text-sm text-muted-foreground"> {interval === "year" ? "par an" : "par mois"}</span>
              {rec.extraSeats > 0 && <span className="text-sm text-muted-foreground" data-testid="sim-extra"> dont {rec.extraSeats} utilisateur{rec.extraSeats > 1 ? "s" : ""} en plus</span>}
              {perSale !== null && <span className="text-sm text-muted-foreground"> · soit {formatPrice(Math.round(perSale))} par vente et par mois</span>}
            </p>
          )}
          <p className="mt-4 font-medium">Une seule vente supplémentaire par mois rembourse votre abonnement.</p>
          <TrialCta signedIn={signedIn} plan={plan.id} interval={interval} hint="below" signedInLabel="Choisir ce plan" className="mt-5 items-stretch sm:items-start" buttonClassName="w-full sm:w-auto" />
        </div>
      </div>
    </Reveal>
  );
}
