/** Plans d'abonnement : source unique du nombre de sièges (seat_limit) et des tarifs affichés. */
export const PLAN_IDS = ["starter", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** Nombre d'utilisateurs actifs inclus (= organizations.seat_limit) ; null = illimité. */
  seats: number | null;
  /** Prix mensuel en centimes d'euro. */
  priceCents: number;
  /** Prix annuel en centimes d'euro (2 mois offerts). */
  yearlyPriceCents: number;
  /** Clés de recherche Stripe (idempotentes), mensuelle et annuelle. */
  lookupKey: string;
  lookupKeyYearly: string;
  tagline: string;
  features: string[];
  highlighted?: boolean;
}

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
/** Paiement à l'année : 2 mois offerts, soit 10 mensualités facturées d'un coup. */
export const YEARLY_FREE_MONTHS = 2;

export const TRIAL_DAYS = 14;
/** Sièges pendant l'essai applicatif (avant toute souscription). */
export const TRIAL_SEATS = 5;
/** Délai de grâce après un paiement échoué (jours). */
export const GRACE_DAYS = 7;
export const CURRENCY = "eur";

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter", name: "Starter", seats: 3, priceCents: 990, yearlyPriceCents: 990 * (12 - YEARLY_FREE_MONTHS), lookupKey: "leadforge_starter_monthly", lookupKeyYearly: "leadforge_starter_yearly",
    tagline: "Pour démarrer avec une petite équipe.",
    features: ["3 utilisateurs", "Leads, Kanban et tableau illimités", "Import CSV et webhooks entrants", "Agenda et contrôle de distance"],
  },
  pro: {
    id: "pro", name: "Pro", seats: 10, priceCents: 7900, yearlyPriceCents: 7900 * (12 - YEARLY_FREE_MONTHS), lookupKey: "leadforge_pro_monthly", lookupKeyYearly: "leadforge_pro_yearly", highlighted: true,
    tagline: "Pour les équipes commerciales qui grandissent.",
    features: ["10 utilisateurs", "Tout Starter", "Tableau de bord et performance par utilisateur", "Actions automatiques et webhooks sortants"],
  },
  business: {
    id: "business", name: "Business", seats: null, priceCents: 19900, yearlyPriceCents: 19900 * (12 - YEARLY_FREE_MONTHS), lookupKey: "leadforge_business_monthly", lookupKeyYearly: "leadforge_business_yearly",
    tagline: "Pour les organisations multi-équipes.",
    features: ["Utilisateurs illimités", "Tout Pro", "Rôles et permissions avancés", "Support prioritaire"],
  },
};

export const PLAN_LIST: Plan[] = PLAN_IDS.map((id) => PLANS[id]);

export const isInterval = (v: unknown): v is BillingInterval => v === "month" || v === "year";
export const priceCentsFor = (p: Plan, interval: BillingInterval) => (interval === "year" ? p.yearlyPriceCents : p.priceCents);
export const lookupKeyFor = (p: Plan, interval: BillingInterval) => (interval === "year" ? p.lookupKeyYearly : p.lookupKey);
/** Équivalent mensuel d'un prix annuel (arrondi au centime). */
export const monthlyEquivalentCents = (p: Plan) => Math.round(p.yearlyPriceCents / 12);

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
export const planSeats = (id: string | null | undefined): number | null => (isPlanId(id) ? PLANS[id].seats : null);
/** « 79 € » pour un montant rond, « 9,90 € » sinon. */
export const formatPrice = (cents: number) => {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(cents / 100);
};
