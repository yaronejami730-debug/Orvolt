/** Normalise une adresse pour la clé de cache : minuscules, sans accents ni ponctuation, espaces réduits. */
export function normalizeAddress(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
