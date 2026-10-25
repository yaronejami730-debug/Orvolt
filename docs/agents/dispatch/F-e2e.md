# F-e2e : remise au vert des tests Playwright (rapport vivant)

Config temporaire : playwright.e2e-tmp.config.ts (port 3100, build + start, NEXT_DIST_DIR=.next-e2e), à supprimer en fin de travail. Le serveur :3000 de l'utilisateur n'est pas touché.

## Journal
- Étape 0 : premier essai en `next dev` : 22 échecs dont /onboarding en erreur (JSON.parse) = artefact du mode dev, passage à build + start.
- Étape 1 (build+start OK, 15 tests agenda/auth/billing/landing : 11 verts, 4 rouges) :
  - Bug app réel corrigé : src/styles/marketing.css, `prefers-reduced-motion` masquait (display:none) le h1 et toute la hero ; remplacé par `animation: none` (curseur/toast décoratifs seuls masqués).
  - Tests alignés sur le comportement voulu : landing (modèle énergie seul, démarrage 9,90 €), nouveau test tarifs (bascule Annuel, compare-toggle/compare-table), création de lead (champs obligatoires du modèle Énergies via tests/e2e/helpers.ts) dans agenda/billing/dashboard.
- Étape 2 (agenda, billing, dashboard, import, landing, leads, super-admin, workflow : 17 verts / 20, 3 rouges) :
  - landing : 13 `article` (7 fonctionnalités + 3 démos + 3 plans) ; super-admin : « Signé » n'est posé que par le Commercial dans le modèle Énergies (le Prospecteur ne l'a pas) ; test aligné.
  - import : blocage lié à l'environnement, pas à l'app : l'URL de webhook affichée vient de NEXT_PUBLIC_APP_URL (=:3000 dans .env.local) donc le test appelait le serveur de l'utilisateur. La config temporaire force NEXT_PUBLIC_APP_URL=http://localhost:3100.
- Étape 3 (import + dispatch : 9/9 verts) :
  - import : les 3 champs obligatoires du modèle Énergies absents du CSV exigent une valeur par défaut (panneau `required-defaults`) ; `startImport` les remplit.
  - dispatch.spec.ts réécrit pour le nouveau comportement : vue réelle vide + note, simulation dans `?vue=simulation`, validation sans notification et sans changement de propriétaire (compte de notifications constant, leads.assigned_to nul), relance refusée (« Une simulation est déjà en cours »), isolation (vue réelle, /leads, /agenda, tournée du commercial), suppression par drapeau avec message « dont 10 RDV simulé(s) déjà attribué(s) », tournée / signalement / rééquilibrage sur un VRAI RDV (notifié), 6e RDV sur de vrais leads (jours ouvrés hors fériés), nouveau test télépro « RDV à attribuer » (statut planned, sans commercial ni heure, fenêtre Du/Au) puis confirmation par le confirmateur.
  - Bug app corrigé : AppointmentDialog, cocher « RDV à attribuer » laissait « Du » = aujourd'hui (invalide, refusé par le serveur) ; la fenêtre avance maintenant à demain.
  - Incident de test : une tentative a modifié un RDV de démo (position/needs_rebalance) ; base de démo re-semée (npm run db:seed) puis test ciblé sur son propre RDV.
- Correction : super-admin.spec.ts remis à l'original (Prospecteur/Signé coché dans la démo re-semée) ; l'état décoché trouvé au départ venait d'un ancien run interrompu, pas d'un changement voulu.

## Final
- Suite complète (config temporaire, port 3100) : 31 passés / 0 échec. typecheck OK, lint OK (0 erreur). Config temporaire et .next-e2e supprimés. Serveur :3000 (pid 6601) intact.
- Fichiers app modifiés : src/styles/marketing.css, src/components/agenda/appointment-dialog.tsx.
