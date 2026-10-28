import { describe, expect, it } from "vitest";
import { entitlementAllowsRole, entitlementHas } from "@/lib/billing/features";
import { PLAN_FEATURES, PLAN_IDS, minPlanFor, planHas, roleAllowedForPlan, type PlanFeature, type PlanId } from "@/lib/billing/plans";

// Grille annoncée dans plan-compare.tsx.
const GRID: Record<PlanFeature, Record<PlanId, boolean>> = {
  specialized_roles: { starter: false, pro: true, business: true, premium: true },
  custom_roles: { starter: false, pro: true, business: true, premium: true },
  status_tracking: { starter: false, pro: true, business: true, premium: true },
  call_script_programming: { starter: false, pro: true, business: true, premium: true },
  distance_control: { starter: false, pro: false, business: true, premium: true },
  analytics: { starter: false, pro: false, business: true, premium: true },
  priority_support: { starter: false, pro: false, business: false, premium: true },
};

describe("fonctionnalités par plan", () => {
  it("planHas respecte exactement la grille tarifaire", () => {
    for (const f of PLAN_FEATURES) for (const p of PLAN_IDS) expect(planHas(p, f), `${f}/${p}`).toBe(GRID[f][p]);
  });
  it("plan inconnu, vide ou « trial » : aucune fonctionnalité", () => {
    for (const f of PLAN_FEATURES) for (const p of ["trial", "", null, undefined, "enterprise"]) expect(planHas(p, f)).toBe(false);
  });
  it("minPlanFor renvoie le plan le moins cher qui débloque", () => {
    expect(minPlanFor("custom_roles").id).toBe("pro");
    expect(minPlanFor("analytics").id).toBe("business");
    expect(minPlanFor("priority_support").id).toBe("premium");
  });
  it("essai : accès complet aux fonctions, mais pas au support prioritaire", () => {
    const trial = { state: "trialing" as const, plan: "starter" };
    expect(entitlementHas(trial, "analytics")).toBe(true);
    expect(entitlementHas(trial, "distance_control")).toBe(true);
    expect(entitlementHas(trial, "priority_support")).toBe(false);
  });
  it("abonnement actif ou en grâce : selon le plan", () => {
    expect(entitlementHas({ state: "active", plan: "pro" }, "custom_roles")).toBe(true);
    expect(entitlementHas({ state: "active", plan: "pro" }, "analytics")).toBe(false);
    expect(entitlementHas({ state: "past_due", plan: "premium" }, "priority_support")).toBe(true);
  });

  describe("rôles par plan", () => {
    const R = (name: string, o: Partial<{ is_admin: boolean; system_key: string | null; is_system: boolean }> = {}) => ({ name, is_admin: false, system_key: null, is_system: true, ...o });
    const base = [R("Super administrateur", { is_admin: true, system_key: "super_admin" }), R("Administrateur", { system_key: "administrator" }), R("Membre")];
    const special = [R("Prospecteur"), R("Confirmateur"), R("Commercial"), R("Poseur", { is_system: false }), R("Chef d'équipe", { is_system: false })];
    it("Starter : seulement Super administrateur, Administrateur et Membre", () => {
      for (const r of base) expect(roleAllowedForPlan("starter", r), r.name).toBe(true);
      for (const r of special) expect(roleAllowedForPlan("starter", r), r.name).toBe(false);
    });
    it("Pro et au-dessus : tous les rôles, Poseur compris", () => {
      for (const p of ["pro", "business", "premium"]) for (const r of [...base, ...special]) expect(roleAllowedForPlan(p, r), `${p}/${r.name}`).toBe(true);
    });
    it("un rôle personnalisé nommé « Membre » (non système) n'est pas le rôle Membre", () => {
      expect(roleAllowedForPlan("starter", R("Membre", { is_system: false }))).toBe(false);
    });
    it("plan inconnu : aucun rôle", () => {
      for (const p of ["trial", "", null, undefined, "enterprise"]) for (const r of base) expect(roleAllowedForPlan(p, r)).toBe(false);
    });
    it("essai : tous les rôles, même sur un plan Starter ; actif : selon le plan", () => {
      for (const r of [...base, ...special]) expect(entitlementAllowsRole({ state: "trialing", plan: "starter" }, r)).toBe(true);
      expect(entitlementAllowsRole({ state: "active", plan: "starter" }, R("Commercial"))).toBe(false);
      expect(entitlementAllowsRole({ state: "active", plan: "pro" }, R("Commercial"))).toBe(true);
    });
  });
});
