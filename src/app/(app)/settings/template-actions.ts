"use server";

import { revalidatePath } from "next/cache";
import { guard, type ActionResult } from "@/lib/action-guard";
import { applyTemplate } from "@/lib/apply-template";
import { createClient } from "@/lib/supabase/server";
import { firstError } from "@/lib/validation/auth";
import { resetTemplateSchema } from "@/lib/validation/workflow";

/** Applique (ou réapplique) un template : écrase statuts, champs et sources. Refusé si des leads existent. */
export async function applyTemplateAction(input: unknown): Promise<ActionResult> {
  const g = await guard(["statuses.manage", "fields.manage", "settings.manage"], "template");
  if ("error" in g) return { ok: false, error: g.error };
  const p = resetTemplateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const supabase = await createClient();
  const { data: used } = await supabase.rpc("org_has_leads", { org: g.s.org.id });
  if (used) return { ok: false, error: "Impossible : l'organisation contient déjà des leads." };
  const res = await applyTemplate(g.s.org.id, p.data.template);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/", "layout");
  return { ok: true };
}
