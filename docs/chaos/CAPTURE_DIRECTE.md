# Chaos V2 : capture directe par la source « Écran » d'OBS, sans filtres

Statut au 24/11 : **développé et testé hors écran**, à valider par Antoni (version de test `0.1.44-chaos.5`, non
installée). Branche locale `feat/chaos-studio`, commits `21833432` (correctif) et `f0c544d5` (sonde).

Objectif d'Antoni : un seul rendu Chaos, visible sur son moniteur et capturé tel quel par la source « Écran » d'OBS,
sans filtre OBS. Le même effet doit apparaître à l'écran et dans l'aperçu de « Écran ». Le mode C à filtres
([MODE_C.md](MODE_C.md)) reste l'alternative.

## 1. Pourquoi Miroir n'apparaissait pas dans l'aperçu d'OBS

« Écran » est une capture d'écran DXGI de `\\.\DISPLAY1` (2560×1440, écran principal). La sonde du 24/11 a prouvé
deux choses :

- DXGI voit le calque Chaos tant qu'il n'est pas exclu des captures (score 1,67) ;
- DXGI ne le voit plus une fois exclu (score −0,07).

Le problème venait donc uniquement de l'exclusion (`SetWindowDisplayAffinity`, `WDA_EXCLUDEFROMCAPTURE`). Jusqu'à la
`0.1.44-chaos.4`, le moteur choisissait ainsi pour une fiche visant un écran :

| Situation de l'écran                                                                                       | Mode                                                                                  | Exclusion du calque                                                          | Vu par « Écran » ?           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| Une fenêtre couvre au moins 90 % de l'écran (jeu, fenêtre agrandie)                                        | **E** : la fenêtre capturée en direct, posée sur une image de l'écran prise au départ | Exclu pendant la prise de l'image de l'écran (quelques images), puis rétabli | Oui, en principe             |
| Aucune fenêtre ne couvre 90 % de l'écran (bureau, fenêtre plus petite, fenêtre agrandie sur l'autre écran) | **C** : l'écran entier capturé en direct                                              | **Exclu pendant tout l'effet** : sinon le calque se capturerait lui-même     | **Jamais**, par construction |

Cause certaine : en mode C, le calque est invisible pour OBS du début à la fin de l'effet.

- Relevé hors écran du 24/11 (`ChaosEngine.exe --resolve-screens`, rien d'affiché) :
  - l'écran 1 (celui de « Écran ») était résolu en **mode C** : aucune fenêtre ne le couvrait à 90 % ;
  - l'écran 2 était en mode E (navigateur agrandi).
- Miroir vise l'écran principal, donc l'écran 1.
- Studio ne journalise pas le mode d'un effet, donc on ne peut pas prouver le cas exact de l'essai.
  - Hypothèse la plus probable : l'écran 1 n'était pas occupé à 90 % à ce moment-là, et l'effet est parti en mode C,
    exclu.
  - Autres causes possibles :
    - la fenêtre agrandie était sur l'autre écran ;
    - la fenêtre était écartée par le moteur : fenêtre « outil », fenêtre possédée par une autre, ou calque
      traversable.

Second défaut, corrigé aussi :

- en mode E, le calque passait de « exclu » à « capturable » juste avant de s'afficher ;
- la sonde n'avait testé que le sens inverse (capturable → exclu) ;
- cette bascule n'a plus lieu.

Hors cause : en « Écran uniquement », aucune sortie OBS n'était demandée. Les filtres V2 ne sont pas préparés, donc
Studio n'envoie que la sortie écran.

Vérifications demandées :

- **`SetExcluded`** : `SetWindowDisplayAffinity`, appelé seulement quand l'état change (création en mode C, puis à
  chaque image si besoin).
- **Mode de capture** :
  - E = capture WGC de la fenêtre seule ;
  - lecture directe si elle couvre exactement l'écran (jeu en plein écran sans bordure) ;
  - C = capture WGC de l'écran entier.
- **Surface** : fenêtre DirectComposition TOPMOST, traversable, présentée sans attente, affichée après sa première
  image.
- **Fenêtre active** : le moteur prend la fenêtre la plus haute qui occupe l'écran ; c'est la fenêtre active quand on
  joue. Plein écran exclusif : refusé (rien ne peut s'afficher au-dessus).

## 2. Correctif (moteur et Studio)

**Une fiche « écran » dont la seule sortie est l'écran passe toujours en mode E, jamais en mode C** (`Targets.Resolve`).

- **Fenêtre en direct** :
  - celle qui occupe l'écran (au moins 90 %, la plus haute) ;
  - à défaut, la plus haute qui en couvre au moins 25 % ;
  - si l'écran est vide (bureau), l'image de l'écran seule.
- **Reste de l'écran** : une image prise **avant** l'apparition du calque, figée pendant l'effet (barre des tâches,
  autres fenêtres, horloge). Un jeu en plein écran sans bordure est lu directement : rien n'est figé.
- **Exclusion** (`EffectRequest.SelfCapture`) :
  - en mode E, le calque n'est jamais exclu tant qu'il n'est pas affiché : l'image de l'écran se prend calque
    masqué ;
  - il n'est exclu que si cette image doit être reprise calque affiché : une fenêtre qui quitte le plein écran pendant
    l'effet, ou un flash en cours au moment où un miroir démarre sur le même écran. Cela dure quelques images.
- **Aucune boucle de capture** : le moteur ne lit jamais une capture de son propre écran pendant que le calque y est.
  Il lit soit la fenêtre seule, soit l'image de l'écran prise calque masqué.
- **Le mode C ne sert plus qu'avec la sortie OBS** (« Écran + OBS », filtres) :
  - le calque y est exclu de toute façon, et OBS applique l'effet ;
  - l'écran entier reste en direct.
- **Studio** :
  - sortie par défaut **« Écran uniquement » (capture directe)**, texte du panneau Diffusion OBS mis à jour ;
  - « Écran + OBS » reste au choix ;
  - un réglage déjà enregistré est respecté.
- **Inchangés** :
  - les 13 effets, flash compris : le flash ne lit pas l'image, son calque n'est jamais exclu, donc OBS le voit ;
  - le curseur suivi (dessiné par le moteur, absent de l'image figée) ;
  - les transitions ;
  - le multi-écran : chaque écran a son mode ;
  - STOP ALL et Ctrl+Maj+F11.
- **Webcam et alertes** : intactes. L'effet n'est que dans l'image de « Écran ». Les autres sources d'OBS sont posées
  au-dessus, comme demandé le 24/11.

## 3. Preuves (hors écran, rien d'affiché)

- `chaos-unit.exe` : 35 ok, 0 KO. Nouveau cas :
  - la sortie OBS est transmise à la résolution de cible (écran seul → non, écran + OBS → oui, défaut → non) ;
  - règle d'exclusion par mode : E masqué capturable, E à reprendre exclu, C toujours exclu, D capturable.
- `ChaosEngine.exe --resolve-screens` (affiche aussi `mode_with_obs_output`) :
  - écran 1 → E (fenêtre du dessus) en écran seul, C avec la sortie OBS ;
  - écran 2 → E.
- Studio : 25 tests ciblés (`chaos-obs-output`, `chaos-runtime`, `chaos-mode-c` avec le vrai moteur et OBS simulé,
  `chaos-obs-export`), typecheck server/web, lint.
- Page Chaos (Lab isolé, sans navigateur visible, `--non-visible`) : 36 ok, 0 KO. Inclut « Écran uniquement (capture
  directe) par défaut », « Écran + OBS » enregistré puis capture directe rétablie.
- **Non vérifié ici** (affichage interdit à l'agent) :
  - le rendu réel à l'écran et dans l'aperçu d'OBS ;
  - le coût à l'écran de la composition du mode E.

  C'est la validation d'Antoni, § 5.

## 4. Performances : capture directe et mode C à filtres

Mesures du 24/11 à 2560×1440 :

- moteur : banc hors écran, 240 images ;
- OBS : 33.0.1 sans fenêtre, obs-shaderfilter 2.6.1, 60 i/s.

Elles sont bruitées : la référence d'OBS varie de 1,1 à 2,8 ms, et une partie a tourné en parallèle d'un autre banc.
Ce sont des ordres de grandeur.

| Effet                         | Moteur, GPU ms/image (p50) | Filtres OBS, GPU ms/image en plus dans OBS |
| ----------------------------- | -------------------------- | ------------------------------------------ |
| Miroir                        | 0,15                       | +0,32                                      |
| Clignement (marqué)           | 0,14                       | +0,60                                      |
| Brouillard (marqué / extrême) | 0,62 / 0,60                | +2,78 / +2,47                              |
| Zoom (marqué / extrême)       | 0,16 / 0,18                | +0,41                                      |

- **Capture directe** :
  - OBS n'ajoute rien : il capture « Écran » comme toujours ;
  - le moteur rend l'effet une fois, au même coût que la sortie écran du mode C ;
  - le mode E ajoute une copie de la fenêtre par nouvelle image, de l'ordre de la référence du banc moteur (copie
    d'une image 1440p : 0,12 ms GPU) ;
  - un jeu en plein écran sans bordure n'a pas cette copie (lecture directe).
- **Mode C à filtres** : même coût côté moteur, **plus** les filtres dans le thread de rendu d'OBS, soit 0,2 à 2,8 ms
  par image selon l'effet. Il faut aussi 14 filtres préparés sur « Écran ».
- **Retard** : 0 image en retard des deux côtés aux mesures.

Fichiers bruts (session de l'agent, non commités) : `perf-1440.jsonl` (moteur) et `perf1440/*/report.json` (OBS).

## 5. Validation par Antoni (hors live, jeu fermé, OBS Production intact)

Rien n'est à changer dans OBS. Aucun filtre Chaos n'est créé ni préparé.

### A. Sonde du vrai chemin (facultative, 4 s, quasi invisible)

Studio fermé, jeu fermé. Mettre une fenêtre agrandie sur l'écran 1, puis lancer :

```
"C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\chaos-v2\apps\chaos-engine\bin\chaos-bench.exe" --capture-probe --engine --screen \\.\DISPLAY1
```

- **Ce que fait la sonde** :
  - elle démarre le moteur corrigé ;
  - elle joue l'effet interne « filigrane » sur l'écran 1 : l'image telle quelle, plus un damier à 2/255,
    imperceptible ;
  - toutes les ~250 ms, elle note si DXGI (comme « Écran ») et WGC voient le calque, avec le mode et l'exclusion de la
    surface.
- **Pendant ces 4 s**, le reste de l'écran est figé, sauf la fenêtre agrandie.
- **Attendu** :
  - `Mode de la surface : E` ;
  - `DXGI (comme « Écran ») : N relevés sur N voient le calque (toujours)` ;
  - aucune ligne `EXCLUE`.
- **Résultats** : `%TEMP%\chaos-engine-probe-*.json`.
- **Garde** : la sonde refuse de partir pendant un jeu.

### B. Studio `0.1.44-chaos.5` avec OBS

1. Installer `0.1.44-chaos.5` comme les précédentes (GUIDE_STUDIO_CHAOS.md § 4).
2. Studio › Chaos › Diffusion OBS : **« Écran uniquement »** sélectionné (défaut). Dans OBS, « Écran » n'a aucun
   filtre « Raptoru Chaos ».
3. Mettre le jeu en plein écran sans bordure, ou une fenêtre agrandie, sur l'écran 1. Garder l'aperçu d'OBS visible
   (sur l'autre écran ou en projecteur).
4. Cliquer « Tester » sur **Miroir**, **Clignement**, **Brouillard** et **Zoom**. Pour chacun :
   - l'effet apparaît sur le moniteur **et** dans l'aperçu de « Écran », en même temps ;
   - la webcam et les alertes ne changent pas.
5. Variantes :
   - Studio non agrandi sur l'écran 1 : la fenêtre du dessus reste animée, le reste est figé, et OBS voit pareil ;
   - bureau vide : l'effet se joue sur l'image figée, visible aussi dans OBS ;
   - Flash : visible dans OBS ;
   - une fiche « Tous les écrans » : chaque écran a son effet.
6. Tester **STOP ALL** pendant deux effets, et le curseur pendant Miroir.
7. **En cas d'écart**, noter :
   - l'effet et l'écran ;
   - la fenêtre au premier plan ;
   - ce que montrent le moniteur et OBS.

   Puis lancer la sonde A dans la même situation.

**Retour arrière** : relancer `Raptoru Studio Setup 0.1.44-chaos.4.exe` (ou `.3`), même dossier `release`.
