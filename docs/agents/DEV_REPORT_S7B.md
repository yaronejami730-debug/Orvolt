# DEV_REPORT S7b : landing, pricing, seed, README

## Fichiers
- Landing : src/app/(marketing)/{layout,page}.tsx, pricing/, mentions-legales/, confidentialite/, cgv/ ; src/components/marketing/* (hero, kanban-mockup animé, sections, pricing-section, faq accessible, header/footer, logo, json-ld) ; src/styles/marketing.css ; src/lib/{site,marketing-session}.ts ; src/app/{sitemap,robots,opengraph-image}.ts(x), icon.svg.
- Modifs partagées : src/lib/supabase/middleware.ts (routes publiques légales, sitemap, robots, OG), src/app/layout.tsx (metadataBase), next.config.ts (distDir via NEXT_DIST_DIR, CSP inchangée), .gitignore.
- Seed : scripts/db-seed.mjs (lanceur tsx) → scripts/db-seed.ts → scripts/seed/{data,seed}.ts. README.md (23 lignes), .env.example (section dev/seed/tests ajoutée).
- Tests : tests/e2e/landing.spec.ts (7), tests/unit/seed-data.test.ts (9), tests/rls/seed.test.ts (6).

## Commandes
- `npm run db:seed` (idempotent, service_role, refuse une base non locale sauf ALLOW_REMOTE_SEED=1). Aucun reset global effectué.
- typecheck, lint, build OK ; vitest seed 15/15 ; e2e landing 7/7 (lancés sur un serveur dédié, port 3100, NEXT_DIST_DIR séparé).

## Comptes démo (mot de passe `Demo1234!`)
admin.energies / prospecteur / confirmateur / commercial @demo.test (org Énergie Verte Démo, 120 leads) ; commercial aussi Commercial dans Artisans Dupont Démo (80 leads) ; admin.artisan@demo.test (Admin Artisans). 5 comptes, ~110 RDV dont 8 hors rayon avec dérogation, zones lat/lng, tâches, notifications.

## Points d'attention
- Pages légales provisoires (crochets à compléter) ; mention « conçu pour un hébergement UE » et tarifs affichés sans HT/TTC à confirmer avant prod.
- Le seed supprime puis recrée orgs « Énergie Verte Démo » / « Artisans Dupont Démo » et comptes @demo.test (ids changent à chaque run).
- Le seed écrit les statuts directement (service_role, triggers de transition non appliqués) et remplace les évènements auto par un historique daté.
- OG image générée par next/og (police par défaut). Mockup Kanban animé, désactivé si prefers-reduced-motion.
