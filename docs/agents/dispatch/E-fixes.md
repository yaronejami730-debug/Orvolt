# E-fixes : correctifs de l'audit C (rapport vivant)

Source : docs/agents/dispatch/C-audit.md. Rien n'est commité. Migration unique : supabase/migrations/20260119000000_dispatch_fixes.sql (anciennes migrations intactes).
Légende : [v] fait et vérifié par des tests lancés.

## Etat : TERMINÉ (2026-10-25)
- [v] HAUT 1. Flux télépro -> « RDV à attribuer » : RPC create_pending_appointment (périmètre du lead, fenêtre >= demain et <= 31 j, durée 15-480, position en France, statut planned/unassigned, notifie les confirmateurs) + drapeau lf.pending_create dans appointments_before ; action createPendingAppointmentAction (agenda/actions.ts) ; UI : case « RDV à attribuer » dans AppointmentDialog pour les utilisateurs sans appointments.manage_all (Du/Au + durée, sans heure ni commercial).
- [v] HAUT 2. Simulation : is_simulation sur leads + appointments ; politiques RLS restrictives (invisible des clients), leads_api et dash_appt_counts* filtrés ; apply_dispatch : lot simulation/réel non mélangé, aucune notification, leads.assigned_to intact ; dispatch_notify ignore les leads simulés ; anti-chevauchement et charge journalière limités au même "monde" ; launch : un seul jeu à la fois ; clear : par is_simulation, renvoie le nombre de RDV simulés déjà attribués (affiché dans le toast) ; page Répartition : vue ?vue=simulation (lecture serveur), vue réelle sans simulation.
- [v] MOYEN 3. confirmPendingAction : .eq("status","planned").
- [v] MOYEN 4. guardClientPoint (src/lib/dispatch/point-guard.ts) : plausibleInFrance côté serveur, non-confirmateur : libellé re-géocodé, précision plafonnée à « commune » si le point n'est pas confirmé (fixLocationAction suggestion + création télépro).
- [v] MOYEN 5. apply_dispatch(p_org, p_items) : paramètre p_allow_estimate supprimé (un appel direct avec ce paramètre est rejeté).
- [v] MOYEN 6. Rejeu en base : fenêtre souhaitée, jour passé/aujourd'hui, jour férié, commune non acceptée, durée (demandée à +20 min).
- [v] MOYEN 7. Rééquilibrage : ancien commercial notifié (dedupe dispatch-moved:), ancien propriétaire du lead tracé (lead_events owner_changed) et prévenu.
- [v] MOYEN 8. Jours fériés FR : holidays.ts (moteur, raison « Jour férié ») + public.fr_easter / is_fr_holiday (base), parité testée 2024-2040.
- [v] MOYEN 9. Troncatures : truncation.ts, avertissements visibles dans la page et l'aperçu (MAX_PENDING 100, existants 1000, indisponibilités 500, totaux réels via count exact).
- [v] BAS 10. report_address_fix : position plausible en France + RDV planned/confirmed seulement.
- [v] BAS 11. dispatcher_swap : statut des deux RDV contrôlé (zone/horaires volontairement laissés au « dernier mot » du confirmateur).
- [v] BAS 12. Boucle admin b.geo morte supprimée (champ geo retiré de PlanBundle).

## Tests ajoutés
- tests/unit/dispatch-fixes.test.ts (15) : fériés (Pâques, 11 fériés, moteur), guardClientPoint, fenêtre/schéma télépro, troncatures.
- tests/rls/dispatch-fixes.test.ts (27) : flux télépro complet, refus, simulation (invisibilité, pas de notification, propriétaire intact, lot mixte, tableaux de bord, suppression par flag), p_allow_estimate, rejeu base, fériés SQL=TS, rééquilibrage, report_address_fix, swap.
- tests/rls/dispatch.test.ts : fenêtre souhaitée par défaut portée au 30 juin (le rejeu de fenêtre l'exige) ; reste inchangé.

## Vérifications (exécutées)
- supabase db reset (LeadForge local, 19 migrations) OK puis db:seed OK.
- npm run typecheck : OK. npm run lint : OK (0 erreur). npx vitest run : 47 fichiers, 809/809 (unit + rls + integration). Build NEXT_DIST_DIR=.next-build OK, dossier supprimé.

## Non fait / réserves
- e2e Playwright non relancés : tests/e2e/dispatch.spec.ts suppose l'ancien comportement (simulation visible partout, commerciaux notifiés) ; seule le nettoyage a été complété (suppression par is_simulation). À réviser avant de relancer.
- Routing_cache global (constat 13/14), fuseau en dur : hors périmètre demandé.
- Le télépro n'a pas de bouton dédié dans la page lead hors AppointmentDialog (la case est dans le même dialogue : agenda et onglet RDV du lead).
