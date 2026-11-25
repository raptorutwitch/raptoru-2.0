# Chaos Performance Lab

Page **Studio › Chaos › Performance Lab** (bouton dans l'en-tête de la page Chaos). Elle mesure le coût des effets et
pilote les mesures natives du moteur : un navigateur ne peut mesurer ni le GPU du moteur, ni un jeu. Code :
`apps/chaos-engine/src/Host/PerfLab.cs` (moteur), `apps/studio/server/src/chaos/perf.ts` (serveur),
`apps/studio/web/src/pages/chaos-perf.ts` (page). Tests : `apps/studio/server/test/chaos-perf.test.ts`.

## 1. Matériel

`ChaosEngine.exe --sysinfo` donne :

- la carte graphique et sa mémoire vidéo ;
- le processeur et ses cœurs logiques ;
- la mémoire ;
- Windows (Windows 11 reconnu par son numéro de build) ;
- les écrans (taille, fréquence) ;
- la version du moteur.

Ni nom de machine ni nom d'utilisateur.

## 2. Mode A : banc hors écran (automatique)

`ChaosEngine.exe --perf-offscreen --w --h --frames --warmup --profile --parent --deadline-ms`

**Ce qu'il mesure :**

- **Les cas.** Une référence (image recopiée, sans effet), puis chaque effet public, aux niveaux Marqué et Extrême s'il
  en a, puis six combinaisons lourdes au niveau Extrême. Chaque cas est rendu sur une **scène de jeu de synthèse qui
  bouge**, la même à chaque banc, à la résolution de l'écran choisi.
- **Le temps GPU par image.** Il est relevé par des requêtes d'horodatage, une par image, avec la médiane, p95, p99 et
  le maximum. Une file vidée à chaque image, comme un Present, garde chaque mesure.
- **Le reste, par cas :**
  - le temps CPU de préparation et d'envoi des commandes ;
  - les allocations du moteur par image ;
  - l'écart de mémoire vidéo ;
  - le nombre de passes et de calques.
- **Le surcoût d'un effet** = sa médiane moins celle de la référence.
- **La synthèse :**
  - les trois effets les moins coûteux et les trois plus coûteux ;
  - les effets « à surveiller », au-delà de 1 ms en p95 à 1440p (seuil mis à l'échelle des pixels) ;
  - les effets « à optimiser », au-delà de 2 ms ;
  - les combinaisons les plus lourdes ;
  - les cas non mesurés.

**Ce qu'il ne mesure pas :** ni capture, ni présentation, ni jeu. C'est un coût relatif entre effets, **jamais** des
images/s de jeu.

**Sûreté :**

- Rien ne s'affiche : aucune fenêtre, aucune capture.
- Le banc **refuse de démarrer, et s'arrête entre deux cas**, si un jeu ou une application plein écran est actif. La
  page affiche la raison.
- Il s'arrête aussi si Studio disparaît (`--parent`) ou à son échéance (15 min).
- **Annulation** = le processus est tué. Plus aucun résultat n'arrive ensuite, et aucun processus orphelin ne reste
  (vérifié par les tests).
- `--smoke` (160×90, quelques images) sert aux tests automatiques ; il est permis même pendant un jeu, sa charge est
  négligeable.

**Côté page :**

- écran de référence, images par cas (120 / 240 / 600), profil (qualité, équilibré, économie) ;
- progression réelle (n/N, cas en cours) ;
- tableau des résultats et synthèse ;
- exports **JSON**, **CSV** (séparateur `;`, BOM UTF-8 pour Excel) et **rapport HTML** autonome.

Le dernier banc est gardé dans `<dossier d'état>/perf/offscreen-last.json`.

## 3. Mode B : validation en jeu (manuelle)

`ChaosEngine.exe --perf-monitor --interval-ms 500 --parent --deadline-ms` relève la télémétrie toutes les 500 ms
environ.

**Ce qui est relevé :**

- **Par processus**, pour le moteur Chaos, le jeu au premier plan, le compositeur de Windows (`dwm`) et OBS
  (`obs64`) :
  - le temps GPU du moteur 3D (compteurs « GPU Engine » de Windows, sans droits d'administrateur) ;
  - le temps processeur ;
  - la mémoire de travail ;
  - la mémoire vidéo dédiée (compteur Windows tel quel ; il compte aussi des surfaces partagées et peut, pour le
    compositeur, dépasser la mémoire de la carte : à lire en écart).
- **La télémétrie interne du moteur pendant l'effet** : traitement p95, latence ajoutée estimée, images présentées et
  capturées, images perdues.

**Déroulé :**

- **Le chronomètre part au premier relevé.**
- **Référence** sans effet.
- **Effet** : déclenché à ce moment-là seulement, par le clic de l'utilisateur, sur l'écran et avec les réglages de sa
  fiche (`effect.activate` avec la durée de la phase).
- **Retour** à la normale.
- Chaque phase dure 5 à 60 s.
- **Arrêter tout de suite** arrête l'effet et la télémétrie ; la mesure partielle n'est pas gardée.

**Résultats, par effet** (50 gardés, `perf/live-results.json`) :

- écarts entre la référence et la phase « effet », en points de % d'utilisation : GPU du jeu, de Chaos, du compositeur,
  d'OBS et total ; processeur du jeu et de Chaos ;
- traitement p95 de Chaos.

**Non mesuré, et dit comme tel :**

- **les images/s du jeu et les à-coups.** Il faudrait PresentMon (traces ETW de Windows, droits d'administrateur). Rien
  n'est injecté dans le jeu ;
- **le coût par source dans OBS.** Il se lit dans le dock « Statistiques » d'OBS pendant l'essai. Studio n'ouvre pas de
  nouvelle connexion à OBS : la limite de 6 connexions a causé l'incident du 22/11.

## 4. Protocole court : Overwatch et OBS

1. Fermer les autres jeux. Dans Studio › Chaos › Performance Lab, lancer d'abord le **banc hors écran** (jeu fermé),
   à la résolution de l'écran du jeu, puis exporter le rapport HTML.
2. Ouvrir OBS (scène habituelle, **capture d'écran** de l'écran du jeu), puis Overwatch en **fenêtré sans bordure**,
   en partie d'entraînement. Afficher le compteur d'images/s d'Overwatch, et le dock « Statistiques » d'OBS.
3. Régler la fiche de l'effet (écran du jeu, niveau voulu). Dans le Performance Lab, **Validation en jeu** : choisir
   l'effet, phases 10/10/10 s, **Lancer la mesure**, puis revenir dans le jeu et jouer normalement pendant les 30 s.
4. Noter les images/s du jeu avant, pendant et après, ainsi que les « images manquées » d'OBS. Le Lab donne les écarts
   GPU et processeur par processus.
5. Un effet à la fois. En cas de problème : **STOP ALL** ou Ctrl+Maj+F11.

## 5. Résultats obtenus

Voir [BENCH_EFFETS.md](BENCH_EFFETS.md) (25/11) : banc par phases des 13 effets à 1440p (`--perf-phases`), OBS isolé
(`chaos-obs-check.exe --effects-load`), classement, et la procédure Overwatch avec l'outil
`apps/chaos-engine/tools/mesure-jeu.mjs` (PresentMon).
