# Catalogue des effets Chaos V2

10/11/2026. Proposition, rien n'est construit. Les coûts GPU sont des **estimations** (HYPOTHÈSE) pour une RTX 3070 en
1440p, à confirmer par le protocole de mesure ([RECHERCHE § 6](RECHERCHE_CHAOS_V2.md)).

## 1. Trois façons de rendre un effet

| Mode        | Principe                                                                       | Coût de base                                    | Vu par OBS   |
| ----------- | ------------------------------------------------------------------------------ | ----------------------------------------------- | ------------ |
| **Capture** | le lecteur natif capture le jeu et le redessine transformé                     | capture + 1 à 2 images de latence + composition | oui (mode D) |
| **Calque**  | le lecteur natif dessine **par-dessus** le jeu, sans le capturer (transparent) | composition seulement                           | oui          |
| **Média**   | vidéo alpha avec son dans la fenêtre Electron (screamers)                      | décodage vidéo                                  | oui          |

Le mode **Calque** est toujours moins cher. Un effet n'utilise la capture que s'il **déforme** l'image du jeu.

## 2. Classement

Notes de 1 à 5 : **Imp.** = impact visuel ; **Viewers** = intérêt pour les viewers ; **Gêne** = risque de gêne
excessive (5 = élevé) ; **Cx.** = complexité. Coût GPU estimé par image : **·** < 0,3 ms, **··** 0,3 à 1 ms, **···** > 1 ms.

### Orientation (capture)

| Effet                                                | Imp. | Viewers | Gêne | GPU | Cx. | Verdict                       | Variantes                                              |
| ---------------------------------------------------- | ---- | ------- | ---- | --- | --- | ----------------------------- | ------------------------------------------------------ |
| **Écran retourné 180°**                              | 5    | 5       | 3    | ·   | 2   | **Lot 1**                     | entrée « bascule » 350 ms ou instantanée ; 15 s / 30 s |
| Miroir horizontal                                    | 4    | 4       | 3    | ·   | 1   | **Lot 1**                     | 15 s / 30 s                                            |
| Retournement vertical                                | 4    | 3       | 3    | ·   | 1   | Lot 1                         | 15 s                                                   |
| Écran penché (8 à 15°, agrandi pour couvrir)         | 3    | 3       | 2    | ·   | 2   | Lot 3                         | léger / fort                                           |
| Puzzle (écran découpé en 2×2 ou 3×3 cases permutées) | 5    | 5       | 4    | ·   | 2   | Lot 3 (nouveau)               | 2×2 / 3×3                                              |
| Dérive (zoom lent + déplacement du cadrage)          | 3    | 3       | 4    | ·   | 2   | à tester (mal des transports) | —                                                      |

### Perception (capture, sauf indication)

| Effet                                                                             | Imp. | Viewers | Gêne | GPU | Cx. | Verdict                                                     | Variantes                                                                         |
| --------------------------------------------------------------------------------- | ---- | ------- | ---- | --- | --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Flou** (Dual Kawase, réduit)                                                    | 4    | 4       | 3    | ··  | 2   | **Lot 2**                                                   | léger / moyen / fort, calibrés pour rester **lisibles** (V1 « parfois excessif ») |
| **Brouillard V2** (contraste réduit, voile coloré, bruit lent, plus dense en bas) | 4    | 4       | 3    | ·   | 2   | **Lot 2** (remplace le `div` V1)                            | léger / dense                                                                     |
| **Vision tunnel** (fonction de distance, bord doux)                               | 4    | 4       | 3    | ·   | 1   | **Lot 2**, en **calque** (pas de capture)                   | large / étroite                                                                   |
| Clignement (paupières)                                                            | 3    | 3       | 2    | ·   | 1   | Lot 2, calque                                               | —                                                                                 |
| Aberration chromatique (écran « qui dédouble »)                                   | 3    | 3       | 2    | ·   | 1   | Lot 3                                                       | léger / fort                                                                      |
| Chaleur / ondulation                                                              | 3    | 3       | 3    | ·   | 2   | Lot 3                                                       | —                                                                                 |
| Noir et blanc / vision nocturne                                                   | 3    | 3       | 1    | ·   | 1   | Lot 3                                                       | gris / vert                                                                       |
| Tache aveugle (centre flou, bords nets)                                           | 4    | 4       | 4    | ··  | 2   | Lot 3 (nouveau)                                             | petite / grande                                                                   |
| Couleurs inversées                                                                | 4    | 3       | 4    | ·   | 1   | Lot 3, **entrée et sortie en fondu ≥ 500 ms** (sinon flash) | —                                                                                 |

### Lisibilité (capture)

| Effet                                                                                      | Imp. | Viewers | Gêne | GPU | Cx. | Verdict                         | Variantes     |
| ------------------------------------------------------------------------------------------ | ---- | ------- | ---- | --- | --- | ------------------------------- | ------------- |
| **Signal corrompu V2** (décalage RGB par blocs, lignes, gel d'une bande, ~8 changements/s) | 5    | 5       | 3    | ··  | 3   | **Lot 2** (V1 « trop discret ») | léger / panne |
| Pixellisation                                                                              | 3    | 3       | 2    | ·   | 1   | Lot 3                           | 3 niveaux     |
| VHS / CRT (scanlines, courbure, bruit)                                                     | 4    | 4       | 2    | ··  | 2   | Lot 3                           | —             |
| Neige TV (bruit par-dessus, partiel)                                                       | 3    | 3       | 2    | ·   | 1   | Lot 3, calque                   | —             |
| Datamosh (traînées de l'image précédente)                                                  | 5    | 4       | 4    | ··  | 3   | à prototyper                    | —             |

### Calques et décor (sans capture)

| Effet                                       | Imp. | Viewers | Gêne | GPU | Cx. | Verdict                                                                             |
| ------------------------------------------- | ---- | ------- | ---- | --- | --- | ----------------------------------------------------------------------------------- |
| Pluie sur la vitre (gouttes qui réfractent) | 4    | 4       | 2    | ··  | 3   | Lot 3 : **capture** nécessaire pour la réfraction ; sinon gouttes simples en calque |
| Sang / éclaboussure (sprites alpha)         | 4    | 4       | 2    | ·   | 2   | Lot 3                                                                               |
| Neige qui tombe / givre sur les bords       | 3    | 3       | 1    | ·   | 2   | Lot 3 (saisonnier)                                                                  |
| Barres cinéma + vignette                    | 2    | 2       | 1    | ·   | 1   | Lot 3, peu cher, à vendre bon marché                                                |
| Toile d'araignée dans un coin               | 2    | 3       | 1    | ·   | 1   | saisonnier                                                                          |

### Médias

| Effet                                               | Verdict                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| Screamers et apparitions (26 + 4 vidéos existantes) | **gardés tels quels** (fenêtre médias ouverte seulement pendant la lecture) |
| Nouveaux médias                                     | ajout par catalogue, sans code                                              |

### Positifs et humoristiques

| Effet                                          | Mode                                    | Verdict                                      |
| ---------------------------------------------- | --------------------------------------- | -------------------------------------------- |
| Confettis / pluie de Jetons                    | calque (sprites)                        | Lot 3 : gentil, peu gênant, bon prix d'appel |
| « GG » / message d'un viewer à l'écran         | calque (texte modéré, longueur limitée) | Lot 4, demande une **modération** du texte   |
| Projecteur (cercle de lumière, reste assombri) | calque                                  | Lot 4                                        |

### Interaction viewer : repère sur l'écran

Un viewer place un **ping ou une flèche** sur une image de l'écran. Le repère reste 5 à 10 s, purement graphique.

- Exige une extension de type **video overlay** pour cliquer sur la vidéo, absente sur mobile. Variante mobile : une
  miniature de l'écran dans le panneau.
- Retard du flux : 2 à 5 s. Le repère n'est donc utile que pour des cibles qui ne bougent pas.
- Verdict : **Lot 5**, après une maquette dans l'extension.

### Combinaisons (presets cohérents, pas d'empilement libre)

| Preset    | Contenu                                              | Verdict               |
| --------- | ---------------------------------------------------- | --------------------- |
| Cauchemar | brouillard dense + vision tunnel + yeux dans le noir | Lot 3                 |
| Panne TV  | signal corrompu + neige TV + scanlines               | Lot 3                 |
| Ivresse   | chaleur + léger penché qui oscille ≤ 3°              | **à tester** (nausée) |

## 3. À abandonner

| Effet                                                                          | Raison                                                                                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Curseur retourné avec l'écran / faux curseur                                   | contraire au résultat demandé ; seul moyen = cacher le vrai curseur (état système)                                      |
| Inversion ou ralentissement de la souris, « touches mélangées »                | **règle n°1**                                                                                                           |
| Rotation continue (l'écran qui tourne), secousses fortes sur l'écran du joueur | nausée, aucun réglage ne la rend sûre ; secousses permises **sur le stream seulement**                                  |
| Stroboscope, flashs répétés, flash rouge                                       | WCAG 2.3.1                                                                                                              |
| Flashbang plein blanc instantané                                               | remplacé par « Éblouissement » : montée 150 ms jusqu'à 85 % de blanc, une seule fois, sortie en 3 s, refusé en mode sûr |
| Glitch V1 (`putImageData` étiré) et brouillard V1 (`div`)                      | remplacés par les versions V2 sur capture                                                                               |

## 4. Sécurité et accessibilité (plafonds proposés, réglables dans Studio)

| Règle                                                       | Valeur par défaut                                                           | Mode sûr             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------- |
| Changements de luminance > 10 % sur plus de 25 % de l'écran | ≤ 2 par seconde                                                             | ≤ 1 par seconde      |
| Flash rouge saturé                                          | interdit                                                                    | interdit             |
| Vitesse de rotation                                         | ≤ 520°/s, avec accélération et décélération progressives (180° en ≥ 350 ms) | rotation instantanée |
| Durée maximale d'un effet sur l'écran du joueur             | 30 s (absolue : 60 s)                                                       | 15 s                 |
| Effets de capture simultanés                                | 1                                                                           | 1                    |
| Calques simultanés                                          | 2, en plus de la capture                                                    | 1                    |
| Repos entre deux effets de la famille « Orientation »       | 2 min                                                                       | 5 min                |
| Éblouissement, Couleurs inversées, Puzzle, Datamosh         | autorisés                                                                   | **refusés**          |

Le **mode sûr** se règle dans Studio. Le Core refuse alors les variantes interdites **avant** le débit : jamais de
paiement pour un effet refusé localement.
