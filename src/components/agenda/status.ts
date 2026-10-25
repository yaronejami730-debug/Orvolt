export { STATUS_COLOR, STATUS_LABEL } from "@/lib/validation/appointments";

export const DIST_LABEL = { ok: "Dans la zone", over_radius: "Hors zone", no_geocode: "Distance non vérifiée", no_zone: "Distance non vérifiée" } as const;
export const toLocalInputs = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
};
export const fmtDay = (d: Date) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(d);
export const fmtTime = (d: Date | string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(d));
export const fmtFull = (d: Date | string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
