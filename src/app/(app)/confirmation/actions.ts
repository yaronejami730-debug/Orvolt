"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAny, type ActionResult } from "@/lib/action-guard";
import { createClient } from "@/lib/supabase/server";

const ERRORS: [string, string][] = [
  ["not_planned", "Ce rendez-vous n'est plus à confirmer."],
  ["not_found", "Rendez-vous introuvable."],
  ["not_confirmer", "Ce membre n'est pas confirmateur."],
  ["org_read_only", "Abonnement inactif : lecture seule."],
  ["forbidden", "Ce rendez-vous est attribué à un autre confirmateur."],
];
const mapError = (m?: string) => ERRORS.find(([k]) => m?.includes(k))?.[1] ?? "Opération impossible. Réessayez.";

const refresh = () => {
  revalidatePath("/confirmation");
  revalidatePath("/agenda");
  revalidatePath("/agenda/repartition");
};

/** Confirme un rendez-vous planifié. Le contrôle (confirmateur attribué ou administrateur) est refait en base. */
export async function confirmAppointmentAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny(["dispatch.manage"], "confirmation");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Rendez-vous invalide." };
  const { error } = await (await createClient()).rpc("confirm_appointment", { p_id: p.data.id });
  if (error) return { ok: false, error: mapError(error.message) };
  refresh();
  return { ok: true };
}

/** Réattribue un rendez-vous à un confirmateur précis (administrateur) ; userId null = attribution automatique. */
export async function setConfirmerAction(input: unknown): Promise<ActionResult> {
  const g = await guardAny(["members.manage"], "confirmation");
  if ("error" in g) return { ok: false, error: g.error };
  const p = z.object({ id: z.uuid(), userId: z.uuid().nullable() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Demande invalide." };
  const { error } = await (await createClient()).rpc("set_appointment_confirmer", { p_id: p.data.id, p_user: p.data.userId });
  if (error) return { ok: false, error: mapError(error.message) };
  refresh();
  return { ok: true };
}
