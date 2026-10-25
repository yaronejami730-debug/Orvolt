import { execFileSync } from "node:child_process";

/** Démarre stripe-mock (Docker, port 12111) s'il ne tourne pas déjà : les tests de facturation n'ont besoin d'aucune clé Stripe. */
export default function setup() {
  try {
    execFileSync("node", ["scripts/stripe-mock.mjs", "up"], { stdio: "pipe", timeout: 90_000 });
  } catch {
    console.warn("[tests] stripe-mock indisponible : les tests d'intégration Stripe seront ignorés.");
  }
}
