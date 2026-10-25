import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTemplate } from "@/lib/apply-template";
import { generateSecret, generateToken } from "@/lib/inbound/auth";
import { normalizePhone } from "@/lib/leads/normalize";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let orgA = "", orgB = "";
const ep: Record<string, { id: string; token: string }> = {};
const job: Record<string, string> = {};

async function makeUser(tag: string): Promise<U> {
  const email = `ii-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}
async function endpoint(org: string, name: string) {
  const sec = generateSecret();
  const token = generateToken();
  const r = await admin.from("inbound_endpoints").insert({ org_id: org, name, kind: "generic", token, secret_hash: sec.hash, secret_prefix: sec.prefix }).select("id").single();
  if (r.error) throw r.error;
  return { id: r.data.id as string, token };
}

beforeAll(async () => {
  const [a, b, com, imp] = await Promise.all(["a", "b", "com", "imp"].map(makeUser));
  orgA = (await a!.client.rpc("create_organization", { p_name: `II A ${run}`, p_template: "generic" })).data as string;
  orgB = (await b!.client.rpc("create_organization", { p_name: `II B ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(orgA, "generic");
  await applyTemplate(orgB, "generic");
  const rid = async (org: string, n: string) => (await admin.from("roles").select("id").eq("org_id", org).eq("name", n).single()).data!.id as string;
  // Prospecteur = leads.import sans settings.manage ; Commercial = ni l'un ni l'autre
  for (const [u, role] of [[com!, "Commercial"], [imp!, "Prospecteur"]] as const) {
    await admin.from("profiles").update({ provisioned_org: orgA }).eq("id", u.id);
    await admin.from("memberships").insert({ org_id: orgA, user_id: u.id, role_id: await rid(orgA, role) });
  }
  ep.A = await endpoint(orgA, "A hook");
  ep.B = await endpoint(orgB, "B hook");
  const st = (await admin.from("statuses").select("id").eq("org_id", orgB).eq("is_initial", true).single()).data!.id;
  const lead = (await admin.from("leads").insert({ org_id: orgB, status_id: st, last_name: "L" }).select("id").single()).data!.id;
  await admin.from("inbound_events").insert([{ org_id: orgA, endpoint_id: ep.A!.id, status: "created", payload: { a: 1 } }, { org_id: orgB, endpoint_id: ep.B!.id, status: "created", lead_id: lead }]);
  for (const [k, org, u] of [["A", orgA, a!], ["B", orgB, b!], ["imp", orgA, imp!]] as const) {
    job[k] = (await admin.from("import_jobs").insert({ org_id: org, user_id: u.id, filename: `${k}.csv` }).select("id").single()).data!.id;
  }
});

afterAll(async () => {
  for (const id of [orgA, orgB]) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("isolation A/B", () => {
  it("import_jobs, inbound_endpoints, inbound_events : rien de lisible ni d'écrivable chez B", async () => {
    const a = users.a!.client;
    expect((await a.from("import_jobs").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await a.from("inbound_endpoints").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await a.from("inbound_events").select("id").eq("org_id", orgB)).data).toEqual([]);
    expect((await a.from("inbound_endpoints").select("id").eq("org_id", orgA)).data).toHaveLength(1);
    for (const t of ["import_jobs", "inbound_endpoints", "inbound_events"] as const) {
      expect((await a.from(t).update({ org_id: orgA }).eq("org_id", orgB).select("id")).error ?? null, t).not.toBeNull();
      expect((await a.from(t).delete().eq("org_id", orgB).select("id")).error ?? null, t).not.toBeNull();
    }
    expect((await admin.from("inbound_endpoints").select("id").eq("org_id", orgB)).data).toHaveLength(1);
    expect((await createClient(URL, ANON, opts).from("inbound_endpoints").select("id")).error).not.toBeNull();
  });
  it("aucun client n'écrit ces tables (insertion refusée même dans sa propre org)", async () => {
    const a = users.a!.client;
    expect((await a.from("inbound_endpoints").insert({ org_id: orgA, name: "x", kind: "generic", token: "t".repeat(40), secret_hash: "a".repeat(64), secret_prefix: "lfs_abcd" })).error).not.toBeNull();
    expect((await a.from("inbound_events").insert({ org_id: orgA, endpoint_id: ep.A!.id, status: "created" })).error).not.toBeNull();
    expect((await a.from("import_jobs").insert({ org_id: orgA, user_id: users.a!.id, filename: "x.csv" })).error).not.toBeNull();
    expect((await a.from("inbound_endpoints").update({ active: false }).eq("id", ep.A!.id)).error).not.toBeNull();
  });
});

describe("secrets", () => {
  it("secret_hash n'est jamais lisible par un client (colonne, *, filtre)", async () => {
    const a = users.a!.client;
    expect((await a.from("inbound_endpoints").select("secret_hash")).error).not.toBeNull();
    expect((await a.from("inbound_endpoints").select("*")).error).not.toBeNull();
    expect((await a.from("inbound_endpoints").select("id").like("secret_hash", "a%")).error).not.toBeNull();
    const ok = await a.from("inbound_endpoints").select("id, name, token, secret_prefix");
    expect(ok.error).toBeNull();
    expect(JSON.stringify(ok.data)).not.toMatch(/[0-9a-f]{64}/);
  });
  it("secret d'application Meta chiffré : jamais lisible par un client ; indicateur et version lisibles", async () => {
    const a = users.a!.client;
    await admin.from("inbound_endpoints").update({ meta_app_secret_enc: "v1.x.y.z" }).eq("id", ep.A!.id);
    expect((await a.from("inbound_endpoints").select("meta_app_secret_enc")).error).not.toBeNull();
    const ok = await a.from("inbound_endpoints").select("id, secret_version, has_meta_secret").eq("id", ep.A!.id).single();
    expect(ok.error).toBeNull();
    expect(ok.data!.has_meta_secret).toBe(true);
    expect((await a.from("organizations").update({ inbound_daily_limit: 999999 }).eq("id", orgA)).error).not.toBeNull(); // plafond réservé au serveur
  });
  it("le hachage stocké ne permet pas de retrouver le secret ; jetons uniques", async () => {
    const s = generateSecret();
    expect(s.hash).toHaveLength(64);
    expect(s.hash).not.toContain(s.secret.slice(4, 12));
    expect((await admin.from("inbound_endpoints").insert({ org_id: orgA, name: "dup", kind: "generic", token: ep.A!.token, secret_hash: s.hash, secret_prefix: s.prefix })).error).not.toBeNull();
    expect((await admin.from("inbound_endpoints").insert({ org_id: orgA, name: "court", kind: "generic", token: "court", secret_hash: s.hash, secret_prefix: s.prefix })).error).not.toBeNull();
    expect((await admin.from("inbound_endpoints").insert({ org_id: orgA, name: "kind", kind: "autre", token: generateToken(), secret_hash: s.hash, secret_prefix: s.prefix })).error).not.toBeNull();
  });
});

describe("permissions", () => {
  it("endpoints et journal : réservés à settings.manage", async () => {
    expect((await users.imp!.client.from("inbound_endpoints").select("id")).data).toEqual([]);
    expect((await users.com!.client.from("inbound_endpoints").select("id")).data).toEqual([]);
    expect((await users.imp!.client.from("inbound_events").select("id")).data).toEqual([]);
  });
  it("jobs d'import : leads.import requis, visibles par leur auteur (ou admin)", async () => {
    expect((await users.imp!.client.from("import_jobs").select("id")).data!.map((j) => j.id)).toEqual([job.imp]);
    expect((await users.com!.client.from("import_jobs").select("id")).data).toEqual([]);
    expect((await users.a!.client.from("import_jobs").select("id")).data!.map((j) => j.id).sort()).toEqual([job.A, job.imp].sort());
  });
  it("une FK cross-org (événement d'un endpoint d'une autre org) est refusée", async () => {
    expect((await admin.from("inbound_events").insert({ org_id: orgA, endpoint_id: ep.B!.id, status: "created" })).error).not.toBeNull();
  });
});

describe("rétention et normalisation SQL", () => {
  it("purge : les payloads anciens sont effacés, les très anciens événements supprimés", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const older = new Date(Date.now() - 120 * 86_400_000).toISOString();
    await admin.from("inbound_events").insert([
      { org_id: orgA, endpoint_id: ep.A!.id, status: "created", payload: { email: "x" }, received_at: old },
      { org_id: orgA, endpoint_id: ep.A!.id, status: "created", payload: { email: "y" }, received_at: older },
    ]);
    const r = await admin.rpc("purge_inbound_events", { p_days: 90, p_mask_days: 14 });
    expect(r.error).toBeNull();
    expect(r.data).toBeGreaterThanOrEqual(1);
    const { data } = await admin.from("inbound_events").select("payload, received_at").eq("endpoint_id", ep.A!.id);
    expect(data!.find((e) => e.received_at.startsWith(older.slice(0, 10)))).toBeUndefined();
    expect(data!.find((e) => e.received_at.startsWith(old.slice(0, 10)))!.payload).toBeNull();
    expect((await users.a!.client.rpc("purge_inbound_events", {})).error).not.toBeNull();
  });
  it("normalize_phone SQL = normalizePhone TS", async () => {
    for (const p of ["06 12 34 56 78", "+33 6 12 34 56 78", "0033612345678", "33612345678", "+44 20 7946 0958", "12345", "abc", "(06) 12-34-56-78", "0112233445"]) {
      const { data } = await admin.rpc("normalize_phone", { p });
      expect(data ?? null, p).toBe(normalizePhone(p));
    }
  });
  it("colonnes dérivées email_norm / phone_norm utilisables pour le dédoublonnage", async () => {
    const st = (await admin.from("statuses").select("id").eq("org_id", orgA).eq("is_initial", true).single()).data!.id;
    await admin.from("leads").insert({ org_id: orgA, status_id: st, last_name: "Norm", email: "  Jean@Example.COM ", phone: "06 12 34 56 78" });
    const r = await admin.from("leads").select("email_norm, phone_norm").eq("org_id", orgA).eq("last_name", "Norm").single();
    expect(r.data).toEqual({ email_norm: "jean@example.com", phone_norm: "+33612345678" });
  });
  it("bucket imports privé : aucun accès client", async () => {
    expect((await users.a!.client.storage.from("imports").list()).data ?? []).toEqual([]);
    expect((await users.a!.client.storage.from("imports").upload(`${orgA}/x.csv`, new Blob(["a"], { type: "text/csv" }))).error).not.toBeNull();
  });
});
