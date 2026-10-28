/**
 * Programmation des formulaires d'appel : un administrateur crée 2 domaines, 2 formulaires, programme, puis deux téléprospecteurs
 * (pompe à chaleur / photovoltaïque) se connectent et ne voient que SON formulaire sur une fiche lead ; changement de fenêtre temporelle.
 * Les comptes et l'organisation sont créés par l'API d'administration (données jetables, supprimées en fin de test).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const run = Date.now().toString(36);
const PASSWORD = "Passw0rd!e2e";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
const users = {
  boss: { email: `cs-boss-${run}@e2e.test`, name: `Boss ${run}` },
  pac: { email: `cs-pac-${run}@e2e.test`, name: `Pac ${run}` },
  pv: { email: `cs-pv-${run}@e2e.test`, name: `Pv ${run}` },
};
const DOM = { pac: `Pompe à chaleur ${run}`, pv: `Photovoltaïque ${run}` };
const FORM = { pac: `Formulaire PAC ${run}`, pv: `Formulaire PV ${run}` };
let org = "", leadId = "";
const ids: Record<string, string> = {};

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeAll(async () => {
  for (const [k, u] of Object.entries(users)) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: u.name } });
    if (error) throw error;
    ids[k] = data.user.id;
  }
  const boss = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
  await boss.auth.signInWithPassword({ email: users.boss.email, password: PASSWORD });
  org = (await boss.rpc("create_organization", { p_name: `CallScripts ${run}`, p_template: "energie" })).data as string;
  await admin.from("organizations").update({ seat_limit: 20, onboarded_at: new Date().toISOString() }).eq("id", org);
  const role = async (name: string) => (await admin.from("roles").select("id").eq("org_id", org).eq("name", name).single()).data!.id as string;
  for (const k of ["pac", "pv"]) {
    await admin.from("profiles").update({ provisioned_org: org }).eq("id", ids[k]);
    const { error } = await admin.from("memberships").insert({ org_id: org, user_id: ids[k], role_id: await role("Prospecteur") });
    if (error) throw error;
  }
  const status = (await admin.from("statuses").select("id").eq("org_id", org).eq("is_initial", true).limit(1)).data?.[0]?.id;
  leadId = (await admin.from("leads").insert({ org_id: org, status_id: status, first_name: "Jean", last_name: `Lead${run}`, phone: "0612345678" }).select("id").single()).data!.id;
});

test.afterAll(async () => {
  await admin.from("organizations").delete().eq("id", org);
  for (const id of Object.values(ids)) await admin.auth.admin.deleteUser(id);
});

test("programmation : le bon formulaire pour le bon téléprospecteur, puis changement de fenêtre", async ({ page }) => {
  // --- administrateur : domaines
  await login(page, users.boss.email);
  await page.goto("/settings/call-scripts");
  for (const d of Object.values(DOM)) {
    await page.getByLabel("Nouveau domaine").fill(d);
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page.getByTestId(`domain-${d}`)).toBeVisible();
  }

  // --- administrateur : deux formulaires, un par domaine
  for (const k of ["pac", "pv"] as const) {
    await page.getByRole("button", { name: "Nouveau formulaire" }).click();
    await page.getByLabel("Nom", { exact: true }).fill(FORM[k]);
    await page.getByLabel("Domaine", { exact: true }).selectOption({ label: DOM[k] });
    await page.getByLabel("Question 1").fill(`Question ${k}`);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByTestId(`script-${FORM[k]}`)).toBeVisible();
  }

  // --- administrateur : domaine de travail de chaque téléprospecteur (fiche du membre)
  await page.goto("/settings/members");
  for (const k of ["pac", "pv"] as const) {
    await page.getByRole("button", { name: `Formulaires d'appel de ${users[k].name}` }).click();
    await page.getByLabel(DOM[k]).check();
    await page.getByRole("button", { name: "Enregistrer les domaines" }).click();
    await expect(page.getByText("Domaines enregistrés.")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // --- administrateur : programmation « tous les membres du domaine » pour chaque formulaire
  await page.goto("/settings/call-scripts");
  for (const k of ["pac", "pv"] as const) {
    await page.getByTestId(`script-${FORM[k]}`).getByRole("button", { name: /Qui \/ quand/ }).click();
    await page.getByRole("button", { name: "Ajouter une programmation" }).click();
    await page.getByLabel("Pour qui ?").selectOption("domain");
    await page.getByLabel("Domaine", { exact: true }).selectOption({ label: DOM[k] });
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByTestId("assignment-row")).toHaveCount(1);
    await page.keyboard.press("Escape");
  }

  // --- téléprospecteurs : chacun ne voit que son formulaire
  for (const [k, other] of [["pac", "pv"], ["pv", "pac"]] as const) {
    await login(page, users[k].email);
    await page.goto(`/leads/${leadId}`);
    await expect(page.getByTestId("script-title")).toHaveText(FORM[k]);
    const options = await page.getByLabel("Formulaire", { exact: true }).locator("option").allInnerTexts();
    expect(options).toEqual([FORM[k]]);
    await expect(page.getByText(FORM[other])).toHaveCount(0);
  }

  // --- fenêtre temporelle : la programmation du PAC se termine hier -> plus aucun formulaire pour le téléprospecteur PAC
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await admin.from("call_script_assignments").update({ ends_on: yesterday }).eq("org_id", org).eq("scope", "domain").not("domain_id", "is", null)
    .in("script_id", [(await admin.from("call_scripts").select("id").eq("org_id", org).eq("name", FORM.pac).single()).data!.id]);
  await login(page, users.pac.email);
  await page.goto(`/leads/${leadId}`);
  await expect(page.getByText("Aucun formulaire pour vous")).toBeVisible();
  // ... et l'autre téléprospecteur est inchangé
  await login(page, users.pv.email);
  await page.goto(`/leads/${leadId}`);
  await expect(page.getByTestId("script-title")).toHaveText(FORM.pv);
});
