/** Pagination par clé (keyset) de la liste des leads : coût constant quelle que soit la profondeur (OFFSET = lecture de toutes les lignes sautées). */

/** Colonnes de tri NON nulles : seules ces colonnes ont une pagination par clé (value / assigned_to restent en OFFSET). */
export const KEYSET_SORTS = ["created_at", "updated_at", "last_name", "status_id"] as const;
export type KeysetSort = (typeof KEYSET_SORTS)[number];
export interface Cursor { v: string; id: string }

/** Au-delà de ce nombre, le total affiché est « 10 000+ » (le compte est plafonné côté base). */
export const LEADS_COUNT_CAP = 10_000;

export const supportsKeyset = (sort: string): sort is KeysetSort => (KEYSET_SORTS as readonly string[]).includes(sort);

/** Valeur PostgREST entre guillemets (virgules, parenthèses et points sont alors littéraux). */
export const quoteValue = (v: string): string => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Filtres « après le curseur » pour un tri (colonne, id) de même sens.
 * `bound` est une borne redondante sur la colonne : elle permet à Postgres de se positionner dans l'index
 * (la clause OR seule ne pourrait pas servir de borne d'index et relirait toutes les lignes précédentes).
 */
export function keysetFilter(sort: KeysetSort, dir: "asc" | "desc", c: Cursor): { bound: { op: "gte" | "lte"; col: string; value: string }; or: string } {
  const cmp = dir === "asc" ? "gt" : "lt";
  const v = quoteValue(c.v);
  return {
    bound: { op: dir === "asc" ? "gte" : "lte", col: sort, value: c.v },
    or: `${sort}.${cmp}.${v},and(${sort}.eq.${v},id.${cmp}.${quoteValue(c.id)})`,
  };
}

/** Curseur d'une ligne (clé de tri + id) ; null si la colonne n'est pas paginable par clé. */
export function cursorOf(row: Record<string, unknown>, sort: string): Cursor | null {
  if (!supportsKeyset(sort)) return null;
  const v = row[sort], id = row.id;
  return typeof v === "string" && typeof id === "string" ? { v, id } : null;
}

/** Terme de recherche téléphone (chiffres, sans 0 initial national) si la saisie ressemble à un numéro, sinon null. */
export function phoneSearchTerm(q: string | undefined): string | null {
  const t = (q ?? "").trim();
  if (!t || !/^[\d\s.+()-]+$/.test(t)) return null;
  let d = t.replace(/\D/g, "");
  if (d.length < 4) return null;
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0") && !t.startsWith("+")) d = d.slice(1);
  return d.length >= 4 ? d : null;
}
