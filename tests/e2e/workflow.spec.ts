import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { signupViaForm } from "./helpers";
import { expect, test } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const run = Date.now().toString(36);
const owner = { name: "Walter Workflow", email: `wf-${run}@e2e.test`, password: "Passw0rd!e2e", org: `Énergie ${run}` };

test.afterAll(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  await admin.from("organizations").delete().eq("name", owner.org);
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email?.endsWith(`-${run}@e2e.test`)) await admin.auth.admin.deleteUser(u.id);
});

const names = (page: import("@playwright/test").Page) => page.locator('[data-testid^="status-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("status-", "")));

test("template Énergies : statuts, champs, puis personnalisation", async ({ page }) => {
  // Inscription avec le template Énergies
  await signupViaForm(page, { first: "Test", last: owner.name, email: owner.email, password: owner.password, org: owner.org, phone: "0612345678", siret: "73282932000074" });
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: /Énergies.*prêt/ })).toBeVisible();
  await expect(page.getByTestId("onboarding-statuses")).toContainText("Devis envoyé");
  await expect(page.getByTestId("onboarding-fields")).toContainText("Type de chauffage");
  await expect(page.getByTestId("onboarding-sources")).toContainText("Meta Ads");

  // Statuts et champs présents dans les réglages
  await page.goto("/settings/statuses");
  await expect(page.getByTestId("status-Signé")).toBeVisible();
  await expect(page.getByTestId("status-Perdu")).toBeVisible();
  await page.goto("/settings/fields");
  for (const label of ["Type de chauffage", "Surface habitable (m²)", "Classe DPE"]) await expect(page.getByTestId(`field-${label}`)).toBeVisible();

  // Création d'un statut
  await page.goto("/settings/statuses");
  await page.getByRole("button", { name: "Ajouter un statut" }).click();
  await page.locator("#new-status-name").fill("Chaud");
  await page.getByRole("button", { name: "Créer le statut" }).click();
  await expect(page.getByTestId("status-Chaud")).toBeVisible();

  // Modification de la couleur
  await page.getByTestId("status-Chaud").locator("button", { hasText: "Chaud" }).click();
  await page.getByRole("radio", { name: "Rouge" }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Statut enregistré.")).toBeVisible();
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.reload();
  await page.getByTestId("status-Chaud").locator("button", { hasText: "Chaud" }).click();
  await expect(page.getByRole("radio", { name: "Rouge" })).toBeChecked();
  await page.getByRole("button", { name: "Fermer", exact: true }).click();

  // Réordonnancement (boutons clavier) : Chaud passe avant Perdu
  const before = await names(page);
  expect(before.indexOf("Chaud")).toBeGreaterThan(before.indexOf("Perdu"));
  await page.getByRole("button", { name: "Monter Chaud" }).click();
  await page.getByRole("button", { name: "Monter Chaud" }).click();
  await expect.poll(async () => { const n = await names(page); return n.indexOf("Chaud") < n.indexOf("Perdu"); }).toBe(true);
  // Cause racine des échecs intermittents : l'ordre est enregistré en arrière-plan ; recharger avant la fin de l'écriture
  // (le test ne contrôlait que l'affichage optimiste) annulait l'enregistrement. On attend l'indicateur « enregistrement terminé ».
  await expect(page.locator("ul[data-saving]").first()).toHaveAttribute("data-saving", "false");
  await page.reload();
  const after = await names(page);
  expect(after.indexOf("Chaud")).toBeLessThan(after.indexOf("Perdu"));

  // Transition par rôle : Commercial peut passer de Nouveau vers Chaud
  await page.getByTestId("status-Nouveau").locator("button", { hasText: "Nouveau" }).click();
  await page.getByRole("tab", { name: "Transitions" }).click();
  const box = page.getByRole("checkbox", { name: "Commercial : Nouveau vers Chaud" });
  await box.click();
  await page.getByRole("button", { name: "Enregistrer les transitions" }).click();
  await expect(page.getByText("Transitions enregistrées.")).toBeVisible();
  await page.reload();
  await page.getByTestId("status-Nouveau").locator("button", { hasText: "Nouveau" }).click();
  await page.getByRole("tab", { name: "Transitions" }).click();
  await expect(page.getByRole("checkbox", { name: "Commercial : Nouveau vers Chaud" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Prospecteur : Nouveau vers Chaud" })).not.toBeChecked();

  // Champ personnalisé
  await page.goto("/settings/fields");
  await page.getByRole("button", { name: "Nouveau champ" }).first().click();
  await page.getByLabel("Nom", { exact: true }).fill("Puissance souhaitée");
  await page.getByRole("radio", { name: "Nombre" }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("field-Puissance souhaitée")).toBeVisible();

  // Sources
  await page.goto("/settings/sources");
  await expect(page.getByTestId("source-Meta Ads")).toBeVisible();
  await expect(page.getByTestId("source-Import CSV")).toContainText("Système");
});
