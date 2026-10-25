import { expect, test, type Page } from "@playwright/test";

// Utilise les comptes de démo (npm run db:seed). Le test restaure la matrice à la fin.
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("Demo1234!");
  await page.getByRole("button", { name: /Se connecter/ }).click();
  await expect(page).toHaveURL(/\/(dashboard|leads|onboarding)/);
}

test("super administrateur : rôle verrouillé et matrice des statuts persistée", async ({ page }) => {
  await login(page, "admin.energies@demo.test");
  await page.goto("/settings/roles");
  await expect(page.getByTestId("role-Super administrateur").getByTestId("badge-super-admin")).toBeVisible();
  await expect(page.getByTestId("role-Administrateur").getByRole("button", { name: /Modifier Administrateur/ })).toBeVisible();

  await page.goto("/settings/statuses");
  const matrix = page.getByTestId("status-grants");
  await expect(matrix).toBeVisible();
  const cell = page.getByTestId("grant-Signé-Prospecteur");
  await expect(cell).toBeChecked();
  await cell.click();
  await page.getByTestId("grants-save").click();
  await expect(page.getByText("Droits de statut enregistrés.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("grant-Signé-Prospecteur")).not.toBeChecked();
  // restauration
  await page.getByTestId("grant-Signé-Prospecteur").click();
  await page.getByTestId("grants-save").click();
  await expect(page.getByText("Droits de statut enregistrés.")).toBeVisible();
});

test("administrateur : le rôle Administrateur est en lecture seule", async ({ page }) => {
  await login(page, "administrateur@demo.test");
  await page.goto("/settings/roles");
  await expect(page.getByTestId("readonly-Administrateur")).toContainText("Lecture seule");
  await expect(page.getByTestId("role-Administrateur").getByRole("button", { name: /Modifier/ })).toHaveCount(0);
  await expect(page.getByTestId("role-Super administrateur").getByTestId("badge-super-admin")).toBeVisible();
});
