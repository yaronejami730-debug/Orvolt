import { describe, expect, it } from "vitest";
import { IMPORT_MAX_ROWS, CsvError, decodeCsv, detectDelimiter, parseCsv, toCsv } from "@/lib/import/csv";
import { analyze, execute, type ImportOptions, type ImportStore, type InsertRow } from "@/lib/import/engine";
import { autoMap, validateRow, type Mapping } from "@/lib/import/mapping";
import { cleanText, maskPii, neutralizeFormula, normalizeEmail, normalizePhone } from "@/lib/leads/normalize";
import type { CustomFieldDef } from "@/lib/custom-fields";

const enc = (s: string) => new TextEncoder().encode(s);
const ctx = { roleId: crypto.randomUUID(), isAdmin: true };
const field = (o: Partial<CustomFieldDef> & Pick<CustomFieldDef, "key" | "type">): CustomFieldDef => ({ id: crypto.randomUUID(), label: o.key, options: null, required: false, visible_roles: null, editable_roles: null, ...o });

describe("CSV : décodage et séparateurs", () => {
  it("détecte , ; tab |", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
    expect(detectDelimiter('a,b\n"x;y;z",2')).toBe(",");
  });
  it("UTF-8 avec BOM ; Windows-1252 en repli", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("Prénom;Nom\nÉlise;Dupont")]);
    const p = parseCsv(bom);
    expect(p.encoding).toBe("utf-8");
    expect(p.headers).toEqual(["Prénom", "Nom"]);
    const win = new Uint8Array([...enc("Pr"), 0xe9, ...enc("nom;Nom\n"), 0xc9, ...enc("lise;Dupont")]); // é et É en cp1252
    const w = parseCsv(win);
    expect(w.encoding).toBe("windows-1252");
    expect(w.headers[0]).toBe("Prénom");
    expect(w.rows[0]![0]).toBe("Élise");
    expect(decodeCsv(enc("abc")).encoding).toBe("utf-8");
  });
  it("guillemets, virgules et retours à la ligne dans les champs, lignes vides", () => {
    const p = parseCsv(enc('Nom,Note\n"Dupont, Jean","Ligne1\nLigne2"\n\n"Dit ""bonjour""",x\n'));
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toEqual(["Dupont, Jean", "Ligne1\nLigne2"]);
    expect(p.rows[1]![0]).toBe('Dit "bonjour"');
  });
  it("en-têtes vides ou dupliqués dédoublonnés ; lignes courtes complétées", () => {
    const p = parseCsv(enc("Nom,Nom,\nA,B,C\nD"));
    expect(p.headers).toEqual(["Nom", "Nom (2)", "Colonne 3"]);
    expect(p.rows[1]).toEqual(["D", "", ""]);
  });
  it("refuse vide, en-tête seul, binaire, trop de lignes, trop gros", () => {
    expect(() => parseCsv(new Uint8Array())).toThrow(CsvError);
    expect(() => parseCsv(enc("Nom,Email"))).toThrow(/en-tête/);
    expect(() => parseCsv(new Uint8Array([0x50, 0x4b, 0, 3, 4, 0, 0]))).toThrow(/pas un CSV/);
    const big = `Nom\n${Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `n${i}`).join("\n")}`;
    expect(() => parseCsv(enc(big))).toThrow(/Trop de lignes/);
    expect(() => parseCsv(new Uint8Array(5 * 1024 * 1024 + 1).fill(97))).toThrow(/volumineux/);
    expect(parseCsv(enc(`Nom\n${Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => `n${i}`).join("\n")}`)).rows).toHaveLength(IMPORT_MAX_ROWS);
  });
  it("supprime octets nuls et caractères de contrôle", () => {
    expect(cleanText("a\u0000b\u0007c\u001fd")).toBe("abcd");
    expect(cleanText("x".repeat(5000)).length).toBe(2000);
  });
});

describe("injection de formules", () => {
  it("neutralise = + - @ tab CR", () => {
    for (const v of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(neutralizeFormula(v)).toBe(`'${v}`);
    expect(neutralizeFormula("Jean")).toBe("Jean");
  });
  it("import : textes libres neutralisés, téléphone +33 conservé", () => {
    const { lead } = validateRow(["Nom", "Tel"], ["=HYPERLINK(\"http://evil\")", "+33 6 12 34 56 78"], { Nom: "last_name", Tel: "phone" }, 2, [], ctx);
    expect(lead!.last_name.startsWith("'=")).toBe(true);
    expect(lead!.phone).toBe("+33 6 12 34 56 78");
  });
  it("export : toute cellule neutralisée, BOM, guillemets", () => {
    const csv = toCsv([["Ligne", "Motif"], [3, "=cmd|' /C calc'!A0"], [4, 'a "b", c']], neutralizeFormula);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain('"a ""b"", c"');
  });
});

describe("normalisation", () => {
  it("téléphones", () => {
    for (const p of ["06 12 34 56 78", "0612345678", "+33 6 12 34 56 78", "0033612345678", "33612345678", "06.12.34.56.78", "(06) 12-34-56-78"]) expect(normalizePhone(p), p).toBe("+33612345678");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizeEmail("  Jean@Example.COM ")).toBe("jean@example.com");
    expect(normalizeEmail("")).toBeNull();
  });
  it("masque les données personnelles", () => {
    const m = maskPii({ email: "jean.dupont@example.com", phone: "06 12 34 56 78", nom: "Dupont", secret_key: "abc", nested: { tel: "+33612345678" } }) as Record<string, unknown>;
    expect(JSON.stringify(m)).not.toContain("jean.dupont");
    expect(JSON.stringify(m)).not.toContain("0612345678");
    expect(m.email).toBe("j***@example.com");
    expect(m.secret_key).toBe("[masqué]");
    expect(String(m.phone).endsWith("78")).toBe(true);
  });
});

describe("mappage automatique et validation de lignes", () => {
  const fields = [field({ key: "type_chauffage", label: "Type de chauffage", type: "select", options: { choices: ["Gaz", "Bois"] } }), field({ key: "surface_m2", label: "Surface habitable (m²)", type: "number", required: true })];
  it("auto-détecte natifs et champs personnalisés", () => {
    const m = autoMap(["Prénom", "NOM", "E-mail", "Téléphone portable", "Société", "Code postal", "Type de chauffage", "Inconnu"], fields);
    expect(m).toMatchObject({ Prénom: "first_name", NOM: "last_name", "E-mail": "email", Société: "company", "Code postal": "postal_code", "Type de chauffage": "custom:type_chauffage", Inconnu: "ignore" });
    expect(m["Téléphone portable"]).toBe("ignore");
    expect(autoMap(["Mobile"], [])).toEqual({ Mobile: "phone" });
    // une cible n'est utilisée qu'une fois
    expect(Object.values(autoMap(["Nom", "Name"], [])).filter((v) => v === "last_name")).toHaveLength(1);
  });
  const headers = ["Prénom", "Nom", "Email", "Tel", "Valeur", "Chauffage", "Surface"];
  const map: Mapping = { Prénom: "first_name", Nom: "last_name", Email: "email", Tel: "phone", Valeur: "value", Chauffage: "custom:type_chauffage", Surface: "custom:surface_m2" };
  it("ligne valide", () => {
    const r = validateRow(headers, ["Jean", "Dupont", "JEAN@EXAMPLE.COM", "0612345678", "1 200,50", "Gaz", "85"], map, 2, fields, ctx);
    expect(r.issues).toEqual([]);
    expect(r.lead).toMatchObject({ email: "jean@example.com", value: 1200.5, custom: { type_chauffage: "Gaz", surface_m2: 85 } });
  });
  it("erreurs : e-mail, téléphone, valeur négative, option inconnue, champ obligatoire, aucun nom", () => {
    const r = validateRow(headers, ["", "", "pas-un-mail", "abc", "-5", "Fioul", ""], map, 7, fields, ctx);
    const cols = r.issues.map((i) => i.column).sort();
    expect(cols).toEqual(["Chauffage", "Email", "Surface", "Tel", "Valeur", "—"].sort());
    expect(r.issues.every((i) => i.line === 7)).toBe(true);
    expect(r.lead).toBeNull();
  });
});

function memStore(existing: { emails?: Record<string, string>; phones?: Record<string, string> } = {}) {
  const inserted: InsertRow[] = [];
  const updates: { id: string; patch: Record<string, unknown>; custom: Record<string, unknown> }[] = [];
  let failBatches = false, failRow: string | null = null, n = 0;
  const store: ImportStore = {
    initialStatusId: async () => "st-initial",
    sourcesByName: async () => new Map([["salon", "src-salon"]]),
    validSourceId: async (id) => id === "src-salon",
    activeMembers: async (role) => (role === "role-1" ? ["u1", "u2", "u3"] : role === "vide" ? [] : ["u1"]),
    lastAssigned: async () => ({ u1: "2026-01-02T00:00:00Z", u2: null, u3: "2026-01-01T00:00:00Z" }),
    findExisting: async (emails, phones) => ({
      byEmail: new Map(emails.filter((e) => existing.emails?.[e]).map((e) => [e, existing.emails![e]!])),
      byPhone: new Map(phones.filter((p) => existing.phones?.[p]).map((p) => [p, existing.phones![p]!])),
    }),
    insertLeads: async (rows) => {
      if (failBatches && rows.length > 1) throw new Error("batch");
      if (failRow && rows.some((r) => r.last_name === failRow)) throw new Error("row");
      inserted.push(...rows);
      return rows.map(() => `new-${n++}`);
    },
    updateLead: async (id, patch, custom) => void updates.push({ id, patch, custom }),
    tagImportEvents: async () => undefined,
  };
  return { store, inserted, updates, set: (o: { failBatches?: boolean; failRow?: string }) => { failBatches = !!o.failBatches; failRow = o.failRow ?? null; } };
}
const H = ["Nom", "Email", "Tel", "Source"];
const M: Mapping = { Nom: "last_name", Email: "email", Tel: "phone", Source: "source" };
const OPT: ImportOptions = { duplicateMode: "skip", duplicateBy: "either", sourceId: null, assign: { mode: "none" } };

describe("analyse (simulation) et exécution", () => {
  it("doublons base + dans le fichier selon le mode", async () => {
    const rows = [["A", "a@x.fr", "", ""], ["B", "A@X.FR", "", ""], ["C", "", "06 11 22 33 44", ""], ["D", "d@x.fr", "0611223344", ""], ["E", "e@x.fr", "", ""]];
    const m = memStore({ emails: { "e@x.fr": "lead-e" } });
    const skip = await analyze(m.store, H, rows, M, OPT, [], ctx);
    expect(skip.plan.map((p) => p.action)).toEqual(["create", "skip", "create", "skip", "skip"]);
    expect(skip.counts).toEqual({ total: 5, created: 2, updated: 0, skipped: 3, failed: 0 });
    const upd = await analyze(m.store, H, rows, M, { ...OPT, duplicateMode: "update" }, [], ctx);
    expect(upd.plan.map((p) => p.action)).toEqual(["create", "update", "create", "update", "update"]);
    expect(upd.plan[4]!.existingId).toBe("lead-e");
    const create = await analyze(m.store, H, rows, M, { ...OPT, duplicateMode: "create" }, [], ctx);
    expect(create.counts.created).toBe(5);
    expect(create.counts.updated).toBe(0);
  });
  it("e-mail seul : le téléphone identique n'est pas un doublon", async () => {
    const a = await analyze(memStore().store, H, [["A", "", "0611223344", ""], ["B", "", "0611223344", ""]], M, { ...OPT, duplicateBy: "email" }, [], ctx);
    expect(a.counts.created).toBe(2);
  });
  it("erreurs par ligne avec numéro (en-tête = ligne 1) et source inconnue", async () => {
    const a = await analyze(memStore().store, H, [["A", "x", "", ""], ["B", "b@x.fr", "", "Inconnue"], ["C", "c@x.fr", "", "Salon"]], M, OPT, [], ctx);
    expect(a.issues.map((i) => [i.line, i.column])).toEqual([[2, "Email"], [3, "Source"]]);
    expect(a.plan[2]).toMatchObject({ action: "create", sourceId: "src-salon" });
    expect(a.counts.failed).toBe(2);
  });
  it("assignation répartie : le moins récemment assigné d'abord", async () => {
    const a = await analyze(memStore().store, H, ["A", "B", "C", "D"].map((n) => [n, `${n}@x.fr`, "", ""]), M, { ...OPT, assign: { mode: "role", roleId: "role-1" } }, [], ctx);
    expect(a.plan.map((p) => p.assignedTo)).toEqual(["u2", "u3", "u1", "u2"]);
  });
  it("source par défaut invalide ou rôle sans membre : refus clair", async () => {
    expect((await analyze(memStore().store, H, [["A", "", "", ""]], M, { ...OPT, sourceId: "autre" }, [], ctx)).issues[0]!.reason).toMatch(/Source par défaut/);
    const none = await analyze(memStore().store, H, [["A", "", "", ""]], M, { ...OPT, assign: { mode: "role", roleId: "vide" } }, [], ctx);
    expect(none.issues[0]!.reason).toMatch(/Aucun membre/);
  });
  it("exécution : statut initial, lots, fusion et mise à jour", async () => {
    const m = memStore({ emails: { "e@x.fr": "lead-e" } });
    const rows = [["A", "a@x.fr", "", "Salon"], ["A2", "a@x.fr", "0611223344", ""], ["E", "e@x.fr", "", ""]];
    const a = await analyze(m.store, H, rows, M, { ...OPT, duplicateMode: "update" }, [], ctx);
    const r = await execute(m.store, a);
    expect(r).toMatchObject({ created: 1, updated: 2, failedLines: [] });
    expect(m.inserted[0]).toMatchObject({ status_id: "st-initial", last_name: "A", source_id: "src-salon" });
    expect(m.updates.map((u) => u.id).sort()).toEqual(["lead-e", "new-0"]);
    expect(m.updates.find((u) => u.id === "new-0")!.patch).toMatchObject({ last_name: "A2", phone: "0611223344" });
  });
  it("lot en échec : repli ligne à ligne, seules les lignes fautives échouent", async () => {
    const m = memStore();
    m.set({ failBatches: true, failRow: "Mauvais" });
    const a = await analyze(m.store, H, [["Bon", "b@x.fr", "", ""], ["Mauvais", "m@x.fr", "", ""], ["Autre", "o@x.fr", "", ""]], M, OPT, [], ctx);
    const r = await execute(m.store, a);
    expect(r.created).toBe(2);
    expect(r.failedLines.map((f) => f.line)).toEqual([3]);
  });
});

describe("valeurs par défaut des champs obligatoires", () => {
  const req = [field({ key: "type_chauffage", label: "Type de chauffage", type: "select", required: true, options: { choices: ["Gaz", "Bois"] } }), field({ key: "surface", label: "Surface", type: "number", required: true })];
  it("sans défaut : erreur claire par ligne ; avec défaut : ligne valide", () => {
    const map: Mapping = { Nom: "last_name" };
    const a = validateRow(["Nom"], ["Dupont"], map, 2, req, ctx);
    expect(a.issues.map((i) => i.reason).join(" ")).toMatch(/obligatoire/);
    const b = validateRow(["Nom"], ["Dupont"], map, 2, req, ctx, { type_chauffage: "Gaz", surface: "80" });
    expect(b.issues).toEqual([]);
    expect(b.lead!.custom).toEqual({ type_chauffage: "Gaz", surface: 80 });
  });
  it("une valeur du fichier l'emporte sur le défaut ; défaut invalide refusé", () => {
    const map: Mapping = { Nom: "last_name", Ch: "custom:type_chauffage" };
    const r = validateRow(["Nom", "Ch"], ["D", "Bois"], map, 2, req, ctx, { type_chauffage: "Gaz", surface: "50" });
    expect(r.lead!.custom.type_chauffage).toBe("Bois");
    expect(validateRow(["Nom"], ["D"], { Nom: "last_name" }, 2, req, ctx, { type_chauffage: "Fioul", surface: "50" }).lead).toBeNull();
  });
  it("e-mail commençant par = ou + refusé à l'import", () => {
    expect(validateRow(["Nom", "E"], ["D", "=cmd@x.fr"], { Nom: "last_name", E: "email" }, 2, [], ctx).lead).toBeNull();
  });
});
