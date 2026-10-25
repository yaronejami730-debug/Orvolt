import { describe, expect, it } from "vitest";
import { canEditField, canViewField, coerceFormValue, validateCustom, type CustomFieldDef } from "@/lib/custom-fields";
import { matchesSignature } from "@/lib/validation/file-signature";
import { safeFileName, validateUpload } from "@/lib/validation/leads";

const R1 = crypto.randomUUID();
const R2 = crypto.randomUUID();
const f = (o: Partial<CustomFieldDef> & Pick<CustomFieldDef, "key" | "type">): CustomFieldDef => ({
  id: crypto.randomUUID(), label: o.key, options: null, required: false, visible_roles: null, editable_roles: null, ...o,
});
const fields: CustomFieldDef[] = [
  f({ key: "budget", type: "number", required: true }),
  f({ key: "note", type: "text" }),
  f({ key: "quand", type: "date" }),
  f({ key: "type", type: "select", options: { choices: ["A", "B"] } }),
  f({ key: "multi", type: "select", options: { choices: ["A", "B", "C"], multiple: true } }),
  f({ key: "adresse", type: "address" }),
  f({ key: "piece", type: "file" }),
  f({ key: "secret", type: "text", visible_roles: [R1], editable_roles: [R1] }),
  f({ key: "lecture", type: "text", visible_roles: [R1, R2], editable_roles: [R1] }),
];
const ctx = { roleId: R2, isAdmin: false };

describe("validateCustom", () => {
  it("accepte des valeurs valides de tous les types", () => {
    const r = validateCustom(fields, { budget: 1200.5, note: "  ok ", quand: "2026-02-28", type: "A", multi: ["A", "C"], adresse: "1 rue X", piece: crypto.randomUUID() }, ctx, "create");
    expect(r.ok).toBe(true);
    expect(r.data.note).toBe("ok");
  });
  it("obligatoire : manquant refusé en création, toléré en mise à jour partielle, effacement refusé", () => {
    expect(validateCustom(fields, {}, ctx, "create").errors.budget).toMatch(/obligatoire/);
    expect(validateCustom(fields, { note: "x" }, ctx, "update").ok).toBe(true);
    expect(validateCustom(fields, { budget: null }, ctx, "update").errors.budget).toMatch(/obligatoire/);
    expect(validateCustom(fields, { budget: "" }, ctx, "update").ok).toBe(false);
  });
  it("types invalides", () => {
    const bad = { budget: "abc", quand: "2026-02-30", type: "Z", multi: ["A", "Z"], piece: "nope", note: "x".repeat(2001) };
    const r = validateCustom(fields, bad, ctx, "update");
    expect(Object.keys(r.errors).sort()).toEqual(["budget", "multi", "note", "piece", "quand", "type"]);
    expect(validateCustom(fields, { budget: Infinity }, ctx, "update").ok).toBe(false);
    expect(validateCustom(fields, { type: ["A"] }, ctx, "update").ok).toBe(false);
  });
  it("clés inconnues refusées (pas d'injection dans le jsonb)", () => {
    expect(validateCustom(fields, { budget: 1, __proto__x: 1, hack: "x" }, ctx, "create").errors.hack).toBe("Champ inconnu.");
  });
  it("visibilité et édition par rôle", () => {
    expect(canViewField(fields[7]!, ctx)).toBe(false);
    expect(canViewField(fields[8]!, ctx)).toBe(true);
    expect(canEditField(fields[8]!, ctx)).toBe(false);
    expect(canEditField(fields[7]!, { roleId: R2, isAdmin: true })).toBe(true);
    expect(validateCustom(fields, { budget: 1, secret: "x" }, ctx, "create").errors.secret).toMatch(/non modifiable/);
    expect(validateCustom(fields, { budget: 1, lecture: "x" }, ctx, "create").errors.lecture).toMatch(/non modifiable/);
    expect(validateCustom(fields, { budget: 1, secret: "x" }, { roleId: R1, isAdmin: false }, "create").ok).toBe(true);
  });
  it("un champ obligatoire non éditable n'empêche pas la création", () => {
    const req = [f({ key: "interne", type: "text", required: true, visible_roles: [R1], editable_roles: [R1] })];
    expect(validateCustom(req, {}, ctx, "create").ok).toBe(true);
  });
  it("coerceFormValue", () => {
    expect(coerceFormValue({ type: "number", options: null }, "12,5")).toBe(12.5);
    expect(coerceFormValue({ type: "text", options: null }, "")).toBeNull();
    expect(coerceFormValue({ type: "select", options: null }, ["A"])).toEqual(["A"]);
  });
});

describe("nombres : bornes", () => {
  const n = [f({ key: "surface", type: "number" }), f({ key: "temp", type: "number", options: { min: -50, max: 60 } })];
  const ctx2 = { roleId: R2, isAdmin: false };
  it("refuse les négatifs par défaut, accepte un min explicite négatif, respecte max", () => {
    expect(validateCustom(n, { surface: -5 }, ctx2, "update").errors.surface).toMatch(/minimale/);
    expect(validateCustom(n, { surface: 0 }, ctx2, "update").ok).toBe(true);
    expect(validateCustom(n, { temp: -20 }, ctx2, "update").ok).toBe(true);
    expect(validateCustom(n, { temp: -60 }, ctx2, "update").ok).toBe(false);
    expect(validateCustom(n, { temp: 61 }, ctx2, "update").errors.temp).toMatch(/maximale/);
  });
});

describe("signatures de fichiers", () => {
  const b = (...x: number[]) => new Uint8Array(x);
  it("accepte les vrais fichiers", () => {
    expect(matchesSignature("image/png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(matchesSignature("image/jpeg", b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesSignature("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(matchesSignature("image/webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe(true);
    expect(matchesSignature("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(matchesSignature("text/csv", new TextEncoder().encode("a;b\n1;2"))).toBe(true);
  });
  it("refuse les contenus déguisés", () => {
    expect(matchesSignature("image/png", new TextEncoder().encode("<html><script>alert(1)</script>"))).toBe(false);
    expect(matchesSignature("application/pdf", b(0x4d, 0x5a))).toBe(false);
    expect(matchesSignature("text/plain", new TextEncoder().encode("<!DOCTYPE html><p>x</p>"))).toBe(false);
    expect(matchesSignature("text/plain", new TextEncoder().encode("bonjour <script>alert(1)</script>"))).toBe(false);
    expect(matchesSignature("text/plain", b(0x68, 0x00, 0x69))).toBe(false);
    expect(matchesSignature("application/x-msdownload", b(0x4d, 0x5a))).toBe(false);
  });
});

describe("upload", () => {
  it("valide taille, type et extension", () => {
    expect(validateUpload("a.pdf", 1000, "application/pdf")).toBeNull();
    expect(validateUpload("a.pdf", 11 * 1024 * 1024, "application/pdf")).toMatch(/volumineux/);
    expect(validateUpload("a.html", 10, "text/html")).toMatch(/non autorisé/);
    expect(validateUpload("a.exe", 10, "application/pdf")).toMatch(/extension/);
    expect(validateUpload("a.pdf", 0, "application/pdf")).toMatch(/vide/);
  });
  it("nettoie le nom de fichier", () => {
    expect(safeFileName("../Dévis été (1).pdf")).toBe("_Devis_ete_1_.pdf");
    expect(safeFileName("....")).toBe("fichier");
  });
});
