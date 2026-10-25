# FINAL — LeadForge CRM

## Verdict
- 8 sprints (S0–S7) livrés ; QA1 = OK, QA2 = OK sur le dernier sprint (1 boucle de correction par sprint, jamais plus)
- Vérifié par l'orchestrateur après reset complet de la base : typecheck 0 erreur · lint propre · Vitest 660/660 · Playwright 21/21 · build prod OK
- `npm run dev:all` démarre sans erreur (Supabase local + Next + Stripe CLI si configuré)
- **Paiement Stripe : bout en bout validé avec stripe-mock + webhooks signés localement, PAS avec le vrai Stripe** (voir « Limites »)

## Fait (10 fonctionnalités MVP)
- 1 Auth + multi-tenant : une organisation = un périmètre isolé ; RLS + FORCE sur toutes les tables ; tests d'isolation A/B sur chaque table et sur Storage
- 2 Rôles : Super administrateur (pouvoir total, programme tout) > Administrateur (permissions larges, modifiables par le super admin seul) > Prospecteur, Confirmateur, Commercial + rôles personnalisés (15 permissions) ; anti-escalade et dernier super admin protégés en base ; droits « poser tel statut » par rôle (matrice Réglages > Statuts, table `status_role_grants`, appliqués dans `can_transition` et à la création de lead)
- 3 Statuts 100 % programmables : couleur, ordre, gagné/perdu, transitions par rôle (appliquées en base), actions auto (assigner, notifier, tâche, webhook signé HMAC via safeFetch anti-SSRF)
- 4 Champs personnalisés (texte, nombre, date, liste, fichier, adresse) : validation en base, visibilité/édition par rôle, masquage via la vue `leads_api`
- 5 Kanban drag & drop, tableau filtrable/triable/paginé, fiche lead (historique append-only, notes, appels, RDV, fichiers)
- 6 RDV : agenda, contrôle de distance (zone + rayon par commercial), dérogation avec motif tracé, anti-chevauchement en base
- 7 Import CSV (assistant 4 étapes, simulation, doublons) + webhooks entrants Meta / Google / générique
- 8 Dashboard KPI : par statut, conversion, par utilisateur, par source, période ; visibilité view_all / view_own
- 9 Abonnement : Starter 9,90 € / 3 users · Pro 79 € / 10 · Business 199 € / illimité (seat_limit null) ; essai 14 jours ; Checkout (Apple Pay automatique sur domaine HTTPS vérifié) ; portail client ; webhook signé idempotent ; lecture seule si inactif
- 10 Templates : Énergies, Artisan BTP, Immobilier, Automobile, Générique
- Landing (hero, features, pricing, FAQ, CTA), pages légales, sitemap, robots, SEO ; dark par défaut + light ; responsive 390 px vérifié

## Comptes de démo (mot de passe commun `Demo1234!`, après `npm run db:seed`)
- admin.energies@demo.test — Super administrateur — Énergie Verte Démo (120 leads)
- administrateur@demo.test — Administrateur — Énergie Verte Démo
- prospecteur@demo.test — Prospecteur — Énergie Verte Démo
- confirmateur@demo.test — Confirmateur — Énergie Verte Démo
- commercial@demo.test — Commercial « Pauline Roche » (zone Lyon 40 km, 09h-19h, 4/jour) — Énergie Verte Démo ET Artisans Dupont Démo
- commercial2@demo.test — Commercial « Karim Benali » (zone Vénissieux 25 km, 10h-20h, 4/jour) — Énergie Verte Démo
- admin.artisan@demo.test — Super administrateur — Artisans Dupont Démo (80 leads)
- Total : 2 orgs, 7 comptes, 200 leads, 111 RDV (dont 8 hors rayon avec dérogation)

## Répartition automatique des RDV (ajout)
- Le moteur PROPOSE, le confirmateur / admin / super admin DÉCIDE (permission `dispatch.manage`, accordée par défaut à Confirmateur et Administrateur) : aperçu avant/après, modification manuelle (commercial, jour, heure, échange, retrait) VERROUILLÉE (auteur/date), jamais défaite par un recalcul ; le commercial voit sa tournée (durées/km réels, Google Maps/Waze) et peut seulement « Signaler un problème » ou fournir une position GPS (le confirmateur est notifié, rien n'est déplacé)
- Règle de charge (réglable par organisation, surchargeable par commercial) : norme 4 RDV/jour (brief : ~4 ; migration 20260118, défauts 4/5/6, les réglages déjà enregistrés sont conservés) ; 5e RDV ajouté seulement si le détour est faible (≤ 20 min de route avec marge) et si personne de moins chargé ne le prend (raison affichée « 5e RDV ajouté : +12 min de route seulement ») ; 6e RDV JAMAIS automatique : proposé avec case décochée, approuvé puis verrouillé par le confirmateur ; jauge x/4 ; journée surchargée par des RDV déjà posés : signalée, non modifiée
- Itinéraires routiers réels : OSRM auto-hébergé (Docker, données OSM Rhône-Alpes découpées) ; durée/distance entre RDV et depuis la base, `apply_dispatch` rejoue la validation en base (zone, horaires, jours, max/jour, trajet en minutes, chevauchement, indisponibilités) avec un cache de trajets
- Circulation : coefficients d'heure de pointe réglables (estimation, pas du temps réel) + marge de sécurité ; TomTom/Mapbox optionnels (clé gratuite, serveur seulement, cache mémoire 15 min) ; avertissement « les conditions réelles de circulation peuvent varier » affiché partout
- Points GPS fixés à la saisie (autocomplétion Géoplateforme/BAN, saisie manuelle en chaîne BAN → Nominatim → commune, pin Leaflet/OSM, coordonnées Google Maps) ; RDV sans point / approximatif / hors route → section « À vérifier » (jamais ignoré en silence)
- RGPD : seul le texte de l'adresse saisie part vers les API publiques (BAN, Nominatim) ; les tuiles OSM ne reçoivent que des coordonnées de carte ; aucun nom, téléphone ni e-mail n'est transmis. TomTom/Mapbox (si activés) ne reçoivent que des coordonnées de trajet
- Limites : pas de trafic temps réel (aucun jeu de données trafic gratuit et ouvert) ; VROOM non intégré (ordre optimal par permutations exactes jusqu'à 7 arrêts) ; autocomplétion branchée dans la correction du confirmateur (pas encore dans la fiche lead / la prise de RDV du télépro)

## Limites connues
- **Stripe réel non testé** : la clé de test du CLI était expirée (2026-07-04) et rattachée à un autre projet ; elle n'a pas été utilisée. Pour tester en réel : `stripe login`, renseigner `STRIPE_SECRET_KEY=sk_test_…` dans `.env.local`, `npm run stripe:setup`, `npm run dev:all`, carte 4242 4242 4242 4242
- Apple Pay / Google Pay exigent HTTPS + domaine vérifié chez Stripe : impossible en HTTP local
- Rate limits et caches (dashboard, droits d'abonnement) en mémoire par process : inefficaces en multi-instance
- Pages légales provisoires (crochets à compléter) ; pas de bascule mensuel/annuel ; pas de 2FA ni de journal d'audit admin
- CSP avec `'unsafe-inline'` sur script-src (nonces à prévoir) ; alerte npm audit haute sur postcss (build-time, via Next)
- RGPD : adresses envoyées à BAN puis Nominatim pour le géocodage (à déclarer) ; purge des webhooks entrants (14 j masqués, 90 j supprimés) dépend du cron
- Meta Lead Ads : sans secret d'application renseigné, seul le jeton d'URL protège le POST
- Écritures directes REST par un membre autorisé : un RDV créé hors server action reste « distance non vérifiée »
- Les anciens endpoints webhook (avant S5) n'ont pas de signature HMAC : régénérer le secret
- Mineurs UX restants : quelques cibles tactiles mobiles < 40 px, bouton « Réessayer » inutile sur un toast de lecture seule
- Autre projet Docker sur la machine (`express-pb-e2e`, ports 54xxx) : non touché ; ce projet utilise les ports 5632x

## Passer en production (Vercel + Supabase cloud + Stripe live)
1. Supabase cloud : créer le projet (région UE), `supabase link` puis `supabase db push` (14 migrations) ; vérifier RLS + FORCE ; configurer Auth (URL du site, SMTP réel, confirmation e-mail activée, mots de passe forts) ; créer le bucket `lead-files` et `imports` privés via les migrations ; NE JAMAIS lancer le seed démo
2. Vercel : importer le dépôt, Node 22+, variables d'environnement (voir ci-dessous), domaine en HTTPS
3. Variables obligatoires : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` (https), `INBOUND_SECRET_KEY` (≥ 32 car.), `WEBHOOK_SIGNING_SALT` (≥ 16), `CRON_SECRET`, `TRUSTED_PROXY=1`, variables Stripe ci-dessous ; ne jamais définir `GEOCODER=mock`, `STRIPE_API_BASE`, `E2E_*`, `ALLOW_REMOTE_SEED`
4. Stripe live : activer le compte, créer les produits/prix avec le script en mode live (ou dashboard), renseigner `STRIPE_SECRET_KEY` (live), `STRIPE_PRICE_STARTER/PRO/BUSINESS`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` ; créer le webhook `https://<domaine>/api/stripe/webhook` (événements : checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed, customer.subscription.trial_will_end) et copier `STRIPE_WEBHOOK_SECRET` ; configurer le portail client ; enregistrer le domaine pour Apple Pay
5. Cron : planifier un appel quotidien à `/api/cron/maintenance` avec `Authorization: Bearer <CRON_SECRET>` (purges RGPD)
6. Redis (Upstash) pour le rate limit et les caches ; brancher l'interface de `src/lib/rate-limit.ts`
7. Avant ouverture : compléter les pages légales, renforcer la CSP (nonces), mettre à jour Next/postcss, faire tourner les tests avec de vraies clés de test, rotation des clés de développement
