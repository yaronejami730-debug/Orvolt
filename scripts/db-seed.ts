import { config } from "dotenv";
import { DEMO_PASSWORD } from "./seed/data";
import { runSeed } from "./seed/seed";

config({ path: ".env.local", quiet: true });

const pad = (s: string, n: number) => s.padEnd(n);

runSeed({ log: (m) => console.log(m) })
  .then((r) => {
    console.log("\nComptes de démonstration (mot de passe commun : " + DEMO_PASSWORD + ")");
    const w = [34, 22, 24];
    console.log(pad("E-mail", w[0]!) + pad("Rôle", w[1]!) + "Organisation");
    console.log("-".repeat(w[0]! + w[1]! + w[2]!));
    for (const u of r.users) console.log(pad(u.email, w[0]!) + pad(u.role, w[1]!) + u.org);
    const t = r.totals;
    console.log(`\n${t.orgs} organisations, ${t.users} comptes, ${t.leads} leads, ${t.appointments} RDV (dont ${t.overRadius} hors rayon avec dérogation), ${t.tasks} tâches, ${t.notifications} notifications.`);
  })
  .catch((e) => {
    console.error("Seed en échec :", e instanceof Error ? e.message : e);
    process.exit(1);
  });
