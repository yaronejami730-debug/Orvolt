import { formatDistanceToNowStrict } from "date-fns";
import { fr } from "date-fns/locale";

export const eur = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

export const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { locale: fr, addSuffix: true });
export const dateFr = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
export const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;
