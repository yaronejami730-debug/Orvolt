/** Choisit le candidat assigné le moins récemment (jamais assigné en premier), départage par id. */
export function pickRoundRobin(candidates: string[], lastAssigned: Record<string, string | null | undefined>): string | null {
  if (candidates.length === 0) return null;
  const ts = (id: string) => {
    const v = lastAssigned[id];
    return v ? new Date(v).getTime() : -Infinity;
  };
  return [...candidates].sort((a, b) => ts(a) - ts(b) || a.localeCompare(b))[0]!;
}
