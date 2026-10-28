import { z } from "zod";

/** Trames d'appel : formulaires de questions que le téléprospecteur suit pendant l'appel. Logique pure, partagée écran et serveur. */
export const QUESTION_TYPES = ["short_text", "long_text", "number", "yes_no", "single", "multi", "date"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Réponse courte",
  long_text: "Réponse longue",
  number: "Nombre",
  yes_no: "Oui / Non",
  single: "Choix unique",
  multi: "Choix multiples",
  date: "Date",
};
export const YES_NO = ["Oui", "Non"] as const;
export const hasChoices = (t: QuestionType) => t === "single" || t === "multi";

export interface ScriptQuestion {
  id: string;
  label: string;
  help: string | null;
  type: QuestionType;
  /** Réponses préfaites (choix unique / multiples). */
  choices: string[];
  required: boolean;
  /** Affichée seulement si la réponse à `question` (plus haut dans la trame) vaut `equals`. */
  showIf: { question: string; equals: string } | null;
}

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue | undefined>;
export interface CleanAnswer { question: string; label: string; value: AnswerValue }

const empty = (v: AnswerValue | undefined) => v === undefined || (typeof v === "string" ? v.trim() === "" : v.length === 0);
const matches = (v: AnswerValue | undefined, equals: string) => (Array.isArray(v) ? v.includes(equals) : v === equals);

/** Questions à afficher compte tenu des réponses : une condition ne compte que si la question visée est elle-même visible. */
export function visibleQuestions(questions: ScriptQuestion[], answers: Answers): ScriptQuestion[] {
  const shown = new Set<string>();
  const out: ScriptQuestion[] = [];
  for (const q of questions) {
    const ok = !q.showIf || (shown.has(q.showIf.question) && matches(answers[q.showIf.question], q.showIf.equals));
    if (ok) { shown.add(q.id); out.push(q); }
  }
  return out;
}

const MAX_TEXT = { short_text: 300, long_text: 2000 } as const;

/** Valide les réponses aux questions visibles ; ne garde que celles-ci (une réponse à une question masquée est écartée). */
export function validateAnswers(questions: ScriptQuestion[], answers: Answers): { ok: boolean; errors: Record<string, string>; clean: CleanAnswer[] } {
  const errors: Record<string, string> = {};
  const clean: CleanAnswer[] = [];
  for (const q of visibleQuestions(questions, answers)) {
    const raw = answers[q.id];
    if (empty(raw)) { if (q.required) errors[q.id] = "Réponse obligatoire."; continue; }
    let value: AnswerValue;
    switch (q.type) {
      case "short_text":
      case "long_text": {
        const t = String(raw).trim();
        if (Array.isArray(raw) || t.length > MAX_TEXT[q.type]) { errors[q.id] = `Réponse trop longue (${MAX_TEXT[q.type]} caractères maximum).`; continue; }
        value = t; break;
      }
      case "number": {
        const t = String(raw).trim().replace(",", ".");
        if (Array.isArray(raw) || !/^-?\d{1,12}(\.\d{1,4})?$/.test(t)) { errors[q.id] = "Nombre invalide."; continue; }
        value = t; break;
      }
      case "date": {
        const t = String(raw).trim();
        if (Array.isArray(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) { errors[q.id] = "Date invalide."; continue; }
        value = t; break;
      }
      case "yes_no":
        if (typeof raw !== "string" || !(YES_NO as readonly string[]).includes(raw)) { errors[q.id] = "Réponse invalide."; continue; }
        value = raw; break;
      case "single":
        if (typeof raw !== "string" || !q.choices.includes(raw)) { errors[q.id] = "Choix invalide."; continue; }
        value = raw; break;
      case "multi":
        if (!Array.isArray(raw) || raw.some((x) => !q.choices.includes(x)) || new Set(raw).size !== raw.length) { errors[q.id] = "Choix invalide."; continue; }
        value = raw; break;
    }
    clean.push({ question: q.id, label: q.label, value });
  }
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

/** Texte lisible d'une réponse (historique, résumé). */
export const formatAnswer = (v: AnswerValue): string => (Array.isArray(v) ? v.join(", ") : v);

// ---------------------------------------------------------------- construction (administrateur)
const text = (max: number) => z.string().trim().max(max);
const questionSchema = z.object({
  id: z.uuid(),
  label: text(200).min(1, "Une question ne peut pas être vide."),
  help: text(300).nullish().transform((v) => v || null),
  type: z.enum(QUESTION_TYPES),
  choices: z.array(text(80).min(1)).max(20, "20 réponses préfaites au maximum."),
  required: z.boolean(),
  showIf: z.object({ question: z.uuid(), equals: text(80).min(1) }).nullable(),
});

export const scriptInputSchema = z.object({
  id: z.uuid().nullable(),
  name: text(80).min(1, "Donnez un nom à la trame."),
  description: text(300).nullish().transform((v) => v || null),
  active: z.boolean(),
  questions: z.array(questionSchema).max(40, "40 questions au maximum."),
}).superRefine((s, ctx) => {
  const before = new Set<string>();
  s.questions.forEach((q, i) => {
    if (hasChoices(q.type) && new Set(q.choices.map((c) => c.toLowerCase())).size !== q.choices.length) ctx.addIssue({ code: "custom", path: ["questions", i, "choices"], message: "Deux réponses préfaites sont identiques." });
    if (hasChoices(q.type) && q.choices.length < 2) ctx.addIssue({ code: "custom", path: ["questions", i, "choices"], message: "Ajoutez au moins deux réponses préfaites." });
    if (before.has(q.id)) ctx.addIssue({ code: "custom", path: ["questions", i, "id"], message: "Question en double." });
    if (q.showIf && !before.has(q.showIf.question)) ctx.addIssue({ code: "custom", path: ["questions", i, "showIf"], message: "Une condition doit viser une question située plus haut." });
    before.add(q.id);
  });
});
export type ScriptInput = z.infer<typeof scriptInputSchema>;

/** Valeurs que peut prendre une question (pour proposer « afficher si la réponse vaut… »). */
export const answerOptions = (q: Pick<ScriptQuestion, "type" | "choices">): string[] => (q.type === "yes_no" ? [...YES_NO] : hasChoices(q.type) ? q.choices : []);
export const canBeCondition = (q: Pick<ScriptQuestion, "type" | "choices">) => answerOptions(q).length > 0;
