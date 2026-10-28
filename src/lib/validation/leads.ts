import { z } from "zod";

const optText = (max: number) => z.string().trim().max(max, "Texte trop long.").optional().nullable();

export const leadCoreSchema = z.object({
  firstName: z.string().trim().max(80, "Prénom trop long.").optional(),
  lastName: z.string().trim().max(80, "Nom trop long.").optional(),
  company: optText(120),
  email: z.union([z.literal(""), z.email("E-mail invalide.").max(200)]).optional().nullable(),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+().\s-]*$/, "Téléphone invalide.")
    .optional()
    .nullable(),
  address: optText(300),
  city: optText(100),
  postalCode: optText(12),
  value: z.number("Valeur invalide.").min(0, "Valeur invalide.").max(1e9).optional().nullable(),
  sourceId: z.uuid().optional().nullable(),
  /** Domaine d'activité (pompe à chaleur, photovoltaïque…) : oriente le formulaire d'appel. */
  callDomainId: z.uuid().optional().nullable(),
  assignedTo: z.uuid().optional().nullable(),
  statusId: z.uuid().optional().nullable(),
});

export const createLeadSchema = leadCoreSchema
  .extend({ firstName: z.string().trim().max(80, "Prénom trop long.").default(""), lastName: z.string().trim().max(80, "Nom trop long.").default(""), custom: z.record(z.string(), z.unknown()).optional(), /** « Créer quand même » après l'avertissement de doublon. */ allowDuplicate: z.boolean().optional() })
  .refine((l) => !!(l.firstName || l.lastName || l.company), { message: "Indiquez au moins un nom ou une société.", path: ["lastName"] });

export const updateLeadSchema = z.object({
  id: z.uuid(),
  core: leadCoreSchema.omit({ statusId: true }).partial().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const moveLeadSchema = z.object({ leadId: z.uuid(), toStatusId: z.uuid(), position: z.number().finite().optional() });

export const SORT_COLUMNS = ["created_at", "last_name", "value", "status_id", "assigned_to", "updated_at"] as const;
export const listParamsSchema = z.object({
  statuses: z.array(z.uuid()).max(30).default([]),
  /** uuid de source ou "none" (sans source) */
  sources: z.array(z.union([z.uuid(), z.literal("none")])).max(30).default([]),
  /** uuid d'un membre ou "none" (non assigné) */
  assigned: z.array(z.union([z.uuid(), z.literal("none")])).max(30).default([]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
  custom: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), z.string().max(200)).default({}),
  sort: z.enum(SORT_COLUMNS).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10000).default(1),
  /** Curseur de pagination par clé (dernière ligne de la page précédente) ; absent = OFFSET. */
  cursor: z.object({ v: z.string().max(200), id: z.uuid() }).optional(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
});
export type ListParams = z.infer<typeof listParamsSchema>;

export const bulkSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) });
export const bulkAssignSchema = bulkSchema.extend({ assignedTo: z.uuid().nullable() });
export const bulkMoveSchema = bulkSchema.extend({ toStatusId: z.uuid() });

export const noteSchema = z.object({ leadId: z.uuid(), body: z.string().trim().min(1, "Note vide.").max(5000, "Note trop longue.") });
export const noteUpdateSchema = z.object({ id: z.uuid(), body: noteSchema.shape.body });
export const callSchema = z.object({
  leadId: z.uuid(),
  outcome: z.enum(["answered", "no_answer", "voicemail", "busy", "wrong_number", "callback"]),
  durationMinutes: z.number().int().min(0).max(600).default(0),
  notes: z.string().trim().max(2000).optional(),
});
export const idOnly = z.object({ id: z.uuid() });

export const FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Pièces jointes maximum par lead (miroir du trigger SQL lead_files_cap). */
export const MAX_FILES_PER_LEAD = 50;
export const FILE_MIME_TYPES: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
};
/** Valide taille, type MIME et extension (cohérents). */
export function validateUpload(name: string, size: number, mime: string): string | null {
  if (size <= 0) return "Fichier vide.";
  if (size > FILE_MAX_BYTES) return "Fichier trop volumineux (10 Mo maximum).";
  const exts = FILE_MIME_TYPES[mime];
  if (!exts) return "Type de fichier non autorisé (images, PDF, Word, Excel, CSV, texte).";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!exts.includes(ext)) return "L'extension ne correspond pas au type du fichier.";
  return null;
}
export function safeFileName(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return base || "fichier";
}

export const OUTCOME_LABEL: Record<string, string> = {
  answered: "Répondu",
  no_answer: "Pas de réponse",
  voicemail: "Messagerie",
  busy: "Occupé",
  wrong_number: "Mauvais numéro",
  callback: "À rappeler",
};
