import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const run = Date.now().toString(36);
const owner = { name: "Olivia Owner", email: `owner-${run}@e2e.test`, password: "Passw0rd!e2e", org: `Solaire ${run}` };
const rep = { name: "Camille Commercial", email: `rep-${run}@e2e.test`, password: "TempPass!123" };

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

test.afterAll(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  await admin.from("organizations").delete().eq("name", owner.org);
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email?.endsWith(`-${run}@e2e.test`)) await admin.auth.admin.deleteUser(u.id);
});

test("accès protégé : redirection vers /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("inscription, déconnexion, connexion, création d'un commercial", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Votre nom").fill(owner.name);
  await page.getByLabel("Nom de l'entreprise").fill(owner.org);
  await page.getByLabel("E-mail").fill(owner.email);
  await page.getByLabel("Mot de passe").fill(owner.password);
  await page.getByTestId("template-energie").click();
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("link", { name: "Commencer" }).click();
  await expect(page).toHaveURL(/\/leads/);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await logout(page);
  await login(page, owner.email, owner.password);

  await page.goto("/settings/members");
  await page.getByRole("button", { name: "Ajouter un membre" }).click();
  await page.getByLabel("Nom complet").fill(rep.name);
  await page.getByLabel("E-mail").fill(rep.email);
  await page.getByLabel("Mot de passe temporaire").fill(rep.password);
  await page.getByLabel("Rôle", { exact: true }).selectOption({ label: "Commercial" });
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByText(rep.email)).toBeVisible();
  await logout(page);
});

test("le commercial n'a pas accès aux rôles", async ({ page }) => {
  await login(page, rep.email, rep.password);
  await expect(page.getByRole("link", { name: "Paramètres" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Import" })).toHaveCount(0); // pas de leads.import
  await page.goto("/settings/roles");
  await expect(page.getByText("Accès refusé")).toBeVisible();
  await page.goto("/settings/members");
  await expect(page.getByText("Accès refusé")).toBeVisible();
});

test("mauvais mot de passe : erreur affichée", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(owner.email);
  await page.getByLabel("Mot de passe").fill("incorrect-pass");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();
});
