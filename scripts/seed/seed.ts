/**
 * Seed de démonstration (service_role). Idempotent : supprime ses propres données démo (orgs + comptes @demo.test), puis recrée.
 * La configuration métier passe par applyTemplate (même logique que l'inscription) ; aucun SQL dupliqué.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyTemplate } from "../../src/lib/apply-template";
import { getTemplate } from "../../src/lib/templates";
import { DEMO_DOMAIN, DEMO_PASSWORD, DEMO_USERS, ORG_SPECS, generateOrg, type GenOrg, type OrgKey, type OrgSpec } from "./data";

export interface SeedSummary {
  orgs: { key: OrgKey; id: string; name: string; leads: number; appointments: number; tasks: number }[];
  users: { email: string; role: string; org: string }[];
  totals: { orgs: number; users: number; leads: number; appointments: number; overRadius: number; tasks: number; notifications: number };
}

const CHUNK = 100;
type Row = Record<string, unknown>;

function must<T>(res: { data?: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} : ${res.error.message}`);
  return res.data as T;
}

async function insertAll(db: SupabaseClient, table: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`insert ${table} : ${error.message}`);
  }
}

export function assertLocalTarget(url: string, env: Record<string, string | undefined> = process.env) {
  const host = new URL(url).hostname;
  const local = host === "127.0.0.1" || host === "localhost";
  if (local) return;
  // Base non locale : triple verrou (drapeau, confirmation explicite du nom d'hôte, jamais en production).
  if (env.NODE_ENV === "production") throw new Error("Seed refusé : NODE_ENV=production.");
  if (env.ALLOW_REMOTE_SEED !== "1") throw new Error(`Seed refusé : ${host} n'est pas une base locale (ALLOW_REMOTE_SEED=1 et CONFIRM_REMOTE_SEED=${host} pour forcer).`);
  if (env.CONFIRM_REMOTE_SEED !== host) throw new Error(`Seed refusé : confirmation manquante (CONFIRM_REMOTE_SEED=${host}).`);
}

export async function cleanDemoData(admin: SupabaseClient, log: (m: string) => void = () => {}) {
  const demoUsers: { id: string; email?: string }[] = [];
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers : ${error.message}`);
    demoUsers.push(...data.users.filter((u) => u.email?.endsWith(`@${DEMO_DOMAIN}`)));
    if (data.users.length < 200) break;
  }
  const ids = demoUsers.map((u) => u.id);
  const names = ORG_SPECS.map((s) => s.name);
  const { data: orgs } = await admin.from("organizations").select("id, created_by, name");
  const doomed = (orgs ?? []).filter((o) => names.includes(o.name) || (o.created_by && ids.includes(o.created_by)));
  for (const o of doomed) must(await admin.from("organizations").delete().eq("id", o.id), "suppression organisation");
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser : ${error.message}`);
  }
  log(`Nettoyage : ${doomed.length} organisation(s), ${ids.length} compte(s) démo supprimés.`);
}

export async function runSeed(opts: { log?: (m: string) => void; now?: Date } = {}): Promise<SeedSummary> {
  const log = opts.log ?? (() => {});
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) throw new Error("Variables Supabase manquantes (.env.local : npm run setup:env).");
  assertLocalTarget(url);
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, service, noSession);

  await cleanDemoData(admin, log);

  // Comptes (un compte de démo = e-mail confirmé, mot de passe commun)
  const userId: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: u.fullName } });
    if (error || !data.user) throw new Error(`createUser ${u.email} : ${error?.message}`);
    userId[u.key] = data.user.id;
  }
  const uid = (key: string | null) => (key ? userId[key]! : null);

  const summary: SeedSummary = { orgs: [], users: [], totals: { orgs: 0, users: DEMO_USERS.length, leads: 0, appointments: 0, overRadius: 0, tasks: 0, notifications: 0 } };
  const now = opts.now ?? new Date();

  for (const spec of ORG_SPECS) {
    const creator = DEMO_USERS.find((u) => u.orgs[spec.key] === "Super administrateur")!;
    const org = await createOrg(spec, creator.email, url, anon, noSession);
    must(await admin.from("organizations").update({ seat_limit: 10 }).eq("id", org), "sièges"); // 6 membres dans Énergie Verte Démo
    const tpl = getTemplate(spec.templateId)!;
    if (tpl.id !== spec.templateId) throw new Error("Template inattendu.");
    const applied = await applyTemplate(org, spec.templateId);
    if (!applied.ok) throw new Error(`applyTemplate ${spec.name} : ${applied.error}`);

    // Membres (rôles système créés par create_organization)
    const roles = must(await admin.from("roles").select("id, name").eq("org_id", org), "rôles");
    for (const u of DEMO_USERS) {
      const role = u.orgs[spec.key];
      if (!role || role === "Super administrateur") continue;
      must(await admin.from("profiles").update({ provisioned_org: org }).eq("id", userId[u.key]!), "profil");
      must(await admin.from("memberships").insert({ org_id: org, user_id: userId[u.key]!, role_id: roles.find((r) => r.name === role)!.id }), `membre ${u.email}`);
    }

    const gen = generateOrg({ spec, statuses: tpl.statuses.map((s) => ({ key: s.key, name: s.name, kind: s.kind, initial: s.initial })), transitions: tpl.transitions, now });
    await writeOrg(admin, org, spec, gen, userId, uid);

    const appts = gen.leads.flatMap((l) => l.appointments);
    summary.orgs.push({ key: spec.key, id: org, name: spec.name, leads: gen.leads.length, appointments: appts.length, tasks: gen.tasks.length });
    summary.totals.orgs++;
    summary.totals.leads += gen.leads.length;
    summary.totals.appointments += appts.length;
    summary.totals.overRadius += appts.filter((a) => a.distanceStatus === "over_radius").length;
    summary.totals.tasks += gen.tasks.length;
    summary.totals.notifications += gen.notifications.length;
    log(`${spec.name} : ${gen.leads.length} leads, ${appts.length} RDV, ${gen.tasks.length} tâches.`);
  }
  for (const u of DEMO_USERS) for (const [k, role] of Object.entries(u.orgs)) summary.users.push({ email: u.email, role: role!, org: ORG_SPECS.find((s) => s.key === k)!.name });
  return summary;
}

/** Même chemin que l'inscription : l'admin s'authentifie puis appelle la RPC create_organization. */
async function createOrg(spec: OrgSpec, email: string, url: string, anon: string, noSession: object) {
  const client = createClient(url, anon, noSession);
  const { error: signErr } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (signErr) throw new Error(`connexion ${email} : ${signErr.message}`);
  const { data, error } = await client.rpc("create_organization", { p_name: spec.name, p_template: spec.templateId });
  if (error || !data) throw new Error(`create_organization ${spec.name} : ${error?.message}`);
  return data as string;
}

async function writeOrg(admin: SupabaseClient, org: string, spec: OrgSpec, gen: GenOrg, userId: Record<string, string>, uid: (k: string | null) => string | null) {
  const statuses = must(await admin.from("statuses").select("id, name").eq("org_id", org), "statuts");
  const sources = must(await admin.from("lead_sources").select("id, name").eq("org_id", org), "sources");
  const tpl = getTemplate(spec.templateId)!;
  const statusId = (key: string) => statuses.find((s) => s.name === tpl.statuses.find((t) => t.key === key)!.name)!.id as string;
  const nameOfKey = (key: string) => tpl.statuses.find((t) => t.key === key)!.name;
  const sourceId = (name: string) => {
    const s = sources.find((x) => x.name === name);
    if (!s) throw new Error(`Source inconnue : ${name}`);
    return s.id as string;
  };

  // Zones (coordonnées fournies : aucun géocodage réseau)
  await insertAll(admin, "sales_zones", gen.zones.map((z) => ({ org_id: org, user_id: userId[z.userKey], base_address: z.baseAddress, base_lat: z.lat, base_lng: z.lng, radius_km: z.radiusKm, work_start: z.workStart ?? "09:00", work_end: z.workEnd ?? "19:00" })));

  const iso = (d: Date) => d.toISOString();
  await insertAll(admin, "leads", gen.leads.map((l) => ({
    id: l.id, org_id: org, status_id: statusId(l.statusKey), source_id: sourceId(l.sourceName), assigned_to: uid(l.assignedKey),
    first_name: l.first_name, last_name: l.last_name, company: l.company, email: l.email, phone: l.phone, address: l.address,
    city: l.city, postal_code: l.postal_code, lat: l.lat, lng: l.lng, value: l.value, custom: l.custom, created_by: uid(l.createdByKey),
    position: l.createdAt.getTime() / 1000, created_at: iso(l.createdAt), updated_at: iso(l.updatedAt),
  })));
  await insertAll(admin, "lead_notes", gen.leads.flatMap((l) => l.notes.map((n) => ({ id: n.id, org_id: org, lead_id: l.id, author_id: userId[n.authorKey], body: n.body, created_at: iso(n.at), updated_at: iso(n.at) }))));
  await insertAll(admin, "lead_calls", gen.leads.flatMap((l) => l.calls.map((c) => ({ id: c.id, org_id: org, lead_id: l.id, caller_id: userId[c.callerKey], outcome: c.outcome, duration_seconds: c.durationSeconds, notes: c.notes, called_at: iso(c.at), created_at: iso(c.at) }))));
  await insertAll(admin, "appointments", gen.leads.flatMap((l) => l.appointments.map((a) => ({
    id: a.id, org_id: org, lead_id: l.id, assigned_to: userId[a.assignedKey], starts_at: iso(a.startsAt), ends_at: iso(a.endsAt), status: a.status,
    location_address: a.address, lat: a.lat, lng: a.lng, distance_km: a.distanceKm, distance_status: a.distanceStatus, distance_override: a.override,
    override_reason: a.overrideReason, override_by: uid(a.overrideByKey), notes: a.notes, created_by: userId[a.createdByKey], created_at: iso(a.createdAt), updated_at: iso(a.createdAt),
  }))));
  await insertAll(admin, "tasks", gen.tasks.map((t) => ({ id: t.id, org_id: org, lead_id: t.leadId, assigned_to: userId[t.assignedKey], created_by: userId[spec.adminKey], title: t.title, due_at: iso(t.dueAt), done: t.done, done_at: t.doneAt ? iso(t.doneAt) : null, dedupe_key: t.dedupe, created_at: iso(t.createdAt) })));
  await insertAll(admin, "notifications", gen.notifications.map((n) => ({
    org_id: org, user_id: userId[n.userKey], type: "automation", payload: { lead_id: n.leadId, lead_name: n.leadName, status: n.status, message: n.message },
    read_at: n.readAt ? iso(n.readAt) : null, dedupe_key: n.dedupe, created_at: iso(n.createdAt),
  })));

  // Historique : les triggers ont daté les évènements à l'instant du seed ; on les remplace par une chronologie cohérente.
  must(await admin.from("lead_events").delete().eq("org_id", org), "purge évènements");
  const events: Row[] = [];
  const initialId = statusId(tpl.statuses.find((s) => s.initial)!.key);
  const nowMs = Date.now();
  for (const l of gen.leads) {
    const base = { org_id: org, lead_id: l.id };
    events.push({ ...base, type: "created", payload: { status_id: initialId }, actor_id: uid(l.createdByKey), created_at: iso(l.createdAt) });
    if (l.assignedKey) events.push({ ...base, type: "assigned", payload: { from: null, to: userId[l.assignedKey] }, actor_id: uid(l.createdByKey) ?? userId[spec.adminKey], created_at: iso(new Date(l.createdAt.getTime() + 60_000)) });
    for (const t of l.transitions) events.push({ ...base, type: "status_changed", payload: { from: statusId(t.fromKey), to: statusId(t.toKey), from_name: nameOfKey(t.fromKey), to_name: nameOfKey(t.toKey) }, actor_id: userId[t.actorKey], created_at: iso(t.at) });
    for (const n of l.notes) events.push({ ...base, type: "note", payload: { note_id: n.id }, actor_id: userId[n.authorKey], created_at: iso(n.at) });
    for (const c of l.calls) events.push({ ...base, type: "call", payload: { call_id: c.id, outcome: c.outcome, duration: c.durationSeconds }, actor_id: userId[c.callerKey], created_at: iso(c.at) });
    for (const a of l.appointments) {
      events.push({ ...base, type: "appointment", payload: { appointment_id: a.id, action: "created", starts_at: iso(a.startsAt), status: "planned", assigned_to: userId[a.assignedKey], distance_status: a.distanceStatus, override_reason: a.override ? a.overrideReason : null }, actor_id: userId[a.createdByKey], created_at: iso(a.createdAt) });
      if (a.status !== "planned") events.push({ ...base, type: "appointment", payload: { appointment_id: a.id, action: a.status === "cancelled" ? "cancelled" : "status", starts_at: iso(a.startsAt), status: a.status, assigned_to: userId[a.assignedKey], distance_status: a.distanceStatus }, actor_id: userId[a.assignedKey], created_at: iso(new Date(Math.min(a.status === "confirmed" ? a.createdAt.getTime() + 3_600_000 : a.startsAt.getTime() + 2 * 3_600_000, nowMs - 60_000))) });
    }
  }
  await insertAll(admin, "lead_events", events);
}
