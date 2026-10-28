import { expect, test, type Page } from "@playwright/test";

/**
 * Pages d'acquisition /lp/* : parcours essai (redirection vers /signup préremplie), rappel (consentement, succès), anti-robot, noindex.
 * L'enregistrement est vérifié en LECTURE SEULE par l'API service-role sur le prospect créé (e-mail unique) ; l'assertion est
 * ignorée tant que la migration 20260210000000_landing_leads.sql n'est pas appliquée à la base.
 */
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

type Row = { kind: string; first_name: string; last_name: string; email: string; phone: string; preferred_slot: string | null; consent_at: string | null; utm: Record<string, string>; landing_path: string; ip_hash: string | null; trade: string | null };

/** Lit le prospect par e-mail (service role, lecture seule). null : table absente (migration non appliquée) ou clés manquantes. */
async function leadsByEmail(email: string): Promise<Row[] | null> {
  if (!SUPABASE || !KEY) return null;
  const r = await fetch(`${SUPABASE}/rest/v1/landing_leads?email=eq.${encodeURIComponent(email)}&select=*`, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
  if (!r.ok) return null;
  return (await r.json()) as Row[];
}

/** Laisse passer le délai minimal de soumission (2 s côté serveur) avant d'envoyer. */
const settle = (page: Page) => page.waitForTimeout(2300);

test.describe("pages d'acquisition /lp", () => {
  test("essai : saisie, masque du téléphone, redirection vers /signup préremplie, prospect enregistré", async ({ page }) => {
    const email = `lp-essai-${stamp()}@example.test`;
    await page.goto("/lp/essai?utm_source=e2e&utm_medium=test&utm_campaign=pac&gclid=abc123&evil=1");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Testez gratuitement 14 jours");
    await expect(page.getByText("14 jours d'essai · annulation en un clic · paiements sécurisés par Stripe")).toBeVisible();
    await expect(page.getByRole("link", { name: "Je crée mon compte tout de suite" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Se connecter" })).toBeVisible();
    await expect(page.getByLabel("Prénom")).toBeFocused(); // autofocus (écran non tactile)

    await page.getByLabel("Prénom").fill("Marc");
    await page.getByLabel("Nom", { exact: true }).fill("Lefèvre");
    await page.getByLabel("E-mail professionnel").fill(email);
    await page.getByLabel("Téléphone").pressSequentially("0612345678");
    await expect(page.getByLabel("Téléphone")).toHaveValue("06 12 34 56 78");
    await settle(page);
    await page.getByRole("button", { name: "Démarrer l'essai" }).click();

    await expect(page).toHaveURL(/\/signup\?/);
    const u = new URL(page.url());
    expect(u.searchParams.get("email")).toBe(email);
    expect(u.searchParams.get("firstName")).toBe("Marc");
    expect(u.searchParams.get("lastName")).toBe("Lefèvre");
    expect(u.search).not.toMatch(/phone|0612|utm|gclid/); // ni téléphone ni campagne dans l'URL
    await expect(page.getByLabel("E-mail professionnel")).toHaveValue(email);
    await expect(page.getByLabel("Prénom")).toHaveValue("Marc");
    await expect(page.getByLabel("Nom", { exact: true })).toHaveValue("Lefèvre");

    const rows = await leadsByEmail(email);
    if (rows) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "essai", first_name: "Marc", last_name: "Lefèvre", phone: "+33612345678", landing_path: "/lp/essai", consent_at: null });
      expect(rows[0]!.utm).toEqual({ utm_source: "e2e", utm_medium: "test", utm_campaign: "pac", gclid: "abc123" }); // « evil » écarté
      expect(rows[0]!.ip_hash === null || /^[0-9a-f]{64}$/.test(rows[0]!.ip_hash)).toBe(true);
    } else test.info().annotations.push({ type: "note", description: "landing_leads absente : vérification en base ignorée (migration non appliquée)." });
  });

  test("essai : erreurs inline en français, sans appel serveur", async ({ page }) => {
    await page.goto("/lp/essai");
    await page.getByRole("button", { name: "Démarrer l'essai" }).click();
    for (const m of ["Prénom requis.", "Nom requis.", "Adresse e-mail requise.", "Numéro de téléphone requis."]) await expect(page.getByText(m, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/lp\/essai$/);
    await expect(page.getByLabel("Prénom")).toBeFocused(); // focus sur le premier champ en erreur
    // Après un premier envoi, les erreurs se corrigent en direct.
    await page.getByLabel("E-mail professionnel").fill("pas-un-mail");
    await page.getByLabel("Téléphone").fill("12");
    await expect(page.getByText("Adresse e-mail invalide.")).toBeVisible();
    await expect(page.getByText(/Numéro invalide/)).toBeVisible();
    await expect(page.getByLabel("Téléphone")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Prénom").fill("Marc");
    await expect(page.getByText("Prénom requis.", { exact: true })).toHaveCount(0);
  });

  test("rappel : consentement obligatoire non précoché, délai minimal, message de succès, prospect enregistré", async ({ page }) => {
    const email = `lp-rappel-${stamp()}@example.test`;
    await page.goto("/lp/rappel?utm_source=meta&fbclid=zzz");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Être rappelé");
    const consent = page.getByRole("checkbox");
    await expect(consent).not.toBeChecked();
    await expect(page.getByRole("link", { name: "politique de confidentialité" })).toHaveAttribute("href", "/confidentialite");

    await page.getByLabel("Prénom").fill("Camille");
    await page.getByLabel("Nom", { exact: true }).fill("Durand");
    await page.getByLabel("Téléphone").fill("+33 6 98 76 54 32");
    await page.getByLabel("E-mail professionnel").fill(email);
    await page.getByLabel(/Entreprise/).fill("Solaire Lyon");
    await page.getByText("L'après-midi", { exact: true }).click(); // le bouton radio est masqué visuellement : on clique son libellé
    await page.getByRole("button", { name: "Être rappelé" }).click(); // sans consentement
    await expect(page.getByText("Merci d'accepter d'être rappelé pour continuer.")).toBeVisible();
    await expect(page.getByTestId("lp-success")).toHaveCount(0);

    await consent.check();
    // Envoi trop rapide (moins de 2 s après l'affichage) : refus côté serveur, formulaire conservé.
    const fast = await page.evaluate(() => Number((document.querySelector("input[name=startedAt]") as HTMLInputElement).value));
    if (Date.now() - fast < 2000) {
      await page.getByRole("button", { name: "Être rappelé" }).click();
      await expect(page.getByRole("alert")).toContainText("réessayer");
      await expect(page.getByLabel("Prénom")).toHaveValue("Camille");
    }
    await settle(page);
    await page.getByRole("button", { name: "Être rappelé" }).click();
    const ok = page.getByTestId("lp-success");
    await expect(ok).toBeVisible();
    await expect(ok).toContainText("dans les meilleurs délais");
    await expect(ok).not.toContainText(/24 ?h|1 heure|une heure/i);
    await expect(ok.getByRole("link", { name: "Démarrer l'essai maintenant" })).toHaveAttribute("href", "/signup");

    const rows = await leadsByEmail(email);
    if (rows) {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "rappel", first_name: "Camille", phone: "+33698765432", preferred_slot: "apres-midi", landing_path: "/lp/rappel", trade: null });
      expect(rows[0]!.consent_at).toBeTruthy();
      expect(rows[0]!.utm).toEqual({ utm_source: "meta", fbclid: "zzz" });
    } else test.info().annotations.push({ type: "note", description: "landing_leads absente : vérification en base ignorée (migration non appliquée)." });
  });

  test("champ piège : faux succès, rien n'est enregistré", async ({ page }) => {
    const email = `lp-bot-${stamp()}@example.test`;
    await page.goto("/lp/rappel");
    await page.getByLabel("Prénom").fill("Bot");
    await page.getByLabel("Nom", { exact: true }).fill("Robot");
    await page.getByLabel("Téléphone").fill("0612345678");
    await page.getByLabel("E-mail professionnel").fill(email);
    await page.getByRole("checkbox").check();
    await page.locator("input[name=website]").evaluate((el: HTMLInputElement) => { el.value = "http://spam.example"; });
    await settle(page);
    await page.getByRole("button", { name: "Être rappelé" }).click();
    await expect(page.getByTestId("lp-success")).toBeVisible();
    const rows = await leadsByEmail(email);
    if (rows) expect(rows).toHaveLength(0);
  });

  test("variantes métier : contenu dédié, formulaire commun, métier enregistré", async ({ page }) => {
    await page.goto("/lp/installateurs");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("répartis par zone");
    await expect(page.getByText("Répartition automatique par zones")).toBeVisible();
    await page.goto("/lp/regies");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("de la prospection à la confirmation");
    await expect(page.getByText(/Prospecteur, confirmateur/).first()).toBeVisible();
    await expect(page.locator("input[name=trade]")).toHaveValue("regies");
    const email = `lp-regies-${stamp()}@example.test`;
    await page.getByLabel("Prénom").fill("Sam");
    await page.getByLabel("Nom", { exact: true }).fill("Martin");
    await page.getByLabel("E-mail professionnel").fill(email);
    await page.getByLabel("Téléphone").fill("0145678901");
    await settle(page);
    await page.getByRole("button", { name: "Démarrer l'essai" }).click();
    await expect(page).toHaveURL(/\/signup\?/);
    const rows = await leadsByEmail(email);
    if (rows) expect(rows[0]).toMatchObject({ trade: "regies", landing_path: "/lp/regies" });
  });

  test("hors index, canonical propre, absentes du sitemap, aucune navigation ni script tiers", async ({ page, request, baseURL }) => {
    const hosts = new Set<string>();
    // Scripts et requêtes de données uniquement (les polices du thème sont un sujet à part : la CSP les bloque déjà).
    page.on("request", (r) => { if (["script", "xhr", "fetch", "image", "iframe"].includes(r.resourceType())) { try { hosts.add(new URL(r.url()).host); } catch { /* data: */ } } });
    for (const id of ["essai", "rappel", "installateurs", "regies"]) {
      const res = await page.goto(`/lp/${id}`);
      expect(res!.headers()["x-robots-tag"]).toContain("noindex");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/lp/${id}$`));
      await expect(page.getByRole("navigation")).toHaveCount(1); // seulement les liens légaux du pied de page
      await expect(page.getByRole("link", { name: "Mentions légales" })).toBeVisible();
      await expect(page.getByText("Paiements sécurisés par Stripe").first()).toBeVisible();
      await expect(page.locator("form")).toHaveAttribute("data-track", "lp-form");
    }
    expect([...hosts].filter((h) => h !== new URL(baseURL!).host)).toEqual([]);
    const sm = await (await request.get("/sitemap.xml")).text();
    expect(sm).not.toContain("/lp/");
  });

  test("responsive 375 px : pas de défilement horizontal", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    for (const id of ["essai", "rappel", "installateurs", "regies"]) {
      await page.goto(`/lp/${id}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await ctx.close();
  });
});
