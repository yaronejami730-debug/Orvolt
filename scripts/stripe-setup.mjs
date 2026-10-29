#!/usr/bin/env node
// Crée (ou retrouve) produits et prix Stripe en MODE TEST (lookup_key idempotents) et écrit STRIPE_PRICE_* dans .env.local.
// Clé : STRIPE_SECRET_KEY de .env.local (sk_test_… uniquement ; une clé live est refusée).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";
import { CURRENCY, PLAN_LIST, YEARLY_FREE_MONTHS, extraSeatLookupKey, extraSeatPriceCents } from "../src/lib/billing/plans.ts";
import { PREMIUM_TIERS, premiumLookupKey } from "../src/lib/billing/premium-tiers.ts";

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
  const product = await stripe.products.create({ name: `Orvolt ${p.name}`, description: p.seats === null ? "Utilisateurs illimités" : `${p.seats} utilisateurs`, metadata: { plan: p.id, seats: p.seats === null ? "unlimited" : String(p.seats) } });
  return product.id;
}

/** Prix à créer pour un plan : un par fréquence ; le Premium en a un par palier d'ancienneté (lookup_key suffixée _tN). */
function priceSpecs(p) {
  const tiers = p.id === "premium" ? PREMIUM_TIERS : [{ cents: p.priceCents }];
  return tiers.flatMap((t, i) => [
    { interval: "month", amount: t.cents, lookupKey: premiumLookupKey(p.lookupKey, i), env: i === 0 ? "" : null },
    { interval: "year", amount: t.cents * (12 - YEARLY_FREE_MONTHS), lookupKey: premiumLookupKey(p.lookupKeyYearly, i), env: i === 0 ? "_YEARLY" : null },
  ]);
}

const ids = {};
for (const p of PLAN_LIST) {
  const product = await ensureProduct(p);
  for (const { interval, amount, lookupKey, env: suffix } of priceSpecs(p)) {
    const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    let price = found.data[0];
    // Un prix Stripe est immuable : si le tarif a changé, on en crée un nouveau qui reprend la lookup_key.
    if (!price || price.unit_amount !== amount) {
      price = await stripe.prices.create({
        product, currency: CURRENCY, unit_amount: amount, recurring: { interval },
        lookup_key: lookupKey, transfer_lookup_key: true, metadata: { plan: p.id, interval },
      });
      console.log(`[stripe-setup] prix créé : ${lookupKey} (${price.id})`);
    } else console.log(`[stripe-setup] prix existant : ${lookupKey} (${price.id})`);
    if (suffix !== null) ids[`STRIPE_PRICE_${p.id.toUpperCase()}${suffix}`] = price.id;
  }
}
// Utilisateur supplémentaire : un produit et deux prix (mensuel, annuel) par plan à sièges fixes ; quantité = nombre d'utilisateurs en plus.
for (const p of PLAN_LIST.filter((x) => x.extraSeatCents !== null)) {
  const found = await stripe.products.search({ query: `metadata['plan']:'extra_seat_${p.id}' AND active:'true'`, limit: 1 }).catch(() => ({ data: [] }));
  const product = found.data[0]?.id ?? (await stripe.products.create({ name: `Orvolt ${p.name} : utilisateur supplémentaire`, metadata: { plan: `extra_seat_${p.id}` } })).id;
  for (const [interval, suffix] of [["month", ""], ["year", "_YEARLY"]]) {
    const amount = extraSeatPriceCents(p, interval);
    const lookupKey = extraSeatLookupKey(p, interval);
    let price = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0];
    if (!price || price.unit_amount !== amount) {
      price = await stripe.prices.create({ product, currency: CURRENCY, unit_amount: amount, recurring: { interval }, lookup_key: lookupKey, transfer_lookup_key: true, metadata: { plan: `extra_seat_${p.id}`, interval } });
      console.log(`[stripe-setup] prix créé : ${lookupKey} (${price.id})`);
    } else console.log(`[stripe-setup] prix existant : ${lookupKey} (${price.id})`);
    ids[`STRIPE_PRICE_EXTRA_SEAT_${p.id.toUpperCase()}${suffix}`] = price.id;
  }
}
if (base) { console.log("[stripe-setup] stripe-mock : identifiants non écrits dans .env.local."); process.exit(0); }
let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
for (const [k, v] of Object.entries(ids)) text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${text.replace(/\n?$/, "\n")}${k}=${v}\n`;
writeFileSync(envPath, text);
console.log("[stripe-setup] STRIPE_PRICE_* écrits dans .env.local.");
