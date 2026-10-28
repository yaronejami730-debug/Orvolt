import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { lookupSiret } = await import("@/lib/siret-lookup");

const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
const SIRET = "55203253400646";

describe("reconnaissance d'entreprise par SIRET", () => {
  it("trouve l'entreprise et son adresse", async () => {
    const r = await lookupSiret(SIRET, reply({ results: [{ nom_complet: "DANONE", etat_administratif: "A", siege: { siret: "55203253400703" }, matching_etablissements: [{ siret: SIRET, adresse: "17 BD HAUSSMANN 75009 PARIS" }] }] }));
    expect(r).toEqual({
      status: "found", name: "DANONE", address: "17 BD HAUSSMANN 75009 PARIS", active: true,
      addressLine: null, postalCode: null, city: null, legalForm: null, legalFormCode: null, nafCode: null, nafLabel: null, createdAt: null, leader: null,
    });
  });
  it("société : adresse découpée, forme juridique, NAF, création, dirigeant personne physique (pas la personne morale)", async () => {
    const r = await lookupSiret(SIRET, reply({ results: [{
      nom_complet: "ACME SAS", nature_juridique: "5710", activite_principale: "43.21A", date_creation: "2015-03-02", etat_administratif: "A",
      dirigeants: [{ type_dirigeant: "personne morale", denomination: "HOLDING SA", siren: "123456789" }, { type_dirigeant: "personne physique", nom: "DUPONT-MARTIN", prenoms: "Jean-Luc, Pierre", qualite: "Président" }],
      siege: { siret: SIRET, adresse: "12 RUE DES LILAS 69003 LYON", numero_voie: "12", type_voie: "RUE", libelle_voie: "DES LILAS", code_postal: "69003", libelle_commune: "LYON", activite_principale: "43.21A", etat_administratif: "A" },
    }] }));
    expect(r).toMatchObject({ status: "found", addressLine: "12 RUE DES LILAS", postalCode: "69003", city: "LYON", legalForm: "SAS", legalFormCode: "5710", nafCode: "43.21A", nafLabel: null, createdAt: "2015-03-02", leader: { firstName: "Jean-Luc", lastName: "Dupont-Martin" } });
  });
  it("dirigeant uniquement personne morale : aucun dirigeant", async () => {
    const r = await lookupSiret(SIRET, reply({ results: [{ nom_complet: "FILIALE SAS", dirigeants: [{ type_dirigeant: "personne morale", denomination: "HOLDING SA" }], siege: { siret: SIRET } }] }));
    expect(r).toMatchObject({ status: "found", leader: null });
  });
  it("entreprise individuelle : forme et dirigeant reconnus, code juridique inconnu gardé seul", async () => {
    const ei = await lookupSiret(SIRET, reply({ results: [{ nom_complet: "Marie Durand", nature_juridique: "1000", dirigeants: [{ type_dirigeant: "personne physique", nom: "Durand", prenoms: "Marie" }], siege: { siret: SIRET, code_postal: "33000", libelle_commune: "BORDEAUX" } }] }));
    expect(ei).toMatchObject({ legalForm: "Entrepreneur individuel", leader: { firstName: "Marie", lastName: "Durand" }, postalCode: "33000", city: "BORDEAUX" });
    const autre = await lookupSiret(SIRET, reply({ results: [{ nom_complet: "X", nature_juridique: "7383", siege: { siret: SIRET } }] }));
    expect(autre).toMatchObject({ legalForm: null, legalFormCode: "7383" });
  });
  it("valeurs douteuses assainies : balises retirées, format et longueur contrôlés", async () => {
    const r = await lookupSiret(SIRET, reply({ results: [{ nom_complet: "<b>EVIL</b> " + "x".repeat(500), nature_juridique: "abc", date_creation: "hier", siege: { siret: SIRET, code_postal: "7500", activite_principale: "zz", libelle_commune: "PARIS\u0000" }, dirigeants: [{ type_dirigeant: "personne physique", nom: "<i>", prenoms: "" }] }] }));
    expect(r.status === "found" && r.name.length <= 200 && !/[<>]/.test(r.name)).toBe(true);
    expect(r).toMatchObject({ legalFormCode: null, createdAt: null, postalCode: null, nafCode: null, city: "PARIS", leader: null });
  });
  it("numéro inconnu, ou résultat qui ne porte pas ce SIRET : non reconnu (saisie manuelle)", async () => {
    expect(await lookupSiret(SIRET, reply({ results: [] }))).toEqual({ status: "not_found" });
    expect(await lookupSiret(SIRET, reply({ results: [{ nom_complet: "AUTRE SA", siege: { siret: "11111111111111" }, matching_etablissements: [] }] }))).toEqual({ status: "not_found" });
  });
  it("API en erreur ou injoignable : indisponible (saisie manuelle, jamais bloquant)", async () => {
    expect(await lookupSiret(SIRET, reply({}, false))).toEqual({ status: "unavailable" });
    expect(await lookupSiret(SIRET, (async () => { throw new Error("réseau"); }) as unknown as typeof fetch)).toEqual({ status: "unavailable" });
  });
  it("entreprise cessée : signalée", async () => {
    const r = await lookupSiret(SIRET, reply({ results: [{ nom_complet: "ANCIENNE SA", etat_administratif: "C", siege: { siret: SIRET } }] }));
    expect(r).toMatchObject({ status: "found", active: false });
    // établissement fermé dans une société encore active
    const f = await lookupSiret(SIRET, reply({ results: [{ nom_complet: "SOC SA", etat_administratif: "A", siege: { siret: "11111111111111" }, matching_etablissements: [{ siret: SIRET, etat_administratif: "F" }] }] }));
    expect(f).toMatchObject({ status: "found", active: false });
  });
});
