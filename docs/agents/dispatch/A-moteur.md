# A-moteur
## 2026-10-25 FINI
- Diagnostic : la pénalité de charge LOAD_PENALTY était appliquée sur la charge cumulée absolue (6/RDV) ; après 4 RDV (24) elle approchait OPEN_DAY_PENALTY (25), donc le moteur ouvrait un nouveau jour au lieu de remplir. Repro (Pauline+Karim, 4/5/6) : 10 RDV = 4+4+1+1 ; 12 = 4+4+1+3 ; avec norme 3 : 3+2+... 
- Correctif engine.ts : OPEN_DAY_PENALTY 25 -> 60 ; charge RELATIVE au moins chargé des candidats (pickBest). Après : 10 = 4+4+2 ; 12 = 4+4+4 ; 14 = 4+4+4+2 ; 8 = 4+4.
- Tests : tests/unit/dispatch-fill.test.ts (nouveau, 9 tests). Fichiers touchés : src/lib/dispatch/engine.ts, tests/unit/dispatch-fill.test.ts.
- Sorties : vitest tests/unit 21 fichiers / 329 tests OK ; typecheck OK ; lint 0 erreur.
