"use server";

import { revalidatePath } from "next/cache";
import { guard, type ActionResult } from "@/lib/action-guard";
import { createAdminClient } from "@/lib/supabase/admin";

/** Régénère le secret de signature (invalide l'ancien). Réservé aux administrateurs. */
export async function regenerateSecretAction(): Promise<ActionResult> {
  const g = await guard("settings.manage", "webhook-secret");
  if ("error" in g) return { ok: false, error: g.error };
  if (!g.s.isAdmin) return { ok: false, error: "Réservé aux administrateurs." };
  const admin = createAdminClient();
  const { data } = await admin.from("organizations").select("webhook_secret_version").eq("id", g.s.org.id).single();
  const { error } = await admin.from("organizations").update({ webhook_secret_version: (data?.webhook_secret_version ?? 1) + 1 }).eq("id", g.s.org.id);
  if (error) return { ok: false, error: "Régénération impossible." };
  revalidatePath("/settings/webhooks");
  return { ok: true };
}
