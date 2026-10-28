import "server-only";

export type CompanyInfo = {
  addressLine: string | null; postalCode: string | null; city: string | null;
  legalForm: string | null; legalFormCode: string | null;
  nafCode: string | null; nafLabel: string | null; createdAt: string | null;
  leader: { firstName: string; lastName: string } | null;
};
export type SiretLookup =
  | ({ status: "found"; name: string; address: string | null; active: boolean } & CompanyInfo)
  | { status: "not_found" }
  | { status: "unavailable" };

/** Libellés des formes juridiques courantes (l'API ne renvoie que le code INSEE) ; autre code : on garde le code seul. */
const LEGAL_FORMS: Record<string, string> = { "1000": "Entrepreneur individuel", "5410": "SARL unipersonnelle (EURL)", "5499": "SARL", "5599": "SA", "5710": "SAS", "5720": "SASU", "6540": "SCI", "9220": "Association déclarée" };

/** Chaîne assainie : sans balise ni caractère de contrôle, espaces normalisés, longueur bornée ; vide = null. */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return t || null;
}
/** « DUPONT-MARTIN » devient « Dupont-Martin » (seulement si tout est en majuscules). */
function nice(s: string): string {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : s;
}
const match = (v: unknown, re: RegExp, max: number) => { const t = clean(v, max); return t && re.test(t) ? t : null; };

type Etab = { siret?: string; adresse?: string; numero_voie?: string; indice_repetition?: string; type_voie?: string; libelle_voie?: string; code_postal?: string; libelle_commune?: string; activite_principale?: string; etat_administratif?: string };
type Dirigeant = { type_dirigeant?: string; nom?: string; prenoms?: string };

/**
 * Reconnaît une entreprise par son SIRET via l'API publique « Recherche d'entreprises » (data.gouv, sans clé).
 * « not_found » = numéro inconnu ; « unavailable » = API injoignable. Dans les deux cas l'inscription reste possible en saisie manuelle.
 * Tout champ absent de la réponse vaut null ; le dirigeant n'est retenu que s'il s'agit d'une personne physique.
 */
export async function lookupSiret(siret: string, fetcher: typeof fetch = fetch): Promise<SiretLookup> {
  try {
    const r = await fetcher(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(siret)}&per_page=1`, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    if (!r.ok) return { status: "unavailable" };
    const j = (await r.json()) as { results?: { nom_complet?: string; nom_raison_sociale?: string; nature_juridique?: string; activite_principale?: string; date_creation?: string; dirigeants?: Dirigeant[]; siege?: Etab; matching_etablissements?: Etab[]; etat_administratif?: string }[] };
    const e = j.results?.[0];
    if (!e) return { status: "not_found" };
    const etab: Etab | undefined = e.matching_etablissements?.find((x) => x.siret === siret) ?? (e.siege?.siret === siret ? e.siege : undefined);
    if (!etab) return { status: "not_found" };
    const name = clean(e.nom_complet ?? e.nom_raison_sociale, 200);
    if (!name) return { status: "not_found" };
    const street = clean([etab.numero_voie, etab.indice_repetition, etab.type_voie, etab.libelle_voie].filter((x) => typeof x === "string" && x.trim()).join(" "), 150);
    const code = match(e.nature_juridique, /^\d{4}$/, 4);
    const person = Array.isArray(e.dirigeants) ? e.dirigeants.find((d) => d?.type_dirigeant === "personne physique" && clean(d.nom, 80) && clean(d.prenoms, 120)) : undefined;
    const first = person ? clean(person.prenoms, 120)?.split(/[\s,]+/)[0] : undefined;
    const last = person ? clean(person.nom, 80) : null;
    return {
      status: "found", name, address: clean(etab.adresse, 250),
      active: (("etat_administratif" in etab ? etab.etat_administratif : undefined) ?? e.etat_administratif) !== "F" && e.etat_administratif !== "C",
      addressLine: street, postalCode: match(etab.code_postal, /^\d{5}$/, 5), city: clean(etab.libelle_commune, 100),
      legalForm: code ? (LEGAL_FORMS[code] ?? null) : null, legalFormCode: code,
      // L'API ne fournit que le code NAF (pas de libellé) : on ne devine pas.
      nafCode: match(etab.activite_principale ?? e.activite_principale, /^\d{2}\.\d{2}[A-Z]$/, 6), nafLabel: null,
      createdAt: match(e.date_creation, /^\d{4}-\d{2}-\d{2}$/, 10),
      leader: first && last ? { firstName: nice(first), lastName: nice(last) } : null,
    };
  } catch {
    return { status: "unavailable" };
  }
}
