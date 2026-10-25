import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyTemplate } from "@/lib/apply-template";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
const run = Math.random().toString(36).slice(2, 8);

interface U { id: string; client: SupabaseClient }
const users: Record<string, U> = {};
let orgA = "", orgB = "";

async function makeUser(tag: string): Promise<U> {
  const email = `bl-${tag}-${run}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!test", email_confirm: true });
  if (error) throw error;
  const client = createClient(URL, ANON, opts);
  await client.auth.signInWithPassword({ email, password: "Passw0rd!test" });
  return (users[tag] = { id: data.user.id, client });
}

beforeAll(async () => {
  const [a, b, m] = await Promise.all(["a", "b", "m"].map(makeUser));
  orgA = (await a!.client.rpc("create_organization", { p_name: `BL A ${run}`, p_template: "generic" })).data as string;
  orgB = (await b!.client.rpc("create_organization", { p_name: `BL B ${run}`, p_template: "generic" })).data as string;
  await applyTemplate(orgA, "generic");
  await applyTemplate(orgB, "generic");
  const role = (await admin.from("roles").select("id").eq("org_id", orgA).eq("name", "Commercial").single()).data!.id;
  await admin.from("profiles").update({ provisioned_org: orgA }).eq("id", m!.id);
  await admin.from("memberships").insert({ org_id: orgA, user_id: m!.id, role_id: role });
  await admin.from("stripe_events").insert([{ id: `evt_a_${run}`, type: "invoice.paid", org_id: orgA, event_created: new Date().toISOString() }, { id: `evt_b_${run}`, type: "invoice.paid", org_id: orgB, event_created: new Date().toISOString() }]);
});
afterAll(async () => {
  await admin.from("stripe_events").delete().like("id", `%_${run}`);
  for (const id of [orgA, orgB]) await admin.from("organizations").delete().eq("id", id);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

describe("stripe_events", () => {
  it("aucun accès client : lecture, écriture, modification, suppression refusées (admin d'organisation compris)", async () => {
    for (const u of ["a", "m"]) {
      const c = users[u]!.client;
      expect((await c.from("stripe_events").select("id")).error, u).not.toBeNull();
      expect((await c.from("stripe_events").insert({ id: `evt_x_${run}`, type: "x", event_created: new Date().toISOString() })).error).not.toBeNull();
      expect((await c.from("stripe_events").update({ status: "ignored" }).eq("id", `evt_a_${run}`)).error).not.toBeNull();
      expect((await c.from("stripe_events").delete().eq("id", `evt_a_${run}`)).error).not.toBeNull();
    }
    expect((await createClient(URL, ANON, opts).from("stripe_events").select("id")).error).not.toBeNull();
    expect((await admin.from("stripe_events").select("id").like("id", `%_${run}`)).data).toHaveLength(2);
  });
  it("l'idempotence repose sur la clé primaire (doublon refusé)", async () => {
    const r = await admin.from("stripe_events").insert({ id: `evt_a_${run}`, type: "invoice.paid", event_created: new Date().toISOString() });
    expect(r.error?.code).toBe("23505");
  });
});

describe("colonnes de facturation", () => {
  it("non modifiables par un client, y compris l'administrateur de l'organisation", async () => {
    const a = users.a!.client;
    for (const patch of [
      { plan: "business" }, { subscription_status: "active" }, { seat_limit: 999 }, { trial_ends_at: "2099-01-01T00:00:00Z" },
      { stripe_customer_id: "cus_x" }, { stripe_subscription_id: "sub_x" }, { current_period_end: "2099-01-01T00:00:00Z" },
      { cancel_at_period_end: true }, { past_due_since: null }, { stripe_event_at: "2099-01-01T00:00:00Z" }, { inbound_daily_limit: 999999 }, { webhook_secret_version: 9 },
    ]) {
      expect((await a.from("organizations").update(patch).eq("id", orgA)).error, JSON.stringify(patch)).not.toBeNull();
    }
    expect(await admin.from("organizations").select("plan, subscription_status, seat_limit").eq("id", orgA).single().then((r) => r.data)).toMatchObject({ plan: "trial", subscription_status: "trialing", seat_limit: 5 });
  });
  it("isolation A/B : l'organisation voisine et ses identifiants Stripe restent invisibles", async () => {
    await admin.from("organizations").update({ stripe_customer_id: `cus_b_${run}` }).eq("id", orgB);
    expect((await users.a!.client.from("organizations").select("id, stripe_customer_id").eq("id", orgB)).data).toEqual([]);
    expect((await users.b!.client.from("organizations").select("stripe_customer_id").eq("id", orgB).single()).data!.stripe_customer_id).toBe(`cus_b_${run}`);
  });
});

describe("lecture seule en base", () => {
  const setStatus = (org: string, patch: Record<string, unknown>) => admin.from("organizations").update(patch).eq("id", org);
  const st = async (org: string) => (await admin.from("statuses").select("id").eq("org_id", org).eq("is_initial", true).single()).data!.id as string;

  it("org_is_writable : essai en cours, expiré, actif, grâce, annulé", async () => {
    const w = async () => (await users.a!.client.rpc("org_is_writable", { org: orgA })).data;
    expect(await w()).toBe(true);
    await setStatus(orgA, { trial_ends_at: new Date(Date.now() - 1000).toISOString() });
    expect(await w()).toBe(false);
    await setStatus(orgA, { subscription_status: "active" });
    expect(await w()).toBe(true);
    await setStatus(orgA, { subscription_status: "past_due", past_due_since: new Date(Date.now() - 6 * 86_400_000).toISOString() });
    expect(await w()).toBe(true);
    await setStatus(orgA, { past_due_since: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    expect(await w()).toBe(false);
    for (const s of ["canceled", "unpaid", "incomplete"]) { await setStatus(orgA, { subscription_status: s }); expect(await w(), s).toBe(false); }
    expect((await users.a!.client.rpc("org_is_writable", { org: crypto.randomUUID() })).data).toBe(true); // non-membre : réponse neutre (aucune fuite)
    expect((await createClient(URL, ANON, opts).rpc("org_is_writable", { org: orgA })).error).not.toBeNull();
    await setStatus(orgA, { subscription_status: "trialing", trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(), past_due_since: null });
  });
  it("organisation en lecture seule : plus aucune écriture métier d'un client, lecture et service_role intacts", async () => {
    await setStatus(orgA, { subscription_status: "canceled" });
    const a = users.a!.client;
    const status = await st(orgA);
    const lead = await admin.from("leads").insert({ org_id: orgA, status_id: status, last_name: "Existant", created_by: users.a!.id }).select("id").single();
    const errs = await Promise.all([
      a.from("leads").insert({ org_id: orgA, status_id: status, last_name: "Nouveau", created_by: users.a!.id }),
      a.from("leads").update({ first_name: "x" }).eq("id", lead.data!.id),
      a.from("lead_notes").insert({ org_id: orgA, lead_id: lead.data!.id, body: "note" }),
      a.from("lead_calls").insert({ org_id: orgA, lead_id: lead.data!.id, outcome: "answered" }),
      a.from("tasks").insert({ org_id: orgA, lead_id: lead.data!.id, title: "t", created_by: users.a!.id }),
      a.from("appointments").insert({ org_id: orgA, lead_id: lead.data!.id, assigned_to: users.a!.id, starts_at: "2031-01-01T10:00:00Z", ends_at: "2031-01-01T11:00:00Z", created_by: users.a!.id }),
    ]);
    for (const e of errs) expect(e.error?.message).toContain("org_read_only");
    expect((await a.from("leads").select("id").eq("id", lead.data!.id)).data).toHaveLength(1);
    expect((await a.from("organizations").update({ name: `BL A renommée ${run}` }).eq("id", orgA)).error?.message).toContain("org_read_only"); // la configuration est gelée aussi
    expect((await admin.from("leads").insert({ org_id: orgA, status_id: status, last_name: "Service" })).error).toBeNull();
    // l'organisation voisine, elle, n'est pas affectée
    expect((await users.b!.client.from("leads").insert({ org_id: orgB, status_id: await st(orgB), last_name: "B ok", created_by: users.b!.id })).error).toBeNull();
    await setStatus(orgA, { subscription_status: "active" });
    expect((await a.from("leads").insert({ org_id: orgA, status_id: status, last_name: "Réactivé", created_by: users.a!.id })).error).toBeNull();
  });
  it("durée limite des requêtes clients : statement_timeout explicite sur authenticated et anon", async () => {
    const { data } = await admin.rpc("normalize_phone", { p: "0612345678" });
    expect(data).toBe("+33612345678");
    const out = await new Promise<string>((res) => {
      import("node:child_process").then(({ execFileSync }) => {
        try { res(execFileSync("docker", ["exec", "-i", "supabase_db_SAAS_CRM", "psql", "-U", "postgres", "-At", "-c", "select rolname || ':' || coalesce(rolconfig::text,'') from pg_roles where rolname in ('authenticated','anon') order by 1"], { encoding: "utf8", env: { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` } })); } catch { res("docker-indisponible"); }
      });
    });
    if (out !== "docker-indisponible") {
      expect(out).toContain("authenticated:{statement_timeout=8s}");
      expect(out).toContain("anon:{statement_timeout=3s}");
    }
  });
});
