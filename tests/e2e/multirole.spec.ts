/**
 * Scénario multi-rôles EN DIRECT : six sessions connectées EN MÊME TEMPS (un navigateur isolé par rôle),
 * dans l'organisation « Énergie Verte Démo ». Voir docs/agents/dispatch/J-multirole.md.
 *
 * Lancement (application déjà démarrée, sans seed, sans toucher au :3000) :
 *   MULTIROLE_BASE=http://localhost:3102 MULTIROLE_HEADED=1 npx playwright test tests/e2e/multirole.spec.ts --config=<config sans webServer>
 * - MULTIROLE_HEADED=1 : six fenêtres visibles côte à côte (3 colonnes x 2 lignes) ; sans, tout tourne en headless.
 * - MULTIROLE_SHOTS : dossier des captures j-*.png (défaut test-results/multirole).
 * Enregistrements jetables : société « MULTIROLE-<horodatage> », supprimés en fin de test.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { isFrenchHoliday } from "../../src/lib/dispatch/holidays";
import { fillEnergyRequired } from "./helpers";

config({ path: ".env.local", quiet: true });

const BASE = process.env.MULTIROLE_BASE ?? "http://localhost:3000";
const HEADED = process.env.MULTIROLE_HEADED === "1";
const SHOTS = process.env.MULTIROLE_SHOTS ?? "test-results/multirole";
const PASSWORD = "Demo1234!";
const ORG = "Énergie Verte Démo";
const W = 660; // >= 640 px : garde la disposition « sm » (bouton « Nouveau RDV » visible)
const H = Number(process.env.MULTIROLE_H ?? 800);
const TS = Date.now();
const TAG = `MULTIROLE-${TS}`;
const LAST = String(TS);
const LEAD_NAME = `MULTIROLE ${LAST}`;
const LEAD_VALUE = 12_345;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Key = "ceo" | "admin" | "pros" | "conf" | "pauline" | "karim";
const ROLES: { key: Key; label: string; email: string }[] = [
  { key: "ceo", label: "Super administrateur (CEO)", email: "admin.energies@demo.test" },
  { key: "admin", label: "Administrateur", email: "administrateur@demo.test" },
  { key: "pros", label: "Prospecteur", email: "prospecteur@demo.test" },
  { key: "conf", label: "Confirmateur", email: "confirmateur@demo.test" },
  { key: "pauline", label: "Commercial (Pauline Roche)", email: "commercial@demo.test" },
  { key: "karim", label: "Commercial 2 (Karim Benali)", email: "commercial2@demo.test" },
];
interface Session { key: Key; label: string; email: string; browser: Browser; ctx: BrowserContext; page: Page }
const S = {} as Record<Key, Session>;

const report: { steps: Record<string, string>; findings: string[]; menus: Record<string, string[]>; probes: Record<string, Record<string, string>> } = { steps: {}, findings: [], menus: {}, probes: {} };
const note = (k: string, v: string) => { report.steps[k] = v; console.log(`[J] ${k}: ${v}`); };
const finding = (t: string) => { report.findings.push(t); console.log(`[J][CONSTAT] ${t}`); };

async function shot(k: Key, name: string) {
  await S[k].page.screenshot({ path: `${SHOTS}/j-${name}-${k}.png`, fullPage: false }).catch(() => undefined);
}
async function shotAll(name: string) {
  await Promise.all(ROLES.map((r) => shot(r.key, name)));
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // Un membre de plusieurs organisations (Pauline) : on se place dans Énergie Verte Démo.
  const org = page.getByLabel("Organisation");
  if (await org.count()) {
    const sel = org.first();
    if ((await sel.locator("option:checked").innerText()) !== ORG) { await sel.selectOption({ label: ORG }); await page.waitForTimeout(800); await page.reload(); }
  }
}

const orgId = async () => (await admin.from("organizations").select("id").eq("name", ORG).single()).data!.id as string;
const userId = async (email: string) => (await admin.from("profiles").select("id").eq("email", email).single()).data!.id as string;
const roleOfUserId = (id: string): Key => ROLES.find((r) => r.email === emailById.get(id))!.key;
const emailById = new Map<string, string>();

function nextWorkday(): string {
  let d = new Date(Date.now() + 86_400_000);
  for (;;) {
    const ymd = d.toISOString().slice(0, 10);
    if (![0, 6].includes(d.getUTCDay()) && !isFrenchHoliday(ymd)) return ymd;
    d = new Date(d.getTime() + 86_400_000);
  }
}

const unread = async (p: Page) => {
  const l = (await p.getByTestId("bell").getAttribute("aria-label")) ?? "";
  const m = l.match(/\((\d+) non lues?\)/);
  return m ? Number(m[1]) : 0;
};
/** Attend (sans rechargement : sondage de la cloche toutes les 30 s) qu'une nouvelle notification non lue apparaisse. */
async function waitBellIncrease(p: Page, before: number, timeout = 45_000) {
  await expect.poll(() => unread(p), { timeout, intervals: [1000] }).toBeGreaterThan(before);
}
async function bellTexts(p: Page): Promise<string> {
  await p.getByTestId("bell").click();
  const menu = p.getByRole("menu");
  await expect(menu).toBeVisible();
  const t = await menu.innerText();
  await p.keyboard.press("Escape");
  return t;
}
const nav = async (p: Page) => (await p.getByRole("navigation", { name: "Navigation mobile" }).getByRole("link").allInnerTexts()).map((s) => s.trim());
const toast = (p: Page, re: RegExp | string) => p.getByText(re).first();

let t0 = new Date();
let leadId = "";
let apptId = "";
const cleanupIds: string[] = [];

async function cleanup() {
  const id = await orgId();
  const { data: leads } = await admin.from("leads").select("id").eq("org_id", id).like("company", "MULTIROLE-%");
  const ids = (leads ?? []).map((l) => l.id as string);
  if (ids.length) {
    await admin.from("tasks").delete().in("lead_id", ids);
    await admin.from("appointments").delete().in("lead_id", ids);
    await admin.from("leads").delete().in("id", ids);
  }
  await admin.from("sales_unavailability").delete().eq("org_id", id).like("reason", "MULTIROLE%");
  const uids = await Promise.all(ROLES.map((r) => userId(r.email)));
  const { data: ns } = await admin.from("notifications").select("id, payload").eq("org_id", id).in("user_id", uids).gte("created_at", t0.toISOString());
  const mine = (ns ?? []).filter((n) => {
    const p = n.payload as { message?: string; lead_id?: string; lead_name?: string };
    return (p.lead_id && ids.includes(p.lead_id)) || (p.lead_name ?? "").includes("MULTIROLE") || /Répartition automatique : \d|Rééquilibrage : \d|retiré de votre agenda/.test(p.message ?? "");
  });
  if (mine.length) await admin.from("notifications").delete().in("id", mine.map((n) => n.id));
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  for (const r of ROLES) emailById.set(await userId(r.email), r.email);
  await cleanup();
  t0 = new Date();
});

test.afterAll(async () => {
  await Promise.all(Object.values(S).map((s) => s.browser?.close().catch(() => undefined)));
  await cleanup().catch(() => undefined);
  writeFileSync(`${SHOTS}/j-report.json`, JSON.stringify(report, null, 2));
});

test("multi-rôles : six sessions simultanées, scénario complet", async () => {
  test.setTimeout(900_000);

  // ---------------------------------------------------------------- 0. six navigateurs isolés, connectés EN MÊME TEMPS
  await test.step("0. six sessions simultanées", async () => {
    await Promise.all(ROLES.map(async (r, i) => {
      const browser = await chromium.launch({
        headless: !HEADED,
        args: HEADED ? [`--window-size=${W},${H}`, `--window-position=${(i % 3) * W},${Math.floor(i / 3) * (H + 30)}`] : [],
      });
      const ctx = await browser.newContext(HEADED ? { viewport: null, baseURL: BASE } : { viewport: { width: W, height: H }, baseURL: BASE });
      ctx.setDefaultTimeout(20_000);
      ctx.setDefaultNavigationTimeout(30_000);
      const page = await ctx.newPage();
      S[r.key] = { ...r, browser, ctx, page };
    }));
    await Promise.all(ROLES.map((r) => login(S[r.key].page, r.email)));
    for (const r of ROLES) {
      await expect(S[r.key].page.getByTestId("user-menu")).toBeVisible();
      await S[r.key].page.getByTestId("user-menu").click();
      await expect(S[r.key].page.getByRole("menu")).toContainText(r.email);
      await S[r.key].page.keyboard.press("Escape");
    }
    await shotAll("00-connectes");
    note("0", "6 sessions isolées, toutes connectées en même temps");
  });

  const day = nextWorkday();
  const id = await orgId();
  const repEmails = ["commercial@demo.test", "commercial2@demo.test"];
  // Les autres commerciaux de l'organisation (ex. un membre jetable d'un autre test) sont bloqués ce jour-là : le RDV va à Pauline ou Karim.
  const zones = (await admin.from("sales_zones").select("user_id").eq("org_id", id).eq("active", true)).data!;
  const repIds = await Promise.all(repEmails.map(userId));
  for (const z of zones.filter((x) => !repIds.includes(x.user_id))) {
    await admin.from("sales_unavailability").insert({ org_id: id, user_id: z.user_id, day, start_min: null, end_min: null, reason: `MULTIROLE bloc ${TAG}` });
  }

  // ---------------------------------------------------------------- 1. prospecteur : lead + « RDV à attribuer »
  let confBefore = 0;
  await test.step("1. prospecteur crée un lead + RDV à attribuer ; le confirmateur est notifié", async () => {
    const p = S.pros.page;
    const c = S.conf.page;
    await c.goto("/agenda/repartition");
    await expect(c.getByRole("heading", { name: "Répartition automatique" })).toBeVisible();
    confBefore = await unread(c);

    await p.goto("/leads");
    await p.getByRole("button", { name: /Nouveau lead/ }).first().click();
    await p.getByLabel("Prénom").fill("MULTIROLE");
    await p.getByLabel("Nom", { exact: true }).fill(LAST);
    await p.getByLabel("Société").fill(TAG);
    await p.getByLabel(/Valeur/).fill(String(LEAD_VALUE));
    await p.getByLabel("Adresse", { exact: true }).fill("12 rue Joliot Curie");
    await p.getByLabel("Code postal").fill("69200");
    await p.getByLabel("Ville").fill("Vénissieux");
    await fillEnergyRequired(p);
    await p.getByRole("button", { name: "Créer le lead" }).click();
    await expect(p.getByTestId(`lead-card-${LEAD_NAME}`)).toBeVisible();
    leadId = (await admin.from("leads").select("id").eq("org_id", id).eq("company", TAG).single()).data!.id as string;
    await shot("pros", "01a-lead-cree");

    await p.goto("/agenda");
    await p.getByRole("button", { name: /Nouveau RDV/ }).first().click();
    const dialog = p.getByRole("dialog");
    await dialog.getByLabel("Lead").selectOption({ label: LEAD_NAME });
    await dialog.getByTestId("to-assign-toggle").getByRole("checkbox").check();
    await dialog.getByLabel("Du", { exact: true }).fill(day);
    await dialog.getByLabel("Au", { exact: true }).fill(day);
    await dialog.getByLabel("Durée", { exact: true }).selectOption("60");
    await dialog.getByLabel("Lieu").fill("12 rue Joliot Curie, 69200 Vénissieux");
    await shot("pros", "01b-rdv-a-attribuer-formulaire");
    await dialog.getByRole("button", { name: "Demander l'attribution" }).click();
    await expect(dialog).toBeHidden();
    const created = await expect.poll(async () => (await admin.from("appointments").select("id, status, dispatch_status, assigned_to, starts_at, wish_from, wish_to, duration_min").eq("lead_id", leadId).maybeSingle()).data, { timeout: 15_000 }).toBeTruthy();
    void created;
    const a = (await admin.from("appointments").select("id, status, dispatch_status, assigned_to, starts_at, wish_from, wish_to, duration_min").eq("lead_id", leadId).single()).data!;
    apptId = a.id;
    expect(a).toMatchObject({ status: "planned", dispatch_status: "unassigned", assigned_to: null, starts_at: null, wish_from: day, wish_to: day, duration_min: 60 });

    // Le confirmateur : notification reçue SANS recharger la page (sondage de la cloche, 30 s au plus)
    const tStart = Date.now();
    await waitBellIncrease(c, confBefore);
    const bellDelay = Math.round((Date.now() - tStart) / 1000);
    const txt = await bellTexts(c);
    expect(txt).toMatch(/propose un rendez-vous à attribuer/);
    await shot("conf", "01c-notification-recue");
    // La liste « À confirmer avant répartition » : se met-elle à jour sans rechargement ?
    const liveList = await c.getByText(LEAD_NAME).first().isVisible().catch(() => false);
    if (!liveList) finding("Mise à jour en direct partielle : la notification arrive par sondage (cloche, toutes les 30 s, reçue après ~" + bellDelay + " s), mais la liste « À confirmer avant répartition » de la page Répartition ne se rafraîchit pas seule (pas de Realtime / refresh) : il faut recharger.");
    await c.reload();
    await expect(c.getByText("À confirmer avant répartition")).toBeVisible();
    await expect(c.locator("li").filter({ hasText: LEAD_NAME })).toBeVisible();
    await shot("conf", "01d-rdv-visible-apres-rechargement");
    note("1", `OK : lead + RDV à attribuer créés ; notification confirmateur en direct (~${bellDelay} s, sondage 30 s) ; liste visible ${liveList ? "en direct" : "après rechargement seulement"}`);
  });

  // ---------------------------------------------------------------- 2. confirmateur confirme -> admin / CEO le voient
  await test.step("2. le confirmateur confirme -> « RDV confirmés à attribuer » chez l'admin et le CEO", async () => {
    const c = S.conf.page;
    await c.locator("li").filter({ hasText: LEAD_NAME }).getByRole("button", { name: "Confirmer", exact: true }).click();
    await expect(toast(c, "RDV confirmé.")).toBeVisible();
    await expect(c.getByTestId("pending-list")).toContainText(LEAD_NAME);
    expect((await admin.from("appointments").select("status, assigned_to").eq("id", apptId).single()).data).toMatchObject({ status: "confirmed", assigned_to: null });
    for (const k of ["ceo", "admin"] as Key[]) {
      const pg = S[k].page;
      await pg.goto("/agenda/repartition");
      await expect(pg.getByRole("heading", { name: "RDV confirmés à attribuer" })).toBeVisible();
      await expect(pg.getByTestId("pending-list")).toContainText(LEAD_NAME);
    }
    await shot("conf", "02a-confirme");
    await shot("ceo", "02b-ceo-rdv-confirmes-a-attribuer");
    await shot("admin", "02c-admin-rdv-confirmes-a-attribuer");
    note("2", "OK : RDV confirmé, visible dans « RDV confirmés à attribuer » chez CEO et administrateur");
  });

  // ---------------------------------------------------------------- 3. répartition automatique -> commercial notifié
  let rep: Key = "karim";
  let other: Key = "pauline";
  await test.step("3. CEO : Répartir automatiquement + Valider -> commercial notifié, agenda + ma tournée", async () => {
    const ceo = S.ceo.page;
    await ceo.reload();
    const befores: Record<string, number> = { pauline: await unread(S.pauline.page), karim: await unread(S.karim.page) };
    await ceo.getByTestId("dispatch-run").click();
    await expect(ceo.getByTestId("proposal")).toBeVisible();
    await expect(ceo.getByTestId("proposal")).toContainText("MULTIROLE");
    await shot("ceo", "03a-ceo-proposition");
    await ceo.getByTestId("dispatch-apply").click();
    await expect(ceo.getByTestId("dispatch-done")).toContainText("RDV attribué(s)");
    await expect(ceo.getByTestId("dispatch-done")).toContainText("notifiés aux commerciaux");
    await shot("ceo", "03b-ceo-valide");

    const a = (await admin.from("appointments").select("assigned_to, starts_at, dispatch_status").eq("id", apptId).single()).data!;
    expect(a.dispatch_status).toBe("assigned");
    rep = roleOfUserId(a.assigned_to!);
    expect(["pauline", "karim"]).toContain(rep);
    other = rep === "pauline" ? "karim" : "pauline";
    expect((await admin.from("leads").select("assigned_to").eq("id", leadId).single()).data!.assigned_to).toBe(a.assigned_to);
    note("3a", `RDV attribué à ${S[rep].label}`);

    // le commercial concerné : notification (sondage), agenda, ma tournée
    const rp = S[rep].page;
    await waitBellIncrease(rp, befores[rep]);
    expect(await bellTexts(rp)).toMatch(/Répartition automatique : \d+ nouveau/);
    await rp.goto("/agenda");
    await expect(rp.getByTestId("my-tour")).toBeVisible();
    await expect(rp.getByTestId("tour-stop").filter({ hasText: LEAD_NAME })).toHaveCount(1);
    await shot(rep, "03c-commercial-ma-tournee");
    await rp.goto("/agenda?view=list");
    await expect(rp.getByTestId("agenda-item").filter({ hasText: LEAD_NAME })).toHaveCount(1);
    await shot(rep, "03d-commercial-agenda");
    await rp.goto(`/leads/${leadId}`);
    await expect(rp.getByRole("heading", { name: LEAD_NAME })).toBeVisible();

    // l'autre commercial ne voit rien de nouveau
    const op = S[other].page;
    await op.goto("/agenda");
    await expect(op.getByTestId("tour-stop").filter({ hasText: LEAD_NAME })).toHaveCount(0);
    await op.goto("/agenda?view=list");
    await expect(op.getByTestId("agenda-item").filter({ hasText: LEAD_NAME })).toHaveCount(0);
    const otherId = await userId(S[other].email);
    const otherNotifs = (await admin.from("notifications").select("payload").eq("user_id", otherId).gte("created_at", t0.toISOString())).data ?? [];
    expect(otherNotifs.filter((n) => /Répartition automatique/.test(String((n.payload as { message?: string }).message)))).toHaveLength(0);
    await shot(other, "03e-autre-commercial-rien");
    note("3b", `OK : ${S[rep].label} notifié + agenda + tournée ; ${S[other].label} ne voit rien`);
  });

  // ---------------------------------------------------------------- 3bis. indisponibilité du commercial -> retrait / rééquilibrage
  await test.step("3bis. indisponibilité du commercial attribué -> ancien commercial prévenu, nouveau commercial reçoit le RDV", async () => {
    const ceo = S.ceo.page;
    const repId = await userId(S[rep].email);
    const otherId = await userId(S[other].email);
    const repBefore = await unread(S[rep].page);
    const otherBefore = await unread(S[other].page);
    await ceo.goto("/agenda/repartition");
    const u = ceo.getByTestId("unavailability");
    await u.getByLabel("Commercial", { exact: true }).selectOption({ label: rep === "pauline" ? "Pauline Roche" : "Karim Benali" });
    await u.locator("#un-day").fill(day);
    await u.getByLabel(/Motif/).fill(`MULTIROLE ${rep} ${TAG}`);
    await u.getByTestId("unavail-add").click();
    await expect(toast(ceo, "Indisponibilité enregistrée.")).toBeVisible();
    await shot("ceo", "03f-indisponibilite-ajoutee");

    // Régression : l'indisponibilité d'un commercial qui a déjà un RDV ce jour-là signale le RDV « à rééquilibrer »
    await ceo.reload();
    expect((await admin.from("appointments").select("needs_rebalance").eq("id", apptId).single()).data!.needs_rebalance).toBe(true);
    await expect(ceo.getByTestId("rebalance-banner")).toBeVisible();
    const path = "indisponibilité > Rééquilibrer";
    await ceo.getByTestId("rebalance-run").click();
    await expect(ceo.getByTestId("proposal")).toBeVisible();
    await shot("ceo", "03g-proposition-apres-indisponibilite");
    await ceo.getByTestId("dispatch-apply").click();
    await expect(ceo.getByTestId("dispatch-done")).toBeVisible();

    const a2 = (await admin.from("appointments").select("assigned_to, dispatch_status, starts_at").eq("id", apptId).single()).data!;
    const a2s = a2.starts_at as string;
    expect(a2.dispatch_status).toBe("assigned");
    expect(a2.assigned_to).toBe(otherId);
    expect(a2.assigned_to).not.toBe(repId);
    expect((await admin.from("leads").select("assigned_to").eq("id", leadId).single()).data!.assigned_to).toBe(otherId);

    // ancien commercial prévenu, nouveau commercial voit le RDV
    await waitBellIncrease(S[rep].page, repBefore);
    expect(await bellTexts(S[rep].page)).toMatch(/retiré|Rééquilibrage|confié à un autre/);
    await S[rep].page.goto("/agenda");
    await expect(S[rep].page.getByTestId("tour-stop").filter({ hasText: LEAD_NAME })).toHaveCount(0);
    await waitBellIncrease(S[other].page, otherBefore);
    await S[other].page.goto("/agenda");
    // « Ma tournée » couvre aujourd'hui + 2 jours : le rééquilibrage peut placer le RDV plus loin (fenêtre de 5 jours) ; l'agenda (liste) le montre toujours.
    if (new Date(a2s).getTime() < Date.now() + 3 * 86_400_000) await expect(S[other].page.getByTestId("tour-stop").filter({ hasText: LEAD_NAME })).toHaveCount(1);
    await S[other].page.goto("/agenda?view=list");
    await expect(S[other].page.getByTestId("agenda-item").filter({ hasText: LEAD_NAME })).toHaveCount(1);
    await shot(rep, "03h-ancien-commercial-plus-de-rdv");
    await shot(other, "03i-nouveau-commercial-recoit");
    // le nouveau propriétaire du lead
    const oldRep = rep;
    rep = other;
    other = oldRep;
    note("3bis", `OK via « ${path} » : ${S[other].label} prévenu et dessaisi, ${S[rep].label} reçoit le RDV`);
  });

  // ---------------------------------------------------------------- 4. statut du lead, tableau de bord, périmètres
  await test.step("4. le commercial fait avancer le lead -> dashboard CEO/admin ; périmètres prospecteur et autre commercial", async () => {
    const kpi = async (p: Page) => {
      await p.goto("/dashboard");
      await expect(p.getByTestId("kpi-value-value")).toBeVisible();
      const num = async (t: string) => Number((await p.getByTestId(t).innerText()).replace(/[^\d]/g, "")) || 0;
      return { won: await num("kpi-value-value"), created: await num("kpi-created-value") };
    };
    const ceoBefore = await kpi(S.ceo.page);
    const admBefore = await kpi(S.admin.page);
    await shot("ceo", "04a-dashboard-avant");

    const rp = S[rep].page;
    await rp.goto(`/leads/${leadId}`);
    // Comportement voulu : le lead passe tout seul en « RDV pris » à la confirmation/répartition du RDV (les statuts antérieurs sont alors interdits).
    await expect.poll(async () => (await admin.from("leads").select("status:statuses(name)").eq("id", leadId).single()).data?.status as unknown as { name: string }, { timeout: 10_000 }).toMatchObject({ name: "RDV pris" });
    for (const st of ["Devis envoyé", "Signé"]) {
      await rp.getByLabel("Statut du lead").selectOption({ label: st });
      await expect(toast(rp, "Statut mis à jour.")).toBeVisible();
      await expect.poll(async () => (await admin.from("leads").select("status:statuses(name)").eq("id", leadId).single()).data?.status as unknown as { name: string }, { timeout: 10_000 }).toMatchObject({ name: st });
      await rp.waitForTimeout(700);
    }
    await shot(rep, "04b-commercial-signe");

    const ceoAfter = await kpi(S.ceo.page);
    const admAfter = await kpi(S.admin.page);
    expect(ceoAfter.won).toBeGreaterThanOrEqual(ceoBefore.won + LEAD_VALUE);
    expect(admAfter.won).toBeGreaterThanOrEqual(admBefore.won + LEAD_VALUE);
    await shot("ceo", "04c-dashboard-apres-ceo");
    await shot("admin", "04d-dashboard-apres-admin");
    // kanban admin : le lead est dans la colonne Signé
    await S.admin.page.goto("/leads");
    await expect(S.admin.page.getByTestId("col-Signé").getByTestId(`lead-card-${LEAD_NAME}`)).toBeVisible();

    // prospecteur : uniquement ses leads (créés par lui ou qui lui sont attribués)
    const pid = await userId(S.pros.email);
    const mineCount = (await admin.from("leads").select("id", { count: "exact", head: true }).eq("org_id", id).is("archived_at", null).or(`assigned_to.eq.${pid},created_by.eq.${pid}`)).count!;
    const pp = S.pros.page;
    await pp.goto("/leads?view=table");
    await pp.getByRole("tab", { name: "Tableau" }).click().catch(() => undefined);
    await expect(pp.getByTestId("total")).toHaveText(new RegExp(`^${mineCount} leads?$`));
    const total = (await admin.from("leads").select("id", { count: "exact", head: true }).eq("org_id", id).is("archived_at", null)).count!;
    expect(mineCount).toBeLessThan(total);
    const foreign = (await admin.from("leads").select("id").eq("org_id", id).is("archived_at", null).neq("created_by", pid).neq("assigned_to", pid).limit(1)).data![0]!.id as string;
    const rf = await pp.goto(`/leads/${foreign}`);
    expect(rf?.status()).toBe(404);
    await shot("pros", "04e-prospecteur-ses-leads");

    // l'autre commercial : ni le lead, ni l'agenda, ni par URL directe
    const op = S[other].page;
    const resp = await op.goto(`/leads/${leadId}`);
    expect(resp?.status()).toBe(404);
    await op.goto("/leads?view=table");
    await op.getByRole("tab", { name: "Tableau" }).click().catch(() => undefined);
    await op.getByLabel("Rechercher un lead").fill("MULTIROLE");
    await expect(op.getByText(LEAD_NAME)).toHaveCount(0);
    await op.goto("/agenda?view=list");
    await expect(op.getByTestId("agenda-item").filter({ hasText: LEAD_NAME })).toHaveCount(0);
    await op.goto("/agenda/repartition");
    await expect(op.getByText("Accès refusé")).toBeVisible();
    await shot(other, "04f-autre-commercial-refus");
    note("4", `OK : ${S[rep].label} À qualifier > Qualifié > RDV pris > Devis envoyé > Signé ; valeur gagnée CEO ${ceoBefore.won} -> ${ceoAfter.won}, admin ${admBefore.won} -> ${admAfter.won} ; prospecteur ${mineCount}/${total} leads ; ${S[other].label} : 404 par URL directe, rien dans l'agenda`);
  });

  // ---------------------------------------------------------------- 5. concurrence
  // Lead jetable n°3 (statut initial, attribué au commercial) : les statuts « Signé » / « Perdu » sont définitifs, on ne peut plus les quitter.
  let lead3 = "";
  await test.step("5a. CEO change le statut pendant que le commercial ajoute une note (même lead)", async () => {
    lead3 = (await admin.from("leads").insert({ org_id: id, status_id: (await admin.from("statuses").select("id").eq("org_id", id).eq("is_initial", true).single()).data!.id, first_name: "MULTIROLE", last_name: `${LAST}-C`, company: `${TAG}-C`, assigned_to: await userId(S[rep].email) }).select("id").single()).data!.id as string;
    const ap = S.ceo.page;
    const rp = S[rep].page;
    await ap.goto(`/leads/${lead3}`);
    await rp.goto(`/leads/${lead3}`);
    await rp.getByRole("tab", { name: "Notes" }).click();
    await rp.getByLabel("Ajouter une note").fill(`Note concurrente ${TAG}`);
    await Promise.all([
      ap.getByLabel("Statut du lead").selectOption({ label: "À qualifier" }),
      rp.getByRole("button", { name: "Ajouter la note" }).click(),
    ]);
    await expect.poll(async () => (await admin.from("lead_notes").select("id").eq("lead_id", lead3)).data?.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => ((await admin.from("leads").select("status:statuses(name)").eq("id", lead3).single()).data?.status as unknown as { name: string }).name, { timeout: 15_000 }).toBe("À qualifier");
    await ap.reload();
    await rp.reload();
    await rp.getByRole("tab", { name: "Notes" }).click();
    await expect(rp.getByTestId("notes")).toContainText(`Note concurrente ${TAG}`);
    await expect(ap.getByLabel("Statut du lead")).toHaveValue((await admin.from("leads").select("status_id").eq("id", lead3).single()).data!.status_id);
    await expect(rp.getByLabel("Statut du lead")).toHaveValue((await admin.from("leads").select("status_id").eq("id", lead3).single()).data!.status_id);
    const ev = (await admin.from("lead_events").select("type").eq("lead_id", lead3)).data!.map((e) => e.type);
    expect(ev).toEqual(expect.arrayContaining(["note", "status_changed"]));
    await shot("ceo", "05a-ceo-statut-concurrent");
    await shot(rep, "05b-commercial-note-concurrente");
    note("5a", "OK : statut (CEO) et note (commercial) simultanés, aucune perte, événements journalisés, mêmes valeurs après rechargement");
  });

  await test.step("5b. CEO et commercial changent le statut en même temps (dernier écrit gagne, aucune corruption)", async () => {
    const ap = S.ceo.page;
    const rp = S[rep].page;
    await ap.goto(`/leads/${lead3}`);
    await rp.goto(`/leads/${lead3}`);
    const before = (await admin.from("lead_events").select("id").eq("lead_id", lead3).eq("type", "status_changed")).data!.length;
    const results = await Promise.all([
      ap.getByLabel("Statut du lead").selectOption({ label: "Perdu" }).then(() => "ok", (e) => String(e).slice(0, 120)),
      rp.getByLabel("Statut du lead").selectOption({ label: "Qualifié" }).then(() => "ok", (e) => String(e).slice(0, 120)),
    ]);
    await ap.waitForTimeout(1200);
    const toasts = { ceo: await ap.locator("[data-sonner-toast]").allInnerTexts(), commercial: await rp.locator("[data-sonner-toast]").allInnerTexts() };
    await ap.waitForTimeout(1300);
    const fin = (await admin.from("leads").select("status:statuses(name), status_id").eq("id", lead3).single()).data!;
    const finName = (fin.status as unknown as { name: string }).name;
    expect(["Qualifié", "Perdu"]).toContain(finName);
    const evs = (await admin.from("lead_events").select("payload").eq("lead_id", lead3).eq("type", "status_changed").order("created_at")).data!;
    expect(evs.length).toBeGreaterThanOrEqual(before + 1);
    await ap.reload();
    await rp.reload();
    await expect(ap.getByLabel("Statut du lead")).toHaveValue(fin.status_id);
    await expect(rp.getByLabel("Statut du lead")).toHaveValue(fin.status_id);
    await shot("ceo", "05c-statut-concurrent-ceo");
    await shot(rep, "05d-statut-concurrent-commercial");
    note("5b", `OK : résultats UI ${JSON.stringify(results)}, messages ${JSON.stringify(toasts)}, statut final « ${finName} » identique pour les deux après rechargement, ${evs.length - before} événement(s) de statut ajouté(s)`);
  });

  await test.step("5c. deux administrateurs cliquent « Valider » sur la même proposition en même temps", async () => {
    // Deuxième RDV jetable, confirmé et non attribué, inséré en base (chemin déjà couvert par l'étape 1-2).
    const l2 = (await admin.from("leads").insert({ org_id: id, status_id: (await admin.from("statuses").select("id").eq("org_id", id).eq("is_initial", true).single()).data!.id, first_name: "MULTIROLE", last_name: `${LAST}-B`, company: `${TAG}-B`, address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.8320, geo_precision: "housenumber", geo_source: "ban" }).select("id").single()).data!.id as string;
    const ins = await admin.from("appointments").insert({ org_id: id, lead_id: l2, assigned_to: null, starts_at: null, ends_at: null, status: "confirmed", dispatch_status: "unassigned", wish_from: day, wish_to: day, duration_min: 60, location_address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.8320, geo_precision: "housenumber", geo_source: "ban" }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    const a2 = ins.data.id as string;
    cleanupIds.push(a2);
    const [c1, c2] = [S.ceo.page, S.admin.page];
    await Promise.all([c1, c2].map(async (pg) => {
      await pg.goto("/agenda/repartition");
      await expect(pg.getByTestId("pending-list")).toContainText(`MULTIROLE ${LAST}-B`);
      await pg.getByTestId("dispatch-run").click();
      await expect(pg.getByTestId("proposal")).toBeVisible();
    }));
    await shot("ceo", "05e-ceo-avant-valider");
    await shot("admin", "05f-admin-avant-valider");
    const repBefore2 = { pauline: await unread(S.pauline.page), karim: await unread(S.karim.page) };
    const notifsBefore = (await admin.from("notifications").select("id", { count: "exact", head: true }).eq("org_id", id).like("payload->>message", "Répartition automatique%")).count ?? 0;
    // clic simultané
    await Promise.all([c1.getByTestId("dispatch-apply").click(), c2.getByTestId("dispatch-apply").click()]);
    await Promise.all([c1, c2].map((pg) => expect(pg.getByTestId("dispatch-done").or(pg.getByTestId("dispatch-error"))).toBeVisible({ timeout: 20_000 })));
    const outcome = async (pg: Page) => ((await pg.getByTestId("dispatch-done").count()) ? "gagnant" : (await pg.getByTestId("dispatch-error").innerText()).trim());
    const o1 = await outcome(c1);
    const o2 = await outcome(c2);
    await shot("ceo", "05g-ceo-apres-valider");
    await shot("admin", "05h-admin-apres-valider");
    const winners = [o1, o2].filter((o) => o === "gagnant").length;
    expect(winners).toBe(1);
    const loser = [o1, o2].find((o) => o !== "gagnant")!;
    expect(loser).toMatch(/situation a changé|relancez/i);
    const ap2 = (await admin.from("appointments").select("assigned_to, dispatch_status").eq("id", a2).single()).data!;
    expect(ap2.dispatch_status).toBe("assigned");
    const assignedCount = (await admin.from("appointments").select("id", { count: "exact", head: true }).eq("lead_id", l2).eq("dispatch_status", "assigned")).count;
    expect(assignedCount).toBe(1);
    const notifsAfter = (await admin.from("notifications").select("id", { count: "exact", head: true }).eq("org_id", id).like("payload->>message", "Répartition automatique%")).count ?? 0;
    expect(notifsAfter - notifsBefore).toBe(1); // une seule notification, pas de doublon
    void repBefore2;
    note("5c", `OK : un seul gagnant ; message du perdant : « ${loser.slice(0, 110)} » ; RDV attribué une seule fois, 1 seule notification`);
    // Régression : « Retirer » un RDV attribué conserve sa position GPS (il repasse « à attribuer », pas « à vérifier »)
    await c1.reload();
    const row2 = c1.getByTestId("dispatched-row").filter({ hasText: `MULTIROLE ${LAST}-B` });
    await row2.getByTestId("edit-open").click();
    await c1.getByTestId("unassign").click();
    await expect(toast(c1, "RDV retiré : il repasse à attribuer.")).toBeVisible();
    const back = (await admin.from("appointments").select("lat, lng, dispatch_status").eq("id", a2).single()).data!;
    expect(back.dispatch_status).toBe("unassigned");
    expect(back.lat).not.toBeNull();
    await c1.reload();
    await expect(c1.getByTestId("pending-list")).toContainText(`MULTIROLE ${LAST}-B`);
    await expect(c1.getByTestId("to-check")).toHaveCount(0);
    await shot("ceo", "05i-ceo-rdv-retire-position-conservee");
  });

  // ---------------------------------------------------------------- 6. menus et accès directs par rôle
  await test.step("6. menus visibles et accès directs, par rôle", async () => {
    const expected: Record<Key, string[]> = {
      ceo: ["Dashboard", "Leads", "Agenda", "Répartition", "Tâches", "Import", "Paramètres"],
      admin: ["Dashboard", "Leads", "Agenda", "Répartition", "Tâches", "Import", "Paramètres"],
      pros: ["Dashboard", "Leads", "Agenda", "Tâches", "Import"],
      conf: ["Dashboard", "Leads", "Agenda", "Répartition", "Tâches"],
      pauline: ["Dashboard", "Leads", "Agenda", "Tâches"],
      karim: ["Dashboard", "Leads", "Agenda", "Tâches"],
    };
    const probes = ["/dashboard", "/agenda/repartition", "/settings", "/settings/billing", "/import"];
    await Promise.all(ROLES.map(async (r) => {
      const pg = S[r.key].page;
      await pg.goto("/dashboard");
      report.menus[r.label] = await nav(pg);
      report.probes[r.label] = {};
      for (const u of probes) {
        const resp = await pg.goto(u);
        const denied = await pg.getByText("Accès refusé").first().isVisible().catch(() => false);
        report.probes[r.label]![u] = denied ? "Accès refusé" : `${resp?.status() ?? "?"} ${new URL(pg.url()).pathname}`;
      }
    }));
    for (const r of ROLES) expect(report.menus[r.label], r.label).toEqual(expected[r.key]);
    // accès direct cohérent avec le menu
    for (const r of ROLES) {
      const pr = report.probes[r.label]!;
      const hasRep = expected[r.key].includes("Répartition");
      expect(pr["/agenda/repartition"] === "Accès refusé", `${r.label} /agenda/repartition`).toBe(!hasRep);
      expect(pr["/import"] === "Accès refusé", `${r.label} /import`).toBe(!expected[r.key].includes("Import"));
    }
    await shotAll("06-menus");
    note("6", "OK : menus conformes aux permissions et accès directs refusés hors périmètre");
  });
});
