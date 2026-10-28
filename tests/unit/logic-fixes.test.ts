import { describe, expect, it } from "vitest";
import { isPastStart } from "@/lib/validation/appointments";
import { roleSchema } from "@/lib/validation/auth";
import { createLeadSchema } from "@/lib/validation/leads";

describe("RDV dans le passé", () => {
  const now = new Date("2026-03-10T10:00:00Z");
  it("refuse un début écoulé, accepte le futur et la tolérance d'une minute", () => {
    expect(isPastStart("2026-03-10T09:00:00Z", now)).toBe(true);
    expect(isPastStart("2026-03-09T10:00:00Z", now)).toBe(true);
    expect(isPastStart("2026-03-10T09:59:30Z", now)).toBe(false);
    expect(isPastStart("2026-03-11T08:00:00Z", now)).toBe(false);
  });
});

describe("rôle terrain (schéma)", () => {
  it("is_field exige « Gérer ses rendez-vous »", () => {
    expect(roleSchema.safeParse({ name: "Poseur", permissions: ["leads.view_own"], isField: true }).success).toBe(false);
    expect(roleSchema.safeParse({ name: "Poseur", permissions: ["leads.view_own", "appointments.manage_own"], isField: true }).success).toBe(true);
    expect(roleSchema.safeParse({ name: "Compta", permissions: ["leads.view_own"] }).success).toBe(true);
  });
});

describe("création de lead", () => {
  it("accepte le drapeau « créer quand même »", () => {
    const r = createLeadSchema.safeParse({ lastName: "Dupont", allowDuplicate: true });
    expect(r.success && r.data.allowDuplicate).toBe(true);
  });
});
