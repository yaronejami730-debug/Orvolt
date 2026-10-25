import type { TemplateInput } from "./types";

export const generique: TemplateInput = {
  id: "generic",
  label: "Générique",
  description: "Un pipeline simple pour tout métier",
  summary: "Un pipeline simple en quatre étapes, à adapter ensuite à votre activité.",
  statuses: [
    { key: "nouveau", name: "Nouveau", color: "#3b82f6", kind: "normal", initial: true },
    { key: "en_cours", name: "En cours", color: "#f59e0b", kind: "normal" },
    { key: "gagne", name: "Gagné", color: "#22c55e", kind: "won" },
    { key: "perdu", name: "Perdu", color: "#ef4444", kind: "lost" },
  ],
  transitions: [
    { from: "nouveau", to: "en_cours", roles: "all" },
    { from: "nouveau", to: "perdu", roles: "all" },
    { from: "en_cours", to: "gagne", roles: "all" },
    { from: "en_cours", to: "perdu", roles: "all" },
  ],
  actions: [
    { status: "nouveau", type: "notify", config: { recipient: "role", roleName: "Super administrateur", message: "Nouveau lead reçu." }, enabled: true },
  ],
  fields: [
    { key: "entreprise", label: "Entreprise", type: "text", required: false },
    { key: "notes_internes", label: "Informations complémentaires", type: "text", required: false },
  ],
  sources: [
    { name: "Meta Ads", color: "#3b82f6" },
    { name: "Google Ads", color: "#ef4444" },
    { name: "Site web", color: "#14b8a6" },
    { name: "Parrainage", color: "#a855f7" },
    { name: "Salon", color: "#f59e0b" },
    { name: "Autre", color: "#71717a" },
  ],
};
