"use server";

import { revalidatePath } from "next/cache";
import { guard, mapDbError, type ActionResult } from "@/lib/action-guard";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, firstError } from "@/lib/validation/auth";
import { archiveSourceSchema, idSchema, sourceInputSchema } from "@/lib/validation/workflow";

const done = (): ActionResult => {
  revalidatePath("/settings/sources");
  return { ok: true };
};

export async function saveSourceAction(input: unknown): Promise<ActionResult> {
  const g = await guard("settings.manage", "sources");
  if ("error" in g) return { ok: false, error: g.error };
  const p = sourceInputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const supabase = await createClient();
  const dup = (code?: string) => (code === "23505" ? { name: "Cette source existe déjà." } : undefined);
  if (p.data.id) {
    const patch = { name: p.data.name, ...(p.data.color !== undefined ? { color: p.data.color } : {}) };
    const { data, error } = await supabase.from("lead_sources").update(patch).eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
    if (error || !data?.length) return { ok: false, error: mapDbError(error?.message, "Enregistrement impossible."), fieldErrors: dup(error?.code) };
  } else {
    const { count } = await supabase.from("lead_sources").select("id", { count: "exact", head: true }).eq("org_id", g.s.org.id);
    if ((count ?? 0) >= 50) return { ok: false, error: "Limite de 50 sources atteinte." };
    const { error } = await supabase.from("lead_sources").insert({ org_id: g.s.org.id, name: p.data.name, color: p.data.color ?? null });
    if (error) return { ok: false, error: mapDbError(error.message, "Création impossible."), fieldErrors: dup(error.code) };
  }
  return done();
}

export async function archiveSourceAction(input: unknown): Promise<ActionResult> {
  const g = await guard("settings.manage", "sources");
  if ("error" in g) return { ok: false, error: g.error };
  const p = archiveSourceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("lead_sources").update({ archived: p.data.archived }).eq("id", p.data.id).eq("org_id", g.s.org.id).eq("is_system", false).select("id");
  if (error || !data?.length) return { ok: false, error: "Opération impossible." };
  return done();
}

export async function deleteSourceAction(input: unknown): Promise<ActionResult> {
  const g = await guard("settings.manage", "sources");
  if ("error" in g) return { ok: false, error: g.error };
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("lead_sources").delete().eq("id", p.data.id).eq("org_id", g.s.org.id).eq("is_system", false).select("id");
  if (error?.code === "23503") return { ok: false, error: "Source utilisée par des leads : archivez-la plutôt." };
  if (error || !data?.length) return { ok: false, error: mapDbError(error?.message, "Suppression impossible.") };
  return done();
}
