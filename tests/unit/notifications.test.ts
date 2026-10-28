import { describe, expect, it } from "vitest";
import { dayWindow, dueReminders, hourWindow, inWindow, seatMailDue, taskWindow, trialDaysLeft, trialEndingWindow, trialExpiredWindow, type ApptLike } from "@/lib/notifications/windows";
import { billingMailKind } from "@/lib/billing/mails";

const now = new Date("2026-03-10T10:00:00Z");
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
const appt = (min: number | null, over: Partial<ApptLike> = {}): ApptLike => ({ starts_at: min === null ? null : at(min), status: "planned", reminder_day_sent_at: null, reminder_hour_sent_at: null, customer_reminder_sent_at: null, ...over });

describe("fenêtres de rappel", () => {
  it("inWindow : ]from, to]", () => {
    const w = hourWindow(now);
    expect(inWindow(at(5), w)).toBe(false);
    expect(inWindow(at(6), w)).toBe(true);
    expect(inWindow(at(75), w)).toBe(true);
    expect(inWindow(at(76), w)).toBe(false);
    expect(inWindow(null, w)).toBe(false);
    expect(inWindow("pas une date", w)).toBe(false);
  });
  it("rappel d'1 h : dû entre 5 et 75 min avant, une seule fois", () => {
    expect(dueReminders(appt(70), now, false)).toEqual(["hour"]);
    expect(dueReminders(appt(70, { reminder_hour_sent_at: at(-1) }), now, false)).toEqual([]);
    expect(dueReminders(appt(3), now, false)).toEqual([]); // trop tard
    expect(dueReminders(appt(100), now, false)).toEqual([]); // ni veille ni 1 h : le prochain passage prendra le relais
  });
  it("rappel de la veille : dû entre 2 h et 24 h 15, plus le client si e-mail", () => {
    expect(dueReminders(appt(23 * 60), now, false)).toEqual(["day"]);
    expect(dueReminders(appt(23 * 60), now, true)).toEqual(["day", "customer"]);
    expect(dueReminders(appt(24 * 60 + 15), now, false)).toEqual(["day"]);
    expect(dueReminders(appt(24 * 60 + 16), now, false)).toEqual([]);
    expect(dueReminders(appt(23 * 60, { reminder_day_sent_at: at(-5), customer_reminder_sent_at: at(-5) }), now, true)).toEqual([]);
  });
  it("un RDV créé à moins de 2 h ne reçoit pas de « demain », seulement le rappel d'1 h", () => {
    expect(dueReminders(appt(60), now, true)).toEqual(["hour"]);
  });
  it("RDV annulé, terminé ou sans créneau : aucun rappel", () => {
    expect(dueReminders(appt(60, { status: "cancelled" }), now, true)).toEqual([]);
    expect(dueReminders(appt(60, { status: "done" }), now, true)).toEqual([]);
    expect(dueReminders(appt(null), now, true)).toEqual([]);
  });
  it("idempotence : le même état après envoi ne redéclenche rien", () => {
    const a = appt(23 * 60);
    const first = dueReminders(a, now, true);
    const after = { ...a, reminder_day_sent_at: first.includes("day") ? now.toISOString() : null, customer_reminder_sent_at: first.includes("customer") ? now.toISOString() : null };
    expect(dueReminders(after, new Date(now.getTime() + 15 * 60_000), true)).toEqual([]);
  });
  it("aucun trou avec un cron toutes les 15 min : chaque RDV de 24 h passe dans au moins une fenêtre", () => {
    for (let m = 135; m <= 24 * 60; m++) {
      const hit = [0, 15, 30].some((run) => inWindow(at(m), dayWindow(new Date(now.getTime() + run * 60_000))));
      expect(hit).toBe(true);
    }
  });
  it("tâches : échues depuis moins de 24 h seulement", () => {
    const w = taskWindow(now);
    expect(inWindow(at(-1), w)).toBe(true);
    expect(inWindow(at(0), w)).toBe(true);
    expect(inWindow(at(1), w)).toBe(false);
    expect(inWindow(at(-24 * 60 - 1), w)).toBe(false);
  });
  it("essai : fin dans 3 jours, expiré depuis moins de 7 jours", () => {
    expect(inWindow(at(2 * 24 * 60), trialEndingWindow(now))).toBe(true);
    expect(inWindow(at(4 * 24 * 60), trialEndingWindow(now))).toBe(false);
    expect(inWindow(at(-60), trialEndingWindow(now))).toBe(false);
    expect(inWindow(at(-60), trialExpiredWindow(now))).toBe(true);
    expect(inWindow(at(-8 * 24 * 60), trialExpiredWindow(now))).toBe(false);
    expect(trialDaysLeft(at(2 * 24 * 60 + 5), now)).toBe(3);
    expect(trialDaysLeft(at(30), now)).toBe(1);
  });
  it("places : au plus un mail par semaine", () => {
    expect(seatMailDue(null, now)).toBe(true);
    expect(seatMailDue(at(-3 * 24 * 60), now)).toBe(false);
    expect(seatMailDue(at(-8 * 24 * 60), now)).toBe(true);
  });
});

describe("mails d'abonnement Stripe", () => {
  const b = (subscription_status: string, cancel_at_period_end = false) => ({ subscription_status, cancel_at_period_end });
  it("échec de paiement : seulement le premier (pas de re-mail à chaque relance)", () => {
    expect(billingMailKind({ kind: "payment_failed" }, b("active"), null)).toBe("payment_failed");
    expect(billingMailKind({ kind: "payment_failed" }, b("past_due"), null)).toBeNull();
  });
  it("fin d'essai Stripe", () => expect(billingMailKind({ kind: "trial_will_end" }, b("trialing"), null)).toBe("trial_ending"));
  it("abonnement actif : essai -> actif oui, actif -> actif non, reprise après impayé non", () => {
    expect(billingMailKind({ kind: "subscription" }, b("trialing"), { subscription_status: "active" })).toBe("subscription_active");
    expect(billingMailKind({ kind: "subscription" }, b("active"), { subscription_status: "active" })).toBeNull();
    expect(billingMailKind({ kind: "subscription" }, b("past_due"), { subscription_status: "active" })).toBeNull();
  });
  it("résiliation : suppression ou demande de fin de période (une seule fois)", () => {
    expect(billingMailKind({ kind: "deleted" }, b("active"), null)).toBe("subscription_canceled");
    expect(billingMailKind({ kind: "deleted" }, b("canceled"), null)).toBeNull();
    expect(billingMailKind({ kind: "subscription" }, b("active"), { subscription_status: "active", cancel_at_period_end: true })).toBe("subscription_canceled");
    expect(billingMailKind({ kind: "subscription" }, b("active", true), { subscription_status: "active", cancel_at_period_end: true })).toBeNull();
  });
});
