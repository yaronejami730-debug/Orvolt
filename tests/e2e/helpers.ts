import type { Page } from "@playwright/test";

/** Champs obligatoires du modèle Énergies dans le formulaire « Nouveau lead » (chauffage, surface, propriétaire/locataire). */
export async function fillEnergyRequired(page: Page) {
  await page.getByLabel(/Type de chauffage/).selectOption("Gaz");
  await page.getByLabel(/Surface habitable/).fill("90");
  await page.getByLabel(/Propriétaire ou locataire/).selectOption("Propriétaire");
}

/**
 * Inscription complète via le formulaire (e-mail d'abord : le code part tout seul au blur, le sixième chiffre valide tout seul).
 * Retourne quand la création du compte a abouti (redirection hors /signup).
 */
export async function signupViaForm(page: Page, u: { first: string; last: string; email: string; password: string; org: string; kind?: "installer" | "agency"; siret?: string; phone?: string }, query = "") {
  await page.goto(`/signup${query}`);
  await page.getByLabel("E-mail professionnel").fill(u.email);
  await page.getByLabel("E-mail professionnel").blur();
  await page.getByTestId("dev-code").waitFor();
  await page.getByLabel("Code à 6 chiffres").fill(((await page.getByTestId("dev-code").innerText()).match(/\d{6}/) ?? [""])[0]);
  await page.getByTestId("email-verified").waitFor();
  await page.getByLabel("N° de SIRET").fill(u.siret ?? "73282932000074");
  await page.getByLabel("Nom de l'entreprise").fill(u.org);
  await page.getByLabel("Prénom").fill(u.first);
  await page.getByLabel("Nom", { exact: true }).fill(u.last);
  if (u.phone) await page.getByLabel(/Téléphone/).fill(u.phone);
  await page.getByTestId(`kind-${u.kind ?? "agency"}`).click();
  await page.getByLabel("Mot de passe").fill(u.password);
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"));
}
