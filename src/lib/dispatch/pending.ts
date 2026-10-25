import { addDays } from "./time";

/**
 * Fenêtre de jours souhaitée d'un RDV « à attribuer » (miroir de create_pending_appointment) : à partir de demain, au plus 31 jours.
 * Retourne le message d'erreur en français, ou null si la fenêtre est valide. `today` = jour local AAAA-MM-JJ.
 */
export function checkWishWindow(from: string, to: string, today: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to) || Number.isNaN(Date.parse(`${from}T12:00:00Z`)) || Number.isNaN(Date.parse(`${to}T12:00:00Z`))) return "Dates souhaitées invalides.";
  if (from < addDays(today, 1)) return "Le premier jour souhaité doit être à partir de demain : la répartition ne planifie jamais aujourd'hui ni dans le passé.";
  if (to < from) return "Le dernier jour souhaité doit être après le premier.";
  if (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`) > 30 * 86_400_000) return "La fenêtre souhaitée ne peut pas dépasser 31 jours.";
  return null;
}

/** Messages français des erreurs de create_pending_appointment. */
export const PENDING_RPC_ERRORS: [string, string][] = [
  ["lead_not_found", "Lead introuvable."],
  ["invalid_wish", "Fenêtre de jours invalide : à partir de demain, 31 jours au plus."],
  ["invalid_duration", "Durée invalide (15 min à 8 h)."],
  ["position_outside_france", "Position hors de France : vérifiez les coordonnées."],
  ["invalid_position", "Position invalide."],
  ["invalid_text", "Texte trop long."],
  ["forbidden", "Permission insuffisante."],
];
