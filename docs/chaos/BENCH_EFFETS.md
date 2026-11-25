# Banc des 13 effets Chaos V2 (25/11/2026)

> **Statut** : phases A (moteur hors écran) et B (OBS isolé) **mesurées** le 25/11, PC au repos, aucun jeu. Phase C
> (Overwatch réel) **préparée**, elle attend Antoni (§ 6). Aucune perte d'images/s n'est mesurée ici : les chiffres
> d'images/s du § 4 sont des **estimations**, marquées comme telles. Branche locale `feat/chaos-studio`.

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
- **Pas encore mesuré** : l'effet sur les images/s d'Overwatch et le coût de la composition de Windows quand le calque
  couvre le jeu. C'est la phase C (§ 6).

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
