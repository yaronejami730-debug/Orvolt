// db:reset : `supabase db reset`, puis storage rendu sain (sinon uploads en erreur 42P10), puis seed optionnel (--seed).
// --dry-run : affiche les étapes sans rien exécuter.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const dry = process.argv.includes("--dry-run");
const seed = process.argv.includes("--seed");
const env = { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` };
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1] ?? "SAAS_CRM";
const container = `supabase_storage_${projectId}`;
const run = (cmd, args) => { console.log(`> ${cmd} ${args.join(" ")}`); if (dry) return 0; return spawnSync(cmd, args, { stdio: "inherit", env }).status ?? 1; };

// `db reset` peut afficher un 502 au redémarrage des services alors que les migrations sont appliquées : on poursuit.
run("npx", ["supabase", "db", "reset"]);
// Redémarre uniquement le conteneur storage de CE projet (jamais un autre projet Docker).
run("docker", ["restart", container]);
if (!dry) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    try { ok = (await fetch(`${base}/storage/v1/status`)).status < 500; } catch { /* pas encore prêt */ }
    if (!ok) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!ok) { console.error("Storage injoignable après redémarrage."); process.exit(1); }
}
if (seed) process.exit(run("npm", ["run", "db:seed"]));
