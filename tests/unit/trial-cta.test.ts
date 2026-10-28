import { describe, expect, it } from "vitest";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { TRIAL_HINT, trialHref } from "@/components/marketing/trial-cta-href";

describe("trialHref", () => {
  it("visiteur : /signup, avec ?plan= et ?interval= si on vient d'une carte", () => {
    expect(trialHref()).toBe("/signup");
    expect(trialHref({ plan: "pro", interval: "year" })).toBe("/signup?plan=pro&interval=year");
  });
  it("connecté : dashboard, ou facturation quand un plan est choisi", () => {
    expect(trialHref({ signedIn: true })).toBe("/dashboard");
    expect(trialHref({ signedIn: true, plan: "premium", interval: "month" })).toBe("/settings/billing?plan=premium&interval=month");
  });
  it("le micro-texte utilise la durée d'essai de la config", () => {
    expect(TRIAL_HINT).toContain(String(TRIAL_DAYS));
  });
});
