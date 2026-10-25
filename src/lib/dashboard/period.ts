/** Périodes du tableau de bord (jours calendaires Europe/Paris). Fonctions pures, testées. */
export const TZ = "Europe/Paris";
export const MAX_DAYS = 366;
export type Preset = "7d" | "30d" | "90d" | "month" | "custom";

export interface Period {
  preset: Preset;
  fromDay: string; // yyyy-mm-dd inclus
  toDay: string; // yyyy-mm-dd exclu
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  days: number;
  bucket: "day" | "week";
}
export class PeriodError extends Error {}

const DAY = 86_400_000;
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;

function offsetMinutes(at: Date): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = part.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** Instant du minuit (heure de Paris) d'un jour yyyy-mm-dd. */
const validDay = (day: string) => ymdRe.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day; // refuse le 30 février

export function startOfParisDay(day: string): Date {
  if (!validDay(day)) throw new PeriodError("Date invalide.");
  const utc = Date.parse(`${day}T00:00:00Z`);
  const first = utc - offsetMinutes(new Date(utc)) * 60_000;
  return new Date(utc - offsetMinutes(new Date(first)) * 60_000);
}

export function parisToday(now: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p; // yyyy-mm-dd
}
export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * Résout une période et la période précédente de même durée (juste avant).
 * 7d/30d/90d : n derniers jours, aujourd'hui inclus ; month : du 1er du mois à aujourd'hui inclus ;
 * custom : de `from` à `to` inclus (max 366 jours).
 */
export function resolvePeriod(input: { preset: Preset; from?: string; to?: string }, now = new Date()): Period {
  const today = parisToday(now);
  const tomorrow = shiftDay(today, 1);
  let fromDay: string, toDay: string;
  switch (input.preset) {
    case "7d": case "30d": case "90d": {
      const n = Number.parseInt(input.preset, 10);
      toDay = tomorrow;
      fromDay = shiftDay(tomorrow, -n);
      break;
    }
    case "month":
      toDay = tomorrow;
      fromDay = `${today.slice(0, 7)}-01`;
      break;
    case "custom": {
      if (!input.from || !input.to) throw new PeriodError("Choisissez une date de début et de fin.");
      if (!validDay(input.from) || !validDay(input.to)) throw new PeriodError("Date invalide.");
      if (input.to < input.from) throw new PeriodError("La date de fin précède la date de début.");
      fromDay = input.from;
      toDay = shiftDay(input.to, 1);
      break;
    }
    default:
      throw new PeriodError("Période inconnue.");
  }
  const days = diffDays(fromDay, toDay);
  if (days > MAX_DAYS) throw new PeriodError(`La période ne peut pas dépasser ${MAX_DAYS} jours.`);
  if (days < 1) throw new PeriodError("Période vide.");
  const prevFromDay = shiftDay(fromDay, -days);
  return {
    preset: input.preset,
    fromDay, toDay,
    from: startOfParisDay(fromDay), to: startOfParisDay(toDay),
    prevFrom: startOfParisDay(prevFromDay), prevTo: startOfParisDay(fromDay),
    days,
    bucket: days <= 62 ? "day" : "week",
  };
}
