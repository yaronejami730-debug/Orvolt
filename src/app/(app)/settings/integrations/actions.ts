"use server";

import { revalidatePath } from "next/cache";
import { guard, mapDbError, type ActionResult } from "@/lib/action-guard";
import { encryptSecret, generateToken, newEndpointSecret } from "@/lib/inbound/auth";
import { buildTestPayload, explainMapping } from "@/lib/inbound/adapters";
import { processInbound } from "@/lib/inbound/handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors, firstError } from "@/lib/validation/auth";
import { endpointCreateSchema, endpointIdSchema, endpointUpdateSchema } from "@/lib/validation/integrations";
import type { InboundKind } from "@/lib/inbound/adapters";

const SCOPE = "integrations";
const done = () => revalidatePath("/settings/integrations");

async function ownEndpoint(orgId: string, id: string) {
  const { data } = await createAdminClient().from("inbound_endpoints").select("id, kind, token, mapping").eq("id", id).eq("org_id", orgId).maybeSingle();
  return data as { id: string; kind: InboundKind; token: string; mapping: Record<string, string> } | null;
}

async function sourceOk(orgId: string, id: string | null | undefined) {
  if (!id) return true;
  const { data } = await createAdminClient().from("lead_sources").select("id").eq("org_id", orgId).eq("id", id).maybeSingle();
  return !!data;
}

/** Création : le secret est renvoyé UNE SEULE fois (seul son hachage est conservé). */
export async function createEndpointAction(input: unknown): Promise<ActionResult<{ id: string; secret: string; token: string }>> {
  const g = await guard("settings.manage", SCOPE);
  if ("error" in g) return { ok: false, error: g.error };
  const bad = mappingProblem(input);
  if (bad) return { ok: false, error: bad };
  const p = endpointCreateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  const { s } = g;
  if (!(await sourceOk(s.org.id, p.data.defaultSourceId))) return { ok: false, error: "Source invalide." };
  const admin = createAdminClient();
  const { count } = await admin.from("inbound_endpoints").select("id", { count: "exact", head: true }).eq("org_id", s.org.id);
  if ((count ?? 0) >= 20) return { ok: false, error: "Limite de 20 webhooks atteinte." };
  const id = crypto.randomUUID();
  const sec = newEndpointSecret(id, 1); // secret dérivé côté serveur : seul son hachage est stocké
  const token = generateToken();
  const { data, error } = await admin
    .from("inbound_endpoints")
    .insert({
      id, secret_version: 1, org_id: s.org.id, name: p.data.name, kind: p.data.kind, token, secret_hash: sec.hash, secret_prefix: sec.prefix,
      default_source_id: p.data.defaultSourceId ?? null, mapping: p.data.mapping ?? {}, dedupe_window_hours: p.data.dedupeWindowHours, created_by: s.user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: mapDbError(error?.message, "Création impossible.") };
  done();
  return { ok: true, data: { id: data.id, secret: sec.secret, token } };
}

export async function updateEndpointAction(input: unknown): Promise<ActionResult> {
  const g = await guard("settings.manage", SCOPE);
  if ("error" in g) return { ok: false, error: g.error };
  const bad = mappingProblem(input);
  if (bad) return { ok: false, error: bad };
  const p = endpointUpdateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error), fieldErrors: fieldErrors(p.error) };
  if (!(await sourceOk(g.s.org.id, p.data.defaultSourceId))) return { ok: false, error: "Source invalide." };
  const patch: Record<string, unknown> = { name: p.data.name, default_source_id: p.data.defaultSourceId, mapping: p.data.mapping, dedupe_window_hours: p.data.dedupeWindowHours, active: p.data.active };
  // Secret d'application Meta (écriture seule, chiffré AES-256-GCM) : undefined = inchangé, "" = retiré.
  if (p.data.metaAppSecret !== undefined) {
    const ep = await ownEndpoint(g.s.org.id, p.data.id);
    if (!ep || ep.kind !== "meta") return { ok: false, error: "Le secret d'application ne concerne que les webhooks Meta." };
    patch.meta_app_secret_enc = p.data.metaAppSecret === "" ? null : encryptSecret(p.data.metaAppSecret);
  }
  const { data, error } = await createAdminClient()
    .from("inbound_endpoints")
    .update(patch)
    .eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Enregistrement impossible." };
  done();
  return { ok: true };
}

export async function regenerateEndpointSecretAction(input: unknown): Promise<ActionResult<{ secret: string }>> {
  const g = await guard("settings.manage", SCOPE);
  if ("error" in g) return { ok: false, error: g.error };
  const p = endpointIdSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const admin = createAdminClient();
  const { data: cur } = await admin.from("inbound_endpoints").select("id, secret_version").eq("id", p.data.id).eq("org_id", g.s.org.id).maybeSingle();
  if (!cur) return { ok: false, error: "Webhook introuvable." };
  const version = (cur.secret_version ?? 0) + 1;
  const sec = newEndpointSecret(cur.id, version);
  const { data, error } = await admin
    .from("inbound_endpoints")
    .update({ secret_hash: sec.hash, secret_prefix: sec.prefix, secret_version: version, secret_rotated_at: new Date().toISOString() })
    .eq("id", cur.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Régénération impossible." };
  done();
  return { ok: true, data: { secret: sec.secret } };
}

export async function deleteEndpointAction(input: unknown): Promise<ActionResult> {
  const g = await guard("settings.manage", SCOPE);
  if ("error" in g) return { ok: false, error: g.error };
  const p = endpointIdSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const { data, error } = await createAdminClient().from("inbound_endpoints").delete().eq("id", p.data.id).eq("org_id", g.s.org.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Suppression impossible." };
  done();
  return { ok: true };
}

function mappingProblem(input: unknown): string | null {
  const m = (input as { mapping?: unknown })?.mapping;
  if (!m || typeof m !== "object") return null;
  return explainMapping(m as Record<string, string>);
}

/** Envoie un lead d'exemple dans le même pipeline que l'API publique (crée un vrai lead « Test »). */
export async function testEndpointAction(input: unknown): Promise<ActionResult<{ result: string }>> {
  const g = await guard("settings.manage", SCOPE);
  if ("error" in g) return { ok: false, error: g.error };
  const p = endpointIdSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstError(p.error) };
  const ep = await ownEndpoint(g.s.org.id, p.data.id);
  if (!ep) return { ok: false, error: "Webhook introuvable." };
  const body = JSON.stringify(buildTestPayload(ep.kind, ep.mapping, Date.now() % 100000));
  const r = await processInbound({ token: ep.token, method: "POST", headers: { get: () => null }, body, ip: null, trusted: true });
  done();
  return r.status === 200 ? { ok: true, data: { result: String(r.json?.status) } } : { ok: false, error: "Le test a échoué (webhook inactif ?)." };
}
