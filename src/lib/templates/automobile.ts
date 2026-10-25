import type { TemplateInput } from "./types";

export const automobile: TemplateInput = {
  id: "auto",
  label: "Automobile",
  description: "Essais, reprises, financements",
  summary: "Un pipeline orienté essai et proposition commerciale pour les concessions.",
  statuses: [
    { key: "nouveau", name: "Nouveau", color: "#3b82f6", kind: "normal", initial: true },
    { key: "contacte", name: "Contacté", color: "#6366f1", kind: "normal" },
    { key: "essai", name: "Essai programmé", color: "#f59e0b", kind: "normal" },
    { key: "proposition", name: "Proposition faite", color: "#f97316", kind: "normal" },
    { key: "vendu", name: "Vendu", color: "#22c55e", kind: "won" },
    { key: "perdu", name: "Perdu", color: "#ef4444", kind: "lost" },
  ],
  transitions: [
    { from: "nouveau", to: "contacte", roles: "all" },
    { from: "contacte", to: "essai", roles: "all" },
    { from: "contacte", to: "perdu", roles: "all" },
    { from: "essai", to: "proposition", roles: ["Commercial", "Confirmateur"] },
    { from: "essai", to: "perdu", roles: "all" },
    { from: "proposition", to: "vendu", roles: ["Commercial"] },
    { from: "proposition", to: "perdu", roles: ["Commercial", "Confirmateur"] },
  ],
  actions: [
    { status: "nouveau", type: "notify", config: { recipient: "role", roleName: "Confirmateur", message: "Nouveau lead à qualifier." }, enabled: true },
    { status: "essai", type: "create_task", config: { title: "Préparer le véhicule d'essai", delay: 4, unit: "hours", assignee: "assignee" }, enabled: true },
  ],
  fields: [
    { key: "marque_modele", label: "Marque et modèle", type: "text", required: true },
    { key: "budget", label: "Budget (€)", type: "number", required: false },
    { key: "reprise", label: "Véhicule à reprendre", type: "select", required: false, choices: ["Oui", "Non"] },
    { key: "financement", label: "Financement", type: "select", required: false, choices: ["Comptant", "Crédit", "LOA / LLD"] },
    { key: "date_essai", label: "Date souhaitée d'essai", type: "date", required: false },
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
