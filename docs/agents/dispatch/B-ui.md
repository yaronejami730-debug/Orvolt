# B-ui
## 2026-10-25 13:39 démarrage
- Lu: DISPATCH_STATUS, page.tsx, dispatch-panel.tsx.
- Cause 7/10 (lecture code): dispatch-panel.tsx `confirmed = pending.filter(status==confirmed && !checkIds.has(id))` : les RDV "à vérifier" (GPS absent/approx/hors route) sont retirés du compteur et de la liste, affichés seulement dans la carte "À vérifier". Rien de perdu, mais l'en-tête ne le dit pas.
- En cours: mesure avant (scripts/dispatch-screenshots.mjs), puis correctifs.
## 2026-10-25 13:41 TERMINÉ
- Fichier touché: src/components/dispatch/dispatch-panel.tsx (seul).
- Fait: (2) ligne "N à répartir · M à vérifier (T RDV confirmés au total)" sous le titre (data-testid=pending-split), état vide distinct si 0 prêt mais M à vérifier, toast simulation reformulé. (1) grid Proposal: grid-cols-1 + minmax(0,1fr) + min-w-0 sur les 2 colonnes (défensif).
- Mesure 390 px: la liste d'arrêts <ol.mt-2> fait 290 px (right=340) ; le "ol right=406" du script est le <ol data-sonner-toaster> (Toaster sonner, fixed, left 16 + width 390), src/components/ui/toaster.tsx : HORS périmètre, aucun scroll horizontal (scrollWidth=clientWidth).
- Vérif: npm run typecheck OK ; npm run lint 0 erreur (1 warning tests/unit/dispatch-fill.test.ts, pas à moi) ; dispatch-screenshots.mjs OK contre :3000 (200).
- Non fait: e2e non relancés; tests/e2e non modifié (aucun libellé testé changé: grep vide).
