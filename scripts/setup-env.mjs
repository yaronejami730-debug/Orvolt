#!/usr/bin/env node
// Génère .env.local depuis `supabase status -o env` sans écraser les clés Stripe ni les valeurs déjà saisies.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
process.env.PATH = `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}`;

function parse(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

let status;
try {
  status = parse(execFileSync("supabase", ["status", "-o", "env"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
} catch {
  console.error("[setup-env] Supabase local n'est pas démarré (supabase start).");
  process.exit(1);
}

const existing = existsSync(envPath) ? parse(readFileSync(envPath, "utf8")) : {};
const forced = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  SUPABASE_DB_URL: status.DB_URL,
  SUPABASE_JWT_SECRET: status.JWT_SECRET,
};
const defaults = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
  STRIPE_PRICE_STARTER: "",
  STRIPE_PRICE_PRO: "",
  STRIPE_PRICE_BUSINESS: "",
  WEBHOOK_SIGNING_SALT: randomBytes(24).toString("hex"),
  INBOUND_SECRET_KEY: randomBytes(32).toString("base64url"),
  CRON_SECRET: randomBytes(24).toString("hex"),
};
// Les clés Supabase locales sont toujours rafraîchies ; le reste conserve l'existant.
const merged = { ...defaults, ...existing, ...forced };
for (const k of Object.keys(defaults)) if (existing[k]) merged[k] = existing[k];

const body = Object.entries(merged).map(([k, v]) => `${k}=${v ?? ""}`).join("\n") + "\n";
writeFileSync(envPath, body);
console.log("[setup-env] .env.local écrit.");
