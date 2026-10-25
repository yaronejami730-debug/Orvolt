import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import Stripe from "stripe";
import { fillEnergyRequired } from "./helpers";
import { expect, test, type APIRequestContext } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const WHSEC = "whsec_e2e_test_secret"; // identique à playwright.config.ts (stripe-mock + secret de test, aucune clé réelle)
const run = Date.now().toString(36);
const owner = { name: "Bruno Billing", email: `bill-${run}@e2e.test`, password: "Passw0rd!e2e", org: `Bill ${run}` };
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let clock = Math.floor(Date.now() / 1000) + 10_000;
let n = 0;

async function webhook(request: APIRequestContext, type: string, object: unknown, secret = WHSEC) {
  const payload = JSON.stringify({ id: `evt_e2e_${run}_${++n}`, object: "event", type, created: ++clock, data: { object } });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return request.post("/api/stripe/webhook", { data: payload, headers: { "content-type": "application/json", "stripe-signature": header } });
}
const sub = (orgId: string, customer: string, id: string, o: Record<string, unknown> = {}) => ({
  id, customer, status: "active", metadata: { org_id: orgId }, cancel_at_period_end: false, trial_end: null,
  items: { data: [{ id: "si_e2e", price: { id: "price_pro", lookup_key: "leadforge_pro_monthly", metadata: {} }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] }, ...o,
});

test.afterAll(async () => {
  const a = admin();
  await a.from("organizations").delete().eq("name", owner.org);
  const { data } = await a.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email?.endsWith(`-${run}@e2e.test`)) await a.auth.admin.deleteUser(u.id);
});

test("page tarifs publique : 3 plans et accès à l'inscription", async ({ page }) => {
  await page.goto("/pricing");
  for (const [price, seats] of [["9,90", "Jusqu'à 3 utilisateurs"], ["79", "Jusqu'à 10 utilisateurs"], ["199", "Utilisateurs illimités"]] as const) {
    await expect(page.getByText(seats).first()).toBeVisible();
    await expect(page.getByText(price).first()).toBeVisible();
  }
  await expect(page.locator('a[href="/signup"]').first()).toBeVisible();
});

test("abonnement : essai -> Checkout simulé -> webhooks signés -> actif ; échec de paiement ; annulation en lecture seule", async ({ page, request }) => {
  await page.goto("/signup");
  await page.getByLabel("Votre nom").fill(owner.name);
  await page.getByLabel("Nom de l'entreprise").fill(owner.org);
  await page.getByLabel("E-mail").fill(owner.email);
  await page.getByLabel("Mot de passe").fill(owner.password);
  await page.getByTestId("template-energie").click();
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  const db = admin();
  const orgId = (await db.from("organizations").select("id").eq("name", owner.org).single()).data!.id as string;

  // Essai en cours : bandeau, 5 sièges, comparatif des plans
  await page.goto("/settings/billing");
  await expect(page.getByTestId("billing-banner")).toContainText("Essai gratuit : 14 jours restants");
  await expect(page.getByTestId("billing-state")).toHaveText("Essai en cours");
  await expect(page.getByTestId("billing-seats")).toContainText("1 / 5");
  for (const id of ["starter", "pro", "business"]) await expect(page.getByTestId(`plan-${id}`)).toBeVisible();

  // Souscrire au plan Pro : session Checkout créée par stripe-mock, redirection vers l'adresse Stripe (interceptée)
  await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><meta charset=utf-8><h1>Stripe Checkout (simulé)</h1>" }));
  await page.getByTestId("plan-pro").getByRole("button", { name: "Souscrire" }).click();
  await expect(page.getByRole("heading", { name: "Stripe Checkout (simulé)" })).toBeVisible();
  expect(page.url()).toContain("checkout.stripe.com");
  const customer = (await db.from("organizations").select("stripe_customer_id").eq("id", orgId).single()).data!.stripe_customer_id as string;
  expect(customer).toMatch(/^cus_/); // client Stripe créé et lié à l'organisation

  // Retour de Checkout : activation en cours tant que le webhook n'est pas arrivé
  await page.goto("/settings/billing?checkout=success");
  await expect(page.getByTestId("checkout-success")).toContainText("activation");

  // Webhooks signés : mauvaise signature refusée, puis checkout.session.completed + abonnement actif
  const bad = await webhook(request, "customer.subscription.updated", sub(orgId, customer, "sub_e2e_1"), "whsec_pas_le_bon");
  expect(bad.status()).toBe(400);
  expect((await webhook(request, "checkout.session.completed", { mode: "subscription", client_reference_id: orgId, customer, subscription: "sub_e2e_1", metadata: { org_id: orgId } })).status()).toBe(200);
  const upd = await webhook(request, "customer.subscription.updated", sub(orgId, customer, "sub_e2e_1"));
  expect(upd.status()).toBe(200);
  expect(await upd.json()).toMatchObject({ result: "processed" });
  await expect(page.getByTestId("billing-state")).toHaveText("Actif"); // la page se rafraîchit seule
  await expect(page.getByRole("heading", { name: "Plan Pro" })).toBeVisible();
  await expect(page.getByTestId("billing-seats")).toContainText("1 / 10");
  await expect(page.getByTestId("billing-banner")).toHaveCount(0);
  await expect(page.getByTestId("plan-pro")).toContainText("Plan actuel");
  await expect(page.getByRole("button", { name: /Gérer l'abonnement/ })).toBeVisible();

  // Accès débloqué : création de lead
  await page.goto("/leads");
  await page.getByRole("button", { name: "Créer un lead" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Client Abonné");
  await fillEnergyRequired(page);
  await page.getByRole("button", { name: "Créer le lead" }).click();
  await expect(page.getByTestId("lead-card-Client Abonné")).toBeVisible();

  // Échec de paiement : bandeau d'alerte, délai de grâce (écriture encore permise)
  expect((await webhook(request, "invoice.payment_failed", { customer, subscription_details: { metadata: { org_id: orgId } } })).status()).toBe(200);
  await page.goto("/settings/billing");
  await expect(page.getByTestId("billing-banner")).toContainText("paiement de votre abonnement a échoué");
  await expect(page.getByTestId("billing-state")).toHaveText("Paiement échoué");
  expect(await page.getByTestId("billing-banner").getAttribute("role")).toBe("alert");

  // Paiement régularisé puis annulation : lecture seule, redirection douce, écritures refusées, données conservées
  expect((await webhook(request, "invoice.paid", { customer })).status()).toBe(200);
  expect((await webhook(request, "customer.subscription.deleted", sub(orgId, customer, "sub_e2e_1", { status: "canceled" }))).status()).toBe(200);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/settings\/billing/);
  await expect(page.getByTestId("billing-banner")).toContainText("lecture seule");
  await expect(page.getByTestId("billing-state")).toHaveText("Annulé");
  await page.goto("/leads");
  await expect(page.getByTestId("lead-card-Client Abonné")).toBeVisible(); // lecture conservée
  await page.getByRole("button", { name: "Nouveau lead" }).first().click();
  await page.getByLabel("Nom", { exact: true }).fill("Refusé");
  await fillEnergyRequired(page);
  await page.getByRole("button", { name: "Créer le lead" }).click();
  await expect(page.getByText(/lecture seule/).first()).toBeVisible();
  expect((await db.from("leads").select("id").eq("org_id", orgId).eq("last_name", "Refusé")).data).toEqual([]);

  // Configuration gelée aussi : statut, champ, membre refusés avec le message clair, rien créé en base
  await page.goto("/settings/statuses");
  await page.getByRole("button", { name: "Ajouter un statut" }).click();
  await page.locator("#new-status-name").fill("Interdit");
  await page.getByRole("button", { name: "Créer le statut" }).click();
  await expect(page.getByText(/Abonnement inactif : lecture seule/).first()).toBeVisible();
  await page.goto("/settings/fields");
  await page.getByRole("button", { name: "Nouveau champ" }).first().click();
  await page.getByLabel("Nom", { exact: true }).fill("Champ interdit");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Abonnement inactif : lecture seule/).first()).toBeVisible();
  await page.goto("/settings/members");
  await expect(page.getByTestId("billing-banner").getByRole("link", { name: "Réactiver l'abonnement" })).toHaveAttribute("href", "/settings/billing");
  await page.getByRole("button", { name: "Ajouter un membre" }).click();
  await page.getByLabel("Nom complet").fill("Membre Interdit");
  await page.getByLabel("E-mail").fill(`interdit-${run}@e2e.test`);
  await page.getByLabel("Mot de passe temporaire").fill("Passw0rd!e2e");
  await page.getByLabel("Rôle", { exact: true }).selectOption({ label: "Commercial" });
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByText(/Abonnement inactif : lecture seule/).first()).toBeVisible();
  expect((await db.from("statuses").select("id").eq("org_id", orgId).eq("name", "Interdit")).data).toEqual([]);
  expect((await db.from("custom_fields").select("id").eq("org_id", orgId).eq("label", "Champ interdit")).data).toEqual([]);
  expect((await db.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", orgId)).count).toBe(1);

  // Réabonnement : nouvel abonnement actif, accès rétabli
  expect((await webhook(request, "customer.subscription.created", sub(orgId, customer, "sub_e2e_2"))).status()).toBe(200);
  await page.goto("/settings/billing");
  await expect(page.getByTestId("billing-state")).toHaveText("Actif");

  // Mobile : aucun débordement horizontal
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/settings/billing");
  await expect(page.getByTestId("plans")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
