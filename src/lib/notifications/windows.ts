/**
 * Fenêtres de rappel (logique pure, sans accès base) du cron `notifications`.
 * Principe : un rappel est dû dès que l'événement entre dans la fenêtre et tant qu'il n'est pas déjà parti (`*_sent_at` nul).
 * La borne haute inclut le pas du cron : à chaque passage, tout ce qui sera échu avant le prochain passage part maintenant.
 * La borne basse est le rattrapage maximal : au-delà, le rappel n'a plus d'intérêt et n'est jamais envoyé.
 */
export const CRON_STEP_MIN = 15;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface Window { from: Date; to: Date }

/** Bornes de l'intervalle ]from, to]. */
export const inWindow = (iso: string | Date | null | undefined, w: Window): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t > w.from.getTime() && t <= w.to.getTime();
};

/** RDV dans environ 1 h : de 5 min (trop tard au-delà) à 1 h + un pas de cron. */
export function hourWindow(now: Date, step = CRON_STEP_MIN): Window {
  return { from: new Date(now.getTime() + 5 * MIN), to: new Date(now.getTime() + HOUR + step * MIN) };
}

/** RDV « demain » : entre 2 h (le rappel d'une heure prend le relais) et 24 h + un pas de cron. */
export function dayWindow(now: Date, step = CRON_STEP_MIN): Window {
  return { from: new Date(now.getTime() + 2 * HOUR), to: new Date(now.getTime() + DAY + step * MIN) };
}

/** Tâche échue depuis au plus 24 h (rattrapage après une panne du cron), jamais dans le futur. */
export function taskWindow(now: Date): Window {
  return { from: new Date(now.getTime() - DAY), to: now };
}

/** Fin d'essai dans 3 jours ou moins (une seule fois), pas déjà échue. */
export function trialEndingWindow(now: Date, days = 3): Window {
  return { from: now, to: new Date(now.getTime() + days * DAY) };
}

/** Essai échu depuis au plus 7 jours (au-delà, le mail « essai terminé » ne servirait plus à rien). */
export function trialExpiredWindow(now: Date, days = 7): Window {
  return { from: new Date(now.getTime() - days * DAY), to: now };
}

/** Jours restants affichés dans le mail (arrondi supérieur, minimum 1). */
export const trialDaysLeft = (trialEnd: string | Date, now: Date): number => Math.max(1, Math.ceil((new Date(trialEnd).getTime() - now.getTime()) / DAY));

export type ReminderKind = "day" | "hour" | "customer";
export interface ApptLike { starts_at: string | null; status: string; reminder_day_sent_at: string | null; reminder_hour_sent_at: string | null; customer_reminder_sent_at: string | null }

/**
 * Rappels à envoyer pour un rendez-vous, à `now`. « day » et « customer » partent à la veille ; « hour » à 1 h.
 * Un RDV annulé, terminé ou déjà rappelé est ignoré ; le rappel « veille » est sauté si le rappel d'1 h est déjà dû ou parti.
 */
export function dueReminders(a: ApptLike, now: Date, hasCustomerEmail: boolean, step = CRON_STEP_MIN): ReminderKind[] {
  if (!a.starts_at || !["planned", "confirmed"].includes(a.status)) return [];
  const out: ReminderKind[] = [];
  if (!a.reminder_hour_sent_at && inWindow(a.starts_at, hourWindow(now, step))) out.push("hour");
  if (!a.reminder_day_sent_at && !a.reminder_hour_sent_at && inWindow(a.starts_at, dayWindow(now, step))) out.push("day");
  if (hasCustomerEmail && !a.customer_reminder_sent_at && inWindow(a.starts_at, dayWindow(now, step))) out.push("customer");
  return out;
}

/** Anti-spam pour les mails de limite de places : au plus un par organisation et par période. */
export const seatMailDue = (lastSentAt: string | null, now: Date, days = 7): boolean => !lastSentAt || now.getTime() - new Date(lastSentAt).getTime() >= days * DAY;

/* ───────────── Relances d'onboarding (compte créé, parcours non terminé) ───────────── */

export type OnboardingReminder = 1 | 2;
/** Fenêtres d'âge du compte : relance 1 vers 24 h, relance 2 vers 72 h ; 24 h de rattrapage chacune, au-delà plus rien (jamais de relance tardive). */
export const ONBOARDING_REMINDER_WINDOWS: Record<OnboardingReminder, { fromH: number; toH: number }> = { 1: { fromH: 24, toH: 48 }, 2: { fromH: 72, toH: 96 } };

/** Bornes de `created_at` à interroger pour une relance : compte créé dans ]now - toH, now - fromH]. */
export function onboardingReminderWindow(now: Date, n: OnboardingReminder): Window {
  const w = ONBOARDING_REMINDER_WINDOWS[n];
  return { from: new Date(now.getTime() - w.toH * HOUR), to: new Date(now.getTime() - w.fromH * HOUR) };
}

export interface OnboardingOrgLike { created_at: string; reminder1_sent_at: string | null; reminder2_sent_at: string | null; optout_at: string | null; stripe_subscription_id: string | null; plan: string | null; onboarded_at: string | null }

/**
 * Relance due pour une organisation, ou null. Au plus 2 relances par compte, jamais après désinscription,
 * jamais si le parcours est terminé (abonnement, essai démarré, onboarding validé) ; la relance 2 ne part pas si la 1 n'est pas partie à temps.
 */
export function dueOnboardingReminder(o: OnboardingOrgLike, now: Date): OnboardingReminder | null {
  if (o.optout_at || o.onboarded_at || o.stripe_subscription_id || (o.plan && o.plan !== "trial")) return null;
  if (!o.reminder1_sent_at && inWindow(o.created_at, onboardingReminderWindow(now, 1))) return 1;
  if (!o.reminder2_sent_at && inWindow(o.created_at, onboardingReminderWindow(now, 2))) return 2;
  return null;
}
