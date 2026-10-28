import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { signupViaForm } from "./helpers";
import { expect, test, type Page } from "@playwright/test";
import { isFrenchHoliday } from "../../src/lib/dispatch/holidays";

config({ path: ".env.local", quiet: true });

/** Correctifs K : retours de la tournée I/J. Données jetables : société « [K-TEST] », source « [K-TEST] src », notifications taguées. */
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PASSWORD = "Demo1234!";
const ORG = "Énergie Verte Démo";
const CO = "[K-TEST]";
const run = Date.now().toString(36);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
const orgId = async () => (await admin.from("organizations").select("id").eq("name", ORG).single()).data!.id as string;
function workday(offset: number): string {
  let d = new Date(Date.now() + offset * 86_400_000);
  for (;;) {
    const ymd = d.toISOString().slice(0, 10);
    if (![0, 6].includes(d.getUTCDay()) && !isFrenchHoliday(ymd)) return ymd;
    d = new Date(d.getTime() + 86_400_000);
  }
}
async function cleanup() {
  const id = await orgId();
  await admin.from("leads").delete().eq("org_id", id).eq("company", CO);
  await admin.from("lead_sources").delete().eq("org_id", id).like("name", "[K-TEST]%");
  await admin.from("notifications").delete().eq("org_id", id).eq("type", "k-test");
}
async function mkLead(id: string, last: string, extra: object = {}) {
  const st = (await admin.from("statuses").select("id").eq("org_id", id).eq("is_initial", true).single()).data!.id;
  const r = await admin.from("leads").insert({ org_id: id, status_id: st, first_name: "Kay", last_name: `${last}${run}`, company: CO, address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.832, geo_precision: "housenumber", ...extra }).select("id").single();
  if (r.error) throw new Error(r.error.message);
  return r.data.id as string;
}
const zoneRep = async (id: string) => {
  const z = (await admin.from("sales_zones").select("user_id").eq("org_id", id).eq("active", true).order("user_id").limit(1).single()).data!;
  return { id: z.user_id as string, email: (await admin.auth.admin.getUserById(z.user_id)).data.user!.email! };
};

test.beforeAll(cleanup);
test.afterAll(cleanup);

test("confirmateur : Répartir automatiquement -> focus sur la proposition ; bannière selon la cause ; liste rafraîchie seule ; lead -> RDV pris", async ({ page }) => {
  test.setTimeout(150_000);
  const id = await orgId();
  const rep = await zoneRep(id);
  const day = workday(1);
  // RDV réparti à +5 jours signalé « à rééquilibrer » à cause d'une indisponibilité
  const far = workday(5);
  const farLead = await mkLead(id, "Loin");
  const ins = await admin.from("appointments").insert({
    org_id: id, lead_id: farLead, assigned_to: rep.id, starts_at: `${far}T15:20:00Z`, ends_at: `${far}T16:10:00Z`, status: "confirmed", dispatch_status: "assigned", dispatched_at: new Date().toISOString(),
    wish_from: far, wish_to: far, duration_min: 60, location_address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.832, geo_precision: "housenumber", geo_source: "ban", needs_rebalance: true, rebalance_reason: "unavailability",
  }).select("id").single();
  expect(ins.error).toBeNull();
  // RDV confirmé à attribuer, lead « Nouveau »
  const l1 = await mkLead(id, "Aattribuer");
  const a1 = await admin.from("appointments").insert({ org_id: id, lead_id: l1, status: "confirmed", dispatch_status: "unassigned", wish_from: day, wish_to: day, duration_min: 60, location_address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.832, geo_precision: "housenumber", geo_source: "ban" });
  expect(a1.error).toBeNull();
  expect((await admin.from("leads").select("statuses(name)").eq("id", l1).single()).data!.statuses).toMatchObject({ name: "RDV pris" });

  await login(page, "confirmateur@demo.test");
  await page.goto("/agenda/repartition");
  const banner = page.getByTestId("rebalance-banner");
  await expect(banner).toContainText("Indisponibilité déclarée");
  await expect(banner).not.toContainText("Position corrigée sur");

  await expect(page.getByTestId("pending-list")).toContainText(`Aattribuer${run}`);
  await page.getByTestId("dispatch-run").click();
  const heading = page.getByTestId("proposal-heading");
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByTestId("proposal")).toBeInViewport();

  // la liste se met à jour sans rechargement (sondage 30 s)
  const l2 = await mkLead(id, "Surgit");
  await page.reload();
  await expect(page.getByTestId("pending-list")).not.toContainText(`Surgit${run}`);
  const a2 = await admin.from("appointments").insert({ org_id: id, lead_id: l2, status: "confirmed", dispatch_status: "unassigned", wish_from: day, wish_to: day, duration_min: 60, location_address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.832, geo_precision: "housenumber", geo_source: "ban" });
  expect(a2.error).toBeNull();
  await expect(page.getByTestId("pending-list")).toContainText(`Surgit${run}`, { timeout: 45_000 });
});

test("commercial : « Ma tournée » montre un RDV rééquilibré à +5 jours", async ({ page }) => {
  const id = await orgId();
  const rep = await zoneRep(id);
  const far = workday(5);
  const lead = await mkLead(id, "Tournee", { assigned_to: rep.id }); // la répartition confie aussi le lead au commercial
  const ins = await admin.from("appointments").insert({
    org_id: id, lead_id: lead, assigned_to: rep.id, starts_at: `${far}T16:20:00Z`, ends_at: `${far}T17:00:00Z`, status: "confirmed", dispatch_status: "assigned", dispatched_at: new Date().toISOString(),
    wish_from: far, wish_to: far, duration_min: 40, location_address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.832, geo_precision: "housenumber", geo_source: "ban",
  });
  expect(ins.error).toBeNull();
  await login(page, rep.email);
  await page.goto("/agenda");
  await expect(page.getByTestId("my-tour")).toContainText(`Tournee${run}`);
});

test("cloche : la notification est un lien vers sa cible et se marque lue au clic", async ({ page }) => {
  const id = await orgId();
  const conf = (await admin.from("profiles").select("id").eq("email", "confirmateur@demo.test").single()).data!.id;
  const lead = await mkLead(id, "Cloche");
  const ins = await admin.from("notifications").insert({ org_id: id, user_id: conf, type: "k-test", payload: { message: `K-TEST ouvrir ${run}`, lead_id: lead } }).select("id").single();
  expect(ins.error).toBeNull();
  await login(page, "confirmateur@demo.test");
  const bell = page.getByTestId("bell");
  await bell.click();
  const item = page.getByRole("menuitem", { name: new RegExp(`K-TEST ouvrir ${run}`) });
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("href", `/leads/${lead}`);
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/leads/${lead}`));
  await expect.poll(async () => (await admin.from("notifications").select("read_at").eq("id", ins.data!.id).single()).data!.read_at).not.toBeNull();
});

test("paramètres : erreurs de validation effacées à la saisie ; renommage d'une source avec focus", async ({ page }) => {
  const id = await orgId();
  await admin.from("lead_sources").insert({ org_id: id, name: `[K-TEST] src ${run}` });
  await login(page, "admin.energies@demo.test");

  await page.goto("/settings/fields");
  await page.getByRole("button", { name: /Nouveau champ/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dlg.locator("#f-label-error")).toBeVisible();
  await dlg.getByLabel("Nom", { exact: true }).fill("K");
  await expect(dlg.locator("#f-label-error")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/settings/roles");
  await page.getByRole("button", { name: /Nouveau rôle/ }).click();
  const rd = page.getByRole("dialog");
  await rd.getByRole("button", { name: "Enregistrer" }).click();
  await expect(rd.getByRole("alert")).toBeVisible();
  await rd.getByLabel("Nom", { exact: true }).fill("K");
  await expect(rd.getByRole("alert")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/settings/sources");
  await page.getByRole("button", { name: `Renommer [K-TEST] src ${run}` }).click();
  const input = page.getByLabel("Renommer la source");
  await expect(input).toBeFocused();
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
});

test("facturation : sondage léger après retour de Checkout, arrêté quand l'état change", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `k-bill-${run}@e2e.test`;
  const orgName = `KBill ${run}`;
  try {
    await signupViaForm(page, { first: "Test", last: "Kay Bill", email: email, password: "Passw0rd!e2e", org: orgName, phone: "0612345678", siret: "73282932000074" });
    await expect(page).toHaveURL(/\/onboarding$/);
    const oid = (await admin.from("organizations").select("id").eq("name", orgName).single()).data!.id as string;
    let rsc = 0;
    page.on("request", (r) => { if (r.url().includes("/settings/billing") && r.headers()["rsc"] === "1") rsc++; });
    await page.goto("/settings/billing?checkout=success");
    await expect(page.getByTestId("checkout-success")).toContainText("activation");
    await expect.poll(() => rsc, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    await admin.from("organizations").update({ subscription_status: "active", stripe_subscription_id: `sub_k_${run}`, plan: "pro" }).eq("id", oid);
    await expect(page.getByTestId("billing-state")).toHaveText("Actif", { timeout: 20_000 });
    await page.waitForTimeout(1500);
    const after = rsc;
    await page.waitForTimeout(12_000);
    expect(rsc).toBe(after); // sondage arrêté
  } finally {
    await admin.from("organizations").delete().eq("name", orgName);
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of data?.users ?? []) if (u.email === email) await admin.auth.admin.deleteUser(u.id);
  }
});
