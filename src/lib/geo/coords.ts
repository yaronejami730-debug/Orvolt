import { haversineKm } from "./haversine";

export type ParsedCoords = { ok: true; lat: number; lng: number; warnings: string[] } | { ok: false; error: string };

/** Zones plausibles : France métropolitaine (Corse incluse) et DOM-TOM. */
const BOXES: { name: string; latMin: number; latMax: number; lngMin: number; lngMax: number }[] = [
  { name: "métropole", latMin: 41.2, latMax: 51.3, lngMin: -5.5, lngMax: 9.8 },
  { name: "Guadeloupe", latMin: 15.8, latMax: 16.6, lngMin: -61.9, lngMax: -60.9 },
  { name: "Martinique", latMin: 14.3, latMax: 14.95, lngMin: -61.3, lngMax: -60.7 },
  { name: "Guyane", latMin: 2, latMax: 5.9, lngMin: -54.7, lngMax: -51.5 },
  { name: "La Réunion", latMin: -21.5, latMax: -20.8, lngMin: 55.1, lngMax: 55.9 },
  { name: "Mayotte", latMin: -13.1, latMax: -12.5, lngMin: 44.9, lngMax: 45.4 },
];
export const plausibleInFrance = (lat: number, lng: number) => BOXES.some((b) => lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax);

const num = (s: string) => Number(s.replace(",", "."));
const NUM = String.raw`-?\d{1,3}(?:[.,]\d+)?`;

/**
 * Lit des coordonnées GPS collées depuis Google Maps (ou à la main), de façon tolérante :
 * « 43.9493, 5.7826 », « 43,9493 ; 5,7826 », « 43.9493 5.7826 », liens `…/@43.9,5.7,15z`, `?q=43.9,5.7`, `!3d43.9!4d5.7`.
 * Les liens courts (maps.app.goo.gl) ne sont JAMAIS résolus côté serveur (SSRF) : on demande les coordonnées.
 * `near` (point connu/commune) : avertit si la position saisie en est éloignée de plus de `farKm`.
 */
export function parseCoordinates(input: string, near?: { lat: number; lng: number } | null, farKm = 30): ParsedCoords {
  const t = input.trim();
  if (!t) return { ok: false, error: "Collez les coordonnées copiées depuis Google Maps." };
  if (/maps\.app\.goo\.gl|goo\.gl\/maps|share\.google/i.test(t)) {
    return { ok: false, error: "Les liens courts Google Maps ne peuvent pas être lus : faites un clic droit sur le lieu et copiez les coordonnées (ex. 43.9493, 5.7826)." };
  }
  let la: number | null = null;
  let lo: number | null = null;
  const m3d = new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`).exec(t);
  const mAt = new RegExp(String.raw`@(${NUM}),(${NUM})`).exec(t);
  const mQ = new RegExp(String.raw`[?&](?:q|ll|query|destination)=(?:loc:)?(${NUM})(?:,|%2C)(${NUM})`, "i").exec(t);
  if (m3d) [la, lo] = [num(m3d[1]!), num(m3d[2]!)];
  else if (mAt) [la, lo] = [num(mAt[1]!), num(mAt[2]!)];
  else if (mQ) [la, lo] = [num(mQ[1]!), num(mQ[2]!)];
  else if (!/https?:\/\//i.test(t)) {
    // « lat, lng » : séparateur ; ou virgule+espace, ou espace ; une seule virgule entre deux points décimaux
    const s = t.replace(/[°']/g, "").replace(/\s+/g, " ");
    let parts: string[];
    if (s.includes(";")) parts = s.split(";");
    else if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(s)) parts = s.split(",");
    else if (/^-?\d+,\d+ -?\d+,\d+$/.test(s)) parts = s.split(" ");
    else parts = s.split(/,\s+|\s+/);
    if (parts.length === 2 && parts.every((p) => new RegExp(`^${NUM}$`).test(p.trim()))) [la, lo] = [num(parts[0]!.trim()), num(parts[1]!.trim())];
  }
  if (la === null || lo === null || !Number.isFinite(la) || !Number.isFinite(lo)) {
    return { ok: false, error: "Format non reconnu : attendu « latitude, longitude » (ex. 43.9493, 5.7826) ou un lien Google Maps complet." };
  }
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return { ok: false, error: "Coordonnées hors limites (latitude ±90, longitude ±180)." };
  // Inversion fréquente (lng, lat) : en France la latitude est > 41 et la longitude < 10 en valeur absolue
  if (!plausibleInFrance(la, lo) && plausibleInFrance(lo, la)) return { ok: false, error: "Latitude et longitude semblent inversées : saisissez d'abord la latitude (ex. 43.9493, 5.7826)." };
  if (!plausibleInFrance(la, lo)) return { ok: false, error: "Position hors de France (métropole et outre-mer) : vérifiez les coordonnées." };
  const warnings: string[] = [];
  if (near) {
    const d = haversineKm({ lat: la, lng: lo }, near);
    if (d > farKm) warnings.push(`Cette position est à ${Math.round(d)} km de la position actuelle / de la commune saisie : vérifiez qu'elle correspond bien au lieu du RDV.`);
  }
  return { ok: true, lat: Math.round(la * 1e6) / 1e6, lng: Math.round(lo * 1e6) / 1e6, warnings };
}

/** Lien Google Maps de recherche pour aider à trouver le lieu. */
export const googleMapsSearchUrl = (address: string) => `https://maps.google.com/?q=${encodeURIComponent(address.slice(0, 200))}`;
