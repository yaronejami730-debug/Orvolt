#!/usr/bin/env node
// Seed de démonstration : 2 organisations, 5 comptes, 200 leads, RDV (idempotent, service_role, base locale uniquement).
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const r = spawnSync(resolve(root, "node_modules/.bin/tsx"), ["--conditions=react-server", resolve(root, "scripts/db-seed.ts")], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
