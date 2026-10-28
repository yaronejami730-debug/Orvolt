/** Plans d'abonnement : source unique du nombre de sièges (seat_limit) et des tarifs affichés. */
export const PLAN_IDS = ["starter", "pro", "business", "premium"] as const;
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
  /** Prix « à partir de » : tarif dégressif (Premium), le prix de départ est le prix affiché. */
  priceFrom?: boolean;
  /**
   * Prix mensuel (centimes) d'un utilisateur en plus des sièges inclus, quel que soit son rôle ; null = non applicable (illimité).
   * Dégressif d'une formule à l'autre : acheter des sièges à l'unité coûte plus cher que passer à la formule du dessus.
   */
  extraSeatCents: number | null;
}

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
/** Paiement à l'année : 2 mois offerts, soit 10 mensualités facturées d'un coup. */
export const YEARLY_FREE_MONTHS = 2;

export const TRIAL_DAYS = 14;
/** Délai de grâce après un paiement échoué (jours). */
export const GRACE_DAYS = 7;
export const CURRENCY = "eur";

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter", name: "Starter", seats: 3, extraSeatCents: 999, priceCents: 999, yearlyPriceCents: 999 * (12 - YEARLY_FREE_MONTHS), lookupKey: "leadforge_starter_monthly", lookupKeyYearly: "leadforge_starter_yearly",
    tagline: "Pour démarrer simplement.",
    features: ["Gestion des leads", "Agenda des rendez-vous", "Rôles Administrateur et Membre"],
  },
  pro: {
    id: "pro", name: "Pro", seats: 8, extraSeatCents: 699, priceCents: 3900, yearlyPriceCents: 3900 * (12 - YEARLY_FREE_MONTHS), lookupKey: "leadforge_pro_monthly", lookupKeyYearly: "leadforge_pro_yearly",
    tagline: "Pour structurer votre équipe commerciale.",
    features: ["Tout Starter", "Rôles prospecteur, confirmateur, commercial et poseur", "Suivi des statuts", "Programmation des formulaires par téléprospecteur et par domaine"],
  },
  business: {
    id: "business", name: "Business", seats: 20, extraSeatCents: 400, priceCents: 7999, yearlyPriceCents: 7999 * (12 - YEARLY_FREE_MONTHS), lookupKey: "leadforge_business_monthly", lookupKeyYearly: "leadforge_business_yearly", highlighted: true,
    tagline: "Pour piloter vos tournées et vos résultats.",
    features: ["Tout Pro", "Contrôle des distances par commercial", "Statistiques et tableaux de bord"],
  },
  premium: {
    id: "premium", name: "Premium", seats: null, extraSeatCents: null, priceCents: 19900, yearlyPriceCents: 19900 * (12 - YEARLY_FREE_MONTHS), lookupKey: "leadforge_premium_monthly", lookupKeyYearly: "leadforge_premium_yearly", priceFrom: true,
    tagline: "Le seul abonnement dont le prix baisse avec votre fidélité.",
    features: ["Toutes les fonctionnalités", "Support prioritaire", "Tarif dégressif selon l'ancienneté"],
  },
};

/** Nombre maximal d'utilisateurs supplémentaires achetables en libre-service. */
export const MAX_EXTRA_SEATS = 200;
/** Préfixe des clés de recherche Stripe des utilisateurs supplémentaires (une par plan et par fréquence). */
export const EXTRA_SEAT_LOOKUP_PREFIX = "leadforge_extra_seat_";

export const PLAN_LIST: Plan[] = PLAN_IDS.map((id) => PLANS[id]);

/** Utilisateur en plus : prix pour la fréquence choisie (annuel = 10 mensualités) ; null si le plan n'en propose pas. */
export const extraSeatPriceCents = (p: Plan, interval: BillingInterval): number | null =>
  p.extraSeatCents === null ? null : interval === "year" ? p.extraSeatCents * (12 - YEARLY_FREE_MONTHS) : p.extraSeatCents;
export const extraSeatLookupKey = (p: Plan, interval: BillingInterval) => `${EXTRA_SEAT_LOOKUP_PREFIX}${p.id}_${interval === "year" ? "yearly" : "monthly"}`;
/** Seul un plan à nombre d'utilisateurs fixe (pas le Premium, illimité) accepte des utilisateurs en plus. */
export const supportsExtraSeats = (p: Plan) => p.extraSeatCents !== null;

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

/**
 * Fonctionnalités réservées à un plan (grille de plan-compare.tsx) : chacune est disponible à partir du plan indiqué.
 * - specialized_roles : rôles Prospecteur, Confirmateur, Commercial, Poseur (non système, is_field ; Starter : Administrateur et Membre seulement) (Pro+).
 * - custom_roles : création et édition de rôles personnalisés (Pro+).
 * - status_tracking : personnalisation du suivi des statuts (statuts, transitions, actions) (Pro+).
 * - call_script_programming : programmation des formulaires d'appel par téléprospecteur, domaine et période (Pro+). Starter : formulaires de base ouverts à tous.
 * - distance_control : zones d'intervention et rayon par commercial, contrôle de la distance des rendez-vous (Business+).
 * - analytics : statistiques et tableaux de bord (Business+).
 * - priority_support : canal de support prioritaire (Premium).
 */
export const PLAN_FEATURES = ["specialized_roles", "custom_roles", "status_tracking", "call_script_programming", "distance_control", "analytics", "priority_support"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Plan minimal donnant accès à chaque fonctionnalité (PLAN_IDS est ordonné du plus petit au plus grand). */
const FEATURE_MIN_PLAN: Record<PlanFeature, PlanId> = {
  specialized_roles: "pro",
  custom_roles: "pro",
  status_tracking: "pro",
  call_script_programming: "pro",
  distance_control: "business",
  analytics: "business",
  priority_support: "premium",
};

export const FEATURE_LABELS: Record<PlanFeature, string> = {
  specialized_roles: "Les rôles prospecteur, confirmateur, commercial et poseur",
  custom_roles: "Les rôles personnalisés",
  status_tracking: "La personnalisation des statuts",
  call_script_programming: "La programmation des formulaires par téléprospecteur et par domaine",
  distance_control: "Le contrôle des distances par commercial",
  analytics: "Les statistiques et tableaux de bord",
  priority_support: "Le support prioritaire",
};

/** Le plan donne-t-il accès à la fonctionnalité ? Plan inconnu (ex. « trial ») : non. */
export const planHas = (plan: string | null | undefined, feature: PlanFeature): boolean =>
  isPlanId(plan) && PLAN_IDS.indexOf(plan) >= PLAN_IDS.indexOf(FEATURE_MIN_PLAN[feature]);

/** Plan le moins cher qui débloque la fonctionnalité. */
export const minPlanFor = (feature: PlanFeature): Plan => PLANS[FEATURE_MIN_PLAN[feature]];

/** Rôle tel que stocké en base (colonnes utiles au gating par plan). */
export interface RoleForPlan { name: string; is_admin: boolean; system_key: string | null; is_system: boolean }

/** Rôles de base, disponibles dès le Starter : Super administrateur, Administrateur et Membre (rôle système sans system_key). */
const isBaseRole = (r: RoleForPlan) => r.is_admin || r.system_key === "administrator" || (r.is_system && r.name === "Membre");

/**
 * Le plan permet-il d'ATTRIBUER ce rôle ? Starter : Administrateur et Membre seulement ; Pro et au-dessus : tous
 * (spécialisés + sur mesure). Plan inconnu (ex. « trial ») : non. L'essai (accès complet) est géré par entitlementAllowsRole.
 * Ne concerne que les NOUVELLES attributions : un membre qui garde un rôle Pro après un downgrade n'est pas touché.
 */
export const roleAllowedForPlan = (plan: string | null | undefined, role: RoleForPlan): boolean =>
  isPlanId(plan) && (isBaseRole(role) || planHas(plan, "specialized_roles"));
