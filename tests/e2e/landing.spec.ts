import { expect, test } from "@playwright/test";

test.describe("landing publique", () => {
  test("sections, titre, CTA vers /signup, métadonnées", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/LeadForge/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("de l'appel à la signature");
    for (const id of ["#fonctionnalites", "#comment-ca-marche", "#tarifs", "#faq"]) await expect(page.locator(id)).toBeAttached();
    // Modèle unique pour l'instant : l'énergie (ENABLED_TEMPLATE_IDS) ; les autres métiers ne sont plus présentés.
    for (const label of ["Pompe à chaleur", "Panneaux solaires", "Isolation"]) await expect(page.getByRole("listitem").filter({ hasText: label }).first()).toBeVisible();
    for (const t of ["Kanban et statuts programmables", "Champs personnalisés", "Rôles et permissions", "Rendez-vous et contrôle de distance", "Import CSV et webhooks", "Tableau de bord KPI", "Multi-équipes sécurisées"]) {
      await expect(page.getByRole("heading", { name: t })).toBeAttached();
    }
    await expect(page.getByRole("article")).toHaveCount(13); // 7 fonctionnalités + 3 démos animées (« Voyez-le travailler ») + 3 plans
    for (const plan of ["starter", "pro", "business"]) await expect(page.locator(`[data-plan="${plan}"]`)).toBeAttached();
    await expect(page.locator('[data-plan="starter"]')).toContainText("9,90");
    await expect(page.locator('[data-plan="pro"]')).toContainText("79");
    await expect(page.locator('[data-plan="business"]')).toContainText("199");

    // CTA principaux -> /signup
    const hrefs = await page.locator('a[href="/signup"]').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    await page.getByRole("link", { name: /Essai gratuit 14 jours/ }).first().click();
    await expect(page).toHaveURL(/\/signup$/);

    // JSON-LD + méta
    await page.goto("/");
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.join("")).toContain("SoftwareApplication");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /LeadForge/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /CRM/);
    expect((await request.get("/opengraph-image")).status()).toBe(200);
  });

  test("FAQ : ouverture et fermeture au clavier", async ({ page }) => {
    await page.goto("/#faq");
    const first = page.getByRole("button", { name: /Comment fonctionne l.essai gratuit/ });
    const second = page.getByRole("button", { name: /Puis-je annuler/ });
    await first.focus();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: /Comment fonctionne l.essai gratuit/ })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(second).toBeFocused();
    await page.keyboard.press("Space");
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(first).toHaveAttribute("aria-expanded", "false"); // un seul volet ouvert
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#faq").getByRole("region")).toHaveCount(0);
  });

  test("thème : sombre par défaut, bascule clair puis retour", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(5, 7, 13)");
    await page.getByRole("button", { name: "Passer au thème clair" }).click();
    await expect(html).toHaveClass(/light/);
    await page.getByRole("button", { name: "Passer au thème sombre" }).click();
    await expect(html).toHaveClass(/dark/);
  });

  test("mobile 390 : pas de débordement horizontal, menu utilisable", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    for (const path of ["/", "/pricing", "/cgv"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await page.goto("/");
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await expect(page.getByRole("navigation", { name: "Navigation mobile" })).toBeVisible();
    await page.getByRole("link", { name: "Tarifs" }).last().click();
    await expect(page).toHaveURL(/\/pricing/);
    await ctx.close();
  });

  test("mobile : Échap ferme le menu et rend le focus au bouton ; og:image et og:url présents", async ({ browser, request }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Ouvrir le menu" });
    await toggle.click();
    await expect(page.getByRole("navigation", { name: "Navigation mobile" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Navigation mobile" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ouvrir le menu" })).toBeFocused();
    for (const path of ["/", "/pricing"]) {
      const html = await (await request.get(path)).text();
      const img = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
      expect(img, path).toBeTruthy();
      expect((await request.get(new URL(img!).pathname)).status()).toBe(200);
      expect(html).toMatch(/<meta property="og:url" content="[^"]+"/);
    }
    await ctx.close();
  });

  test("pricing : 3 plans, footer et pages légales en 200, sitemap et robots", async ({ page, request }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("prix simple");
    await expect(page.locator("[data-plan]")).toHaveCount(3);
    for (const href of ["/mentions-legales", "/confidentialite", "/cgv"]) {
      await expect(page.locator(`footer a[href="${href}"]`)).toBeVisible();
      const res = await request.get(href);
      expect(res.status(), href).toBe(200);
      expect(await res.text()).toContain("<h1");
    }
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    for (const p of ["/pricing", "/cgv", "/mentions-legales", "/confidentialite"]) expect(xml).toContain(p);
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const txt = await robots.text();
    expect(txt).toContain("Sitemap:");
    expect(txt).toContain("Disallow: /api/");
  });

  test("tarifs : bascule Annuel (2 mois offerts) et tableau de comparaison repliable", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByTestId("price-starter")).toContainText("9,90");
    await page.getByRole("radio", { name: "Annuel" }).click();
    await expect(page.getByTestId("price-starter")).toContainText("99"); // 9,90 x 10
    await expect(page.getByTestId("price-pro")).toContainText("790");
    await expect(page.getByTestId("price-business")).toContainText("1");
    await expect(page.locator('[data-plan="business"]')).toContainText("Utilisateurs illimités");
    await page.getByRole("radio", { name: "Mensuel" }).click();
    await expect(page.getByTestId("price-pro")).toContainText("79");
    const toggle = page.getByTestId("compare-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("compare-table")).toBeVisible();
    await expect(page.getByTestId("compare-table")).toContainText("Illimités");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("prefers-reduced-motion : contenu visible sans animation", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("opacity", "1");
    await expect(page.locator('[data-plan="pro"]')).toBeVisible();
    await ctx.close();
  });

  test("visiteur connecté : bouton « Ouvrir l'app »", async ({ page }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const { config } = await import("dotenv");
    config({ path: ".env.local", quiet: true });
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const email = `landing-${Date.now().toString(36)}@e2e.test`;
    const { data } = await admin.auth.admin.createUser({ email, password: "Passw0rd!e2e", email_confirm: true });
    try {
      await page.goto("/login");
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Mot de passe").fill("Passw0rd!e2e");
      await page.getByRole("button", { name: "Se connecter" }).click();
      await page.waitForURL(/\/(dashboard|no-access|onboarding)/);
      await page.goto("/");
      await expect(page.getByRole("link", { name: "Ouvrir l'app" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Essai gratuit 14 jours" })).toHaveCount(0);
    } finally {
      if (data.user) await admin.auth.admin.deleteUser(data.user.id);
    }
  });
});
