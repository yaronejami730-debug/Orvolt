"use server";

import { revalidatePath } from "next/cache";
import { guard, guardAny, mapDbError, type ActionResult } from "@/lib/action-guard";
import { featureError } from "@/lib/billing/feature-guard";
import {
  assignmentInputSchema, domainInputSchema, findAmbiguousOverlaps, idInput, isDuplicate, memberDomainsInputSchema, normalizeAssignment, overlapMessage, MAX_DOMAINS,
} from "@/lib/call-programming";
import { ASSIGNMENT_COLS, toAssignment, type AssignmentRow } from "@/lib/call-programming-server";
import { scriptInputSchema } from "@/lib/call-scripts";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, firstError } from "@/lib/validation/auth";
import { z } from "zod";

const MANAGE = ["members.manage", "settings.manage"] as const;
const refresh = () => { revalidatePath("/settings/call-scripts"); revalidatePath("/settings/members"); };
const done = <T = undefined>(data?: T): ActionResult<T> => { refresh(); return { ok: true, data }; };

/** Erreurs métier renvoyées par les triggers / contraintes SQL. */
function dbError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  if (message.includes("too_many_domains")) return `${MAX_DOMAINS} domaines au maximum.`;
  if (message.includes("too_many_member_domains")) return "10 domaines au maximum par membre.";
  if (message.includes("too_many_assignments_script")) return "40 programmations au maximum par formulaire.";
  if (message.includes("too_many_assignments")) return "300 programmations au maximum.";
  if (message.includes("too_many_scripts")) return "30 formulaires au maximum.";
  if (message.includes("invalid_domain")) return "Domaine introuvable.";
  if (message.includes("invalid_condition") || message.includes("invalid_questions")) return "Questions invalides : une condition vise une question située plus haut.";
  if (message.includes("duplicate key") || message.includes("23505")) return "Cette entrée existe déjà.";
  return mapDbError(message, fallback);
}

// ---------------------------------------------------------------- domaines
export async function saveDomainAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...MANAGE], "call-scripts");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "call_script_programming");
  if (locked) return { ok: false, error: locked };
  const p = domainInputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const supabase = await createClient();
  const dup = (code?: string) => (code === "23505" ? { name: "Ce domaine existe déjà." } : undefined);
  if (p.data.id) {
    const patch = { name: p.data.name, ...(p.data.color !== undefined ? { color: p.data.color } : {}), ...(p.data.active !== undefined ? { active: p.data.active } : {}) };
    const { data, error } = await supabase.from("call_domains").update(patch).eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
    if (error || !data?.length) return { ok: false, error: dbError(error?.message, "Enregistrement impossible."), fieldErrors: dup(error?.code) };
  } else {
    const { data: last } = await supabase.from("call_domains").select("position").eq("org_id", g.s.org.id).order("position", { ascending: false }).limit(1);
    const { error } = await supabase.from("call_domains").insert({ org_id: g.s.org.id, name: p.data.name, color: p.data.color ?? null, position: (last?.[0]?.position ?? -1) + 1 });
    if (error) return { ok: false, error: dbError(error.message, "Création impossible."), fieldErrors: dup(error.code) };
  }
  return done();
}

export async function deleteDomainAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...MANAGE], "call-scripts");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idInput.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("call_domains").delete().eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: dbError(error?.message, "Suppression impossible.") };
  return done();
}

/** Remplace les domaines de travail d'un membre. */
export async function setMemberDomainsAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...MANAGE], "call-scripts");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "call_script_programming");
  if (locked) return { ok: false, error: locked };
  const p = memberDomainsInputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const org = g.s.org.id;
  const { data: cur } = await supabase.from("member_call_domains").select("domain_id").eq("org_id", org).eq("user_id", p.data.userId);
  const have = new Set((cur ?? []).map((r) => r.domain_id));
  const want = new Set(p.data.domainIds);
  const remove = [...have].filter((d) => !want.has(d));
  const add = [...want].filter((d) => !have.has(d));
  if (remove.length) {
    const { error } = await supabase.from("member_call_domains").delete().eq("org_id", org).eq("user_id", p.data.userId).in("domain_id", remove);
    if (error) return { ok: false, error: dbError(error.message, "Enregistrement impossible.") };
  }
  if (add.length) {
    const { error } = await supabase.from("member_call_domains").insert(add.map((domain_id) => ({ org_id: org, user_id: p.data.userId, domain_id })));
    if (error) return { ok: false, error: dbError(error.message, "Enregistrement impossible (membre ou domaine introuvable).") };
  }
  return done();
}

// ---------------------------------------------------------------- programmation
export async function saveAssignmentAction(input: unknown): Promise<ActionResult<{ warning?: string }>> {
  const g = await guardAny([...MANAGE], "call-scripts");
  if ("error" in g) return { ok: false, error: g.error };
  const locked = await featureError(g.s.org.id, "call_script_programming");
  if (locked) return { ok: false, error: locked };
  const p = assignmentInputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const supabase = await createClient();
  const org = g.s.org.id;
  const a = normalizeAssignment(p.data);
  const { data: rows } = await supabase.from("call_script_assignments").select(ASSIGNMENT_COLS).eq("org_id", org);
  const existing = ((rows ?? []) as AssignmentRow[]).map(toAssignment);
  if (isDuplicate(a, existing, p.data.id)) return { ok: false, error: "Cette programmation existe déjà pour ce formulaire.", fieldErrors: { scriptId: "Programmation en double." } };
  const col = { script_id: a.scriptId, scope: a.scope, user_id: a.userId, domain_id: a.domainId, starts_on: a.startsOn, ends_on: a.endsOn, days: a.days, time_from: a.timeFrom, time_to: a.timeTo, active: a.active, priority: a.priority };
  if (p.data.id) {
    const { data, error } = await supabase.from("call_script_assignments").update(col).eq("id", p.data.id).eq("org_id", org).select("id");
    if (error || !data?.length) return { ok: false, error: dbError(error?.message, "Enregistrement impossible.") };
  } else {
    const { error } = await supabase.from("call_script_assignments").insert({ org_id: org, ...col });
    if (error) return { ok: false, error: dbError(error.message, "Création impossible (formulaire, membre ou domaine introuvable).") };
  }
  const overlaps = findAmbiguousOverlaps(a, existing, p.data.id);
  let warning: string | undefined;
  if (overlaps.length) {
    const { data: sc } = await supabase.from("call_scripts").select("id, name").eq("org_id", org);
    const byId = new Map((sc ?? []).map((s) => [s.id, s.name]));
    warning = overlapMessage(overlaps, (id) => byId.get(id) ?? "formulaire");
  }
  return done({ warning });
}

export async function deleteAssignmentAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...MANAGE], "call-scripts");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idInput.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("call_script_assignments").delete().eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: dbError(error?.message, "Suppression impossible.") };
  return done();
}

export async function toggleAssignmentAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny([...MANAGE], "call-scripts");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid(), active: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("call_script_assignments").update({ active: p.data.active }).eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: dbError(error?.message, "Opération impossible.") };
  return done();
}

// ---------------------------------------------------------------- formulaires (construction : fields.manage, comme les champs)
export async function saveScriptAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await guard("fields.manage", "call-scripts");
  if ("error" in g) return { ok: false, error: g.error };
  const p = scriptInputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const domainParsed = z.uuid().nullish().safeParse((input as { domainId?: unknown })?.domainId);
  if (!domainParsed.success) return { ok: false, error: "Domaine invalide." };
  const supabase = await createClient();
  const org = g.s.org.id;
  let domain = domainParsed.data ?? null;
  // Hors plan Pro+ : le domaine ne se modifie pas (on garde celui déjà enregistré).
  if (await featureError(org, "call_script_programming")) {
    domain = p.data.id ? ((await supabase.from("call_scripts").select("domain_id").eq("id", p.data.id).eq("org_id", org).maybeSingle()).data?.domain_id ?? null) : null;
  }
  const { data, error } = await supabase.rpc("save_call_script", {
    p_id: p.data.id, p_org: org, p_name: p.data.name, p_description: p.data.description ?? "", p_active: p.data.active, p_domain: domain,
    p_questions: p.data.questions.map((q) => ({ id: q.id, label: q.label, help: q.help, type: q.type, choices: q.choices, required: q.required, show_if: q.showIf })),
  });
  if (error || !data) return { ok: false, error: dbError(error?.message, "Enregistrement impossible."), fieldErrors: error?.code === "23505" ? { name: "Ce nom est déjà utilisé." } : undefined };
  return done({ id: data as string });
}

export async function deleteScriptAction(input: unknown): Promise<ActionResult> {
  const g = await guard("fields.manage", "call-scripts");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idInput.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_call_script", { p_id: p.data.id });
  if (error) return { ok: false, error: dbError(error.message, "Suppression impossible.") };
  return done();
}
