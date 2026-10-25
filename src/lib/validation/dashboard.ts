import { z } from "zod";

export const dashParamsSchema = z.object({
  preset: z.enum(["7d", "30d", "90d", "month", "custom"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.uuid().nullable().optional(),
  user: z.uuid().nullable().optional(),
});
export type DashParams = z.infer<typeof dashParamsSchema>;
