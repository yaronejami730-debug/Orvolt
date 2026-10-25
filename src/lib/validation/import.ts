import { z } from "zod";
import { mappingSchema } from "@/lib/import/mapping";

export const importOptionsSchema = z.object({
  duplicateMode: z.enum(["skip", "update", "create"]),
  duplicateBy: z.enum(["email", "phone", "either"]),
  sourceId: z.uuid().nullable(),
  fieldDefaults: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), z.string().max(200)).optional(),
  assign: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }),
    z.object({ mode: z.literal("user"), userId: z.uuid() }),
    z.object({ mode: z.literal("role"), roleId: z.uuid() }),
  ]),
});
export const dryRunSchema = z.object({ jobId: z.uuid(), mapping: mappingSchema, options: importOptionsSchema });
export const jobIdSchema = z.object({ jobId: z.uuid() });
export type ImportOptionsInput = z.infer<typeof importOptionsSchema>;
