export const DISPATCH_TZ = "Europe/Paris";

export const fmtMin = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** « HH:MM » ou « HH:MM:SS » -> minutes. */
export function parseTimeToMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/** Jour ISO (1 = lundi … 7 = dimanche) d'une date AAAA-MM-JJ. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jour local (Europe/Paris) d'un instant. */
export function localDay(d: Date, tz = DISPATCH_TZ): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p;
}

/** Minutes locales depuis minuit d'un instant. */
export function localMinutes(d: Date, tz = DISPATCH_TZ): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = Number(parts.find((x) => x.type === "hour")!.value);
  const m = Number(parts.find((x) => x.type === "minute")!.value);
  return h * 60 + m;
}

/** Instant UTC correspondant à (jour local, minutes locales). Gère l'heure d'été. */
export function zonedToUtc(day: string, min: number, tz = DISPATCH_TZ): Date {
  const guess = new Date(`${day}T00:00:00Z`).getTime() + min * 60_000;
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const asLocal = new Date(t);
    const diff = (Date.parse(`${localDay(asLocal, tz)}T00:00:00Z`) + localMinutes(asLocal, tz) * 60_000) - guess;
    if (diff === 0) break;
    t -= diff;
  }
  return new Date(t);
}

/** Liste de `n` jours consécutifs à partir de `from` (inclus). */
export function dayRange(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}
