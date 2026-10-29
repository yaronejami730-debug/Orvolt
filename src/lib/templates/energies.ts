import type { TemplateInput } from "./types";

export const energies: TemplateInput = {
  id: "energie",
  label: "Énergies",
  description: "Solaire, pompe à chaleur, isolation",
  summary: "Un pipeline du rendez-vous à la pose, en passant par le devis, avec les champs clés du logement (chauffage, surface, DPE).",
  statuses: [
    { key: "nouveau", name: "Nouveau", color: "#3b82f6", kind: "normal", initial: true },
    { key: "a_qualifier", name: "À qualifier", color: "#6366f1", kind: "normal" },
    { key: "qualifie", name: "Qualifié", color: "#a855f7", kind: "normal" },
    { key: "rdv_pris", name: "RDV pris", color: "#f59e0b", kind: "normal" },
    { key: "devis_envoye", name: "Devis envoyé", color: "#f97316", kind: "normal" },
    { key: "signe", name: "Signé", color: "#22c55e", kind: "won" },
    { key: "perdu", name: "Perdu", color: "#ef4444", kind: "lost" },
  ],
  transitions: [
    { from: "nouveau", to: "a_qualifier", roles: "all" },
    { from: "a_qualifier", to: "qualifie", roles: ["Confirmateur", "Commercial"] },
    { from: "a_qualifier", to: "perdu", roles: ["Confirmateur"] },
    { from: "qualifie", to: "rdv_pris", roles: ["Confirmateur", "Commercial"] },
    { from: "qualifie", to: "perdu", roles: ["Confirmateur"] },
    { from: "rdv_pris", to: "devis_envoye", roles: ["Commercial"] },
    { from: "rdv_pris", to: "perdu", roles: ["Commercial", "Confirmateur"] },
    { from: "devis_envoye", to: "signe", roles: ["Commercial"] },
    { from: "devis_envoye", to: "perdu", roles: ["Commercial"] },
  ],
  actions: [
    { status: "nouveau", type: "notify", config: { recipient: "role", roleName: "Confirmateur", message: "Nouveau lead à qualifier." }, enabled: true },
    { status: "rdv_pris", type: "create_task", config: { title: "Préparer le rendez-vous", delay: 1, unit: "days", assignee: "assignee" }, enabled: true },
    { status: "signe", type: "notify", config: { recipient: "role", roleName: "Super administrateur", message: "Un dossier vient d'être signé." }, enabled: true },
  ],
  fields: [
    { key: "type_chauffage", label: "Type de chauffage", type: "select", required: true, choices: ["Électrique", "Gaz", "Fioul", "Bois", "Pompe à chaleur"] },
    { key: "surface_m2", label: "Surface habitable (m²)", type: "number", required: true },
    { key: "facture_energie", label: "Facture d'énergie mensuelle (€)", type: "number", required: false },
    { key: "statut_occupant", label: "Propriétaire ou locataire", type: "select", required: true, choices: ["Propriétaire", "Locataire"] },
    { key: "dpe", label: "Classe DPE", type: "select", required: false, choices: ["A", "B", "C", "D", "E", "F", "G"] },
    { key: "adresse_chantier", label: "Adresse du logement", type: "address", required: false },
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
