# K-fixes : correctifs des constats I (Chrome) et J (multi-rôles)

Instance de vérification : port 3103 (`.next-k`, supprimée ensuite). Migrations : `20260121000000_rebalance_reason.sql`, `20260121000001_lead_rdv_pris.sql` (appliquées sur la base locale 56322).

| # | Constat | État | Comment |
|---|---|---|---|
| 1 | « Répartir automatiquement » sans retour visible | corrigé | `proposal.tsx` : à l'affichage (et à chaque nouveau calcul, clé `planHash`) défilement doux vers le titre (`auto` si `prefers-reduced-motion`) et focus sur le `<h2>` (`tabIndex=-1`, `scroll-mt-20`). |
| 2 | Erreurs de validation obsolètes | corrigé | Champs : erreurs par champ effacées à la saisie / au changement de type / à la nouvelle tentative ; Rôles : erreur effacée à la saisie, au cochage, à la fermeture, au renvoi ; Statuts > Actions : effacée à toute modification et au renvoi. |
| 3 | Renommage d'une source | corrigé | `autoFocus` + `select()` au focus. |
| 4 | Notifications non cliquables | corrigé | `src/lib/notification-href.ts` (lead -> `/leads/{id}`, messages « à attribuer / relancez la répartition » -> `/agenda/repartition`, répartition auto / rééquilibrage -> `/agenda`, `href` interne explicite accepté). Chaque notification devient un `menuitem` lien ; clic = lue (`markNotificationReadAction`, 1 notification). L'ouverture du menu ne marque plus tout comme lu ; bouton « Tout marquer comme lu ». |
| 5 | Facturation ne se rafraîchit pas | corrigé | `usePollRefresh` (5 s, 60 s max) après retour de Checkout, retour du portail (repère `sessionStorage` posé avant la redirection) et changement de plan ; arrêt dès que l'empreinte d'état (état, plan, abonnement, annulation, échéance, sièges) change. |
| 6 | Liste Répartition à recharger | corrigé | `usePollRefresh({ everyMs: 30000 })` dans `DispatchPanel` (onglet visible seulement, rafraîchit au retour). Pas de Realtime. |
| 7 | Bannière « Position corrigée » trompeuse | corrigé | Nouvelle colonne `appointments.rebalance_reason` (`NULL` = position, `'unavailability'`), posée par le déclencheur d'indisponibilité, remise à `NULL` quand `needs_rebalance` retombe. Libellé : `src/lib/dispatch/rebalance-message.ts` (position / indisponibilité / les deux). |
| 8 | Lead reste « Nouveau » | corrigé (version sûre) | Déclencheur `appointments_advance_lead` + `advance_lead_on_appointment`. Voir ci-dessous. |
| 9 | Rééquilibrage invisible dans « Ma tournée » | corrigé | Fenêtre 3 j -> 7 j (`TOUR_DAYS`), limite 30 -> 40 RDV. |

## Item 8 : règles retenues
- Déclenché à l'insertion / au changement de `status` ou `dispatch_status` d'un RDV réel (pas simulation, pas annulé), quand il est `confirmed` ou qu'il passe de `unassigned` à `assigned` (attribution par la répartition). Un RDV manuel simplement `planned` ne déclenche rien.
- Le statut « RDV pris » (comparaison sans casse, statut normal) doit exister dans l'organisation ; le lead doit être dans un statut normal de position inférieure (jamais Devis envoyé / Signé / Perdu, jamais de recul).
- Règles de transition : un chemin doit exister dans `status_transitions` (tous rôles confondus) du statut actuel vers « RDV pris » ; sinon rien ne bouge. Le passage est systémique : il contourne le contrôle de transition PAR RÔLE (`app.skip_transition`), pas les autres conditions. Choix assumé : sans cela un confirmateur ne pourrait jamais passer Nouveau -> RDV pris (pas de transition directe dans le modèle).
- Historique : événement `status_changed` habituel (déclencheur `leads_after`) + événement `appointment` `{ action: lead_status_auto }`.
- Échec silencieux (organisation en lecture seule, etc.) : jamais bloquant pour l'enregistrement du RDV.
- Non fait : les actions de statut (attribution, notification, tâche, webhook) sont exécutées par l'application lors d'un changement manuel, pas par ce déclencheur : « Préparer la visite technique » (tâche du modèle Énergies) n'est donc pas créée automatiquement. Pas de rattrapage des leads existants.

## Tests
- `tests/unit/k-fixes.test.ts` (libellé de bannière, cible des notifications).
- `tests/rls/k-fixes.test.ts` (8 : avancement du lead dans 7 cas, rebalance_reason).
- `tests/e2e/k-fixes.spec.ts` (focus proposition, bannière selon la cause, liste rafraîchie seule, tournée à +5 j, cloche, erreurs effacées, focus du renommage, sondage facturation).

## Points d'attention
- Le test e2e « télépro » de `dispatch.spec.ts` confirme un RDV sur un lead du jeu de démo : le lead passe maintenant à « RDV pris » et n'est pas restauré au nettoyage.
