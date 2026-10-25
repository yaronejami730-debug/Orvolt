# PLAN — LeadForge CRM (8 sprints)

Loop per sprint: Designer → Dev → QA1 → QA2 → fix (max 3 loops, then simplify + note).
Stack: Next 15, TS strict, Tailwind v4, Zod, TanStack Query, Supabase local, Stripe test, Vitest, Playwright.

## S0 — Fondations + design system
- Scaffold, deps, Supabase init, `.env.example`, scripts (`dev:all`)
- Designer: tokens, thème dark/light, composants UI de base, DESIGN.md
- Livrable: `npm run build` OK, page démo composants

## S1 — Auth + multi-tenant + rôles
- Migrations: organizations, memberships, roles(permissions jsonb), profiles
- RLS stricte toutes tables (helper `is_org_member`, `has_perm`)
- Signup + choix template métier + création org + rôles par défaut
- Tests isolation org A/B (Vitest vs Supabase local)
- Layout app (sidebar, org switch, thème)

## S2 — Templates, statuts, champs custom
- Tables: statuses, status_transitions, status_actions, custom_fields, lead_sources
- 5 templates (Énergies, Artisan BTP, Immobilier, Auto, Générique) appliqués à l'inscription
- UI settings: statuts (couleur, ordre, final gagné/perdu, transitions par rôle, actions auto), champs, rôles

## S3 — Leads: Kanban, tableau, fiche
- Tables: leads, lead_events, notes, calls, files (Storage)
- Kanban DnD (transitions validées serveur), tableau filtre/tri/pagination, fiche lead
- Moteur d'actions auto (assigner, notifier, tâche, webhook)

## S4 — Rendez-vous + distance
- Table appointments, zones commerciaux (adresse + rayon, lat/lng)
- Agenda par commercial, prise RDV depuis fiche, alerte distance (haversine, géocodage BAN/Nominatim avec cache)

## S5 — Import CSV + webhook entrant
- Import CSV avec mapping colonnes, validation Zod, rapport erreurs
- Webhook entrant par org (token, rate limit, mapping Meta/Google)

## S6 — Dashboard KPI
- Leads par statut, conversion, perf par utilisateur, par source, filtres période

## S7 — Stripe + landing + seed + finition
- Plans Starter/Pro/Business par nb utilisateurs, essai 14j, Checkout (Apple Pay), portail, webhook signé, gating
- Landing (hero, features, pricing, FAQ, CTA)
- Seed (2 orgs, 5 users, 200 leads, RDV), README, FINAL.md, passe e2e complète
