import { describe, expect, it } from "vitest";
import { LEGAL, LEGAL_LABELS, NOT_PROVIDED, legalText, legalValue, missingLegalFields, type LegalInfo } from "@/lib/legal";

describe("informations légales", () => {
  it("chaque champ a un libellé et la liste des manquants couvre tout champ vide", () => {
    expect(Object.keys(LEGAL).sort()).toEqual(Object.keys(LEGAL_LABELS).sort());
    const empty = Object.fromEntries(Object.keys(LEGAL).map((k) => [k, null])) as unknown as LegalInfo;
    expect(missingLegalFields(empty)).toHaveLength(Object.keys(LEGAL).length);
  });
  it("valeur vide ou blanche : mention neutre sans crochets", () => {
    const info = { ...LEGAL, raisonSociale: "  ", siret: "123" };
    expect(legalValue("raisonSociale", info)).toBeNull();
    expect(legalText("raisonSociale", info)).toBe(NOT_PROVIDED);
    expect(legalText("raisonSociale", info)).not.toMatch(/[[\]]/);
    expect(legalText("siret", info)).toBe("123");
    expect(missingLegalFields(info)).not.toContain("siret");
  });
  // Garde-fou de mise en ligne : `npm run legal:check` (REQUIRE_LEGAL=1) échoue tant que src/lib/legal.ts est incomplet.
  it.runIf(process.env.REQUIRE_LEGAL === "1")("tous les champs légaux sont renseignés", () => {
    expect(missingLegalFields().map((k) => LEGAL_LABELS[k])).toEqual([]);
  });
});
