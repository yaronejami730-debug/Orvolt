import type { TemplateInput } from "./types";

export const artisanBtp: TemplateInput = {
  id: "btp",
  label: "Artisan BTP",
  description: "Devis, chantiers, rendez-vous",
  summary: "Du premier contact au devis accepté, avec les informations de chantier utiles aux artisans.",
  statuses: [
    { key: "nouveau", name: "Nouvelle demande", color: "#3b82f6", kind: "normal", initial: true },
    { key: "contacte", name: "Contacté", color: "#6366f1", kind: "normal" },
    { key: "visite", name: "Visite planifiée", color: "#f59e0b", kind: "normal" },
    { key: "devis", name: "Devis envoyé", color: "#f97316", kind: "normal" },
    { key: "accepte", name: "Devis accepté", color: "#22c55e", kind: "won" },
    { key: "refuse", name: "Refusé", color: "#ef4444", kind: "lost" },
  ],
  transitions: [
    { from: "nouveau", to: "contacte", roles: "all" },
    { from: "contacte", to: "visite", roles: "all" },
    { from: "contacte", to: "refuse", roles: "all" },
    { from: "visite", to: "devis", roles: ["Commercial", "Confirmateur"] },
    { from: "visite", to: "refuse", roles: "all" },
    { from: "devis", to: "accepte", roles: ["Commercial"] },
    { from: "devis", to: "refuse", roles: ["Commercial", "Confirmateur"] },
  ],
  actions: [
    { status: "nouveau", type: "notify", config: { recipient: "role", roleName: "Confirmateur", message: "Nouveau lead à qualifier." }, enabled: true },
    { status: "visite", type: "create_task", config: { title: "Prendre les mesures sur place", delay: 2, unit: "days", assignee: "assignee" }, enabled: true },
  ],
  fields: [
    { key: "type_travaux", label: "Type de travaux", type: "select", required: true, choices: ["Rénovation", "Toiture", "Plomberie", "Électricité", "Peinture", "Extension"] },
    { key: "budget", label: "Budget estimé (€)", type: "number", required: false },
    { key: "urgence", label: "Urgence", type: "select", required: true, choices: ["Faible", "Moyenne", "Élevée"] },
    { key: "photos", label: "Photos du chantier", type: "file", required: false },
    { key: "adresse_chantier", label: "Adresse du chantier", type: "address", required: false },
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
