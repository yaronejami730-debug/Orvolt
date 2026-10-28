"use server";

import { revalidatePath } from "next/cache";
import { guard, mapDbError, type ActionResult } from "@/lib/action-guard";
import { validateAnswers, type Answers, type QuestionType, type ScriptQuestion } from "@/lib/call-scripts";
import { createClient } from "@/lib/supabase/server";
import { firstError } from "@/lib/validation/auth";
import { z } from "zod";

const runSchema = z.object({
  leadId: z.uuid(),
  scriptId: z.uuid(),
  answers: z.record(z.uuid(), z.union([z.string().max(2000), z.array(z.string().max(80)).max(20)])),
});

/**
 * Enregistre la saisie d'un formulaire d'appel sur un lead. Le serveur vérifie que le formulaire est bien applicable au membre
 * (fonction SQL call_scripts_for_member, jamais le client) puis valide les réponses contre les questions enregistrées.
 */
export async function saveScriptRunAction(input: unknown): Promise<ActionResult<{ errors?: Record<string, string> }>> {
  const g = await guard("leads.edit", "leads-write");
  if ("error" in g) return { ok: false, error: g.error };
  const p = runSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { data: applicable } = await supabase.rpc("call_scripts_for_member", { p_lead: p.data.leadId });
  if (!(applicable ?? []).some((r: { script_id: string }) => r.script_id === p.data.scriptId)) return { ok: false, error: "Ce formulaire n'est pas proposé pour ce lead." };
  const [{ data: script }, { data: qs }] = await Promise.all([
    supabase.from("call_scripts").select("id, name, domain_id").eq("id", p.data.scriptId).eq("org_id", g.s.org.id).maybeSingle(),
    supabase.from("call_script_questions").select("id, label, help, type, choices, required, show_if").eq("script_id", p.data.scriptId).eq("org_id", g.s.org.id).order("position"),
  ]);
  if (!script) return { ok: false, error: "Formulaire introuvable." };
  const questions: ScriptQuestion[] = (qs ?? []).map((q) => ({
    id: q.id, label: q.label, help: q.help, type: q.type as QuestionType, choices: (q.choices ?? []) as string[], required: q.required,
    showIf: q.show_if ? { question: (q.show_if as { question: string }).question, equals: (q.show_if as { equals: string }).equals } : null,
  }));
  const v = validateAnswers(questions, p.data.answers as Answers);
  if (!v.ok) return { ok: false, error: "Certaines réponses sont à corriger.", data: { errors: v.errors } };
  if (v.clean.length === 0) return { ok: false, error: "Renseignez au moins une réponse." };
  let domainName: string | null = null;
  if (script.domain_id) domainName = (await supabase.from("call_domains").select("name").eq("id", script.domain_id).maybeSingle()).data?.name ?? null;
  const { error } = await supabase.from("call_script_runs").insert({ org_id: g.s.org.id, script_id: script.id, script_name: script.name, domain_name: domainName, lead_id: p.data.leadId, answers: v.clean });
  if (error) return { ok: false, error: error.message.includes("script_not_assigned") ? "Ce formulaire n'est pas proposé pour vous." : mapDbError(error.message, "Enregistrement impossible.") };
  revalidatePath(`/leads/${p.data.leadId}`);
  return { ok: true };
}
