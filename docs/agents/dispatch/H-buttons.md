# H-buttons : test systématique de tous les boutons (rapport vivant)

## Périmètre (mis à jour)
Deux agents se partagent le travail.
- **H (moi, Playwright, instance :3100, build `.next-btn`)** : landing, tarifs (intervalle, comparatif, thème, FAQ), inscription, connexion, dashboard, leads (kanban / tableau / détail / nouveau), agenda (semaine / jour / mois / liste, nouveau RDV dont « RDV à attribuer »), plus les contrôles de permissions par rôle. Seul à lancer `npm run db:seed` en fin de travail, et les suites complètes vitest / Playwright.
- **I-chrome (Chrome réel, :3101)** : réglages (tous onglets), cloche de notifications, menu utilisateur / déconnexion, super-admin, assistant d'import, tâches, `/agenda/repartition`. Travaille uniquement sur des enregistrements jetables.

Config temporaire : `playwright.btn-tmp.config.ts` (port 3100), à supprimer en fin de travail avec `.next-btn`.

## Journal
- Build `.next-btn` : premier essai en échec, non lié à mes fichiers : `dispatch-panel.tsx` (agent G en cours de réécriture) importe `DispatchMap` qui n'existe plus dans `dispatch-map.tsx`. À retenter plus tard, pas touché.

## Tableau
| Page | Rôle | Élément | Résultat |
|---|---|---|---|
| / | anon | nav « Fonctionnalités » | OK /#fonctionnalites |
| / | anon | nav « Comment ça marche » | OK /#comment-ca-marche |
| / | anon | nav « Tarifs » | OK /pricing |
| / | anon | nav « FAQ » | OK /#faq |
| / | anon | ancres #fonctionnalites/#comment-ca-marche/#faq existent | OK |
| / | anon | Bouton thème | OK __variable_b3532f __variable_de43f5 darkundefined -> __variable_b3532f __variable_de43f5 lightundefined |
| / | anon | Connexion (header) | OK |
| / | anon | Essai gratuit (header) | OK |
| / | anon | FAQ accordéons | OK 6 accordéons ouvrent/ferment |
| / | anon | tous les liens internes (statut HTTP) | OK 10 liens ok (/ /#fonctionnalites /#comment-ca-marche /pricing /#faq /login /signup /mentions-legales /confidentialite /cgv) |
| / | anon | liens externes/mailto/# | OK #contenu |
| / | anon | bascule Mensuel/Annuel de la landing | OK (le clic sur l'option déjà active est sans effet, normal) |
| /pricing | anon | toggle mensuel/annuel | OK Mensuel:true:90 €,79 €,199 €,90 €,79 €,199 € / Annuel:true:99 €,25 €,790 €,83 €,990 €,83 €,99 €,790 €,990 € |
| /pricing | anon | Comparer les plans (ouvrir/fermer) | OK table=1 |
| /pricing | anon | CTA de chaque plan + comparatif | OK 7 CTA signup 7 ok; Essai gratuit 14 jours→/signup ; Essai gratuit 14 jours→/signup ; Essai gratuit 14 jours→/signup ; Essai gratuit→/signup ; Essai gratuit→/signup ; Essai gratuit→/signup ; Essai gratuit 14 jours→/signup |
| /pricing | anon | FAQ pricing + liens footer/header | OK / /#fonctionnalites /#comment-ca-marche /pricing /#faq /login /signup /mentions-legales /confidentialite /cgv |
| /cgv | anon | page charge | OK |
| /confidentialite | anon | page charge | OK |
| /mentions-legales | anon | page charge | OK |
| /xyz-inexistant | anon | chemin inconnu | OK : redirige vers /login (middleware), la 404 FR s'affiche une fois connecté |
| /leads/xyz | anon | accès anonyme app → /login | OK /login |
| /dashboard /agenda /settings | anon | redirigent vers login | OK 6 ok |
| /login | anon | mauvais mot de passe | OK message: E-mail ou mot de passe incorrect./ |
| /login | anon | email invalide / champs vides (validation) | OK validation native: Please fill out this field. |
| /login | anon | liens (mot de passe oublié / inscription) | OK Créer mon espace→/signup (pas de lien mot de passe oublié) |
| /login | anon | afficher mot de passe / se souvenir | OK ["","Se connecter"]["Passer au thème sombre"] |
| /signup | anon | soumission vide (validation) | OK url /signup invalid=4 |
| /signup | anon | mot de passe court (<8) | OK invalid=1 |
| /signup | anon | email déjà utilisé (serveur) | OK message: Inscription impossible avec ces informations. Si vous avez déjà un compte, connectez-vous./ |
| /signup | anon | sélecteur de métier (radio) | OK template-energie=true |
| / (note) | anon | « Mensuel » (bouton déjà actif au chargement) | OK (pas de bug : clic sur l'option déjà sélectionnée) |
| /xyz-inexistant | anon | page 404 | OBSERVATION : un chemin inconnu non connecté redirige vers /login (middleware), pas de 404 visible ; à vérifier connecté |
| /login | anon | lien « Mot de passe oublié » | OBSERVATION : n'existe pas (fonctionnalité absente, aucun lien mort) |
| /signup | anon | inscription réelle (template énergie) | OK arrivé sur /onboarding |
| /dashboard | nouvel admin ZZ | page charge (org neuve, énergie) | OK 200 /dashboard / LeadForge ZZ-H2-1792951011747 Dashboard Leads Agenda Répartition Tâches Import Paramètres ZH Essai g |
| /leads | nouvel admin ZZ | page charge (org neuve, énergie) | OK 200 /leads?view=kanban / LeadForge ZZ-H2-1792951011747 Dashboard Leads Agenda Répartition Tâches Import Paramètres ZH Essai g |
| /agenda | nouvel admin ZZ | page charge (org neuve, énergie) | OK 200 /agenda / LeadForge ZZ-H2-1792951011747 Dashboard Leads Agenda Répartition Tâches Import Paramètres ZH Essai g |
| /settings/billing | nouvel admin ZZ | page charge (org neuve, énergie) | OK 200 /settings/billing / LeadForge ZZ-H2-1792951011747 Dashboard Leads Agenda Répartition Tâches Import Paramètres ZH Essai g |
| /xyz-inexistant | nouvel admin ZZ | page charge (org neuve, énergie) | OK 404 /xyz-inexistant / 404 This page could not be found. |
| /leads | nouvel admin ZZ | statuts du template énergie présents | OK Leads Suivez vos leads du premier contact à la signature. Filtres Kanban Tableau Nouveau lead Aucun lead Créez votre premier lead ou importez un fichier CSV. Cr |
| /leads | nouvel admin ZZ | Nouveau lead (création) | OK l-first,l-last,l-company,l-phone,l-email,l-value,l-address,l-postal,l-city,l-source,l-assigned,l-status,cf-type_chauffage,cf-surface_m2,cf-facture_energie,cf-statut_occupant,cf-dpe,cf-adresse_chantier |
| /signup | anon | inscription réelle org ZZ-H2-<ts>, template énergie → /onboarding, dashboard/leads/agenda/billing chargent, Nouveau lead affiche les champs énergie | OK |
| /xyz-inexistant | admin connecté | page 404 | FIXED : affichait « This page could not be found. » en anglais ; ajout de src/app/not-found.tsx en français (effectif au prochain build) |
| /agenda | administrateur | bouton « Ma zone » : nom accessible « Zone de <nom> » ne contenait pas le texte visible (WCAG label-in-name) | FIXED : zone-editor.tsx, aria-label = « Ma zone (zone de <nom>) » (compatible avec tests/e2e/agenda.spec.ts) |
| (méthode) | tous | « alertes » comptées par mon script = annonceur de routes Next (#__next-route-announcer__), faux positifs : les « BUG alert » de dashboard/agenda dans mes premiers essais sont RETIRÉS (non-bugs) | OK |
| /leads | administrateur | Nouveau lead : sans champs obligatoires du template énergie (type de chauffage, surface, occupant) le dialogue reste ouvert avec messages « … est obligatoire. » | OK (comportement voulu ; mon premier essai l'avait pris à tort pour un échec) |
| /dashboard | administrateur | boutons Période (tous) | OK 7 jours:true 30 jours:true 90 jours:true Ce mois:true Personnalisée:true |
| /dashboard | administrateur | période personnalisée (dates + erreur si fin<début) | OK erreur inversée: La date de fin précède la date de début.; valide -> alertes 0 |
| /dashboard | administrateur | filtre source (chaque option) | OK 9 options, aucune erreur 0 |
| /dashboard | administrateur | filtre équipe/utilisateur | OK 7 options, alertes 0 |
| /dashboard | administrateur | liens barres/KPI (premier lien /leads?) | OK /leads?view=table&from=2026-10-10&to=2026-10-20&statuses=b03f5c9b-70d7-4db1-ba31-82e83fd6527e -> ok |
| /dashboard | administrateur | tri tableau (boutons d'en-tête) | OK 7 en-têtes triables |
| /leads | administrateur | onglets Kanban/Tableau | OK |
| /leads | administrateur | recherche | OK 121 leads -> Aucun résultat |
| /leads | administrateur | panneau Filtres (statut/source/assigné chips, Tout effacer) | OK 22 puces; total 121 leads -> 18 leads -> 121 leads |
| /leads | administrateur | filtre dates Créé à partir du / jusqu'au | OK |
| /leads | administrateur | tableau: colonnes, pagination, lignes/page, sélection | OK menu cols 6, page suivante ok, barre groupée 1, suppr=1 assigner=1 statut=1 |
| /leads | administrateur | Nouveau lead (dialogue, validation, création) | OK validation vide: Indiquez au moins un nom ou une société.; créé visible=true |
| /leads | administrateur | ajout rapide (+ dans colonne) | OK refus attendu (champs obligatoires du template): Type de chauffage est obligatoire.
Plus de champs/Lead créé. |
| /leads | administrateur | kanban: déplacer via menu flèche | OK col-Nouveau -> col-À qualifier (6 cibles) |
| /leads | administrateur | kanban: glisser-déposer (avant) | OK col-À qualifier -> col-Qualifié |
| /leads/[id] | administrateur | ouverture fiche | OK /leads/24c23586-33e3-4f8e-a631-89164cdefa59 |
| /leads/[id] | administrateur | statut (select, chaque transition) | OK → RDV pris persisté=true |
| /leads/[id] | administrateur | assignation (select Assigné à) | OK → Sophie Bernard persisté=true (7 options) |
| /leads/[id] | administrateur | modification inline d'un champ | OK Modifier Prénom |
| /leads/[id] | administrateur | onglet Notes: ajouter / modifier / supprimer | OK édition=true suppression=true |
| /leads/[id] | administrateur | onglet Appels: journaliser un appel | OK |
| /leads/[id] | administrateur | onglet Historique | OK 8 entrées |
| /leads/[id] | administrateur | onglet Fichiers (UI) | OK bouton upload 1 |
| /leads/[id] | administrateur | onglet RDV + création RDV depuis la fiche | OK dialogue ouvert; case « RDV à attribuer » absente |
| /leads/[id] | administrateur | RDV: créer un RDV (créneau futur) | OK bouton Planifier désactivé: Sophie Bernard n'a pas de zone d'intervention : distance non vérifiée. Définir une zone (conflit/rayon ?) |
| /agenda | administrateur | Précédent / Aujourd'hui / Suivant | OK Lun. 19 Oct. – Dim. 25 Oct. / Lun. 26 Oct. – Dim. 1 Nov. / Lun. 12 Oct. – Dim. 18 Oct. / Lun. 19 Oct. – Dim. 25 Oct. |
| /agenda | administrateur | vue Semaine | OK  events=7 items=0 |
| /agenda | administrateur | vue Jour | OK  events=0 items=0 |
| /agenda | administrateur | vue Mois | OK  events=0 items=0 |
| /agenda | administrateur | vue Liste | OK  events=0 items=11 |
| /agenda | administrateur | vue Mois: clic sur un jour → vue Jour | OK |
| /agenda | administrateur | puces commerciaux (filtrer) | OK 7 puces |
| /agenda | administrateur | clic sur un RDV → détail | OK PR Pauline Roche 5 rue du Président Wilson, 69200 Vénissieux Réalisé Dans la zone · 8.7 km / boutons: Modifier,Annuler, |
| /agenda | administrateur | Nouveau RDV (dialogue): validation, case « à attribuer », fermeture | OK toggle à-attribuer=0 (attendu 0 ou 1), submit désactivé sans lead=true, sélecteur commercial=1 [Sophie Bernard/Camille Girard/Karim Benali/Julien Moreau/Hélène Marchand/Pauline Roche], fermeture=true |
| /agenda | administrateur | cellule vide cliquable → dialogue pré-rempli | OK (vérifié à la main : dialogue ouvert, date du créneau 2026-10-20 pré-remplie) |
| /agenda | administrateur | bouton Répartition | OK lien=2 |
| /leads | administrateur | kanban : glisser-déposer | OK ; reculer une carte (ex. Qualifié → Nouveau) affiche le toast « Transition non autorisée pour votre rôle » (règle métier, pas un bug) |
| /dashboard | prospecteur | pas de stats, 3 raccourcis (Mes leads/Mon agenda/Mes tâches) | OK /leads,/agenda,/tasks |
| /dashboard | prospecteur | raccourci /leads | OK |
| /dashboard | prospecteur | raccourci /agenda | OK |
| /dashboard | prospecteur | raccourci /tasks | OK |
| /leads | prospecteur | onglets Kanban/Tableau | OK |
| /leads | prospecteur | recherche | OK 70 leads -> Aucun résultat |
| /leads | prospecteur | panneau Filtres (statut/source/assigné chips, Tout effacer) | OK 22 puces; total 70 leads -> 15 leads -> 70 leads |
| /leads | prospecteur | filtre dates Créé à partir du / jusqu'au | OK |
| /leads | prospecteur | tableau: colonnes, pagination, lignes/page, sélection | OK menu cols 6, page suivante ok, barre groupée 1, suppr=0 assigner=1 statut=1 |
| /leads | prospecteur | Nouveau lead (dialogue, validation, création) | OK validation vide: Indiquez au moins un nom ou une société.; créé visible=true |
| /leads | prospecteur | ajout rapide (+ dans colonne) | OK refus attendu (champs obligatoires du template): Type de chauffage est obligatoire.
Plus de champs/Lead créé. |
| /leads | prospecteur | kanban: déplacer via menu flèche | OK col-Nouveau -> col-À qualifier (6 cibles) |
| /leads | prospecteur | kanban: glisser-déposer (avant) | OK col-À qualifier -> col-À qualifier (refus affiché: Transition non autorisée pour votre rôle : À qualifier → Qualifié.) |
| /leads/[id] | prospecteur | ouverture fiche | OK /leads/3cf016fd-c41d-4411-b9aa-bd0fd9ddcac3 |
| /leads/[id] | prospecteur | assignation (select Assigné à) | OK → Sophie Bernard persisté=true (7 options) |
| /leads/[id] | prospecteur | modification inline d'un champ | OK Modifier Prénom |
| /leads/[id] | prospecteur | onglet Notes: ajouter / modifier / supprimer | OK édition=true suppression=true |
| /leads/[id] | prospecteur | onglet Appels: journaliser un appel | OK |
| /leads/[id] | prospecteur | onglet Historique | OK 6 entrées |
| /leads/[id] | prospecteur | onglet Fichiers (UI) | OK bouton upload 1 |
| /leads/[id] | prospecteur | onglet RDV + création RDV depuis la fiche | OK dialogue ouvert; case « RDV à attribuer » présente |
| /leads/[id] | prospecteur | RDV: créer un RDV (créneau futur) | OK RDV à attribuer: demande envoyée |
| /agenda | prospecteur | Précédent / Aujourd'hui / Suivant | OK Lun. 19 Oct. – Dim. 25 Oct. / Lun. 26 Oct. – Dim. 1 Nov. / Lun. 12 Oct. – Dim. 18 Oct. / Lun. 19 Oct. – Dim. 25 Oct. |
| /agenda | prospecteur | vue Semaine | OK  events=0 items=0 |
| /agenda | prospecteur | vue Jour | OK  events=0 items=0 |
| /agenda | prospecteur | vue Mois | OK  events=0 items=0 |
| /agenda | prospecteur | vue Mois: clic sur un jour → vue Jour | OK |
| /agenda | prospecteur | puces commerciaux (filtrer) | OK pas de puces (attendu: ses propres RDV) |
| /agenda | prospecteur | clic sur un RDV → détail | OK aucun RDV dans la liste (vide) |
| /agenda | prospecteur | Nouveau RDV (dialogue): validation, case « à attribuer », fermeture | OK toggle à-attribuer=1 (attendu 1), submit désactivé sans lead=true, sélecteur commercial=1 [Julien Moreau], fermeture=true |
| /agenda | prospecteur | cellule vide cliquable → dialogue pré-rempli | OK date 2026-10-06 |
| /agenda | prospecteur | bouton Répartition | OK lien=0 |

| /leads/[id] | prospecteur | select Statut | OK (aucune transition possible depuis « À qualifier » pour ce rôle : options grisées, règle métier) |
| /agenda | prospecteur | vue Liste vide | OK (état vide sans liste, pas d'erreur) |
| /dashboard | confirmateur | boutons Période (tous) | OK 7 jours:true 30 jours:true 90 jours:true Ce mois:true Personnalisée:true |
| /dashboard | confirmateur | période personnalisée (dates + erreur si fin<début) | OK erreur inversée: La date de fin précède la date de début.; valide -> alertes 0 |
| /dashboard | confirmateur | filtre source (chaque option) | OK 9 options, aucune erreur 0 |
| /dashboard | confirmateur | filtre équipe/utilisateur | OK 7 options, alertes 0 |
| /dashboard | confirmateur | liens barres/KPI (premier lien /leads?) | OK /leads?view=table&from=2026-10-10&to=2026-10-20&statuses=b03f5c9b-70d7-4db1-ba31-82e83fd6527e -> ok |
| /dashboard | confirmateur | tri tableau (boutons d'en-tête) | OK 7 en-têtes triables |
| /leads | confirmateur | onglets Kanban/Tableau | OK |
| /leads | confirmateur | recherche | OK 123 leads -> Aucun résultat |
| /leads | confirmateur | panneau Filtres (statut/source/assigné chips, Tout effacer) | OK 22 puces; total 123 leads -> 18 leads -> 123 leads |
| /leads | confirmateur | filtre dates Créé à partir du / jusqu'au | OK |
| /leads | confirmateur | tableau: colonnes, pagination, lignes/page, sélection | OK menu cols 6, page suivante ok, barre groupée 1, suppr=0 assigner=1 statut=1 |
| /leads | confirmateur | Nouveau lead (dialogue, validation, création) | OK validation vide: Indiquez au moins un nom ou une société.; créé visible=true |
| /leads | confirmateur | ajout rapide (+ dans colonne) | OK refus attendu (champs obligatoires du template): Type de chauffage est obligatoire.
Plus de champs/Lead créé. |
| /leads | confirmateur | kanban: déplacer via menu flèche | OK col-Nouveau -> col-À qualifier (6 cibles) |
| /leads | confirmateur | kanban: glisser-déposer (avant) | OK col-À qualifier -> col-Qualifié |
| /leads/[id] | confirmateur | ouverture fiche | OK /leads/a8d730c9-3d62-4583-ba82-e5a532fc28be |
| /leads/[id] | confirmateur | statut (select, chaque transition) | OK → RDV pris persisté=true |
| /leads/[id] | confirmateur | assignation (select Assigné à) | OK → Sophie Bernard persisté=true (7 options) |
| /leads/[id] | confirmateur | modification inline d'un champ | OK Modifier Prénom |
| /leads/[id] | confirmateur | onglet Notes: ajouter / modifier / supprimer | OK édition=true suppression=true |
| /leads/[id] | confirmateur | onglet Appels: journaliser un appel | OK |
| /leads/[id] | confirmateur | onglet Historique | OK 8 entrées |
| /leads/[id] | confirmateur | onglet Fichiers (UI) | OK bouton upload 1 |
| /leads/[id] | confirmateur | onglet RDV + création RDV depuis la fiche | OK dialogue ouvert; case « RDV à attribuer » absente |
| /leads/[id] | confirmateur | RDV: créer un RDV (créneau futur) | OK bouton Planifier désactivé: Sophie Bernard n'a pas de zone d'intervention : distance non vérifiée. Définir une zone (conflit/rayon ?) |
| /agenda | confirmateur | Précédent / Aujourd'hui / Suivant | OK Lun. 19 Oct. – Dim. 25 Oct. / Lun. 26 Oct. – Dim. 1 Nov. / Lun. 12 Oct. – Dim. 18 Oct. / Lun. 19 Oct. – Dim. 25 Oct. |
| /agenda | confirmateur | vue Semaine | OK  events=7 items=0 |
| /agenda | confirmateur | vue Jour | OK  events=0 items=0 |
| /agenda | confirmateur | vue Mois | OK  events=0 items=0 |
| /agenda | confirmateur | vue Liste | OK  events=0 items=11 |
| /agenda | confirmateur | vue Mois: clic sur un jour → vue Jour | OK |
| /agenda | confirmateur | puces commerciaux (filtrer) | OK 7 puces |
| /agenda | confirmateur | clic sur un RDV → détail | OK PR Pauline Roche 5 rue du Président Wilson, 69200 Vénissieux Réalisé Dans la zone · 8.7 km / boutons: Modifier,Annuler, |
| /agenda | confirmateur | Nouveau RDV (dialogue): validation, case « à attribuer », fermeture | OK toggle à-attribuer=0 (attendu 0 ou 1), submit désactivé sans lead=true, sélecteur commercial=1 [Sophie Bernard/Camille Girard/Karim Benali/Julien Moreau/Hélène Marchand/Pauline Roche], fermeture=true |
| /agenda | confirmateur | cellule vide cliquable → dialogue pré-rempli | OK date ? |
| /agenda | confirmateur | bouton Répartition | OK lien=2 |
| (général) | confirmateur | erreur console React #418 intermittente | OBSERVATION (voir ligne ci-dessus, non reproduite) |
| (menu) | administrateur | entrées de navigation visibles | OK LeadForge,Dashboard,Leads,Agenda,Répartition,Tâches,Import,Paramètres |
| /dashboard | administrateur | accès direct autorisé | OK Dashboard Bienvenue Camille Girard — Énergie Verte Démo 7 jo |
| /settings/statuses | administrateur | accès direct autorisé | OK Paramètres Équipe, rôles et configuration de votre organisat |
| /settings/fields | administrateur | accès direct autorisé | OK Paramètres Équipe, rôles et configuration de votre organisat |
| /settings/sources | administrateur | accès direct autorisé | OK Paramètres Équipe, rôles et configuration de votre organisat |
| /settings/integrations | administrateur | accès direct autorisé | OK Paramètres Équipe, rôles et configuration de votre organisat |
| /settings/webhooks | administrateur | accès direct autorisé | OK Paramètres Équipe, rôles et configuration de votre organisat |
| /settings/members | administrateur | accès direct autorisé | OK Paramètres Équipe, rôles et configuration de votre organisat |
| /settings/roles | administrateur | accès direct autorisé | OK Paramètres Équipe, rôles et configuration de votre organisat |
| /import | administrateur | accès direct autorisé | OK Import Importez vos leads depuis un fichier CSV : mappage, s |
| /agenda/repartition | administrateur | accès direct autorisé | OK Répartition automatique Le moteur propose, vous décidez : le |
| /tasks | administrateur | accès direct autorisé | OK Mes tâches Les tâches qui vous sont assignées. Préparer la v |
| /settings/billing | administrateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/billing 200 |
| API (RLS) | administrateur | droits serveur via jeton utilisateur (REST Supabase) | OK leads visibles=0-0/124 ; DELETE lead (id factice) 403/obj ; PATCH statuses 200/0 ; PATCH roles 200/0 ; PATCH memberships 200/0 |
| (menu) | prospecteur | entrées de navigation | OK : Dashboard (raccourcis), Leads, Agenda, Tâches, Import ; pas de Répartition ni Paramètres |
| /leads | prospecteur | accès direct autorisé | OK Leads Suivez vos leads du premier contact à la signature. Fi |
| /agenda | prospecteur | accès direct autorisé | OK Agenda Vos rendez-vous, avec contrôle de la distance à votre |
| /tasks | prospecteur | accès direct autorisé | OK Mes tâches Les tâches qui vous sont assignées. Aucune tâche  |
| /import | prospecteur | accès direct autorisé | OK Import Importez vos leads depuis un fichier CSV : mappage, s |
| /dashboard-stats | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /dashboard-stats 404 |
| /settings/statuses | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/statuses 200 |
| /settings/fields | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/fields 200 |
| /settings/sources | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/sources 200 |
| /settings/billing | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/billing 200 |
| /settings/integrations | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/integrations 200 |
| /settings/webhooks | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/webhooks 200 |
| /settings/members | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/members 200 |
| /settings/roles | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/roles 200 |
| /agenda/repartition | prospecteur | accès direct INTERDIT (doit refuser) | OK refusé -> /agenda/repartition 200 |
| API (RLS) | prospecteur | droits serveur via jeton utilisateur (REST Supabase) | OK leads visibles=0-0/71 ; DELETE lead (id factice) 403/obj ; PATCH statuses 200/0 ; PATCH roles 200/0 ; PATCH memberships 200/0 |
| (menu) | confirmateur | entrées de navigation visibles | OK LeadForge,Dashboard,Leads,Agenda,Répartition,Tâches |
| /dashboard | confirmateur | accès direct autorisé | OK Dashboard Bienvenue Sophie Bernard — Énergie Verte Démo 7 jo |
| /leads | confirmateur | accès direct autorisé | OK Leads Suivez vos leads du premier contact à la signature. Fi |
| /agenda | confirmateur | accès direct autorisé | OK Agenda Vos rendez-vous, avec contrôle de la distance à votre |
| /agenda/repartition | confirmateur | accès direct autorisé | OK Répartition automatique Le moteur propose, vous décidez : le |
| /tasks | confirmateur | accès direct autorisé | OK Mes tâches Les tâches qui vous sont assignées. Préparer la v |
| /settings/statuses | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/statuses 200 |
| /settings/fields | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/fields 200 |
| /settings/sources | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/sources 200 |
| /settings/billing | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/billing 200 |
| /settings/integrations | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/integrations 200 |
| /settings/webhooks | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/webhooks 200 |
| /settings/members | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/members 200 |
| /settings/roles | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /settings/roles 200 |
| /import | confirmateur | accès direct INTERDIT (doit refuser) | OK refusé -> /import 200 |
| API (RLS) | confirmateur | droits serveur via jeton utilisateur (REST Supabase) | OK leads visibles=0-0/124 ; DELETE lead (id factice) 403/obj ; PATCH statuses 200/0 ; PATCH roles 200/0 ; PATCH memberships 200/0 |
| pages refusées | administrateur | rendu de la page interdite (message, pas de contenu) | OK /settings/billing -> /settings/billing : Paramètres Équipe, rôles et configuration de votre organisation. Statuts Champs Sources Intégrations Membres R // /settings/members -> /settings/members : Paramètres Équipe, rôles et configuration de votre organisation. Statuts Champs Sources Intégrations Membres R // /import -> /import : Import Importez vos leads depuis un fichier CSV : mappage, simulation, puis import par lots. 1 Fichier 2 Mappa // /agenda/repartition -> /agenda/repartition : Répartition automatique Le moteur propose, vous décidez : les RDV confirmés sont attribués selon la zone, les  |
| API (RLS) | administrateur | écritures réelles refusées par la base (jeton utilisateur) | OK PATCH statuses(Nouveau) 200 1 ligne(s) ; PATCH roles(Commercial) 200 1 ligne(s) ; PATCH memberships 200 5 ligne(s) ; PATCH organizations 200 0 ligne(s) ; PATCH sources 200 1 ligne(s) ; DELETE leads ZZ (test) 403 permission denied for table leads |
| pages refusées | prospecteur | rendu de la page interdite (message, pas de contenu) | OK /settings/billing -> /settings/billing : Paramètres Équipe, rôles et configuration de votre organisation. Accès refusé Vous n'avez pas les permissions  // /settings/members -> /settings/members : Paramètres Équipe, rôles et configuration de votre organisation. Accès refusé Vous n'avez pas les permissions  // /import -> /import : Import Importez vos leads depuis un fichier CSV : mappage, simulation, puis import par lots. 1 Fichier 2 Mappa // /agenda/repartition -> /agenda/repartition : Accès refusé Vous n'avez pas les permissions nécessaires pour consulter cette page. |
| API (RLS) | prospecteur | écritures réelles refusées par la base (jeton utilisateur) | OK PATCH statuses(Nouveau) 200 0 ligne(s) ; PATCH roles(Commercial) 200 0 ligne(s) ; PATCH memberships 200 0 ligne(s) ; PATCH organizations 200 0 ligne(s) ; PATCH sources 200 0 ligne(s) ; DELETE leads ZZ (test) 403 permission denied for table leads |
| pages refusées | confirmateur | rendu de la page interdite (message, pas de contenu) | OK /settings/billing -> /settings/billing : Paramètres Équipe, rôles et configuration de votre organisation. Accès refusé Vous n'avez pas les permissions  // /settings/members -> /settings/members : Paramètres Équipe, rôles et configuration de votre organisation. Accès refusé Vous n'avez pas les permissions  // /import -> /import : Accès refusé Vous n'avez pas les permissions nécessaires pour consulter cette page. // /agenda/repartition -> /agenda/repartition : Répartition automatique Le moteur propose, vous décidez : les RDV confirmés sont attribués selon la zone, les  |
| API (RLS) | confirmateur | écritures réelles refusées par la base (jeton utilisateur) | OK PATCH statuses(Nouveau) 200 0 ligne(s) ; PATCH roles(Commercial) 200 0 ligne(s) ; PATCH memberships 200 0 ligne(s) ; PATCH organizations 200 0 ligne(s) ; PATCH sources 200 0 ligne(s) ; DELETE leads ZZ (test) 403 permission denied for table leads |
| (permissions) | administrateur | menu : Dashboard, Leads, Agenda, Répartition, Tâches, Import, Paramètres (pas de Facturation) ; /settings/billing par URL | OK : « Accès refusé » rendu dans la page (200, aucun contenu de facturation) ; autres /settings/* accessibles |
| (permissions) | prospecteur | menu : Dashboard (raccourcis seulement), Leads, Agenda, Tâches, Import ; URL directes /settings/* (8 pages), /agenda/repartition | OK : « Accès refusé – Vous n'avez pas les permissions nécessaires » ; /import accessible (droit leads.import) |
| (permissions) | confirmateur | menu : Dashboard, Leads, Agenda, Répartition, Tâches ; URL directes /settings/*, /import | OK : Accès refusé ; /agenda/repartition accessible |
| API/RLS | prospecteur + confirmateur | PATCH réels via jeton utilisateur sur statuses, roles, memberships, organizations, lead_sources | OK : 0 ligne modifiée (RLS), alors que l'administrateur modifie 1/1/5/0/1 lignes ; organizations = 0 pour tous |
| API/RLS | les 3 rôles | DELETE direct sur la table leads | OK : 403 « permission denied for table leads » (suppression uniquement via action serveur contrôlée) ; boutons Supprimer absents de l'UI pour prospecteur/confirmateur, présents pour administrateur |
| /leads | prospecteur | tableau : barre d'actions groupées sans « Supprimer » ; Nouveau lead, Import, RDV à attribuer disponibles ; statut limité par transitions | OK |
| (général) | confirmateur | erreur console intermittente « Minified React error #418 » (hydratation) une fois pendant le parcours leads/agenda | OBSERVATION : non reproduite en 3 rechargements de chaque page (dashboard, fiche, agenda, tableau), cause probable texte dépendant de l'heure ; non corrigée |


## Bilan H2
FIXED : 404 en anglais (src/app/not-found.tsx FR, vérifié après rebuild), nom accessible du bouton « Ma zone » (zone-editor.tsx, vérifié). OBSERVATIONS : pas de lien « mot de passe oublié », erreur React #418 intermittente non reproduite, limiteur de connexion 10 essais / 15 min par e-mail (en mémoire) déclenché par les tests répétés. Nettoyage : org ZZ-H2 + utilisateur supprimés, leads ZZ supprimés, lead démo « Arthur Girard » remis en « Nouveau », .next-btn et config temporaire supprimés.
