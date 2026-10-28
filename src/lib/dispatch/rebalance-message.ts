/** Libellé de la bannière « à rééquilibrer » selon la cause : indisponibilité déclarée, position corrigée, ou les deux. */
export function rebalanceMessage(total: number, unavail: number): string {
  const pos = total - unavail;
  const rdv = (n: number) => `${n} RDV`;
  if (unavail > 0 && pos <= 0) return `Indisponibilité déclarée : ${rdv(unavail)} à replacer. Relancer la répartition.`;
  if (unavail > 0) return `Indisponibilité déclarée sur ${rdv(unavail)} et position corrigée sur ${rdv(pos)} : relancer la répartition.`;
  return `Position corrigée sur ${rdv(total)} : relancer la répartition.`;
}
