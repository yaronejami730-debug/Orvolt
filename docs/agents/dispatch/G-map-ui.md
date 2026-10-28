# G-map-ui : aperçu de répartition lisible (vraie carte + liste claire)

## Fait (2026-10-25)
- Carte : `route-map.tsx` (Leaflet, import dynamique sans SSR via `dispatch-map.tsx`), tuiles `NEXT_PUBLIC_MAP_TILE_URL` (défaut tile.openstreetmap.org), attribution « © OpenStreetMap contributors », cadrage `fitBounds` sur base + arrêts du jour, thème sombre par filtre CSS (`route-map.css`, désactivé en `.light`). CSP : `img-src https:` déjà autorisé, rien à changer.
- Épingles numérotées couleur du jour (Nouveau) / grises (Déjà planifié), icône maison = base, trajet en lignes droites (aucune géométrie OSRM dans le plan : le moteur ne renvoie que durée/distance). Les autres jours restent en trait très léger. Pas de cercle de rayon (n'aidait pas ; rayon en « Détails de la zone »).
- Sélecteur de jour (puces « Mar. 27 Oct. », « Tous les jours »), clic sur un arrêt de la liste <-> épingle agrandie, clic sur épingle <-> ligne surlignée. Légende : Nouveau / Déjà planifié / Base. Liste texte conservée (alternative accessible) + aria-label de la carte.
- Liste : une ligne par arrêt (heure 16 px gras, client, ville, badge Nouveau / Déjà planifié), connecteur « 🚗 12 min », texte principal >= 14-16 px, secondaire 12-14 px, `text-foreground/75+` pour le contraste. Phrase de synthèse par commercial (« Pauline Roche : 7 nouveaux RDV sur 4 jours, 63 km au total. ») et par jour (« 3 RDV sur 4 possibles · 42 min de route · fini à 12 h 55 »).
- « Détails » repliés : km, estimation circulation, horaires fins ; liens Google Maps / Waze en boutons-icônes dans l'en-tête du jour ; zone (rayon, norme, confort, max) repliée. Bannière routage/« Attention » = une ligne + « Détails ».
- Non attribués : phrase d'explication + raison + conseil par code.
- Code : `proposal.tsx` (nouveau, contient Proposal/RepCard/DayList/RoutingBanner), `dispatch-panel.tsx` allégé.
- e2e : `gauge` attend désormais `/\d RDV sur 4/` (avant `\d/4`), seul changement de spec. `leg`, `open-route`, `load-note`, `traffic-warning`, `routing-banner`, `stop` conservés.

## /leads « N 1 Issue »
- Rechargement frais de /leads (Playwright, compte admin) : 0 message console error/warning, 0 erreur de page, overlay sans issue. Non reproductible ; probablement transitoire (HMR/rechargement) : aucun correctif appliqué.

## Captures (scratchpad)
g-1280-dark-card.png, g-390-dark-card.png, g-*-dark-proposal.png (page entière). Débordement horizontal : 0 px aux deux largeurs.

## Reste
- Thème clair non capturé (next-themes écrase la classe en script) ; CSS prévu pour `.light`.
- Tuiles OSM publiques : prévoir un fournisseur en production.
- Vérifs finales : typecheck OK, lint 0 avertissement, vitest unit 344/344, e2e dispatch 7/7 (port 3200, NEXT_DIST_DIR=.next-g, config temporaire supprimée).
