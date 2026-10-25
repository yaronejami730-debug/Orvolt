import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fillEnergyRequired } from "./helpers";
import { expect, test, type Page } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const run = Date.now().toString(36);
const owner = { name: "Alice Agenda", email: `agenda-${run}@e2e.test`, password: "Passw0rd!e2e", org: `Agenda ${run}` };
const rep = { name: "Marc Commercial", email: `marc-${run}@e2e.test`, password: "TempPass!123" };

const yesterday = (() => {
  const d = new Date(Date.now() - 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
const tomorrow = (() => {
  const d = new Date(Date.now() + 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

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
async function openDialog(page: Page, date: string, time: string, location?: string) {
  await page.getByRole("button", { name: "Prendre RDV" }).click();
  await page.getByLabel("Date", { exact: true }).fill(date);
  await page.getByLabel("Heure").fill(time);
  if (location !== undefined) await page.getByLabel("Lieu").fill(location);
}

test.afterAll(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  await admin.from("organizations").delete().eq("name", owner.org);
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email?.endsWith(`-${run}@e2e.test`)) await admin.auth.admin.deleteUser(u.id);
});

test("zone, rendez-vous dans le rayon, hors rayon forcé, conflit, agenda du commercial", async ({ page }) => {
  // Inscription + commercial
  await page.goto("/signup");
  await page.getByLabel("Votre nom").fill(owner.name);
  await page.getByLabel("Nom de l'entreprise").fill(owner.org);
  await page.getByLabel("E-mail").fill(owner.email);
  await page.getByLabel("Mot de passe").fill(owner.password);
  await page.getByTestId("template-energie").click();
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.goto("/settings/members");
  await page.getByRole("button", { name: "Ajouter un membre" }).click();
  await page.getByLabel("Nom complet").fill(rep.name);
  await page.getByLabel("E-mail").fill(rep.email);
  await page.getByLabel("Mot de passe temporaire").fill(rep.password);
  await page.getByLabel("Rôle", { exact: true }).selectOption({ label: "Commercial" });
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByText(rep.email).first()).toBeVisible();

  // Zone d'intervention : Paris, 30 km (adresse introuvable refusée d'abord)
  await page.getByRole("button", { name: `Zone de ${rep.name}` }).click();
  await page.getByLabel("Adresse de départ").fill("Adresse introuvable zzz");
  await page.getByRole("button", { name: "Enregistrer la zone" }).click();
  await expect(page.getByText(/Adresse introuvable : précisez/)).toBeVisible();
  await page.getByLabel("Adresse de départ").fill("10 rue de Rivoli, Paris");
  await page.getByLabel("Rayon (km)", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Enregistrer la zone" }).click();
  await expect(page.getByTestId(`zone-${rep.email}`)).toContainText("30 km");

  // Lead à Versailles assigné au commercial
  await page.goto("/leads");
  await page.getByRole("button", { name: "Créer un lead" }).click();
  await page.getByLabel("Prénom").fill("Paul");
  await page.getByLabel("Nom", { exact: true }).fill("Martin");
  await page.getByLabel("Adresse", { exact: true }).fill("1 place d'Armes, Versailles");
  await page.getByLabel("Assigné à").selectOption({ label: rep.name });
  await fillEnergyRequired(page);
  await page.getByRole("button", { name: "Créer le lead" }).click();
  await page.getByRole("link", { name: "Paul Martin" }).click();
  await page.getByRole("tab", { name: "RDV" }).click();
  await expect(page.getByText("Aucun rendez-vous").first()).toBeVisible();

  // RDV dans le rayon
  await openDialog(page, tomorrow, "10:00");
  await expect(page.locator('[data-status="ok"]')).toContainText(/À \d+(\.\d)? km de la zone de Marc/);
  await page.getByRole("button", { name: "Planifier" }).click();
  await expect(page.getByTestId("appts-upcoming")).toContainText("Dans la zone");

  // RDV hors rayon : alerte, blocage tant que non forcé, motif obligatoire
  await openDialog(page, tomorrow, "14:00", "5 place Bellecour, Lyon");
  await expect(page.locator('[data-status="over_radius"]')).toContainText(/au-delà du rayon de 30/);
  await expect(page.getByRole("button", { name: "Planifier" })).toBeDisabled();
  await page.getByRole("button", { name: "Forcer quand même" }).click();
  await expect(page.getByRole("button", { name: "Planifier" })).toBeDisabled(); // motif manquant
  await page.getByLabel(/Motif de la dérogation/).fill("Client premium");
  await expect(page.getByRole("button", { name: "Planifier" })).toBeEnabled();
  await page.getByRole("button", { name: "Planifier" }).click();
  await expect(page.getByTestId("appts-upcoming")).toContainText("Hors zone");
  await expect(page.getByTestId("appts-upcoming")).toContainText("Client premium");

  // Conflit d'agenda : refusé
  await openDialog(page, tomorrow, "10:30", "1 place d'Armes, Versailles");
  await expect(page.getByTestId("conflict-banner")).toContainText(/déjà un rendez-vous/);
  await expect(page.getByRole("button", { name: "Planifier" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Date passée : avertissement et confirmation requise
  await openDialog(page, yesterday, "09:00", "1 place d'Armes, Versailles");
  await expect(page.getByTestId("past-warning")).toBeVisible();
  await expect(page.getByRole("button", { name: "Planifier" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Adresse non géocodée : création permise, distance non vérifiée
  await openDialog(page, tomorrow, "16:00", "Adresse introuvable zzz");
  await expect(page.locator('[data-status="no_geocode"]')).toContainText(/Adresse introuvable/);
  await page.getByRole("button", { name: "Planifier" }).click();
  await expect(page.getByTestId("appts-upcoming")).toContainText("Distance non vérifiée");
  await page.getByRole("tab", { name: "Historique" }).click();
  await expect(page.getByTestId("history")).toContainText("dérogation hors zone : Client premium");

  // Badge sur la carte Kanban + agenda de l'admin
  await page.goto("/leads");
  await page.getByRole("tab", { name: "Kanban" }).click();
  await expect(page.getByTestId("appt-badge").first()).toBeVisible();
  await page.goto(`/agenda?view=list&date=${tomorrow}`);
  await expect(page.getByTestId("agenda-item")).toHaveCount(3);
  await page.goto(`/agenda?view=day&date=${tomorrow}`);
  await expect(page.getByTestId("agenda-event").first()).toBeVisible();
  await logout(page);

  // Le commercial voit ses rendez-vous dans son agenda
  await login(page, rep.email, rep.password);
  await page.goto(`/agenda?view=list&date=${tomorrow}`);
  await expect(page.getByTestId("agenda-item")).toHaveCount(3);
  await expect(page.getByTestId("agenda-item").first()).toContainText("Paul Martin");
  await page.getByTestId("agenda-item").first().click();
  await expect(page.getByTestId("appt-detail")).toContainText("Marc Commercial");
});
