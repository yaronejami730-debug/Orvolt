import { describe, expect, it } from "vitest";
import { rebalanceMessage } from "@/lib/dispatch/rebalance-message";
import { notificationHref } from "@/lib/notification-href";

const LEAD = "0b0e0a52-1c5e-4d0e-9a53-7a5f0c1d2e3f";

describe("rebalanceMessage", () => {
  it("position corrigée seule", () => expect(rebalanceMessage(3, 0)).toBe("Position corrigée sur 3 RDV : relancer la répartition."));
  it("indisponibilité seule", () => {
    const m = rebalanceMessage(2, 2);
    expect(m).toMatch(/Indisponibilité déclarée/);
    expect(m).not.toMatch(/Position corrigée/);
  });
  it("les deux causes sont distinguées", () => {
    const m = rebalanceMessage(5, 2);
    expect(m).toContain("Indisponibilité déclarée sur 2 RDV");
    expect(m).toContain("position corrigée sur 3 RDV");
  });
});

describe("notificationHref", () => {
  it("lead -> fiche lead", () => expect(notificationHref({ type: "automation", payload: { lead_id: LEAD, message: "Nouveau lead à qualifier." } })).toBe(`/leads/${LEAD}`));
  it("message pour le confirmateur -> Répartition", () => {
    expect(notificationHref({ type: "appointment", payload: { lead_id: LEAD, message: "Jean propose un rendez-vous à attribuer (à confirmer dans Répartition)" } })).toBe("/agenda/repartition");
    expect(notificationHref({ type: "appointment", payload: { lead_id: LEAD, message: "Position corrigée par Léa : relancez la répartition (Rééquilibrer)" } })).toBe("/agenda/repartition");
  });
  it("répartition automatique sans lead -> agenda (tournée)", () => expect(notificationHref({ type: "appointment", payload: { count: 2, message: "Répartition automatique : 2 nouveau(x) rendez-vous dans votre agenda" } })).toBe("/agenda"));
  it("href explicite accepté s'il est interne, refusé sinon", () => {
    expect(notificationHref({ type: "x", payload: { href: "/tasks" } })).toBe("/tasks");
    expect(notificationHref({ type: "x", payload: { href: "//evil.test" } })).toBeNull();
    expect(notificationHref({ type: "x", payload: { href: "https://evil.test" } })).toBeNull();
  });
  it("lead_id invalide ou rien : pas de lien", () => expect(notificationHref({ type: "automation", payload: { lead_id: "../x" } })).toBeNull());
});
