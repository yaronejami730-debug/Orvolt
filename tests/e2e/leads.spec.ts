import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { signupViaForm } from "./helpers";
import { expect, test, type Page } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const run = Date.now().toString(36);
const owner = { name: "Lola Leads", email: `leads-${run}@e2e.test`, password: "Passw0rd!e2e", org: `Leads ${run}` };
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
async function moveVia(page: Page, lead: string, target: RegExp) {
  await page.getByRole("button", { name: `Déplacer ${lead} vers…` }).click();
  await page.getByRole("menuitem", { name: target }).click();
}

test.afterAll(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  await admin.from("organizations").delete().eq("name", owner.org);
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email?.endsWith(`-${run}@e2e.test`)) await admin.auth.admin.deleteUser(u.id);
  await admin.storage.from("lead-files").remove([]);
});

test("leads : création, Kanban, transitions, actions auto, tableau, fiche", async ({ page }) => {
  // Inscription (template Énergies)
  await signupViaForm(page, { first: "Test", last: owner.name, email: owner.email, password: owner.password, org: owner.org, phone: "0612345678", siret: "73282932000074" });
  await expect(page).toHaveURL(/\/onboarding$/);

  // Création d'un membre Commercial
  await page.goto("/settings/members");
  await page.getByRole("button", { name: "Ajouter un membre" }).click();
  await page.getByLabel("Nom complet").fill(rep.name);
  await page.getByLabel("E-mail").fill(rep.email);
  await page.getByLabel("Mot de passe temporaire").fill(rep.password);
  await page.getByLabel("Rôle", { exact: true }).selectOption({ label: "Commercial" });
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByText(rep.email).first()).toBeVisible();

  // Création d'un lead : champs obligatoires du template validés
  await page.goto("/leads");
  await expect(page.getByText("Aucun lead")).toBeVisible();
  await page.getByRole("button", { name: "Créer un lead" }).click();
  await page.getByLabel("Prénom").fill("Jean");
  await page.getByLabel("Nom", { exact: true }).fill("Dupont");
  await page.getByLabel("Téléphone").fill("06 12 34 56 78");
  await page.getByRole("button", { name: "Créer le lead" }).click();
  await expect(page.getByText(/obligatoire/).first()).toBeVisible();
  await page.getByLabel(/Type de chauffage/).selectOption("Gaz");
  await page.getByLabel(/Surface habitable/).fill("90");
  await page.getByLabel(/Propriétaire ou locataire/).selectOption("Propriétaire");
  await page.getByRole("button", { name: "Créer le lead" }).click();
  await expect(page.getByTestId("col-Nouveau").getByTestId("lead-card-Jean Dupont")).toBeVisible();

  // Fiche : assignation au commercial
  await page.getByRole("link", { name: "Jean Dupont" }).click();
  await expect(page.getByTestId("lead-title")).toHaveText("Jean Dupont");
  await page.getByLabel("Assigné à", { exact: true }).selectOption({ label: rep.name });
  await expect(page.getByText("Assignation mise à jour.")).toBeVisible();

  // Fiche : note, appel, fichier
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByLabel("Ajouter une note").fill("Client très intéressé par la pompe à chaleur.");
  await page.getByRole("button", { name: "Ajouter la note" }).click();
  await expect(page.getByTestId("notes")).toContainText("pompe à chaleur");
  await page.getByRole("tab", { name: "Appels" }).click();
  await page.getByRole("button", { name: "Journaliser un appel" }).click();
  await page.getByLabel("Durée (minutes)").fill("12");
  await page.getByLabel("Commentaire").fill("Rappeler jeudi");
  await page.getByRole("button", { name: "Enregistrer l'appel" }).click();
  await expect(page.getByTestId("calls")).toContainText("Rappeler jeudi");
  await page.getByRole("tab", { name: "Fichiers" }).click();
  await page.getByLabel("Ajouter un fichier").setInputFiles({ name: "devis.txt", mimeType: "text/plain", buffer: Buffer.from("Devis 123") });
  await expect(page.getByTestId("files")).toContainText("devis.txt");
  await page.getByLabel("Ajouter un fichier").setInputFiles({ name: "evil.html", mimeType: "text/html", buffer: Buffer.from("<script>") });
  await expect(page.getByText(/non autorisé/)).toBeVisible();
  await page.getByRole("tab", { name: "Historique" }).click();
  await expect(page.getByTestId("history")).toContainText("Assigné à");
  await expect(page.getByTestId("history")).toContainText("Appel journalisé");

  // Kanban : l'admin déplace le lead vers « RDV pris » (action auto : création d'une tâche)
  await page.goto("/leads");
  await moveVia(page, "Jean Dupont", /RDV pris/);
  await expect(page.getByTestId("col-RDV pris").getByTestId("lead-card-Jean Dupont")).toBeVisible();

  // Tableau : recherche et filtres
  await page.getByRole("tab", { name: "Tableau" }).click();
  await expect(page.getByTestId("lead-row-Jean Dupont")).toBeVisible();
  await page.getByLabel("Rechercher un lead").fill("zzzz");
  await expect(page.getByText("Aucun résultat")).toBeVisible();
  await page.getByLabel("Rechercher un lead").fill("dupont");
  await expect(page.getByTestId("lead-row-Jean Dupont")).toBeVisible();
  await page.getByRole("button", { name: /Filtres/ }).click();
  await page.getByRole("button", { name: "Nouveau", exact: true }).click(); // filtre statut : aucun lead dans « Nouveau »
  await expect(page.getByText("Aucun résultat")).toBeVisible();
  await page.getByRole("button", { name: "Tout effacer" }).click();
  await expect(page.getByTestId("lead-row-Jean Dupont")).toBeVisible();
  await logout(page);

  // Commercial : transition interdite refusée, tâche créée par l'action auto
  await login(page, rep.email, rep.password);
  await page.goto("/leads");
  await page.getByRole("tab", { name: "Kanban" }).click(); // la préférence (Tableau) est mémorisée par navigateur
  await expect(page.getByTestId("col-RDV pris").getByTestId("lead-card-Jean Dupont")).toBeVisible();
  await moveVia(page, "Jean Dupont", /^Nouveau/);
  await expect(page.getByText(/Transition non autorisée pour votre rôle/).first()).toBeVisible();
  await expect(page.getByTestId("col-RDV pris").getByTestId("lead-card-Jean Dupont")).toBeVisible();
  await page.goto("/tasks");
  await expect(page.getByTestId("task-Préparer la visite technique")).toBeVisible();
  // Transition autorisée
  await page.goto("/leads");
  await moveVia(page, "Jean Dupont", /Devis envoyé/);
  await expect(page.getByTestId("col-Devis envoyé").getByTestId("lead-card-Jean Dupont")).toBeVisible();
});
