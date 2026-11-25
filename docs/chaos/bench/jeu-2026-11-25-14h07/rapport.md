# Mesure en jeu Chaos — 2026-11-25T13:07:21.287Z

Jeu : Overwatch.exe. Analyse corrigée (apps/chaos-engine/tools/mesure-jeu.mjs, docs/chaos/BENCH_EFFETS.md § 8).

## Qualité des données

- Images PresentMon : 45334 ; retenues : 27323.
- Jeu hors du premier plan (exclu de 1,5 s avant la perte du focus à 1 s après son retour) : 17 période(s), 349,9 s.
- Marge après chaque changement d'état du calque : 300 ms (relevés de Studio toutes les 250 ms).
- Horloges : apparition/disparition du calque ↔ changement de mode du jeu : disparu 20 ms, disparu -100 ms, disparu -174 ms, disparu -141 ms.
- Rafraîchissement retenu : 16,68 ms. GPU du jeu : PresentMon (MsGPUBusy).

## Par condition

| Condition | Durée utile (s) | FPS | 1 % bas | Image p50 / p95 / p99 (ms) | ≥ 2 rafraîch. | Affichage hors grille (dont grille autre écran) | Composed | SyncInterval 1 | GPU jeu (ms/img) |
|---|---|---|---|---|---|---|---|---|---|
| overwatch-seul · aucun effet | 61,8 | 58,0 | 51,0 | 17,2 / 18,2 / 19,0 | 0 (0,0 %) | 18 % (0 %) | 0 % | 0 % | 7,5 |
| obs-sans-chaos · aucun effet | 79,8 | 56,3 | 13,3 | 17,2 / 18,7 / 19,8 | 1 (0,0 %) | 21 % (0 %) | 0 % | 0 % | 9,3 |
| chaos-repos · aucun effet | 130,1 | 58,0 | 49,1 | 17,2 / 18,7 / 19,6 | 0 (0,0 %) | 21 % (0 %) | 0 % | 0 % | 9,7 |
| effets · aucun effet | 161,3 | 58,0 | 49,0 | 17,2 / 18,7 / 19,6 | 1 (0,0 %) | 21 % (0 %) | 0 % | 0 % | 10,0 |
| effets · fog | 10,4 | 58,5 | 29,3 | 16,7 / 18,4 / 33,3 | 15 (2,5 %) | 69 % (35 %) | 100 % | 100 % | 4,7 |
| effets · flip+fog | 9,9 | 58,1 | 29,4 | 16,7 / 18,6 / 33,4 | 19 (3,3 %) | 91 % (55 %) | 100 % | 100 % | 4,3 |
| effets · drunk | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · drunk+flash | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · blink+drunk+flash | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · blink+color+drunk+flash | 1,1 | 57,2 | 28,8 | 16,8 / 18,6 / 34,7 | 3 (4,8 %) | 98 % (97 %) | 100 % | 100 % | 5,0 |
| effets · color+drunk+flash | 0,5 | 59,9 | 50,4 | 16,7 / 18,3 / 19,8 | 0 (0,0 %) | 79 % (45 %) | 100 % | 100 % | 4,8 |
| effets · color+drunk | 9,6 | 55,1 | 28,7 | 16,7 / 33,2 / 34,4 | 47 (8,9 %) | 76 % (42 %) | 100 % | 100 % | 4,3 |
| effets · color | 1,5 | 59,9 | 33,1 | 16,6 / 18,8 / 30,2 | 1 (1,1 %) | 93 % (60 %) | 93 % | 93 % | 5,7 |
| effets · tunnel | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · pixelate+tunnel | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · pixelate+tunnel+vhs | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · pixelate+shake+tunnel+vhs | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · pixelate+shake+vhs | 0,4 | 55,2 | 30,0 | 17,1 / 32,8 / 33,4 | 2 (8,3 %) | 88 % (33 %) | 100 % | 100 % | 4,5 |
| effets · pixelate+shake | 0,7 | 60,2 | 52,8 | 16,6 / 17,9 / 18,9 | 0 (0,0 %) | 84 % (59 %) | 100 % | 100 % | 5,2 |
| effets · pixelate | 0,2 | 58,8 | 29,9 | 16,6 / 33,5 / 33,5 | 1 (8,3 %) | 8 % (0 %) | 17 % | 17 % | 4,9 |
| effets · mirror | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · mirror+zoom | 0,0 | — | — | — / — / — | 0 (— %) | — % (— %) | — % | — % | — |
| effets · blur+mirror+zoom | 3,6 | 53,6 | 28,9 | 16,8 / 33,4 / 34,5 | 23 (11,8 %) | 95 % (56 %) | 100 % | 100 % | 4,9 |
| effets · blur+mirror | 0,2 | 60,1 | 56,6 | 16,6 / 17,6 / 17,6 | 0 (0,0 %) | 100 % (85 %) | 100 % | 100 % | 5,1 |
| effets · blur | 2,8 | 58,6 | 29,3 | 16,7 / 18,4 / 33,3 | 5 (3,1 %) | 85 % (65 %) | 95 % | 95 % | 4,9 |
| Ensemble · sans calque, jeu au premier plan | 433,0 | 57,7 | 33,3 | 17,2 / 18,7 / 19,6 | 2 (0,0 %) | 20 % (0 %) | 0 % | 0 % | 9,4 |
| Ensemble · avec calque | 41,0 | 57,2 | 29,1 | 16,7 / 20,3 / 33,9 | 116 (5,0 %) | 81 % (49 %) | 99 % | 99 % | 4,5 |

## Par segment

| Étape | Calque | Phase | Durée utile (s) | FPS | 1 % bas | p99 (ms) | ≥ 2 rafraîch. | Hors grille | Composed | GPU Chaos % | GPU dwm % | GPU OBS % | Carte % | OBS manquées (rendu) | OBS sautées (encodage) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| overwatch-seul | aucun effet | — | 61,8 | 58,0 | 51,0 | 19,0 | 0 | 18 % | 0 % | — | 5,1 | — | 38 | — | — |
| obs-sans-chaos | aucun effet | — | 79,8 | 56,3 | 13,3 | 19,8 | 1 | 21 % | 0 % | — | 6,5 | 17,3 | 53 | 0/2063 | 0/0 |
| chaos-repos | aucun effet | — | 130,1 | 58,0 | 49,1 | 19,6 | 0 | 21 % | 0 % | 0,0 | 19,4 | 17,8 | 61 | 0/11903 | 0/0 |
| effets | aucun effet | — | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 39 | 0/604 | 0/0 |
| effets | fog | entree | 0,5 (court) | 60,0 | 55,6 | 18,0 | 0 | 44 % | 100 % | — | — | — | 43 | 0/121 | 0/0 |
| effets | fog | maintien | 5,0 | 60,0 | 50,9 | 18,8 | 0 | 65 % | 100 % | 8,0 | 9,6 | 4,0 | 42 | 0/242 | 0/0 |
| effets | flip+fog | — | 9,9 | 58,1 | 29,4 | 33,4 | 19 | 91 % | 100 % | 6,0 | 19,0 | 4,2 | 45 | 0/548 | 0/0 |
| effets | fog | maintien | 2,0 (court) | 57,0 | 28,8 | 33,5 | 6 | 81 % | 100 % | 8,3 | 20,8 | 6,1 | 43 | 0/61 | 0/0 |
| effets | fog | sortie | 2,9 (court) | 56,9 | 28,8 | 34,3 | 9 | 72 % | 100 % | 10,0 | 14,7 | 4,2 | 48 | 0/121 | 0/0 |
| effets | aucun effet | — | 15,1 | 58,0 | 49,2 | 19,8 | 0 | 18 % | 0 % | 0,1 | 16,5 | 16,1 | 60 | 0/1938 | 0/0 |
| effets | drunk | entree | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 47 | — | — |
| effets | drunk+flash | — | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 44 | — | — |
| effets | blink+drunk+flash | — | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 44 | — | — |
| effets | blink+color+drunk+flash | — | 1,1 (court) | 57,2 | 28,8 | 34,7 | 3 | 98 % | 100 % | 9,0 | 14,2 | 5,1 | 49 | 0/122 | 0/0 |
| effets | color+drunk+flash | — | 0,5 (court) | 59,9 | 50,4 | 19,8 | 0 | 79 % | 100 % | — | — | — | 47 | — | — |
| effets | color+drunk | — | 9,6 | 55,1 | 28,7 | 34,4 | 47 | 76 % | 100 % | 5,8 | 11,5 | 5,1 | 43 | 0/484 | 0/0 |
| effets | color | maintien | 0,8 (court) | 60,0 | 52,6 | 19,0 | 0 | 100 % | 100 % | 2,2 | 23,3 | 7,7 | 48 | — | — |
| effets | color | sortie | 0,8 (court) | 59,8 | 33,1 | 30,2 | 1 | 87 % | 87 % | 2,7 | 28,6 | 13,1 | 47 | — | — |
| effets | aucun effet | — | 9,9 | 58,0 | 50,4 | 19,6 | 0 | 23 % | 0 % | 0,0 | 29,8 | 20,4 | 77 | 0/787 | 0/0 |
| effets | tunnel | entree | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 45 | — | — |
| effets | pixelate+tunnel | — | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 46 | 0/61 | 0/0 |
| effets | pixelate+tunnel+vhs | — | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 48 | 0/60 | 0/0 |
| effets | pixelate+shake+tunnel+vhs | — | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 49 | 0/60 | 0/0 |
| effets | pixelate+shake+vhs | — | 0,4 (court) | 55,2 | 30,0 | 33,4 | 2 | 88 % | 100 % | — | — | — | 44 | — | — |
| effets | pixelate+shake | — | 0,7 (court) | 60,2 | 52,8 | 18,9 | 0 | 84 % | 100 % | 2,2 | 18,2 | 3,3 | 47 | — | — |
| effets | pixelate | sortie | 0,2 (court) | 58,8 | 29,9 | 33,5 | 1 | 8 % | 17 % | — | — | — | 45 | — | — |
| effets | aucun effet | — | 51,1 | 58,0 | 47,7 | 19,9 | 1 | 21 % | 0 % | 0,0 | 20,6 | 16,9 | 64 | 0/4793 | 0/0 |
| effets | mirror | entree | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 53 | — | — |
| effets | mirror | maintien | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 50 | — | — |
| effets | mirror+zoom | — | 0,0 (court) | — | — | — | 0 | — % | — % | — | — | — | 46 | 0/121 | 0/0 |
| effets | blur+mirror+zoom | — | 3,6 | 53,6 | 28,9 | 34,5 | 23 | 95 % | 100 % | 4,4 | 23,2 | 4,3 | 45 | 0/242 | 0/0 |
| effets | blur+mirror | — | 0,2 (court) | 60,1 | 56,6 | 17,6 | 0 | 100 % | 100 % | — | — | — | 43 | — | — |
| effets | blur | maintien | 2,0 (court) | 58,6 | 30,1 | 33,0 | 3 | 95 % | 100 % | 2,3 | 26,1 | 3,6 | 44 | 0/61 | 0/0 |
| effets | blur | sortie | 0,8 (court) | 58,5 | 29,3 | 34,1 | 2 | 58 % | 82 % | — | — | — | 42 | — | — |
| effets | aucun effet | — | 85,3 | 58,0 | 49,8 | 19,5 | 0 | 21 % | 0 % | 0,0 | 17,2 | 18,3 | 67 | 0/6294 | 0/0 |

FPS : images retenues / somme de leurs durées. 1 % bas : 1000 / moyenne du 1 % des images les plus longues.
« ≥ 2 rafraîch. » : images de plus de 1,5 période de rafraîchissement (≈ 25 ms à 60 Hz). « Hors grille » : intervalles
d’affichage à plus de 1 ms d’un multiple de la période ; entre parenthèses, ceux qui tombent sur la grille de l’autre écran.
GPU par processus : compteurs Windows « GPU Engine » (moteur 3D). Carte : nvidia-smi. OBS : GetStats par Studio.
