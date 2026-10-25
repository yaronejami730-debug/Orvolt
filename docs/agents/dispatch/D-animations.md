# D-animations — suivi
Périmètre : src/components/marketing/feature-demos.tsx, src/styles/marketing.css, (nouveau) src/components/marketing/engine-map.tsx. Pas de commit.

## 2026-10-25 13:45 — démarrage
- Fait : lecture de DISPATCH_STATUS, feature-demos.tsx (341 l.), marketing.css, tokens (clair = classe .light / [data-theme=light]).
- En cours : conception de la carte SVG (terrain/eau/parcs/blocs/rues, variables CSS --map-*), itinéraires sur rues.
- Prochaine étape : écrire engine-map.tsx + refonte EngineDemo, puis ImportDemo, puis typecheck/lint/captures.

## 2026-10-25 13:55 — CHANGEMENT DE CONSIGNE (utilisateur, prioritaire)
- La carte doit être une VRAIE carte OpenStreetMap de l'agglomération lyonnaise (pas dessinée à la main). Script de génération (Overpass, 1 requête polie) -> module statique src/components/marketing/lyon-map-data.ts (<150 Ko), projection Mercator, aucune requête à l'exécution. Attribution « © OpenStreetMap contributors ».
- Vraies coordonnées : Pauline = Place Bellecour, Karim = Place Léon Sublet (Vénissieux), 8-10 RDV réels (quartier/commune), 1 point hors zone (Saint-Étienne/Villefranche, indicateur en bord de carte).
- Vrais itinéraires : OSRM local si dispo (docker-compose.routing.yml, npm run routing:status, src/lib/routing/*), geometry=geojson figée dans le module ; sinon le dire dans le rapport et tracer sur le graphe OSM.
- Chorégraphie conservée (pins qui tombent, bouton+curseur, jauges, refus, fondu). Léger zoom/pan possible.
- Fichiers: src/components/marketing/engine-map.tsx (ébauche carte dessinée à la main, SERA REMPLACÉ), feature-demos.tsx, marketing.css.

## 2026-10-25 14:05 — données OSM + OSRM générées
- OSRM local OK (http://127.0.0.1:56500, container leadforge-osrm). Overpass OK (1 requête, bbox 45.690,4.790,45.790,4.940, cache scratchpad osm.json 25 Mo).
- scripts/gen-lyon-map.mjs (nouveau, relançable : `node scripts/gen-lyon-map.mjs <cache.json>`) -> src/components/marketing/lyon-map-data.ts = 119 Ko (limite 150).
  Pauline (Bellecour): Perrache 6 min 2 km, Jean Macé 5 min 2,1 km, Part-Dieu 8 min 3 km, Cusset (Villeurbanne) 7 min 2,7 km. Karim (Léon Sublet): Minguettes 3 min 1,6 km, Saint-Fons 6 min 3 km, Parilly (Bron) 10 min 6,6 km, Mermoz (Lyon 8e) 8 min 3,9 km. Hors zone: Saint-Étienne 52 min 58 km (depuis Karim).
- En cours : réécriture engine-map.tsx (MapBase réel, tailles en px via ratio u) + EngineDemo sur vraie carte. Ensuite ImportDemo, CSS (--map-*, keyframes), typecheck/lint, captures.

## 2026-10-25 14:25 — code écrit
- feature-demos.tsx : EngineDemo sur vraie carte (MapBase + MAP_REPS/LEGS OSRM), ImportDemo en 4 étapes (fichier, colonnes avec courbes, contrôle, pipeline). marketing.css : --map-* sombre/clair + keyframes. `npm run typecheck` OK.
- Prochaine étape : lint, captures Playwright (scratchpad), corrections visuelles.

## 2026-10-25 14:50 — TERMINÉ
- Fait : EngineDemo sur vraie carte OSM de Lyon (fond statique lyon-map-data.ts 119 Ko, itinéraires OSRM réels figés, bases Bellecour / Léon Sublet, 8 RDV + Saint-Étienne hors zone 52 min, attribution OSM), ImportDemo 4 étapes (fichier, colonnes avec courbes, contrôle, pipeline « À rappeler »). Mouvement réduit = état final complet (vérifié, rm-0.png).
- Vérifs : `npm run typecheck` OK ; `npm run lint` 0 erreur ; scrollWidth 390/390 et 1280/1280 (4 combinaisons).
- Captures : scratchpad d0-* (moteur) et d1-* (import), 1280 et 390, sombre et clair. Scripts: scratchpad shot.mjs, rm.mjs.
- Fichiers : src/components/marketing/{feature-demos.tsx,engine-map.tsx,lyon-map-data.ts}, src/styles/marketing.css, scripts/gen-lyon-map.mjs.
- Limite : sur 390 px les étiquettes de trajet courts se chevauchent un peu autour de Perrache / base Karim.
