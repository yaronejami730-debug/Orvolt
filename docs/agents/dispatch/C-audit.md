# C-audit (lecture seule) — 2026-10-25

## Etat : TERMINE (audit statique complet des fichiers demandes)
Commandes: `npx vitest run tests/unit` -> 21 fichiers, 329/329 OK. `npm run typecheck` -> OK (aucune erreur).
Non fait: aucun test RLS lance (Supabase interdit), aucun serveur.

## Constats (par gravite)
### HAUT
1. Aucun chemin de production ne cree de RDV `dispatch_status='unassigned'` (telepro -> a confirmer). grep wish_from/dispatch_status dans src: seuls repartition/*, dispatch lib, my-tour. `agenda/actions.ts:152-153` insere avec assigned_to obligatoire; le trigger `appointments_before` (20260117:~170 et 20260116:196-199) interdit assigned_to null aux telepros (forbidden_assignee). Seule la simulation (repartition/actions.ts:411-418) fabrique des RDV a attribuer. Le flux telepro -> confirmateur -> moteur n'est donc pas branche. Correctif: action/RPC de creation "RDV a attribuer" (wish_from/wish_to/duration_min, status planned) pour manage_own + autorisation dans le trigger.
2. Simulation non inoffensive: repartition/actions.ts:372-425 cree de vrais leads/RDV `confirmed` dans l'org reelle; un "Valider" ensuite ecrit de vraies attributions, notifie les vrais commerciaux (apply_dispatch norm4:131-136) et ecrase `leads.assigned_to` (norm4:126). clearSimulationAction (l.432) supprime par `company='[SIMULATION]'` : peut supprimer un vrai lead portant ce nom, et retire silencieusement les RDV deja attribues de l'agenda des commerciaux (cascade, sans notification). Lancer 2x cree 10 leads de plus (limite 50 seulement). Correctif: marqueur is_simulation dedie, exclusion de apply/notifications, ou org bac a sable.
### MOYEN
3. confirmPendingAction (actions.ts:183): `.eq("dispatch_status","unassigned")` sans `.eq("status","planned")` : un RDV annule non attribue peut etre "confirme" et rentrer dans la repartition (loadContext filtre planned/confirmed: server.ts:92). Correctif: restreindre a status='planned'.
4. fixLocationAction mode "suggestion" (actions.ts:270,301): lat/lng/precision viennent du client sans plausibleInFrance ni controle de coherence ; un telepro peut poser precision "housenumber" avec n'importe quelles coordonnees pour son RDV et contourner assessPoint/"a verifier". Correctif: revalider cote serveur (re-geocoder le label ou plafonner la precision a municipality pour non-dispatcher).
5. apply_dispatch (norm4:13) accepte `p_allow_estimate` en parametre appelable directement par tout porteur de dispatch.manage (grant 20260117:360) : contourne le refus "estimation" de applyDispatchAction (actions.ts:110). Correctif: retirer le parametre du grant (fonction interne) ou ignorer l'appel client.
6. Rejeu base incomplet: apply_dispatch ne verifie ni fenetre de souhait (wish_from/to), ni creneau dans le passe (le moteur commence a demain: server.ts:118, mais pas la base), ni precision GPS/geo_accepted, ni duree vs duration_min (seulement 0<d<=12h : norm4:63). Un appel RPC direct peut donc poser un RDV hors souhait ou aujourd'hui/hier. Correctif: ajouter ces controles dans la fonction.
7. Reequilibrage: l'ancien commercial n'est pas notifie du retrait (norm4:131-136 ne notifie que le nouveau, contrairement a dispatcher_edit/unassign) ; `leads.assigned_to` ecrase le proprietaire initial (norm4:126).
8. Jours feries non geres (grep feri/holiday: aucun resultat dans src/supabase). work_days seul + sales_unavailability manuelle. Un RDV peut etre place un 1er mai/25 dec. Correctif: table/liste de feries FR cote moteur ET base (ou indispos auto).
9. Troncatures silencieuses: MAX_PENDING=100 (server.ts:86), existing limit 1000 (l.137), unavailability limit 500 (l.146) sans alerte; indispo tronquee => proposition rejetee a l'apply (dispatch_unavailable), pas de corruption.
### BAS
10. report_address_fix (20260117:~503) : le commercial peut mettre n'importe quelles lat/lng (plausibilite France seulement dans l'action TS, actions.ts:341) et ce, meme sur un RDV annule/verrouille ; marque needs_rebalance.
11. dispatcher_swap (20260117:~395) ne controle pas le statut (annule/termine) ni la zone/horaires ; dispatcher_edit_appointment accepte un RDV `planned` non confirme (contourne la confirmation) et ne valide ni horaires ni zone (voulu: "dernier mot", mais verrouille a vie).
12. actions.ts:116-119 : boucle admin `b.geo` morte (geo jamais alimente dans buildPlan).
13. Fuseau code en dur Europe/Paris (time.ts:1, SQL tz constant): ok France, orgs hors FR non supportees. DST: zonedToUtc (time.ts:38-48) converge sur heures ouvrables ; heure inexistante (02:30 changement) non verifiee/non pertinente aux horaires 08-20.
14. routing_cache global sans org_id (20260117:5-12): partage entre orgs, n'expose que durees par paire de coordonnees arrondies; lu par route_leg sans verifier le fournisseur (un `fake` e2e en cache serait cru) ; protege en prod par configuredRouting.

## Solide (verifie dans le code)
- Isolation org: apply_dispatch exige auth + has_perm(p_org,'dispatch.manage') (norm4:34-35), toutes les requetes filtrent org_id=p_org ; RPC dispatcher_* derivent l'org de la ligne ; SECURITY DEFINER avec `set search_path = public` partout ; revoke/grant explicites ; routing_cache force RLS + revoke ; tests RLS couvrent autre org (dispatch.test.ts:91-98).
- Atomicite: fonction plpgsql unique (tout ou rien, test l.143), advisory lock par org (norm4:39), `for update` sur le RDV, idempotence (deja pose identique -> skipped, norm4:59 ; test l.108) et double clic couvert par planHash "stale" (actions.ts:107).
- Rejeu base: membre actif, zone active, rayon, route reelle, heures, jour, indispo, charge confort/max + approbation "fifth", temps de trajet voisins, chevauchement (exclusion gist qui ignore les annules).
- Journal: trigger appointments_after -> lead_events (dispatched/unassigned/updated/locked/issue) ; notifications par commercial ; fixLocation journalise.
- Cle trafic: TRAFFIC_API_KEY lue cote serveur (traffic-service.ts:1,14-17), module `server-only`, pas de NEXT_PUBLIC, absente de PreviewData ; safeFetch anti-SSRF + quota. Cle dans l'URL de requete (traffic.ts:47) : ne pas journaliser l'URL (aucun console dans traffic.ts).
- RDV annules/commerciaux inactifs: exclus du chargement (server.ts:92,104,137) et rejetes en base (invalid_rep/no_zone/status).

## Non verifie
Tests RLS/e2e non executes ; comportement UI double clic (bouton desactive?) ; limitation de debit de guardAny ; migrations ulterieures eventuelles qui redefiniraient apply_dispatch ; engine.ts (modifie en parallele par A) non audite.
