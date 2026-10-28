# I-chrome : test physique dans Chrome réel (rapport vivant, groupé par rôle)

Instance : build `.next-btn2` sur :3101 (supprimé en fin de travail), stripe-mock :12111, Chrome réel, onglet dédié. Mot de passe de démo du README, connexion par le formulaire. Enregistrements jetables préfixés « ZZ » (tous supprimés ; organisations remises en essai).

## Notes d'environnement
- Les cookies localhost sont partagés avec le :3000 de l'utilisateur : une session a expiré en cours de test (Server Action « unexpected response » = redirection vers /login). Reconnexion par formulaire OK. Non imputable à l'app.
- `read_network_requests` affiche 503 sur les POST de Server Actions alors qu'elles réussissent : artefact de l'outil.
- `NEXT_PUBLIC_APP_URL` est figé au build : l'URL de webhook entrant affichée pointe vers :3000 (normal).
- Aucune page « super-admin » dédiée n'existe (le rôle « Super administrateur » n'ajoute aucune route) : rien à tester de plus.
- Non cliqués (téléchargement de fichier, interdit sans accord) : « Télécharger un modèle CSV », « Télécharger le rapport d'erreurs (CSV) » dans l'import.
- Un confirm() natif sur « Passer à Pro » a gelé l'onglet (override oublié après navigation) : comportement du harnais, pas de l'app (le message est « Passer au plan Pro ? Facturation annuelle, changement proratisé. »).

## 1. CEO = admin.energies@demo.test (super administrateur)
Pages atteintes : dashboard, leads, agenda, répartition, tâches, import, paramètres (Statuts, Champs, Sources, Facturation, Intégrations, Webhooks, Membres, Rôles & permissions).

| Page | Élément | Résultat |
|---|---|---|
| Statuts | Ajouter un statut (nom vide -> « Nom requis », couleurs, types), créer | OK |
| Statuts | Panneau : onglets Général / Transitions / Actions, Enregistrer, cases transitions (auto) | OK |
| Statuts | Actions auto : + Assigner / Notifier / Tâche / Webhook, interrupteur, supprimer, Tester webhook vide, validation, Enregistrer les actions | OK (cosmétique : erreur « Choisissez un utilisateur ou un rôle » reste affichée après suppression de l'action fautive) |
| Statuts | Monter / Descendre / Supprimer (Annuler, croix, Supprimer) ; matrice des droits + Enregistrer (modifié puis rétabli) | OK |
| Champs | Nouveau champ : 6 types, Obligatoire, visibilité par rôle, options (ajout/suppr, choix multiple), « Au moins 2 options », Enregistrer | OK (cosmétique : « Nom requis » reste après saisie) |
| Champs | Monter / Descendre / Modifier / Supprimer (Annuler, Masquer, Supprimer) | OK |
| Sources | Ajouter (vide -> erreur, Entrée), Renommer (valider/annuler), Archiver / Désarchiver, Supprimer | OK (cosmétique : renommage sans focus automatique) |
| Facturation | Mensuel / Annuel (prix 99 / 790 / 1990 €), Souscrire (3 plans) -> session Checkout stripe-mock, redirection | OK |
| Facturation (org Artisans, webhooks signés) | Souscrit -> Starter actif ; « Passer à Pro » (confirm, « Changement de plan demandé ») ; Pro actif après webhook ; « Gérer l'abonnement » -> portail stripe-mock | OK (la page ne se rafraîchit pas seule après le webhook hors retour Checkout : rechargement nécessaire) |
| Intégrations | Créer un webhook (2 boutons, nom vide, 3 types, source), Copier le secret, Copier l'URL, Actif, mappage + Enregistrer, Envoyer un test (lead créé, supprimé ensuite), Régénérer le secret, Supprimer | OK |
| Webhooks | Voir / masquer le secret, Copier, Régénérer | OK |
| Membres | Ajouter un membre (validations, création), changement de rôle, Zone (adresse, rayon, interrupteur, géocodage mock), Horaires (jours, norme, enregistrer), Désactiver / Réactiver, Réglages de la répartition | OK |
| Rôles | Nouveau rôle (validation nom, cases), Modifier (système et perso), Supprimer, Échap ferme | OK (cosmétique : « Nom trop court » reste après correction) |
| Cloche | Ouverture (marque lu), liste scrollable | OK (éléments non cliquables : aucun lien vers le lead, choix d'UX) |
| Thème / menu / déconnexion | Basculer clair/sombre, menu utilisateur, Se déconnecter -> /login, route protégée redirige | OK |
| Connexion | Mauvais mot de passe -> « E-mail ou mot de passe incorrect », bon -> dashboard | OK |
| Import | Choisir fichier (CSV 4 lignes), auto-mappage, champs obligatoires par défaut (Continuer désactivé tant que vides), Retour, options (source, assignation, doublons, détection), Valider (simulation : 3 à créer / 1 erreur « E-mail invalide »), modification d'option invalide la simulation, Lancer l'import (3 créés), Nouvel import, Voir les leads | OK |
| Tâches | Cocher / décocher | OK |
| Dashboard | 7/30/90 jours, Ce mois, Personnalisée, filtres source / utilisateur | OK |
| Répartition | Réglages de la répartition (ouvre, Enregistrer), Lancer une simulation, Répartir automatiquement, Détails (routage), puces de jour, Tous les jours, épingles carte, zoom +/-, liens Google Maps / Waze (href, `_blank`, noopener), Corriger (4 onglets : GPS, Autre adresse, Saisie manuelle, Pin sur carte), Valider ce pin, Rééquilibrer, Annuler, Valider (le rééquilibrage), Verrouiller, Modifier (commercial, Enregistrer et verrouiller, Échanger, Retirer de la tournée), Indisponibilités (ajout avec/sans journée entière, validation date, suppression), Supprimer la simulation, Retour aux RDV réels | OK |

Bugs / UX CEO
- UX (non corrigé) : « Répartir automatiquement » ne donne aucun retour visible en haut de page ; la proposition apparaît plus bas, sans défilement automatique.
- Cosmétique (non corrigé) : erreurs de validation obsolètes (statuts-actions, champs, rôles) ; pas de focus automatique au renommage d'une source.

## 2. Pauline Roche = commercial@demo.test (Commercial, 2 organisations)
Menu : Dashboard (3 cartes Mes leads / Mon agenda / Mes tâches), Leads, Agenda, Tâches. Sélecteur d'organisation visible.

| Page | Élément | Résultat |
|---|---|---|
| Organisation | Changer vers Artisans Dupont et retour | OK |
| Leads | Tableau : uniquement ses leads (assignés ou créés par elle : 38 sur 80, conforme à la RLS), pas de « Nouveau lead », barre groupée sans Supprimer | OK |
| Fiche lead | Onglets Historique/Notes/Appels/RDV/Fichiers, ajouter / modifier (annuler) / supprimer une note | OK |
| Agenda | Ma tournée : Ouvrir l'itinéraire, Waze (href), Signaler un problème (validation « Message trop court », envoi, badge « Problème signalé »), Ma zone (enregistrer), Semaine / Jour / Mois / Liste, précédent / suivant / Aujourd'hui, Nouveau RDV | OK |
| Tâches | Cocher une tâche | OK |
| Cloche / thème / menu | Ouverture, bascule, déconnexion | OK |
| URLs directes interdites | /settings, /settings/{billing,members,roles,statuses,fields,sources,integrations,webhooks}, /import, /agenda/repartition | « Accès refusé », 0 bouton rendu : OK |
| Actions serveur | Revue du code : members, roles, billing, import, leads, repartition utilisent des gardes de permission (`sessionCan` / `guard` / `guardAny`) | OK (non éprouvé par requête forgée) |

## 3. Karim Benali = commercial2@demo.test (Commercial)
| Page | Élément | Résultat |
|---|---|---|
| Agenda | Vide (pas de « Ma tournée »), Semaine / Jour / Mois / Liste, Ma zone (25 km, Vénissieux), Nouveau RDV (commercial verrouillé sur lui-même) | OK |
| Leads | Aucun lead, pas de « Nouveau lead » ; fiche d'un lead de Pauline en URL directe -> « Lead introuvable » | OK |
| Tâches | État vide | OK |
| Cloche / thème / déconnexion | Notifications visibles, bascule, menu | OK |
| URLs directes interdites | Mêmes 9 URLs que Pauline | « Accès refusé » : OK |

## Bilan
- Éléments testés (boutons, liens, bascules, sélecteurs, onglets, menus) : environ 190 sur les trois rôles.
- Bugs applicatifs réels trouvés : 0. Défauts cosmétiques / UX : 5 (listés ci-dessus), non corrigés.
- Écarts de permission (masqué en interface mais appelable) : aucun constaté.
- typecheck : 1 erreur dans `tests/e2e/multirole.spec.ts` (fichier de l'agent H, ligne 286, indice `'conf'`), hors périmètre ; lint : 0 avertissement.
