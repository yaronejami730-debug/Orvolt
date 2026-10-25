import { addDays } from "./time";

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher), AAAA-MM-JJ. Miroir de public.fr_easter (SQL). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const cache = new Map<number, Map<string, string>>();

/** Jours fériés légaux de France métropolitaine d'une année : 8 fixes + lundi de Pâques, Ascension, lundi de Pentecôte. */
export function frenchHolidays(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const y = String(year);
  const easter = easterSunday(year);
  const list: [string, string][] = [
    [`${y}-01-01`, "Jour de l'an"], [addDays(easter, 1), "Lundi de Pâques"], [`${y}-05-01`, "Fête du Travail"], [`${y}-05-08`, "Victoire 1945"],
    [addDays(easter, 39), "Ascension"], [addDays(easter, 50), "Lundi de Pentecôte"], [`${y}-07-14`, "Fête nationale"], [`${y}-08-15`, "Assomption"],
    [`${y}-11-01`, "Toussaint"], [`${y}-11-11`, "Armistice 1918"], [`${y}-12-25`, "Noël"],
  ];
  const m = new Map(list);
  cache.set(year, m);
  return m;
}

/** Nom du jour férié (AAAA-MM-JJ) ou null. Aucun commercial n'est planifié un jour férié (la base le refuse aussi : public.is_fr_holiday). */
export function holidayName(day: string): string | null {
  return frenchHolidays(Number(day.slice(0, 4))).get(day) ?? null;
}
export const isFrenchHoliday = (day: string): boolean => holidayName(day) !== null;
