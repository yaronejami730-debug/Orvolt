import { describe, expect, it } from "vitest";
import { scriptInputSchema, validateAnswers, visibleQuestions, type ScriptQuestion } from "@/lib/call-scripts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n: number, o: Partial<ScriptQuestion> = {}): ScriptQuestion => ({ id: id(n), label: `Q${n}`, help: null, type: "short_text", choices: [], required: false, showIf: null, ...o });

const script: ScriptQuestion[] = [
  q(1, { type: "yes_no", required: true, label: "Propriétaire ?" }),
  q(2, { type: "single", choices: ["Fioul", "Gaz", "Électrique"], showIf: { question: id(1), equals: "Oui" }, required: true, label: "Chauffage ?" }),
  q(3, { type: "number", showIf: { question: id(2), equals: "Fioul" }, label: "Consommation (L) ?" }),
  q(4, { type: "multi", choices: ["PAC", "Solaire"], label: "Intéressé par ?" }),
];

describe("trames d'appel : affichage conditionnel", () => {
  it("masque les questions dont la condition n'est pas remplie, en cascade", () => {
    expect(visibleQuestions(script, {}).map((x) => x.label)).toEqual(["Propriétaire ?", "Intéressé par ?"]);
    expect(visibleQuestions(script, { [id(1)]: "Oui" }).map((x) => x.label)).toEqual(["Propriétaire ?", "Chauffage ?", "Intéressé par ?"]);
    expect(visibleQuestions(script, { [id(1)]: "Oui", [id(2)]: "Fioul" }).map((x) => x.label)).toContain("Consommation (L) ?");
    // La réponse à Q2 ne compte plus si Q1 repasse à « Non » : Q3 reste masquée.
    expect(visibleQuestions(script, { [id(1)]: "Non", [id(2)]: "Fioul" }).map((x) => x.label)).toEqual(["Propriétaire ?", "Intéressé par ?"]);
  });
});

describe("trames d'appel : validation des réponses", () => {
  it("exige les questions obligatoires visibles seulement", () => {
    expect(validateAnswers(script, {}).errors).toEqual({ [id(1)]: "Réponse obligatoire." });
    expect(validateAnswers(script, { [id(1)]: "Oui" }).errors).toEqual({ [id(2)]: "Réponse obligatoire." });
    expect(validateAnswers(script, { [id(1)]: "Non" }).ok).toBe(true);
  });
  it("écarte les réponses aux questions masquées et nettoie les valeurs", () => {
    const r = validateAnswers(script, { [id(1)]: "Non", [id(2)]: "Gaz", [id(4)]: ["PAC"] });
    expect(r.ok).toBe(true);
    expect(r.clean.map((c) => c.label)).toEqual(["Propriétaire ?", "Intéressé par ?"]);
  });
  it("refuse une valeur hors des réponses préfaites, un nombre ou une date invalides", () => {
    expect(validateAnswers(script, { [id(1)]: "Oui", [id(2)]: "Charbon" }).errors[id(2)]).toBe("Choix invalide.");
    expect(validateAnswers(script, { [id(1)]: "Oui", [id(2)]: "Fioul", [id(3)]: "beaucoup" }).errors[id(3)]).toBe("Nombre invalide.");
    expect(validateAnswers(script, { [id(1)]: "Oui", [id(2)]: "Fioul", [id(3)]: "1200,5" }).clean.find((c) => c.question === id(3))?.value).toBe("1200.5");
    expect(validateAnswers(script, { [id(1)]: "Non", [id(4)]: ["PAC", "PAC"] }).errors[id(4)]).toBe("Choix invalide.");
    expect(validateAnswers([q(5, { type: "date" })], { [id(5)]: "31/12/2026" }).errors[id(5)]).toBe("Date invalide.");
  });
});

describe("trames d'appel : construction", () => {
  const base = { id: null, name: "Qualification PAC", description: "", active: true };
  const ok = (questions: unknown) => scriptInputSchema.safeParse({ ...base, questions });
  const wire = (x: ScriptQuestion) => ({ id: x.id, label: x.label, help: x.help, type: x.type, choices: x.choices, required: x.required, showIf: x.showIf });
  it("accepte une trame cohérente", () => expect(ok(script.map(wire)).success).toBe(true));
  it("refuse une condition vers une question plus bas, ou sans assez de réponses préfaites", () => {
    expect(ok([wire(q(1, { showIf: { question: id(2), equals: "Oui" } })), wire(q(2, { type: "yes_no" }))]).success).toBe(false);
    expect(ok([wire(q(1, { type: "single", choices: ["Un seul"] }))]).success).toBe(false);
    expect(ok([wire(q(1, { type: "single", choices: ["Gaz", "gaz"] }))]).success).toBe(false);
  });
});
