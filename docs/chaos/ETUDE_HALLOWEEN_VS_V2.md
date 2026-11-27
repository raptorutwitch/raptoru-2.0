# Pourquoi le Chaos d'Halloween était-il visible dans OBS ? Halloween, Chaos V2 et le choix final

Enquête du 24/11/2026, branche locale `feat/chaos-studio`. Rien n'a été modifié : ni OBS, ni Studio installé, ni
Jetons, ni Twitch. Labels de preuve comme dans [AUDIT_CHAOS_V1.md](AUDIT_CHAOS_V1.md) :

- **PROUVÉ** : vu dans le dépôt, les journaux ou les réglages ;
- **DOC** : documentation officielle ou code source ;
- **HYPOTHÈSE** : raisonnement non mesuré ;
- **INCONNU** : non démontré.

## 0. Verdict en une page

1. **Halloween n'a jamais fait capturer à OBS l'écran retourné.**
   - Le retournement et le flou étaient dessinés dans une fenêtre **exclue de toutes les captures**.
   - Les spectateurs voyaient le retournement grâce à un **filtre OBS** (« Raptoru Chaos · Retourné », obs-shaderfilter)
     posé sur la source « Écran » et activé par Studio pendant l'effet.
   - C'est donc **déjà l'architecture B** (le mode C actuel), en plus fruste.
   - Seuls les effets **dessinés** (screamers, brouillard, clignement…) passaient directement par la capture d'écran :
     c'est l'architecture A.
2. **Chaos V2 fait déjà mieux qu'Halloween sur le principe A.**
   - Quand une fenêtre occupe l'écran (jeu en fenêtré sans bordure, fenêtre agrandie), le calque V2 (modes D et E)
     n'est **pas** exclu des captures. Il lit la capture de la **fenêtre**, pas de l'écran : il n'y a donc pas de
     boucle.
   - La capture d'écran d'OBS doit alors voir **tous** les effets, retournement et flash compris, **sans aucun
     filtre**. Halloween n'a jamais pu le faire pour le retournement.
   - C'est PROUVÉ par le code. Ce n'est **pas encore vu à l'écran** : la sonde est prête mais doit être lancée par
     toi (§ 6).
3. **Ce qui empêche aujourd'hui « Écran » de montrer ce que tu vois**, d'après le code :
   - le **mode C du moteur**, sur le bureau ou sans fenêtre qui couvre au moins 90 % de l'écran : le calque lit la
     capture de son propre écran ; il doit s'exclure, sinon il se capturerait lui-même ;
   - le mode **« Écran + OBS »**, mais seulement une fois les filtres préparés (ce n'est pas encore le cas chez toi) ;
   - les cas hors de portée de toute fenêtre : effet sur l'autre écran, jeu en plein écran **exclusif**, source OBS de
     type capture de jeu ou de fenêtre.

   Sans ton constat précis (quel effet, quel écran, quelle fenêtre devant), je ne peux pas dire lequel tu as vu.

4. **Recommandation : A par défaut, B seulement là où A est impossible.**
   - A, c'est le calque capturé tel quel : une seule image, la plus fidèle, la moins chère.
   - B, c'est le mode C avec filtres : il ne sert que sur le bureau ou pour une source autre qu'une capture d'écran, à
     choisir automatiquement.
   - **Condition** : la vérification de deux minutes (§ 6) doit confirmer qu'« Écran » (DXGI) voit le calque.

## 1. Le vrai Chaos d'Halloween (live du 31/10)

### 1.1 Ce qui tournait

| Élément                                              | Preuve                                                                                                                                                                                                                                                                                                                               | Niveau                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Version                                              | commit `51efd477` (30/10, 20 h 19) : « état réel Halloween au 30/10 (Production `bb63b75`, Studio **0.1.21**) et liste avant le live »                                                                                                                                                                                               | PROUVÉ (dépôt)                                         |
| Architecture du Chaos                                | `f9a7dabc` (30/10) « Chaos on the whole monitor — **excluded Chaos window + screen capture, OBS filters for the viewers** », corrigé par `b712e812` (surface opaque, transformations instantanées, curseur masqué)                                                                                                                   | PROUVÉ (dépôt)                                         |
| Fenêtre Chaos exclue                                 | `apps/studio/desktop/src/halloween-overlay.ts` (à `bb63b75f`) : `if (kind === 'chaos') w.setContentProtection(true);`. Affinité 17 (= `WDA_EXCLUDEFROMCAPTURE`) lue sur la vraie fenêtre le 10/11 (AUDIT § 2.2)                                                                                                                      | PROUVÉ                                                 |
| Rendu local du retournement                          | `apps/studio/server/halloween-overlay/overlay.js`, `captureScreen()` :<br>• `getDisplayMedia` (60 i/s), répondu par Electron (`setDisplayMediaRequestHandler` → `desktopCapturer`) ;<br>• `<video>` → `canvas 2D drawImage` → masquage du curseur (`hideCursor`) ;<br>• CSS `rotate(180deg)`, `scaleX(-1)`, `scaleY(-1)` ou `blur()` | PROUVÉ (code)                                          |
| Filtres OBS                                          | `apps/studio/server/src/halloween/chaos-obs.ts` : 6 filtres « Raptoru Chaos · … » créés désactivés (3 shaderfilter, 3 Composite Blur). `halloween/runtime.ts` (l. 721-752) : `setChaosFilter(…, true, durée)` à l'effet démarré, `false` à la fin ou à STOP ALL                                                                      | PROUVÉ (code)                                          |
| Source configurée le jour du live                    | `apps/studio/server/.runtime/halloween/settings.json`, écrit le **31/10 à 17 h 43** : `obs_chaos_source: "Écran"`                                                                                                                                                                                                                    | PROUVÉ (réglage)                                       |
| Filtres présents dans OBS                            | ta collection active et ton journal OBS du 23/11 : sur « Écran », « Raptoru Chaos · Retourné / Miroir / Inversé » (shader_filter) et « Flou faible / moyen / fort » (Composite Blur), désactivés                                                                                                                                     | PROUVÉ (lecture seule)                                 |
| Effets dessinés (screamers, brouillard, clignement…) | fenêtre « Raptoru Halloween » **non exclue**. Doc d'avant le live : « l'aperçu OBS de la scène copiée doit montrer le screamer, au-dessus de tout » (`HALLOWEEN.md`, tests)                                                                                                                                                          | PROUVÉ (code), vu par OBS : non vérifiable aujourd'hui |
| Rotation de l'affichage Windows                      | **absente** d'Halloween. Elle n'apparaît qu'avec la couche Entrées expérimentale de Chaos V2 (22/11, incident d'Overwatch à 17 i/s)                                                                                                                                                                                                  | PROUVÉ (code)                                          |

**Non vérifiable aujourd'hui :**

- le nombre de retournements joués pendant le live et l'activation effective des filtres ce soir-là. Les journaux
  d'OBS du 31/10 n'existent plus (OBS ne garde que ses derniers fichiers), et je n'ai pas consulté la base de
  Production du Core ;
- ton témoignage (« les spectateurs voyaient mon écran retourné ») ne s'explique que par le filtre. La fenêtre exclue
  ne pouvait pas être capturée par la capture d'écran d'OBS (DXGI ou WGC) : c'est DOC (Microsoft,
  `SetWindowDisplayAffinity`) et PROUVÉ (affinité lue).

### 1.2 Le trajet de l'image

**Retournement et flou :**

```
Écran Windows (jeu) ─┬─► Chromium getDisplayMedia (capture de l'écran entier, curseur incrusté)
                     │      → <video> → canvas 2D → curseur masqué → CSS rotate / blur
                     │      → fenêtre « Raptoru Chaos » (exclue des captures) ──► TON écran : retourné
                     │
                     └─► OBS « Écran » (capture d'écran) : ne voit PAS la fenêtre exclue → le vrai jeu
                            → filtre « Raptoru Chaos · Retourné » activé par Studio
                            → composition (webcam, alertes au-dessus) ──► SPECTATEURS : retourné
```

**Effets dessinés :**

```
fenêtre « Raptoru Halloween » (transparente, non exclue) ─► ton écran ET la capture d'écran d'OBS
```

**Classement demandé :**

| Mécanisme                                        | Utilisé à Halloween ?                              |
| ------------------------------------------------ | -------------------------------------------------- |
| A. Calque dessiné et capturé par OBS             | **oui**, pour les effets dessinés seulement        |
| B. Rotation ou transformation de Windows         | **non**                                            |
| C. Capture transformée, montrée dans une fenêtre | **oui**, pour ton écran (retournement, flou)       |
| D. Filtres OBS                                   | **oui**, pour les spectateurs (retournement, flou) |
| E. Combinaison                                   | **oui** : A + C + D                                |
| F. Autre                                         | non                                                |

### 1.3 Pourquoi ton jeu ralentissait alors que le stream restait fluide

Ce point est déjà étudié dans [RECHERCHE_CHAOS_V2.md](RECHERCHE_CHAOS_V2.md) § 3. Aucune mesure du 31/10 n'existe.

| Cause                                                                                                                                                                                                                                                                                                                                                                         | Niveau                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Ce que tu voyais n'était pas le jeu mais la copie de Chromium.**<br>• Chaque image capturée descendait du GPU vers le processeur (lecture bloquante), était convertie, remontée, redessinée dans un canvas, puis composée en plein écran.<br>• Chromium plafonne aussi sa capture.<br>• L'écran pouvait donc n'afficher que 10 à 20 images/s, même si le jeu tournait vite. | DOC (code de Chromium) + HYPOTHÈSE               |
| **OBS, lui, capturait le vrai jeu**, sur le GPU, et n'y ajoutait qu'une passe de filtre. Avec sa priorité GPU (OBS lancé en administrateur), le stream restait fluide.                                                                                                                                                                                                        | PROUVÉ (code, priorité lue le 10/11) + HYPOTHÈSE |
| **Les deux fenêtres Halloween plein écran restaient ouvertes en permanence** (AUDIT D1). DWM devait composer le jeu, sans affichage direct : une image de latence au moins, et un VRR souvent perdu, même sans effet.                                                                                                                                                         | PROUVÉ (fenêtres relevées) + DOC                 |
| Flou fort : flou Gaussien de rayon 55 en 1440p dans OBS, prioritaire sur le jeu                                                                                                                                                                                                                                                                                               | HYPOTHÈSE                                        |

Le code démontre la chaîne de copies et les fenêtres permanentes. Leur coût exact sur tes images/s **n'est pas
démontré**.

## 2. Chaos V2 comparé

### 2.1 Les fenêtres

| Propriété           | Halloween, fenêtre Chaos                             | Halloween, fenêtre des effets | Chaos V2 (`Present/Surface.cs`)                                                                       |
| ------------------- | ---------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Type                | Electron, transparente, au premier plan, traversable | idem                          | native : `WS_EX_TOPMOST`, `TRANSPARENT`, `LAYERED`, `NOACTIVATE`, `TOOLWINDOW`, `NOREDIRECTIONBITMAP` |
| Composition         | DirectComposition (Chromium)                         | DirectComposition (Chromium)  | DirectComposition, swapchain de composition, alpha prémultiplié                                       |
| Existence           | **en permanence** (AUDIT D1)                         | en permanence                 | **seulement pendant un effet**                                                                        |
| Exclue des captures | **toujours**                                         | jamais                        | selon le mode (§ 2.2)                                                                                 |
| Ce qu'elle lit      | l'**écran entier** (Chromium, curseur incrusté)      | rien                          | la **fenêtre** du jeu (modes D, E), ou l'écran (mode C) ; GPU seulement, curseur exclu en amont       |

Les fenêtres de V1 et de V2 sont de la même famille (DirectComposition, au premier plan, traversables). Seule
l'**affinité d'affichage** décide si OBS les voit.

### 2.2 Qui voit quoi, mode par mode (V2)

| Mode du moteur (choisi seul, `Host/Targets.cs`)        | Exclu des captures ?                                                         | Capture d'écran OBS (« Écran », DXGI)                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **E** : une fenêtre couvre au moins 90 % de l'écran    | **non**, sauf « Écran + OBS » avec filtres                                   | **voit le calque** : tous les effets                                      |
| **D** : cible fenêtre (0.1.44-chaos.2)                 | non                                                                          | voit le calque, sur la fenêtre seulement                                  |
| **C** : bureau, aucune fenêtre à 90 %                  | **oui, pendant un effet qui lit l'image** (sinon il se capturerait lui-même) | ne voit que les effets dessinés (clignement, brouillard, voile du tunnel) |
| Sortie OBS active (« Écran + OBS » + filtres préparés) | oui, volontairement                                                          | voit le vrai écran, plus le filtre                                        |
| Jeu en plein écran exclusif                            | —                                                                            | aucun calque possible                                                     |
| Effet sur l'écran gauche                               | —                                                                            | « Écran » ne capture que l'écran droit                                    |

### 2.3 Captures et récursion

- **Méthode réelle de « Écran » : DXGI** (duplication du bureau). Ton journal OBS du 23/11 dit :
  `[duplicator-monitor-capture: 'Écran'] … method: DXGI`, sur l'écran XB273U 2560×1440. ECRAN_ENTIER.md disait WGC à
  tort.
- DXGI et WGC (capture d'écran) livrent l'image composée par Windows, **fenêtres superposées comprises**, sauf celles
  qui portent `WDA_EXCLUDEFROMCAPTURE` (DOC Microsoft, Windows 10 2004 et suivants).
- **Récursion.** Un moteur qui capture l'**écran** sur lequel il dessine se voit lui-même : image sur image, à
  l'infini. Il n'y a que deux issues propres :
  - **s'exclure**, et OBS ne le voit plus. C'est Halloween et le mode C. Aucune API de Windows n'exclut une fenêtre
    d'une capture seulement : l'exclusion vaut pour toutes ;
  - **ne pas capturer l'écran**, mais la **fenêtre** du jeu. C'est le mode E : la capture d'une fenêtre ne contient
    jamais les fenêtres posées dessus. **Aucune exclusion n'est nécessaire, et OBS voit le calque.**
- **Plusieurs écrans** : une surface par écran. Seul l'écran capturé par « Écran » (le droit) peut arriver dans le
  stream.
- **Export des shaders vers OBS** (mode C, filtres) : le même code de shader, rejoué dans OBS. Il n'est utile **que** là
  où le calque ne peut pas être vu.

## 3. Les deux architectures finales

- **A** : Halloween modernisé = Chaos V2 sans filtres. Le calque (modes D et E) est capturé tel quel par « Écran ».
- **B** : le mode C avec filtres. Calque exclu, et le même shader rejoué dans OBS.

| Critère                | A : calque capturé par OBS                                                                                                                                                                         | B : calque exclu + filtres OBS                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Fidélité            | **exacte** : les spectateurs voient l'image de ton écran, curseur transformé et flash compris ; barre des tâches figée pendant un effet qui lit l'image (mode E)                                   | très proche (écart de 0 à 1,8 sur 255, mesuré) ; flou et pixelisation approchés ; pas de flash ; barre des tâches vivante dans le stream |
| 2. Latence (stream)    | le gameplay arrive 1 à 2 images plus tard **pendant l'effet** (le calque recopie le jeu)                                                                                                           | aucune ajoutée (filtre sur la capture d'OBS)                                                                                             |
| 3. Images/s du jeu     | le coût du moteur seul                                                                                                                                                                             | le moteur **plus** les passes d'OBS (même carte graphique)                                                                               |
| 4. Charge d'OBS        | **aucune**                                                                                                                                                                                         | une copie et une passe par filtre actif, en 2560×1440                                                                                    |
| 5. Stabilité           | un seul rendu, aucun état dans OBS                                                                                                                                                                 | plus de pièces (WebSocket, plugin, filtres, sessions) ; chacune se dégrade sans danger, mais elles existent                              |
| 6. Compatibilité       | capture d'**écran** de l'écran visé ; fenêtre qui l'occupe (mode E) ; **pas** sur le bureau pour les effets qui lisent l'image ; ni capture de jeu ni capture de fenêtre ; ni plein écran exclusif | **toutes** les sources (écran, fenêtre, jeu), le bureau, le plein écran exclusif côté stream                                             |
| 7. Coût GPU et mémoire | le plus bas                                                                                                                                                                                        | plus haut (non mesuré en 1440p ; banc en attente)                                                                                        |
| 8. Maintenance         | un moteur                                                                                                                                                                                          | export mécanique (pas de seconde bibliothèque), mais gestion des filtres OBS et dépendance à obs-shaderfilter                            |
| 9. Les 13 effets       | **13**                                                                                                                                                                                             | 12 (flash absent)                                                                                                                        |
| 10. Plantage           | le moteur meurt, le calque disparaît : écran et stream normaux                                                                                                                                     | filtres possiblement restés actifs, neutralisés par la fenêtre de validité et la réconciliation ; plus de cas à penser                   |

**Lecture.**

- Pour **ton** montage, A gagne sur 7 critères sur 10 :
  - « Écran » est une capture DXGI de l'écran de jeu ;
  - tu joues en fenêtré sans bordure ;
  - la webcam et les alertes sont au-dessus dans OBS.
- B ne gagne que sur la compatibilité (bureau, autres sources), la latence du stream pendant l'effet et la barre des
  tâches vivante dans le stream.

## 4. Retour au principe Halloween : possible, et déjà en place

- La « fenêtre GPU capturable et click-through, intégrée à la composition du bureau » **existe** : c'est la surface V2
  des modes D et E.
  - Elle ne se réinjecte pas dans sa propre capture, parce qu'elle capture la fenêtre du jeu.
  - L'image du reste de l'écran (barre des tâches) est prise une fois, avant son apparition.
- **Aucune rotation de Windows** n'est nécessaire.
- **Ce qu'il manque, pour A par défaut :**
  - **régler le choix des sorties sur le mode du moteur** : fenêtre qui occupe l'écran (E) → écran seulement (A) ;
    bureau (C) → écran + OBS (B) si les filtres sont prêts, sinon écran seulement, en le disant.

    Studio connaît déjà ce mode : `targets.list` et `--resolve-screens` le donnent. Environ 20 lignes dans
    `obs-output.ts` (`outputsFor`), plus leurs tests ;

  - le défaut du panneau « Diffusion OBS » devient ce choix automatique, avec les libellés « Automatique (calque vu par
    OBS, filtres seulement sur le bureau) », « Écran seulement » et « Écran + OBS ».
- **Coût** : environ une demi-journée, tests compris. Aucun nouveau composant.
- **Limites qui restent en A :**
  - bureau sans fenêtre agrandie (effets qui lisent l'image) ;
  - jeu en plein écran exclusif ;
  - source OBS qui ne serait pas une capture d'écran ;
  - barre des tâches figée pendant l'effet (pour toi comme pour les spectateurs) ;
  - 1 à 2 images de retard du gameplay diffusé pendant l'effet.
- **Pistes écartées pour couvrir aussi le bureau sans filtres :**
  - API Magnification avec liste d'exclusion : elle exclut nos fenêtres de **sa** capture seulement, mais rend sur le
    processeur avec un rappel déconseillé ;
  - exclusion une image sur deux : clignotement dans le stream ;
  - capturer chaque fenêtre et recomposer le bureau : c'est refaire DWM.

## 5. Ce qui reste à prouver, et comment, sans perturber ton écran

**La question décisive :** la capture DXGI de « Écran » voit-elle le calque V2 non exclu, et ne le voit-elle plus une
fois exclu ?

- **DOC** : oui. C'est le comportement documenté de DXGI et de WGC.
- **PROUVÉ** pour Halloween : la fenêtre des effets, non exclue, était prévue pour être vue par OBS.
- **Pas encore mesuré** sur la surface V2.

**Sonde quasi invisible, prête et compilée :** `chaos-bench.exe --capture-probe`.

- Elle pose sur l'écran droit le vrai calque V2, porteur d'un damier blanc à **2/255** d'opacité (imperceptible),
  pendant quelques secondes.
- Elle lit l'écran par DXGI et par WGC, avec puis sans exclusion.
- La réponse est statistique : écart entre les cases du damier et les cases vides, sur environ 6 000 points.
- Elle est refusée pendant un jeu ou une application plein écran.
- La règle de sécurité de cette session a refusé que je la lance moi-même (essai sur ton vrai moniteur) : **à
  lancer par toi** :

```
C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\chaos-v2\apps\chaos-engine\bin\chaos-bench.exe --capture-probe --screen \\.\DISPLAY1
```

`\\.\DISPLAY1` est ton écran droit, celui que capture « Écran » (journal OBS : `alt_id: \\.\DISPLAY1`). Le binaire est
construit (24/11) ; après une mise à jour du code : `apps\chaos-engine\build.cmd`. Les résultats vont aussi dans
`%TEMP%\chaos-capture-probe-*.json`.

**La garde de jeu (24/11, corrigée).**

- Toute la journée, elle refusait « application plein écran au premier plan ». La cause n'était pas un jeu : ce sont
  **les deux fenêtres Halloween de Studio** (« Raptoru — Halloween », toujours ouvertes car « Overlay actif » est
  allumé, AUDIT D1). Elles sont transparentes, traversables, au premier plan et couvrent l'écran droit.
- Windows les compte comme une application plein écran (`SHQueryUserNotificationState` = occupé), et la garde le
  croyait sans chercher la fenêtre.
- Désormais, `N.CheckGame()` identifie la fenêtre :
  - un calque traversable n'est jamais un jeu : il est ignoré, avec une note ;
  - bloquent toujours : un jeu connu lancé, une fenêtre non traversable qui couvre un écran (jeu en fenêtré sans
    bordure, vidéo plein écran), le plein écran exclusif Direct3D, le mode présentation, et un « plein écran » de
    Windows qu'aucune fenêtre n'explique.
- `ChaosEngine.exe --game-check` affiche la règle, le processus, la fenêtre, l'écran et les notes.
- Conseil : éteindre « Overlay actif » dans Studio › Halloween (événement fermé). Ces fenêtres restent au-dessus de
  ton jeu en permanence (composition forcée par Windows, RECHERCHE § 3 C3) et Windows te croit en plein écran.

| Résultat attendu (DOC)                                           | Conséquence                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| DXGI « VOIT le calque », puis « ne le voit plus » une fois exclu | A est valable chez toi : recommandation confirmée                    |
| DXGI « ne voit PAS le calque » non exclu                         | A est impossible avec cette méthode : B (mode C) reste la seule voie |

**Vérification visible équivalente** (2 minutes, jeu fermé, OBS ouvert, rien n'y est modifié) :

1. Dans Studio › Chaos › Diffusion OBS, choisis « Écran uniquement » ; agrandis une fenêtre sur l'écran droit.
2. Lance **Miroir** : l'aperçu d'OBS doit montrer l'écran inversé (le calque est capturé).
3. Réduis toutes les fenêtres (bureau), puis relance **Miroir** : l'aperçu d'OBS reste droit (mode C, exclusion). C'est
   le seul cas où B est nécessaire.

Le banc `chaos-bench.exe --obs-compat` (visible) fait la même chose automatiquement.

## 6. Recommandation finale

1. **Garder un seul moteur et une seule bibliothèque d'effets.** C'est déjà le cas, et l'export OBS n'est qu'une
   traduction mécanique.
2. **Si la vérification du § 5 confirme A :**
   - mode **automatique** par défaut : A (calque capturé, aucun filtre actif) dès qu'une fenêtre occupe l'écran ;
   - B seulement sur le bureau, et seulement si tu as préparé les filtres ;
   - le panneau dit quelle voie chaque activation a prise.

   C'est la solution la plus simple, fidèle et fluide pour ton montage : une seule image, rien de plus dans OBS, les
   13 effets.

3. **Si elle infirme A** : le mode C actuel (B) reste la voie, déjà construite et testée.
4. **Dans les deux cas**, ne pas revenir à la capture Chromium d'Halloween (copies GPU → CPU, curseur incrusté) ni à la
   rotation de Windows.

**Correction à reporter :** ECRAN_ENTIER.md § 2 (méthode DXGI, pas WGC).

## 7. Sources

- **Dépôt :**
  - `51efd477`, `f9a7dabc`, `b712e812`, `bb63b75f` ;
  - `apps/studio/desktop/src/halloween-overlay.ts`, `apps/studio/server/halloween-overlay/overlay.js`,
    `apps/studio/server/src/halloween/chaos-obs.ts`, `halloween/runtime.ts` ;
  - `apps/chaos-engine/src/Present/Surface.cs`, `Host/Targets.cs`, `Host/Engine.cs` ;
  - [AUDIT_CHAOS_V1.md](AUDIT_CHAOS_V1.md), [RECHERCHE_CHAOS_V2.md](RECHERCHE_CHAOS_V2.md),
    [ARCHITECTURE_CHAOS_V2.md](ARCHITECTURE_CHAOS_V2.md) § 2–3, [MODE_C.md](MODE_C.md).
- **Données locales lues sans modification :**
  - `apps/studio/server/.runtime/halloween/settings.json` (31/10, 17 h 43) ;
  - collection de scènes OBS active et journal OBS `2026-11-23 03-59-52.txt` ;
  - build-info du Studio installé.
- **Microsoft :**
  - `SetWindowDisplayAffinity` / `WDA_EXCLUDEFROMCAPTURE`
    (learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity) ;
  - Desktop Duplication API (learn.microsoft.com/windows/win32/direct3ddxgi/desktop-dup-api) ;
  - Windows.Graphics.Capture.
