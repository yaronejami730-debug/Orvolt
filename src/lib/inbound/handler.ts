import "server-only";
import { after } from "next/server";
import { isWritable } from "@/lib/billing/access";
import { dashboardCache } from "@/lib/dashboard/cache";
import { runStatusActions } from "@/lib/automation/store";
import { validateCustom } from "@/lib/custom-fields";
import { normalizeEmail, normalizePhone, maskPii } from "@/lib/leads/normalize";
import { limiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { adapt, finalizeInbound, googleKeyOf, mappingConfigSchema, type InboundKind } from "./adapters";
import { decryptSecret, deriveEndpointSecret, ipHash, ipSalt, verifyBodySignature, verifyMetaSignature, verifySecret } from "./auth";

export const INBOUND_MAX_BYTES = 100 * 1024;
/**
 * Plafonds de débit, indépendants : par endpoint, par organisation, par IP (seulement si l'IP est connue) ;
 * jetons inconnus : par IP si connue, sinon un plafond global distinct qui ne consomme AUCUN seau d'un tenant valide.
 */
export const RATES = {
  endpoint: { limit: 60, windowMs: 60_000 },
  org: { limit: 200, windowMs: 60_000 },
  ip: { limit: 120, windowMs: 60_000 },
  unknownIp: { limit: 60, windowMs: 60_000 },
  unknownGlobal: { limit: 600, windowMs: 60_000 },
};

export interface InboundRequest {
  token: string;
  method: "GET" | "POST";
  headers: { get(name: string): string | null };
  /** Corps déjà lu et borné (POST). */
  body?: string;
  query?: URLSearchParams;
  ip: string | null;
  /** Appel interne (bouton « Envoyer un test ») : authentification déjà assurée par l'action serveur. */
  trusted?: boolean;
}
export interface InboundResponse {
  status: number;
  json?: Record<string, unknown>;
  text?: string;
  headers?: Record<string, string>;
}

const NOT_FOUND: InboundResponse = { status: 404, json: { error: "not_found" } };

interface Endpoint {
  id: string;
  org_id: string;
  kind: InboundKind;
  name: string;
  secret_hash: string;
  default_source_id: string | null;
  mapping: Record<string, string>;
  dedupe_window_hours: number;
  active: boolean;
  created_by: string | null;
  secret_version: number | null;
  meta_app_secret_enc: string | null;
}

const salt = () => ipSalt();

async function log(ep: Endpoint, status: "created" | "duplicate" | "rejected", reason: string | null, ip: string | null, payload: unknown, leadId?: string) {
  const masked = payload === undefined ? null : maskPii(payload);
  const size = masked ? JSON.stringify(masked).length : 0;
  await createAdminClient().from("inbound_events").insert({
    org_id: ep.org_id, endpoint_id: ep.id, status, reason, lead_id: leadId ?? null, ip_hash: ipHash(ip, salt()),
    payload: size > 5000 ? { truncated: true } : masked,
  });
}

/** Cœur de l'API entrante : l'organisation est TOUJOURS dérivée de l'endpoint (jeton), jamais du contenu. */
const tooMany = (ms: number): InboundResponse => ({ status: 429, json: { error: "rate_limited" }, headers: { "retry-after": String(Math.max(1, Math.ceil(ms / 1000))) } });

/** Réponse pour un jeton inconnu/désactivé : 404 neutre, sauf flood (429) compté hors de tout seau de tenant. */
async function unknownToken(req: InboundRequest): Promise<InboundResponse> {
  const rl = req.ip
    ? await limiter.check(`inbound-unknown-ip:${ipHash(req.ip, salt())}`, RATES.unknownIp)
    : await limiter.check("inbound-unknown-global", RATES.unknownGlobal);
  return rl.ok ? NOT_FOUND : tooMany(rl.retryAfterMs);
}

/** Cœur de l'API entrante : l'organisation est TOUJOURS dérivée de l'endpoint (jeton), jamais du contenu. */
export async function processInbound(req: InboundRequest): Promise<InboundResponse> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(req.token)) return unknownToken(req);
  const admin = createAdminClient();
  const { data } = await admin
    .from("inbound_endpoints")
    .select("id, org_id, kind, name, secret_hash, default_source_id, mapping, dedupe_window_hours, active, created_by, secret_version, meta_app_secret_enc")
    .eq("token", req.token)
    .maybeSingle();
  const ep = data as Endpoint | null;
  if (!ep || !ep.active) return unknownToken(req); // inconnu ou désactivé : même réponse neutre

  // --- Vérification Meta (GET hub.challenge)
  if (req.method === "GET") {
    const q = req.query;
    if (ep.kind === "meta" && q?.get("hub.mode") === "subscribe" && verifySecret(q.get("hub.verify_token"), ep.secret_hash)) {
      return { status: 200, text: (q.get("hub.challenge") ?? "").slice(0, 200), headers: { "content-type": "text/plain" } };
    }
    return NOT_FOUND;
  }

  // --- Limitation de débit : endpoint, organisation, IP connue (jamais de seau partagé quand l'IP est inconnue)
  const checks = [await limiter.check(`inbound:${ep.id}`, RATES.endpoint), await limiter.check(`inbound-org:${ep.org_id}`, RATES.org)];
  if (req.ip) checks.push(await limiter.check(`inbound-ip:${ipHash(req.ip, salt())}`, RATES.ip));
  const blocked = checks.filter((c) => !c.ok);
  if (blocked.length) return tooMany(Math.max(...blocked.map((c) => c.retryAfterMs)));

  // --- Abonnement : organisation en lecture seule => aucun lead créé (402, sans détail)
  if (!(await isWritable(ep.org_id))) return { status: 402, json: { error: "subscription_required" } };

  // --- Plafond quotidien par organisation (configurable : organizations.inbound_daily_limit)
  if (!req.trusted) {
    const { data: org } = await admin.from("organizations").select("inbound_daily_limit").eq("id", ep.org_id).single();
    const { count } = await admin.from("inbound_events").select("id", { count: "exact", head: true }).eq("org_id", ep.org_id).eq("status", "created").gte("received_at", new Date(Date.now() - 86_400_000).toISOString());
    if ((count ?? 0) >= (org?.inbound_daily_limit ?? 5000)) return { status: 429, json: { error: "quota_exceeded" }, headers: { "retry-after": "3600" } };
  }

  const body = req.body ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    await log(ep, "rejected", "invalid_json", req.ip, undefined);
    return { status: 400, json: { error: "invalid_payload" } };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    await log(ep, "rejected", "invalid_json", req.ip, undefined);
    return { status: 400, json: { error: "invalid_payload" } };
  }

  // --- Authentification : le secret est re-dérivé côté serveur (la base ne contient que son hachage)
  if (!req.trusted) {
    let ok = false;
    if (ep.kind === "meta") {
      // Meta : si un secret d'application est configuré, la signature X-Hub-Signature-256 est OBLIGATOIRE ; sinon jeton d'URL seul.
      const appSecret = ep.meta_app_secret_enc ? decryptSecret(ep.meta_app_secret_enc) : null;
      ok = ep.meta_app_secret_enc ? !!appSecret && verifyMetaSignature(req.headers.get("x-hub-signature-256"), appSecret, body) : true;
    } else if (ep.kind === "google") {
      ok = verifySecret(googleKeyOf(parsed), ep.secret_hash);
    } else {
      ok = verifySecret(req.headers.get("x-leadforge-secret"), ep.secret_hash);
      if (!ok && ep.secret_version !== null) ok = verifyBodySignature(req.headers.get("x-leadforge-signature"), deriveEndpointSecret(ep.id, ep.secret_version), body);
    }
    if (!ok) {
      await log(ep, "rejected", "unauthorized", req.ip, undefined);
      return { status: 401, json: { error: "unauthorized" } };
    }
  }

  const mappingOk = mappingConfigSchema.safeParse(ep.mapping);
  const candidates = adapt(ep.kind, parsed, mappingOk.success ? mappingOk.data : {});
  if (candidates.length === 0) {
    await log(ep, "rejected", "no_lead_in_payload", req.ip, parsed);
    return { status: 400, json: { error: "invalid_payload" } };
  }

  const results: string[] = [];
  for (const cand of candidates.slice(0, 20)) {
    const fin = finalizeInbound(cand);
    if (!fin.ok) {
      await log(ep, "rejected", fin.reason, req.ip, parsed);
      results.push("rejected");
      continue;
    }
    const lead = fin.lead;
    // Champs personnalisés : mêmes validations que la création, sans exiger les champs obligatoires (le canal ne peut pas les fournir).
    let custom: Record<string, unknown> = {};
    if (Object.keys(lead.custom).length) {
      const { data: defs } = await admin.from("custom_fields").select("id, key, label, type, options, required, visible_roles, editable_roles").eq("org_id", ep.org_id);
      const v = validateCustom((defs ?? []) as never, lead.custom, { roleId: "", isAdmin: true }, "update");
      if (!v.ok) {
        await log(ep, "rejected", "invalid_custom_field", req.ip, parsed);
        results.push("rejected");
        continue;
      }
      custom = v.data;
    }

    // Doublon dans la fenêtre configurée (même e-mail ou téléphone normalisé)
    const email = normalizeEmail(lead.email);
    const phone = normalizePhone(lead.phone);
    if (ep.dedupe_window_hours > 0) {
      const since = new Date(Date.now() - ep.dedupe_window_hours * 3_600_000).toISOString();
      let dup: string | null = null;
      if (email) dup = (await admin.from("leads").select("id").eq("org_id", ep.org_id).eq("email_norm", email).gte("created_at", since).limit(1).maybeSingle()).data?.id ?? null;
      if (!dup && phone) dup = (await admin.from("leads").select("id").eq("org_id", ep.org_id).eq("phone_norm", phone).gte("created_at", since).limit(1).maybeSingle()).data?.id ?? null;
      if (dup) {
        await log(ep, "duplicate", "duplicate_in_window", req.ip, parsed, dup);
        results.push("duplicate");
        continue;
      }
    }

    const { data: st } = await admin.from("statuses").select("id").eq("org_id", ep.org_id).eq("is_initial", true).maybeSingle();
    if (!st) {
      await log(ep, "rejected", "no_initial_status", req.ip, parsed);
      results.push("rejected");
      continue;
    }
    const { data: created, error } = await admin
      .from("leads")
      .insert({
        org_id: ep.org_id, status_id: st.id, source_id: ep.default_source_id, first_name: lead.firstName, last_name: lead.lastName,
        company: lead.company, email: lead.email, phone: lead.phone, address: lead.address, city: lead.city, postal_code: lead.postalCode,
        value: lead.value, custom,
      })
      .select("id")
      .single();
    if (error || !created) {
      await log(ep, "rejected", "storage_error", req.ip, parsed);
      results.push("rejected");
      continue;
    }
    await admin.from("lead_events").update({ payload: { status_id: st.id, via: "webhook", endpoint_id: ep.id } }).eq("lead_id", created.id).eq("type", "created");
    await log(ep, "created", null, req.ip, parsed, created.id);
    dashboardCache.clear();
    results.push("created");
    await afterCreate(ep, created.id, st.id, `${lead.firstName} ${lead.lastName}`.trim() || lead.company || "Lead");
  }

  const status = results.includes("created") ? "created" : results.every((r) => r === "duplicate") ? "duplicate" : "rejected";
  return { status: 200, json: { status, received: results.length } };
}

/** Notification des administrateurs + actions automatiques du statut initial (échecs sans conséquence). */
async function afterCreate(ep: Endpoint, leadId: string, statusId: string, label: string) {
  const admin = createAdminClient();
  try {
    const { data: admins } = await admin.from("memberships").select("user_id, role:roles!inner(is_admin)").eq("org_id", ep.org_id).eq("status", "active").eq("role.is_admin", true).limit(5);
    for (const a of admins ?? []) {
      await admin.from("notifications").insert({
        org_id: ep.org_id, user_id: a.user_id, type: "lead_inbound", dedupe_key: `inbound:${leadId}:${a.user_id}`,
        payload: { lead_id: leadId, lead_name: label, message: `Nouveau lead reçu via « ${ep.name} »` },
      });
    }
    const { data: ev } = await admin.from("lead_events").select("id").eq("lead_id", leadId).eq("type", "created").limit(1).maybeSingle();
    const { data: actions } = await admin.from("status_actions").select("id, type, config, position").eq("status_id", statusId).eq("org_id", ep.org_id).eq("enabled", true);
    if (ev && actions?.length) {
      const { data: org } = await admin.from("organizations").select("slug").eq("id", ep.org_id).single();
      const run = () => runStatusActions({ orgId: ep.org_id, orgSlug: org?.slug ?? "", leadId, fromStatusId: statusId, toStatusId: statusId, eventId: ev.id, actorId: null }, actions).catch(() => undefined);
      try { after(run); } catch { void run(); }
    }
  } catch {
    // jamais bloquant pour l'expéditeur
  }
}

