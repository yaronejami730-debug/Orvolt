import { describe, expect, it } from "vitest";
import { intentFromAnswers, parsePlanIntent, resumeStep, sanitizeSource, firstChargeAt } from "@/lib/funnel/intent";
import { dueOnboardingReminder, onboardingReminderWindow, type OnboardingOrgLike } from "@/lib/notifications/windows";
import { onboardingReminderMail } from "@/lib/mail/templates";
import { orgToken, orgTokenValid, visitorKey } from "@/lib/email-verification";

const K = "k".repeat(32);
const H = 3_600_000;
const now = new Date("2026-03-10T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * H).toISOString();
const org = (o: Partial<OnboardingOrgLike> = {}): OnboardingOrgLike => ({ created_at: ago(25), reminder1_sent_at: null, reminder2_sent_at: null, optout_at: null, stripe_subscription_id: null, plan: "trial", onboarded_at: null, ...o });

describe("présélection de formule", () => {
  it("accepte plan et fréquence connus, ignore le reste", () => {
    expect(parsePlanIntent("pro", "year")).toEqual({ plan: "pro", interval: "year" });
    expect(parsePlanIntent(" PRO ", undefined)).toEqual({ plan: "pro", interval: "month" });
    expect(parsePlanIntent("gratuit", "weekly")).toEqual({ plan: null, interval: "month" });
    expect(parsePlanIntent(["business", "x"], ["year"])).toEqual({ plan: "business", interval: "year" });
  });
  it("relit l'intention depuis le jsonb sans lui faire confiance", () => {
    expect(intentFromAnswers({ planIntent: "premium", intervalIntent: "year" })).toEqual({ plan: "premium", interval: "year" });
    expect(intentFromAnswers({ planIntent: { x: 1 } })).toEqual({ plan: null, interval: "month" });
    expect(intentFromAnswers(null)).toEqual({ plan: null, interval: "month" });
  });
  it("assainit la source", () => {
    expect(sanitizeSource("Google-Ads_1")).toBe("google-ads_1");
    expect(sanitizeSource("<script>")).toBeNull();
    expect(sanitizeSource("x".repeat(31))).toBeNull();
  });
  it("première échéance = fin de l'essai", () => {
    expect(firstChargeAt(Date.UTC(2026, 0, 1), 14).toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
});

describe("reprise du parcours", () => {
  const base = { isAdmin: true, parentOrgId: null, onboardedAt: null, orgType: "agency", plan: "trial", planRequired: true };
  it("activité manquante puis formule", () => {
    expect(resumeStep({ ...base, orgType: null })).toBe("activite");
    expect(resumeStep(base)).toBe("plan");
  });
  it("rien à reprendre : formule non exigée, abonné, onboardé, sous-régie, membre", () => {
    expect(resumeStep({ ...base, planRequired: false })).toBeNull();
    expect(resumeStep({ ...base, plan: "pro" })).toBeNull();
    expect(resumeStep({ ...base, onboardedAt: "2026-01-01" })).toBeNull();
    expect(resumeStep({ ...base, parentOrgId: "p" })).toBeNull();
    expect(resumeStep({ ...base, isAdmin: false })).toBeNull();
  });
});

describe("relances d'inscription", () => {
  it("fenêtres : 24-48 h et 72-96 h après la création", () => {
    expect(dueOnboardingReminder(org({ created_at: ago(23) }), now)).toBeNull();
    expect(dueOnboardingReminder(org({ created_at: ago(24.5) }), now)).toBe(1);
    expect(dueOnboardingReminder(org({ created_at: ago(49) }), now)).toBeNull(); // trop tard : jamais de relance tardive
    expect(dueOnboardingReminder(org({ created_at: ago(73) }), now)).toBe(2);
    expect(dueOnboardingReminder(org({ created_at: ago(97) }), now)).toBeNull();
  });
  it("idempotence : une relance déjà partie ne repart pas", () => {
    expect(dueOnboardingReminder(org({ reminder1_sent_at: ago(1) }), now)).toBeNull();
    expect(dueOnboardingReminder(org({ created_at: ago(73), reminder2_sent_at: ago(1) }), now)).toBeNull();
  });
  it("jamais après désinscription, abonnement, onboarding terminé ou plan choisi", () => {
    for (const o of [{ optout_at: ago(1) }, { stripe_subscription_id: "sub_1" }, { onboarded_at: ago(2) }, { plan: "pro" }]) expect(dueOnboardingReminder(org(o), now)).toBeNull();
  });
  it("fenêtre SQL cohérente avec la règle", () => {
    const w = onboardingReminderWindow(now, 1);
    expect(now.getTime() - w.to.getTime()).toBe(24 * H);
    expect(now.getTime() - w.from.getTime()).toBe(48 * H);
  });
  it("le mail est honnête, avec lien de reprise et de désinscription", () => {
    const m = onboardingReminderMail({ firstName: "Sam", orgName: "Solaire", step: 1, trialDays: 14, resumeUrl: "https://x.test/onboarding/plan", stopUrl: "https://x.test/api/relance/stop?o=1&t=2" });
    expect(m.text).toContain("https://x.test/onboarding/plan");
    expect(m.text).toContain("https://x.test/api/relance/stop");
    expect(m.text).toMatch(/Aucun prélèvement pendant l'essai/);
    expect(m.text).not.toMatch(/sans carte|dernière chance|expire/i);
    expect(onboardingReminderMail({ orgName: "S", step: 2, trialDays: 14, resumeUrl: "https://x.test/a", stopUrl: "https://x.test/b" }).text).toContain("dernier message");
  });
});

describe("jetons de suivi et de désinscription", () => {
  it("jeton lié à l'organisation et à l'usage", () => {
    const t = orgToken("relance", "org-1", K);
    expect(orgTokenValid("relance", "org-1", t, K)).toBe(true);
    expect(orgTokenValid("relance", "org-2", t, K)).toBe(false);
    expect(orgTokenValid("autre", "org-1", t, K)).toBe(false);
    expect(orgTokenValid("relance", "org-1", "court", K)).toBe(false);
  });
  it("empreinte de visiteur stable, non réversible, insensible à la casse", () => {
    expect(visitorKey(" A@B.fr ", K)).toBe(visitorKey("a@b.fr", K));
    expect(visitorKey("a@b.fr", K)).not.toContain("a@b");
    expect(visitorKey("a@b.fr", K)).not.toBe(visitorKey("c@d.fr", K));
  });
});
