import Papa from "papaparse";
import { cleanText } from "@/lib/leads/normalize";

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
export const MAX_COLUMNS = 60;

export type Encoding = "utf-8" | "windows-1252";
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
  encoding: Encoding;
}
export class CsvError extends Error {}

/** UTF-8 (BOM toléré) sinon Windows-1252 (exports Excel français). */
export function decodeCsv(buf: Uint8Array): { text: string; encoding: Encoding } {
  let b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(b), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(b), encoding: "windows-1252" };
  }
}

/** Séparateur le plus régulier sur les premières lignes (hors guillemets). */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 10);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => {
      let n = 0, q = false;
      for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
      return n;
    });
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 100 + first;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function parseCsv(buf: Uint8Array): ParsedCsv {
  if (buf.length === 0) throw new CsvError("Le fichier est vide.");
  if (buf.length > IMPORT_MAX_BYTES) throw new CsvError("Fichier trop volumineux (5 Mo maximum).");
  if (buf.subarray(0, 4096).includes(0)) throw new CsvError("Ce fichier n'est pas un CSV texte.");
  const { text, encoding } = decodeCsv(buf);
  const delimiter = detectDelimiter(text);
  const res = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: "greedy", header: false });
  const data = res.data.filter((r) => Array.isArray(r));
  if (data.length === 0) throw new CsvError("Le fichier ne contient aucune ligne.");
  const headerRow = data[0]!;
  if (headerRow.length > MAX_COLUMNS) throw new CsvError(`Trop de colonnes (${MAX_COLUMNS} maximum).`);
  const seen = new Map<string, number>();
  const headers = headerRow.map((h, i) => {
    const base = cleanText(h, 80) || `Colonne ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = data.slice(1);
  if (rows.length === 0) throw new CsvError("Le fichier ne contient que l'en-tête.");
  if (rows.length > IMPORT_MAX_ROWS) throw new CsvError(`Trop de lignes (${IMPORT_MAX_ROWS} maximum, ${rows.length} trouvées).`);
  return { headers, rows: rows.map((r) => headers.map((_, i) => cleanText(r[i] ?? ""))), delimiter, encoding };
}

/** Export CSV sûr : BOM UTF-8, guillemets, neutralisation des formules. */
export function toCsv(rows: (string | number | null)[][], neutralize: (s: string) => string): string {
  const cell = (v: string | number | null) => {
    const s = neutralize(v === null ? "" : String(v));
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
