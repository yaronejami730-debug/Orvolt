import type { Page } from "@playwright/test";

/** Champs obligatoires du modèle Énergies dans le formulaire « Nouveau lead » (chauffage, surface, propriétaire/locataire). */
export async function fillEnergyRequired(page: Page) {
  await page.getByLabel(/Type de chauffage/).selectOption("Gaz");
  await page.getByLabel(/Surface habitable/).fill("90");
  await page.getByLabel(/Propriétaire ou locataire/).selectOption("Propriétaire");
}
