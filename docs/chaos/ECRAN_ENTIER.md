# Chaos : les effets couvrent tout l'écran (barre des tâches comprise)

État au 24/11/2026, branche locale `feat/chaos-studio`. Code : `Host/Targets.cs` (résolution de la cible « écran »),
`Capture/Capture.cs` (`ComposedScreenSource`), `Present/Surface.cs` (modes et exclusion), `Host/Engine.cs` (exclusion
pilotée par la capture). **Rien n'a encore été vu sur un vrai écran** : la garde de jeu est restée occupée.

## 1. Le défaut constaté

Essais d'Antoni dans Studio 0.1.44-chaos.2 : l'écran ivre et le clignement s'appliquaient à la fenêtre principale, mais
la barre des tâches restait visible et intacte.

**Cause.** La fiche d'un effet vise un écran (`{kind:"screen", device}`). Jusqu'ici, si une fenêtre couvrait au moins
90 % de cet écran (fenêtre agrandie, jeu), le moteur visait **cette fenêtre** (mode D). Le calque était alors posé sur
le rectangle de la fenêtre, et l'image lue était la capture de cette fenêtre seule. Une fenêtre agrandie s'arrête au
bord de la barre des tâches : la barre restait donc dehors.

Le mode D avait été choisi pour une bonne raison. La capture d'une fenêtre ne voit jamais le calque posé dessus. Le
calque peut donc rester visible de la capture d'écran d'OBS. À l'inverse, capturer l'écran entier (mode C) oblige à
exclure le calque des captures (`WDA_EXCLUDEFROMCAPTURE`), faute de quoi il se capturerait lui-même. Or cette exclusion
vaut pour **toutes** les captures, y compris celle d'OBS.

## 2. Trois regards différents

| Qui regarde                                                                  | Ce qu'il voit du calque Chaos                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Le streamer (son écran)                                                      | toujours le calque (fenêtre DirectComposition au premier plan)                                         |
| OBS « Capture d'écran » (WGC ou DXGI : la méthode de l'OBS d'Antoni est WGC) | le calque, **sauf** s'il est exclu des captures                                                        |
| OBS « Capture de fenêtre » ou « Capture de jeu » visant le jeu               | **jamais** le calque : ces méthodes lisent la fenêtre ou les images du jeu, pas ce qui est posé dessus |

Aucun réglage du moteur ne peut faire apparaître le calque dans une capture de fenêtre ou de jeu d'OBS. Pour qu'OBS
montre l'effet, la scène doit utiliser une **capture d'écran**. Le choix de la source OBS appartient à Antoni.

## 3. La solution retenue : mode E, « écran composé »

Une cible « écran » couvre désormais **tout l'écran**, dans tous les cas :

- **Une fenêtre occupe l'écran (mode E).**
  - La surface couvre l'écran entier et n'est jamais exclue des captures : la capture d'écran d'OBS la voit.
  - L'image d'entrée est **la fenêtre capturée en direct** (comme en mode D), posée à sa place sur une **image de
    l'écran prise une fois au départ** : barre des tâches, bords, bureau. Cette image est prise avant l'affichage du
    calque, donc sans lui.
  - Si un autre effet tourne déjà sur ce même écran, le calque est exclu des captures pendant les quelques images de la
    prise de vue. Les images composées avant cette exclusion sont ignorées (`NotBefore`).
- **La fenêtre couvre exactement l'écran (jeu en fenêtré sans bordure).**
  - Sa capture est lue directement, sans composition ni copie supplémentaire : coût identique à l'ancien mode D.
- **Aucune fenêtre n'occupe l'écran (bureau) : mode C.**
  - L'écran est capturé, et la surface n'est exclue des captures **que tant qu'elle lit cette capture**.
  - Un effet sans capture (clignement, brouillard, voile du tunnel) n'est jamais exclu : OBS le voit, même sur le bureau.
  - Les effets qui lisent l'image (miroir, zoom, ivre, couleur…) restent, sur le bureau, invisibles pour la capture
    d'écran d'OBS (limite documentée, inchangée).
- **Une seule surface par écran** (clé `screen:<écran>`), quel que soit le mode.

Coût du mode E : une copie de la fenêtre dans l'image composée à chaque nouvelle image capturée, environ 15 Mo lus et
écrits en 1440p. C'est faible sur la carte d'Antoni, mais ce n'est pas encore mesuré en jeu. Le jeu en fenêtré sans
bordure n'a aucun coût ajouté.

**Limites :**

- **Barre des tâches et bords figés pendant un effet qui lit l'image.** L'image de l'écran est prise une fois : l'horloge
  ne tourne pas et le survol de la barre ne se voit pas. Ils redeviennent vrais dès la fin de l'effet. Les effets sans
  capture (clignement, brouillard) recouvrent la vraie barre, vivante.
- **Si la fenêtre bouge ou change de taille pendant l'effet**, la zone qu'elle quitte garde son ancienne image jusqu'à la
  fin de l'effet.
- **Si la fenêtre qui occupe l'écran est réduite**, l'effet se masque, comme avant.

**Préservé :**

- le vrai curseur (dessiné transformé au-dessus de l'écran entier, clics inchangés) ;
- STOP ALL et Ctrl+Maj+F11 ;
- la restauration à l'arrêt.

Aucune rotation de Windows n'est réintroduite : la couche Entrées reste coupée par défaut, et une cible « écran »
occupée par une fenêtre ne l'utilise jamais.

## 4. Alternatives écartées

| Piste                                                         | Pourquoi pas                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Masquer ou déplacer la barre des tâches, maximiser la fenêtre | change Windows ; ne fait pas participer la barre à l'effet (refusé par le mandat)                                        |
| Capture de l'écran en continu + calque exclu                  | OBS ne verrait plus aucun effet                                                                                          |
| Capturer chaque fenêtre (barre, bureau…) et les recomposer    | revient à refaire le compositeur de Windows ; fragile                                                                    |
| Barre « vivante » par une deuxième surface exclue             | le streamer verrait la barre transformée, OBS non : deux images différentes, coût d'une capture d'écran continue en plus |
| Rotation de l'affichage par Windows                           | incident du 22/11 (Overwatch à 17 images/s)                                                                              |

## 5. Ce qui est vérifié, ce qui ne l'est pas

- **Compilé et testé hors écran.** 34 tests unitaires du moteur, 30 vérifications non visibles de la page, aucune
  régression sur les tests Studio Chaos.
- **Pas encore vu à l'écran ni dans OBS.** Le banc de compatibilité `chaos-bench.exe --obs-compat` a un nouveau cas :
  une fenêtre « agrandie » laisse une bande libre en bas, comme la barre des tâches, et la cible « écran » est
  retournée. Il compare, par WGC et DXGI comme OBS, la bande du bas et le haut de l'écran, avant puis pendant l'effet.
  C'est un test **visible** (garde de jeu), à lancer jeu fermé.
- **À vérifier par Antoni** (GUIDE_STUDIO_CHAOS § 4) : la barre des tâches participe à l'écran ivre, au clignement et
  au retournement ; dans OBS, la capture d'écran montre l'effet sur tout l'écran.
