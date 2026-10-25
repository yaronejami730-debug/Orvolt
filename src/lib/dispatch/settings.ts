import { z } from "zod";

export const DEFAULT_WORK = { workStart: "09:00", workEnd: "19:00", targetPerDay: 4, comfortMax: 5, absoluteMax: 6, workDays: [1, 2, 3, 4, 5], durationMin: 60, travelMinPerKm: 1.2, travelMarginMin: 10 };
/** Règle de charge par défaut : norme 4 RDV/jour, 5e seulement si le détour est faible, 6e jamais automatique (migration 20260118). */
export const DEFAULT_ORG = { maxLegKm: 40, horizonDays: 7, maxLegMin: 45, maxBaseMin: 75, targetPerDay: 4, comfortMax: 5, absoluteMax: 6, maxExtraMin: 20 };

export const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide (HH:MM).");

export const workSettingsSchema = z
  .object({
    userId: z.uuid(),
    workStart: hhmm,
    workEnd: hhmm,
    // surcharges par commercial : vide = valeur de l'organisation
    targetPerDay: z.number().int().min(1, "Minimum 1.").max(10, "Maximum 10.").nullable(),
    comfortMax: z.number().int().min(1, "Minimum 1.").max(10, "Maximum 10.").nullable(),
    absoluteMax: z.number().int().min(1, "Minimum 1.").max(10, "Maximum 10.").nullable(),
    workDays: z.array(z.number().int().min(1).max(7)).min(1, "Choisissez au moins un jour.").max(7),
    durationMin: z.number().int().min(15, "Durée minimale : 15 min.").max(480, "Durée maximale : 8 h."),
    travelMinPerKm: z.number().min(0.1, "Minimum 0,1 min/km.").max(10),
    travelMarginMin: z.number().int().min(0).max(120),
  })
  .refine((v) => v.workEnd > v.workStart, { message: "La fin doit être après le début.", path: ["workEnd"] })
  .refine((v) => (v.targetPerDay ?? 1) <= (v.comfortMax ?? 10) && (v.comfortMax ?? 1) <= (v.absoluteMax ?? 10) && (v.targetPerDay ?? 1) <= (v.absoluteMax ?? 10), { message: "Il faut norme ≤ confort ≤ maximum.", path: ["comfortMax"] });

export const orgSettingsSchema = z.object({
  maxLegKm: z.number().min(1, "Minimum 1 km.").max(300, "Maximum 300 km."),
  horizonDays: z.number().int().min(1, "Minimum 1 jour.").max(30, "Maximum 30 jours."),
  maxLegMin: z.number().int().min(5, "Minimum 5 min.").max(300, "Maximum 300 min."),
  maxBaseMin: z.number().int().min(5, "Minimum 5 min.").max(480, "Maximum 480 min."),
  morningCoef: z.number().min(1, "Minimum 1.").max(3, "Maximum 3."),
  eveningCoef: z.number().min(1, "Minimum 1.").max(3, "Maximum 3."),
  safetyPct: z.number().int().min(0, "Minimum 0 %.").max(100, "Maximum 100 %."),
  targetPerDay: z.number().int().min(1, "Minimum 1.").max(10, "Maximum 10."),
  comfortMax: z.number().int().min(1, "Minimum 1.").max(10, "Maximum 10."),
  absoluteMax: z.number().int().min(1, "Minimum 1.").max(10, "Maximum 10."),
  maxExtraMin: z.number().int().min(0, "Minimum 0 min.").max(120, "Maximum 120 min."),
}).refine((v) => v.targetPerDay <= v.comfortMax && v.comfortMax <= v.absoluteMax, { message: "Il faut norme ≤ confort ≤ maximum.", path: ["comfortMax"] });

export const unavailabilitySchema = z
  .object({
    userId: z.uuid(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
    allDay: z.boolean(),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.allDay || (v.start && v.end && v.end > v.start), { message: "Créneau invalide : la fin doit suivre le début.", path: ["end"] });

export const editAppointmentSchema = z.object({ id: z.uuid(), userId: z.uuid(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), durationMin: z.number().int().min(15).max(480) });

export const applySchema = z.object({
  planHash: z.string().min(8).max(64),
  rebalance: z.boolean().optional(),
  /** Vue simulation : applique les RDV is_simulation (sans notification ni propriétaire de lead modifié). */
  simulation: z.boolean().optional(),
  /** RDV au-delà du confort approuvés un par un par le confirmateur (jamais automatique). */
  includeFifth: z.array(z.uuid()).max(50).optional(),
});
