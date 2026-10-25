/** Normalisation partagée import / webhooks / dédoublonnage (doit rester identique à public.normalize_phone en SQL). */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (!digits) return null;
  if (p.trim().startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(digits)) return `+33${digits.slice(1)}`;
  if (/^33[1-9]\d{8}$/.test(digits)) return `+${digits}`;
  return digits;
}

export function normalizeEmail(e: string | null | undefined): string | null {
  const v = e?.trim().toLowerCase();
  return v ? v : null;
}

/** Supprime octets nuls et caractères de contrôle (hors tab/retour ligne), borne la longueur. */
export function cleanText(v: unknown, max = 2000): string {
  const s = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "") // caractères bidirectionnels (usurpation visuelle)
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

/**
 * Neutralise l'injection de formules (tableurs) : une valeur texte commençant par = + - @ ou tab/CR
 * est préfixée par une apostrophe. À appliquer aux textes libres ET à tout export CSV.
 */
export function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Masque les données personnelles d'un payload stocké (journal d'événements). */
export function maskPii(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => maskPii(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).slice(0, 60).map(([k, v]) => {
        if (/key|secret|token|password/i.test(k)) return [k, "[masqué]"];
        return [k, maskPii(v, depth + 1)];
      }),
    );
  }
  if (typeof value === "string") {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value.replace(/^(.).*(@.*)$/, "$1***$2");
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 8 && /^[+\d\s().-]+$/.test(value)) return `${"*".repeat(Math.max(0, digits.length - 2))}${digits.slice(-2)}`;
    return value.length > 2 ? `${value.slice(0, 1)}${"*".repeat(Math.min(value.length - 1, 8))}` : value;
  }
  return value;
}
