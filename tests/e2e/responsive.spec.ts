import { expect, test, type Page } from "@playwright/test";

/** Responsive : aucune page ne déborde horizontalement à 360, 390 et 768 px (publiques, puis application en administrateur). */
const WIDTHS = [360, 390, 768];
const PUBLIC = ["/", "/pricing", "/login", "/signup", "/contact", "/cgv", "/confidentialite", "/mentions-legales"];
const APP = ["/dashboard", "/leads", "/agenda", "/agenda/repartition", "/confirmation", "/tasks", "/import", "/settings/statuses", "/settings/fields", "/settings/sources", "/settings/billing", "/settings/partners", "/settings/integrations", "/settings/webhooks", "/settings/members", "/settings/roles", "/onboarding"];

/** Éléments dont le bord droit dépasse la fenêtre (hors zones volontairement défilantes). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const scrolls = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
      }
      return false;
    };
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= w + 1 || scrolls(el.parentElement)) continue;
      if (getComputedStyle(el).position === "fixed") continue;
      bad.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).slice(0, 50)} right=${Math.round(r.right)}`);
      if (bad.length >= 5) break;
    }
    return { doc: document.documentElement.scrollWidth - w, bad };
  });
}

async function check(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(path, { waitUntil: "domcontentloaded" }); // l'événement load peut attendre des ressources externes (cartes, polices)
  await page.getByRole("main").first().waitFor();
  await page.waitForTimeout(400);
  const o = await overflow(page);
  expect(o.doc, `${path} @${width} : défilement horizontal de la page (${o.bad.join(" | ")})`).toBeLessThanOrEqual(1);
}

test.describe("responsive", () => {
  test("pages publiques", async ({ page }) => {
    test.setTimeout(240_000);
    for (const w of WIDTHS) for (const p of PUBLIC) await check(page, p, w);
  });
  test("application (administrateur)", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("administrateur@demo.test");
    await page.getByLabel("Mot de passe").fill("Demo1234!");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    for (const w of WIDTHS) for (const p of APP) await check(page, p, w);
  });
});
