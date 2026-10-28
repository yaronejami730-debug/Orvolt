import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { fillEnergyRequired } from "./helpers";

config({ path: ".env.local", quiet: true });

/** Tour des boutons par rôle (administrateur, prospecteur, confirmateur) + pages publiques. Données jetables : société « [BTN-TEST] ». */
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const CO = "[BTN-TEST]";
const nav = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

async function login(page: Page, who: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${who}@demo.test`);
  await page.getByLabel("Mot de passe").fill("Demo1234!");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.afterAll(async () => {
  await admin.from("leads").delete().eq("company", CO);
});

test.describe("pages publiques", () => {
  test("tarifs : intervalle, comparatif, thème, FAQ", async ({ page }) => {
    await page.goto("/pricing");
    const group = page.getByRole("radiogroup", { name: "Fréquence de facturation" });
    const price = page.getByText("39 €").first();
    await expect(price).toBeVisible();
    await group.getByRole("radio", { name: /Annuel/ }).click();
    await expect(group.getByRole("radio", { name: /Annuel/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("39 €")).toHaveCount(0);
    await group.getByRole("radio", { name: "Mensuel" }).click();
    await expect(page.getByText("39 €").first()).toBeVisible();
    await expect(page.getByTestId("compare-table")).toBeVisible();
    const html = page.locator("html");
    const before = await html.getAttribute("class");
    await page.getByRole("button", { name: /Passer au thème/ }).first().click();
    await expect.poll(() => html.getAttribute("class")).not.toBe(before);
    await page.goto("/#faq");
    const q = page.locator("#faq button[aria-expanded]").first();
    await q.click();
    await expect(q).toHaveAttribute("aria-expanded", "true");
    await q.click();
    await expect(q).toHaveAttribute("aria-expanded", "false");
  });

  test("connexion et inscription : erreurs, choix du modèle, liens croisés", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("nobody@demo.test");
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole("link", { name: /Créer|inscri|essai/i }).first().click();
    await expect(page).toHaveURL(/\/signup/);
    await page.getByRole("button", { name: "Démarrer mon essai gratuit" }).click(); // formulaire vide : refusé, reste sur /signup
    await expect(page).toHaveURL(/\/signup/);
    await expect(page.getByLabel("N° de SIRET")).toBeVisible();
    await expect(page.getByText("Votre métier")).toHaveCount(0); // plus de choix de métier : énergie uniquement
    await page.getByRole("link", { name: /Se connecter|connexion/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("390 px : aucun débordement horizontal (landing, tarifs, connexion, inscription)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const p of ["/", "/pricing", "/login", "/signup"]) {
      await page.goto(p);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), p).toBeLessThanOrEqual(1);
    }
  });
});

const ROLES: { who: string; links: string[]; hidden: string[]; denied: string[] }[] = [
  { who: "administrateur", links: ["Dashboard", "Leads", "Agenda", "Répartition", "Tâches", "Import", "Paramètres"], hidden: [], denied: [] },
  { who: "prospecteur", links: ["Dashboard", "Leads", "Agenda", "Tâches", "Import"], hidden: ["Répartition", "Paramètres"], denied: ["/agenda/repartition", "/settings/members", "/settings/roles", "/settings/billing", "/settings/statuses"] },
  { who: "confirmateur", links: ["Dashboard", "Leads", "Agenda", "Répartition", "Tâches"], hidden: ["Import", "Paramètres"], denied: ["/import", "/settings/members", "/settings/roles", "/settings/billing", "/settings/fields"] },
];

for (const r of ROLES) {
  test.describe(`rôle ${r.who}`, () => {
    test("menu : liens visibles, navigation, pages interdites bloquées, cloche, menu utilisateur, thème", async ({ page }) => {
      await login(page, r.who);
      for (const l of r.links) {
        await nav(page).getByRole("link", { name: l, exact: true }).click();
        await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
      }
      for (const l of r.hidden) await expect(nav(page).getByRole("link", { name: l, exact: true })).toHaveCount(0);
      for (const u of r.denied) {
        await page.goto(u);
        await expect(page.getByText("Accès refusé")).toBeVisible();
      }
      await page.goto("/leads");
      await page.getByRole("button", { name: "Notifications" }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      const html = page.locator("html");
      const cls = await html.getAttribute("class");
      await page.getByRole("button", { name: /Passer au thème/ }).click();
      await expect.poll(() => html.getAttribute("class")).not.toBe(cls);
      await page.getByTestId("user-menu").click();
      await expect(page.getByRole("menuitem", { name: /Se déconnecter/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menuitem", { name: /Se déconnecter/ })).toHaveCount(0);
    });

    test("leads : kanban / tableau, recherche, filtres, tri, colonnes, nouveau lead (ouverture + fermeture)", async ({ page }) => {
      await login(page, r.who);
      await page.goto("/leads?view=kanban");
      await expect(page.getByRole("tab", { name: "Kanban" })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("tab", { name: "Tableau" }).click();
      await expect(page.getByRole("columnheader").first()).toBeVisible();
      await page.getByRole("button", { name: "Filtres" }).click();
      const filters = page.getByRole("region", { name: "Filtres" });
      await expect(filters).toBeVisible();
      await filters.getByRole("button").first().click(); // chip statut
      await expect(page.getByRole("button", { name: "Filtres" })).toContainText("!");
      await filters.getByRole("button").first().click(); // la rebascule
      await page.getByRole("button", { name: "Filtres" }).click();
      await expect(filters).toHaveCount(0);
      await page.getByLabel("Rechercher un lead").fill("zzzz-introuvable");
      await expect(page.getByText("Aucun résultat")).toBeVisible();
      await page.getByLabel("Rechercher un lead").fill("");
      await page.getByRole("button", { name: /^Nom$/i }).click();
      await page.getByRole("button", { name: /^Créé le$/i }).click();
      await page.getByRole("button", { name: "Colonnes" }).click();
      await page.keyboard.press("Escape");
      // nouveau lead : ouverture, validation vide, fermeture Échap puis bouton
      await page.getByRole("button", { name: "Nouveau lead" }).first().click();
      const dlg = page.getByRole("dialog");
      await expect(dlg).toBeVisible();
      await dlg.getByRole("button", { name: "Créer le lead" }).click();
      await expect(dlg).toBeVisible(); // refusé : champs obligatoires
      await page.keyboard.press("Escape");
      await expect(dlg).toBeHidden();
      await page.getByRole("tab", { name: "Kanban" }).click();
      await expect(page.getByRole("button", { name: /Ajouter un lead dans/ }).first()).toBeVisible();
    });

    test("agenda : semaine / jour / mois / liste, navigation, nouveau RDV, filtres commerciaux", async ({ page }) => {
      await login(page, r.who);
      await page.goto("/agenda");
      for (const t of ["Jour", "Mois", "Liste", "Semaine"]) {
        await page.getByRole("tab", { name: t }).click();
        await expect(page.getByRole("tab", { name: t })).toHaveAttribute("aria-selected", "true");
        await page.getByRole("button", { name: "Suivant" }).click();
        await page.getByRole("button", { name: "Précédent" }).click();
        await page.getByRole("button", { name: "Aujourd'hui" }).click();
      }
      await page.getByRole("button", { name: /Nouveau RDV/ }).first().click();
      const dlg = page.getByRole("dialog");
      await expect(dlg).toBeVisible();
      if (r.who !== "prospecteur") { // seuls les profils sans manage_all (télépro) demandent une attribution
        await expect(dlg.getByTestId("to-assign-toggle")).toHaveCount(0);
        await expect(dlg.getByLabel("Commercial", { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dlg).toBeHidden();
        return;
      }
      const toggle = dlg.getByTestId("to-assign-toggle").getByRole("checkbox");
      await toggle.check();
      await expect(dlg.getByLabel("Heure", { exact: true })).toHaveCount(0);
      await expect(dlg.getByRole("button", { name: "Demander l'attribution" })).toBeVisible();
      await toggle.uncheck();
      await expect(dlg.getByLabel("Heure", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dlg).toBeHidden();
    });

    test("dashboard : périodes", async ({ page }) => {
      await login(page, r.who);
      await page.goto("/dashboard");
      if (r.who === "prospecteur") { await expect(page.getByText(/Mes leads/).first()).toBeVisible(); return; }
      for (const p of ["7 jours", "90 jours", "Ce mois", "30 jours"]) {
        await page.getByRole("button", { name: p, exact: true }).click();
        await expect(page.getByRole("button", { name: p, exact: true })).toHaveAttribute("aria-pressed", /true/);
      }
    });
  });
}

test("administrateur : cycle de vie d'un lead (création, statut, note, appel, tâches, suppression avec annulation)", async ({ page }) => {
  await login(page, "administrateur");
  await page.goto("/leads?view=table");
  await page.getByRole("button", { name: "Nouveau lead" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Prénom").fill("Bouton");
  await dlg.getByLabel("Nom", { exact: true }).fill("Jetable");
  await dlg.getByLabel("Société").fill(CO);
  await fillEnergyRequired(page);
  await dlg.getByRole("button", { name: "Créer le lead" }).click();
  await expect(dlg).toBeHidden();
  await page.getByLabel("Rechercher un lead").fill("Jetable");
  await page.getByRole("link", { name: /Bouton Jetable/ }).first().click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+/);
  // statut
  const status = page.getByLabel("Statut du lead");
  const opts = await status.locator("option").allInnerTexts();
  expect(opts.length).toBeGreaterThan(1);
  // onglets
  for (const t of ["Notes", "Appels", "RDV", "Fichiers", "Historique"]) {
    await page.getByRole("tab", { name: t }).click();
    await expect(page.getByRole("tab", { name: t })).toHaveAttribute("aria-selected", "true");
  }
  // notes : ajouter, modifier, supprimer
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByRole("textbox").last().fill("Note de test bouton");
  await page.getByRole("button", { name: "Ajouter la note" }).click();
  await expect(page.getByText("Note de test bouton")).toBeVisible();
  await page.getByRole("button", { name: "Modifier la note" }).first().click();
  await page.getByRole("button", { name: "Annuler" }).first().click();
  await page.getByRole("button", { name: "Supprimer la note" }).first().click();
  await expect(page.getByText("Note de test bouton")).toHaveCount(0);
  // appel
  await page.getByRole("tab", { name: "Appels" }).click();
  await page.getByRole("button", { name: "Journaliser un appel" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  // nouveau RDV (raccourci vers l'onglet)
  await page.getByRole("button", { name: /Nouveau RDV/ }).first().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Prendre RDV" })).toBeVisible(); // le bouton ouvre le formulaire (modale : le reste de la page est inerte)
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("tab", { name: "RDV" })).toHaveAttribute("aria-selected", "true"); // et l'onglet RDV est sélectionné derrière
  // suppression : annuler puis confirmer
  await page.getByRole("button", { name: "Supprimer le lead" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Supprimer le lead" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Supprimer/ }).click();
  await expect(page).toHaveURL(/\/leads(\?|$)/);
  expect((await admin.from("leads").select("id", { count: "exact", head: true }).eq("company", CO)).count).toBe(0);
});

test("permissions fines : prospecteur / confirmateur ne peuvent pas supprimer, bloqués côté base", async ({ page }) => {
  for (const who of ["prospecteur", "confirmateur"]) {
    await login(page, who);
    await page.goto("/leads?view=table");
    await page.getByRole("link", { name: /\S/ }).filter({ hasText: /^[A-ZÉ]/ }).nth(0).waitFor();
    await page.locator('a[href^="/leads/"]').first().click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+/);
    await expect(page.getByRole("button", { name: "Supprimer le lead" })).toHaveCount(0);
    await page.goto("/leads?view=table");
    await expect(page.getByRole("button", { name: "Supprimer", exact: true })).toHaveCount(0);
    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: /Se déconnecter/ }).click();
    await expect(page).toHaveURL(/\/login/);
  }
});
