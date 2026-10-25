import { z } from "zod";

export type CustomFieldType = "text" | "number" | "date" | "select" | "file" | "address";
export interface CustomFieldDef {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: { choices?: string[]; multiple?: boolean; min?: number; max?: number } | null;
  required: boolean;
  visible_roles: string[] | null;
  editable_roles: string[] | null;
}
export interface FieldCtx {
  roleId: string;
  isAdmin: boolean;
}
export type CustomValue = string | number | string[];
export interface CustomResult {
  ok: boolean;
  data: Record<string, CustomValue>;
  errors: Record<string, string>;
}

export function canViewField(f: CustomFieldDef, ctx: FieldCtx): boolean {
  return ctx.isAdmin || f.visible_roles === null || f.visible_roles.includes(ctx.roleId);
}
export function canEditField(f: CustomFieldDef, ctx: FieldCtx): boolean {
  if (ctx.isAdmin) return true;
  if (!canViewField(f, ctx)) return false;
  return f.editable_roles === null || f.editable_roles.includes(ctx.roleId);
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}, "Date invalide.");

function valueSchema(f: CustomFieldDef): z.ZodType<CustomValue> {
  switch (f.type) {
    case "text":
      return z.string().trim().max(2000, "Texte trop long (2000 caractères max).");
    case "address":
      return z.string().trim().max(300, "Adresse trop longue.");
    case "number": {
      // Par défaut les nombres sont positifs ; une valeur négative exige un min explicite.
      const min = f.options?.min ?? 0;
      const max = f.options?.max ?? 1e12;
      return z.number("Nombre invalide.").finite("Nombre invalide.").min(min, `Valeur minimale : ${min}.`).max(max, `Valeur maximale : ${max}.`);
    }
    case "date":
      return dateSchema;
    case "file":
      return z.uuid("Fichier invalide.");
    case "select": {
      const choices = f.options?.choices ?? [];
      const one = z.string().refine((v) => choices.includes(v), "Option inconnue.");
      return f.options?.multiple ? z.array(one).max(choices.length) : one;
    }
  }
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Valide les valeurs de champs personnalisés selon la définition de l'org et le rôle de l'appelant.
 * mode "create" : tous les champs obligatoires visibles/éditables doivent être présents.
 * mode "update" : seules les clés fournies sont contrôlées (null/"" = effacer, refusé si obligatoire).
 * Clés inconnues, masquées ou non éditables pour le rôle : refusées.
 */
export function validateCustom(fields: CustomFieldDef[], input: unknown, ctx: FieldCtx, mode: "create" | "update"): CustomResult {
  const errors: Record<string, string> = {};
  const data: Record<string, CustomValue> = {};
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const byKey = new Map(fields.map((f) => [f.key, f]));

  for (const key of Object.keys(raw)) {
    const f = byKey.get(key);
    if (!f) errors[key] = "Champ inconnu.";
    else if (!canEditField(f, ctx)) errors[key] = "Champ non modifiable avec votre rôle.";
  }
  for (const f of fields) {
    if (errors[f.key]) continue;
    const provided = f.key in raw;
    const editable = canEditField(f, ctx);
    if (!provided) {
      if (mode === "create" && f.required && editable) errors[f.key] = `${f.label} est obligatoire.`;
      continue;
    }
    const v = raw[f.key];
    if (isEmpty(v)) {
      if (f.required) errors[f.key] = `${f.label} est obligatoire.`;
      continue; // vide = pas de valeur
    }
    const r = valueSchema(f).safeParse(v);
    if (r.success) data[f.key] = r.data;
    else errors[f.key] = r.error.issues[0]?.message ?? "Valeur invalide.";
  }
  return { ok: Object.keys(errors).length === 0, data, errors };
}

/** Convertit la saisie d'un formulaire (chaînes) vers le type attendu par le champ. */
export function coerceFormValue(f: Pick<CustomFieldDef, "type" | "options">, value: string | string[] | undefined): unknown {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (value === "") return null;
  if (f.type === "number") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : value;
  }
  return value;
}
