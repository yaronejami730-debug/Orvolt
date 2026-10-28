/** Champs et règles des pages d'acquisition (/lp/*). Module PUR : utilisé côté client (masque, erreurs) ET côté serveur. */

export const LEAD_KINDS = ["essai", "rappel"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];
export const TRADES = ["installateurs", "regies"] as const;
export type Trade = (typeof TRADES)[number];
export const SLOTS = ["matin", "apres-midi", "peu-importe"] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABELS: Record<Slot, string> = { matin: "Le matin", "apres-midi": "L'après-midi", "peu-importe": "Peu importe" };

/** Version du texte de consentement affiché : à incrémenter dès que le libellé change. */
export const CONSENT_TEXT_VERSION = "2026-02-v1";
/** Délai minimal entre l'affichage du formulaire et l'envoi (un humain met plus de 2 s). */
export const MIN_SUBMIT_MS = 2_000;

/* ───────────── Téléphone ───────────── */

const digitsOf = (s: string) => s.replace(/\D/g, "");

export type PhoneResult = { ok: true; e164: string } | { ok: false };

/**
 * Normalise un numéro français (06 12 34 56 78, 0033…, +33…) ou international (+CC…, 9 à 15 chiffres) en E.164.
 * Tout ce qui n'est pas un numéro plausible est refusé.
 */
export function normalizePhone(raw: string): PhoneResult {
  const s = raw.trim();
  if (!s || /[^\d\s+().-]/.test(s)) return { ok: false };
  const plus = s.startsWith("+");
  const d = digitsOf(s);
  if (!plus && d.startsWith("00")) return normalizePhone(`+${d.slice(2)}`);
  if (plus) {
    if (d.startsWith("33")) {
      // « +33 (0)6 … » : le 0 de confort est toléré.
      const rest = d.slice(2).replace(/^0/, "");
      return /^[1-9]\d{8}$/.test(rest) ? { ok: true, e164: `+33${rest}` } : { ok: false };
    }
    return /^[1-9]\d{8,14}$/.test(d) ? { ok: true, e164: `+${d}` } : { ok: false };
  }
  return /^0[1-9]\d{8}$/.test(d) ? { ok: true, e164: `+33${d.slice(1)}` } : { ok: false };
}

/** Masque de saisie : 06 12 34 56 78 (national), +33 6 12 34 56 78 (France), +CCC … (autres pays, par groupes de 3). */
export function formatPhoneInput(raw: string): string {
  const plus = raw.trim().startsWith("+");
  const d = digitsOf(raw);
  if (!plus && d.startsWith("00")) return formatPhoneInput(`+${d.slice(2)}`);
  if (plus) {
    const intl = d.slice(0, 15);
    if (intl.startsWith("33")) {
      const r = intl.slice(2, 12); // 10 chiffres max : tolère le (0) de confort
      return `+33 ${[r.slice(0, 1), ...(r.slice(1).match(/.{1,2}/g) ?? [])].filter(Boolean).join(" ")}`.trim();
    }
    return `+${(intl.match(/.{1,3}/g) ?? []).join(" ")}`;
  }
  return (d.slice(0, 10).match(/.{1,2}/g) ?? []).join(" ");
}

/** Affichage lisible d'un numéro E.164 (06 12 34 56 78 pour la France). */
export function displayPhone(e164: string): string {
  const m = /^\+33([1-9]\d{8})$/.exec(e164);
  return m ? `0${m[1]!.slice(0, 1)} ${m[1]!.slice(1).match(/.{2}/g)!.join(" ")}` : e164;
}

/* ───────────── E-mail et noms ───────────── */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (s: string) => s.length <= 160 && EMAIL_RE.test(s.trim());

/** Sépare « Prénom Nom » : le premier mot est le prénom, le reste le nom (« Jean-Pierre De La Tour » → Jean-Pierre / De La Tour). */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().replace(/\s+/g, " ").split(" ");
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

const CONTROL = /[\u0000-\u001f\u007f<>]/g;
/** Texte libre assaini : sans caractères de contrôle ni chevrons, espaces compactés, longueur bornée. */
export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/* ───────────── Paramètres de campagne ───────────── */

export const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"] as const;
export type Campaign = Partial<Record<(typeof CAMPAIGN_KEYS)[number], string>>;
const CAMPAIGN_MAX = 200;

/** Ne garde que les clés connues, en texte court assaini. Accepte un objet ou une chaîne JSON ; le reste est ignoré. */
export function sanitizeCampaign(raw: unknown): Campaign {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 4000) return {};
    try { obj = JSON.parse(raw); } catch { return {}; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: Campaign = {};
  for (const k of CAMPAIGN_KEYS) {
    const v = cleanText((obj as Record<string, unknown>)[k], CAMPAIGN_MAX);
    if (v) out[k] = v;
  }
  return out;
}

/** Referrer réduit à origine + chemin (jamais de requête ni de fragment : ils peuvent contenir des données perso). */
export function sanitizeReferrer(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return cleanText(`${u.origin}${u.pathname}`, 300) || null;
  } catch { return null; }
}

/** Page d'entrée : chemin /lp/... seulement. */
export function sanitizeLandingPath(raw: unknown): string | null {
  return typeof raw === "string" && /^\/lp\/[a-z-]{1,40}$/.test(raw) ? raw : null;
}

/** Lit les paramètres de campagne d'une query string (client) ; ne garde que la liste blanche. */
export function campaignFromSearch(search: string): Campaign {
  const p = new URLSearchParams(search);
  return sanitizeCampaign(Object.fromEntries(CAMPAIGN_KEYS.map((k) => [k, p.get(k) ?? ""])));
}

/* ───────────── Redirection vers l'inscription ───────────── */

/** Lien /signup prérempli (e-mail + prénom/nom seulement : jamais le téléphone ni la campagne dans l'URL). */
export function signupPrefillHref(d: { email: string; firstName: string; lastName: string }): string {
  const qs = new URLSearchParams({ email: d.email, firstName: d.firstName, lastName: d.lastName });
  return `/signup?${qs.toString()}`;
}

/** Préremplissage lu dans l'URL de /signup : assaini et borné (jamais confiance aux paramètres). */
export function sanitizePrefill(sp: Record<string, string | string[] | undefined>): { email: string; firstName: string; lastName: string } {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const email = cleanText(one("email"), 160).toLowerCase();
  return { email: isEmail(email) ? email : "", firstName: cleanText(one("firstName"), 60), lastName: cleanText(one("lastName"), 60) };
}
