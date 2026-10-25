/* Génère src/components/marketing/lyon-map-data.ts : fond de carte OpenStreetMap (© OpenStreetMap contributors, ODbL)
   de l'agglomération lyonnaise + itinéraires OSRM réels entre les arrêts de la démo « moteur de répartition » (landing).
   À lancer à la main, rarement : node scripts/gen-lyon-map.mjs [osm.json en cache]
   - Overpass : UNE requête (ou lit le fichier en cache passé en argument).
   - OSRM : instance locale (npm run routing:up), http://127.0.0.1:56500.
   Rien n'est appelé à l'exécution de la landing : le module généré est statique. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const OSRM = process.env.OSRM_URL ?? "http://127.0.0.1:56500";
const W = 880, H = 760, M_PER_UNIT = 11.5;
/* Cadre affiché (unités de carte) : x, y, largeur, hauteur. */
const VIEW = [90, 10, 720, 710];
const LON0 = 4.87, LAT0 = 45.7315;
const COS = Math.cos((LAT0 * Math.PI) / 180);
const proj = (lon, lat) => [W / 2 + ((lon - LON0) * 111320 * COS) / M_PER_UNIT, H / 2 - ((lat - LAT0) * 111320) / M_PER_UNIT];

/* ---------- points de la démo (clients fictifs, lieux réels) ---------- */
const REPS = [
  { name: "Pauline", base: { label: "Place Bellecour", ll: [4.832, 45.7578] },
    stops: [
      { label: "Perrache", commune: "Lyon 2e", ll: [4.8265, 45.7487] },
      { label: "Part-Dieu", commune: "Lyon 3e", ll: [4.8573, 45.7607] },
      { label: "Jean Macé", commune: "Lyon 7e", ll: [4.842, 45.7455] },
      { label: "Cusset", commune: "Villeurbanne", ll: [4.8755, 45.764] },
    ] },
  { name: "Karim", base: { label: "Place Léon Sublet", ll: [4.887, 45.7065] },
    stops: [
      { label: "Les Minguettes", commune: "Vénissieux", ll: [4.88, 45.699] },
      { label: "Centre", commune: "Saint-Fons", ll: [4.8545, 45.7075] },
      { label: "Mermoz", commune: "Lyon 8e", ll: [4.8755, 45.741] },
      { label: "Parilly", commune: "Bron", ll: [4.9105, 45.7385] },
    ] },
];
const OUT = { label: "Saint-Étienne", ll: [4.3872, 45.4397] };

/* ---------- Overpass ---------- */
const cache = process.argv[2];
let osm;
if (cache && existsSync(cache)) osm = JSON.parse(readFileSync(cache, "utf8"));
else {
  const bb = "45.690,4.790,45.790,4.940";
  const q = `[out:json][timeout:90];(
 way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|residential|unclassified|living_street)$"](${bb});
 way["natural"="water"](${bb}); way["waterway"="riverbank"](${bb});
 way["leisure"~"^(park|garden)$"](${bb}); way["landuse"~"^(grass|forest|recreation_ground)$"](${bb});
 relation["natural"="water"](${bb}); relation["leisure"="park"](${bb}); relation["waterway"="riverbank"](${bb});
);out geom;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "User-Agent": "leadforge-landing-map-gen/1.0", "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
  if (!res.ok) throw new Error("Overpass " + res.status);
  osm = await res.json();
  if (cache) writeFileSync(cache, JSON.stringify(osm));
}

/* ---------- géométrie ---------- */
const clampv = (v, max) => Math.max(-60, Math.min(max + 60, v));
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const inView = (pts) => pts.some(([x, y]) => x > -20 && x < W + 20 && y > -20 && y < H + 20);
const len = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
function pathOf(lines, close) {
  let d = "";
  for (const raw of lines) {
    const pts = raw.map(([x, y]) => [Math.round(clampv(x, W)), Math.round(clampv(y, H))]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    if (pts.length < 2) continue;
    d += `M${pts[0][0]} ${pts[0][1]}`;
    let s = "l";
    for (let i = 1; i < pts.length; i++) { s += `${pts[i][0] - pts[i - 1][0]} ${pts[i][1] - pts[i - 1][1]} `; }
    d += s.trimEnd() + (close ? "z" : "");
  }
  return d;
}
function joinRings(segs) {
  const key = (p) => p.join(",");
  const rings = [];
  const pool = segs.map((s) => s.slice());
  while (pool.length) {
    let cur = pool.pop();
    let guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 5000) {
      const end = key(cur[cur.length - 1]);
      let i = pool.findIndex((s) => key(s[0]) === end);
      if (i >= 0) { cur = cur.concat(pool.splice(i, 1)[0].slice(1)); continue; }
      i = pool.findIndex((s) => key(s[s.length - 1]) === end);
      if (i >= 0) { cur = cur.concat(pool.splice(i, 1)[0].reverse().slice(1)); continue; }
      break;
    }
    if (key(cur[0]) === key(cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

const cat = { motorway: [], primary: [], secondary: [], tertiary: [], minor: [] };
const water = [], parks = [];
const toXY = (g) => g.map((p) => proj(p.lon, p.lat));
for (const el of osm.elements) {
  const t = el.tags ?? {};
  if (el.type === "way" && el.geometry) {
    const xy = toXY(el.geometry);
    if (!inView(xy)) continue;
    if (t.highway) {
      const h = t.highway.replace("_link", "");
      const k = h === "motorway" || h === "trunk" ? "motorway" : h === "primary" ? "primary" : h === "secondary" ? "secondary" : h === "tertiary" ? "tertiary" : "minor";
      if (t.tunnel === "yes" && k === "minor") continue;
      const s = dp(xy, k === "minor" ? 1.2 : 0.6);
      if (k === "minor" && len(s) < 10) continue;
      cat[k].push(s);
    } else if (t.natural === "water" || t.waterway === "riverbank") { if (xy.length > 3) water.push(dp(xy, 0.8)); }
    else if (t.leisure || t.landuse) { if (xy.length > 3 && len(xy) > 70) parks.push(dp(xy, 2)); }
  } else if (el.type === "relation" && el.members) {
    const segs = el.members.filter((m) => m.type === "way" && m.geometry && m.role !== "").map((m) => m.geometry.map((p) => [p.lon, p.lat]));
    for (const ring of joinRings(segs)) {
      const xy = ring.map(([lo, la]) => proj(lo, la));
      if (!inView(xy)) continue;
      (t.leisure ? parks : water).push(dp(xy, t.leisure ? 2 : 0.8));
    }
  }
}

/* ---------- OSRM ---------- */
const lonlat = (ll) => `${ll[0]},${ll[1]}`;
async function osrm(path) { const r = await fetch(OSRM + path); const j = await r.json(); if (j.code !== "Ok") throw new Error(path + " " + j.code); return j; }
const result = { reps: [], out: null };
for (const rep of REPS) {
  const pts = [rep.base, ...rep.stops];
  const tbl = await osrm(`/table/v1/driving/${pts.map((p) => lonlat(p.ll)).join(";")}?annotations=duration`);
  // plus proche voisin depuis la base
  const order = []; const left = new Set(rep.stops.map((_, i) => i + 1)); let cur = 0;
  while (left.size) { let b = -1; for (const i of left) if (b < 0 || tbl.durations[cur][i] < tbl.durations[cur][b]) b = i; order.push(b); left.delete(b); cur = b; }
  const seq = [0, ...order];
  const legs = [];
  for (let i = 1; i < seq.length; i++) {
    const a = pts[seq[i - 1]], b = pts[seq[i]];
    const j = await osrm(`/route/v1/driving/${lonlat(a.ll)};${lonlat(b.ll)}?overview=full&geometries=geojson`);
    const r = j.routes[0];
    const xy = dp(r.geometry.coordinates.map(([lo, la]) => proj(lo, la)), 0.5).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    legs.push({ pts: xy, min: Math.max(1, Math.round(r.duration / 60)), km: Math.round(r.distance / 100) / 10 });
  }
  result.reps.push({ name: rep.name, base: { label: rep.base.label, xy: proj(...rep.base.ll).map((v) => Math.round(v * 10) / 10), ll: rep.base.ll }, stops: order.map((o) => ({ label: pts[o].label, commune: pts[o].commune, xy: proj(...pts[o].ll).map((v) => Math.round(v * 10) / 10), ll: pts[o].ll })), legs });
}
{
  const j = await osrm(`/route/v1/driving/${lonlat(REPS[1].base.ll)};${lonlat(OUT.ll)}?overview=false`);
  const [x, y] = proj(...OUT.ll);
  const cx = VIEW[0] + VIEW[2] / 2, cy = VIEW[1] + VIEW[3] / 2, dx = x - cx, dy = y - cy;
  const k = Math.min((VIEW[2] / 2 - 46) / Math.abs(dx || 1), (VIEW[3] / 2 - 46) / Math.abs(dy || 1));
  result.out = { label: OUT.label, min: Math.round(j.routes[0].duration / 60), km: Math.round(j.routes[0].distance / 1000), edge: [Math.round(cx + dx * k), Math.round(cy + dy * k)], angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI) };
}

/* ---------- labels de quartiers ---------- */
const LABELS = [
  ["Presqu'île", 4.8335, 45.7535], ["Lyon 7e", 4.8435, 45.7385], ["Lyon 8e", 4.866, 45.7335], ["Rhône", 4.8465, 45.7535], ["Saône", 4.8175, 45.769],
].map(([t, lo, la]) => ({ t, xy: proj(lo, la).map(Math.round) }));

const out = `/* GÉNÉRÉ par scripts/gen-lyon-map.mjs : ne pas éditer à la main.
   Fond de carte © OpenStreetMap contributors (ODbL). Itinéraires et durées : OSRM (données OSM), figés à la génération. */
export const MAP_W = ${W};
export const MAP_H = ${H};
export const M_PER_UNIT = ${M_PER_UNIT};
export const VIEW = ${JSON.stringify(VIEW)} as const;
export const MAP_PATHS = {
  water: ${JSON.stringify(pathOf(water, true))},
  parks: ${JSON.stringify(pathOf(parks, true))},
  minor: ${JSON.stringify(pathOf(cat.minor))},
  tertiary: ${JSON.stringify(pathOf(cat.tertiary))},
  secondary: ${JSON.stringify(pathOf(cat.secondary))},
  primary: ${JSON.stringify(pathOf(cat.primary))},
  motorway: ${JSON.stringify(pathOf(cat.motorway))},
};
export const MAP_LABELS: { t: string; xy: [number, number] }[] = ${JSON.stringify(LABELS)};
export const MAP_REPS: { name: string; base: { label: string; xy: [number, number] }; stops: { label: string; commune: string; xy: [number, number] }[]; legs: { pts: [number, number][]; min: number; km: number }[] }[] = ${JSON.stringify(result.reps.map((r) => ({ ...r, base: { label: r.base.label, xy: r.base.xy }, stops: r.stops.map((s) => ({ label: s.label, commune: s.commune, xy: s.xy })) })))};
export const MAP_OUT: { label: string; min: number; km: number; edge: [number, number]; angle: number } = ${JSON.stringify(result.out)};
`;
writeFileSync(new URL("../src/components/marketing/lyon-map-data.ts", import.meta.url), out);
console.log("ok", Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, v.length])), "water", water.length, "parks", parks.length, "bytes", out.length);
console.log(JSON.stringify(result.reps.map((r) => ({ n: r.name, stops: r.stops.map((s) => s.label), legs: r.legs.map((l) => `${l.min}min ${l.km}km ${l.pts.length}pts`) })), null, 1), JSON.stringify(result.out));
