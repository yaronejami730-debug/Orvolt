#!/usr/bin/env node
// stripe-mock (image officielle stripe/stripe-mock) pour développer et tester la facturation sans clé Stripe.
// Usage : node scripts/stripe-mock.mjs up | down | run   (port 12111, uniquement sur 127.0.0.1 ; nom de conteneur dédié)
import { spawn, spawnSync } from "node:child_process";

const NAME = "leadforge-stripe-mock";
const PORT = process.env.STRIPE_MOCK_PORT || "12111";
process.env.PATH = `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}`;
const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", ...opts });

async function ready(timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/v1/customers`, { headers: { authorization: "Bearer sk_test_mock" } });
      if (r.status < 500) return true;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const mode = process.argv[2] ?? "up";
if (mode === "down") {
  docker(["rm", "-f", NAME]);
  console.log("[stripe-mock] arrêté");
} else if (mode === "up") {
  if (await ready(500)) { console.log("[stripe-mock] déjà actif"); process.exit(0); }
  docker(["rm", "-f", NAME]);
  const r = docker(["run", "-d", "--rm", "--name", NAME, "-p", `127.0.0.1:${PORT}:12111`, "stripe/stripe-mock:latest"]);
  if (r.status !== 0) { console.error("[stripe-mock] démarrage impossible :", r.stderr); process.exit(1); }
  console.log((await ready()) ? `[stripe-mock] prêt sur http://127.0.0.1:${PORT}` : "[stripe-mock] ne répond pas");
} else if (mode === "run") {
  // Premier plan (utilisé par Playwright) : s'arrête avec son parent.
  docker(["rm", "-f", NAME]);
  const child = spawn("docker", ["run", "--rm", "--name", NAME, "-p", `127.0.0.1:${PORT}:12111`, "stripe/stripe-mock:latest"], { stdio: "inherit" });
  const stop = () => { docker(["rm", "-f", NAME]); child.kill("SIGTERM"); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  child.on("exit", (c) => process.exit(c ?? 0));
}
