# Chaos sur la source gameplay d'OBS (et seulement elle)

> **Suite (24/11) :** Antoni a choisi le mode C (écran + OBS, sans double application). Ce qui est construit, prouvé et
> à faire : [MODE_C.md](MODE_C.md). Cette page reste l'étude des architectures et le premier prototype.

État au 24/11/2026, branche locale `feat/chaos-studio`. **Rien n'a été modifié dans l'OBS d'Antoni** : sa collection de
scènes a été lue, sans écriture. Le prototype tourne dans le vrai moteur d'OBS installé (libobs 33.0.1 et
obs-shaderfilter 2.6.1), chargé hors de l'application OBS, sans fenêtre. Code : `apps/chaos-engine/src/Host/ObsExport.cs`
(export), `apps/chaos-engine/tests/ObsHeadless.cs` (contrôle dans OBS). Tests :
`apps/studio/server/test/chaos-obs-export.test.ts`.

## 1. La demande

Transformer **uniquement la source du contenu diffusé** (l'écran, le gameplay, la capture principale), **avant** sa
composition avec la caméra et les overlays.

- Le spectateur voit l'effet sur le gameplay.
- La webcam, les alertes et l'habillage restent normaux, au-dessus, comme aujourd'hui.
- Les effets existants sont gardés, sans réécriture complète si possible.
- Le moins de copies GPU, de latence et d'impact sur les images/s possible.
- Aucun changement dans l'OBS de Production sans autorisation.

## 2. Ce qui existe chez Antoni (lecture seule, 24/11)

- **OBS 33.0.1.** Plugins utiles déjà installés :
  - obs-shaderfilter 2.6.1 ;
  - Composite Blur ;
  - Freeze ;
  - Source Clone ;
  - Move.
- **La source gameplay est « Écran »**, une capture d'écran (`monitor_capture`) de l'écran droit (2560 × 1440, l'écran
  principal).
  - Elle sert dans « Scène Fullscreen », « Scène Dessin » et « Scène PS5 » (masquée dans cette dernière).
  - La webcam (scène imbriquée « overlay cam shushu »), les Chatbox et les alertes (sources navigateur) sont des sources
    **au-dessus** d'elle.
- **« Écran » porte déjà six filtres Chaos V1, désactivés** : « Raptoru Chaos · Retourné / Miroir / Inversé »
  (shaderfilter) et « Raptoru Chaos · Flou faible / moyen / fort » (Composite Blur).
  - Ils viennent de Chaos V1 (Halloween, `halloween/chaos-obs.ts`).
  - C'est déjà l'architecture « filtre sur la source gameplay », réduite à des réglages fixes.

**Le calque actuel de Chaos V2 (mode E) respecte déjà le périmètre**, à une condition : que la source gameplay soit une
capture d'écran.

- Le calque est posé sur l'écran physique. OBS ne le reçoit donc que **dans « Écran »**, et compose la webcam et les
  alertes par-dessus.
- Il ne transforme jamais la composition entière.

Ses limites viennent de là :

- avec une **capture de jeu ou de fenêtre**, OBS ne voit rien ;
- sur le **bureau** (mode C), les effets qui lisent l'image restent invisibles pour OBS ;
- la barre des tâches est **figée** dans l'image diffusée pendant ces effets ;
- un jeu en **plein écran exclusif** ne peut pas porter de calque.

## 3. Les architectures comparées

| Critère                             | **A. Calque à l'écran, capturé par « Écran »** (V2 actuel)                                       | **B. Filtre OBS sur la source gameplay, piloté par le moteur** (prototype)                     | **C. Source Chaos dédiée (proxy)**                                                | **D. Plugin OBS natif + texture partagée**                                    | **E. Transformations de l'élément de scène**                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Le spectateur voit l'effet          | oui, si la source est une capture d'écran ; pas sur le bureau pour les effets qui lisent l'image | **oui, quelle que soit la capture** (écran, fenêtre, jeu) et sur le bureau                     | oui                                                                               | oui                                                                           | géométriques seulement                                       |
| Webcam et alertes intactes          | oui (composées par OBS au-dessus)                                                                | **oui, par construction** (filtre sur la source) : vérifié, écart 0                            | oui, si la source Chaos est juste au-dessus du gameplay                           | oui                                                                           | oui                                                          |
| Effets existants gardés             | tous, tels quels                                                                                 | **12 sur 13 sans réécriture** (même shader, même logique) ; flash à venir                      | tous                                                                              | tous (mêmes shaders), mais un plugin C++ à écrire                             | non : miroir, retournement, zoom seulement                   |
| Copies GPU                          | capture de la fenêtre + composition du calque par Windows                                        | **aucune capture** : 1 copie de la source + 1 passe par filtre, dans OBS                       | une capture de plus du jeu, un rendu, une copie partagée, puis la capture par OBS | 1 passe, rien de plus                                                         | aucune                                                       |
| Latence ajoutée pour le spectateur  | 1 à 2 images (le calque recopie le jeu)                                                          | **aucune** (même image, même instant)                                                          | 1 à 2 images, avec un saut au début et à la fin                                   | aucune                                                                        | aucune, mais à-coups (pilotage par WebSocket à chaque image) |
| Coût pour le jeu                    | le calque au-dessus du jeu empêche l'affichage direct (« independent flip ») pendant l'effet     | **aucun sur l'écran du joueur** ; travail GPU dans OBS (§ 6)                                   | une capture et un rendu de plus                                                   | comme B                                                                       | nul                                                          |
| Écran du joueur                     | transformé (ce que la communauté achète)                                                         | **inchangé** ; le calque peut s'y ajouter, exclu des captures (§ 7)                            | inchangé                                                                          | inchangé                                                                      | inchangé                                                     |
| Changement dans l'OBS de Production | aucun                                                                                            | filtres ajoutés à « Écran », créés désactivés (comme V1), **sur GO**                           | une source ajoutée dans chaque scène, à aligner sur le gameplay                   | installation d'un plugin natif                                                | aucun                                                        |
| Dépendances                         | aucune                                                                                           | obs-shaderfilter (déjà installé ; cassé une fois par la mise à jour d'OBS 33 le 10/11, réparé) | Spout2 (à installer) ou capture de jeu de notre propre fenêtre                    | compilateur C++ et SDK OBS (absents du PC) ; à refaire à chaque version d'OBS | aucune                                                       |
| Risque                              | faible (déjà construit)                                                                          | faible : un shader en erreur laisse passer l'image (code de shaderfilter)                      | alignement fragile, double capture                                                | un plantage du plugin fait tomber OBS, donc le live                           | faible                                                       |

**Écartés :**

- **C.** Capture le jeu une deuxième fois et ajoute de la latence. La source doit être alignée à la main dans chaque
  scène. Elle n'apporte rien que B ne fasse mieux.
- **D.** C'est le plus pur techniquement. Mais un plantage du plugin fait tomber OBS, donc le live, et rien ne permet de
  compiler un plugin C++ sur ce PC. B obtient le même résultat avec un plugin déjà installé et maintenu.
- **E.** Ne couvre que les effets géométriques. Animés par WebSocket, ils saccadent.

## 4. Architecture retenue : B, « le moteur calcule, OBS peint »

Chaque effet devient **un ou deux filtres obs-shaderfilter sur la source gameplay**, un par passe de l'effet :

- **Le shader du filtre est celui du moteur.**
  - Même corps HLSL que `EffectShaders.cs`, réécrit mécaniquement par `ObsExport.Rewrite`.
  - Les constantes du moteur arrivent en paramètre au lieu d'un cbuffer.
  - Les textures et l'échantillonneur sont ceux d'OBS.
  - Aucun effet n'est réécrit à la main.
- **La logique image par image reste en C#.**
  - L'activation est jouée d'avance à 60 images/s, comme dans les outils hors écran du moteur : graine, entrée et sortie
    animées, titubations, motif des clignements, dérive du brouillard.
  - Une constante qui varie devient une ligne d'une **partition** : un PNG sans perte, un flottant 32 bits sur deux
    pixels.
  - Les autres constantes sont de simples réglages du filtre.
  - OBS lit la partition au temps écoulé depuis l'activation du filtre (`elapsed_time_enable`).
  - À la fin, le filtre rend l'image intacte, même si personne ne le coupe.
- **Studio pilote**, comme Chaos V1 le faisait déjà (`halloween/chaos-obs.ts`, ObsActions) :
  1. il prépare les filtres une fois, désactivés, sans jamais écraser un filtre existant ;
  2. à l'activation, il règle la partition et les constantes, puis active les filtres pour la durée ;
  3. l'arrêt est programmé et rejoué même après un redémarrage de Studio ;
  4. STOP ALL coupe tout.
- **Un filtre coupé ne coûte rien.** Un changement de réglage ne recompile pas le shader (code de shaderfilter 2.6.1 :
  seul le fichier ou le bouton « Recharger » le fait).

Fichiers produits par `ChaosEngine.exe --obs-export <effet> <variante|-> --out <dossier> [--level --seed
--duration-ms --params --w --h --refs]` :

- un `.effect` par passe ;
- sa partition (`*-track.png`) ;
- `manifest.json` : nom des filtres, réglages d'activation, avertissements, refus.

## 5. Prototype et vérification

**Contrôle :** `chaos-obs-check.exe <export>… --out <dossier>`.

- Il charge la libobs installée, D3D11 sur la RTX 3070, avec un dossier de configuration jetable.
- Il compose une scène de test :
  - le « jeu » : l'image de synthèse du moteur, avec les filtres Chaos ;
  - une « webcam » et une « alerte » posées au-dessus.
- Il rend la scène hors écran.
- Pour chaque effet, il compare :
  - l'image du jeu dans OBS au rendu du moteur au même instant ;
  - la webcam et l'alerte avant et pendant l'effet.
- Il active ensuite l'effet en temps réel et vérifie qu'il joue, puis qu'il s'arrête seul.

**Résultats du 24/11** (640 × 360, 2 instants par effet ; écart RVB de 0 à 255) :

| Effet                    | Filtres | Compilé par OBS | Écart moyen avec le moteur             | p99 | Webcam, alerte | Joue puis s'arrête seul |
| ------------------------ | ------- | --------------- | -------------------------------------- | --- | -------------- | ----------------------- |
| Écran retourné           | 1       | oui             | 0                                      | 0   | écart 0        | oui                     |
| Miroir                   | 1       | oui             | 0                                      | 0   | écart 0        | oui                     |
| Tremblement              | 1       | oui             | 0                                      | 0   | écart 0        | oui                     |
| Zoom chaotique           | 1       | oui             | 0                                      | 0   | écart 0        | oui                     |
| Écran ivre               | 2       | oui             | 0,7 à 0,8                              | 9   | écart 0        | oui                     |
| Vision tunnel            | 2       | oui             | 0,2                                    | 1   | écart 0        | oui                     |
| Clignement (yeux fermés) | 1       | oui             | 0                                      | 0   | écart 0        | oui                     |
| Brouillard               | 1       | oui             | 0,3 à 0,7                              | 1   | écart 0        | oui                     |
| Flou                     | 1       | oui             | 1,8                                    | 12  | écart 0        | oui                     |
| Pixelisation             | 1       | oui             | 1,6                                    | 9   | écart 0        | oui                     |
| Filtre de couleur        | 1       | oui             | 0                                      | 0   | écart 0        | oui                     |
| VHS / glitch             | 1       | oui             | 0,9 à 1,6                              | 14  | écart 0        | oui                     |
| Flash                    | —       | —               | refusé à l'export (image retenue, § 7) |     |                |                         |

**Ce que montrent les images rendues par OBS :**

- Paupières fermées : l'image du jeu est noire, l'alerte et la webcam restent visibles par-dessus.
- Brouillard : le brouillard est dans le gameplay, la webcam devant lui.

**Pourquoi il reste de petits écarts :**

- **Écran ivre, flou, pixelisation, VHS.** Le moteur lit des niveaux de flou (mipmaps) de la capture ; OBS n'en a pas
  pour une source. Le filtre les approche par 9 lectures.
- **Brouillard.** Le moteur le rend à 50 % de la résolution, OBS à 100 %.

## 6. Performances

**Attendu :**

- **Rien sur l'écran du joueur**, ni capture : OBS lit déjà la source.
- **Aucune latence** : l'effet est calculé sur l'image même que diffuse OBS.
- **Par filtre actif, dans le rendu d'OBS :**
  - une copie de la source (2560 × 1440 pour « Écran ») ;
  - une passe du shader ;
  - une copie vers la suite.
- **Lecture de la partition :** deux lectures de texture minuscule par constante qui varie (3 à 15 selon l'effet).
- **Filtre coupé :** coût nul.

**Mesuré :**

- **Petit format (640 × 360).** Coût fixe d'un filtre actif : **+0,04 ms GPU par image**. Brouillard en cours :
  **+0,32 ms**. La carte graphique reste au repos à cette taille, ce qui gonfle les temps ; le chiffre n'est pas
  représentatif.
- **1440p, 60 images/s, comme « Écran » : pas encore mesuré.** Le banc (`chaos-obs-check.exe --perf`) charge le GPU ; il
  attend que la garde de jeu soit libre, puis les résultats iront ici.
- **Point à surveiller : le brouillard.** Il est rendu en pleine résolution dans OBS, soit 4 fois plus de pixels que dans
  le moteur. S'il coûte trop en 1440p :
  - ce calque ne lit pas l'image : il peut devenir une source à demi-résolution posée juste au-dessus du gameplay et sous
    la webcam ;
  - ou passer à moins d'octaves.

**Ce que le banc ne dit pas :** les images/s d'un jeu. La validation en jeu du Performance Lab reste le juge
(PERFORMANCE_LAB.md § 4).

## 7. Limites

- **Flash.** L'image figée n'est pas encore exportée. shaderfilter 2.6.1 offre `previous_output` (sa sortie
  précédente) : de quoi geler l'image. Le plugin Freeze est aussi installé.
- **Grands flous en 1440p.** L'approximation à 9 lectures est fidèle en 360p. En 1440p, un rayon fort peut montrer des
  doublons (à vérifier). Le repli existe déjà : Composite Blur, utilisé par V1.
- **Partition figée à l'activation.**
  - Changer la durée ou les réglages pendant un effet impose de le relancer.
  - Un arrêt anticipé coupe net, sans animation de sortie. Amélioration simple : un réglage « arrêt à t » qui déclenche
    une sortie courte.
- **Partition à 60 images/s.** Un OBS réglé à 30 images/s en lit une sur deux ; un OBS à 50 images/s en saute
  quelques-unes.
- **Le filtre ne change pas l'écran du joueur.**
  - Pour que le joueur subisse aussi l'effet, le calque du moteur s'y ajoute, **exclu des captures**, sinon OBS le
    verrait deux fois. Le moteur sait déjà exclure son calque (mode C), mais pas encore à la demande en mode E.
  - Les deux images suivent la même partition (même graine) : elles sont identiques, à quelques millisecondes près.
- **Dépendance à obs-shaderfilter.** Si une mise à jour d'OBS le casse, Studio doit le détecter (compilation en échec
  : `last_error`) et revenir au calque.
- **Jamais essayé dans l'OBS d'Antoni.** Ni dans ses scènes réelles, ni sur la vraie capture « Écran », ni pendant un
  live.

## 8. Stratégie pour la suite

1. **Choix d'Antoni**, effet par effet ou globalement :
   - diffusion par filtre OBS seulement (le joueur ne voit rien) ;
   - calque seulement (comme aujourd'hui) ;
   - les deux (le calque exclu des captures).
2. **Studio : « Diffusion OBS ».**
   - Choisir la source gameplay (« Écran » par défaut), parmi les captures d'écran, de fenêtre et de jeu.
   - « Préparer les filtres » : sur GO, désactivés, sans écraser, d'abord dans une scène de test.
   - L'export passe par une commande du moteur déjà lancé (pas de processus à chaque effet) ; ses fichiers vont dans le
     dossier d'état de Studio.
   - Activation et arrêt par ObsActions (fin programmée, STOP ALL), comme V1.
3. **Moteur.**
   - Exclure à la demande le calque des captures en mode E (option « les deux »).
   - Flash par `previous_output`.
   - Réglage « arrêt à t ».
4. **Après le banc 1440p** : brouillard en source à demi-résolution si besoin, flou fort (plus de lectures ou Composite
   Blur).
5. **Validation par Antoni :**
   - une scène de test avec « Écran » et la webcam, puis ses vraies scènes ;
   - la validation en jeu du Performance Lab sur Overwatch ;
   - ensuite seulement, retirer les filtres V1 de « Écran ».

Les autres effets s'ajoutent sans travail spécifique tant qu'ils restent des passes du moteur (Filter, Transform,
Overlay) : le test `chaos-obs-export.test.ts` et `chaos-obs-check.exe` les vérifient. Un effet que l'export ne sait pas
traduire est **refusé avec sa raison**, jamais approché en silence.
