export const TEMPLATE_IDS = ["energie", "btp", "immobilier", "auto", "generic"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
