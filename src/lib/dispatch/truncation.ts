export const MAX_PENDING = 100;
export const MAX_EXISTING = 1000;
export const MAX_UNAVAILABILITY = 500;

export interface Truncated {
  /** Total en base quand il dépasse la limite de chargement, sinon null. */
  pending: number | null;
  existing: number | null;
  unavailability: number | null;
}

/** Avertissements français pour chaque limite de chargement atteinte (affichés dans la page et l'aperçu) : jamais de troncature silencieuse. */
export function truncationWarnings(t: Truncated): string[] {
  const out: string[] = [];
  if (t.pending !== null) out.push(`${t.pending} RDV à attribuer en base : seuls les ${MAX_PENDING} plus proches dans le temps sont répartis à chaque passage. Relancez la répartition après validation pour traiter les suivants.`);
  if (t.existing !== null) out.push(`${t.existing} RDV déjà attribués sur l'horizon : seuls ${MAX_EXISTING} sont pris en compte, la proposition peut ignorer certains RDV existants (la validation les contrôle de toute façon).`);
  if (t.unavailability !== null) out.push(`${t.unavailability} indisponibilités sur l'horizon : seules ${MAX_UNAVAILABILITY} sont prises en compte, certains créneaux proposés peuvent être refusés à la validation.`);
  return out;
}

/** Total > limite => le total (affiché), sinon null. */
export const overLimit = (count: number | null, limit: number): number | null => (count !== null && count > limit ? count : null);
