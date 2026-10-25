# LeadForge CRM

CRM de leads multi-entreprises (Next 15, Tailwind v4, Supabase, Stripe) avec modèles métier (énergies, BTP, immobilier, auto).

**Prérequis** : Node 20+, Docker, Supabase CLI, Stripe CLI (facultatif : sans clé de test, Stripe est simulé par stripe-mock).

**Installation** : `npm install`, puis `npm run dev:all` (démarre Supabase, génère `.env.local` (modèle : `.env.example`), lance Next et `stripe listen` si configuré), puis `npm run db:seed` pour les données de démo.
**Réinitialiser la base** : `npm run db:reset [-- --seed]` (reset Supabase, redémarre le conteneur storage du projet puis attend sa santé, seed optionnel ; `--dry-run` pour voir les étapes). Ne pas utiliser `supabase db reset` seul (uploads en erreur 42P10).

**Ports** : app 3000 · API Supabase 56321 · Postgres 56322 · Studio 56323 · e-mails de test 56324 · stripe-mock 12111 · OSRM 56500.

**Répartition automatique** (menu Répartition, confirmateur / admin / super admin) : `npm run routing:setup` (télécharge ~510 Mo Geofabrik Rhône-Alpes, découpe Lyon–Grenoble, ~620 Mo sur disque) puis `npm run routing:up` ; sans OSRM, repli étiqueté « estimation » (aperçu seulement). `ROUTING_PROVIDER=fake` pour tests sans réseau. Règle de charge par défaut : norme 4 RDV/jour, 5e seulement si le détour est faible, 6e jamais automatique (réglable dans Réglages > Membres). Trafic optionnel : `TRAFFIC_PROVIDER` + `TRAFFIC_API_KEY` (voir `.env.example`).

**Comptes de démo** (mot de passe commun `Demo1234!`, idempotent : `npm run db:seed` recrée les données) :

| E-mail | Rôle | Organisation |
|---|---|---|
| admin.energies@demo.test | Super administrateur | Énergie Verte Démo |
| administrateur@demo.test | Administrateur | Énergie Verte Démo |
| prospecteur@demo.test | Prospecteur | Énergie Verte Démo |
| confirmateur@demo.test | Confirmateur | Énergie Verte Démo |
| commercial@demo.test | Commercial (Pauline Roche, Lyon, 09h-19h) | Énergie Verte Démo et Artisans Dupont Démo |
| commercial2@demo.test | Commercial (Karim Benali, Vénissieux, 10h-20h) | Énergie Verte Démo |
| admin.artisan@demo.test | Super administrateur | Artisans Dupont Démo |

**Tests** : `npm test` (Vitest, Supabase local requis) · `npm run test:e2e` (Playwright, build + start) · `npm run typecheck` · `npm run lint`.

Bilan et points de vigilance : [docs/agents/FINAL.md](docs/agents/FINAL.md).
