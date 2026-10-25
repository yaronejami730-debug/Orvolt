import { z } from "zod";

export const APPT_STATUSES = ["planned", "confirmed", "done", "cancelled", "no_show"] as const;
export type ApptStatus = (typeof APPT_STATUSES)[number];

const isoDate = z.string().datetime({ offset: true, message: "Date invalide." });
const address = z.string().trim().min(3, "Adresse trop courte.").max(300, "Adresse trop longue.");

export const appointmentInputSchema = z.object({
  leadId: z.uuid(),
  assignedTo: z.uuid(),
  startsAt: isoDate,
  durationMin: z.number().int().min(15, "Durée minimale : 15 min.").max(480, "Durée maximale : 8 h."),
  location: address.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Dérogation hors zone : motif obligatoire. */
  overrideReason: z.string().trim().min(3, "Motif obligatoire (3 caractères minimum).").max(300).optional(),
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.");
/** RDV « à attribuer » saisi par un télépro : fenêtre de jours souhaitée + durée ; le confirmateur choisit commercial et heure. */
export const pendingInputSchema = z.object({
  leadId: z.uuid(),
  wishFrom: day,
  wishTo: day,
  durationMin: z.number().int().min(15, "Durée minimale : 15 min.").max(480, "Durée maximale : 8 h."),
  location: address,
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Position choisie sur une suggestion d'adresse ou un pin : revérifiée côté serveur (jamais crue sur parole). */
  point: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    precision: z.enum(["housenumber", "street", "locality", "municipality", "manual_pin", "manual_coords"]),
  }).optional(),
});
export const appointmentUpdateSchema = appointmentInputSchema.omit({ leadId: true }).extend({ id: z.uuid() });

export const previewSchema = z.object({
  leadId: z.uuid(),
  assignedTo: z.uuid(),
  address: z.string().trim().max(300).optional(),
  startsAt: isoDate.optional(),
  durationMin: z.number().int().min(15).max(480).optional(),
  excludeId: z.uuid().optional(),
});

export const apptStatusSchema = z.object({ id: z.uuid(), status: z.enum(APPT_STATUSES) });
export const rangeSchema = z
  .object({ from: isoDate, to: isoDate, userIds: z.array(z.uuid()).max(50).optional(), leadId: z.uuid().optional() })
  .refine((r) => new Date(r.to).getTime() - new Date(r.from).getTime() <= 45 * 86_400_000, { message: "Période trop longue.", path: ["to"] });

export const zoneSchema = z.object({
  userId: z.uuid(),
  baseAddress: address,
  radiusKm: z.number().min(5, "Rayon minimal : 5 km.").max(200, "Rayon maximal : 200 km."),
  active: z.boolean().default(true),
});

export const STATUS_LABEL: Record<ApptStatus, string> = {
  planned: "Planifié",
  confirmed: "Confirmé",
  done: "Réalisé",
  cancelled: "Annulé",
  no_show: "Absent",
};
export const STATUS_COLOR: Record<ApptStatus, string> = {
  planned: "#3b82f6",
  confirmed: "#22c55e",
  done: "#71717a",
  cancelled: "#ef4444",
  no_show: "#f97316",
};
