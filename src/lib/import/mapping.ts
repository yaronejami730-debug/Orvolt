import { z } from "zod";
import { validateCustom, type CustomFieldDef, type CustomValue, type FieldCtx } from "@/lib/custom-fields";
import { cleanText, neutralizeFormula, normalizeEmail, normalizePhone } from "@/lib/leads/normalize";

export const NATIVE_TARGETS = [
  { key: "first_name", label: "Prénom" },
  { key: "last_name", label: "Nom" },
  { key: "company", label: "Société" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Téléphone" },
  { key: "address", label: "Adresse" },
  { key: "city", label: "Ville" },
  { key: "postal_code", label: "Code postal" },
  { key: "value", label: "Valeur (€)" },
  { key: "source", label: "Source (nom)" },
  { key: "domain", label: "Domaine (nom)" },
] as const;
export type NativeKey = (typeof NATIVE_TARGETS)[number]["key"];

/** Cible de mappage : champ natif, "custom:<clé>" ou "ignore". */
export type Target = NativeKey | `custom:${string}` | "ignore";
export type Mapping = Record<string, Target>; // en-tête CSV -> cible

const SYNONYMS: Record<NativeKey, string[]> = {
  first_name: ["prenom", "firstname", "first name", "given name"],
  last_name: ["nom", "lastname", "last name", "surname", "nom de famille", "name"],
  company: ["societe", "entreprise", "company", "organisation", "raison sociale"],
  email: ["email", "e mail", "mail", "courriel", "adresse email"],
  phone: ["telephone", "tel", "phone", "mobile", "portable", "numero de telephone"],
  address: ["adresse", "address", "rue", "street"],
  city: ["ville", "city", "commune"],
  postal_code: ["code postal", "cp", "zip", "postal code", "zipcode"],
  value: ["valeur", "montant", "budget", "value", "amount"],
  source: ["source", "origine", "provenance", "canal"],
  domain: ["domaine", "produit", "interet", "interesse par", "projet"],
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Mappage automatique par nom de colonne (natifs, puis champs personnalisés par clé ou libellé). */
export function autoMap(headers: string[], fields: Pick<CustomFieldDef, "key" | "label" | "type">[]): Mapping {
  const used = new Set<string>();
  const out: Mapping = {};
  for (const h of headers) {
    const n = norm(h);
    let target: Target = "ignore";
    const native = (Object.keys(SYNONYMS) as NativeKey[]).find((k) => !used.has(k) && SYNONYMS[k].includes(n));
    if (native) target = native;
    else {
      const f = fields.find((x) => !used.has(`custom:${x.key}`) && x.type !== "file" && (norm(x.label) === n || x.key === n.replace(/ /g, "_")));
      if (f) target = `custom:${f.key}`;
    }
    if (target !== "ignore") used.add(target);
    out[h] = target;
  }
  return out;
}

export const mappingSchema = z.record(z.string().max(100), z.string().regex(/^(ignore|first_name|last_name|company|email|phone|address|city|postal_code|value|source|domain|custom:[a-z][a-z0-9_]{1,40})$/));

export interface RowIssue {
  line: number; // numéro de ligne dans le fichier (en-tête = 1)
  column: string;
  reason: string;
}
export interface ParsedLead {
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  value: number | null;
  source_name: string | null;
  /** Domaine d'activité (pompe à chaleur…) : résolu par nom, voir engine.ts. */
  domain_name?: string | null;
  custom: Record<string, CustomValue>;
}

const emailSchema = z.email().max(200);
const phoneRe = /^[0-9+().\s-]{6,40}$/;

/** Valide et nettoie une ligne. Les textes libres sont protégés contre l'injection de formules. */
export function validateRow(
  headers: string[],
  row: string[],
  mapping: Mapping,
  line: number,
  fields: CustomFieldDef[],
  ctx: FieldCtx,
  /** Valeur par défaut (texte brut) des champs personnalisés absents ou vides, par clé. */
  defaults: Record<string, string> = {},
): { lead: ParsedLead | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const lead: ParsedLead = { first_name: "", last_name: "", company: null, email: null, phone: null, address: null, city: null, postal_code: null, value: null, source_name: null, custom: {} };
  const rawCustom: Record<string, unknown> = {};
  const colOf: Record<string, string> = {};
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  for (const [h, t] of Object.entries(mapping)) if (t.startsWith("custom:")) colOf[t.slice(7)] = h;

  headers.forEach((h, i) => {
    const target = mapping[h] ?? "ignore";
    if (target === "ignore") return;
    const raw = cleanText(row[i] ?? "");
    if (raw === "") return;
    const bad = (reason: string) => issues.push({ line, column: h, reason });
    if (target.startsWith("custom:")) {
      const key = target.slice(7);
      const f = fieldByKey.get(key);
      if (!f) return bad("Champ personnalisé inconnu.");
      rawCustom[key] = customRaw(f, raw);
      return;
    }
    switch (target) {
      case "first_name": case "last_name": {
        if (raw.length > 80) return bad("Texte trop long (80 caractères max).");
        lead[target] = neutralizeFormula(raw);
        break;
      }
      case "company": case "address": case "city": {
        const max = target === "company" ? 120 : target === "address" ? 300 : 100;
        if (raw.length > max) return bad(`Texte trop long (${max} caractères max).`);
        lead[target] = neutralizeFormula(raw);
        break;
      }
      case "postal_code":
        if (raw.length > 12) return bad("Code postal trop long.");
        lead.postal_code = raw;
        break;
      case "email": {
        const e = normalizeEmail(raw)!;
        if (!emailSchema.safeParse(e).success || /^[=+\-@]/.test(e)) return bad("E-mail invalide.");
        lead.email = e;
        break;
      }
      case "phone":
        if (!phoneRe.test(raw)) return bad("Téléphone invalide.");
        lead.phone = raw;
        break;
      case "value": {
        const n = Number(raw.replace(/\s/g, "").replace(/€/g, "").replace(",", "."));
        if (!Number.isFinite(n) || n < 0 || n > 1e9) return bad("Valeur invalide (nombre positif attendu).");
        lead.value = n;
        break;
      }
      case "source":
        lead.source_name = raw.slice(0, 40);
        break;
      case "domain":
        lead.domain_name = raw.slice(0, 60);
        break;
    }
  });

  for (const [key, def] of Object.entries(defaults)) {
    const f = fieldByKey.get(key);
    if (f && rawCustom[key] === undefined && cleanText(def) !== "") rawCustom[key] = customRaw(f, cleanText(def));
  }
  if (!lead.first_name && !lead.last_name && !lead.company) issues.push({ line, column: "—", reason: "Indiquez au moins un nom, un prénom ou une société." });
  const cv = validateCustom(fields, rawCustom, ctx, "create");
  for (const [k, reason] of Object.entries(cv.errors)) issues.push({ line, column: colOf[k] ?? fieldByKey.get(k)?.label ?? k, reason });
  lead.custom = cv.data;
  return { lead: issues.length ? null : lead, issues };
}

function customRaw(f: CustomFieldDef, raw: string): unknown {
  if (f.type === "number") {
    const n = Number(raw.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : raw;
  }
  if (f.type === "select" && f.options?.multiple) return raw.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
  return f.type === "text" || f.type === "address" ? neutralizeFormula(raw) : raw;
}

export type DuplicateMode = "skip" | "update" | "create";
export type DuplicateKey = "email" | "phone" | "either";

/** Clé de doublon d'une ligne : liste des identifiants normalisés selon l'option. */
export function dedupeKeys(l: Pick<ParsedLead, "email" | "phone">, by: DuplicateKey): { email: string | null; phone: string | null } {
  return {
    email: by === "phone" ? null : normalizeEmail(l.email),
    phone: by === "email" ? null : normalizePhone(l.phone),
  };
}
