import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fillEnergyRequired, signupViaForm } from "./helpers";
import { expect, test, type Page } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const run = Date.now().toString(36);
const owner = { name: "Dana Dashboard", email: `dash-${run}@e2e.test`, password: "Passw0rd!e2e", org: `Dash ${run}` };
const rep = { name: "Camille Commerciale", email: `rep-${run}@e2e.test`, password: "TempPass!123" };
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function logout(page: Page) {
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: /Se déconnecter/ }).click();
  await expect(page).toHaveURL(/\/login/);
}
async function newLead(page: Page, first: string, last: string, value: string, openLabel: string, assignee?: string) {
  await page.getByRole("button", { name: openLabel }).first().click();
  await page.getByLabel("Prénom").fill(first);
  await page.getByLabel("Nom", { exact: true }).fill(last);
  await page.getByLabel(/Valeur/).fill(value);
  if (assignee) await page.getByLabel("Assigné à").selectOption({ label: assignee });
  await fillEnergyRequired(page);
  await page.getByRole("button", { name: "Créer le lead" }).click();
  await expect(page.getByTestId(`lead-card-${first} ${last}`)).toBeVisible();
}

test.afterAll(async () => {
  const a = admin();
  await a.from("organizations").delete().eq("name", owner.org);
  const { data } = await a.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email?.endsWith(`-${run}@e2e.test`)) await a.auth.admin.deleteUser(u.id);
});

test("tableau de bord : totaux exacts, période, filtres, vue restreinte, mobile", async ({ page }) => {
  await signupViaForm(page, { first: "Test", last: owner.name, email: owner.email, password: owner.password, org: owner.org, phone: "0612345678", siret: "73282932000074" });
  await expect(page).toHaveURL(/\/onboarding$/);

  // Dashboard vide
  await page.goto("/dashboard");
  await expect(page.getByText("Pas encore de leads sur la période")).toBeVisible();
  await expect(page.getByTestId("kpi-created-value")).toHaveText("0");

  // Membre Commercial (dashboard.view accordé par l'administrateur de la base de test)
  await page.goto("/settings/members");
  await page.getByRole("button", { name: "Ajouter un membre" }).click();
  await page.getByLabel("Nom complet").fill(rep.name);
  await page.getByLabel("E-mail").fill(rep.email);
  await page.getByLabel("Mot de passe temporaire").fill(rep.password);
  await page.getByLabel("Rôle", { exact: true }).selectOption({ label: "Commercial" });
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByText(rep.email).first()).toBeVisible();
  const a = admin();
  const org = (await a.from("organizations").select("id").eq("name", owner.org).single()).data!.id;
  const role = (await a.from("roles").select("id, permissions").eq("org_id", org).eq("name", "Commercial").single()).data!;
  await a.from("roles").update({ permissions: [...role.permissions, "dashboard.view"] }).eq("id", role.id);

  // 3 leads (valeurs 1000, 500, 250), le premier gagné
  await page.goto("/leads");
  await page.getByRole("tab", { name: "Kanban" }).click();
  await newLead(page, "Alice", "Un", "1000", "Créer un lead", owner.name);
  await newLead(page, "Bob", "Deux", "500", "Nouveau lead");
  await newLead(page, "Carl", "Trois", "250", "Nouveau lead");
  await page.getByRole("button", { name: "Déplacer Alice Un vers…" }).click();
  await page.getByRole("menuitem", { name: /Signé/ }).click();
  await expect(page.getByTestId("col-Signé").getByTestId("lead-card-Alice Un")).toBeVisible();
  // Bob est assigné à la commerciale
  await page.getByRole("link", { name: "Bob Deux" }).click();
  await page.getByLabel("Assigné à", { exact: true }).selectOption({ label: rep.name });
  await expect(page.getByText("Assignation mise à jour.")).toBeVisible();

  // Totaux exacts
  await page.goto("/dashboard");
  await expect(page.getByTestId("kpi-created-value")).toHaveText("3");
  await expect(page.getByTestId("kpi-conversion-value")).toHaveText(/^100\s%$/);
  await expect(page.getByTestId("kpi-value-value")).toHaveText(/^1\s000\s€$/);
  await expect(page.getByTestId("bar-Signé")).toContainText("1");
  await expect(page.getByTestId("bar-Nouveau")).toContainText("2");
  await expect(page.getByTestId("users-table")).toContainText("Dana Dashboard");
  await expect(page.getByTestId("users-table")).toContainText(rep.name);
  await expect(page.getByTestId("user-Dana Dashboard")).toContainText("1 000");

  // Liens des barres : période + filtres repris, le nombre affiché = le nombre de lignes de /leads
  await page.getByTestId("bar-Signé").click();
  await expect(page).toHaveURL(/\/leads\?(?=.*from=)(?=.*to=)(?=.*statuses=)/);
  await expect(page.getByTestId("total")).toHaveText("1 lead");
  await page.goto("/dashboard");
  await page.getByTestId("bar-Nouveau").click();
  await expect(page.getByTestId("total")).toHaveText("2 leads");
  await page.goto("/dashboard");
  await page.getByTestId("bar-Sans source").click();
  await expect(page).toHaveURL(/sources=none/);
  await expect(page.getByTestId("total")).toHaveText("3 leads");

  // Période > 366 jours : message clair (et aucun appel)
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Personnalisée" }).click();
  await page.getByLabel("Début de période").fill("2020-01-01");
  await page.getByLabel("Fin de période").fill("2022-01-01");
  await expect(page.getByRole("alert").filter({ hasText: "366 jours" })).toContainText("La période ne peut pas dépasser 366 jours");
  await expect(page.getByText("Impossible de charger")).toHaveCount(0);

  // Période : personnalisée dans le passé => vide ; retour 7 jours => données
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Personnalisée" }).click();
  await page.getByLabel("Début de période").fill("2020-01-01");
  await page.getByLabel("Fin de période").fill("2020-01-31");
  await expect(page.getByText("Pas encore de leads sur la période")).toBeVisible();
  await page.getByRole("button", { name: "7 jours" }).click();
  await expect(page.getByTestId("kpi-created-value")).toHaveText("3");
  await page.getByRole("button", { name: "Ce mois" }).click();
  await expect(page.getByTestId("kpi-created-value")).toHaveText(/^[0-3]$/); // dépend du jour du mois, jamais d'erreur

  // Filtre utilisateur (manager)
  await page.getByRole("button", { name: "30 jours" }).click();
  await page.getByLabel("Filtrer par utilisateur").selectOption({ label: rep.name });
  await expect(page.getByTestId("kpi-created-value")).toHaveText("1");
  await expect(page.getByTestId("kpi-value-value")).toHaveText(/^0\s€$/);
  await page.getByTestId("bar-Nouveau").click(); // le filtre utilisateur est repris dans le lien
  await expect(page.getByTestId("total")).toHaveText("1 lead");
  await page.goto("/dashboard");

  // Accessibilité : tableau alternatif de l'évolution
  await page.getByLabel("Filtrer par utilisateur").selectOption({ label: "Toute l'équipe" });
  await page.getByText("Voir sous forme de tableau").click();
  await expect(page.getByRole("columnheader", { name: "Créés" })).toBeVisible();

  // Mobile : aucun débordement
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("kpi-created-value")).toHaveText("3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await logout(page);

  // Vue Commercial : uniquement ses chiffres, ni performance par utilisateur ni filtre utilisateur
  await login(page, rep.email, rep.password);
  await expect(page.getByTestId("kpi-created-value")).toHaveText("1");
  await expect(page.getByTestId("kpi-conversion-value")).toHaveText("–");
  await expect(page.getByTestId("kpi-value-value")).toHaveText(/^0\s€$/);
  await expect(page.getByText("Performance par utilisateur")).toHaveCount(0);
  await expect(page.getByLabel("Filtrer par utilisateur")).toHaveCount(0);
  await expect(page.getByTestId("bar-Nouveau")).toContainText("1");
});

test("sans dashboard.view : accès rapides, pas de statistiques", async ({ page }) => {
  const e = { email: `plain-${run}@e2e.test`, org: `Dash Plain ${run}` };
  await signupViaForm(page, { first: "Test", last: "Paul Plain", email: e.email, password: owner.password, org: e.org, phone: "0612345678", siret: "73282932000074" });
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/settings/members");
  await page.getByRole("button", { name: "Ajouter un membre" }).click();
  await page.getByLabel("Nom complet").fill("Simple Vendeur");
  await page.getByLabel("E-mail").fill(`simple-${run}@e2e.test`);
  await page.getByLabel("Mot de passe temporaire").fill("TempPass!123");
  await page.getByLabel("Rôle", { exact: true }).selectOption({ label: "Commercial" });
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByText(`simple-${run}@e2e.test`).first()).toBeVisible();
  await logout(page);
  await login(page, `simple-${run}@e2e.test`, "TempPass!123");
  await expect(page.getByRole("link", { name: "Mes leads" })).toBeVisible();
  await expect(page.getByTestId("kpi-created")).toHaveCount(0);
  const a = admin();
  await a.from("organizations").delete().eq("name", e.org);
});
