import { z } from "zod";
import { colorSchema, FIELD_TYPES, STATUS_KINDS } from "@/lib/templates/types";

const msg = z.string().trim().min(1, "Message requis.").max(300);

export const assignConfigSchema = z
  .object({ mode: z.enum(["user", "role"]), userId: z.uuid().optional(), roleId: z.uuid().optional() })
  .refine((c) => (c.mode === "user" ? !!c.userId : !!c.roleId), "Choisissez un utilisateur ou un rôle.");

export const notifyConfigSchema = z
  .object({
    recipient: z.enum(["assignee", "role", "user"]),
    userId: z.uuid().optional(),
    roleId: z.uuid().optional(),
    message: msg,
  })
  .refine((c) => c.recipient !== "role" || !!c.roleId, "Choisissez un rôle.")
  .refine((c) => c.recipient !== "user" || !!c.userId, "Choisissez un utilisateur.");

export const taskConfigSchema = z
  .object({
    title: z.string().trim().min(1, "Titre requis.").max(120),
    delay: z.number().int().min(0).max(365),
    unit: z.enum(["hours", "days"]),
    assignee: z.enum(["assignee", "user"]),
    userId: z.uuid().optional(),
  })
  .refine((c) => c.assignee !== "user" || !!c.userId, "Choisissez un utilisateur.");

export { isForbiddenHost } from "@/lib/net/ip";
import { isForbiddenHost } from "@/lib/net/ip";

export const webhookUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" && !url.username && !url.password && !isForbiddenHost(url.hostname);
    } catch {
      return false;
    }
  }, "URL https publique requise.");
export const webhookConfigSchema = z.object({ url: webhookUrlSchema });

export const actionInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assign"), enabled: z.boolean(), config: assignConfigSchema }),
  z.object({ type: z.literal("notify"), enabled: z.boolean(), config: notifyConfigSchema }),
  z.object({ type: z.literal("create_task"), enabled: z.boolean(), config: taskConfigSchema }),
  z.object({ type: z.literal("webhook"), enabled: z.boolean(), config: webhookConfigSchema }),
]);
export type ActionInput = z.infer<typeof actionInputSchema>;

export const saveActionsSchema = z.object({ statusId: z.uuid(), actions: z.array(actionInputSchema).max(10) });

const statusName = z.string().trim().min(1, "Nom requis.").max(40, "Nom trop long.");
export const createStatusSchema = z.object({ name: statusName, color: colorSchema, kind: z.enum(STATUS_KINDS) });
export const updateStatusSchema = createStatusSchema.extend({ id: z.uuid() });
export const deleteStatusSchema = z.object({ id: z.uuid(), replacementId: z.uuid().nullable().optional() });
export const reorderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) });
export const idSchema = z.object({ id: z.uuid() });
export const setInitialSchema = z.object({ id: z.uuid() });
export const saveTransitionsSchema = z.object({
  fromId: z.uuid(),
  targets: z
    .array(z.object({ toId: z.uuid(), roles: z.union([z.literal("all"), z.array(z.uuid()).min(1).max(20)]) }))
    .max(100),
});

export const saveGrantsSchema = z.object({
  grants: z
    .array(z.object({ statusId: z.uuid(), roleId: z.uuid(), place: z.boolean(), create: z.boolean() }))
    .max(1000),
});

export const choicesSchema = z.array(z.string().trim().min(1).max(60)).min(2, "Au moins 2 options.").max(30);
export const fieldInputSchema = z
  .object({
    id: z.uuid().optional(),
    label: z.string().trim().min(1, "Nom requis.").max(60, "Nom trop long."),
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    choices: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    multiple: z.boolean().optional(),
    min: z.number().finite().min(-1e12).max(1e12).optional(),
    max: z.number().finite().min(-1e12).max(1e12).optional(),
    visibleRoles: z.array(z.uuid()).max(20).nullable(),
    editableRoles: z.array(z.uuid()).max(20).nullable(),
  })
  .superRefine((f, ctx) => {
    if (f.type === "number" && f.min !== undefined && f.max !== undefined && f.min > f.max)
      ctx.addIssue({ code: "custom", path: ["min"], message: "Le minimum dépasse le maximum." });
    if (f.type === "select") {
      const r = choicesSchema.safeParse(f.choices ?? []);
      if (!r.success) ctx.addIssue({ code: "custom", path: ["choices"], message: r.error.issues[0]!.message });
      else if (new Set(r.data.map((c) => c.toLowerCase())).size !== r.data.length)
        ctx.addIssue({ code: "custom", path: ["choices"], message: "Options en doublon." });
    }
  });

export const sourceInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Nom requis.").max(40, "Nom trop long."),
  color: colorSchema.nullable().optional(),
});
export const archiveSourceSchema = z.object({ id: z.uuid(), archived: z.boolean() });

export const resetTemplateSchema = z.object({ template: z.enum(["energie", "btp", "immobilier", "auto", "generic"]) });

/** Slug technique d'une clé de champ à partir de son libellé. */
export function slugifyKey(label: string): string {
  const base = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `champ_${base}`.slice(0, 40);
}
