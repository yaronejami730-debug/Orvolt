import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { signupViaForm } from "./helpers";
import { expect, test, type Page } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const run = Date.now().toString(36);
const owner = { name: "Ivan Import", email: `import-${run}@e2e.test`, password: "Passw0rd!e2e", org: `Import ${run}` };

function buildCsv(): Buffer {
  const lines = ["Prénom;Nom;E-mail;Téléphone;Ville"];
  for (let i = 1; i <= 20; i++) lines.push(`Prénom${i};Lead${String(i).padStart(2, "0")};lead${String(i).padStart(2, "0")}@example.com;06 11 22 33 ${String(i).padStart(2, "0")};Lyon`);
  for (let i = 21; i <= 23; i++) lines.push(`Erreur;Mail${i};pas-un-mail-${i};;Paris`); // e-mail invalide
  lines.push(";;nonom1@example.com;;Paris", ";;nonom2@example.com;;Paris"); // aucun nom
  lines.push("Doublon;Un;lead01@example.com;;Lyon", "Doublon;Deux;lead02@example.com;;Lyon"); // doublons dans le fichier
  lines.push('Formule;"=HYPERLINK(""http://evil.example"")";formule@example.com;;Nice', "Ok;Vingt-neuf;ok29@example.com;;Nice", "Ok;Trente;ok30@example.com;;Nice");
  // Windows-1252 (export Excel français) : é = 0xE9
  const text = lines.join("\r\n");
  return Buffer.from(text, "latin1");
}

async function startImport(page: Page, dup: "Ignorer" | "Mettre à jour" | "Créer quand même") {
  await page.goto("/import");
  await page.getByLabel("Fichier CSV").setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: buildCsv() });
  await expect(page.getByText(/30 ligne\(s\)/)).toBeVisible();
  await expect(page.getByText(/windows-1252/)).toBeVisible();
  await expect(page.getByLabel("Champ pour Prénom")).toHaveValue("first_name");
  await expect(page.getByLabel("Champ pour E-mail")).toHaveValue("email");
  // Modèle Énergies : les 3 champs obligatoires absents du CSV demandent une valeur par défaut avant de continuer.
  const defaults = page.getByTestId("required-defaults");
  await defaults.getByLabel(/Type de chauffage/).selectOption("Gaz");
  await defaults.getByLabel(/Surface habitable/).fill("80");
  await defaults.getByLabel(/Propriétaire ou locataire/).selectOption("Propriétaire");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByLabel("Doublons").selectOption({ label: dup });
  await page.getByRole("button", { name: /Valider \(simulation/ }).click();
}

test.afterAll(async () => {
  const extraOrg = `Import E ${run}`;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  await admin.from("organizations").delete().eq("name", owner.org);
  await admin.from("organizations").delete().eq("name", extraOrg);
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email?.endsWith(`-${run}@e2e.test`)) await admin.auth.admin.deleteUser(u.id);
});

test("import CSV (simulation, rapport d'erreurs, doublons) puis webhook entrant", async ({ page, request }) => {
  await signupViaForm(page, { first: "Test", last: owner.name, email: owner.email, password: owner.password, org: owner.org, phone: "0612345678", siret: "73282932000074" });
  await expect(page).toHaveURL(/\/onboarding$/);

  // --- Import : simulation sans écriture
  await startImport(page, "Ignorer");
  const dry = page.getByTestId("dry-report");
  await expect(dry).toContainText("23 à créer");
  await expect(dry).toContainText("2 ignorés");
  await expect(dry).toContainText("5 en erreur");
  await expect(dry).toContainText("E-mail invalide");
  await expect(dry).toContainText("Indiquez au moins un nom");
  await page.goto("/leads?view=table");
  await expect(page.getByText("Aucun lead").first()).toBeVisible(); // la simulation n'a rien écrit

  // --- Import réel
  await startImport(page, "Ignorer");
  await expect(page.getByTestId("dry-report")).toContainText("23 à créer");
  await page.getByRole("button", { name: "Lancer l'import" }).click();
  const res = page.getByTestId("import-result");
  await expect(res.getByTestId("n-created")).toHaveText("23 créés");
  await expect(res.getByTestId("n-skipped")).toHaveText("2 ignorés");
  await expect(res.getByTestId("n-failed")).toHaveText("5 en erreur");

  // Rapport d'erreurs CSV : BOM, motifs, aucune formule exécutable
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Télécharger le rapport/ }).click()]);
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain("E-mail invalide");
  expect(csv).toContain("Ligne,Colonne,Motif");

  // Leads créés (accents Windows-1252 décodés, formule neutralisée)
  await page.goto("/leads?view=table");
  await expect(page.getByTestId("total")).toHaveText("23 leads");
  await page.getByLabel("Rechercher un lead").fill("HYPERLINK");
  await expect(page.getByText(/'=HYPERLINK/)).toBeVisible();
  await page.getByLabel("Rechercher un lead").fill("Prénom1");
  await expect(page.getByTestId("lead-row-Prénom1 Lead01")).toBeVisible();

  // --- Second import identique : tout est doublon (ignoré)
  await startImport(page, "Ignorer");
  const dry2 = page.getByTestId("dry-report");
  await expect(dry2).toContainText("0 à créer");
  await expect(dry2).toContainText("25 ignorés");
  await expect(page.getByRole("button", { name: "Lancer l'import" })).toBeDisabled();

  // --- Webhook entrant
  await page.goto("/settings/integrations");
  await page.getByRole("button", { name: "Créer un webhook" }).first().click();
  await page.getByLabel("Nom", { exact: true }).fill("Site web");
  await page.getByRole("button", { name: "Créer le webhook" }).click();
  const secret = (await page.getByTestId("new-secret").textContent())!.trim();
  const url = (await page.getByTestId("new-url").textContent())!.trim();
  expect(secret).toMatch(/^lfs_/);
  expect(url).toMatch(/\/api\/webhooks\/inbound\/[A-Za-z0-9_-]{43}$/);
  await page.keyboard.press("Escape");

  const payload = { first_name: "Zoé", last_name: "Webhook", email: "zoe.webhook@example.com", phone: "06 99 88 77 66", org_id: "00000000-0000-0000-0000-000000000000" };
  expect((await request.post(url, { data: payload })).status()).toBe(401); // sans secret
  expect((await request.post(url, { data: payload, headers: { "x-leadforge-secret": secret, "content-type": "text/plain" } })).status()).toBe(415);
  const ok = await request.post(url, { data: payload, headers: { "x-leadforge-secret": secret } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ status: "created" });
  const dup = await request.post(url, { data: payload, headers: { "x-leadforge-secret": secret } });
  expect(await dup.json()).toMatchObject({ status: "duplicate" });
  expect((await request.post(url.replace(/.$/, "X"), { data: payload, headers: { "x-leadforge-secret": secret } })).status()).toBe(404);

  // Journal, secret jamais ré-affiché
  await page.reload();
  const card = page.getByTestId("endpoint-Site web");
  await expect(card.getByTestId("event-log")).toContainText("Créé");
  await expect(card.getByTestId("event-log")).toContainText("Doublon");
  await expect(card.getByTestId("event-log")).toContainText("Authentification refusée");
  await expect(page.locator("body")).not.toContainText(secret);
  await expect(card).toContainText("lfs_");

  // Le lead reçu apparaît dans /leads (statut initial, source par défaut)
  await page.goto("/leads?view=table");
  await page.getByLabel("Rechercher un lead").fill("Zoé");
  await expect(page.getByTestId("lead-row-Zoé Webhook")).toBeVisible();

  // « Envoyer un test » avec un mappage personnalisé ; mappage invalide : message français lisible
  await page.goto("/settings/integrations");
  const c = page.getByTestId("endpoint-Site web");
  await c.getByLabel(/Mappage JSON/).fill("a -> notafield");
  await c.getByRole("button", { name: "Enregistrer" }).click();
  await expect(c.getByRole("alert")).toContainText("champ « notafield » inconnu");
  await expect(c.getByRole("alert")).not.toContainText("Invalid");
  await c.getByLabel(/Mappage JSON/).fill("contact.email -> email\ncontact.name -> fullName");
  await c.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Webhook enregistré.")).toBeVisible();
  await c.getByRole("button", { name: "Envoyer un test" }).click();
  await expect(page.getByText("Test envoyé : created.")).toBeVisible();

  // Mobile : aucun débordement horizontal
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/settings/integrations");
  await expect(page.getByTestId("endpoint-Site web")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Désactivation : 404 neutre
  await page.goto("/settings/integrations");
  await page.getByLabel("Activer Site web").click();
  await expect(page.getByText("Webhook enregistré.")).toBeVisible();
  expect((await request.post(url, { data: payload, headers: { "x-leadforge-secret": secret } })).status()).toBe(404);
});

test("import : champs obligatoires du template absents du CSV -> valeurs par défaut", async ({ page }) => {
  const e = { email: `energie-${run}@e2e.test`, org: `Import E ${run}` };
  await signupViaForm(page, { first: "Test", last: "Eva Énergie", email: e.email, password: "Passw0rd!e2e", org: e.org, phone: "0612345678", siret: "73282932000074" });
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/import");
  await page.getByLabel("Fichier CSV").setInputFiles({ name: "simple.csv", mimeType: "text/csv", buffer: Buffer.from("Prénom;Nom;E-mail\nAnne;Un;anne@example.com\nBob;Deux;bob@example.com\n") });
  const panel = page.getByTestId("required-defaults");
  await expect(panel).toContainText("obligatoires");
  await expect(page.getByRole("button", { name: "Continuer" })).toBeDisabled();
  await panel.getByLabel(/Type de chauffage/).selectOption("Gaz");
  await panel.getByLabel(/Surface habitable/).fill("80");
  await panel.getByLabel(/Propriétaire ou locataire/).selectOption("Propriétaire");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: /Valider \(simulation/ }).click();
  await expect(page.getByTestId("dry-report")).toContainText("2 à créer");
  await page.getByRole("button", { name: "Lancer l'import" }).click();
  await expect(page.getByTestId("n-created")).toHaveText("2 créés");
});
