import { z } from "zod";
import { INBOUND_KINDS, mappingConfigSchema } from "@/lib/inbound/adapters";

export const endpointCreateSchema = z.object({
  name: z.string().trim().min(1, "Nom requis.").max(80, "Nom trop long."),
  kind: z.enum(INBOUND_KINDS),
  defaultSourceId: z.uuid().nullable().optional(),
  mapping: mappingConfigSchema.optional(),
  dedupeWindowHours: z.number().int().min(0).max(8760).default(72),
});
export const endpointUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Nom requis.").max(80),
  defaultSourceId: z.uuid().nullable(),
  mapping: mappingConfigSchema,
  dedupeWindowHours: z.number().int().min(0).max(8760),
  active: z.boolean(),
  /** Secret d'application Meta (X-Hub-Signature-256) : vide = retirer, absent = inchangé. */
  metaAppSecret: z.string().max(200, "Secret trop long.").optional(),
});
export const endpointIdSchema = z.object({ id: z.uuid() });
