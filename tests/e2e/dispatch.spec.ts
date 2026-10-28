import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { isFrenchHoliday } from "../../src/lib/dispatch/holidays";

config({ path: ".env.local", quiet: true });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PASSWORD = "Demo1234!";
const ORG = "Énergie Verte Démo";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function logout(page: Page) {
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: /Se déconnecter/ }).click();
  await expect(page).toHaveURL(/\/login/);
}
const orgId = async () => (await admin.from("organizations").select("id").eq("name", ORG).single()).data!.id as string;
// Leads RÉELS (non simulés) créés par ces tests : repérés par cette société, supprimés en fin de test.
const E2E_CO = "[E2E-REEL]";
const teleproAppts: string[] = [];
async function cleanup() {
  const id = await orgId();
  await admin.from("leads").delete().eq("org_id", id).eq("is_simulation", true); // simulation : par drapeau, jamais par le nom
  await admin.from("leads").delete().eq("org_id", id).eq("company", E2E_CO);
  if (teleproAppts.length) { await admin.from("appointments").delete().in("id", teleproAppts); teleproAppts.length = 0; }
}
const notifCount = async (id: string) => (await admin.from("notifications").select("id", { count: "exact", head: true }).eq("org_id", id)).count ?? 0;
/** Premier jour ouvré (ni week-end ni férié) à partir de demain, au format AAAA-MM-JJ. */
function nextWorkday(): string {
  let d = new Date(Date.now() + 86_400_000);
  for (;;) {
    const ymd = d.toISOString().slice(0, 10);
    if (![0, 6].includes(d.getUTCDay()) && !isFrenchHoliday(ymd)) return ymd;
    d = new Date(d.getTime() + 86_400_000);
  }
}
/** Vrai RDV déjà attribué à un commercial (demain tôt, dans sa tournée), sur un vrai lead : la simulation reste invisible du commercial. */
async function seedRealAppointment(id: string) {
  const zone = (await admin.from("sales_zones").select("user_id").eq("org_id", id).eq("active", true).limit(1).single()).data!;
  const st = (await admin.from("statuses").select("id").eq("org_id", id).eq("is_initial", true).single()).data!.id;
  const lead = (await admin.from("leads").insert({ org_id: id, status_id: st, first_name: "Réel", last_name: "Tournée", company: E2E_CO, assigned_to: zone.user_id, address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.8320, geo_precision: "housenumber", geo_source: "ban" }).select("id").single()).data!.id;
  const day = nextWorkday();
  const starts = new Date(`${day}T06:00:00Z`);
  const ins = await admin.from("appointments").insert({
    org_id: id, lead_id: lead, assigned_to: zone.user_id, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3_600_000).toISOString(),
    status: "confirmed", dispatch_status: "assigned", dispatched_at: new Date().toISOString(), wish_from: day, wish_to: day, duration_min: 60,
    location_address: "1 place Bellecour, Lyon", lat: 45.7578, lng: 4.8320, geo_precision: "housenumber", geo_source: "ban",
  }).select("id").single();
  if (ins.error) throw new Error(`seed RDV réel : ${ins.error.message}`);
  const rep = (await admin.auth.admin.getUserById(zone.user_id)).data.user!;
  return { apptId: ins.data.id as string, repId: zone.user_id as string, repEmail: rep.email! };
}
const parisParts = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { day: `${g("year")}-${g("month")}-${g("day")}`, min: Number(g("hour")) * 60 + Number(g("minute")) };
};
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

test.beforeAll(cleanup);
test.afterAll(cleanup);

test("super admin : simulation -> À vérifier (corrections) -> aperçu -> validation -> verrou -> commercial", async ({ page }) => {
  test.setTimeout(240_000);
  await cleanup();
  await login(page, "admin.energies@demo.test");

  // Chemin de clic : menu Répartition -> bouton « Lancer une simulation »
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Répartition" }).click();
  await expect(page).toHaveURL(/\/agenda\/repartition/);
  await expect(page.getByRole("heading", { name: "Répartition automatique" })).toBeVisible();
  // Vue réelle : aucun RDV à attribuer, aucune simulation, note explicative
  await expect(page.getByTestId("pending-count")).toHaveText("0");
  await expect(page.getByTestId("sim-open")).toHaveCount(0);
  await expect(page.getByTestId("sim-note")).toContainText("invisibles hors de la vue simulation");
  const notifsBefore = await notifCount(await orgId());
  await page.getByTestId("sim-launch").click();
  // la simulation s'ouvre dans sa vue dédiée (?vue=simulation)
  await expect(page).toHaveURL(/vue=simulation/);
  await expect(page.getByTestId("sim-banner")).toContainText("aucune notification");
  await expect(page.getByTestId("to-check")).toBeVisible();
  await expect(page.getByTestId("pending-count")).toHaveText("7");
  const rows = page.getByTestId("to-check-row");
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("to-check")).toContainText("Pas de position GPS");
  await expect(page.getByTestId("to-check")).toContainText("Position approximative");
  await expect(page.getByTestId("to-check")).toContainText("Point hors route");

  // A) pas de position -> saisie manuelle (repli commune) -> « Position approximative » -> acceptée
  const rowA = rows.filter({ hasText: "Lieu-dit Les Granges" });
  await rowA.getByTestId("fix-open").click();
  await page.getByRole("tab", { name: "Saisie manuelle" }).click();
  await page.getByLabel("Adresse (texte libre)").fill("zzz introuvable");
  await page.getByLabel("Code postal").fill("69500");
  await page.getByLabel("Commune").fill("Bron");
  await page.getByTestId("fix-save-manual").click();
  await expect(rows.filter({ hasText: "Position approximative" })).toHaveCount(2); // A + B
  await rows.filter({ hasText: "zzz introuvable" }).getByTestId("fix-open").click();
  await page.getByTestId("fix-accept").click();
  await expect(rows).toHaveCount(2);

  // B) autocomplétion -> choix d'une suggestion -> point GPS enregistré une fois pour toutes
  await rows.filter({ hasText: "Craponne" }).getByTestId("fix-open").click();
  await page.getByRole("tab", { name: "Autre adresse" }).click();
  const q = page.getByRole("combobox");
  await q.fill("12 rue de la république lyon");
  await expect(page.getByTestId("address-suggestions")).toBeVisible();
  await page.getByRole("option").first().click();
  await expect(page.getByTestId("fix-picked")).toBeVisible();
  await page.getByTestId("fix-save-search").click();
  await expect(rows).toHaveCount(1);

  // C) point hors route -> coordonnées GPS collées
  await rows.first().getByTestId("fix-open").click();
  await expect(page.getByTestId("gps-field")).toContainText("clic droit");
  await expect(page.getByTestId("open-gmaps")).toHaveAttribute("href", /maps\.google\.com\/\?q=/);
  await page.getByTestId("fix-coords").fill("45.7640, 4.8357");
  await page.getByTestId("fix-save-coords").click();
  await expect(page.getByTestId("to-check")).toHaveCount(0);
  await expect(page.getByTestId("pending-count")).toHaveText("10");

  const id = await orgId();
  const fixed = await admin.from("appointments").select("location_address, lat, lng, geo_precision, geo_source, geo_accepted").eq("org_id", id).eq("is_simulation", true).eq("dispatch_status", "unassigned").in("status", ["confirmed"]);
  expect(fixed.data).toHaveLength(10);
  expect(fixed.data!.every((a) => a.lat !== null && a.lng !== null && a.geo_precision)).toBe(true);
  expect(fixed.data!.some((a) => a.geo_source === "manual")).toBe(true);
  const ev = await admin.from("lead_events").select("payload").eq("org_id", id).contains("payload", { action: "geo_fixed" });
  expect(ev.data!.length).toBeGreaterThanOrEqual(3); // corrections journalisées

  // Répartir automatiquement -> aperçu d'abord (rien d'écrit)
  await page.getByTestId("dispatch-run").click();
  await expect(page.getByTestId("proposal")).toBeVisible();
  await expect(page.getByTestId("traffic-warning").first()).toContainText("Attention : les conditions réelles de circulation peuvent varier.");
  await expect(page.getByTestId("routing-banner")).toContainText(/OSRM|test/);
  await expect(page.getByTestId("leg").first()).toContainText(/\d+ min · [\d.]+ km/);
  await expect(page.getByTestId("open-route").first()).toHaveAttribute("href", /google\.com\/maps\/dir/);
  await expect(page.getByTestId("gauge").first()).toContainText(/\d RDV sur 4/);
  const stillPending = await admin.from("appointments").select("id", { count: "exact", head: true }).eq("org_id", id).eq("is_simulation", true).eq("dispatch_status", "unassigned").eq("status", "confirmed");
  expect(stillPending.count).toBe(10);
  await page.screenshot({ path: "test-results/dispatch-desktop.png", fullPage: true });

  // Valider la répartition
  await page.getByTestId("dispatch-apply").click();
  await expect(page.getByTestId("dispatch-done")).toContainText("RDV attribué(s)");
  await expect(page.getByTestId("dispatch-done")).toContainText("aucun commercial notifié");
  const placed = await admin.from("appointments").select("id, assigned_to, starts_at, ends_at, dispatch_status").eq("org_id", id).eq("is_simulation", true).eq("dispatch_status", "assigned").not("dispatched_at", "is", null);
  expect(placed.data!.length).toBe(10);
  // Valider une simulation ne notifie personne et ne change aucun propriétaire de lead
  expect(await notifCount(id)).toBe(notifsBefore);
  const simLeads = await admin.from("leads").select("assigned_to").eq("org_id", id).eq("is_simulation", true);
  expect(simLeads.data).toHaveLength(10);
  expect(simLeads.data!.every((l) => l.assigned_to === null)).toBe(true);
  const zones = (await admin.from("sales_zones").select("user_id, work_start, work_end, work_days").eq("org_id", id)).data!;
  const all = (await admin.from("appointments").select("assigned_to, starts_at, ends_at").eq("org_id", id).eq("dispatch_status", "assigned").neq("status", "cancelled")).data!;
  for (const a of placed.data!) {
    const z = zones.find((x) => x.user_id === a.assigned_to)!;
    const s = parisParts(a.starts_at!);
    const e = parisParts(a.ends_at!);
    expect(s.min).toBeGreaterThanOrEqual(toMin(z.work_start));
    expect(e.min).toBeLessThanOrEqual(toMin(z.work_end));
    const perDay = all.filter((x) => x.assigned_to === a.assigned_to && parisParts(x.starts_at!).day === s.day).length;
    expect(perDay).toBeLessThanOrEqual(5); // norme 4, confort 5 : jamais de 6e automatique
  }

  // Dernier mot du confirmateur : modifier un RDV -> verrouillé, jamais défait par un nouveau calcul
  await page.reload();
  await expect(page).toHaveURL(/vue=simulation/);
  await expect(page.getByTestId("dispatched")).toBeVisible();
  const row = page.getByTestId("dispatched-row").first();
  await row.getByTestId("edit-open").click();
  await page.getByLabel("Heure").fill("18:30");
  await page.getByTestId("edit-save").click();
  await expect(page.getByTestId("locked-badge").first()).toBeVisible();
  const locked = (await admin.from("appointments").select("id, assigned_to, starts_at, locked_by_dispatcher").eq("org_id", id).eq("is_simulation", true).eq("locked_by_dispatcher", true)).data!;
  expect(locked).toHaveLength(1);
  // Un seul jeu de simulation à la fois : relancer ne l'écrase pas (et ne défait pas le verrou)
  await page.getByTestId("sim-launch").click();
  await expect(page.getByText("Une simulation est déjà en cours")).toBeVisible();
  const rerun = await admin.from("appointments").select("assigned_to, starts_at, locked_by_dispatcher").eq("id", locked[0]!.id).single();
  expect(rerun.data).toMatchObject({ assigned_to: locked[0]!.assigned_to, starts_at: locked[0]!.starts_at, locked_by_dispatcher: true });

  // Isolation : la vue réelle n'affiche ni RDV à attribuer ni RDV simulés ; les leads simulés sont absents des listes
  await page.getByTestId("sim-back").click();
  await expect(page).not.toHaveURL(/vue=simulation/);
  await expect(page.getByTestId("pending-count")).toHaveText("0");
  await expect(page.getByTestId("dispatched-row")).toHaveCount(0);
  await expect(page.getByTestId("sim-open")).toBeVisible();
  await page.goto("/leads?view=table");
  await page.getByLabel("Rechercher un lead").fill("SIMULATION");
  await expect(page.getByText("Aucun lead").first()).toBeVisible();
  await page.goto("/agenda");
  await expect(page.getByText("[SIMULATION]")).toHaveCount(0);

  // Le commercial concerné : sa tournée (vrai RDV), durées réelles, avertissement, « Signaler un problème » ; la simulation lui est invisible
  const real = await seedRealAppointment(id);
  await logout(page);
  await login(page, real.repEmail);
  await page.goto("/agenda");
  await expect(page.getByTestId("my-tour")).toBeVisible();
  // jamais les 10 RDV simulés : aucun lead du jeu de simulation dans la tournée, seulement le vrai RDV (et ceux du jeu de démo)
  const simNames = (await admin.from("leads").select("first_name, last_name").eq("org_id", id).eq("is_simulation", true)).data!.map((l) => `${l.first_name} ${l.last_name}`.trim());
  expect(simNames).toHaveLength(10);
  const tourText = await page.getByTestId("my-tour").innerText();
  for (const n of simNames) expect(tourText).not.toContain(n);
  await expect(page.getByTestId("tour-stop").filter({ hasText: "Réel Tournée" })).toHaveCount(1);
  await expect(page.getByTestId("my-tour").getByTestId("traffic-warning")).toContainText("circulation peuvent varier");
  await expect(page.getByTestId("my-tour").getByTestId("open-route").first()).toBeVisible();
  await page.getByTestId("tour-stop").filter({ hasText: "Réel Tournée" }).getByTestId("issue-open").click();
  await page.getByLabel("Votre message").fill("Le client n'est pas joignable");
  await page.getByTestId("issue-send").click();
  await expect(page.getByText("Le confirmateur a été prévenu.")).toBeVisible();
  const own = (await admin.from("appointments").select("assigned_to, dispatch_status, locked_by_dispatcher").eq("id", real.apptId).single()).data!;
  expect(own).toMatchObject({ assigned_to: real.repId, dispatch_status: "assigned", locked_by_dispatcher: false }); // aucun effet automatique sur la répartition
  await page.goto("/agenda/repartition");
  await expect(page.getByText("Accès refusé")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Répartition" })).toHaveCount(0);
  await logout(page);

  // Le confirmateur voit le problème signalé (vue réelle), puis supprime la simulation (aucun vrai RDV concerné)
  await login(page, "confirmateur@demo.test");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Répartition" }).click();
  await expect(page.getByTestId("issue")).toContainText("Le client n'est pas joignable");
  await page.getByTestId("sim-clear").click();
  await expect(page.getByText(/Simulation supprimée, dont 10 RDV simulé\(s\) déjà attribué\(s\)/)).toBeVisible();
  await expect(page.getByTestId("pending-count")).toHaveText("0");
  await expect(page.getByTestId("sim-clear")).toHaveCount(0);
  expect((await admin.from("leads").select("id", { count: "exact", head: true }).eq("org_id", id).eq("is_simulation", true)).count).toBe(0);
  expect((await admin.from("appointments").select("id").eq("id", real.apptId)).data).toHaveLength(1); // le vrai RDV est intact
  await cleanup();
});

test("confirmateur : voit et utilise la répartition ; prospecteur refusé", async ({ page }) => {
  await login(page, "confirmateur@demo.test");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Répartition" }).click();
  await expect(page.getByRole("heading", { name: "Répartition automatique" })).toBeVisible();
  await expect(page.getByTestId("sim-launch")).toBeVisible();
  await logout(page);
  await login(page, "prospecteur@demo.test");
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Répartition" })).toHaveCount(0);
  await page.goto("/agenda/repartition");
  await expect(page.getByText("Accès refusé")).toBeVisible();
});

test("Réglages > Membres : horaires de Pauline et réglages de la répartition", async ({ page }) => {
  await login(page, "admin.energies@demo.test");
  await page.goto("/settings/members");
  await page.getByRole("button", { name: "Horaires de Karim Benali" }).click();
  await expect(page.getByLabel("Début de journée")).toHaveValue("10:00");
  await expect(page.getByLabel("Fin de journée")).toHaveValue("20:00");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Réglages de la répartition" }).click();
  await expect(page.getByLabel("Trajet max entre 2 RDV (min de route)")).toBeVisible();
  await page.getByLabel("Marge de sécurité (%)").fill("12");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  const id = await orgId();
  expect((await admin.from("dispatch_settings").select("safety_margin_pct").eq("org_id", id).single()).data!.safety_margin_pct).toBe(12);
  await admin.from("dispatch_settings").delete().eq("org_id", id);
});

const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
async function snapshot(id: string, label: string) {
  const { data } = await admin.from("appointments").select("assigned_to, starts_at, ends_at, locked_by_dispatcher").eq("org_id", id).eq("is_simulation", true).eq("dispatch_status", "assigned");
  const sim = data ?? [];
  const names = new Map((await admin.from("profiles").select("id, full_name")).data!.map((p) => [p.id, p.full_name]));
  const by: Record<string, number> = {};
  for (const a of sim) { const k = `${names.get(a.assigned_to!)} ${parisParts(a.starts_at!).day}`; by[k] = (by[k] ?? 0) + 1; }
  console.log(`SIMULATION ${label}: ${sim.length} RDV attribués ${JSON.stringify(by)}`);
  return sim;
}

test("scénario guidé de simulation (confirmateur) : répartir -> 3 à vérifier -> coordonnées Google Maps -> rééquilibrer -> valider", async ({ page }) => {
  test.setTimeout(240_000);
  await cleanup();
  const id = await orgId();
  await login(page, "confirmateur@demo.test");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Répartition" }).click();
  const notifsBefore = await notifCount(id);
  await page.getByTestId("sim-launch").click();
  await expect(page).toHaveURL(/vue=simulation/);
  await expect(page.getByTestId("sim-steps")).toBeVisible();
  await expect(page.getByTestId("sim-step")).toHaveCount(5);
  await expect(page.getByTestId("to-check-row")).toHaveCount(3);

  // 1. Répartir : 7 proposés, 3 à vérifier (jamais ignorés en silence)
  await page.getByTestId("dispatch-run").click();
  await expect(page.getByTestId("proposal-summary")).toContainText("7 RDV proposés");
  const summary1 = await page.getByTestId("proposal-summary").innerText();
  await expect(page.getByTestId("to-check")).toContainText("Pas de position GPS");
  await page.getByTestId("dispatch-apply").click();
  await expect(page.getByTestId("dispatch-done")).toContainText("7 RDV attribué(s)");
  const first = await snapshot(id, "avant correction");
  expect(first).toHaveLength(7);

  // Le confirmateur verrouille un RDV déjà placé : il ne bougera plus
  await page.reload();
  await page.getByTestId("dispatched-row").first().getByRole("button", { name: "Verrouiller" }).click();
  await expect(page.getByTestId("locked-badge")).toHaveCount(1);
  const lockedBefore = (await admin.from("appointments").select("id, assigned_to, starts_at").eq("org_id", id).eq("is_simulation", true).eq("locked_by_dispatcher", true).single()).data!;

  // 2-3. Corriger les 3 avec des coordonnées Google Maps (formats variés)
  const rows = page.getByTestId("to-check-row");
  const coords = ["https://www.google.com/maps/place/Les+Granges/@45.7500,4.8500,15z/data=!3m1", "45,7719 ; 4,8902", "45.7369, 4.9132"];
  for (const c of coords) {
    await rows.first().getByTestId("fix-open").click();
    await page.getByTestId("fix-coords").fill(c);
    await expect(page.getByTestId("gps-ok")).toBeVisible();
    await page.getByTestId("fix-save-coords").click();
    await expect(page.getByText("Position enregistrée.").first()).toBeVisible();
    await page.waitForTimeout(400);
  }
  await expect(page.getByTestId("to-check")).toHaveCount(0);
  const ev = await admin.from("lead_events").select("payload, actor_id").eq("org_id", id).contains("payload", { action: "geo_fixed", mode: "gps" });
  expect(ev.data).toHaveLength(3); // auteur + date journalisés
  expect(ev.data!.every((e) => e.actor_id)).toBe(true);

  // 4. Rééquilibrer : aperçu avant / après, puis 5. valider
  await expect(page.getByTestId("rebalance-banner")).toContainText("Position corrigée");
  await page.getByTestId("rebalance-run").click();
  await expect(page.getByTestId("rebalance-diff")).toBeVisible();
  await expect(page.getByTestId("proposal-summary")).toContainText("3 RDV proposés");
  await page.getByTestId("dispatch-apply").click();
  await expect(page.getByTestId("dispatch-done")).toContainText("3 RDV attribué(s)");
  const all = await snapshot(id, "après correction");
  expect(all).toHaveLength(10);
  expect(await notifCount(id)).toBe(notifsBefore); // simulation : jamais de notification
  const lockedAfter = (await admin.from("appointments").select("assigned_to, starts_at").eq("id", lockedBefore.id).single()).data!;
  expect(lockedAfter).toMatchObject({ assigned_to: lockedBefore.assigned_to, starts_at: lockedBefore.starts_at }); // RDV verrouillé préservé
  const zones = (await admin.from("sales_zones").select("user_id, work_start, work_end").eq("org_id", id)).data!;
  const every = (await admin.from("appointments").select("assigned_to, starts_at, ends_at").eq("org_id", id).eq("dispatch_status", "assigned").neq("status", "cancelled")).data!;
  for (const a of all) {
    const z = zones.find((x) => x.user_id === a.assigned_to)!;
    const st = parisParts(a.starts_at!);
    expect(st.min).toBeGreaterThanOrEqual(toMin(z.work_start));
    expect(parisParts(a.ends_at!).min).toBeLessThanOrEqual(toMin(z.work_end));
    expect(every.filter((x) => x.assigned_to === a.assigned_to && parisParts(x.starts_at!).day === st.day).length).toBeLessThanOrEqual(5);
  }
  console.log(`SIMULATION résumé aperçu 1 : ${summary1} ; horaires ex. ${all.slice(0, 3).map((a) => fmt(parisParts(a.starts_at!).min)).join(", ")}`);
  await cleanup();
});

test("cas commercial : il fournit les coordonnées exactes de son RDV, le confirmateur rééquilibre", async ({ page }) => {
  test.setTimeout(240_000);
  await cleanup();
  const id = await orgId();
  // vrai RDV attribué (la simulation, invisible du commercial, ne sert pas ici)
  const real = await seedRealAppointment(id);
  await login(page, real.repEmail);
  await page.goto("/agenda");
  await expect(page.getByTestId("my-tour")).toBeVisible();
  // ce commercial ne peut ni déplacer ni attribuer : seulement signaler / fournir la position
  const tourStop = page.getByTestId("tour-stop").filter({ hasText: "Réel Tournée" });
  await tourStop.getByTestId("issue-open").click();
  await page.getByTestId("fix-coords").fill("not-a-position");
  await page.getByTestId("issue-send").click();
  await expect(page.getByText(/Format non reconnu/)).toBeVisible();
  await page.getByTestId("fix-coords").fill("45.7480, 4.8420");
  await page.getByTestId("issue-send").click();
  await expect(page.getByText("Position transmise : le confirmateur va rééquilibrer.")).toBeVisible();
  const flagged = (await admin.from("appointments").select("id, needs_rebalance, lat, lng, geo_precision, assigned_to, starts_at, locked_by_dispatcher").eq("org_id", id).eq("needs_rebalance", true)).data!;
  expect(flagged).toHaveLength(1);
  expect(flagged[0]).toMatchObject({ id: real.apptId, lat: 45.748, lng: 4.842, geo_precision: "manual_coords" });
  const startsBefore = flagged[0]!.starts_at;
  const notified = await admin.from("notifications").select("payload").eq("org_id", id).like("payload->>message", "%Position corrigée par%");
  expect(notified.data!.length).toBeGreaterThan(0);
  await logout(page);

  await login(page, "confirmateur@demo.test");
  await page.goto("/agenda/repartition");
  await expect(page.getByTestId("rebalance-banner")).toContainText("Position corrigée");
  await page.getByTestId("rebalance-run").click();
  await expect(page.getByTestId("rebalance-diff")).toBeVisible();
  await expect(page.getByTestId("diff-row")).toHaveCount(1);
  await page.getByTestId("dispatch-apply").click();
  await expect(page.getByTestId("dispatch-done")).toContainText("et notifiés aux commerciaux"); // vrai RDV : le commercial est prévenu
  const after = (await admin.from("appointments").select("needs_rebalance, assigned_to, starts_at").eq("id", real.apptId).single()).data!;
  expect(after.needs_rebalance).toBe(false);
  expect(startsBefore).toBeTruthy();
  await cleanup();
});

test("télépro : « RDV à attribuer » (jours souhaités, sans commercial ni heure) -> le confirmateur le confirme", async ({ page }) => {
  test.setTimeout(180_000);
  await cleanup();
  const id = await orgId();
  const tele = (await admin.from("profiles").select("id").eq("email", "prospecteur@demo.test").single()).data!.id;
  const lead = (await admin.from("leads").select("id, first_name, last_name, company").eq("org_id", id).eq("created_by", tele).not("first_name", "is", null).neq("first_name", "").neq("last_name", "").eq("is_simulation", false).limit(1).single()).data!;
  const name = `${lead.first_name} ${lead.last_name}`.trim();
  const countOf = async () => (await admin.from("appointments").select("id", { count: "exact", head: true }).eq("lead_id", lead.id).eq("dispatch_status", "unassigned")).count ?? 0;
  const before = await countOf();

  await login(page, "prospecteur@demo.test");
  await page.goto("/agenda");
  await page.getByRole("button", { name: /Nouveau RDV/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Lead").selectOption({ label: name });
  await dialog.getByTestId("to-assign-toggle").getByRole("checkbox").check();
  // plus de choix du commercial ni de l'heure : jours souhaités (Du / Au) + durée
  await expect(dialog.getByLabel("Commercial", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Heure", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Du", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Au", { exact: true })).toBeVisible();
  await dialog.getByLabel("Lieu").fill("1 place Bellecour, 69002 Lyon");
  await dialog.getByRole("button", { name: "Demander l'attribution" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(countOf).toBe(before + 1);
  const created = (await admin.from("appointments").select("id, status, dispatch_status, assigned_to, starts_at, wish_from, wish_to, created_by").eq("lead_id", lead.id).eq("dispatch_status", "unassigned").order("created_at", { ascending: false }).limit(1).single()).data!;
  teleproAppts.push(created.id);
  expect(created).toMatchObject({ status: "planned", assigned_to: null, starts_at: null, created_by: tele });
  expect(created.wish_from).toBeTruthy();
  expect(created.wish_to! >= created.wish_from!).toBe(true);
  await logout(page);

  // Le confirmateur le voit « à confirmer », le confirme ; il rejoint les RDV à répartir
  await login(page, "confirmateur@demo.test");
  await page.goto("/agenda/repartition");
  await expect(page.getByText("À confirmer avant répartition")).toBeVisible();
  const li = page.locator("li").filter({ hasText: name }).filter({ has: page.getByRole("button", { name: "Confirmer", exact: true }) }).first();
  await li.getByRole("button", { name: "Confirmer", exact: true }).click();
  await expect(page.getByText("RDV confirmé.")).toBeVisible();
  await expect(page.getByTestId("pending-list")).toContainText(name);
  expect((await admin.from("appointments").select("status, assigned_to").eq("id", created.id).single()).data).toMatchObject({ status: "confirmed", assigned_to: null });
  await cleanup();
});

test("au-delà du confort (6e RDV) : proposé seulement, case décochée, décision du confirmateur verrouillée ; gauge x/4", async ({ page }) => {
  test.setTimeout(240_000);
  await cleanup();
  const id = await orgId();
  const st = (await admin.from("statuses").select("id").eq("org_id", id).eq("is_initial", true).single()).data!.id;
  const spots = [[45.7597, 4.8422], [45.7640, 4.8357], [45.7497, 4.8420], [45.7500, 4.8500], [45.7560, 4.8300], [45.7700, 4.8450], [45.7480, 4.8280], [45.7620, 4.8520], [45.7550, 4.8400], [45.7680, 4.8330], [45.7590, 4.8250], [45.7530, 4.8470], [45.7650, 4.8480], [45.7570, 4.8390]];
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const day = new Date(`${nextWorkday()}T12:00:00Z`); // ni week-end ni jour férié
  for (const [i, [la, lo]] of spots.entries()) {
    const l = (await admin.from("leads").insert({ org_id: id, status_id: st, first_name: "Charge", last_name: `Test${i}`, company: E2E_CO, address: `${i + 1} rue Test, Lyon` }).select("id").single()).data!.id;
    await admin.from("appointments").insert({ org_id: id, lead_id: l, assigned_to: null, starts_at: null, ends_at: null, status: "confirmed", dispatch_status: "unassigned", wish_from: ymd(day), wish_to: ymd(day), duration_min: 45, lat: la, lng: lo, geo_precision: "housenumber", geo_source: "ban", location_address: `${i + 1} rue Test, Lyon` });
  }
  await login(page, "confirmateur@demo.test");
  await page.goto("/agenda/repartition");
  await page.getByTestId("dispatch-run").click();
  await expect(page.getByTestId("proposal")).toBeVisible();
  await expect(page.getByTestId("gauge").first()).toContainText(/\d RDV sur 4/);
  const fifth = page.getByTestId("fifth");
  await expect(fifth).toBeVisible();
  await expect(fifth).toContainText(/6e RDV : journée chargée/);
  const boxes = page.getByTestId("fifth-check");
  expect(await boxes.count()).toBeGreaterThan(0);
  for (let i = 0; i < await boxes.count(); i++) await expect(boxes.nth(i)).not.toBeChecked();
  const loads = await page.getByTestId("load-note").allInnerTexts();
  expect(loads.every((t) => /^\d+e RDV ajouté : \+\d+ min de route seulement$/.test(t.trim()))).toBe(true);
  await page.getByTestId("dispatch-apply").click();
  await expect(page.getByTestId("dispatch-done")).toBeVisible();
  const perRep = async () => {
    const rows = (await admin.from("appointments").select("assigned_to, starts_at, locked_by_dispatcher, lead:leads(company)").eq("org_id", id).eq("is_simulation", false).eq("dispatch_status", "assigned").neq("status", "cancelled")).data!;
    const by: Record<string, number> = {};
    for (const a of rows) if (parisParts(a.starts_at!).day === ymd(day)) by[a.assigned_to!] = (by[a.assigned_to!] ?? 0) + 1;
    return { by, rows };
  };
  const before = await perRep();
  expect(Math.max(...Object.values(before.by))).toBeLessThanOrEqual(5); // jamais de 6e automatique
  await page.getByTestId("dispatch-run").click();
  await expect(page.getByTestId("fifth")).toBeVisible();
  await page.getByTestId("fifth-check").first().check();
  await page.getByTestId("dispatch-apply").click();
  await expect(page.getByTestId("dispatch-done")).toContainText("1 RDV attribué(s)");
  const after = await perRep();
  expect(Math.max(...Object.values(after.by))).toBe(6);
  expect(after.rows.filter((r) => r.locked_by_dispatcher && (r.lead as unknown as { company: string } | null)?.company === E2E_CO)).toHaveLength(1); // décision verrouillée
  console.log(`CHARGE par commercial le ${ymd(day)} avant/après 6e : ${JSON.stringify(before.by)} -> ${JSON.stringify(after.by)}`);
  await cleanup();
});
