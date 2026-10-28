# LeadForge CRM : audit de préparation à la production

Audit en lecture seule, daté du 25/10/2026, fondé sur la lecture du code (aucun test relancé, aucun serveur touché). Les rapports d'agents précédents (`docs/agents/dispatch/*.md`) ne sont cités que lorsque je les ai recoupés avec le code.

## 1. Rôles et droits

### 1.1 Mécanique
- Catalogue de 16 permissions : `src/lib/permissions.ts`, miroir de la contrainte SQL `roles_permissions_known` (`supabase/migrations/20260116000000_dispatch.sql`, dernière version).
- Côté base : `has_perm(org, perm)` = membre actif dont le rôle est `is_admin` ou contient la permission (`20260101000000_core_multitenant.sql:72`). Côté app : `can()/canAny()` avec `isAdmin` (`src/lib/permissions.ts`). La RLS est donc la source de vérité, l'UI n'est qu'un reflet.
- 28 tables, RLS activée et `FORCE ROW LEVEL SECURITY` sur 21 migrations-lignes comptées (21/21 pour les `enable` : cohérent). À revérifier sur la base réelle (voir 3.3).
- Hiérarchie (`20260115000000_super_admin.sql`) : Super administrateur (`is_admin`, `system_key=super_admin`) > Administrateur (`system_key=administrator`) > rôles métier. Un non-super-admin ne peut ni se changer de rôle, ni attribuer un rôle dépassant le sien, ni créer un rôle plus puissant que le sien (anti-escalade, l. 151, 191-196, 284). Le super administrateur est un rôle PAR ORGANISATION (créé par `create_organization`, l. 384), il n'existe aucun rôle « plateforme » transverse : l'isolation entre organisations repose sur `org_id` + RLS, un super-admin d'une org n'a aucun accès aux autres.
- Droits de statut : table des transitions autorisées par rôle (`can_transition`, `can_place`), configurables par le super administrateur. « Signé » et « Perdu » sont finaux (J-multirole.md, constat).

### 1.2 Rôles livrés par défaut (créés par `create_organization`)
Il y en a 5, pas 6 : Super administrateur, Administrateur, Prospecteur, Confirmateur, Commercial. Un 6e rôle n'existe que si l'organisation en crée un (écran Paramètres > Rôles, permission `roles.manage`). Le « 6 » de la demande correspond probablement aux 6 sessions de `tests/e2e/multirole.spec.ts`; à confirmer.

| Permission | Super admin | Administrateur | Prospecteur | Confirmateur | Commercial |
|---|---|---|---|---|---|
| leads.view_all (voir tous) | oui | oui | non | oui | non |
| leads.view_own (voir les siens : assigné ou créé) | oui | oui | oui | non (a view_all) | oui |
| leads.create | oui | oui | oui | oui | non |
| leads.edit | oui | oui | oui | oui | oui |
| leads.delete | oui | oui | non | non | non |
| leads.import | oui | oui | oui | non | non |
| statuses.manage | oui | oui | non | non | non |
| fields.manage | oui | oui | non | non | non |
| roles.manage | oui | oui | non | non | non |
| members.manage | oui | oui | non | non | non |
| settings.manage | oui | oui | non | non | non |
| appointments.manage_all | oui | oui | non | oui | non |
| appointments.manage_own | oui | oui | oui | non | oui |
| dashboard.view | oui | oui | non | oui | non |
| dispatch.manage | oui | oui | non | oui | non |
| billing.manage | oui | NON | non | non | non |

Sources : `20260115000000_super_admin.sql:375-400` (jeu initial) + `20260116000000_dispatch.sql:13-30` (ajout de `dispatch.manage` à Administrateur et Confirmateur). Les rôles sont modifiables par organisation ensuite : cette matrice décrit les valeurs d'origine, pas un invariant.

### 1.3 Menus (`src/app/(app)/layout.tsx`, `docs/agents/dispatch/J-multirole.md`)
- Import : visible si `leads.import`. Répartition : `dispatch.manage`. Paramètres : l'une de `members.manage`, `roles.manage`, `settings.manage`. Facturation : réservée à `billing.manage` (donc au super admin seul par défaut).
- Dashboard, Leads, Agenda, Tâches : visibles pour tous; sans `dashboard.view` la page d'accueil est une version simplifiée sans statistiques.
- Par rôle : Super admin = tout. Administrateur = tout sauf Facturation. Prospecteur = Dashboard, Leads, Agenda, Tâches, Import. Confirmateur = + Répartition, sans Import ni Paramètres. Commercial = Dashboard, Leads, Agenda, Tâches.

### 1.4 Ce que chaque rôle ne peut pas faire
- Prospecteur : voir les leads d'autrui, supprimer, changer statuts/champs/rôles, voir le dashboard chiffré, répartir. Commercial : créer ou importer des leads, voir les leads non assignés à lui, gérer les RDV des autres. Confirmateur : importer, supprimer, configurer. Administrateur : accéder à la facturation, attribuer le rôle Super administrateur ou Administrateur, se changer son propre rôle. Super admin : même lui ne peut pas sortir un lead de « Signé/Perdu » (états finaux).
- Données : leads (`leads_select`, `20260105000000_s3_leads.sql:335`) = view_all OU (view_own ET assigné/créateur). Update/delete exigent en plus la visibilité. Les RDV, pièces jointes et événements suivent la même logique.

### 1.5 Réserves
- Le rôle Administrateur n'a pas `billing.manage` : un client Pro/Business qui n'a pas de super admin actif ne peut pas gérer l'abonnement. Documenter ou prévoir une procédure de récupération.
- Le dernier super administrateur peut-il être rétrogradé ou désactivé ? Non vérifié dans ce passage (à couvrir par un test RLS si ce n'est pas déjà fait dans `tests/rls/super-admin.test.ts`).

## 2. Fonctionnalités vendues vs réalité

### 2.1 Constat central
`plan` n'influence QUE `seat_limit` (`src/lib/billing/events.ts:96`, `planSeats`). Un grep des usages de `.plan` dans `src/` ne trouve aucune barrière de fonctionnalité : aucune page, action serveur, route ou politique SQL ne consulte le plan pour autoriser le dashboard, les actions automatiques, les webhooks sortants, les rôles avancés ou la répartition. Les différences Starter/Pro/Business hors nombre de sièges sont donc purement déclaratives (vitrine). La seule autre dimension appliquée est « écriture autorisée ou lecture seule » selon l'état d'abonnement (`computeEntitlement`, `org_is_writable` en SQL).

### 2.2 Tarifs et mécaniques (`src/lib/billing/plans.ts`)
| Promesse | Réalité | Statut |
|---|---|---|
| Starter 9,90 €/mois, 3 utilisateurs | prix 990 c, `seats: 3` | OK (déclaré) |
| Pro 79 €/mois, 10 utilisateurs | 7900 c, `seats: 10` | OK |
| Business 199 €/mois, illimité | 19900 c, `seats: null` | OK |
| Annuel = 10 mois facturés | `price * (12 - YEARLY_FREE_MONTHS)` avec 2 mois offerts; `scripts/stripe-setup.mjs` crée les prix `_yearly` | OK; prix annuels créés seulement par le script, non testés en live |
| Essai 14 jours | `trial_ends_at default now()+14 days` (`core_multitenant.sql:18`) puis, au checkout, Stripe ajoute AUSSI `trial_period_days: 14` si jamais souscrit (`checkout.ts:52`) | RISQUE : jusqu'à 28 jours cumulés en payant 14 jours après la création du compte; à clarifier |
| Sièges pendant l'essai | `TRIAL_SEATS = 5` dans plans.ts, mais `seat_limit default 5` en base | cohérent |

### 2.3 Application des sièges
- Création de membre : contrôle côté action (`settings/members/actions.ts:56-62`) ET trigger `enforce_seat_limit` (`core_multitenant.sql:136`, avec verrou `for update`) : appliqué et testé (`tests/rls/billing.test.ts`, `s7-security.test.ts`).
- Rétrogradation (plus de membres que de sièges) : seulement `seatsExceeded` + bannière (`billing-banner.tsx`); personne n'est désactivé automatiquement et aucun blocage fonctionnel. Le trigger refuse seulement les NOUVELLES memberships actives. Comportement acceptable mais à documenter.

### 2.4 Fonctionnalité par fonctionnalité
| Fonctionnalité annoncée | Plans annoncés | Implémentée | Bloquée par plan | Testée |
|---|---|---|---|---|
| Leads, Kanban, tableau « illimités » | tous | oui | aucune limite de volume (la promesse tient) | `tests/e2e/leads.spec.ts`, `tests/rls/leads*.test.ts` |
| Import CSV | tous | oui (`src/lib/import`) | non | `e2e/import.spec.ts`, `rls/import-inbound.test.ts` |
| Webhooks entrants | tous | générique oui; Meta/Google partiel (voir 3.6) | non | `tests/integration/inbound-*.test.ts` |
| Agenda et contrôle de distance | tous | oui | non | `e2e/agenda.spec.ts`, `rls/appointments*.test.ts` |
| Statuts programmables, champs personnalisés | tous (comparateur) | oui | non | `e2e/workflow.spec.ts`, `rls/workflow*.test.ts` |
| Répartition automatique (zone, distance, horaires) | comparateur : coche sur les 3 plans; aucune mention dans `PLANS[].features` | oui (moteur + UI) | non (vrai pour tous, donc la coche est exacte mais Starter reçoit une fonction coûteuse en géocodage/routage) | `e2e/dispatch.spec.ts`, `rls/dispatch*.test.ts`, unit `dispatch-*.test.ts` |
| Tableau de bord et performance par utilisateur | Pro, Business (Starter = tiret) | oui | NON : n'importe quelle org Starter obtient `/dashboard` si le rôle a `dashboard.view` | `e2e/dashboard.spec.ts`, `rls/dashboard*.test.ts` (aucun test de plan) |
| Actions automatiques et webhooks sortants | Pro, Business | oui (`src/lib/automation`, plafond 60 s, quota webhook) | NON : Starter peut configurer actions et webhooks | `unit/automation.test.ts` |
| Rôles et permissions avancés | Business | oui, éditeur de rôles complet | NON : toutes les orgs (même en essai) ont l'écran Rôles, les droits de statut, le super administrateur | `rls/super-admin.test.ts`, `e2e/super-admin.spec.ts` |
| Support prioritaire | Business | NON : aucun canal, aucun SLA, aucun outil de ticket, aucune adresse dans l'app | n/a | n/a |
| Espace séparé par entreprise | tous | oui (multi-tenant + RLS) | n/a | `rls/isolation.test.ts`, `security.test.ts` |
| Portail de facturation (annulation, carte, factures) | tous (FAQ) | oui (portail Stripe via `settings/billing/actions.ts`) | n/a | `integration/s7-stripe.test.ts` (stripe-mock uniquement) |
| Sans engagement / annulation | tous | oui via Stripe | n/a | idem |
| RGPD « export et suppression sur demande » (FAQ) | tous | NON en self-service : aucun export de compte ni suppression d'organisation dans l'app (seul l'import CSV existe) | n/a | n/a |
| « Conçu pour un hébergement UE » (FAQ) | tous | dépend du déploiement, rien n'est configuré | n/a | n/a |
| Leads Meta Lead Ads et Google Ads « arrivent seuls » (FAQ) | tous | PARTIEL, voir 3.6 | n/a | tests sur payload simulé uniquement |

### 2.5 Promesses à corriger ou à construire (liste sèche)
1. Dashboard réservé Pro+ : non appliqué. Ajouter un garde `plan` côté serveur (page + requêtes) ou retirer le tiret du comparateur.
2. Actions automatiques et webhooks sortants réservés Pro+ : non appliqué (écran, actions serveur d'enregistrement, moteur).
3. Rôles et permissions avancés réservés Business : non appliqué; il faut d'abord définir ce qui est « avancé » (rôles personnalisés ? droits de statut ?) puis le borner.
4. Support prioritaire : non construit. Prévoir une adresse dédiée et un SLA écrit, ou retirer.
5. Répartition automatique cochée partout : exacte mais non mentionnée dans les cartes de prix; décider si c'est un argument Pro (coût géocodage/OSRM) avant la mise en vente.
6. FAQ « export et suppression sur demande » : seulement manuel (voir 3.9).
7. « Statuts programmables » : fonctionnel mais le libellé promet de la programmation; l'outil est une machine à transitions par rôle + actions automatiques. Libellé à nuancer.
8. Un seul niveau de facturation par siège actif : pas de facturation à l'usage (géocodage, OSRM). Le coût variable est absorbé par l'éditeur.

## 3. Checklist de mise en production

Légende : OK / À FAIRE / RISQUE.

### 3.1 Stripe
| Point | Statut | Détail |
|---|---|---|
| Code checkout, portail, webhook (signature sur corps brut, tolérance 5 min, idempotence) | OK | `src/app/api/stripe/webhook/route.ts`, `src/lib/billing/*`; événements gérés : checkout.session.completed, subscription created/updated/deleted, invoice.paid, invoice.payment_failed, trial_will_end |
| Tests | RISQUE | uniquement stripe-mock et tests unitaires; jamais de bout en bout contre Stripe réel |
| Produits/prix live | À FAIRE | `scripts/stripe-setup.mjs` REFUSE toute clé non `sk_test_` (garde volontaire) : en live il faut créer les 6 prix à la main (ou adapter le script) avec les lookup_keys `leadforge_{starter,pro,business}_{monthly,yearly}` |
| Variables prix | À FAIRE | `.env.example` liste `STRIPE_PRICE_STARTER/PRO/BUSINESS` sans les `_YEARLY`; le code (`checkout.ts:9-11`) tombe sur la recherche par lookup_key, vérifier le comportement avant la prod |
| Webhook endpoint + secret de signature | À FAIRE | créer `https://<domaine>/api/stripe/webhook` en live, renseigner `STRIPE_WEBHOOK_SECRET`; sans lui la route répond 503 |
| Portail client | À FAIRE | configurer le portail en live (annulation, mise à jour de carte, factures, changement de plan limité à nos prix) |
| TVA / taxes | RISQUE | aucun `automatic_tax`, `tax_id_collection`, `billing_address_collection` dans `buildCheckoutParams`. Prix annoncés sans mention HT/TTC claire à valider. Activer Stripe Tax ou facturer HT avec TVA manuelle, collecter le n° de TVA B2B |
| Factures | À FAIRE | paramétrer les informations légales de l'émetteur dans Stripe; numérotation et mentions FR |
| Paiement échoué | OK | `invoice.payment_failed` => `past_due`, 7 jours de grâce (`GRACE_DAYS`), puis lecture seule (`computeEntitlement`, `org_is_writable`). Relances et Smart Retries à régler dans Stripe |
| Fin d'essai | RISQUE | double essai (voir 2.2); une org sans abonnement passe en `trial_expired` (lecture seule). `trial_will_end` notifie in-app, pas d'e-mail |
| Plafond de sièges et rétrogradation | OK / RISQUE | verrou à la création (OK), pas de désactivation auto au downgrade (RISQUE modéré) |
| `STRIPE_API_BASE` ignoré en production | OK | indiqué dans `.env.example` |

### 3.2 Variables d'environnement
Requises en production (d'après `.env.example` et le code) : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` (canonical, sitemap, retours Stripe), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_*`, `INBOUND_SECRET_KEY` (32+ caractères, obligatoire en prod), `WEBHOOK_SIGNING_SALT`, `CRON_SECRET`, `TRUSTED_PROXY=1` (sinon l'IP cliente est ignorée, donc le rate-limit par IP est aveugle), `GEOCODER_CONTACT`, `ROUTING_URL`/`ROUTING_PROVIDER`, `NEXT_PUBLIC_MAP_TILE_URL`.
À ne PAS positionner en prod : `GEOCODER=mock` (lève une erreur, sauf `E2E_ALLOW_MOCK_GEOCODER=1`), `STRIPE_API_BASE`, `ALLOW_REMOTE_SEED`, `CONFIRM_REMOTE_SEED`.
Écarts : `SUPABASE_DB_URL` et `SUPABASE_JWT_SECRET` sont listés mais servent aux scripts/tests locaux, à confirmer qu'aucun code runtime n'en dépend. Doublon de commentaire « Webhooks entrants » dans le fichier. Statut : À FAIRE (liste de contrôle à figer, pas de validation d'environnement au démarrage détectée).

### 3.3 Supabase production
| Point | Statut | Détail |
|---|---|---|
| Migrations | À FAIRE | 21 fichiers, ordre horodaté `20260101…` à `20260121000000_rebalance_reason.sql`; les deux dernières (`20260120000000_dispatch_unassign_unavail.sql`, `20260121000000_rebalance_reason.sql`) sont NON commitées (`git status`). Les appliquer dans l'ordre sur une base vierge et lancer `tests/rls` contre elle |
| RLS / FORCE RLS | OK sur le papier | 21 `enable` et 21 `force` comptés dans les migrations; table `routing_cache` : RLS forcée + revoke anon/authenticated. À refaire sur la vraie base : requête `pg_class.relrowsecurity/relforcerowsecurity` pour toutes les tables `public` |
| Clé service-role | RISQUE | utilisée dans `createAdminClient` (billing, création de membres, webhooks entrants, cron). Elle contourne RLS : à confiner côté serveur (`server-only` en place), jamais en variable `NEXT_PUBLIC_` |
| Sauvegardes | À FAIRE | non configuré (dépend du plan Supabase : PITR = plan Pro+). Prévoir test de restauration |
| Confirmation d'e-mail | À FAIRE | `supabase/config.toml` : `enable_confirmations = false` (l. 205 et 240). En production, l'inscription ne vérifie pas l'e-mail. Activer et tester le flux |
| SMTP transactionnel | À FAIRE | le bloc `[auth.email.smtp]` est commenté. Aucun fournisseur d'e-mail dans `package.json` ni dans `src`. Sans SMTP personnalisé, Supabase limite très fortement les envois |
| Invitations | RISQUE | il n'y a pas d'invitation par e-mail : l'administrateur crée directement le compte avec mot de passe (`createUser`, `email_confirm: true`, `members/actions.ts`) et doit transmettre le mot de passe hors bande |
| Mot de passe oublié | À FAIRE | aucune page ni action de réinitialisation dans `src/app/(auth)` (uniquement login/signup) |
| Notifications | RISQUE | uniquement in-app (cloche, polling 30 s); aucun e-mail (RDV, lead reçu, impayé) |
| Rate limits Auth / CAPTCHA | À FAIRE | `[auth.captcha]` commenté; pas de CAPTCHA sur signup/login |
| Rate limiting applicatif | RISQUE | `RateLimiter` utilise `MemoryStore` par défaut (`src/lib/rate-limit.ts:41`) : par instance. En serverless (Vercel) les compteurs sont perdus d'une invocation à l'autre; il faut implémenter `RateLimitStore` (Redis/Upstash) |
| URL de redirection | À FAIRE | `site_url` et `additional_redirect_urls` pointent sur 127.0.0.1 dans `config.toml`; configurer le vrai domaine dans le projet Supabase hébergé |

### 3.4 Sécurité HTTP et secrets
- OK : `next.config.ts` pose CSP stricte (script-src 'self' + 'unsafe-inline' + js.stripe.com, frame-ancestors 'none', object-src 'none', base-uri 'self'), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS preload en production.
- RISQUE mineur : `script-src 'unsafe-inline'` (inévitable sans nonce avec le rendu actuel) et `img-src https:` très large; `connect-src` reste sur `https://*.supabase.co` même si l'URL réelle est unique.
- OK : `.env*` ignoré par git (`.gitignore:34`), `.env.example` seul versionné. `.env.local` existe sur le poste : vérifier qu'aucun secret réel n'a fuité dans l'historique (un seul commit, voir 3.14).
- OK : secrets d'app Meta chiffrés (`INBOUND_SECRET_KEY`), secrets de webhook hachés, comparaison de signature (`signature.ts`).

### 3.5 Géocodage
- Code : fournisseurs BAN (`api-adresse.data.gouv.fr`) puis Nominatim (`src/lib/geo/geocode.ts`), mock interdit en production. Statut : OK pour la France.
- RISQUE : BAN n'a pas de SLA ni de clé; Nominatim public interdit l'usage intensif (limite codée à 1 req/s, mais la politique OSM demande un volume faible et un User-Agent identifiable : `GEOCODER_CONTACT` doit être une vraie adresse, la valeur par défaut est `admin@leadforge.local`). Prévoir un géocodeur commercial ou un Nominatim/Photon auto-hébergé si le volume croît; coûts non chiffrés dans le produit.
- Le plafonnement « France plausible » est codé en dur (`plausibleInFrance`) : produit mono-pays.

### 3.6 Routage (OSRM) et trafic
- RISQUE FORT : `docker-compose.routing.yml` lance OSRM en local sur 127.0.0.1:56500 avec des données Lyon uniquement (`data/routing/lyon.osrm*`, dossier non versionné/ignoré à vérifier). En production il faut un OSRM hébergé (VPS/conteneur avec extraction France ou régionale, plusieurs Go de RAM) ou un service tiers, et renseigner `ROUTING_URL`. Hors zone Lyon, les points ne sont pas routables.
- Sans `ROUTING_URL`, le repli est `estimate` (étiqueté, validation automatique refusée selon `.env.example`) : la répartition « automatique » ne l'est donc plus en production tant qu'OSRM n'est pas branché.
- Trafic : `TRAFFIC_PROVIDER=none` par défaut, TomTom/Mapbox optionnels via `TRAFFIC_API_KEY` (clé gratuite, quotas à vérifier). Non testé en réel.
- `routing_cache` est global, sans `org_id` (C-audit point 14, confirmé dans `20260117000000_dispatch_routing.sql:5-16`) : n'expose que des durées par paire de coordonnées arrondies; risque faible, à garder en tête pour une cohabitation de fournisseurs.

### 3.7 Tuiles de carte
RISQUE FORT : `NEXT_PUBLIC_MAP_TILE_URL` vide => tuiles publiques `tile.openstreetmap.org` (G-map-ui.md l. 4 et « Reste »). La politique d'usage OSM interdit l'usage en production à fort trafic. Choisir MapTiler/Stadia/Mapbox ou auto-hébergé, garder l'attribution « © OpenStreetMap contributors ». Variable `NEXT_PUBLIC_` donc figée au build.

### 3.8 Webhooks entrants Meta / Google
- Générique : OK (mappage JSON, dédoublonnage, signature, quotas, tests d'intégration).
- Meta Lead Ads : PARTIEL. L'adaptateur lit `entry[].changes[].value.field_data` (`src/lib/inbound/adapters.ts:82-104`) et gère la vérification GET `hub.challenge` ainsi que `X-Hub-Signature-256` avec le secret d'app (`handler.ts:95-139`). Mais la vraie notification Meta ne contient que `leadgen_id`; les champs du formulaire doivent être récupérés via l'API Graph avec un jeton de page. Aucun appel `graph.facebook.com` ni `leadgen_id` n'existe dans le code. Donc Meta natif ne fonctionne pas tel quel : il faut un intermédiaire (Zapier, Make, n8n) qui poste `field_data`, ou implémenter l'appel Graph. La FAQ « arrivent seuls grâce aux webhooks » est trompeuse tant que ce n'est pas fait.
- Google Ads : l'adaptateur correspond au format de webhook des extensions de formulaire (`user_column_data`, `google_key`), donc réellement possible, sous réserve d'un test avec Google.
- Pour Meta en production : app Meta en mode Live, vérification d'entreprise, permissions `leads_retrieval`/`pages_manage_ads` soumises à App Review (plusieurs semaines), politique de confidentialité publique valide, URL de suppression des données. Google : compte Ads et clé de webhook côté formulaire.

### 3.9 Juridique et RGPD
| Point | Statut | Détail |
|---|---|---|
| CGV, mentions légales, confidentialité | RISQUE | pages présentes mais remplies de champs à compléter : `[raison sociale]`, `[forme juridique]`, `[adresse]`, `[numéro]`, `[hébergeur]`, `[montant]`, `[nom]`, `[ville]` (`src/app/(marketing)/{cgv,mentions-legales,confidentialite}/page.tsx`). Publication impossible en l'état |
| CGU (conditions d'utilisation du service) | À FAIRE | seules les CGV existent; pas de page CGU distincte ni d'acceptation à l'inscription |
| Bannière cookies | OK probablement | la page annonce uniquement des cookies strictement nécessaires (session, thème) : pas de bannière requise tant qu'aucun traceur n'est ajouté. À reconfirmer si de l'analytique est ajoutée |
| DPA (accord de sous-traitance) | À FAIRE | LeadForge est sous-traitant des leads de ses clients : un DPA et la liste des sous-traitants ultérieurs (Supabase, Stripe, hébergeur, fournisseur géocodage/tuiles) sont nécessaires |
| Export / suppression des données | À FAIRE | aucune fonction d'export de leads ni de suppression de compte/organisation dans l'app (grep négatif). La FAQ promet « export et suppression sur demande » : procédure manuelle (SQL) à écrire et tester, idéalement en self-service |
| Registre / journaux | À FAIRE | durée de conservation des journaux webhooks et événements non définie dans le code (la page parle de `[durée]`); `src/lib/maintenance.ts` à vérifier |
| Hébergement UE | À FAIRE | choisir région Supabase UE et région du déploiement |

### 3.10 Observabilité
À FAIRE : aucun outil d'erreurs (pas de Sentry/équivalent dans `package.json`), pas de `error.tsx`, `global-error.tsx` ni `not-found.tsx` personnalisés dans `src/app`, pas de point de santé, pas de supervision de disponibilité. Les traces se limitent aux journaux de plateforme. La route cron `/api/cron/maintenance` n'a pas de planification (`vercel.json` absent) : à brancher sur un cron externe avec `CRON_SECRET`.

### 3.11 CI/CD et déploiement
- CI : À FAIRE. Aucun dossier `.github`, aucun workflow. Tests disponibles : `npm test` (vitest, unit/integration/rls, ceux de `rls` exigent un Supabase local), `npm run test:e2e` (Playwright), `typecheck`, `lint`. Rien n'est exécuté automatiquement. Dernier état rapporté : unit 344/344, e2e dispatch 7/7 (G-map-ui.md), non revérifié ici.
- Cible de déploiement : non définie. Aucune config Vercel ni Dockerfile. Next 15 s'y prête, mais attention : le rate-limiter en mémoire, le cache d'entitlement en mémoire (5 s) et `distDir` configurable (`NEXT_DIST_DIR`) sont pensés pour un process long ; en serverless le cache d'entitlement est inefficace mais inoffensif (relecture base à chaque appel).
- Domaine, DNS, délivrabilité (SPF/DKIM/DMARC) : À FAIRE, aucun e-mail sortant n'existe encore.

### 3.12 Performance
- RISQUE mineur : `src/components/marketing/lyon-map-data.ts` pèse 116 Ko (importé par la vitrine); le charger en import dynamique ou en SVG statique. Server actions autorisées à 12 Mo (`bodySizeLimit`) : à surveiller. Taille de build non mesurée (aucun `next build` lancé).
- Plafonds silencieux du moteur : 100 RDV en attente, 1000 existants, 500 indisponibilités (C-audit point 9) : un gros compte sera tronqué sans alerte.

### 3.13 Accessibilité et i18n
- Accessibilité : signaux positifs dans le code (`sr-only`, `aria-expanded`, `inert`, `prefers-reduced-motion`, tableau comparatif balisé `scope`). Aucun audit axe/Lighthouse exécuté : À FAIRE. Le thème clair de la carte n'est pas validé (G-map-ui.md « Reste »).
- i18n : France uniquement. Interface en français sans couche de traduction; fuseau Europe/Paris codé en dur dans le moteur TS et en SQL (C-audit point 13, `time.ts`), jours fériés non gérés (point 8), vérification « France plausible » des coordonnées, géocodeur BAN, OSRM Lyon. Les organisations hors France ne sont pas supportées. Cohérent avec la cible, mais à écrire explicitement dans les CGV.

### 3.14 Git
RISQUE : un seul commit (`dc8496c`), aucun remote configuré, 35 entrées de travail non commité dont les migrations 20260120 et 20260121, `src/components/dispatch/proposal.tsx`, `route-map.tsx`, `tests/e2e/buttons.spec.ts`, `multirole.spec.ts`, `playwright.btn-tmp.config.ts` (fichier temporaire à supprimer). Aucune sauvegarde distante du code. `test-results/`, `tsconfig.tsbuildinfo` et `data/routing` doivent être vérifiés dans `.gitignore` avant le premier push.

### 3.15 Points ouverts issus des rapports `docs/agents/dispatch/*.md`
| Origine | Point | Statut constaté |
|---|---|---|
| C-audit 5 | `apply_dispatch` accepte `p_allow_estimate` appelable directement par un porteur de `dispatch.manage` (contourne le refus d'estimation) | à vérifier dans `20260119000000_dispatch_fixes.sql` et `20260120…` (E-fixes dit avoir traité une partie des constats; je n'ai pas relu ce correctif) |
| C-audit 8 | jours fériés non gérés | ouvert (grep « feri/holiday » négatif au moment de l'audit) |
| C-audit 9 | troncatures silencieuses 100/1000/500 | ouvert |
| C-audit 10-11 | `report_address_fix` et `dispatcher_swap` sans contrôle de statut ni plausibilité en SQL | ouvert selon l'audit; E-fixes ne les liste pas comme traités dans les lignes relevées |
| C-audit 13 | fuseau Europe/Paris en dur | ouvert, assumé (E-fixes : « hors périmètre ») |
| C-audit 14 | `routing_cache` global sans org_id | ouvert, confirmé dans la migration (faible risque) |
| C-audit 2 | simulation écrit de vrais leads/RDV dans l'org réelle | traité par `is_simulation` (colonne présente dans `server.ts`), à revalider |
| G-map-ui | tuiles OSM publiques; thème clair non capturé; trajet en lignes droites (pas de géométrie OSRM) | ouvert |
| I-chrome | 5 défauts cosmétiques/UX non corrigés (erreurs de validation obsolètes, pas de retour visible après « Répartir automatiquement », pas de focus au renommage de source); 0 bug applicatif | ouvert, non bloquant |
| J-multirole | mise à jour « en direct » partielle (cloche seule, 30 s); bannière « Position corrigée » trompeuse quand la cause est une indisponibilité; lead reste « Nouveau » après confirmation du RDV (aucun passage auto à « RDV pris »); rééquilibrage jusqu'à +4 jours; « Ma tournée » limitée à aujourd'hui + 2 jours; Signé/Perdu définitifs même pour le super admin | ouvert; le dernier est un choix produit à valider avec un client |
| H-buttons, F-e2e, K | pas de point ouvert relevé par mes recherches; le rapport K n'existe pas dans `docs/agents/dispatch` (liste : A à J) | rapport K absent |

## 4. Verdict

### 4.1 Peut-on mettre en production aujourd'hui ? Non.
Le cœur fonctionnel (multi-tenant, RLS, rôles, leads, agenda, répartition, moteur de facturation) est solide et bien testé en local. Mais il manque les éléments qui rendent une vente sûre : pages légales vides, aucun e-mail (pas de reset de mot de passe, pas d'invitation), aucune CI ni dépôt distant, infrastructure de routage/tuiles non prête pour la production, et surtout des promesses de plan (dashboard, automatisations, rôles avancés, support prioritaire) qui ne sont pas appliquées ou pas construites. Facturer des clients sur ces promesses exposerait à un risque contractuel.

### 4.2 Bloquants (à corriger avant toute mise en ligne publique)
| # | Sujet | Effort |
|---|---|---|
| B1 | Compléter CGV, mentions légales, confidentialité; ajouter CGU et DPA; décider TTC/HT | M |
| B2 | Aligner l'offre et le code : soit appliquer le plan (garde serveur pour dashboard, automations/webhooks sortants, rôles avancés), soit retirer ces lignes du comparateur et des cartes; retirer ou construire « Support prioritaire » | M (appliquer) ou S (retirer) |
| B3 | E-mail transactionnel : SMTP/Resend, confirmation d'e-mail, réinitialisation de mot de passe, invitation de membres (aujourd'hui mot de passe transmis à la main) | M |
| B4 | Stripe live : prix, webhook, portail, TVA (Stripe Tax ou procédure), test de bout en bout en mode test réel puis live; trancher le double essai | M |
| B5 | OSRM hébergé couvrant la zone cible + tuiles commerciales; sans cela la répartition automatique n'est pas utilisable hors Lyon et enfreint la politique OSM | L |
| B6 | Projet Supabase de production : migrations 01 à 21 dans l'ordre, tests RLS contre lui, site_url/redirections, région UE, sauvegardes | M |
| B7 | Rate limiting partagé (Redis/Upstash) + `TRUSTED_PROXY` correct + CAPTCHA sur inscription | M |
| B8 | Git : commiter, ajouter un remote privé, vérifier l'historique et le `.gitignore` | S |
| B9 | Meta Lead Ads : implémenter la récupération Graph (`leadgen_id`) ou retirer la promesse de la FAQ/landing et documenter Zapier/Make | M (retirer: S ; construire + App Review: L) |

### 4.3 Importants (avant le premier client payant)
- CI GitHub Actions : lint, typecheck, vitest, Supabase local pour `tests/rls`, Playwright smoke (M).
- Observabilité : Sentry (ou équivalent), `error.tsx`/`global-error.tsx`/`not-found.tsx`, surveillance de disponibilité, planification du cron de maintenance (M).
- Export et suppression RGPD (self-service ou procédure testée) (M).
- Procédure de reprise d'un compte sans super admin (billing.manage) et protection du dernier super admin (S).
- Désactivation guidée des membres au downgrade de plan (S/M).
- Fournisseur de géocodage dimensionné et `GEOCODER_CONTACT` réel (S).
- Jours fériés FR et alerte sur les troncatures du moteur (C-audit 8-9), correctifs SQL des points 10-11 (M).
- Notifications par e-mail (RDV, lead reçu, impayé, fin d'essai) (M).
- Audit d'accessibilité réel (axe/Lighthouse) (S).

### 4.4 Souhaitable
- Import dynamique de `lyon-map-data.ts` (116 Ko) et mesure du build (S).
- Nonce CSP pour retirer `unsafe-inline` (M).
- Mise à jour « en direct » des pages Répartition/agenda (temps réel Supabase) (M).
- Passage automatique du lead à « RDV pris » après confirmation (choix produit) (S).
- Géométrie OSRM sur la carte au lieu de lignes droites; thème clair de la carte (S/M).
- Internationalisation et fuseau par organisation, si ouverture hors France (L).
- Corrections cosmétiques de I-chrome (S).

### 4.5 Plan ordonné
1. B8 (git + remote), puis CI minimale (sécurise tout le reste).
2. B2 et B9 : décider ce qui est vendu (retirer ce qui n'est pas prêt), appliquer les gardes de plan nécessaires.
3. B6 : projet Supabase de prod (UE), migrations, tests RLS, sauvegardes.
4. B3 : SMTP + confirmation + reset + invitations.
5. B4 : Stripe en mode test réel de bout en bout, puis live; trancher TVA et essai.
6. B7 : rate-limit partagé, CAPTCHA, `TRUSTED_PROXY`.
7. B5 : OSRM hébergé et tuiles commerciales (ou restreindre l'offre à Lyon et le dire).
8. B1 : textes juridiques complets, DPA, CGU (en parallèle dès le début, dépend d'un juriste).
9. Importants 4.3, puis déploiement beta fermée (quelques clients, plan Starter) avant ouverture publique.

Effort global estimé jusqu'à une bêta fermée vendable : environ 3 à 5 semaines pour un développeur, hors délai de validation Meta (App Review) et hors rédaction juridique.

## Annexe : méthode et limites
Lecture de : `src/lib/permissions.ts`, `src/lib/billing/*`, `src/components/marketing/plan-compare.tsx` et `faq-data.ts`, `next.config.ts`, `.env.example`, `supabase/config.toml`, migrations 20260101, 20260105, 20260115, 20260116, 20260117, `src/lib/inbound/*`, `src/lib/geo/*`, `src/lib/routing/*`, `src/app/(app)/layout.tsx`, pages légales et rapports `docs/agents/dispatch/*`. Non exécuté : build, tests, requêtes sur une base, appels Stripe/Meta/Google. Les points marqués « à vérifier » n'ont pas été confirmés dans le code.
