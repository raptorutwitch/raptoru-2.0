# Banc des 13 effets Chaos V2 (25/11/2026)

> **Statut** : phases A (moteur hors écran) et B (OBS isolé) **mesurées** le 25/11, PC au repos, aucun jeu. Phase C
> (Overwatch réel) **mesurée une première fois le 25/11 à 14 h 07** par Antoni : analyse et corrections au **§ 8**,
> test A/B de confirmation prêt (§ 8.5). Aucune perte d'images/s n'est donnée tant que l'A/B n'a pas tourné : les
> chiffres d'images/s du § 4 restent des **estimations**. Branche locale `feat/chaos-studio`.

## 0. En bref

- **Aucun effet n'a dégradé OBS** dans le banc isolé, qui reproduit ta configuration : capture directe DXGI 2560×1440,
  relais, sortie 1080p60, NVENC CBR 8000. Sur 52 passages (25 cas d'effets et la référence, 2 fois chacun) :
  **0 image en retard au rendu, 0 image sautée à l'encodage, 0 image noire**, jamais plus de 16,7 ms entre deux
  images.
- **Coût GPU du moteur**, mesuré hors écran à 1440p, par image de maintien :
  - de **0,09 ms** (Flash) à **0,60 ms** (Brouillard) ;
  - à 60 images/s, la cadence de ton écran principal, cela fait **0,4 % à 3,6 %** du temps GPU.
- **Les trois plus coûteux** : Brouillard (0,60 ms), Écran ivre (0,48–0,53 ms) et VHS (0,29–0,32 ms). Les dix autres
  restent entre 0,09 et 0,30 ms.
- **Ce qui ne coûte pas** :
  - le processeur : 5 à 8 µs par image, moins de 0,05 % d'un cœur ;
  - l'activation : moins de 0,3 ms de processeur, première image ≤ 1,1 ms de GPU ;
  - la mémoire vidéo : 20 Mo de plus au maximum, pour Écran ivre et Flash.
- **En jeu (§ 8, première mesure)** : quand le calque est visible, Overwatch quitte l'« Independent Flip » pour la
  composition de Windows, synchronisée sur 60 Hz. Le jeu produit autant d'images, mais **4,9 % d'entre elles durent
  deux rafraîchissements (33 ms)**, contre 0,0 % sans calque. C'est le cas avec les effets légers comme avec
  Brouillard : la cause n'est pas le coût des shaders. Le test A/B du § 8.5 doit le confirmer avec un calque neutre.

## 1. Conditions

| Élément         | Valeur                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matériel        | RTX 3070 (8 Go, pilote 32.0.15.9579, HAGS coupé), i7-12700 (20 cœurs logiques), 64 Go, Windows 11 25H2 (26200)                                                                                                                                                          |
| Écrans          | principal XB273U 2560×1440 à **59–60 Hz** (cadence des effets), secondaire 1920×1080 à 144 Hz                                                                                                                                                                           |
| Moteur          | `ChaosEngine.exe` 0.4.0, profil « qualité » (pleine résolution), commits `de06ee91` et `733cf5fa`                                                                                                                                                                       |
| OBS isolé       | libobs 33.0.1 sans fenêtre, configuration jetable ; réglé comme ton profil Twitch : canevas et sortie 1920×1080, 60 i/s, NV12 709 partiel, « Écran » DXGI avec curseur, relais sans curseur hors cadre, `obs_nvenc_h264_tex` CBR 8000, keyint 2 s, sans AQ ni lookahead |
| Pendant le banc | **ton OBS réel était ouvert** (non touché) ; GPU occupé à ~28–31 % hors banc ; fréquence du GPU non bloquée : 900 à 1920 MHz (médiane 1290) pendant A, 810 à 1755 MHz (médiane 1125) pendant B                                                                          |

## 2. Phase A : le moteur hors écran

`ChaosEngine.exe --perf-phases --w 2560 --h 1440 --hz 60 --repeats 3 --all-variants`, en 5 min 15 s.

- **Ce qui est joué.** Chaque effet est joué en entier : entrée, maintien, sortie. On le joue à son réglage par
  défaut (tes fiches n'ont ni variante ni niveau), puis à chacun de ses paliers proposés aux viewers. Chaque cas est
  répété 3 fois ; les autres variantes sont jouées une fois.
- **Image source.** Une scène de jeu de synthèse qui bouge, donc une image neuve à chaque rafraîchissement.
- **Cadence.** C'est celle du vrai moteur, rejouée image par image : `Cadence` et l'empreinte de l'image. Un effet qui
  n'a pas besoin de la capture ne redessine pas une image identique (Flash rend 37 à 53 images/s).
- **Temps GPU.** Mesuré par des horodatages, une image après l'autre.

### Temps GPU par effet, au maintien

Le tableau couvre tous les paliers de chaque effet. « Écart entre répétitions » est le plus grand écart-type de la
médiane d'une répétition à l'autre.

| Effet          | Paliers mesurés                        | p50 (ms)  | p95 (ms)  | p99 (ms) | Pic (ms) | GPU par s à 60 Hz | Entrée p95 | Sortie p95 | Écart entre répétitions |
| -------------- | -------------------------------------- | --------- | --------- | -------- | -------- | ----------------- | ---------- | ---------- | ----------------------- |
| Référence      | copie seule, sans effet                | 0,155     | 0,29      | 0,32     | 0,44     | 10 ms (1,0 %)     | —          | —          | 0,03                    |
| Flash          | défaut, court, intense, longue         | 0,09–0,11 | 0,13–0,14 | 0,16     | 0,45     | 4–5 ms (0,5 %)    | —          | —          | 0,05                    |
| Couleur        | défaut, nb, sépia, inversion           | 0,11–0,12 | 0,16–0,18 | 0,21     | 0,48     | 7–8 ms (0,7 %)    | 0,17       | 0,13       | 0,04                    |
| Zoom           | défaut, léger, marqué, extrême         | 0,16–0,18 | 0,19–0,26 | 0,27     | 0,52     | 10–11 ms (1,1 %)  | 0,22       | 0,29       | 0,01                    |
| Miroir         | défaut, horizontal, vertical, alterné  | 0,16–0,19 | 0,26–0,39 | 0,44     | 0,70     | 11–13 ms (1,2 %)  | 0,28       | 0,19       | 0,04                    |
| Pixelisation   | défaut, léger, marqué, extrême         | 0,17–0,21 | 0,25–0,32 | 0,36     | 1,07¹    | 11–14 ms (1,2 %)  | 0,30       | 0,28       | 0,04                    |
| Tremblement    | défaut, léger, marqué, extrême         | 0,17–0,21 | 0,17–0,26 | 0,29     | 0,53     | 10–14 ms (1,2 %)  | 0,27       | 0,19       | 0,06                    |
| Écran retourné | défaut                                 | 0,18      | 0,22      | 0,23     | 0,50     | 11 ms (1,1 %)     | 0,21       | 0,17       | 0,06                    |
| Flou           | défaut, léger, marqué, extrême         | 0,18–0,23 | 0,24–0,38 | 0,40     | 1,06¹    | 12–15 ms (1,3 %)  | 0,33       | 0,30       | 0,03                    |
| Vision tunnel  | défaut, léger, marqué, extrême         | 0,21–0,27 | 0,29–0,36 | 0,38     | 0,78     | 14–16 ms (1,5 %)  | 0,38       | 0,37       | 0,05                    |
| Paupières      | défaut, naturel, fatigue, fermé        | 0,18–0,30 | 0,32–0,44 | 0,44     | 0,67     | 13–19 ms (1,6 %)  | —          | 0,29       | 0,06                    |
| **VHS**        | défaut, légère, abîmée, glitch violent | 0,29–0,32 | 0,33–0,45 | 0,47     | 0,80     | 18–20 ms (1,9 %)  | 0,43       | 0,33       | 0,08                    |
| **Écran ivre** | défaut, léger, marqué, extrême         | 0,48–0,49 | 0,51–0,52 | 0,52     | 0,56     | 29–30 ms (3,0 %)  | 0,52       | 0,51       | 0,06                    |
| **Brouillard** | défaut, léger, marqué, dense, extrême  | 0,57–0,60 | 0,58–0,61 | 0,62     | 0,64     | 34–36 ms (3,6 %)  | 0,76       | 0,61       | 0,01                    |

¹ Pic isolé (une image sur ~1 800). Son p99 reste à 0,40 et 0,36 ms : c'est du bruit (fréquence du GPU, OBS réel en
arrière-plan), pas un défaut de l'effet.

**Lecture :**

- **Intensité.** Elle ne change presque rien au coût, sauf pour Paupières (« fermé » 0,30 ms contre « naturel » 0,18).
  Brouillard et Écran ivre coûtent la même chose à tous les niveaux : leur shader calcule tout à chaque image, et le
  niveau ne change que des seuils.
- **Entrée et sortie.** Elles coûtent comme le maintien. La seule exception est l'entrée du Brouillard (p95 0,76 ms
  contre 0,61), une fois sur trois.
- **Variantes hors paliers.** Elles restent dans la même fourchette, avec trois exceptions :
  - Tremblement « impact » et « vibration » : 0,37–0,38 ms ;
  - Zoom « progressif » : 0,28 ms ;
  - VHS « tracking » : p95 0,60 ms.
- **Activation.** Préparer l'effet prend 0,01 à 0,3 ms de processeur ; jusqu'à 1,1 ms au tout premier lancement de
  Paupières (texte des cils). La première image prend ≤ 1,1 ms de GPU (Brouillard).
- **Désactivation.** Moins de 0,1 ms. Aucune mémoire n'est perdue d'une activation à l'autre.
- **Processeur du moteur.** 5 à 8 µs par image (p50), environ 40 µs (p95), quel que soit l'effet.
- **Mémoire vidéo.** Mesurée dans un processus neuf par effet (`a-vram-processus-frais.jsonl`), en plus de la base
  commune du moteur :
  - Écran ivre : **+20 Mo** (une image intermédiaire 1440p avec ses mipmaps) ;
  - Flash : **+20 Mo** (l'image retenue) ;
  - Brouillard : **+5 Mo** (calque à demi-résolution) ;
  - tous les autres : **+0**.

**Limites de la phase A :**

- Ce n'est ni la capture, ni la présentation, ni la composition par Windows, ni un jeu.
- La fréquence du GPU n'était pas bloquée (médiane 1290 MHz). En jeu, la carte tourne vers 1900 MHz : les temps
  absolus y seraient plutôt plus courts, et le classement ne change pas.

## 3. Phase B : OBS isolé

`chaos-obs-check.exe --effects-load --repeats 2`. Pendant que le moteur rend chaque effet hors écran au rythme réel
(60 Hz), OBS capture ton écran, compose 1080p60 et encode en NVENC. 12 effets à deux paliers (défaut et le plus
fort), Écran retourné à un seul, la référence ; 2 répétitions, ~11 min.

| Mesure                             | OBS seul   | Moteur, copie seule | Avec chaque effet (tous paliers, toutes phases)                                                                 |
| ---------------------------------- | ---------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Images en retard (rendu)           | 0          | 0                   | **0**                                                                                                           |
| Images sautées (encodage)          | 0          | 0                   | **0**                                                                                                           |
| Images noires                      | 0          | 0                   | **0**                                                                                                           |
| Plus grand écart entre deux images | 16,7 ms    | 16,7 ms             | **16,7 ms** partout                                                                                             |
| Temps de rendu d'OBS (moyenne)     | 2,2–2,6 ms | 1,7 ms              | 1,4–2,3 ms                                                                                                      |
| GPU d'OBS par image                | 1,7–1,8 ms | 1,2 ms              | 1,0–1,3 ms au maintien (0,8–2,2 ms sur les entrées et sorties, fenêtres de moins d'une seconde)                 |
| NVENC                              | 48 %       | 43 %                | 32–56 %                                                                                                         |
| GPU du processus moteur²           | —          | 3,6 %               | Flash 2,0–2,3 ; Couleur 2,8–2,9 ; neuf effets 3,3–4,6 ; VHS 4,5–4,8 ; Écran ivre 6,2–6,8 ; Brouillard 7,7–8,3 % |

² Compteurs Windows du processus de banc. Ils comprennent la fausse capture du banc (une copie 1440p par image) : il
faut les lire par rapport à la ligne « copie seule ».

**Lecture :**

- OBS est un peu plus rapide quand le moteur travaille que seul. Le GPU, plus occupé, monte en fréquence. Ce n'est
  donc pas un coût.
- Au rythme réel, avec un GPU peu chargé (~1100 MHz), le temps par image du moteur s'allonge :
  - Brouillard : p95 **1,6 ms** ;
  - Écran ivre : **1,1 ms** ;
  - VHS : **0,66 ms**.

  C'est la même quantité de travail à plus basse fréquence. Sur le bureau, c'est ce qu'il faut attendre ; en jeu, ce
  seront plutôt les chiffres de la phase A.

**Limites de la phase B :**

- L'effet n'est pas affiché (aucun test visible), donc OBS ne capture pas un écran qui change 60 fois par seconde.
- Aucun jeu ne charge le GPU : le banc tourne à ~30 % de charge, ton GPU avait de la marge.
- Ce qui n'est pas reproduit de ton OBS réel :
  - ses autres sources (sources navigateur, caméra, alertes) ;
  - sa priorité GPU (le banc n'a pas pu la régler) ;
  - un éventuel second encodeur du greffon Aitum.

Ces points relèvent de la phase C.

## 4. Classement

Les catégories viennent des écarts mesurés, pas de seuils fixés d'avance. Les effets forment trois groupes :

- ≤ 0,12 ms ;
- 0,16 à 0,32 ms ;
- 0,48 à 0,60 ms, soit 2 à 3 fois le groupe précédent.

| Effet          | GPU mesuré (maintien, p50 / p95)    | GPU à 60 Hz | Processeur  | Mémoire vidéo | Images/s réelles | Fluidité OBS (isolé) | Risque de saccade             | Confiance                      | Catégorie  |
| -------------- | ----------------------------------- | ----------- | ----------- | ------------- | ---------------- | -------------------- | ----------------------------- | ------------------------------ | ---------- |
| Flash          | 0,09–0,11 / 0,14 ms                 | 0,5 %       | < 10 µs/img | +20 Mo        | non mesuré       | 0 perte              | très faible (pic 0,45 ms)     | haute (A, B) ; jeu : à mesurer | **Léger**  |
| Couleur        | 0,11–0,12 / 0,18 ms                 | 0,7 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| Zoom           | 0,16–0,18 / 0,26 ms                 | 1,1 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| Écran retourné | 0,18 / 0,22 ms                      | 1,1 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| Miroir         | 0,16–0,19 / 0,39 ms                 | 1,2 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| Pixelisation   | 0,17–0,21 / 0,32 ms                 | 1,2 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| Tremblement    | 0,17–0,21 / 0,26 ms (impact 0,38)   | 1,2 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| Flou           | 0,18–0,23 / 0,38 ms                 | 1,3 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| Vision tunnel  | 0,21–0,27 / 0,36 ms                 | 1,5 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| Paupières      | 0,18–0,30 / 0,44 ms                 | 1,6 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | très faible                   | haute ; jeu : à mesurer        | **Léger**  |
| VHS            | 0,29–0,32 / 0,45 ms (tracking 0,60) | 1,9 %       | < 10 µs/img | 0             | non mesuré       | 0 perte              | faible                        | haute ; jeu : à mesurer        | **Léger**  |
| Écran ivre     | 0,48–0,53 / 0,52 ms                 | 3,0 %       | < 10 µs/img | +20 Mo        | non mesuré       | 0 perte              | faible (constant, pas de pic) | haute ; jeu : à mesurer        | **Modéré** |
| Brouillard     | 0,57–0,60 / 0,61 ms                 | 3,6 %       | < 10 µs/img | +5 Mo         | non mesuré       | 0 perte              | faible (constant, pas de pic) | haute ; jeu : à mesurer        | **Modéré** |

**Lourd et critique : aucun effet**, d'après A et B. La phase C peut faire monter un effet d'un cran si Overwatch est
limité par le GPU.

**Estimation, non mesurée.** Si Overwatch tourne sans limite d'images/s et que le GPU est saturé, un effet qui prend
x % du GPU retire environ x % des images/s :

- Brouillard ≈ 3,5 % ;
- Écran ivre ≈ 3 % ;
- les autres de 0,5 à 2 %.

Il faut y ajouter deux coûts fixes, communs à tous les effets et non mesurés :

- la composition du calque par Windows ;
- le passage du jeu de « Hardware: Independent Flip » à « Composed: Flip ».

Si Overwatch est limité à 60 images/s (écran 60 Hz) et que le GPU a de la marge, l'effet attendu est nul.

## 5. Les trois plus coûteux : optimisations possibles (non faites)

Aucune n'est nécessaire au vu des mesures. Le plus cher prend 0,6 ms sur 16,7 ms par image à 60 Hz, et OBS n'a perdu
aucune image. À revoir seulement si la phase C montre une baisse mesurable.

### Brouillard (0,60 ms ; 1,6 ms quand le GPU est au ralenti)

**Pourquoi il coûte.** Le calque est déjà calculé à demi-résolution (1280×720), puis agrandi. Mais chaque pixel
évalue environ 33 octaves de bruit :

- deux nappes, chacune avec 2 × fbm(3), fbm(5) et fbm(3) ;
- un masque fbm(3) ;
- deux bruits de gradient.

Tout cela est recalculé 60 fois par seconde, quel que soit le niveau : la densité ne change que des seuils.

**Options :**

1. Calque au tiers de la résolution. Le réglage « qualité : économie » existe déjà. Gain estimé ≈ −0,3 ms (−50 %).
   Risque faible : le brouillard est flou par nature, son relief s'adoucit un peu.
2. Brouillard recalculé une image sur deux, car il dérive lentement. Gain ≈ −50 %. Risque : une légère saccade de la
   dérive.
3. fbm(5) ramené à fbm(4). Gain ≈ −10 à 15 %. Risque : moins de détail fin.

### Écran ivre (0,48–0,53 ms, +20 Mo)

**Pourquoi il coûte.** Deux passes à pleine résolution :

- le balancement (rotation et zoom) vers une image intermédiaire 1440p, dont on calcule ensuite les mipmaps pour le
  flou ;
- l'ondulation et la double vision : 4 bruits de gradient et 2 lectures floues par pixel.

**Options :**

1. Fusionner le balancement dans la passe d'ondulation, soit une seule lecture de la capture. Gain estimé
   ≈ −0,15 ms et −20 Mo. Risque faible, même calcul, mais les bords en miroir sont à revérifier.
2. Passe intermédiaire à demi-résolution (`render_scale`, déjà prévu). Gain ≈ −0,1 ms. Risque : image un peu plus
   douce, peu visible pour un effet déjà flou.

### VHS (0,29–0,32 ms ; « tracking » p95 0,60 ms)

**Pourquoi il coûte.** Une seule passe, mais lourde :

- environ 10 lectures de texture par pixel : 3 pour la luminance, 4 pour la chrominance à un niveau de mip,
  2 décalages RGB et l'image d'origine ;
- les mipmaps de la capture 1440p, recalculés à chaque image ;
- des bruits pour les lignes et les parasites.

**Option.** Chrominance lue dans une réduction au quart, sans chaîne de mipmaps complète. Gain estimé ≈ −0,1 ms.
Risque moyen : le rendu VHS a été réglé et validé, et toucher la chrominance le change. **À éviter** sans besoin
démontré.

## 6. Phase C : Overwatch en conditions réelles (à faire par Antoni)

Rien n'est contrôlé automatiquement : tu lances le jeu, tu joues, tu déclenches les effets. L'outil
`apps/chaos-engine/tools/mesure-jeu.mjs` ne fait qu'enregistrer, sur une même horloge :

- PresentMon 2.6, la version officielle d'Intel, signée, posée dans `.tools/presentmon/` (non versionné) ;
- le GPU et le processeur par processus : jeu, Chaos, dwm, OBS ;
- nvidia-smi ;
- les effets actifs et les compteurs d'OBS, lus dans Studio.

Il découpe ensuite automatiquement par étape et par phase d'effet, et retire les Alt+Tab.

**Préparation, une fois :**

1. **Optionnel** : installer la version de test **0.1.44-chaos.9**. C'est chaos.8 plus la lecture seule des compteurs
   d'OBS (images manquées et sautées) par Studio. Sans elle, l'outil le signale : note alors ces deux compteurs dans
   le dock « Statistiques » d'OBS au début et à la fin.
2. Ouvrir un **Terminal en administrateur** (PresentMon l'exige).
3. Overwatch :
   - garde tes réglages habituels de stream ;
   - en **fenêtré sans bordure** (le calque de Chaos ne couvre pas un plein écran exclusif) ;
   - note la limite d'images/s, car le résultat en dépend.

**Mesure, hors live, environ 20 min :**

```bat
cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\chaos-v2"
node apps\chaos-engine\tools\mesure-jeu.mjs
```

| Étape | Ce que tu fais                                                                                                                                                                                                                                                                                               | Dans la console                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 1     | OBS et Studio **fermés**. Overwatch, Champ d'entraînement, toujours le même héros et le même endroit ; joue 60 s de la même façon (même parcours, mêmes cibles).                                                                                                                                             | Entrée au début                      |
| 2     | Ouvre OBS (scène Fullscreen, **sans diffuser** ; lance l'**enregistrement** si tu veux mesurer l'encodage), reviens au même endroit, 60 s.                                                                                                                                                                   | Entrée                               |
| 3     | Ouvre Studio (Chaos prêt, aucun effet), 60 s.                                                                                                                                                                                                                                                                | Entrée                               |
| 4     | Pour chaque effet : Studio › Chaos › **Performance Lab › Validation en jeu**, phases 10 / 15 / 10 s, « Lancer la mesure », puis reviens **tout de suite** dans le jeu et joue normalement jusqu'au retour à la normale. Un effet à la fois. Commence par Brouillard, Écran ivre et VHS, puis les dix autres. | Entrée une fois, au début de l'étape |
| 5     | Fin.                                                                                                                                                                                                                                                                                                         | `q` puis Entrée                      |

**Pour des résultats fiables :**

- Même scène de jeu et même façon de jouer à chaque étape. Aucune autre application lourde.
- Ne touche pas aux réglages d'Overwatch ni d'OBS entre les étapes.
- Refais Brouillard, Écran ivre et VHS une deuxième fois en fin de séance.
- STOP ALL ou Ctrl+Maj+F11 si quoi que ce soit gêne.

**Résultat.** Le rapport `rapport.md` et `synthese.json` sont écrits dans `docs\chaos\bench\jeu-<date>` (le chemin
s'affiche). Il donne, par étape et par phase d'effet :

- images/s moyennes, 1 % bas, 0,1 % bas ;
- durée des images p95 et p99 ;
- saccades par minute ;
- mode de présentation du jeu ;
- GPU du jeu, de Chaos, de dwm et d'OBS ;
- charge de la carte ;
- images manquées au rendu et sautées à l'encodage dans OBS.

Envoie-moi le dossier : je complète la colonne « Images/s réelles » et je confirme ou corrige le classement.

`node apps\chaos-engine\tools\mesure-jeu.mjs --self-test` vérifie l'analyse sur une mesure de synthèse.
`--analyse <dossier>` refait un rapport.

## 7. Données brutes et reproduction

Dossier `docs/chaos/bench/2026-11-25/` :

| Fichier                                | Contenu                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `a-phases.jsonl`                       | phase A : une ligne par cas et par répétition (phases, activation, mémoire)         |
| `a-frames.jsonl`                       | phase A : temps GPU et processeur de **chaque image**, par cas, répétition et phase |
| `a-synthese.json`                      | phase A agrégée (`node analyse-a.mjs a-phases.jsonl`)                               |
| `a-vram-processus-frais.jsonl`         | mémoire vidéo, un processus neuf par effet                                          |
| `a-nvidia-smi.csv`, `b-nvidia-smi.csv` | fréquence, charge, mémoire, puissance de la carte toutes les 500 ms pendant A et B  |
| `b-report.json`, `b-console.txt`       | phase B brute (chaque phase de chaque passage)                                      |
| `b-synthese.json`                      | phase B agrégée (`node analyse-b.mjs b-report.json`)                                |

Relancer (PC au repos, jeu fermé ; la garde refuse sinon) :

```bat
apps\chaos-engine\build.cmd
apps\chaos-engine\bin\ChaosEngine.exe --perf-phases --w 2560 --h 1440 --hz 60 --repeats 3 --all-variants --raw a-frames.jsonl > a-phases.jsonl
apps\chaos-engine\bin\chaos-obs-check.exe --effects-load --engine apps\chaos-engine\bin\ChaosEngine.exe --out <dossier> --repeats 2 --tiers defaut,extreme,glitch_violent,ferme,intense,alterne,inversion
```

`chaos-obs-check.exe` cherche `obs-nvenc-test.exe` à côté de lui : copie-le depuis `C:\Program Files\obs-studio\bin\64bit`.

## 8. Mesure en jeu du 25/11 (14 h 07) : analyse et corrections

> **Correction (§ 9.2).** Les chiffres de PresentMon **en mode composé** de cette section (images de 33 ms, 4,9 %,
> 40,7 %, 27,9 i/s) sont faux. PresentMon sous-compte les images d'Overwatch quand le calque est affiché : le jeu
> gardait ses ~58 i/s, d'après la capture du moteur, son processeur et le ressenti. Restent valables : le passage en
> composition à l'apparition du calque, les chiffres sans calque et l'analyse des défauts du collecteur. La cause des
> ralentissements ressentis avec Miroir est au § 9.3.

Données : `docs/chaos/bench/jeu-2026-11-25-14h07/`, avec PresentMon et les relevés par processus compressés en `.gz`.
L'analyse les lit telles quelles. `rapport-initial.md` est le rapport produit sur le moment, faux sur plusieurs points
(§ 8.1) ; `rapport.md` est l'analyse corrigée.

### 8.1 Défauts du collecteur, corrigés

| Constat dans `rapport-initial.md`               | Cause                                                                                                                                                                | Correction                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| FPS moyens inférieurs au 1 % bas (34 contre 51) | Durée prise de la première à la dernière image, **trous des Alt+Tab compris**                                                                                        | FPS = images retenues / somme de leurs durées                                                              |
| GPU du jeu toujours à 0 %                       | Le compteur Windows « GPU Engine, 3D » ne voit pas Overwatch (0 sur 982 relevés)                                                                                     | GPU du jeu lu dans PresentMon (`MsGPUBusy`, par image)                                                     |
| Segments de durée nulle ou de 0,2 à 2 s         | Effets lancés à la main **qui se chevauchent** (jusqu'à 4 ensemble), et lancés pendant que Studio avait le focus : la quasi-totalité de leur durée tombe hors du jeu | Segment = état du calque (aucun effet, un effet, une combinaison) ; phases seulement pour un effet seul    |
| Saccades dans des segments « sans effet »       | Le jeu passe en composition et saccade jusqu'à **1,3 s avant** que le relevé du premier plan (2 fois/s) ne voie l'Alt+Tab                                            | Exclusion de 1,5 s avant la perte du focus à 1 s après son retour ; 0,3 s de marge après chaque changement |
| Horloges                                        | **Pas de décalage** : le jeu revient en Independent Flip de −174 à +20 ms autour du relevé de Studio qui voit la fin des effets (relevés toutes les 250 ms)          | Contrôle d'horloge ajouté au rapport, à chaque apparition et disparition du calque                         |

Ce qui reste exploitable : **433 s sans calque**, jeu au premier plan, et **41 s avec calque**. Ces 41 s se
répartissent ainsi : Brouillard 10 s, Brouillard + Écran retourné 10 s, Écran ivre + Couleur 10 s, Flou + Miroir + Zoom
4 s, quelques secondes pour d'autres combinaisons. **Aucun effet n'est mesurable seul** : pas de coût par effet à tirer
de cette séance. Hors Chaos, une pause du jeu de 2,4 s à 189 s (étape « OBS », Studio fermé, GPU à 0 %) vient
d'Overwatch lui-même.

### 8.2 Ce que montrent les données brutes (images PresentMon retenues)

| Condition                                          | FPS  | 1 % bas | p99 (ms) | Images ≈ 1 période | **Images de 2 périodes (33 ms)** | Mode de présentation             | SyncInterval | GPU du jeu (ms/image) |
| -------------------------------------------------- | ---- | ------- | -------- | ------------------ | -------------------------------- | -------------------------------- | ------------ | --------------------- |
| Jeu au premier plan, **sans calque** (433 s)       | 57,7 | 33,3¹   | 19,6     | 98,9 %             | **0,0 %** (2 images)             | Hardware: Independent Flip 100 % | 0 (tearing)  | 9,4                   |
| Jeu au premier plan, **avec calque** (41 s)        | 57,2 | 29,1    | 33,9     | 92,1 %             | **4,9 %** (116 images)           | Composed: Flip 99 %              | 1            | 4,5                   |
| Jeu en arrière-plan, composé **sans Chaos** (32 s) | 60,0 | —       | —        | 97,7 %             | **0,0 %**                        | Composed: Flip 100 %             | 1            | 3,7                   |

¹ Tiré vers le bas par la pause de 2,4 s d'Overwatch à 189 s ; hors de cette pause, le 1 % bas est de 49 à 51.

Détail des périodes avec calque : Brouillard 2,5 % d'images doublées, Brouillard + Écran retourné 3,3 %, Écran ivre +
Couleur 8,9 %, Flou + Miroir + Zoom 11,8 %. Brouillard seul, ses 5 premières secondes : 0 %.

### 8.3 Diagnostic

**Démontré :**

- **Le calque visible fait passer Overwatch de « Hardware: Independent Flip » à « Composed: Flip »** : 99 % des
  images avec calque, 0 % sans. Le jeu revient en Independent Flip au moment où le calque disparaît, à la précision
  des relevés de Studio (250 ms). Il fait la même chose quand il perd le focus : c'est la composition de Windows, pas
  un effet particulier.
- **En composition, Overwatch présente avec `SyncInterval 1`, sans tearing.** En Independent Flip, il présente avec
  `SyncInterval 0` et tearing permis. La corrélation est de 100 % sur 45 334 images. Ses images sont alors calées sur
  le rafraîchissement : 16,7 / 33,4 / 50 ms.
- **Ce n'est pas le coût des shaders.** Les images doublées apparaissent avec des effets légers (Miroir, Zoom, Flou :
  0,16–0,23 ms de GPU) comme avec Brouillard (0,6 ms). Avec les mêmes effets actifs, on passe de 0 à 10 images
  doublées par seconde selon les moments. Le GPU du jeu par image **baisse** avec le calque (4,5 contre 9,4 ms) au
  lieu de monter.

**Mesuré :** avec calque, le jeu produit **autant d'images** (57,2 contre 57,7 i/s). La différence est leur
régularité : 4,9 % durent 2 périodes (33 ms), suivies d'images de rattrapage plus courtes ; sans calque, 0,0 %. Le
p99 passe de 19,6 à 33,9 ms.

**Probable — le mécanisme : un jeu à ~58 i/s dans une composition à 59,94 Hz.**

- Au premier plan, Overwatch se limite à ~58 i/s : 17,2 ms par image en Independent Flip, très régulier.
- Dans une composition synchronisée à 59,94 Hz, 58 images par seconde ne peuvent pas tomber régulièrement. Environ
  2 rafraîchissements par seconde n'ont pas d'image neuve, et l'image précédente reste 33 ms.
- Attendu : (59,94 − 57,7) / 57,7 ≈ 3,5 à 4 % d'images doublées ; mesuré : 4,9 %.
- Indice concordant : en arrière-plan, le jeu composé tourne à 60 i/s et n'a aucune image doublée.
- L'origine de la limite à 58 (réglage d'Overwatch, Reflex ou G-SYNC) n'est pas connue.

**Observé, cause hypothétique :** avec calque, les instants d'affichage (`MsBetweenDisplayChange`) tombent à 49 % sur
une grille de 6,94 ms (144 Hz, la fréquence de l'écran gauche) au lieu de 16,68 ms. Sans Chaos, en composition, 89 %
tombent sur la grille 60 Hz. Hypothèse : la composition de Windows se cale sur l'écran à 144 Hz quand le calque est
présent, ce qui rend l'affichage encore moins régulier. À confirmer seulement si l'A/B le justifie.

**Non mesuré :** le coût propre à chaque effet en jeu ; le coût GPU de la composition par `dwm` (10 à 30 % selon les
relevés, sans référence propre) ; la latence ajoutée.

**Réponse provisoire.** Oui, Chaos introduit des micro-saccades mesurables pendant qu'un effet est visible : environ
une image sur vingt reste affichée 33 ms au lieu de 16,7.

- **Cause principale, telle que mesurée** : le passage du jeu en composition par Windows, synchronisée sur 60 Hz,
  combiné à la limite à ~58 i/s d'Overwatch. Ce n'est **pas** le calcul des effets.
- **Aucune perte d'images/s n'est donnée** : le nombre d'images ne baisse pas de façon mesurable, et 41 s de données
  avec des effets mêlés ne suffisent pas à conclure.

### 8.4 Ce qui a été corrigé dans l'outil

`apps/chaos-engine/tools/mesure-jeu.mjs` :

- les calculs (FPS, 1 % bas, segments, exclusions, GPU du jeu, contrôle d'horloge) ;
- de nouvelles colonnes : images de 2 rafraîchissements ou plus, affichage hors de la grille du rafraîchissement (et
  sur celle de l'autre écran), mode de présentation, `SyncInterval` ;
- un tableau « par condition », en plus du tableau « par segment » ;
- la lecture des données compressées ;
- le mode `--ab` (§ 8.5).

Auto-tests : `--self-test` (analyse, 9 vérifications, dont « FPS jamais sous le 1 % bas », effets chevauchés,
Alt+Tab, horloge) ; le déroulé A/B est testé avec le vrai runtime de Studio (§ 8.6). Le moteur, la capture directe,
le curseur et le relais ne changent pas.

### 8.5 Test A/B de confirmation (à faire par Antoni, après son accord)

**But.** Isoler le coût fixe du calque et de la composition, indépendamment des shaders :

- **sans calque** : Overwatch + OBS ;
- **calque neutre** : l'effet interne `diag.watermark`, qui suit exactement le trajet d'un Miroir (capture, image
  plein écran, présentation continue) avec un filigrane de 2/255, invisible ;
- **Miroir** ;
- **Brouillard**.

**Prédiction si le diagnostic est juste** : le calque neutre a **autant** d'images doublées que Miroir et
Brouillard, et la période sans calque n'en a aucune.

**Déroulé automatique, ~5 min, sans Alt+Tab.** L'ordre est : calque neutre, Miroir, Brouillard, Brouillard, Miroir,
calque neutre. Chacun passe par le Performance Lab de Studio, comme le bouton « Lancer la mesure » : 10 s sans effet,
25 s d'effet sur l'écran de sa fiche, 10 s sans effet. Rien ne pilote le jeu, la souris, le clavier ni OBS.

1. Studio ouvert (0.1.44-chaos.9 pour les compteurs d'OBS), puis **réduit**. OBS ouvert sur la scène Fullscreen, sans
   diffuser. Overwatch en fenêtré sans bordure, Champ d'entraînement, réglages inchangés.
2. Terminal **administrateur** :

   ```bat
   cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\chaos-v2"
   node apps\chaos-engine\tools\mesure-jeu.mjs --ab
   ```

3. Appuie sur Entrée, puis reviens **dans le jeu dans les 10 s**. Joue ensuite toujours au même endroit et de la même
   façon, **sans quitter le jeu**, jusqu'à ce que la console affiche le rapport (environ 5 min). `q` puis Entrée
   arrête tout.
4. Le rapport s'écrit dans `docs\chaos\bench\jeu-<date>` : tableau « A/B · aucun effet / diag.watermark / mirror /
   fog ».

**À me dire en même temps, sans rien changer** : dans Overwatch, la limite d'images/s, V-Sync, triple buffering et
Reflex ; dans le panneau NVIDIA, la synchronisation verticale, G-SYNC (et si elle est active en fenêtré) et le mode
faible latence. C'est ce qui permettra d'expliquer la limite à ~58 i/s.

**Témoin optionnel, sans Chaos, 1 min.** Il montre si une fenêtre ordinaire par-dessus le jeu fait la même chose :

1. Gestionnaire des tâches › Options › « Toujours visible », petite fenêtre posée sur un coin de l'écran du jeu.
2. `node apps\chaos-engine\tools\mesure-jeu.mjs`, puis tape `temoin` et Entrée, et joue 30 s.
3. Reviens à la console : tape `fenetre` et Entrée, puis joue 30 s avec le Gestionnaire visible par-dessus.
4. `q` puis Entrée.

**Ensuite seulement**, selon le résultat :

- explication de la limite à 58 i/s, ou de la grille 144 Hz (un essai avec l'écran gauche à 60 Hz suffirait) ;
- puis, si le diagnostic est confirmé, une étude de ce qui permettrait au jeu de rester en Independent Flip sous le
  calque, par exemple un plan d'incrustation matériel (MPO).

Rien n'est proposé ni modifié avant ces mesures.

### 8.6 Premier A/B (25/11, 14 h 56) : interrompu au 2e essai, cause et correction

**Ce qui s'est passé.**

| Temps    | Événement                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------- |
| 190,7 s  | 1er essai démarré : le calque neutre                                                                 |
| 201,8 s  | calque neutre affiché (25 s)                                                                         |
| 226,8 s  | calque neutre retiré                                                                                 |
| ~236,7 s | fin de la phase « après » (`done`)                                                                   |
| 237,13 s | le collecteur demande Miroir 0,4 s plus tard : Studio répond « une mesure en jeu est déjà en cours » |

**Cause** (code de `apps/studio/server/src/chaos/perf.ts`, reproduite par un test) :

- À la fin d'une mesure, le Performance Lab passe à `done`, puis tue le processus de télémétrie.
- Mais sa place (`liveProc`, qui sert au refus « déjà en cours ») n'était rendue que lorsque Windows signalait la sortie
  de ce processus, un peu plus tard.
- Une demande arrivée entre les deux était refusée. Le collecteur, lui, ne regardait que le texte du statut.
- Second défaut, latent : la sortie tardive d'une ancienne télémétrie pouvait libérer la place de la mesure suivante.

**Correction côté Studio (prochaine version de test) :**

- la télémétrie est libérée au moment même où la mesure se termine (`done`, `failed` ou `cancelled`) ;
- la sortie d'un processus ne libère que sa propre place ;
- l'état publie `live_available` (une mesure peut démarrer maintenant) ;
- `stopLive` termine aussi une télémétrie restée en vie.

**Correction côté collecteur.** Le déroulé est dans `apps/chaos-engine/tools/ab-run.mjs`, partagé avec les tests. À
chaque essai, il vérifie l'état **sur le serveur** :

1. Studio libre (`live_available`, ou statut et effets actifs avec chaos.9) ;
2. démarrage ; un refus « busy » est redemandé **tant que le serveur le répond**, jusqu'à 15 s, sans délai fixe ;
3. mesure de cet effet confirmée par le serveur ;
4. `done` et nouveau résultat enregistré pour cet effet ;
5. effet retiré du moteur.

En cas d'échec ou d'arrêt (`q`) : mesure arrêtée, effet arrêté, vérification qu'aucun effet ne reste actif (sinon
STOP ALL), puis l'état final est affiché.

**Tests.** `apps/studio/server/test/chaos-perf-chain.test.ts`, avec le vrai Performance Lab et le vrai runtime Studio
(API HTTP), un faux moteur et une fausse télémétrie, sans rien afficher :

- six mesures enchaînées dans la boucle même où `done` apparaît (ce test échoue avec l'ancien code) ;
- l'A/B complet par l'API : six essais confirmés, ni mesure ni effet restants ;
- un essai qui échoue : arrêt et état propre ;
- un Studio d'avant le correctif (chaos.9) qui répond « busy » juste après `done` : redemandé sans échec.

**Données du calque neutre (essai 1, valides).** Jeu au premier plan tout du long, 24,4 s exploitables, horloges
cohérentes (−196 ms à l'apparition, +19 ms à la disparition).

- **Moteur Chaos** (télémétrie enregistrée par Studio) : 58,5 images présentées et capturées par seconde, traitement
  p95 de 0,8 ms. Il n'a pas calé.
- **Overwatch pendant le calque** : 27,9 i/s, p99 217 ms, 40,7 % d'images de 2 rafraîchissements ou plus, une image de
  3,1 s, 2 s sans aucune image. Avant et après : 58 i/s, stables.
- **Lecture** : le jeu attend la composition de Windows. Ses intervalles sont des multiples du rafraîchissement (33 à
  500 ms) avec 4 à 5 ms de GPU par image. Le GPU de `dwm` passe de 8 à 16,5 %, et OBS reçoit moins d'images de
  l'écran (GPU d'OBS de 20 à 8 %).

C'est bien plus fort que pendant la première séance (4,9 %). Un seul essai, sans Miroir ni Brouillard dans les mêmes
conditions, ne permet **pas** de conclure : c'est l'objet des six essais.

## 9. A/B du 25/11 (15 h 39) : PresentMon contre le ressenti, cause dans le moteur, correction

Données : `docs/chaos/bench/jeu-2026-11-25-15h39/`, 6 essais sur 6 : calque neutre, Miroir, Brouillard, Brouillard,
Miroir, calque neutre. S'y ajoute la télémétrie du moteur enregistrée par Studio pour chaque essai
(`perf/live-results.json`, lu sans rien modifier).

Ressenti d'Antoni :

- Brouillard : aucun ralentissement perceptible ;
- Miroir et calque neutre : quelques ralentissements ;
- la fluidité variait selon l'endroit du champ de tir ;
- le jeu restait jouable.

### 9.1 Ce que disent les mesures

| Essai         | PresentMon : images du jeu/s | Moteur : captures du jeu/s | Moteur : images présentées/s | Moteur : attente capture → rendu (p95) | Processeur d'Overwatch avant / pendant / après |
| ------------- | ---------------------------- | -------------------------- | ---------------------------- | -------------------------------------- | ---------------------------------------------- |
| Sans calque   | 57,4                         | —                          | —                            | —                                      | —                                              |
| Calque neutre | 27,8 (deux essais)           | 59,5 et 57,5               | 59,5 et 57,5                 | 1,0 et 16,8 ms                         | 6,5 / 6,8 / 8,9 % et 8,3 / 8,1 / 6,4 %         |
| Miroir        | 28,9 (deux essais)           | 59,1 et 58,5               | **50,7 et 52,5**             | **15,9 et 16,4 ms**                    | 8,9 / 7,2 / 6,3 % et 6,1 / 6,9 / 6,1 %         |
| Brouillard    | 21,1 (deux essais)           | (pas de capture)           | 59,0 et 58,8                 | —                                      | 8,0 / 7,6 / 6,1 % et 6,9 / 7,7 / 8,4 %         |

Carte graphique (nvidia-smi) :

| Condition   | Fréquence | Puissance | Charge |
| ----------- | --------- | --------- | ------ |
| Sans calque | 800 MHz   | 57 W      | 64,5 % |
| Avec calque | 1888 MHz  | 110 W     | 40,9 % |

La charge baisse parce que la carte tourne 2,4 fois plus vite, pas parce qu'elle travaille moins.

### 9.2 Le contraste avec le ressenti : PresentMon sous-compte les images d'Overwatch quand le calque est affiché

**Démontré.** Quatre signaux indépendants contredisent les 21 à 29 i/s de PresentMon et ses pauses de 1 à 2 s :

1. La capture de la fenêtre du jeu par le moteur reçoit **57,5 à 59,5 images neuves par seconde**. Elle n'en reçoit
   qu'à chaque changement de l'image du jeu.
2. Le processeur d'Overwatch ne bouge pas : avant, pendant et après, 6 à 9 %. Un jeu tombé à la moitié de sa cadence
   en consommerait nettement moins.
3. La charge GPU totale reste la même (≈ 40 %).
4. Le ressenti : une pause de 1,8 s pendant Brouillard ne pourrait pas passer inaperçue.

**Hypothèse sur la cause de l'erreur.** Quand le jeu est composé avec le calque, PresentMon perd des événements de
présentation, ou n'arrive pas à suivre ces présentations jusqu'au bout. Il compte alors les intervalles entre les
images qu'il a vues.

**Conséquences :**

- les chiffres de PresentMon **en mode composé** sont faux ici (§ 8.2 à 8.6 : 4,9 %, 40,7 %, 27,9 i/s…) ;
- ceux du jeu **seul**, en Independent Flip, restent valables ;
- le passage en composition lui-même reste démontré : le mode change à l'instant où le calque apparaît et disparaît.

**Ce qu'Antoni voit vraiment pendant un effet.**

- **Brouillard** est un calque sans capture : on voit le jeu lui-même, à travers. Il garde ses ~58 i/s, d'où
  l'absence de ralentissement.
- **Miroir et le calque neutre** remplacent l'écran par l'image redessinée par le moteur : on voit la cadence du
  moteur, et ses pertes.

### 9.3 Cause concrète dans le moteur (Miroir et les effets cadencés), corrigée

- **Mesuré.** Miroir présentait **50,7 à 52,5 images/s pour 58,5 à 59,1 captures/s** : une image du jeu sur sept ou
  huit n'était jamais montrée. Une capture attendait aussi ~16 ms (p95) avant d'être redessinée. Le calque neutre, lui,
  présentait autant qu'il capturait.
- **Cause.**
  - Un effet « cadencé » (curseur suivi, animation par l'horloge, transition) ne se redessinait qu'au retour de
    balayage de l'écran. C'est le cas de Miroir, Écran retourné, Zoom, Tremblement, Écran ivre, Vision tunnel et VHS.
  - Les captures du jeu arrivent à ~58 par seconde, en tremblant autour de ce retour. Quand deux tombaient entre deux
    retours, la première était remplacée sans avoir été montrée.
  - Le calque neutre se redessine à chaque capture, il ne perdait rien.
- **Correction** (commit `ddbe54bd`, `Model/Cadence.cs` et `Host/Engine.cs`) :
  - un effet cadencé redessine **chaque nouvelle capture dès son arrivée** ;
  - le retour de balayage ne redessine que s'il n'a vu aucune capture depuis le précédent (animation, curseur, image
    figée) ;
  - inchangés : la cadence plafonnée (profil économie), les filtres sans cadence, les calques sans capture, la capture
    directe vers OBS, le curseur unique et sa transformation, le relais anti-écran noir.
- **Coût** : au plus un rendu de plus dans une période où la capture arrive juste après le retour de balayage (jamais
  plus de 2 par période ; 0,1 à 0,6 ms de GPU chacun).
- **Tests** (`chaos-unit`, 38/38) : la nouvelle règle, les cas inchangés, et une simulation de 60 s (écran à
  59,94 Hz, jeu à 58 i/s, arrivées à ±3 ms du retour de balayage). Résultat : **25,5 % des images du jeu jamais
  montrées avec l'ancienne règle, 0 % avec la nouvelle**.
- **Résultat attendu en jeu.** Mesurable dans Studio › Chaos › Performance Lab › Validation en jeu, sans PresentMon :
  - pour Miroir, « images présentées » ≈ « captures » (≈ 58 au lieu de ~51) ;
  - l'attente capture → rendu passe de ~16 ms à 1–2 ms, donc une image de latence en moins.

### 9.4 Configuration relevée (lecture seule, rien changé)

| Où           | Réglage                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Écrans       | principal XB273U 2560×1440 à **59,94 Hz** (capable de 144 Hz) ; secondaire 1920×1080 à **144 Hz** ; HAGS coupé                                        |
| Overwatch    | plein écran fenêtré (sans bordure), **V-Sync activée**, **triple buffering activé**, **Reflex « Activé + Boost »**, cible 60 i/s (`DesiredFrameRate`) |
| Comportement | seul : Independent Flip, ~58 i/s très réguliers (V-Sync + Reflex se calent juste sous 60 Hz) ; avec un calque ou sans le focus : composé, synchronisé |

### 9.5 Manipulations discriminantes et réversibles (après la 0.1.44-chaos.10, une à la fois)

Mesure de chacune, hors live, 1 min : Performance Lab › Validation en jeu, **Miroir**, 10 / 25 / 10 s. On relève
« images présentées », « captures » et l'attente capture → rendu, plus le ressenti. Puis la même chose avec le calque
neutre si tu veux.

**1. Écran gauche à 60 Hz** (teste la composition à fréquences mélangées, la grille 144 Hz du § 8.3).

- Réglage : Paramètres › Système › Écran › écran gauche › Affichage avancé › Fréquence d'actualisation : 144 → 60 Hz.
- Retour : remettre 144 Hz au même endroit.
- Si la saccade restante disparaît, la configuration conseillée est des fréquences identiques pendant les sessions
  Chaos.

**2. G-SYNC en fenêtré, dans le panneau NVIDIA.** C'est elle qui décide si la composition suit la cadence du jeu.

- Réglage : Affichage › Configurer G-SYNC. Note d'abord le réglage actuel (activé ou non ; « plein écran
  uniquement » ou « fenêtré et plein écran »), puis essaie l'autre mode de l'écran XB273U.
- Retour : remettre le réglage noté.

**3. V-Sync d'Overwatch**, qui détermine le comportement du jeu une fois composé.

- Réglage : Options › Vidéo › Synchronisation verticale : Activée → Désactivée. Garde Reflex et la limite d'images
  telles quelles ; si le jeu dépasse 60 i/s, règle la limite personnalisée à 58.
- Retour : la réactiver.

### 9.6 Verdict

- **Cause la plus probable des ralentissements ressentis** : le moteur perdait une image du jeu sur sept ou huit dans
  les effets cadencés comme Miroir. C'est mesuré et corrigé. Le reste vient de la composition de Windows, imposée par
  tout calque par-dessus le jeu.
- **Les chiffres catastrophiques de PresentMon** pendant les effets sont une erreur de mesure en mode composé ; le jeu
  gardait ses ~58 i/s.
- **Première action** : installer la 0.1.44-chaos.10 et refaire la mesure Miroir du Performance Lab (1 min).
- **Résultat attendu** : présentées ≈ captures, une image de latence en moins, Miroir aussi fluide que le calque
  neutre.
- **Limites** :
  - la composition de Windows reste inévitable tant qu'une fenêtre couvre le jeu ;
  - pendant un effet, la carte graphique quitte son mode économe (800 → 1900 MHz, +53 W), sans effet sur les i/s du
    jeu ;
  - il peut rester une légère irrégularité liée à la synchronisation 60 Hz et à l'écran à 144 Hz : c'est à confirmer
    par les manipulations 1 à 3 ;
  - PresentMon n'est pas fiable en mode composé : se fier au Performance Lab.
