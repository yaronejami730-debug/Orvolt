# VERDICT FINAL (re-check S7 + non-régression) : OK

Aucun bug bloquant ni moyen restant. Le produit est conforme au MVP (10 fonctionnalités recettées). Réserves avant mise en production : voir « À faire avant production » ci-dessous.

## Commandes
- typecheck : OK
- lint : OK
- build : OK
- `npm run test:e2e` complet : 21/21 (stripe-mock Docker automatique). Aucun flaky.
- Pas de `db reset` lancé.

## Corrections vérifiées (build prod, stripe-mock, webhooks signés)
- Lecture seule complète : dans une organisation annulée (webhook `customer.subscription.deleted`) ou à essai expiré, ces actions sont refusées avec le message « Abonnement inactif : lecture seule. Rendez-vous dans Paramètres > Facturation. » : création de statut, de champ, de source, de rôle et de membre, création de lead, déplacement de lead (Kanban), note, appel, dépôt de fichier, RDV, édition inline d'une fiche. Les compteurs en base sont inchangés après toutes ces tentatives (statuts 4, champs 2, sources 8, rôles 4, membres 3, leads 1, notes 0, appels 0, RDV 0, fichiers 0).
- Bandeau global « Abonnement inactif : lecture seule. Votre abonnement n'est plus actif. » (ou « Votre essai est terminé. ») avec le lien « Réactiver l'abonnement » qui mène à /settings/billing.
- Désactivation d'un membre : toujours possible (« Membre désactivé. »). La réactivation d'un membre est refusée en lecture seule, ce qui est cohérent.
- Réabonnement : bouton « Réactiver » sur le plan Pro, Checkout simulé, webhook `customer.subscription.created`, puis état « Actif », bandeau retiré, création de statut et de lead de nouveau possible.
- Textes cohérents : plus aucun « sans carte bancaire ». « Essai gratuit 14 jours · annulation en un clic » apparaît sur la landing, /pricing et /signup. Les mentions « carte bancaire » restantes concernent uniquement le moyen de paiement (« Paiement sécurisé par carte bancaire ou Apple Pay, via Stripe », CGV).
- og:image : `og:image` et `twitter:image` présents sur la landing et /pricing, l'image répond 200 `image/png`.
- Burger mobile : ouverture à la touche Entrée (focus dans le menu), Échap ferme le menu (`aria-expanded` repasse à false) et rend le focus au bouton « Ouvrir le menu ».
- Kanban mobile 390 px : bouton « Déplacer vers… » 40×40 et poignée de drag 40×40 (capture vue, pas d'overflow).

## Non-régression avec les comptes démo
- Kanban DnD souris réel : OK, persistant (lead remis ensuite dans son statut d'origine).
- Agenda semaine : 8 évènements.
- Dashboard 30 jours : 28 leads, 62,5 %, 27 RDV, 296 600 € (identique à la recette précédente).
- Import CSV : 1 créé et 1 en erreur (e-mail invalide), valeur par défaut des champs obligatoires. Lead de test supprimé.

## À faire avant production (non bloquant pour la recette)
- Compléter les pages légales (/mentions-legales, /confidentialite, /cgv), qui contiennent encore des champs entre crochets ([raison sociale], [HT/TTC], etc.).
- Définir NEXT_PUBLIC_APP_URL : en local, og:url, sitemap et robots pointent vers http://localhost:3000.
- Tester le vrai Checkout et le vrai webhook avec une clé `sk_test_` (aucune clé valide dans `.env.local`, seul stripe-mock a été utilisé). Apple Pay exige HTTPS.
- Pas de bascule mensuel/annuel sur /pricing (prévue dans DESIGN.md S7) : décision produit.
- Planifier GET /api/cron/maintenance et passer le rate limit sur Redis (multi-instance), comme indiqué dans les DEV_REPORT.

## Observations mineures restantes
- Le toast d'échec de déplacement en lecture seule propose un bouton « Réessayer » sans intérêt.
- Mobile 390 px : quelques cibles restent sous 40 px (points de navigation entre colonnes 10×10, bouton « + » de colonne 28×28, bouton utilisateur 36×36). La navigation par points est un indicateur secondaire.
- Après une écriture directe en base, le bandeau d'état de facturation peut rester périmé quelques secondes.

## Données de test
- Supprimées : organisation « QA9 … », comptes `@qa1.test`, lead `@qa-recette.test`, import_job de recette, fichiers du bucket `imports`. Seed intact (120 leads, Arthur Girard en « Nouveau »). Serveurs Next et stripe-mock arrêtés. Supabase laissé démarré. Le projet Docker express-pb-e2e n'a pas été touché.

---
(Recette S7 initiale et rapports précédents ci-dessous.)

# QA1 — Sprint S7 + recette de fin de projet

## Verdict : fonctionnel complet, aucun bloc bloquant ; 1 bug moyen, 6 défauts mineurs ; points à traiter avant mise en production

## Commandes
- typecheck : OK
- lint : OK
- vitest complet : 616 OK + 1 échec attendu (xfail documenté), 35 fichiers
- build : OK
- `npm run test:e2e` (config officielle, stripe-mock Docker automatique) : 20/20 sur chacune des 2 exécutions complètes. Aucun flaky observé cette fois (le `workflow.spec.ts` instable des sprints précédents a passé).

## Démarrage et seed
- `supabase stop` puis `npm run dev:all` : Supabase redémarré par le script, `.env.local` régénéré avec conservation de CRON_SECRET, INBOUND_SECRET_KEY et du sel, Next prêt en environ 1 s. Message « Stripe non configuré, listener ignoré. », sans plantage.
- Sans clé Stripe côté application, /settings/billing affiche « La facturation n'est pas configurée sur ce serveur (clé Stripe manquante). » et le bouton « Souscrire » est désactivé (aucune erreur).
- `npm run db:seed` : 2 organisations, 5 comptes, 200 leads, 111 RDV dont 8 hors rayon, 40 tâches, 28 notifications. Les 5 comptes du README se connectent (mot de passe `Demo1234!`).

## Recette des 10 fonctionnalités
1. Auth et multi-tenant : OK. admin.energies voit 120 leads, admin.artisan 80, et un lead de l'autre organisation renvoie 404 dans les deux sens. Le compte commercial, rattaché à deux organisations, a un sélecteur d'organisation et voit des listes différentes selon l'organisation (89 puis 38 leads).
2. Rôles : OK. /settings/roles est réservé aux deux Admin ; Prospecteur, Confirmateur et Commercial voient « Accès refusé ».
3. Statuts, transitions et actions auto : OK. Les 7 statuts du template (dont finals) sont présents, déplacement par drag et historique « Statut : Nouveau → À qualifier ». Les actions auto ont été validées en détail aux sprints précédents.
4. Champs personnalisés : OK. 6 champs du template Énergies, visibles sur la fiche, création et validations déjà testées.
5. Kanban DnD souris réel, tableau et fiche : OK (drag persistant après rechargement, fiche avec historique).
6. RDV et distance : OK. Agenda semaine, liste et mois, 8 évènements en semaine, 11 en liste dont 1 icône hors zone.
7. Import CSV et webhook entrant : OK. Import de 2 leads sur 3 (1 e-mail invalide), valeur par défaut des champs obligatoires, webhook créé via l'UI : curl avec secret donne 200 « created », sans secret 401. Leads de test supprimés.
8. Dashboard KPI : OK. 28 leads sur 30 jours (62,5 %, 27 RDV, 296 600 €) et 120 sur 90 jours.
9. Stripe (avec stripe-mock, aucune clé sk_test réelle dans .env.local, donc le vrai Checkout n'est pas testé) :
   - Organisation neuve : bandeau « Essai gratuit : 14 jours restants », 1 / 5 sièges.
   - Souscrire Pro : session Checkout créée, redirection vers checkout.stripe.com.
   - Webhook avec mauvaise signature : 400.
   - Webhooks signés (checkout.session.completed puis customer.subscription.updated) : « Actif », Plan Pro, 1 / 10 sièges, bandeau retiré, bouton « Gérer l'abonnement ».
   - Création d'un lead OK.
   - Portail : redirection vers l'URL de portail Stripe.
   - invoice.payment_failed : bandeau « Le paiement de votre abonnement a échoué… » (role alert), état « Paiement échoué ».
   - customer.subscription.deleted : /dashboard redirige vers la facturation, bandeau « lecture seule », état « Annulé », lecture conservée, création de lead refusée (« lecture seule », 0 en base).
   - Réabonnement : « Actif ».
   - Essai expiré : bandeau « Votre essai est terminé : l'organisation est en lecture seule. », écritures refusées.
   - Limite de sièges : « Limite de sièges atteinte. Passez à un plan supérieur. »
10. 5 templates à l'inscription : OK (Énergies 7 statuts et 6 champs, BTP 6 et 5, Immobilier 6 et 5, Automobile 6 et 5, Générique 4 et 2, 8 sources et 4 rôles à chaque fois, écran « Votre espace … est prêt »).

## Bugs
1. MOYEN — Une organisation en lecture seule (abonnement annulé ou essai terminé) peut encore écrire dans les paramètres.
   - Étapes : organisation dont l'abonnement est annulé (webhook customer.subscription.deleted) ou dont l'essai est expiré, connecté en Admin, /settings/statuses « Ajouter un statut », /settings/fields « Nouveau champ », /settings/members « Ajouter un membre ».
   - Attendu : refus avec « lecture seule », comme pour les leads.
   - Obtenu : « Statut créé. », « Champ créé. » et « Membre ajouté. » (3e puis 4e membre créés en base), alors que la création de lead est refusée. La limite de sièges reste appliquée.
   - Sévérité : moyenne (contournement du blocage de facturation, un compte non payant peut créer des comptes).
2. MINEUR — Messages contradictoires sur la carte bancaire : la landing, /pricing et le CTA final disent « sans carte bancaire », alors que /settings/billing indique « 14 jours d'essai, carte bancaire requise, résiliable à tout moment » sur le bouton « Souscrire ». À harmoniser.
3. MINEUR — Les meta Open Graph n'incluent pas `og:image` (alors que /opengraph-image répond 200 image/png). L'URL du site (og:url, sitemap, robots Host) vaut http://localhost:3000 : définir l'URL publique avant la production.
4. MINEUR — Les pages légales (/mentions-legales, /confidentialite, /cgv) contiennent encore des champs entre crochets à compléter : [raison sociale], [forme juridique], [montant], [HT/TTC], etc. À compléter impérativement avant un lancement public.
5. MINEUR — /pricing : pas de bascule mensuel/annuel (prévue dans DESIGN.md S7), facturation mensuelle uniquement. Le libellé « Paiement sécurisé par carte bancaire ou Apple Pay » n'est pas vérifiable en HTTP local.
6. MINEUR — Dashboard : quand la période précédente vaut 0 et la période courante est positive, le badge affiche « Période préc. : 0 vs période préc. » (redondant).
7. MINEUR — Mobile 390 px : sur le Kanban, plusieurs cibles tactiles font moins de 36 px (flèche « Déplacer vers… », poignée) alors que le DESIGN vise 40 px. Aucun overflow.

## Landing et pricing (captures vues, desktop 1440 et mobile 390, thèmes sombre et clair)
- Rendu premium, hiérarchie claire, contrastes corrects dans les deux thèmes, mockup Kanban animé, carte Pro mise en avant, aucun overflow horizontal sur 4 combinaisons.
- Le mockup Kanban mobile n'affiche que 3 colonnes (la 4e est masquée volontairement). Menu burger fonctionnel, mais il ne se ferme pas avec Échap.
- FAQ au clavier : 6 questions, Entrée et Espace ouvrent et ferment (`aria-expanded`), ouverture exclusive d'une question à la fois, anneau de focus visible sur tous les éléments focalisables, lien « Aller au contenu ».
- CTA : « Essai gratuit 14 jours » mène à /signup, « Connexion » à /login, « Voir comment ça marche » à l'ancre. Tous les liens du footer répondent 200.
- SEO : titre et description par page, `lang=fr`, JSON-LD sur la landing, 1 h1 par page, sitemap (7 URL) et robots (zones privées exclues).

## Mobile 390 px, pages de l'application
- Dashboard, Kanban, fiche lead, agenda, facturation, import, statuts, intégrations, membres : aucun overflow horizontal. Barre basse à 6 entrées, bouton flottant « + » sur le Kanban, bandeau d'essai.

## Non testé
- Vrai Checkout et vrai webhook Stripe avec clé sk_test_ (aucune clé valide dans .env.local) ; Apple Pay (HTTPS requis).
- Skeletons de chargement, géocodage réel BAN/Nominatim.
- Après une écriture directe en base, le bandeau d'état de facturation peut rester périmé quelques secondes (cache de session).

## Données de test
- Supprimées : organisations « QA8 … », comptes `@qa1.test`, leads `@qa-recette.test`, endpoint « QA recette », import_jobs de recette et fichiers du bucket `imports`. Lead « Arthur Girard » remis en « Nouveau » avec son historique. Les données du seed sont intactes (120 leads dans « Énergie Verte Démo »).
- Serveurs arrêtés (Next dev et start, stripe-mock). Supabase du projet laissé démarré. Le projet Docker express-pb-e2e n'a pas été touché.
- Captures : `/private/tmp/claude-501/-Users-yarone-SAAS-CRM/d034c5e7-96c4-4bc5-a65e-c92fc1c14358/scratchpad/shots`.

---
(Rapports précédents S6, S5, S4, S3, S2 et S1 ci-dessous.)

# Re-check S6 (boucle 1) : OK

- typecheck, lint, vitest (548/548) et build OK.
- e2e : 11/11 sur 2 des 3 exécutions complètes de cette session. Une exécution complète a échoué sur `workflow.spec.ts` (template Énergies), puis la suite a passé. Flaky intermittent du même spec que lors des sprints S3 et S4, non reproduit à chaque fois : à surveiller.
- Liens barres vers /leads : le nombre de lignes de /leads est désormais égal au nombre du dashboard.
  - Statuts Nouveau 8, En cours 4, Gagné 5, Perdu 3 : les liens portent `from` et `to`.
  - Sources Meta Ads 10, Google Ads 8, « Sans source » 2 (`sources=none`).
  - Combiné source Meta + utilisateur Rep1, barre Gagné : 3 leads ouverts, 3 affichés.
  - Période 7 jours, barre Nouveau : 2 leads pour 2 affichés.
  - Corrigé (bug moyen 1).
- Filtre source Meta : RDV = 3 (valeur attendue), leads 10, conversion 83,3 %. Corrigé (bug 2).
- Performance par utilisateur : ligne « Non assigné » (4 leads, 1 gagné, 5 000 €). La somme des leads (9 + 4 + 7 + 0) = 20 = total. Corrigé (bug 4).
- Période personnalisée de plus de 366 jours : message rouge « La période ne peut pas dépasser 366 jours. » dans le sélecteur, sans erreurs de blocs (capture vue). Corrigé (bug 3). 366 jours ou moins : OK.
- Badges de variation mobile 390 px : « +80 % » sur une seule ligne, libellé « vs période préc. » masqué en mobile (capture vue). Pas d'overflow. Corrigé.
- Leads archivés (2 leads « Nouveau » archivés) : exclus des indicateurs (créés 20 vers 18, barre Nouveau 8 vers 6, RDV 4 vers 2) et de /leads (6). Remarque : une modification directe en base n'est visible qu'après expiration du cache serveur de 15 s (le cache n'est vidé que par les écritures de l'application).
- Commercial avec rôle view_own et dashboard.view (« Analyste ») : toujours restreint (7 leads après archivage, 83,3 %, pas de tableau par utilisateur ni de filtre utilisateur). Sa barre « Gagné » ouvre 3 leads, identique. Sans dashboard.view : accès rapides.
- Observations restantes : le badge de variation affiche encore « Nouveau » quand la période précédente vaut 0 (vérifié en S6 initial, non revu).
- Données de test supprimées (organisation, rôle, comptes). Serveur arrêté.

---
(Rapport S6 initial ci-dessous.)

# QA1 — Sprint S6 (dashboard KPI)

## Verdict : chiffres exacts, 0 bug bloquant ; 1 bug moyen, 3 défauts mineurs

## Commandes
- typecheck : OK
- lint : OK
- vitest : 525/525 OK
- build : OK (/dashboard présent)
- e2e : 11/11 sur 2 exécutions complètes

## Jeu de données
- 32 leads sur 3 fenêtres (période courante, précédente, anciens leads clôturés dans la période), 5 sources dont « aucune », 3 assignations (Rep1, Rep2, aucune), dates de création et de clôture connues, 7 rendez-vous dont 2 annulés.
- J'ai calculé les attendus à part, avec les définitions du DEV_REPORT.

## Bugs
1. MOYEN — Les liens du dashboard vers /leads ne reprennent pas la période ni les filtres, donc les nombres affichés ne correspondent pas à ceux de la page de destination.
   - Étapes : dashboard 30 jours, cliquer sur la barre « Nouveau (8) », « Gagné (5) », « Perdu (3) » ou sur la source « Meta Ads (10) ».
   - Attendu : une liste d'autant de leads que le nombre cliqué (période, source et utilisateur conservés).
   - Obtenu : /leads?view=table&statuses=<id> affiche 13, 10 et 5 leads (tous âges confondus), et la source Meta 19. Le lien ne porte que le statut ou la source.
   - Sévérité : moyenne (cohérence fonctionnelle).
2. MINEUR — Le filtre source n'est pas appliqué aux rendez-vous.
   - Étapes : dashboard 30 jours, filtre source « Meta Ads ».
   - Attendu : RDV = 3 (RDV non annulés des leads Meta).
   - Obtenu : 4 (la valeur sans filtre). Les autres KPI sont filtrés correctement. Cause : `dash_appts` n'a pas de paramètre source.
3. MINEUR — Une période personnalisée de plus de 366 jours affiche « Impossible de charger les indicateurs » / « Impossible de charger ce bloc » avec « Réessayer ». Le message ne dit pas que la limite est de 366 jours (l'indication n'existe que dans l'état « choisissez une date »).
4. MINEUR — La performance par utilisateur omet les leads sans assigné : la somme du tableau (9 + 7 = 16) ne correspond pas aux 20 leads créés. Il n'y a pas de ligne « Non assigné ».

## Observations
- Le badge de variation affiche « Nouveau » quand la période précédente vaut 0 (vu pour le Commercial avec dashboard.view). Ce mot est identique au nom du statut « Nouveau ». À remplacer par « Nouveau » en italique ou « n/a ».
- Mobile 390 px : le badge « +100 % » passe à la ligne dans la carte (« +100 » puis « % »).
- Graphique d'évolution : l'axe Y n'affiche que la valeur maximale. La légende de « Gagnés » est grisée alors que la courbe est verte et pointillée.
- Les lignes du tableau de performance ne sont pas cliquables (pas de lien vers les leads de l'utilisateur).

## Chiffres vérifiés
- 30 jours, Admin : leads créés 20 (+100 % vs 10), conversion 70 % (7 gagnés sur 10 clôturés, +10 pt vs 60 %), RDV 4 (+300 % vs 1), valeur gagnée 21 000 € (+250 % vs 6 000 €).
- Barres par statut : 8 / 4 / 5 / 3 aux couleurs de l'org, plus pourcentages.
- Sources : Meta Ads 10, Google Ads 8, Sans source 2.
- Performance par utilisateur :
  - Rep1 : 9 leads, 5 gagnés, 1 perdu, 83,3 %, 12 000 €.
  - Rep2 : 7 leads, 1 gagné, 2 perdus, 33,3 %, 4 000 €.
  - Tous ces chiffres concordent avec mon calcul indépendant.
- 7 jours : 3 leads, 66,7 %, 2 RDV, 4 000 €. 90 jours : 32 leads, 66,7 %, 5 RDV, 27 000 €. Ce mois : 19 leads, 70 %, 4 RDV, 21 000 €. Tous exacts.
- Filtre source Meta : 10 leads, 83,3 % (5 sur 6), 12 000 €. Filtre utilisateur Rep1 : 9 leads, 83,3 %, 2 RDV, 12 000 €. Période personnalisée des 15 derniers jours : 12 leads, 62,5 %, 3 RDV, 12 000 €.
- Période inversée : message « Choisissez une date de début et une date de fin ». Jour unique : 0 lead, conversion « – ».
- Tableau de performance : tri par colonne avec `aria-sort`, ordre croissant et décroissant corrects.
- Droits :
  - Rôle personnalisé « Analyste » (dashboard.view + leads.view_own) : voit seulement ses chiffres (9 leads, 83,3 %), ni tableau de performance par utilisateur ni filtre utilisateur.
  - Sans dashboard.view : accès rapides (Mes leads, Mon agenda, Mes tâches).
- États : org neuve, message « Pas encore de leads sur la période » avec « Créer un lead » et « Importer un CSV » (capture vue). Erreur par bloc avec « Réessayer » vérifiée (voir bug 3). Chargement : non capturé (rendu trop rapide).
- Accessibilité : le graphique expose 30 points focalisables avec libellé (« 5 oct. : 0 créés, 1 gagnés »), le tableau alternatif « Voir sous forme de tableau » (details/summary) liste jour, créés, gagnés ; les barres sont des liens clavier.
- Thème clair et sombre : rendu propre (captures vues). Mobile 390 px : pas d'overflow, cartes 2×2, tableau de performance transformé en cartes.

## Données de test
- Supprimées : organisation « QA7 … » (leads, événements, RDV, rôle), comptes `@qa1.test`. Serveur arrêté.
- Captures : `/private/tmp/claude-501/-Users-yarone-SAAS-CRM/d034c5e7-96c4-4bc5-a65e-c92fc1c14358/scratchpad/shots` (préfixe `k-`).

---
(Rapports précédents S5, S4, S3, S2 et S1 ci-dessous.)

# Re-check S5 (boucle 1) : OK

- typecheck, lint, vitest (478/478), build et e2e (9/9) OK.
- /settings/integrations mobile 390 px : plus d'overflow (capture regardée). Corrigé. /import mobile (étape mappage avec valeurs par défaut) : pas d'overflow.
- « Envoyer un test » avec mappage personnalisé : lead créé (« Test envoyé : created »). Corrigé.
- Mappage invalide : message en français « Règle « a -> notafield » : champ « notafield » inconnu. Champs possibles : … ». Corrigé. Le toast « Webhook enregistré » n'apparaît plus avec cette erreur.
- Lien « Import » : masqué dans la navigation pour un Commercial (desktop et mobile), visible pour un Prospecteur. /import reste « Accès refusé » pour le Commercial.
- CSV sans champ personnalisé obligatoire : l'étape mappage affiche « Ces champs sont obligatoires et ne sont associés à aucune colonne : associez une colonne ci-dessus ou définissez une valeur appliquée à toutes les lignes ». Chaque champ obligatoire a une valeur par défaut. « Continuer » est désactivé tant qu'elles ne sont pas toutes renseignées. Simulation 2 à créer, import 2 créés, valeurs bien enregistrées en base. Corrigé.
- Endpoint neuf :
  - Secret affiché une seule fois, absent après rechargement ; le dialogue documente la clé HMAC (le secret).
  - En-tête secret : 200. HMAC avec clé = secret : 200.
  - Ancien schéma (clé = SHA-256 du secret) : 401. Corps altéré : 401. Horodatage périmé : 401. Mauvais secret ou aucun : 401.
  - 70 requêtes en rafale : 53 acceptées, 17 en 429. 30 jetons inconnus : 404. Désactivé : POST et GET renvoient 404.
- GET /api/cron/maintenance : sans secret ou avec un mauvais secret, 401 ; avec `Authorization: Bearer <CRON_SECRET>`, 200 `{ok:true, report:{…}}`.
  - Avec un build antérieur à la correction du middleware, la route redirigeait en 307 vers /login même avec le bon secret. Résolu après rebuild : `/api/cron/` est dans PUBLIC_PREFIX.
  - Le cas « CRON_SECRET absent donne 404 » n'a pas été testé (secret défini dans .env.local).
- Données de test supprimées (organisation, leads, endpoints, comptes `@qa1.test`, fichiers du bucket `imports`). Serveur arrêté.

---
(Rapport S5 initial ci-dessous.)

# QA1 — Sprint S5 (import CSV + webhooks entrants)

## Verdict : OK sur le fond, 0 bug bloquant ; 2 bugs mineurs à moyens, 3 défauts mineurs

## Commandes
- typecheck : OK
- lint : OK
- vitest : 429/429 OK
- build : OK (/import et /settings/integrations présents)
- e2e : 8/8 sur 2 exécutions complètes

## Bugs
1. Mobile 390 px, /settings/integrations : la page déborde horizontalement (environ 244 px de défilement horizontal de la page).
   - Étapes : connecté en Admin, viewport 390 px, ouvrir /settings/integrations avec au moins un webhook.
   - Attendu : pas d'overflow.
   - Obtenu : la page est plus large que l'écran, avec la barre d'onglets Réglages et les lignes du journal qui dépassent (captures vues). /import n'a pas d'overflow.
   - Sévérité : moyenne (UX mobile).
2. « Envoyer un test » sur un webhook générique avec mappage personnalisé est rejeté et ne crée aucun lead.
   - Étapes : créer un webhook JSON générique, saisir le mappage `contact.email -> email`, `contact.name -> fullName`, enregistrer, cliquer sur « Envoyer un test ».
   - Attendu : lead de test créé.
   - Obtenu : toast « Test envoyé : rejected », journal « Rejeté · Aucun nom ». La charge du test utilise les noms usuels, que le mappage personnalisé ignore. Sans mappage, le test crée bien le lead (« created »). Meta et Google : « created ».
   - Sévérité : mineure.

## Défauts mineurs
- Un mappage invalide (« a -> notafield ») affiche le message brut de Zod en anglais, avec la regex complète : « Invalid string: must match pattern /^(firstName|…/ ». Le toast précédent « Webhook enregistré » reste affiché.
- Le lien « Import » reste dans la navigation pour un Commercial sans `leads.import` (la page répond « Accès refusé »).
- L'import exige les champs personnalisés obligatoires du template (« Type de chauffage est obligatoire »). Un CSV qui ne les contient pas échoue entièrement (5000 lignes en erreur). Le webhook, lui, ne les exige pas. Comportement cohérent avec le DEV_REPORT mais à signaler au produit.

- Après mes essais (plusieurs simulations abandonnées, 3 imports réels, 1 import de 5000 lignes), 5 fichiers restaient dans le bucket `imports` de l'organisation. Probablement les simulations jamais suivies d'un import : le fichier n'est supprimé qu'à la fin d'un import. À couvrir par la purge planifiée (non planifiée à ce jour d'après le DEV_REPORT).

## Import CSV (build prod)
- Fichiers refusés avec message clair :
  - vide (« Le fichier est vide. ») ;
  - en-tête seul (« Le fichier ne contient que l'en-tête. ») ;
  - binaire ou extension .pdf (« Format non supporté : déposez un fichier .csv. ») ;
  - plus de 5 Mo (« Fichier trop volumineux (5 Mo maximum). ») ;
  - 5100 lignes (« Trop de lignes (5000 maximum, 5100 trouvées). »).
- UTF-8 avec BOM, séparateur virgule, guillemets doublés, retour à la ligne dans un champ, colonne inconnue : le mappage auto est correct (Prénom, Nom, E-mail, Téléphone, Ville), l'en-tête BOM est propre et l'aperçu est affiché. Le mappage manuel et les champs personnalisés fonctionnent. Le séparateur « ; » et Windows-1252 sont couverts par l'e2e.
- Simulation sans écriture : 6 à créer, 2 en erreur (« Nombre invalide. », « E-mail invalide. », « Valeur minimale : 0. »). En base 0 lead avant et après.
- Import réel : 6 créés. Source par défaut « Salon » appliquée.
- Répartition équitable par rôle (Prospecteur) : alternance Pro1/Pro2.
- Téléphone normalisé (+33…). Formule `=HYPERLINK(...)` neutralisée (`'=HYPERLINK`).
- Rapport d'erreurs CSV téléchargé : BOM, colonnes Ligne,Colonne,Motif, numérotation cohérente.
- Doublons :
  - Ignorer : 1 ignoré.
  - Mettre à jour : Alice mise à jour (nom et ville), pas de doublon.
  - Créer quand même : doublon créé.
- Leads importés visibles en Kanban, tableau et fiche. Historique « Lead créé (import CSV) ».
- Performance : 5000 lignes simulées en 0,8 s, importées en 1,1 s (5000 créés).
- Commercial sans `leads.import` : « Accès refusé » sur /import. Le Prospecteur y accède.

## Webhooks entrants (curl réel)
- Création de 3 endpoints (générique, Meta, Google) : secret `lfs_…` affiché une seule fois, absent de la page après rechargement. Copier l'URL OK, avec presse-papiers vérifié. Mappage JSON enregistré.
- Générique :
  - Sans secret ou mauvais secret : 401.
  - En-tête secret valide : 200 « created ».
  - Doublon : 200 « duplicate ».
  - HMAC valide : 200. HMAC invalide : 401. Horodatage périmé : 401.
  - `text/plain` ou sans Content-Type : 415. JSON invalide ou tableau : 400.
  - E-mail invalide : 200 « rejected ». Corps de 120 Ko : 413.
  - Mauvais jeton d'URL : 404. GET : 404.
  - Un `org_id` dans la charge est ignoré.
  - Leads créés avec les bons champs (valeur 1500.5, téléphone normalisé, source « Salon »).
  - Un nom contenant du HTML est stocké tel quel ; l'affichage est échappé.
- Meta : GET `hub.challenge` avec le bon verify_token renvoie 200 « CH123 », avec un mauvais jeton 404. POST valide : lead créé. Charge sans lead : 400.
- Google : `google_key` valide : créé. Clé invalide : 401.
- Limite de débit : 70 requêtes en rafale, soit 48 en 200 puis 22 en 429 avec `Retry-After: 60`.
- Journal par endpoint : Créé, Rejeté, Authentification refusée. Les données personnelles sont masquées (`r***@x.fr`, `google_key` masqué).
- Régénérer le secret : l'ancien secret est refusé (401), le nouveau fonctionne. Désactiver : POST et GET renvoient 404 (neutre). Réactiver : 200.

## Mobile 390 px
- /import : étapes 2 et 3 sans overflow, captures vues.
- /settings/integrations : overflow (bug 1).

## Données de test
- Supprimées : organisation « QA6 … » (leads, endpoints, journaux, jobs), fichiers du bucket `imports`, comptes `@qa1.test`. Serveur arrêté.
- Captures : `/private/tmp/claude-501/-Users-yarone-SAAS-CRM/d034c5e7-96c4-4bc5-a65e-c92fc1c14358/scratchpad/shots` (préfixe `i-`).

---
(Rapports précédents S4, S3, S2 et S1 ci-dessous.)

# Re-check S4 (boucle 1) : OK

- typecheck, lint, vitest (365/365) et build OK ; e2e 7/7. Le mock du géocodeur exige `E2E_ALLOW_MOCK_GEOCODER=1` en plus de `GEOCODER=mock` pour tourner en build de prod.
- RDV dans le rayon (17.4 km) et hors rayon (391.5 km) avec motif obligatoire : toujours OK, distance et dérogation bien enregistrées malgré l'écriture par service_role.
- RDV passé : « Planifier » est désactivé tant que la case « Ce créneau est dans le passé. Je confirme vouloir enregistrer ce rendez-vous à cette date. » n'est pas cochée. Corrigé.
- Message « Adresse introuvable » effacé dès la saisie suivante, aussi bien dans le dialogue RDV que dans la zone d'un commercial. Corrigé.
- Mobile 390 px, vue Jour, Admin : un sélecteur « Commercial » remplace les colonnes multiples, sans overflow (capture regardée). Corrigé. Mineur : l'en-tête de colonne est tronqué (« Rep » pour « Rep1 »).
- Modification d'un RDV :
  - Changer le lieu (Versailles vers Lyon) recalcule la distance (17.4 vers 391.5 km) et exige une dérogation.
  - Changer le commercial vers Rep2 recalcule la distance pour la zone de Rep2 (394.6 km > 20 km) et le changement est enregistré.
- Historique :
  - « Rendez-vous annulé… (dérogation hors zone : …) » et « Rendez-vous modifié ».
  - « Rendez-vous forcé hors zone ».
  - « Rendez-vous supprimé » (suppression côté base, acteur « Automatisation »).
- Mineur : le motif de dérogation est refusé quand il est trop court (« QA », 2 caractères). Le bouton reste désactivé sans message expliquant la longueur minimale.
- La suppression d'un RDV n'est pas exposée dans l'UI (annulation seulement).
- Données de test supprimées, serveur arrêté.

---
(Rapport S4 initial ci-dessous.)

# QA1 — Sprint S4 (rendez-vous, agenda, distance)

## Verdict : OK, 0 bug bloquant ; 3 défauts mineurs

## Commandes
- typecheck : OK
- lint : OK
- vitest : 341/341 OK
- build : OK (/agenda présent)
- e2e : 7/7 sur 2 exécutions complètes (stabilité OK)

## Défauts mineurs
1. Un rendez-vous peut être planifié à une date passée.
   - Étapes : fiche lead, onglet RDV, « Prendre RDV », date 3 jours dans le passé.
   - Attendu : alerte ou blocage.
   - Obtenu : « Planifier » reste actif, aucun avertissement.
2. Mobile 390 px, agenda en vue Jour (vue par défaut) pour un Admin : la grille affiche une colonne par commercial. La 2e colonne est coupée (« Rep… ») et il faut faire défiler dans la grille. Aucun overflow de page. Pour un Commercial, la vue est une seule colonne.
3. Zone d'un commercial : après un message d'erreur d'adresse introuvable, une nouvelle saisie (rayon 0, adresse valide) affiche toujours l'ancien message « Adresse introuvable ». Le message d'erreur n'est pas effacé et masque l'erreur réelle de rayon. Le rayon valide (30) est ensuite enregistré normalement.

## Parcours validés (build prod, GEOCODER=mock)
- Zone commercial depuis /settings/members (« Zone de Rep1 ») : adresse introuvable refusée avec message clair, adresse valide et rayon 30 km enregistrés, affichés dans la liste. Un Commercial a le bouton « Zone de <son nom> » dans l'agenda.
- RDV dans le rayon : bandeau « À 17.4 km de la zone de Rep1 (rayon 30 km) », création OK, badge « Dans la zone · 17.4 km ».
- RDV hors rayon : alerte « 391.5 km, au-delà du rayon de 30 km », « Planifier » désactivé. « Forcer quand même » fait apparaître le champ « Motif de la dérogation (obligatoire) » : motif vide ou blanc donne un bouton désactivé, motif rempli active le bouton. Le RDV est créé avec « Hors zone · 391.5 km » et « Dérogation » ; le motif est affiché et tracé dans l'historique du lead.
- Adresse non géocodée (saisie libre « zzz ») : bandeau « distance non vérifiée » avec « Relancer le calcul ». Planification permise, badge « Distance non vérifiée ». Un commercial sans zone donne « Rep2 n'a pas de zone d'intervention : distance non vérifiée. Définir une zone ».
- Conflit : « Conflit d'agenda : Rep1 a déjà un rendez-vous sur ce créneau. … Choisissez un autre créneau ou un autre commercial. » « Planifier » est désactivé. Un RDV collé (11:00 juste après 10:00-11:00) est accepté.
- Modifier un RDV (heure) : OK, tracé dans l'historique. Annuler et changer le statut (Planifié, Confirmé, Réalisé, Annulé, Absent) : OK, historique « Rendez-vous annulé ». L'agenda affiche l'annulé barré.
- Agenda semaine, jour, mois et liste : navigation précédent/suivant OK, titre cohérent, 4 RDV présents (l'annulé aussi), mois avec points. Détail d'un RDV au clic. Création depuis l'agenda : dialogue avec lead, date, durée, commercial, lieu.
- Filtre des commerciaux : chips Tous, Owner, Rep1, Rep2 pour l'Admin, filtrage effectif. Un Commercial n'a pas de chips et ne voit que ses 3 RDV, sans voir ceux de Rep2.
- Droits du Commercial : le sélecteur « Commercial » du dialogue est désactivé (impossible de réaffecter). Il peut créer un RDV sur son lead, mais pas ouvrir la fiche d'un lead d'autrui (404).
- Notifications : le commercial assigné reçoit « Nouveau rendez-vous… » pour chaque création (Rep1 : 3 non lues, Rep2 : 1), badge visible sur la cloche.
- Badge du prochain RDV sur les cartes Kanban (« 26 oct., 14:00 »). Onglet RDV de la fiche : état vide, À venir, boutons Modifier et Annuler.
- Enchaînements rapides (risque de blocage des server actions) :
  - 8 déplacements par le menu à 80 ms d'intervalle : état final cohérent (UI = base), aucune action en attente.
  - 3 drags souris consécutifs vers « Perdu » : tous persistés.
  - Série de filtres (statuts, recherche, tri) sans attendre, puis action groupée pendant un changement de recherche : tout s'exécute (« 4 déplacé(s), 4 refusé(s) : statut final »). Le Kanban reste interactif ensuite.
- Mobile 390 px : aucun overflow sur /agenda (Admin et Commercial), le dialogue de RDV (plein écran), la fiche (onglet RDV) et le mois. Le bouton flottant « + » est visible, la barre basse affiche Agenda.

## Non testé ou limité
- Géocodage réel BAN/Nominatim (mock uniquement), skeleton de l'agenda et états d'erreur avec Réessayer.
- Réaction aux notifications lors d'une modification ou annulation de RDV : non vérifiée.
- Fuseau : affichage cohérent en UTC+1 (10:00 affiché = 09:00Z en base).

## Données de test
- Supprimées : organisation « QA5 … », comptes `@qa1.test`. Serveur arrêté.
- Captures : `/private/tmp/claude-501/-Users-yarone-SAAS-CRM/d034c5e7-96c4-4bc5-a65e-c92fc1c14358/scratchpad/shots` (préfixe `a-`).

---
(Rapports précédents S3, S2 et S1 ci-dessous.)

# Re-check S3 (boucle 1) : OK

- typecheck, lint et vitest (298/298) OK ; build OK (/settings/webhooks présent).
- e2e : 6/6 sur 2 exécutions complètes sur 3. Une exécution complète a échoué sur `workflow.spec.ts` (trace non analysée), puis ce spec a passé 3 fois isolément et la suite complète a passé. Flaky intermittent à surveiller (cause probable : timing après `leads.spec`), non reproduit.
- Poignée de drag Kanban (`Glisser <nom>`) : le drag souris réel fonctionne (le lead passe en « À qualifier », confirmé en base). Un clic sur le nom ouvre la fiche. Corrigé.
- /settings/webhooks (Admin) :
  - Secret masqué (32 points), affichable (64 caractères), version affichée.
  - « Copier le secret » : toast, et le presse-papiers contient bien le secret.
  - « Régénérer » : confirmation, nouveau secret, version 1 vers 2.
  - Un rôle Commercial voit « Accès refusé ».
- Champs nombre : le formulaire propose Minimum et Maximum. Min > max est refusé (« Le minimum dépasse le maximum. »). Sur la fiche, 11 avec max 10 est refusé (« Valeur maximale : 10. »). -1 est refusé (« Valeur minimale : 0. »), y compris le champ Surface (min 0 par défaut, -5 refusé). Bug mineur de S3 corrigé.
- Statut final : message distinct « « Perdu » est un statut final : un lead ne peut plus en sortir. », en déplacement unitaire comme en groupé. Mineur : le toast propose un bouton « Réessayer » inutile pour ce cas.
- Historique : « Champs modifiés : Société » apparaît pour une modification inline native. Corrigé.
- Champs masqués par rôle :
  - Un champ « QA Secret » non visible pour Commercial reste invisible pour lui : absent de la fiche, du menu Colonnes, et la valeur n'apparaît nulle part dans la page.
  - Via REST, `leads_api` renvoie `custom` sans cette clé.
  - La lecture de `leads.custom` est refusée (« permission denied for table leads »).
- Régression lecture via `leads_api`, Admin : liste (45 leads), pagination (25 puis 20), tri, recherche (téléphone), filtre source (23), assignation groupée (25 leads), Kanban et fiche OK. Commercial view_own : 2 leads visibles, recherche, tableau et fiche OK.
- Import non encore livré : non testé.
- Données de test supprimées, serveur arrêté.

---
(Rapport S3 initial ci-dessous.)

# QA1 — Sprint S3 (leads)

## Verdict : OK, 0 bug bloquant ; 1 bug mineur et 4 observations mineures

## Commandes
- typecheck : OK
- lint : OK
- vitest : 259/259 OK
- e2e : 6/6 OK
- build : OK (/leads, /leads/[id] et /tasks présents)

## Bugs
1. MINEUR — Un champ personnalisé de type nombre accepte une valeur négative.
   - Étapes : /leads, « Nouveau lead », renseigner le prénom Jean et le nom Dupont, puis saisir « Surface habitable » = -5 et valider. Même chose en édition inline sur la fiche.
   - Attendu : refus, comme pour le champ natif « Valeur », qui renvoie « Valeur invalide. » pour -3.
   - Obtenu : le lead est créé avec `surface_m2 = -5`. Cause : la validation dans src/lib/custom-fields.ts n'impose qu'un min de -1e12.
   - Sévérité : mineure (incohérence).

## Observations (non bloquantes)
- Un statut final n'a pas de sortie, mais le message affiché est « Transition non autorisée pour votre rôle : Perdu → Nouveau. » pour un Admin. Il prête à confusion : le motif est « statut final ».
- Les modifications des champs natifs en inline (Société, etc.) n'apparaissent pas dans l'historique. Seuls les champs personnalisés (« Champs modifiés : Surface habitable »), l'assignation et le statut sont tracés.
- Le contrôle du type de fichier à l'upload se fait sur l'extension ou le type MIME déclaré. Un `fake.png` contenant du HTML est accepté (pas de vérification du contenu). Le téléchargement fonctionne, il faut donc qu'il soit servi en `attachment` côté Storage.
- Sur le Kanban, le titre de la carte est un lien qui bloque le drag. Il faut saisir la carte ailleurs que sur le nom. C'est cohérent avec le design mais peu découvrable.

## Parcours validés (build prod, chromium, 45 leads seedés plus un lead créé par l'UI)
- Création d'un lead :
  - Sans nom ni société : « Indiquez au moins un nom ou une société. »
  - E-mail invalide : « E-mail invalide. »
  - Champs obligatoires du template validés.
  - Le lead apparaît dans la colonne Nouveau.
- Drag and drop souris réel entre colonnes : OK. Persistant après rechargement et en base.
- Menu « Déplacer vers… » : OK, les transitions non autorisées sont marquées « non autorisé ».
- Commercial (view_own) : la transition interdite est refusée, la carte revient en place avec le toast « Transition non autorisée pour votre rôle… ».
- Actions automatiques :
  - Passage en « RDV pris » : la tâche « Préparer la visite technique » est créée, assignée, avec échéance à 24 h. Elle est visible dans /tasks.
  - Passage en « Signé » : notification « Un dossier vient d'être signé. », visible dans la cloche (badge 1 non lue, puis marquée lue à l'ouverture).
  - L'action est tracée dans `action_runs` (success).
- Bascule Kanban/Tableau : OK, la préférence est mémorisée.
- Tableau :
  - Tri par nom (asc/desc) OK.
  - Pagination 25/page (46 leads, 25 puis 21) et choix 25/50/100.
  - Recherche par nom, par téléphone et insensible à la casse.
  - Filtres source (multi), statut, date et champs personnalisés OK. « Tout effacer » OK.
- Actions groupées :
  - Changer le statut (10 leads) OK.
  - Assigner (10 leads) OK.
  - Rafraîchissement du tableau après action OK.
  - Déplacement groupé vers un statut final puis retour : refus avec message.
  - Suppression groupée (6 leads) : dialogue de confirmation, suppression effective.
- Fiche lead :
  - Édition inline avec validation (e-mail invalide, valeur négative refusée).
  - Notes (le HTML est échappé), appels, fichiers.
  - Upload : PDF OK, `.exe` refusé (« Type de fichier non autorisé… »), plus de 10 Mo refusé (« Fichier trop volumineux (10 Mo maximum). »).
  - Téléchargement OK.
  - Historique cohérent et chronologique.
  - Changement de statut par le select OK.
  - 404 dédiée (« Lead introuvable ») pour un id inconnu ou invalide.
- Statut avec leads :
  - La suppression exige un statut de remplacement et refuse sans choix (« choisissez un statut de remplacement »).
  - Avec remplacement : les leads sont réaffectés.
  - Le dernier statut perdu n'est pas supprimable (« Il doit rester au moins un statut perdu. »).
- Compteur par source : Meta Ads 20 et Google Ads 19, cohérent avec la base.
- Changement de template refusé quand l'organisation contient des leads (« l'organisation contient déjà des leads »).
- view_own : Rep1 ne voit que ses 3 leads assignés (total 3). Le lead d'un autre renvoie 404. Pas de bouton « Nouveau lead » (pas de permission de création). Pas de sélection groupée. /tasks vide avec état vide.
- Mobile 390 px : aucun overflow sur /leads (Kanban et Tableau), /tasks et la fiche. La barre basse affiche Tâches. Le Kanban affiche des points d'indication de colonnes et un bouton + flottant. Le tableau devient une liste de cartes.
- Thème clair : captures prises sur le Kanban et la fiche.

## Non testé ou limité
- États de chargement (skeletons) et d'erreur avec Réessayer : non provoqués.
- Actions auto « assign » et webhook : non exercées (configuration du template : notify et create_task seulement).
- Rejet fin côté serveur d'une fuite cross-org : couvert par les tests RLS (vitest), pas rejoué en navigateur.

## Données de test
- Supprimées : organisation « QA4 … », comptes `@qa1.test`, fichiers Storage de l'organisation. Serveur arrêté.
- Captures : `/private/tmp/claude-501/-Users-yarone-SAAS-CRM/d034c5e7-96c4-4bc5-a65e-c92fc1c14358/scratchpad/shots` (préfixe `l-`).

---
(Rapports précédents S2 puis S1 ci-dessous.)

# Re-check S2 (boucle 1) : OK

- Build, typecheck et e2e (5/5) : OK.
- Bug 1 (renommer ou archiver une source) : corrigé. Renommer, archiver et désarchiver fonctionnent, avec toasts.
- Bug 2 (doublon de source avec casse différente) : corrigé. « meta ads » est refusé avec « Cette source existe déjà. », y compris au renommage (« MeTa AdS »).
- Bug 3 (mobile 390 px, /settings/statuses) : corrigé. Les noms sont lisibles en entier (badge de type à la ligne), sans overflow. Desktop inchangé.
- Bug 4 (test du webhook) : corrigé. Sur une cible qui répond 405, le toast affiche « Cible joignable (HTTP 405) ».
- Enregistrement des actions et des transitions : OK (RPC atomiques).
- Observation mineure : après un doublon refusé dans le champ d'ajout, le message d'erreur reste affiché lors d'une autre action (renommage). Il n'est pas effacé.
- Données de test supprimées, serveur arrêté.

---
(Rapport initial ci-dessous, avant correctifs.)

# QA1 — Sprint S2 (templates, statuts, champs, sources)

## Verdict : 1 bug majeur, 3 bugs mineurs. Le reste du sprint fonctionne.

## Commandes
- typecheck : OK
- lint : OK
- vitest : 117/117 OK
- e2e : 5/5 OK
- build : OK (routes /onboarding, /settings/{statuses,fields,sources} présentes)

## Bugs
1. MAJEUR — Renommer ou archiver une source de leads échoue toujours.
   - Étapes : /settings/sources, ajouter « QA Src », cliquer sur le crayon, saisir « QA Src2 », valider. Même échec avec le bouton Archiver.
   - Attendu : la source est renommée ou archivée (toast de succès).
   - Obtenu : « Enregistrement impossible. » ou « Opération impossible. » Reproduit en appelant directement Supabase avec le JWT de l'utilisateur : `record "new" has no field "type"` (code 42703).
   - Cause probable : le trigger `immutable_org_guard` (migration 20260103000000_s2_workflow.sql) évalue `new.type` et `new.key` sur toutes les tables où il est posé, mais `lead_sources` (et `status_actions`) n'ont pas ces colonnes. Tout UPDATE d'une ligne de ces tables échoue.
   - Les actions auto s'enregistrent quand même (supprimer puis réinsérer), mais tout futur UPDATE direct de ces tables sera cassé.
   - Sévérité : majeure. Les e2e et les tests RLS ne couvrent pas l'UPDATE sur lead_sources.
2. MINEUR — Unicité des noms de source sensible à la casse : « meta ads » est créé à côté de « Meta Ads ». Les champs et les statuts n'ont pas été testés sur ce point.
   - Attendu : doublon refusé (« Cette source existe déjà. »). Obtenu : la source est créée.
3. MINEUR — Mobile 390 px, /settings/statuses : les noms de statut sont tronqués à 4-5 caractères (« Conta… », « Devis … »). Le premier statut (« Nouvelle demande », badge Initial) n'affiche aucun nom. Cause : poignée, pastille, badge de type et trois boutons occupent toute la largeur.
   - Attendu : nom lisible (retour à la ligne ou badges réduits). Sévérité : mineure (UX).
4. MINEUR — Test du webhook : un toast « Le serveur a répondu 405. » signale un échec alors que la cible est joignable (https://example.com/hook refuse simplement le POST). Le test suggère à tort que l'URL est invalide. Le message pourrait préciser « joignable mais statut 405 ».
   - Les URL `http://…` et `https://localhost/…` sont bien refusées (« URL https publique requise. »).
   - À l'enregistrement, une URL invalide est refusée avec un message clair.

## Parcours validés
- Inscription avec chacun des 5 templates, puis redirection vers /onboarding. Contenu créé en base pour chacun :

| Template | Statuts | Champs | Sources | Transitions | Actions |
|---|---|---|---|---|---|
| energie | 7 | 6 | 8 | 12 | 3 |
| btp | 6 | 5 | 8 | 9 | 2 |
| immobilier | 6 | 5 | 8 | 9 | 2 |
| auto | 6 | 5 | 8 | 9 | 2 |
| generic | 4 | 2 | 8 | 4 | 1 |

  Les 8 sources comprennent Import CSV et Webhook (système, verrouillées).
- /onboarding : titre « Votre espace Énergies est prêt », pipeline de pastilles avec finals marqués, liste de champs avec icônes et « Obligatoire », chips de sources, boutons Commencer et Changer de template.
- Changer de template (Énergies vers BTP) : la config est remplacée, le titre devient « Artisan BTP ».
- Statuts :
  - Création : nom vide (« Nom requis. ») et doublon (« Ce nom est déjà utilisé. ») refusés.
  - Couleur : 12 pastilles, persistée (vert enregistré en base).
  - Type final gagné : persisté.
  - Transitions : un statut final affiche « Un statut final n'a pas de transition sortante. »
  - Matrice de transitions par rôle : checkboxes, boutons « Tous les rôles » et « Aucun ».
  - Réordonner : glisser à la souris, glisser au clavier (Espace, flèche, Espace) et boutons Monter/Descendre fonctionnent. L'ordre est persistant après rechargement et en base.
  - Actions auto : les 4 types (Assigner, Notifier, Créer une tâche, Webhook) s'ajoutent et s'enregistrent. Une action vide donne « Choisissez un utilisateur ou un rôle. »
  - Suppression d'un statut : dialogue de confirmation affiché.
- Champs :
  - Les 6 types sont créables, y compris Liste avec options.
  - Liste avec moins de 2 options : « Au moins 2 options. »
  - Obligatoire : persisté.
  - Doublon de nom : « Ce nom est déjà utilisé. »
  - Nom vide : « Nom requis. »
  - Visibilité par rôle : persistée dans `visible_roles` et `editable_roles`.
  - Ordre : monter/descendre persistant.
  - Le type est verrouillé à l'édition.
  - La suppression propose Masquer ou Supprimer.
- Sources : ajout OK, doublon exact refusé, nom vide refusé, sources système sans boutons d'action. Renommer et archiver échouent (bug 1).
- Accès refusé : un rôle sans permissions (Commercial) voit « Accès refusé » sur /settings/statuses, /fields, /sources, /roles et /members.
- Mobile 390 px : aucun overflow horizontal sur /onboarding et /settings/{statuses,fields,sources}. La barre basse est présente. Le panneau de statut s'affiche en plein écran et les transitions sont en cartes.
- Thème clair : testé sur /settings/statuses et /settings/fields (captures prises).
- Aucune erreur console.

## Non testé ou limité
- Suppression d'un statut utilisé par des leads, et compteur de leads par source : prévus en S3 (pas de table leads).
- Écrans de chargement (skeletons) et d'erreur avec Réessayer : non provoqués.
- `/onboarding` reste accessible à un rôle sans permission (affiché pour un Commercial). Le bouton « Changer de template » n'a pas été observé pour ce rôle.
- La confirmation de fermeture avec modifications non enregistrées passe par `window.confirm` (le panneau reste ouvert en test automatisé).

## Données de test
- Supprimées : organisations « QA2 … » et comptes `@qa1.test`. Serveur de prod arrêté.
- Captures : `/private/tmp/claude-501/-Users-yarone-SAAS-CRM/d034c5e7-96c4-4bc5-a65e-c92fc1c14358/scratchpad/shots`.
