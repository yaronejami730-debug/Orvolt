# DISPATCH_STATUS — suivi vivant de la répartition (reprise après coupure)

Règle : chaque agent met à jour SON fichier dans docs/agents/dispatch/ à chaque étape (début, après chaque changement, après chaque commande de vérification, en cas de blocage). Format : horodatage, fait, en cours, prochaine étape, fichiers touchés, sorties de commandes réelles. Ce fichier-ci est l'index : l'orchestrateur le met à jour.

## Agents
| Agent | Périmètre | Fichier de suivi | État |
|---|---|---|---|
| A-moteur | engine.ts : remplir les journées à 4 avant d'en ouvrir une autre ; tests unitaires | dispatch/A-moteur.md | TERMINÉ : OPEN_DAY_PENALTY 25->60, pénalité de charge relative ; 10 RDV = 4+4+2 ; 329 tests unit OK |
| B-ui | page répartition : débordement 16 px à 390 px, écart 7/10 RDV affiché, états vides | dispatch/B-ui.md | TERMINÉ : dispatch-panel.tsx affiche « 7 à répartir · 3 à vérifier » ; le « 406 px » était le Toaster Sonner (fixed), pas la liste d'arrêts ; e2e non relancés |
| C-audit | audit lecture seule : server.ts, actions, migrations, RLS vs brief ; rapport des manques | dispatch/C-audit.md | TERMINÉ : 2 HAUT, 7 MOYEN, plusieurs BAS (détail dans C-audit.md) ; RLS/e2e non lancés |
| D-animations | landing « Voyez-le travailler » : vraie carte SVG pour le moteur, animation CSV | dispatch/D-animations.md | TERMINÉ : vraie carte OSM Lyon + OSRM figé, import CSV 4 étapes ; typecheck/lint OK |

## Point de départ (2026-10-25)
- Fait : moteur, migrations 20260116/17/18, actions, page, simulation, seed ; Vitest 757/757, e2e 29/29, build OK (rapport de l'ancienne session, non relancé par l'orchestrateur).
- Manques connus : journées sous la norme de 4 (2-3 RDV/jour en simulation) ; liste d'arrêts +16 px à 390 px ; 7 RDV listés vs 10 simulés ; rien commité.

## Landing (orchestrateur, hors agents)
- Ajout section « Voyez-le travailler » : src/components/marketing/feature-demos.tsx (agenda, import CSV, moteur), keyframes mk-d-* dans src/styles/marketing.css, branchée dans src/app/(marketing)/page.tsx. Typecheck/lint OK, pas de débordement à 390 px. Reste : animations dans l'app connectée (non fait).

## À faire (décision utilisateur attendue)
1. HAUT : flux réel télépro->RDV « à attribuer » non branché (seule la simulation en crée).
2. HAUT : simulation écrit dans l'org réelle, Valider notifie les vrais commerciaux ; ajouter is_simulation.
3. MOYEN : confirmPendingAction sans filtre status=planned ; lat/lng client non revalidés ; p_allow_estimate appelable en direct ; rejeu base incomplet ; jours fériés ; ancien commercial non notifié au rééquilibrage.
4. Relancer db:reset, Vitest complet, e2e après ces correctifs (A et B n'ont lancé que unit/typecheck/lint).

## Tarifs (orchestrateur, 2026-10-25, demande utilisateur)
- Starter 9,90 €/mois (3 utilisateurs), Pro 79 € (10), Business 199 € (illimité : seat_limit null).
- Fichiers : src/lib/billing/plans.ts (seats number|null, formatPrice 9,90 €), events.ts, process.ts, pricing-section.tsx, pricing/page.tsx, scripts/stripe-setup.mjs (crée un nouveau prix Stripe si le montant change), tests/unit/billing.test.ts, tests/e2e/billing.spec.ts, FINAL.md.
- Vérifié : typecheck OK, lint OK, Vitest unit 329/329, /pricing sert « 9,90 € » et « Utilisateurs illimités ». NON lancé : tests d'intégration billing, e2e billing (Supabase/stripe-mock requis).
- À faire côté Stripe réel : relancer `node scripts/stripe-setup.mjs` avec une vraie clé test (aucune clé valide disponible) ; les abonnés existants au prix 29 € gardent l'ancien prix Stripe.

## D-animations : consigne mise à jour
- Vraie carte OpenStreetMap de Lyon (données Overpass figées, itinéraires OSRM réels si dispo), pas de carte dessinée à la main. Voir dispatch/D-animations.md.

## Facturation annuelle + modèle énergie + comparateur (orchestrateur, 2026-10-25)
- Annuel = 10 mensualités (2 mois offerts) : Starter 99 €, Pro 790 €, Business 1 990 €. Bascule Mensuel/Annuel sur /pricing, dans le comparateur et dans Réglages > Facturation. Fichiers : lib/billing/{plans,checkout,events}.ts, settings/billing/actions.ts, marketing/{pricing-plans,pricing-section,plan-compare}.tsx, components/billing/billing-panel.tsx, scripts/stripe-setup.mjs (2 prix par plan, env STRIPE_PRICE_<PLAN>_YEARLY), tests/unit/billing.test.ts.
- Comparateur : bouton « Comparer les plans », 13 lignes (toutes les features de plans.ts + features landing non limitées par plan).
- Modèle énergie seul à l'inscription (ENABLED_TEMPLATE_IDS dans lib/templates/index.ts) ; les 4 autres modèles restent dans le code, réactivables. Landing/FAQ réécrites énergie.
- Vérifié : Vitest unit OK (billing 19/19), lint 0 erreur, captures /pricing desktop + 390 px (0 px de débordement, annuel 99/790/1 990 €).
- NON vérifié : e2e, tests d'intégration billing, création des prix annuels chez Stripe (pas de clé valide). typecheck : 1 erreur dans engine-map.tsx (agent D, en cours).

## D-animations : TERMINÉ (2026-10-25)
- Vraie carte OSM de Lyon (lyon-map-data.ts 119 Ko, généré par scripts/gen-lyon-map.mjs), itinéraires OSRM réels figés, import CSV en 4 étapes. typecheck + lint OK (relancés par l'orchestrateur). Défauts connus : étiquettes de trajets qui se chevauchent un peu à 390 px ; ordre d'attribution fictif (démo) ; e2e non lancés. Ajustement orchestrateur : état « terminé » du moteur borné à ENGINE_LEN.
