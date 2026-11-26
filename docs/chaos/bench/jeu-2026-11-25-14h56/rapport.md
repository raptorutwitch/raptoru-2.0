# Mesure en jeu Chaos — 2026-11-25T13:56:34.782Z

Jeu : Overwatch.exe. Analyse corrigée (apps/chaos-engine/tools/mesure-jeu.mjs, docs/chaos/BENCH_EFFETS.md § 8).

## Qualité des données

- Images PresentMon : 9440 ; retenues : 2209.
- Jeu hors du premier plan (exclu de 1,5 s avant la perte du focus à 1 s après son retour) : 1 période(s), 183,5 s.
- Marge après chaque changement d'état du calque : 300 ms (relevés de Studio toutes les 250 ms).
- Horloges : apparition/disparition du calque ↔ changement de mode du jeu : apparu -196 ms, disparu 19 ms.
- Rafraîchissement retenu : 16,68 ms. GPU du jeu : PresentMon (MsGPUBusy).

## Par condition

| Condition                                   | Durée utile (s) | FPS  | 1 % bas | Image p50 / p95 / p99 (ms) | ≥ 2 rafraîch. | Affichage hors grille (dont grille autre écran) | Composed | SyncInterval 1 | GPU jeu (ms/img) |
| ------------------------------------------- | --------------- | ---- | ------- | -------------------------- | ------------- | ----------------------------------------------- | -------- | -------------- | ---------------- |
| A/B · aucun effet                           | 26,5            | 57,6 | 30,7    | 17,2 / 18,6 / 19,9         | 2 (0,1 %)     | 18 % (0 %)                                      | 0 %      | 0 %            | 9,6              |
| A/B · diag.watermark                        | 24,4            | 27,9 | 1,3     | 17,5 / 82,2 / 216,7        | 277 (40,7 %)  | 56 % (26 %)                                     | 100 %    | 100 %          | 4,8              |
| Ensemble · sans calque, jeu au premier plan | 26,3            | 58,0 | 48,4    | 17,2 / 18,6 / 19,8         | 0 (0,0 %)     | 18 % (0 %)                                      | 0 %      | 0 %            | 9,6              |
| Ensemble · avec calque                      | 24,4            | 27,9 | 1,3     | 17,5 / 82,2 / 216,7        | 277 (40,7 %)  | 56 % (26 %)                                     | 100 %    | 100 %          | 4,8              |

## Par segment

| Étape               | Calque         | Phase    | Durée utile (s) | FPS  | 1 % bas | p99 (ms) | ≥ 2 rafraîch. | Hors grille | Composed | GPU Chaos % | GPU dwm % | GPU OBS % | Carte % | OBS manquées (rendu) | OBS sautées (encodage) |
| ------------------- | -------------- | -------- | --------------- | ---- | ------- | -------- | ------------- | ----------- | -------- | ----------- | --------- | --------- | ------- | -------------------- | ---------------------- |
| ab-preparation      | aucun effet    | —        | 7,0             | 58,0 | 49,7    | 19,8     | 0             | 16 %        | 0 %      | 0,0         | 8,9       | 19,6      | 64      | 0/544                | 0/0                    |
| ab-1-diag.watermark | aucun effet    | —        | 11,1            | 57,0 | 19,6    | 19,9     | 2             | 19 %        | 0 %      | 0,1         | 7,0       | 18,8      | 68      | 0/664                | 0/0                    |
| ab-1-diag.watermark | diag.watermark | maintien | 24,4            | 27,9 | 1,3     | 216,7    | 277           | 56 %        | 100 %    | 2,0         | 16,0      | 8,1       | 41      | 0/1390               | 0/0                    |
| ab-1-diag.watermark | aucun effet    | —        | 8,5             | 58,0 | 48,8    | 19,8     | 0             | 17 %        | 0 %      | 0,0         | 6,8       | 18,6      | 70      | 0/543                | 0/0                    |
| ab-2-mirror         | aucun effet    | —        | 0,0 (court)     | —    | —       | —        | 0             | — %         | — %      | —           | —         | —         | —       | —                    | —                      |
| ab-erreur           | aucun effet    | —        | 0,0 (court)     | —    | —       | —        | 0             | — %         | — %      | —           | —         | —         | —       | —                    | —                      |

FPS : images retenues / somme de leurs durées. 1 % bas : 1000 / moyenne du 1 % des images les plus longues.
« ≥ 2 rafraîch. » : images de plus de 1,5 période de rafraîchissement (≈ 25 ms à 60 Hz). « Hors grille » : intervalles
d’affichage à plus de 1 ms d’un multiple de la période ; entre parenthèses, ceux qui tombent sur la grille de l’autre écran.
GPU par processus : compteurs Windows « GPU Engine » (moteur 3D). Carte : nvidia-smi. OBS : GetStats par Studio.
