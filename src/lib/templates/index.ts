import { artisanBtp } from "./artisan-btp";
import { automobile } from "./automobile";
import { energies } from "./energies";
import { generique } from "./generique";
import { immobilier } from "./immobilier";
import { TEMPLATE_IDS, type TemplateId } from "./ids";
import { templateSchema, type TemplateDefinition } from "./types";

export { TEMPLATE_IDS, type TemplateId };
export { templateSchema, type TemplateDefinition } from "./types";

const RAW = [energies, artisanBtp, immobilier, automobile, generique];

/** Templates validés au chargement (Zod). */
export const TEMPLATE_DEFS: TemplateDefinition[] = RAW.map((t) => templateSchema.parse(t));

/** Modèles proposés à l'inscription et dans les réglages. Les autres restent définis (réactivables en les ajoutant ici), mais ne sont plus offerts pour l'instant. */
export const ENABLED_TEMPLATE_IDS = ["energie"] as const satisfies readonly TemplateId[];

export const TEMPLATES: { id: TemplateId; label: string; description: string }[] = TEMPLATE_DEFS.map(
  ({ id, label, description }) => ({ id, label, description }),
);

export const AVAILABLE_TEMPLATES = TEMPLATES.filter((t) => (ENABLED_TEMPLATE_IDS as readonly string[]).includes(t.id));

export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATE_DEFS.find((t) => t.id === id);
}
