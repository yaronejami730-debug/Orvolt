// Rapport de conversion du tunnel : node scripts/funnel-report.mjs [--days 30]
// Lit funnel_events (service-role, table verrouillée par RLS) et affiche, par étape, le nombre de comptes/visiteurs et le taux de passage.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const STEPS = ["signup_started", "email_verified", "account_created", "onboarding_done", "checkout_opened", "trial_started", "subscription_active"];
const LABELS = { signup_started: "Inscription démarrée (code demandé)", email_verified: "E-mail vérifié", account_created: "Compte créé", onboarding_done: "Activité renseignée", checkout_opened: "Paiement Stripe ouvert", trial_started: "Essai activé", subscription_active: "Abonnement actif" };
const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 30;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (.env.local)."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const since = new Date(Date.now() - days * 86_400_000).toISOString();
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("funnel_events").select("step, org_id, visitor_key, plan, source, created_at").gte("created_at", since).order("id").range(from, from + 999);
  if (error) { console.error("Lecture impossible (migration 20260211000000 appliquée ?) :", error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
// Unité = visiteur : l'étape « compte créé » relie l'organisation à l'empreinte de l'adresse ; les étapes suivantes n'ont que l'organisation.
const visitorOfOrg = new Map(rows.filter((r) => r.org_id && r.visitor_key).map((r) => [r.org_id, r.visitor_key]));
const unit = (r) => (r.org_id ? visitorOfOrg.get(r.org_id) ?? r.org_id : r.visitor_key);
const sets = Object.fromEntries(STEPS.map((s) => [s, new Set(rows.filter((r) => r.step === s).map(unit))]));
console.log(`Tunnel d'inscription, ${days} derniers jours (${rows.length} évènements)\n`);
let first = null, prev = null;
for (const s of STEPS) {
  const n = sets[s].size; first ??= n;
  const step = prev === null ? "" : prev ? `${((n / prev) * 100).toFixed(0)} % de l'étape précédente` : "n/a";
  const total = first ? `${((n / first) * 100).toFixed(0)} % du départ` : "";
  console.log(`${LABELS[s].padEnd(40)} ${String(n).padStart(6)}   ${step.padEnd(32)} ${total}`);
  prev = n;
}
const count = (key) => Object.entries(rows.filter((r) => r.step === "account_created").reduce((m, r) => ((m[r[key] ?? "(aucun)"] = (m[r[key] ?? "(aucun)"] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
console.log("\nComptes créés par source :", count("source").map(([k, n]) => `${k} ${n}`).join(", ") || "-");
console.log("Comptes créés par formule visée :", count("plan").map(([k, n]) => `${k} ${n}`).join(", ") || "-");
