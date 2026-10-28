/**
 * Informations légales de l'éditeur : SOURCE UNIQUE des pages mentions légales, confidentialité et CGV.
 * À renseigner par le propriétaire du site (aucune valeur n'est inventée : null = non renseigné).
 * Un champ vide s'affiche comme « non renseigné » en production ; en développement, un bandeau liste les champs manquants.
 * Contrôle avant mise en ligne : `npm run legal:check` échoue tant qu'un champ est vide.
 */
export interface LegalInfo {
  raisonSociale: string | null;
  formeJuridique: string | null;
  /** Capital social en euros (ex. « 10 000 »). */
  capital: string | null;
  rcsVille: string | null;
  rcsNumero: string | null;
  siret: string | null;
  siege: string | null;
  directeurPublication: string | null;
  hebergeurNom: string | null;
  hebergeurAdresse: string | null;
  emailContact: string | null;
  /** Contact du délégué à la protection des données (ou de la personne chargée des demandes RGPD). */
  dpoContact: string | null;
  /** Durée de conservation des journaux techniques (ex. « 12 mois »). */
  dureeJournaux: string | null;
  /** Délai de suppression des données après clôture du compte (ex. « 30 jours »). */
  delaiSuppression: string | null;
  /** Prix affichés « HT » ou « TTC ». */
  regimePrix: "HT" | "TTC" | null;
  /** Texte juridique : responsabilité, disponibilité du service, droit applicable et tribunal compétent. */
  clauseResponsabilite: string | null;
}

export const LEGAL: LegalInfo = {
  raisonSociale: null,
  formeJuridique: null,
  capital: null,
  rcsVille: null,
  rcsNumero: null,
  siret: null,
  siege: null,
  directeurPublication: null,
  hebergeurNom: null,
  hebergeurAdresse: null,
  emailContact: null,
  dpoContact: null,
  dureeJournaux: null,
  delaiSuppression: null,
  regimePrix: null,
  clauseResponsabilite: null,
};

export const LEGAL_LABELS: Record<keyof LegalInfo, string> = {
  raisonSociale: "Raison sociale",
  formeJuridique: "Forme juridique",
  capital: "Capital social",
  rcsVille: "Ville du RCS",
  rcsNumero: "Numéro RCS",
  siret: "SIRET",
  siege: "Adresse du siège",
  directeurPublication: "Directeur de la publication",
  hebergeurNom: "Hébergeur (nom)",
  hebergeurAdresse: "Hébergeur (adresse)",
  emailContact: "E-mail de contact",
  dpoContact: "Contact DPO / RGPD",
  dureeJournaux: "Durée de conservation des journaux",
  delaiSuppression: "Délai de suppression après clôture",
  regimePrix: "Prix HT ou TTC",
  clauseResponsabilite: "Clause de responsabilité et droit applicable",
};

export const NOT_PROVIDED = "non renseigné";

const filled = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

/** Valeur d'un champ, ou null s'il est vide. */
export const legalValue = (key: keyof LegalInfo, info: LegalInfo = LEGAL): string | null => (filled(info[key]) ? info[key]!.trim() : null);

/** Valeur à afficher : la donnée, ou une mention neutre (jamais de crochets bruts). */
export const legalText = (key: keyof LegalInfo, info: LegalInfo = LEGAL): string => legalValue(key, info) ?? NOT_PROVIDED;

/** Clés des champs non renseignés. */
export function missingLegalFields(info: LegalInfo = LEGAL): (keyof LegalInfo)[] {
  return (Object.keys(LEGAL_LABELS) as (keyof LegalInfo)[]).filter((k) => !filled(info[k]));
}
