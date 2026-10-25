# DEV REPORT — Répartition automatique (routage et trafic)

## Choix du moteur de routage (relevé GitHub du 2026-10-25)
| Projet | Étoiles | Dernier commit | Licence |
|---|---|---|---|
| Project-OSRM/osrm-backend | 8 170 | 2026-10-24 (v26.10.0) | BSD-2 |
| graphhopper/graphhopper | 6 742 | 2026-10-25 | Apache-2.0 |
| valhalla/valhalla | 6 365 | 2026-10-19 | MIT (NOASSERTION côté API) |
| GIScience/openrouteservice | 1 987 | 2026-10-25 | GPL-3.0 |
| VROOM-Project/vroom | 1 900 | 2026-10-08 | BSD-2 |
| google/or-tools | 14 263 | 2026-10-23 | Apache-2.0 |

1. OSRM retenu : matrice N×N (`/table`, durées + distances) en une requête, `/nearest` pour recaler un point sur la route, image Docker officielle `ghcr.io/project-osrm/osrm-backend`, très actif, BSD.
2. Auto-hébergement léger : extrait Geofabrik Rhône-Alpes (507 Mo) découpé autour de Lyon–Grenoble (331 Mo) puis préparé en MLD : 622 Mo sur disque, pic 0,5 Go de RAM pour la préparation, service ~1 Go.
3. Valhalla/GraphHopper/ORS : bons mais plus lourds à opérer pour le même besoin (GraphHopper : licence correcte, import plus long ; ORS : GPL-3 et pile Java volumineuse).
4. VROOM / OR-Tools : utiles au-delà de ~30 arrêts par tournée ; ici ≤ 4-10 RDV par commercial et par jour, donc insertion gloutonne + ordre optimal par permutations exactes (≤ 7 arrêts) calculés sur la matrice routière. VROOM n'est PAS intégré (écart assumé avec la préférence initiale) ; il se brancherait derrière `RoutingProvider` sans changer le moteur.
5. Aucun service payant requis : OSRM local, repli étiqueté « estimation » (vol d'oiseau × 1,4, aperçu seulement) et fournisseur `fake` déterministe pour les tests.

Validé réellement : `npm run routing:status` -> Lyon -> Grenoble : 80 min, 106,1 km (routier, sans trafic).

## Trafic (couche séparée, jamais obligatoire)
- Niveau 1 (défaut) : coefficient horaire en semaine (7h30-9h30 ×1,25 ; 16h30-19h30 ×1,4 ; trajets > 15 min) puis +10 % de sécurité, réglables par organisation ; étiqueté « estimation selon l'heure ».
- Niveau 2 (optionnel) : `TRAFFIC_PROVIDER=tomtom|mapbox` + `TRAFFIC_API_KEY`, serveur uniquement, appelé pour les seuls trajets des tournées proposées, cache mémoire 15 min, quota local 120 appels/min, délai 4 s, repli silencieux sur le niveau 1. La durée externe ne peut qu'allonger la durée planifiée (max avec l'estimation), de sorte que la validation en base reste cohérente.
- Conditions d'usage (pages officielles consultées le 2026-10-25, lecture partielle) : Mapbox `driving-traffic` : prévision fondée sur l'historique, `depart_at`, 300 requêtes/minute, quota gratuit indiqué sur la page tarifs (non recopié ici) ; TomTom : « free monthly requests per API, no credit card needed » (le chiffre exact de 2 500/jour n'a PAS pu être confirmé sur la page). Je n'ai pas pu lire les clauses de conservation des résultats : par prudence rien n'est stocké durablement (cache mémoire 15 min seulement) ; à vérifier avec les CGU avant production.
- Aucun jeu de données trafic temps réel gratuit et ouvert n'existe sur GitHub : OSRM/Valhalla/GraphHopper savent consommer du trafic, mais il faut une source de données.

## Règle de charge : norme passée à 4 (2026-10-25)
- Constat : défauts 3/4/5 (norme/confort/maximum) alors que le brief demandait ~4 RDV par commercial et par jour.
- Décision : défauts 4/5/6 : norme 4 ; 5e RDV seulement si le détour est faible (≤ `max_extra_minutes`, 20 min) et si personne de moins chargé ne peut le prendre ; 6e jamais automatique (case décochée, décision verrouillée). La logique à trois paliers est inchangée, seuls les défauts bougent.
- Mise en œuvre : migration `20260118000000_dispatch_norm4.sql` (nouveaux `default` sur `dispatch_settings`, `apply_dispatch` recréée avec les mêmes replis 5/6 ; les anciennes migrations ne sont pas modifiées), `DEFAULT_ORG` / `DEFAULT_WORK` côté application, page Réglages > Membres alignée sur `DEFAULT_ORG`, libellés sans ordinal codé (« Confort (+1 si détour faible) », « Maximum (au-delà : manuel) », badge « Ne RDV : journée chargée » calculé).
- Les organisations qui ont enregistré leurs propres seuils (ligne `dispatch_settings`) les conservent ; les zones des commerciaux (surcharges) restent `null` dans le seed, donc Pauline Roche et Karim Benali héritent de 4/5/6.
- Tests : unitaires (défauts 4/5/6, 10 RDV = 4+4+2), e2e (jauge x/4, ≤ 5 par jour sans approbation, 6e approuvé à la main = 6).
