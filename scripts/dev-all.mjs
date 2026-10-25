#!/usr/bin/env node
// Lance Supabase (idempotent), génère .env.local, puis Next dev + stripe listen (si configuré).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.env.PATH = `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}`;
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });

if (sh("supabase", ["status", "-o", "env"], { stdio: "pipe" }).status !== 0) {
  console.log("[dev-all] supabase start...");
  if (sh("supabase", ["start"], { stdio: "inherit" }).status !== 0) {
    console.error("[dev-all] Impossible de démarrer Supabase (Docker lancé ?).");
    process.exit(1);
  }
} else {
  console.log("[dev-all] Supabase déjà démarré.");
}
if (sh("node", ["scripts/setup-env.mjs"], { stdio: "inherit" }).status !== 0) process.exit(1);

const envFile = resolve(root, ".env.local");
const env = {};
if (existsSync(envFile)) {
  for (const l of readFileSync(envFile, "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}

// Stripe : produits/prix de test créés au besoin quand une clé sk_test_ est présente.
if ((env.STRIPE_SECRET_KEY || "").startsWith("sk_test_") && !env.STRIPE_PRICE_STARTER) {
  console.log("[dev-all] stripe:setup...");
  sh("node", ["scripts/stripe-setup.mjs"], { stdio: "inherit" });
}

const children = [spawn("npx", ["next", "dev"], { cwd: root, stdio: "inherit" })];
const key = env.STRIPE_SECRET_KEY || "";
const hasStripeCli = sh("stripe", ["--version"], { stdio: "pipe" }).status === 0;
if (key.startsWith("sk_test_") && hasStripeCli) {
  children.push(
    spawn("stripe", ["listen", "--api-key", key, "--forward-to", "localhost:3000/api/stripe/webhook"], { cwd: root, stdio: "inherit" }),
  );
} else {
  console.log("[dev-all] Stripe non configuré, listener ignoré.");
}

const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children[0].on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
