# GoCardless (manage.gocardless.com) — le point complet sur le design

Relevé le 28 oct. 2026 depuis Safari, sur 7 pages : Paiements, Accueil (racine), Clients finaux,
Versements, Modèles d'abonnement, Développeurs, Paramètres société. Captures dans `reference/`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `gocardless.css` | Le CSS propre à réutiliser : tokens (`--gc-*`) + composants (`.gc-btn`, `.gc-table`, `.gc-card`, …). |
| `demo.html` | Réplique statique de Paiements + Accueil avec données factices. Ouvrir en local. |
| `gocardless-raw.css` | Dump brut dédupliqué des 1 954 règles du site (Emotion). Référence, pas à utiliser tel quel. |
| `custom-properties.txt` | Les 296 variables CSS internes du design system GoCardless (« flux ») avec leurs valeurs. |

## 1. Fondations

**Police** : `Haffer` (propriétaire, Displaay) en 400 / 500 / 600, fallback Helvetica Neue.
Corps 16px / 22px. Les URLs des fichiers `.otf` du CDN GoCardless sont dans `gocardless.css`.
Attention : police sous licence, pas libre de droits. Inter est l'équivalent le plus proche.

**Couleurs** (toutes vérifiées dans les styles calculés) :

| Token | Valeur | Usage |
|---|---|---|
| encre | `#0F1521` | texte, sidebar, bouton primaire |
| surface | `#F9FAFB` | fond de page, texte sur sombre |
| blanc | `#FFFFFF` | cartes, inputs |
| gris 100 / 200 / 300 | `#F3F4F6` / `#E5E7EB` / `#D1D5DB` | fond recherche / bordures / bord panneau |
| gris 500 / 700 | `#6B7280` / `#374151` | en-têtes tableau / texte secondaire |
| jaune | `#FFE500` (hover `#FFF281`) | CTA sidebar uniquement |
| succès | `#007A4D` sur `#DBF2DD` | tag Versé, Actif, Payé |
| danger | `#C82828` sur `#FEE2E2` | tag Échoué, frais |
| info | `#2A67BF` sur `#DBEAFE` | tag Beta |
| lavande | `#EAE8F9` | bannière « Nouveau » |
| violet | `#5949CB` | carte promo Success+ |

Alphas sur l'encre : 0.04 (hover ligne), 0.08 (hover bouton texte, nav actif sur blanc), 0.38 (désactivé).
Sur blanc dans la sidebar : 0.05 (bloc mollie), 0.08 (item actif), 0.125 (hover, séparateur).

**Échelle typographique** :

| Rôle | Taille / interligne / graisse |
|---|---|
| Titre de page (h1) | 28 / 34 / 600 |
| Section (h2) | 20 / 28 / 600 (24 / 32 sur Développeurs) |
| Titre carte avec icône | 18 / 24 / 700 |
| Titre carte stat | 16 / 22 / 700 |
| Gros montant | 36 / 44 / 600, décimales 24 / 32 |
| Montant carte | 28 / 34 / 600, décimales 18 / 24 |
| Texte UI, nav, boutons, tableau | 14 / 20 (tableau 14 / 22) |
| Tags, méta | 12 / 14 et 12 / 16 |

**Rayons** : 6 (tags), 8 (inputs, items nav), 16 (cartes, bannière, tooltip), 24 (bouton icône), 32 (boutons, pilules), 48 (bouton Filtrer).
**Ombres** : quasi aucune. Tooltip `0 1px 4px rgba(0,0,0,.1)`, panneau droit `0 2px 12px rgba(30,26,20,.1)`.
Les bordures de boutons sont des `box-shadow: inset 0 0 0 1px`, pas des `border`.
**Focus** : double anneau `0 0 0 1px #F9FAFB, 0 0 0 4px #0F1521`.
**Transitions** : 0.1s (boutons), 0.15s (nav), 0.2s (recherche, tooltip), 0.3s cubic-bezier(.5,0,0,1) (panneau).

## 2. Squelette (identique sur toutes les pages)

- **Sidebar** 240px, fixe, fond encre, padding horizontal 16. Logo 28px (cercle jaune) à 40px du haut,
  sélecteur de compte 38px, puis items nav 208 × 36, padding 8, radius 8, 14px.
  Item actif : fond blanc 8 %, graisse 600. Sous-items : padding-left 36. Séparateur 1px blanc 12,5 %, marge 16px 8px.
  CTA jaune « Créer le paiement » 36px, radius 32. En bas : lien « Donnez-nous votre avis » + bloc « a mollie company »
  (44px, fond blanc 5 %, texte `#93918C`).
- **Header** 55px, fixe, fond surface, padding 0 48px, trait 1px gris 200 en bas.
  À droite : pilule recherche 213 × 38 (fond gris 100, bordure gris 200, placeholder 14px graisse 300, raccourci « / »),
  puis deux boutons icône 38px (cloche, roue).
- **Main** : marge-top 55, padding 24px 64px 96px, largeur max 1528. Le coin bas-gauche du contenu est arrondi 24px.
  Pages « formulaire » (Paramètres) : colonne centrée de 568px, sections séparées par un trait 1px avec marge 48px.
- **Panneau latéral droit** (détail d'une ligne) : 380px, blanc, bord gauche gris 300, glisse depuis la droite.

## 3. Composants

- **Boutons** (tous 36px, radius 32, 14/20/600, padding 8px 20px, grille avec gap 8 pour l'icône) :
  primaire = encre sur surface ; jaune = sidebar seulement ; secondaire = contour 1px encre ; texte = transparent, hover gris 8 %.
  Hover du primaire : texte souligné, fond inchangé. Désactivé : fond encre 8 %, texte encre 38 %.
  Boutons icône : 36px radius 24 (36 avec contour pour le kebab) ou 46px radius 30 (pagination).
- **Tags** : inline-grid, 12/14/600, padding 3px 8px, radius 6. Variante « Nouveau » : blanc sur encre, 14/16, padding 4px 8px.
- **Tableau** : 14px ; th padding 16, graisse 400, gris 500, pas de bordure ; lignes 55px, trait 1px gris 200 en bas,
  hover encre 4 % ; cellule = lien avec padding 16 ; colonne statut fixée à 180px ; montants à droite, « Net » en 600,
  frais en rouge. Barre au-dessus : « Filtrer (n résultats) » à gauche, « Importer / Exporter » à droite, tout en 14/600 + icône 12px.
  Pagination : « Éléments par page » + select 82 × 38, flèches 46px désactivées en encre 38 %.
- **Champs** : fond blanc, radius 8, contour inset 1px gris 500 (encre au hover, 2px au focus), hauteur 38 (54 pour le select large).
  Recherche de liste : pilule grise 340 × 36 avec loupe.
- **Onglets-pilules** (Clients, Modèles) : 36px, radius 48, contour gris 200, actif = contour encre, compteur dans une puce grise 16px.
- **Cartes** : blanc, bordure 1px gris 200, radius 16, padding 24 (stats) ou 32px 24px (cartes d'action) ou 32 (cartes info).
  Grille 3 colonnes, gap 24 ou 32. Titre + icône dans un carré encre 28px. Lien bas de carte 14/600 souligné.
  Carte cliquable (Développeurs) : hover = contour inset 2px encre.
- **Bannière** lavande (Clients) : radius 16, padding 24, tag « Nouveau », bouton secondaire + lien, croix 36px en haut à droite.
- **Graphique** (Accueil) : Recharts, grille pointillée gris 200, ligne rose-violet, axes 12px gris 500.

## 4. Ce qui n'est pas repris

- Aucune logique (navigation, données, états réels). Le `demo.html` bascule entre deux vues en pur affichage.
- Le logo GoCardless et les illustrations des cartes « Besoin d'aide » (remplacés par un cercle jaune et des zones vides).
- Les icônes exactes (redessinées en SVG simple, 16px, trait 1,3).
- La police Haffer n'est pas copiée dans le dossier (licence) : le CSS pointe sur le CDN de GoCardless.
