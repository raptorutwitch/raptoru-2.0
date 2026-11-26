# Mesure en jeu Chaos — 2026-11-25T14:39:36.148Z

Jeu : Overwatch.exe. Analyse corrigée (apps/chaos-engine/tools/mesure-jeu.mjs, docs/chaos/BENCH_EFFETS.md § 8).

## Qualité des données

- Images PresentMon : 13447 ; retenues : 12266.
- Jeu hors du premier plan (exclu de 1,5 s avant la perte du focus à 1 s après son retour) : 2 période(s), 25,4 s.
- Marge après chaque changement d'état du calque : 300 ms (relevés de Studio toutes les 250 ms).
- Horloges : apparition/disparition du calque ↔ changement de mode du jeu : apparu -119 ms, disparu -72 ms, apparu -34 ms, disparu -189 ms, apparu -152 ms, disparu -120 ms, apparu -204 ms, disparu -9 ms, apparu -135 ms, disparu -129 ms, apparu -266 ms, disparu -135 ms.
- Rafraîchissement retenu : 16,68 ms. GPU du jeu : PresentMon (MsGPUBusy).

## Par condition

| Condition                                   | Durée utile (s) | FPS  | 1 % bas | Image p50 / p95 / p99 (ms) | ≥ 2 rafraîch. | Affichage hors grille (dont grille autre écran) | Composed | SyncInterval 1 | GPU jeu (ms/img) |
| ------------------------------------------- | --------------- | ---- | ------- | -------------------------- | ------------- | ----------------------------------------------- | -------- | -------------- | ---------------- |
| A/B · aucun effet                           | 144,3           | 57,4 | 25,5    | 17,2 / 18,7 / 19,9         | 17 (0,2 %)    | 19 % (0 %)                                      | 0 %      | 0 %            | 9,5              |
| A/B · diag.watermark                        | 49,0            | 27,8 | 1,4     | 17,5 / 83,3 / 266,5        | 516 (37,9 %)  | 68 % (35 %)                                     | 99 %     | 99 %           | 4,8              |
| A/B · mirror                                | 50,3            | 28,9 | 1,3     | 17,1 / 83,7 / 217,5        | 386 (26,6 %)  | 68 % (38 %)                                     | 99 %     | 99 %           | 4,9              |
| A/B · fog                                   | 55,1            | 21,1 | 0,9     | 18,1 / 117,8 / 499,1       | 547 (47,0 %)  | 74 % (36 %)                                     | 99 %     | 99 %           | 4,8              |
| Ensemble · sans calque, jeu au premier plan | 143,2           | 57,6 | 31,1    | 17,2 / 18,7 / 19,8         | 2 (0,0 %)     | 19 % (0 %)                                      | 0 %      | 0 %            | 9,5              |
| Ensemble · avec calque                      | 154,4           | 25,8 | 1,2     | 17,3 / 84,3 / 332,3        | 1449 (36,4 %) | 70 % (36 %)                                     | 99 %     | 99 %           | 4,8              |

## Par segment

| Étape               | Calque         | Phase    | Durée utile (s) | FPS  | 1 % bas | p99 (ms) | ≥ 2 rafraîch. | Hors grille | Composed | GPU Chaos % | GPU dwm % | GPU OBS % | Carte % | OBS manquées (rendu) | OBS sautées (encodage) |
| ------------------- | -------------- | -------- | --------------- | ---- | ------- | -------- | ------------- | ----------- | -------- | ----------- | --------- | --------- | ------- | -------------------- | ---------------------- |
| ab-preparation      | aucun effet    | —        | 8,1             | 58,0 | 49,8    | 19,9     | 0             | 21 %        | 0 %      | 0,0         | 5,6       | 18,6      | 63      | 0/543                | 0/0                    |
| ab-1-diag.watermark | aucun effet    | —        | 11,0            | 57,9 | 37,9    | 19,5     | 2             | 25 %        | 1 %      | 0,1         | 4,6       | 19,3      | 64      | 0/603                | 0/0                    |
| ab-1-diag.watermark | diag.watermark | maintien | 24,5            | 22,5 | 1,2     | 542,0    | 258           | 62 %        | 99 %     | 1,9         | 16,7      | 4,0       | 40      | 0/1452               | 0/0                    |
| ab-1-diag.watermark | aucun effet    | —        | 9,6             | 58,0 | 47,7    | 20,3     | 0             | 17 %        | 0 %      | 0,0         | 11,3      | 20,8      | 69      | 0/544                | 0/0                    |
| ab-2-mirror         | aucun effet    | —        | 0,0 (court)     | —    | —       | —        | 0             | — %         | — %      | —           | —         | —         | —       | —                    | —                      |
| ab-occupe           | aucun effet    | —        | 23,4            | 55,6 | 10,3    | 19,8     | 2             | 19 %        | 0 %      | 0,0         | 7,8       | 18,6      | 65      | 0/1327               | 0/0                    |
| ab-occupe           | mirror         | entree   | 0,2 (court)     | 18,0 | 10,1    | 98,9     | 3             | 100 %       | 100 %    | —           | —         | —         | 58      | —                    | —                      |
| ab-occupe           | mirror         | maintien | 24,6            | 25,7 | 1,3     | 217,5    | 226           | 59 %        | 100 %    | 3,2         | 12,6      | 3,8       | 41      | 0/1392               | 0/0                    |
| ab-occupe           | mirror         | sortie   | 0,4 (court)     | 36,6 | 6,0     | 166,6    | 3             | 8 %         | 31 %     | —           | —         | —         | 44      | —                    | —                      |
| ab-occupe           | aucun effet    | —        | 9,1             | 58,0 | 50,0    | 19,3     | 0             | 17 %        | 0 %      | 0,0         | 7,7       | 20,0      | 69      | 0/483                | 0/0                    |
| ab-3-fog            | aucun effet    | —        | 0,0 (court)     | —    | —       | —        | 0             | — %         | — %      | —           | —         | —         | —       | —                    | —                      |
| ab-occupe           | aucun effet    | —        | 18,3            | 57,6 | 27,6    | 19,6     | 3             | 19 %        | 0 %      | 0,0         | 8,1       | 20,0      | 66      | 0/1027               | 0/0                    |
| ab-occupe           | fog            | entree   | 2,2 (court)     | 15,9 | 6,0     | 165,6    | 34            | 60 %        | 100 %    | 4,5         | 13,3      | 17,4      | 46      | 0/121                | 0/0                    |
| ab-occupe           | fog            | maintien | 22,5            | 21,5 | 1,0     | 332,4    | 251           | 72 %        | 100 %    | 5,8         | 10,6      | 16,7      | 41      | 0/1268               | 0/0                    |
| ab-occupe           | fog            | sortie   | 3,0             | 8,3  | 0,6     | 1750,4   | 11            | 30 %        | 72 %     | 5,9         | 11,5      | 12,6      | 44      | 0/120                | 0/0                    |
| ab-occupe           | aucun effet    | —        | 6,8             | 58,0 | 48,5    | 19,6     | 0             | 17 %        | 0 %      | 0,0         | 5,4       | 17,8      | 56      | 0/361                | 0/0                    |
| ab-4-fog            | aucun effet    | —        | 0,0 (court)     | —    | —       | —        | 0             | — %         | — %      | —           | —         | —         | —       | —                    | —                      |
| ab-occupe           | aucun effet    | —        | 11,2            | 57,3 | 22,9    | 20,1     | 3             | 24 %        | 1 %      | 0,1         | 6,4       | 19,7      | 65      | 0/663                | 0/0                    |
| ab-occupe           | fog            | entree   | 2,2 (court)     | 41,5 | 18,8    | 53,3     | 37            | 98 %        | 100 %    | 4,8         | 18,3      | 6,3       | 46      | 0/61                 | 0/0                    |
| ab-occupe           | fog            | maintien | 22,4            | 23,3 | 1,1     | 534,7    | 208           | 75 %        | 100 %    | 5,7         | 10,3      | 15,7      | 42      | 0/1267               | 0/0                    |
| ab-occupe           | fog            | sortie   | 2,9 (court)     | 2,5  | 0,6     | 1580,5   | 6             | 14 %        | 86 %     | 4,6         | 12,4      | 13,1      | 41      | 0/121                | 0/0                    |
| ab-occupe           | aucun effet    | —        | 6,8             | 58,0 | 48,9    | 19,7     | 0             | 17 %        | 0 %      | 0,0         | 8,9       | 18,6      | 64      | 0/364                | 0/0                    |
| ab-5-mirror         | aucun effet    | —        | 0,0 (court)     | —    | —       | —        | 0             | — %         | — %      | —           | —         | —         | —       | —                    | —                      |
| ab-occupe           | aucun effet    | —        | 11,7            | 57,5 | 26,1    | 20,2     | 2             | 20 %        | 1 %      | -0,0        | 6,6       | 19,1      | 62      | 0/662                | 0/0                    |
| ab-occupe           | mirror         | entree   | 0,1 (court)     | 53,2 | 32,5    | 30,8     | 1             | 100 %       | 100 %    | —           | —         | —         | 46      | —                    | —                      |
| ab-occupe           | mirror         | maintien | 24,9            | 31,6 | 1,2     | 332,3    | 152           | 77 %        | 100 %    | 3,0         | 10,5      | 15,4      | 38      | 0/1387               | 0/0                    |
| ab-occupe           | mirror         | sortie   | 0,1 (court)     | 58,3 | 29,8    | 33,5     | 1             | 0 %         | 0 %      | —           | —         | —         | 40      | —                    | —                      |
| ab-occupe           | aucun effet    | —        | 9,4             | 58,0 | 49,0    | 19,7     | 0             | 20 %        | 0 %      | 0,0         | 4,6       | 18,6      | 63      | 0/543                | 0/0                    |
| ab-6-diag.watermark | aucun effet    | —        | 11,2            | 57,5 | 27,9    | 21,4     | 5             | 21 %        | 2 %      | 0,1         | 6,7       | 18,5      | 68      | 0/603                | 0/0                    |
| ab-6-diag.watermark | diag.watermark | maintien | 24,5            | 33,1 | 2,2     | 116,3    | 258           | 72 %        | 99 %     | 1,9         | 14,8      | 13,2      | 41      | 0/1449               | 0/0                    |
| ab-6-diag.watermark | aucun effet    | —        | 7,9             | 58,0 | 47,9    | 20,4     | 0             | 13 %        | 0 %      | 0,0         | 8,4       | 17,5      | 59      | 0/542                | 0/0                    |

FPS : images retenues / somme de leurs durées. 1 % bas : 1000 / moyenne du 1 % des images les plus longues.
« ≥ 2 rafraîch. » : images de plus de 1,5 période de rafraîchissement (≈ 25 ms à 60 Hz). « Hors grille » : intervalles
d’affichage à plus de 1 ms d’un multiple de la période ; entre parenthèses, ceux qui tombent sur la grille de l’autre écran.
GPU par processus : compteurs Windows « GPU Engine » (moteur 3D). Carte : nvidia-smi. OBS : GetStats par Studio.
