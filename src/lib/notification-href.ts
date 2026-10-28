/** Cible d'une notification d'après les données qu'elle porte (payload). null : pas de destination. */
export function notificationHref(n: { type: string; payload: Record<string, unknown> }): string | null {
  const p = n.payload;
  const href = typeof p.href === "string" ? p.href : null;
  if (href && href.startsWith("/") && !href.startsWith("//")) return href;
  const message = typeof p.message === "string" ? p.message : "";
  const leadId = typeof p.lead_id === "string" && /^[0-9a-f-]{36}$/i.test(p.lead_id) ? p.lead_id : null;
  // Messages à destination du confirmateur : relancer / attribuer = page Répartition.
  if (/relancez la répartition|à attribuer|Répartition\)/i.test(message)) return "/agenda/repartition";
  if (leadId) return `/leads/${leadId}`;
  // Répartition automatique / rééquilibrage (sans lead) : la tournée du commercial est dans l'agenda.
  if (n.type === "appointment") return "/agenda";
  return null;
}
