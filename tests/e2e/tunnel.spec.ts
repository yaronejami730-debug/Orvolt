import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import Stripe from "stripe";
import { expect, test } from "@playwright/test";

config({ path: ".env.local", quiet: true });

/**
 * Parcours complet CTA -> essai actif avec Stripe simulé. Exige un serveur où la formule est OBLIGATOIRE
 * (ONBOARDING_REQUIRE_PLAN=1, STRIPE_* de test) : E2E_PLAN_URL=http://localhost:3300 npx playwright test tunnel
 * (le serveur de test par défaut a ONBOARDING_REQUIRE_PLAN=0 et passerait l'étape formule).
 */
const URL_PLAN = process.env.E2E_PLAN_URL;
test.skip(!URL_PLAN, "E2E_PLAN_URL absent : serveur avec ONBOARDING_REQUIRE_PLAN=1 requis");
test.use({ baseURL: URL_PLAN });

const WHSEC = "whsec_e2e_test_secret";
const run = Date.now().toString(36);
const u = { first: "Tina", last: "Tunnel", email: `tun-${run}@e2e.test`, password: "Passw0rd!e2e", org: `Tunnel ${run}` };
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test.afterAll(async () => {
  const a = admin();
  await a.from("organizations").delete().eq("name", u.org);
  const { data } = await a.auth.admin.listUsers({ perPage: 200 });
  for (const x of data?.users ?? []) if (x.email === u.email) await a.auth.admin.deleteUser(x.id);
});

test("CTA tarifs (plan + annuel) -> compte -> récapitulatif -> Stripe -> annulation -> succès -> essai actif", async ({ page, request }) => {
  // 1. Le CTA de la page tarifs transporte la formule jusqu'à l'inscription.
  await page.goto("/pricing");
  await expect(page.locator('a[href^="/signup?plan="]').first()).toBeVisible();
  await page.goto("/signup?plan=pro&interval=year&src=e2e");
  await expect(page.getByTestId("signup-plan")).toContainText("Pro");
  await expect(page.getByTestId("step-counter")).toHaveText("Étape 1 sur 3");

  // 2. Erreur serveur (activité non choisie) : aucune saisie perdue, message clair.
  await page.getByLabel("E-mail professionnel").fill(u.email);
  await page.getByLabel("E-mail professionnel").blur();
  await page.getByTestId("dev-code").waitFor();
  await page.getByLabel("Code à 6 chiffres").fill(((await page.getByTestId("dev-code").innerText()).match(/\d{6}/) ?? [""])[0]);
  await page.getByTestId("email-verified").waitFor(); // le sixième chiffre valide seul
  await page.getByLabel("N° de SIRET").fill("73282932000074");
  await page.getByLabel("Nom de l'entreprise").fill(u.org);
  await page.getByLabel("Prénom").fill(u.first);
  await page.getByLabel("Nom", { exact: true }).fill(u.last);
  await page.getByLabel("Mot de passe").fill(u.password);
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page.getByText("Choisissez installateur ou régie.")).toBeVisible();
  await expect(page.getByLabel("Mot de passe")).toHaveValue(u.password);
  await expect(page.getByLabel("Nom de l'entreprise")).toHaveValue(u.org);

  // 3. Création : arrivée directe sur la formule déjà choisie (étape 2 sur 3), pas d'écran d'activité.
  await page.getByTestId("kind-agency").click();
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await expect(page).toHaveURL(/\/onboarding\/plan/);
  await expect(page.getByTestId("step-counter")).toHaveText("Étape 2 sur 3");
  await expect(page.getByTestId("plan-recap")).toContainText("Pro");
  await expect(page.getByTestId("recap-today")).toHaveText("0 €");
  await expect(page.getByTestId("recap-then")).toContainText("390");

  // 4. Un clic -> Stripe Checkout (hébergé, ici intercepté).
  await page.route("https://checkout.stripe.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Stripe Checkout (simulé)</h1>" }));
  await page.getByTestId("recap-continue").click();
  await expect(page.getByRole("heading", { name: "Stripe Checkout (simulé)" })).toBeVisible();

  // 5. Annulation : retour sur la même formule, message clair, nouvelle tentative possible.
  await page.goto("/onboarding/plan?checkout=cancel&plan=pro&interval=year");
  await expect(page.getByTestId("plan-cancelled")).toContainText("rien n'a été prélevé");
  await expect(page.getByTestId("recap-continue")).toBeEnabled();

  // 6. Succès : état « activation en cours » (étape 3 sur 3), puis webhooks signés -> redirection automatique.
  await page.goto("/onboarding/plan?checkout=success");
  await expect(page.getByTestId("plan-waiting")).toBeVisible();
  await expect(page.getByTestId("step-counter")).toHaveText("Étape 3 sur 3");
  const db = admin();
  const org = (await db.from("organizations").select("id, stripe_customer_id").eq("name", u.org).single()).data!;
  let n = 0;
  const hook = async (type: string, object: unknown) => {
    const payload = JSON.stringify({ id: `evt_tun_${run}_${++n}`, object: "event", type, created: Math.floor(Date.now() / 1000) + n, data: { object } });
    return request.post("/api/stripe/webhook", { data: payload, headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) } });
  };
  const sub = { id: `sub_tun_${run}`, customer: org.stripe_customer_id, status: "trialing", metadata: { org_id: org.id }, cancel_at_period_end: false, trial_end: Math.floor(Date.now() / 1000) + 14 * 86400, items: { data: [{ id: "si_t", price: { id: "price_pro", lookup_key: "leadforge_pro_yearly", metadata: {} }, current_period_end: Math.floor(Date.now() / 1000) + 14 * 86400 }] } };
  expect((await hook("checkout.session.completed", { mode: "subscription", client_reference_id: org.id, customer: org.stripe_customer_id, subscription: sub.id, metadata: { org_id: org.id } })).status()).toBe(200);
  expect((await hook("customer.subscription.created", sub)).status()).toBe(200);
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
  await page.getByRole("link", { name: "Commencer" }).click();
  await expect(page).toHaveURL(/\/leads/);
  const row = (await db.from("organizations").select("plan, subscription_status").eq("id", org.id).single()).data!;
  expect(row).toMatchObject({ plan: "pro", subscription_status: "trialing" });
});
