// Captures de /agenda/repartition après une simulation (confirmateur) : desktop 1440 px et mobile 390 px.
// Prérequis : app sur http://localhost:3000 (npm run start ou dev), base seedée (npm run db:reset -- --seed).
// Usage : node scripts/dispatch-screenshots.mjs [dossier de sortie, défaut test-results]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? "test-results";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60_000);
try {
  await page.goto(`${base}/login`);
  await page.getByLabel("E-mail").fill("confirmateur@demo.test");
  await page.getByLabel("Mot de passe").fill("Demo1234!");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/dashboard/);
  await page.goto(`${base}/agenda/repartition`);
  await page.getByTestId("sim-launch").click();
  await page.getByTestId("to-check").waitFor();
  await page.getByTestId("dispatch-run").click();
  await page.getByTestId("proposal").waitFor();
  await page.getByTestId("leg").first().waitFor();
  await page.screenshot({ path: path.join(out, "repartition-desktop.png"), fullPage: true });
  console.log("capture desktop :", path.join(out, "repartition-desktop.png"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, "repartition-390-fold.png"), fullPage: false });
  await page.screenshot({ path: path.join(out, "repartition-390-full.png"), fullPage: true });
  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  console.log("capture 390 px :", path.join(out, "repartition-390-full.png"), "débordement horizontal :", overflow.scrollWidth > overflow.clientWidth ? `OUI (${overflow.scrollWidth} > ${overflow.clientWidth})` : "non");
  const wide = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > 392).slice(0, 8).map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} right=${Math.round(el.getBoundingClientRect().right)}`));
  if (wide.length) console.log("éléments dépassant 390 px :", wide.join(" | "));

  // nettoyage de la simulation
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("sim-clear").click();
  await page.getByTestId("pending-count").filter({ hasText: "0" }).waitFor();
  console.log("simulation nettoyée");
} finally {
  await browser.close();
}
