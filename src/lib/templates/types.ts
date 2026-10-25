import { z } from "zod";
import { TEMPLATE_IDS } from "./ids";
import { PALETTE_VALUES } from "@/lib/colors";

export const ROLE_NAMES = ["Super administrateur", "Administrateur", "Prospecteur", "Confirmateur", "Commercial"] as const;
export const roleNameSchema = z.enum(ROLE_NAMES);

export const FIELD_TYPES = ["text", "number", "date", "select", "file", "address"] as const;
export const STATUS_KINDS = ["normal", "won", "lost"] as const;
export const ACTION_TYPES = ["assign", "notify", "create_task", "webhook"] as const;

export const colorSchema = z.string().refine((c) => PALETTE_VALUES.includes(c), "Couleur invalide.");

/** Config d'une action automatique, utilisable dans un template (rôles par nom) ou en base (rôles par id). */
export const templateActionSchema = z.object({
  status: z.string(),
  type: z.enum(ACTION_TYPES),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().default(true),
});

export const templateSchema = z
  .object({
    id: z.enum(TEMPLATE_IDS),
    label: z.string().min(1),
    description: z.string().min(1),
    summary: z.string().min(1),
    statuses: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z_]+$/),
          name: z.string().min(1).max(40),
          color: colorSchema,
          kind: z.enum(STATUS_KINDS),
          initial: z.boolean().optional(),
        }),
      )
      .min(2),
    /** roles = "all" ou liste de noms de rôles (Super administrateur toujours autorisé par can_transition ; Administrateur ajouté automatiquement à l'application). */
    transitions: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        roles: z.union([z.literal("all"), z.array(roleNameSchema).min(1)]),
      }),
    ),
    actions: z.array(templateActionSchema),
    fields: z.array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
        label: z.string().min(1).max(60),
        type: z.enum(FIELD_TYPES),
        required: z.boolean().default(false),
        choices: z.array(z.string().min(1)).optional(),
        multiple: z.boolean().optional(),
      }),
    ),
    sources: z.array(z.object({ name: z.string().min(1).max(40), color: colorSchema.optional() })).min(1),
  })
  .superRefine((t, ctx) => {
    const keys = t.statuses.map((s) => s.key);
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(keys).size !== keys.length) issue("Clés de statut dupliquées.");
    if (new Set(t.statuses.map((s) => s.name)).size !== keys.length) issue("Noms de statut dupliqués.");
    if (t.statuses.filter((s) => s.initial).length !== 1) issue("Un seul statut initial requis.");
    const initial = t.statuses.find((s) => s.initial);
    if (initial && initial.kind !== "normal") issue("Le statut initial doit être normal.");
    if (!t.statuses.some((s) => s.kind === "won")) issue("Au moins un statut gagné.");
    if (!t.statuses.some((s) => s.kind === "lost")) issue("Au moins un statut perdu.");
    const byKey = new Map(t.statuses.map((s) => [s.key, s]));
    const seen = new Set<string>();
    for (const tr of t.transitions) {
      const from = byKey.get(tr.from);
      if (!from || !byKey.has(tr.to)) issue(`Transition inconnue ${tr.from} -> ${tr.to}.`);
      else if (from.kind !== "normal") issue(`Le statut final ${tr.from} ne peut pas avoir de transition sortante.`);
      if (tr.from === tr.to) issue("Transition vers soi-même.");
      const id = `${tr.from}>${tr.to}`;
      if (seen.has(id)) issue(`Transition dupliquée ${id}.`);
      seen.add(id);
    }
    for (const a of t.actions) if (!byKey.has(a.status)) issue(`Action sur un statut inconnu ${a.status}.`);
    const fkeys = t.fields.map((f) => f.key);
    if (new Set(fkeys).size !== fkeys.length) issue("Clés de champ dupliquées.");
    for (const f of t.fields) if (f.type === "select" && (f.choices?.length ?? 0) < 2) issue(`Le champ ${f.key} requiert 2 options.`);
    if (new Set(t.sources.map((s) => s.name)).size !== t.sources.length) issue("Sources dupliquées.");
  });

export type TemplateDefinition = z.infer<typeof templateSchema>;
export type TemplateInput = z.input<typeof templateSchema>;
