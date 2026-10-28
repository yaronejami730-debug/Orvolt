import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { visitorKey } from "@/lib/email-verification";
import { sanitizeSource, type FunnelStep } from "./intent";

export interface FunnelCtx { orgId?: string | null; email?: string | null; plan?: string | null; interval?: string | null; source?: string | null }

/**
 * Enregistre une étape du tunnel (service-role, table verrouillée par RLS). Ne lève JAMAIS : un échec de suivi ne gêne pas l'utilisateur.
 * Une étape n'est comptée qu'une fois par organisation (ou par visiteur avant la création du compte) : le doublon est ignoré par l'index unique.
 * Aucune donnée personnelle : seulement une empreinte non réversible de l'adresse, le plan, la fréquence et la source.
 */
export async function trackFunnel(step: FunnelStep, ctx: FunnelCtx): Promise<void> {
  try {
    const key = ctx.email ? visitorKey(ctx.email) : null;
    if (!ctx.orgId && !key) return;
    await createAdminClient().from("funnel_events").insert({
      step, org_id: ctx.orgId ?? null, visitor_key: key, plan: ctx.plan ?? null,
      billing_interval: ctx.interval === "month" || ctx.interval === "year" ? ctx.interval : null, source: sanitizeSource(ctx.source),
    });
  } catch {
    // suivi facultatif (table absente avant migration, base indisponible…)
  }
}
