import { describe, expect, it } from "vitest";
import { cursorOf, keysetFilter, phoneSearchTerm, quoteValue, supportsKeyset } from "@/lib/leads/keyset";
import { listParamsSchema } from "@/lib/validation/leads";
import { normalizeEmail, normalizePhone } from "@/lib/leads/normalize";

const ID = "6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6";

describe("pagination par clé", () => {
  it("tri décroissant : strictement avant le curseur, égalités départagées par id, avec borne d'index", () => {
    const f = keysetFilter("created_at", "desc", { v: "2026-01-02T03:04:05.123456+00:00", id: ID });
    expect(f.bound).toEqual({ op: "lte", col: "created_at", value: "2026-01-02T03:04:05.123456+00:00" });
    expect(f.or).toBe(`created_at.lt."2026-01-02T03:04:05.123456+00:00",and(created_at.eq."2026-01-02T03:04:05.123456+00:00",id.lt."${ID}")`);
  });
  it("tri croissant : après le curseur", () => {
    const f = keysetFilter("last_name", "asc", { v: "Dupont", id: ID });
    expect(f.bound.op).toBe("gte");
    expect(f.or).toContain('last_name.gt."Dupont"');
    expect(f.or).toContain(`id.gt."${ID}"`);
  });
  it("une valeur avec virgule, parenthèse ou guillemet ne casse pas la syntaxe", () => {
    expect(quoteValue('Dupont, (Jr) "x"\\')).toBe('"Dupont, (Jr) \\"x\\"\\\\"');
  });
  it("seules les colonnes non nulles sont paginables par clé", () => {
    for (const s of ["created_at", "updated_at", "last_name", "status_id"]) expect(supportsKeyset(s)).toBe(true);
    for (const s of ["value", "assigned_to", "x"]) expect(supportsKeyset(s)).toBe(false);
  });
  it("curseur d'une ligne", () => {
    expect(cursorOf({ id: ID, created_at: "2026-01-01T00:00:00+00:00" }, "created_at")).toEqual({ v: "2026-01-01T00:00:00+00:00", id: ID });
    expect(cursorOf({ id: ID, value: 3 }, "value")).toBeNull();
    expect(cursorOf({ id: ID, last_name: null }, "last_name")).toBeNull();
  });
  it("le schéma accepte un curseur valide et refuse un id invalide", () => {
    expect(listParamsSchema.safeParse({ cursor: { v: "a", id: ID } }).success).toBe(true);
    expect(listParamsSchema.safeParse({ cursor: { v: "a", id: "nope" } }).success).toBe(false);
  });
});

describe("recherche téléphone et normalisation", () => {
  it("reconnaît un numéro quel que soit le format et retire le 0 national", () => {
    expect(phoneSearchTerm("06 12 34 56 78")).toBe("612345678");
    expect(phoneSearchTerm("0612345678")).toBe("612345678");
    expect(phoneSearchTerm("+33 6 12 34")).toBe("33612" + "34");
    expect(phoneSearchTerm("06.12.3")).toBe("6123");
  });
  it("ignore les saisies de nom ou trop courtes", () => {
    expect(phoneSearchTerm("dupont")).toBeNull();
    expect(phoneSearchTerm("dupont 06")).toBeNull();
    expect(phoneSearchTerm("123")).toBeNull();
    expect(phoneSearchTerm(undefined)).toBeNull();
  });
  it("la forme recherchée est une sous-chaîne du numéro normalisé stocké", () => {
    const stored = normalizePhone("06 12 34 56 78")!;
    expect(stored).toBe("+33612345678");
    expect(stored.includes(phoneSearchTerm("06 12 34")!)).toBe(true);
    expect(normalizeEmail("  Jean.Dupont@Mail.FR ")).toBe("jean.dupont@mail.fr");
  });
});
