import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFS, TEMPLATE_IDS, getTemplate, templateSchema } from "@/lib/templates";

describe("templates métiers", () => {
  it("expose les 5 templates", () => {
    expect(TEMPLATE_DEFS.map((t) => t.id).sort()).toEqual([...TEMPLATE_IDS].sort());
  });
  for (const t of TEMPLATE_DEFS) {
    describe(t.label, () => {
      it("un seul statut initial, normal", () => {
        const initial = t.statuses.filter((s) => s.initial);
        expect(initial).toHaveLength(1);
        expect(initial[0]!.kind).toBe("normal");
      });
      it("au moins un gagné et un perdu", () => {
        expect(t.statuses.some((s) => s.kind === "won")).toBe(true);
        expect(t.statuses.some((s) => s.kind === "lost")).toBe(true);
      });
      it("transitions cohérentes : statuts connus, pas de sortie depuis un final, tous atteignables", () => {
        const byKey = new Map(t.statuses.map((s) => [s.key, s]));
        for (const tr of t.transitions) {
          expect(byKey.get(tr.from)?.kind).toBe("normal");
          expect(byKey.has(tr.to)).toBe(true);
        }
        const reachable = new Set([t.statuses.find((s) => s.initial)!.key]);
        for (let i = 0; i < t.statuses.length; i++) for (const tr of t.transitions) if (reachable.has(tr.from)) reachable.add(tr.to);
        expect(reachable.size).toBe(t.statuses.length);
      });
      it("clés de champs et noms uniques, listes avec 2 options minimum", () => {
        expect(new Set(t.fields.map((f) => f.key)).size).toBe(t.fields.length);
        expect(new Set(t.statuses.map((s) => s.name)).size).toBe(t.statuses.length);
        for (const f of t.fields.filter((f) => f.type === "select")) expect(f.choices!.length).toBeGreaterThanOrEqual(2);
      });
      it("sources par défaut", () => {
        const names = t.sources.map((s) => s.name);
        for (const n of ["Meta Ads", "Google Ads", "Site web", "Parrainage", "Salon", "Autre"]) expect(names).toContain(n);
      });
    });
  }
  it("Énergies contient les champs métier attendus", () => {
    const keys = getTemplate("energie")!.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["type_chauffage", "surface_m2", "facture_energie", "statut_occupant", "dpe"]));
  });
  it("le schéma refuse un template invalide", () => {
    const base = structuredClone(getTemplate("generic")!);
    expect(templateSchema.safeParse({ ...base, statuses: base.statuses.map((s) => ({ ...s, initial: true })) }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, statuses: base.statuses.filter((s) => s.kind !== "won") }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, transitions: [{ from: "gagne", to: "nouveau", roles: "all" }] }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, fields: [...base.fields, base.fields[0]!] }).success).toBe(false);
  });
});
