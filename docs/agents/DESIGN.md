# Identité visuelle LeadForge

Noir bleuté, gris froid, un seul bleu électrique. Sobre, beaucoup d'espace, peu de cartes, bordures fines.

## Couleurs (src/styles/tokens.css)
- Sombre (défaut, next-themes `defaultTheme="dark"`) : fond #05070D, surfaces #0B0F1A, bordures blanc 9 %, texte #F5F7FB, gris #8A93A6.
- Clair : fond #F4F6F9, surfaces blanches, texte #0B0F1A, gris #55607A, bordures #DBE0E9.
- Accent #2B59FF (bouton plein, texte blanc, contraste 6,5:1). Liens : `text-link` (#86A2FF sombre, #1F45D6 clair). Jamais de violet.
- Statuts : `success`, `warning`, `destructive` pour les fonds ; `*-text` pour le texte (contraste AA).
- Ne pas écrire `text-accent` : utiliser `text-link`.

## Typographie
Geist partout. Titres en gras (600 à 700) avec interlettrage serré (-0.03 à -0.05em). Titres alignés selon la section, jamais de mot isolé accentué, pas de petit label en capitales au-dessus d'un titre.

## Formes
Rayons : badges 5px, boutons et champs 8px, cartes 12px, cadre de maquette 18 à 22px. Bordures 1px. Pas de halo ni de dégradé décoratif dans l'app ; ombres seulement pour menus et dialogues.

## Signature de la landing
1. Fond de hero : nappes bleues floues qui dérivent (`.mk-fluid`, CSS pur, bleu uniquement).
2. Maquette produit dans un cadre arrondi : un lead passe de « Devis envoyé » à « Signé » (`product-demo.tsx`, boucle CSS 10 s). Sans animation, la maquette montre l'état final.
3. Phrase géante en deux tons (faits du produit, aucun chiffre client inventé).
4. Cartes à projecteur (`spotlight.tsx`) réservées au bloc fonctionnalités.

## Mouvement
Une entrée au chargement du hero (`.mk-rise`), la dérive du fond, la démo. Le reste répond à une action (ouverture, glisser, confirmation). `prefers-reduced-motion` coupe tout.

## Texte
Français simple, verbes d'action, sentence case. Pas de jargon marketing ni de « → ». Le bouton principal de la landing s'appelle « Essai gratuit 14 jours ».

## Origine des composants
Rien n'est copié de 21st.dev (code source non public, licences absentes). Effets réimplémentés : fond fluide, maquette animée, carte à projecteur.
