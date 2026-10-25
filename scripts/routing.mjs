#!/usr/bin/env node
// Routage routier local (OSRM en Docker). Usage : node scripts/routing.mjs setup | up | down | status
//  setup : télécharge l'extrait Geofabrik Rhône-Alpes (taille affichée), le réduit autour de Lyon–Grenoble (osmium), prépare OSRM (MLD).
//  up / down : démarre / arrête le conteneur `leadforge-osrm` (docker-compose.routing.yml, 127.0.0.1:56500).
//  status : calcule Lyon -> Grenoble pour vérifier que le service répond (durée et distance réelles).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

process.env.PATH = `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}`;
const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "data/routing");
const PBF_URL = "https://download.geofabrik.de/europe/france/rhone-alpes-latest.osm.pbf";
const BBOX = "4.0,44.9,6.1,46.4"; // lon_min,lat_min,lon_max,lat_max : Saint-Étienne, Lyon, Bourg-en-Bresse, Grenoble
const IMAGE = "ghcr.io/project-osrm/osrm-backend:v5.27.1";
const PORT = process.env.ROUTING_PORT || "56500";
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
const mb = (f) => `${(statSync(f).size / 1048576).toFixed(0)} Mo`;
const mode = process.argv[2] ?? "status";

if (mode === "setup") {
  mkdirSync(dir, { recursive: true });
  const full = resolve(dir, "rhone-alpes.osm.pbf");
  const lyon = resolve(dir, "lyon.osm.pbf");
  if (!existsSync(resolve(dir, "lyon.osrm.mldgr"))) {
    if (!existsSync(lyon)) {
      if (!existsSync(full)) {
        const head = spawnSync("curl", ["-sIL", PBF_URL], { encoding: "utf8" }).stdout.match(/content-length:\s*(\d+)/gi)?.pop();
        console.log(`[routing] téléchargement Geofabrik Rhône-Alpes : ${head ? (Number(head.split(":")[1]) / 1048576).toFixed(0) + " Mo" : "taille inconnue"}`);
        if (run("curl", ["-fL", "--progress-bar", "-o", full, PBF_URL]).status !== 0) process.exit(1);
      }
      console.log(`[routing] fichier brut : ${mb(full)} ; découpe ${BBOX}`);
      if (run("docker", ["run", "--rm", "-v", `${dir}:/data`, "iboates/osmium:latest", "extract", "-b", BBOX, "--strategy", "complete_ways", "-o", "/data/lyon.osm.pbf", "--overwrite", "/data/rhone-alpes.osm.pbf"]).status !== 0) process.exit(1);
      rmSync(full, { force: true }); // économise le disque
    }
    console.log(`[routing] extrait réduit : ${mb(lyon)}`);
    for (const step of [["osrm-extract", "-p", "/opt/car.lua", "/data/lyon.osm.pbf"], ["osrm-partition", "/data/lyon.osrm"], ["osrm-customize", "/data/lyon.osrm"]]) {
      if (run("docker", ["run", "--rm", "-v", `${dir}:/data`, IMAGE, ...step]).status !== 0) process.exit(1);
    }
    rmSync(lyon, { force: true });
  }
  console.log("[routing] données prêtes. Lancez : npm run routing:up");
} else if (mode === "up") {
  process.exit(run("docker", ["compose", "-f", "docker-compose.routing.yml", "up", "-d"]).status ?? 1);
} else if (mode === "down") {
  process.exit(run("docker", ["compose", "-f", "docker-compose.routing.yml", "down"]).status ?? 1);
} else {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/route/v1/driving/4.8357,45.764;5.7245,45.1885?overview=false`);
    const j = await r.json();
    const rt = j.routes?.[0];
    if (!rt) throw new Error(j.message ?? j.code);
    console.log(`[routing] Lyon -> Grenoble : ${Math.round(rt.duration / 60)} min, ${(rt.distance / 1000).toFixed(1)} km (routier réel, sans trafic)`);
  } catch (e) {
    console.error(`[routing] indisponible sur 127.0.0.1:${PORT} : ${e.message}`);
    process.exit(1);
  }
}
