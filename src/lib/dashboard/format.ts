/** Taux de conversion = gagnés / (gagnés + perdus). null s'il n'y a aucun lead clôturé. */
export function conversionRate(won: number, lost: number): number | null {
  const closed = won + lost;
  return closed === 0 ? null : won / closed;
}

export interface Delta {
  /** Variation en % (1 décimale) ; null si la période précédente est à 0 et la courante non (« nouveau »). */
  pct: number | null;
  direction: "up" | "down" | "flat";
}
export function delta(current: number, previous: number): Delta {
  if (previous === 0) return current === 0 ? { pct: 0, direction: "flat" } : { pct: null, direction: "up" };
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return { pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}
/** Écart en points de pourcentage entre deux taux (null si l'un manque). */
export function deltaPoints(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 1000) / 10;
}
export const fmtPercent = (r: number | null) => (r === null ? "–" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(r * 100)} %`);
export const fmtEuro = (v: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
export const fmtInt = (v: number) => new Intl.NumberFormat("fr-FR").format(v);
