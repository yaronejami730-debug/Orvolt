import type { TemplateInput } from "./types";

export const immobilier: TemplateInput = {
  id: "immobilier",
  label: "Immobilier",
  description: "Acquéreurs, vendeurs, visites",
  summary: "Un parcours acquéreur/vendeur de la qualification au compromis.",
  statuses: [
    { key: "nouveau", name: "Nouveau contact", color: "#3b82f6", kind: "normal", initial: true },
    { key: "qualifie", name: "Projet qualifié", color: "#6366f1", kind: "normal" },
    { key: "visite", name: "Visite programmée", color: "#f59e0b", kind: "normal" },
    { key: "offre", name: "Offre en cours", color: "#f97316", kind: "normal" },
    { key: "compromis", name: "Compromis signé", color: "#22c55e", kind: "won" },
    { key: "abandonne", name: "Abandonné", color: "#ef4444", kind: "lost" },
  ],
  transitions: [
    { from: "nouveau", to: "qualifie", roles: "all" },
    { from: "qualifie", to: "visite", roles: "all" },
    { from: "qualifie", to: "abandonne", roles: "all" },
    { from: "visite", to: "offre", roles: ["Commercial", "Confirmateur"] },
    { from: "visite", to: "abandonne", roles: "all" },
    { from: "offre", to: "compromis", roles: ["Commercial"] },
    { from: "offre", to: "abandonne", roles: ["Commercial", "Confirmateur"] },
  ],
  actions: [
    { status: "nouveau", type: "notify", config: { recipient: "role", roleName: "Confirmateur", message: "Nouveau lead à qualifier." }, enabled: true },
    { status: "visite", type: "create_task", config: { title: "Envoyer le rappel de visite", delay: 1, unit: "days", assignee: "assignee" }, enabled: true },
  ],
  fields: [
    { key: "projet", label: "Projet", type: "select", required: true, choices: ["Achat", "Vente", "Location"] },
    { key: "budget", label: "Budget (€)", type: "number", required: false },
    { key: "surface_m2", label: "Surface recherchée (m²)", type: "number", required: false },
    { key: "localisation", label: "Localisation souhaitée", type: "address", required: false },
    { key: "delai", label: "Échéance du projet", type: "date", required: false },
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
