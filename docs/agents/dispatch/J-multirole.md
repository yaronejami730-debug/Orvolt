# J-multirole : six rôles connectés en même temps (rapport vivant)

Instance : `.next-j` sur :3102 (stripe-mock :12111), organisation Énergie Verte Démo. Test : `tests/e2e/multirole.spec.ts`
(un navigateur Chromium isolé par rôle, six sessions ouvertes simultanément ; `MULTIROLE_HEADED=1` = six fenêtres 660x800 côte à côte,
3 colonnes x 2 lignes ; sans la variable, tout tourne en headless). Données jetables « MULTIROLE-<horodatage> », supprimées en fin de test.

Lancement : `MULTIROLE_BASE=http://localhost:3102 MULTIROLE_HEADED=1 MULTIROLE_SHOTS=<dossier> npx playwright test tests/e2e/multirole.spec.ts --config=<config sans webServer>`
(la config du dépôt démarrerait un serveur sur :3000 : ne pas l'utiliser ici).

## Scénario

| Étape | Résultat |
|---|---|
| 0. six sessions simultanées (CEO, administrateur, prospecteur, confirmateur, Pauline, Karim) | OK |
| 1. prospecteur : nouveau lead + « RDV à attribuer » (Du/Au, 1 h) ; le confirmateur reçoit la notification | OK. Notification reçue SANS recharger (sondage de la cloche toutes les 30 s, ~29 s mesurées). La liste « À confirmer avant répartition » ne se met PAS à jour seule : rechargement nécessaire (pas de Realtime) |
| 2. confirmateur confirme -> « RDV confirmés à attribuer » chez CEO et administrateur | OK |
| 3. CEO : Répartir automatiquement + Valider -> commercial notifié, agenda + « Ma tournée » ; l'autre commercial ne voit rien | OK (RDV à Karim, adresse à Vénissieux) |
| 3bis. indisponibilité du commercial attribué -> Rééquilibrer -> ancien commercial prévenu, nouveau commercial reçoit le RDV | OK après correction (bug 1) |
| 4. commercial : À qualifier > Qualifié > RDV pris > Devis envoyé > Signé -> dashboard CEO et administrateur (valeur gagnée +12 345 €) ; prospecteur ne voit que ses leads (71/121) ; l'autre commercial : 404 par URL directe, rien dans l'agenda, Répartition refusée | OK |
| 5a. CEO change le statut pendant que le commercial ajoute une note | OK, aucune perte, événements journalisés |
| 5b. CEO et commercial changent le statut en même temps | OK, dernier écrit gagne, même statut final pour les deux après rechargement |
| 5c. deux administrateurs cliquent « Valider » sur la même proposition en même temps | OK après correction (bug 2) : un seul gagnant, RDV attribué une fois, une seule notification |
| 6. menus et accès directs par rôle | OK (tableau ci-dessous) |

## Bugs trouvés

1. **Corrigé** : « Retirer » un RDV attribué effaçait sa position GPS (le garde de `appointments` remet lat/lng à null quand `assigned_to` change hors contexte `lf.dispatch`) ; le RDV repassait dans « À vérifier : Pas de position GPS ». Correctif : `dispatcher_unassign` pose aussi `lf.dispatch` (migration `20260120000000_dispatch_unassign_unavail.sql`). Test : `tests/rls/dispatch-unassign-unavail.test.ts` + étape 5c du spec.
2. **Corrigé** : ajouter une indisponibilité pour un commercial qui a déjà un RDV réparti ce jour-là ne déclenchait rien (aucun « Rééquilibrer » proposé). Un déclencheur signale maintenant ces RDV (`needs_rebalance`, hors RDV verrouillés, jour entier ou créneau chevauchant). Test : idem + étape 3bis.
3. **Corrigé** : deux « Valider » vraiment simultanés (les deux passent le contrôle `planHash` avant l'écriture) donnaient deux succès, dont un « 0 RDV attribué(s) » trompeur. `applyDispatchAction` renvoie désormais, quand rien n'est écrit parce que tout est déjà en place, `code: "stale"` avec un message clair. Test : étape 5c (le perdant affiche l'erreur, jamais deux succès).

## Constats non corrigés (hors périmètre ou fichiers d'autres agents)

- Mise à jour « en direct » partielle : seule la cloche sonde (30 s) ; les pages (Répartition, agenda) exigent un rechargement.
- `src/components/dispatch/dispatch-panel.tsx` (modifié par un autre agent) : la bannière « Position corrigée sur N RDV : relancer la répartition » s'affiche aussi quand la cause est une indisponibilité (libellé trompeur).
- Le lead reste « Nouveau » après confirmation et attribution du RDV : aucun passage automatique à « RDV pris » ; le commercial doit parcourir À qualifier > Qualifié > RDV pris (transitions par rôle). « Signé » et « Perdu » sont définitifs (même pour un super administrateur).
- Le rééquilibrage peut placer le RDV jusqu'à 4 jours après le jour d'origine (fenêtre de 5 jours) ; « Ma tournée » ne couvre qu'aujourd'hui + 2 jours (le RDV est alors visible dans l'agenda mais pas dans la tournée).
- Le « Dashboard » est dans le menu des rôles sans `dashboard.view` (page d'accueil simplifiée avec liens, pas de statistiques) : voulu.

## Menus visibles par rôle (barre de navigation)

| Rôle | Menu | /agenda/repartition | /import | /settings | /settings/billing |
|---|---|---|---|---|---|
| Super administrateur (CEO) | Dashboard, Leads, Agenda, Répartition, Tâches, Import, Paramètres | oui | oui | oui | oui |
| Administrateur | idem | oui | oui | oui | refusé |
| Prospecteur | Dashboard, Leads, Agenda, Tâches, Import | refusé | oui | refusé | refusé |
| Confirmateur | Dashboard, Leads, Agenda, Répartition, Tâches | oui | refusé | refusé | refusé |
| Commercial (Pauline) | Dashboard, Leads, Agenda, Tâches | refusé | refusé | refusé | refusé |
| Commercial 2 (Karim) | Dashboard, Leads, Agenda, Tâches | refusé | refusé | refusé | refusé |

Le message du perdant d'un changement de statut simultané est clair : « « Perdu » est un statut final : un lead ne peut plus en sortir. »

## Résultats finaux

- `tests/e2e/multirole.spec.ts` : 1 test, vert en headed (six fenêtres) et en headless (~1,9 min).
- `tests/rls/dispatch-unassign-unavail.test.ts` (3 tests) + `dispatch.test.ts` + `dispatch-fixes.test.ts` : 48 verts.
- `npm run typecheck` et `npm run lint` : propres.
- Données jetables supprimées (leads MULTIROLE-*, indisponibilités, notifications). `.next-j` et la config temporaire supprimés.
