#!/usr/bin/env node
// Crée (ou retrouve) produits et prix Stripe en MODE TEST (lookup_key idempotents) et écrit STRIPE_PRICE_* dans .env.local.
// Clé : STRIPE_SECRET_KEY de .env.local (sk_test_… uniquement ; une clé live est refusée).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";
import { CURRENCY, PLAN_LIST } from "../src/lib/billing/plans.ts";

const envPath = resolve(import.meta.dirname, "..", ".env.local");
const env = {};
if (existsSync(envPath)) for (const l of readFileSync(envPath, "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const key = process.env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY || "";
const base = process.env.STRIPE_API_BASE || env.STRIPE_API_BASE || "";
if (!base && !key.startsWith("sk_test_")) {
  console.error("[stripe-setup] STRIPE_SECRET_KEY (sk_test_…) manquante dans .env.local : rien à faire.");
  process.exit(key ? 1 : 0);
}
const opts = base ? { host: new URL(base).hostname, port: new URL(base).port, protocol: new URL(base).protocol.replace(":", "") } : {};
const stripe = new Stripe(key || "sk_test_mock", opts);

/** Un produit par plan, retrouvé par metadata pour ne pas le dupliquer à chaque exécution. */
async function ensureProduct(p) {
  const found = await stripe.products.search({ query: `metadata['plan']:'${p.id}' AND active:'true'`, limit: 1 }).catch(() => ({ data: [] }));
  if (found.data[0]) return found.data[0].id;
  const product = await stripe.products.create({ name: `LeadForge ${p.name}`, description: p.seats === null ? "Utilisateurs illimités" : `${p.seats} utilisateurs`, metadata: { plan: p.id, seats: p.seats === null ? "unlimited" : String(p.seats) } });
  return product.id;
}

const ids = {};
for (const p of PLAN_LIST) {
  const product = await ensureProduct(p);
  for (const [interval, amount, lookupKey, suffix] of [["month", p.priceCents, p.lookupKey, ""], ["year", p.yearlyPriceCents, p.lookupKeyYearly, "_YEARLY"]]) {
    const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    let price = found.data[0];
    // Un prix Stripe est immuable : si le tarif a changé, on en crée un nouveau qui reprend la lookup_key.
    if (!price || price.unit_amount !== amount) {
      price = await stripe.prices.create({
        product, currency: CURRENCY, unit_amount: amount, recurring: { interval },
        lookup_key: lookupKey, transfer_lookup_key: true, metadata: { plan: p.id, interval },
      });
      console.log(`[stripe-setup] prix créé : ${p.name} ${interval === "year" ? "annuel" : "mensuel"} (${price.id})`);
    } else console.log(`[stripe-setup] prix existant : ${p.name} ${interval === "year" ? "annuel" : "mensuel"} (${price.id})`);
    ids[`STRIPE_PRICE_${p.id.toUpperCase()}${suffix}`] = price.id;
  }
}
if (base) { console.log("[stripe-setup] stripe-mock : identifiants non écrits dans .env.local."); process.exit(0); }
let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
for (const [k, v] of Object.entries(ids)) text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${text.replace(/\n?$/, "\n")}${k}=${v}\n`;
writeFileSync(envPath, text);
console.log("[stripe-setup] STRIPE_PRICE_* écrits dans .env.local.");
