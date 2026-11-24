# Chaos V2 : un seul curseur dans OBS, et VHS animé pendant le maintien

**Statut au 24/11** : développé et testé hors écran ; à valider par Antoni avec la version de test
`0.1.44-chaos.6`, qui n'est pas installée.

- **Branche** : `feat/chaos-studio`, locale.
- **Commits** :
  - `c7e8c582` : VHS ;
  - `a3f878dd` : curseur d'OBS ;
  - `f3ae3b3f` : mesure des images vides côté OBS.

La capture directe ([CAPTURE_DIRECTE.md](CAPTURE_DIRECTE.md)) n'est pas modifiée. Aucun filtre Chaos n'est réintroduit
dans OBS.

## 1. Deux curseurs dans OBS

### Cause

Six effets suivent le curseur : miroir, retournement, tremblement, zoom, ivre et tunnel (registre `"cursor": "follow"`).
Pendant ces effets, le moteur procède ainsi :

- il masque le vrai curseur à l'écran (`MagShowSystemCursor`) ;
- il dessine dans le calque le curseur transformé, aligné sur ce que le clic touchera.

La source « Écran » capture ce calque, donc aussi ce curseur. Mais OBS dessine en plus le vrai curseur. Il le lit de
Windows (`GetCursorInfo`), qui le dit toujours affiché : `MagShowSystemCursor` ne le cache qu'à l'écran. D'où deux
curseurs dans le stream.

Dans le mode C (filtres), ce problème n'existe pas : le calque est exclu, et les filtres transforment aussi le curseur
dessiné par OBS.

### Faisabilité par OBS WebSocket, mesurée

Le réglage « Capturer le curseur » s'appelle `capture_cursor` dans `monitor_capture` ; sa valeur par défaut est `true`.

- **La source est gardée.** `SetInputSettings` avec `overlay: true` conserve la source, sa scène et ses filtres ;
  seul ce réglage change.
- **Mais OBS redémarre sa capture.** À chaque changement de réglage, même du curseur seul, la source détruit et
  recrée sa duplication DXGI (code d'OBS : `update_settings` → `gs_duplicator_destroy`). En WGC, elle recrée sa
  session.
- **Résultat mesuré.** Avec `chaos-obs-check.exe --cursor-toggle`, une capture d'écran DXGI de l'écran 1 tourne dans
  une libobs sans fenêtre, comme « Écran ». Ton OBS n'est pas touché et aucune image n'est enregistrée.

  | Méthode                   | Images vides par changement (60 i/s)          | Référence sans changement |
  | ------------------------- | --------------------------------------------- | ------------------------- |
  | DXGI (celle de « Écran ») | 0 à 2 le plus souvent, 15 une fois (≈ 250 ms) | 1 sur 181                 |
  | WGC                       | 3 à 6                                         | 0 sur 180                 |

- **Conséquence.** Couper puis rétablir le curseur coûte une ou deux images vides au début et à la fin d'un effet à
  curseur, parfois plus. C'est inévitable par OBS WebSocket.
  - Studio réduit donc le nombre de changements au minimum : un au début, un à la fin.
  - Les effets simultanés ou enchaînés partagent la même coupure.
  - Le réglage est **désactivé par défaut**, pour que tu juges cette coupure avant de l'adopter.

### Ce que fait Studio (`apps/studio/server/src/chaos/obs-cursor.ts`)

- **Activation** : Studio › Chaos › Diffusion OBS › **Curseur d'OBS** :
  - « Laisser » : défaut, rien n'est demandé à OBS ;
  - « Masquer pendant les effets ».

  En capture directe, le panneau montre aussi la source gameplay et l'écran qu'elle capture, à choisir une fois.

- **Quand** :
  - seulement pour un effet qui dessine son curseur : registre `follow`, case « curseur » de la fiche cochée, suivi du
    curseur actif ;
  - sur l'écran que capture la source ;
  - sans sortie OBS (filtres) ni couche Entrées de Windows.

  Les autres effets (clignement, flash, brouillard, flou, pixelisation, couleur, VHS) ne changent rien.

- **Comment** :
  - sur la **seule connexion OBS de Studio** ;
  - `GetInputSettings` lit la valeur actuelle. Si le réglage est absent, la valeur par défaut d'OBS est lue
    (`GetInputDefaultSettings`) ;
  - la valeur d'avant est écrite sur disque (`obs-cursor.json`) ;
  - puis `SetInputSettings` est envoyé avec `{ capture_cursor: false }` et `overlay: true` ;
  - à la fin, `{ capture_cursor: <valeur d'avant> }`.

  Aucune autre requête, source, scène ni aucun filtre.

- **Effets simultanés ou enchaînés** :
  - chaque activation compte ;
  - le curseur n'est rétabli qu'après la fin de la dernière, plus 600 ms ;
  - un effet qui part dans ce délai garde la même coupure, sans second redémarrage de la capture.
- **Rétablissement immédiat** : STOP ALL, arrêt d'urgence, arrêt ou panne du moteur, fermeture de Studio.
- **OBS déconnecté** : la valeur reste à rétablir et l'est à son retour.
  - Si OBS revient pendant un effet avec le curseur rétabli (OBS redémarré), Studio le recoupe.
- **Studio redémarré pendant un effet** : la valeur gardée sur disque est rétablie à la première connexion.
- **Curseur déjà coupé par toi dans OBS** : laissé tel quel, rien à rétablir.
- **Transitions** : la coupure part dès que l'effet est accepté, avant que le calque n'apparaisse, et le
  rétablissement suit sa sortie. Au début et à la fin d'une transition, le curseur transformé est presque à la
  position du vrai, donc un éventuel recouvrement d'une image ne se voit pas.

## 2. VHS figé pendant le maintien

### Cause

Le problème était dans la cadence de rendu du moteur, pas dans le shader. Pendant le maintien, une surface n'était
redessinée que dans l'un de ces cas :

- une transition ;
- une **nouvelle image capturée** ;
- un curseur suivi ;
- un calque sans capture.

VHS lit l'image capturée **et** s'anime avec son horloge (bande, grain, glitchs). Sans nouvelle capture, aucune image
n'était due, et le dernier rendu restait affiché jusqu'à la sortie, qui s'anime de nouveau. C'est le cas d'une fenêtre
immobile, de l'image figée du mode E ou du bureau.

- **Ce qui s'arrêtait** : la présentation de nouvelles images, pas l'animation elle-même. L'horloge
  (`ElapsedMs = maintenant − départ`), les constantes du shader, le shader et les textures étaient justes. Dès qu'une
  capture arrivait, l'image montrait le bon instant.
- **Portée** :
  - **tout le moteur**, pas seulement la capture directe : modes C, D et E dès que l'image capturée ne change plus ;
  - avec un jeu qui s'anime, VHS suivait la cadence du jeu ;
  - flou pulsé et pixelisation progressive avaient le même défaut.

### Correctif

- `EffectFrame.ElapsedMs` note qu'une image a lu l'horloge de l'effet.
- Une surface dont la dernière image l'a lue est « animée par le temps » : elle est redessinée à chaque rafraîchissement
  (`Cadence.Timed`, même règle que les transitions).
- Une image identique reste sautée par la signature existante, donc un filtre immobile ne coûte rien de plus.
- Rendu VHS inchangé : même shader, mêmes paramètres, même horloge.

### Non-régression

`ChaosEngine.exe --check-hold <effet> [--expect-motion]` tourne hors écran, sur GPU, avec le vrai code des effets. Il
part d'une image source **fixe**, sans aucune nouvelle capture, et rejoue la cadence du moteur à 60 Hz. Il relève
l'entrée, cinq instants du maintien et la sortie.

| VHS                     | Images rendues pendant le maintien     | Image affichée qui change entre deux relevés du maintien |
| ----------------------- | -------------------------------------- | -------------------------------------------------------- |
| Avant (horloge ignorée) | 0 sur 582 (gel dès la fin de l'entrée) | 0 sur 4                                                  |
| Après                   | 582 sur 582                            | 4 sur 4 (≈ 74 % des pixels)                              |

Autres effets :

- **Flou et pixelisation** : 100 % du maintien rendu ; leurs réglages par défaut sont immobiles, donc l'image ne
  change pas.
- **Couleur** : sans horloge, une image par capture, comme avant.
- **Tests unitaires** : `chaos-unit.exe` contient la règle de cadence (cas VHS, ancienne règle, cas inchangés).

## 3. Tests

- **Moteur** :
  - unitaires 36/36 ;
  - `--check-hold` : VHS (avec mouvement), flou, pixelisation et couleur conformes.
- **Studio**, 34/34 :
  - curseur d'OBS, 9 tests avec OBS simulé : désactivé par défaut ; miroir coupé puis rétabli ; seul
    `capture_cursor` de « Écran » change, en `overlay` ; effets sans curseur, autre écran ou filtres sans effet ;
    simultanés et enchaînés avec une seule coupure ; STOP ALL ; curseur déjà coupé ; OBS déconnecté puis revenu ;
    Studio redémarré ; désactivation pendant un effet ;
  - sortie OBS, runtime, mode C avec le vrai moteur, export OBS.
- **Page** (Lab isolé, sans navigateur visible) : 38/38 à la seconde passe.
  - À la première passe, deux contrôles de la fiche du retournement ont échoué ; ce code n'a pas changé.
  - Le Lab venait de démarrer à froid : ces deux contrôles sont tenus pour intermittents.
- **Non vérifié ici** (affichage interdit à l'agent) :
  - le curseur unique dans ton OBS ;
  - la coupure visible au début et à la fin ;
  - VHS animé sur ton écran.

## 4. Validation par Antoni (hors live, jeu fermé)

1. Installer `0.1.44-chaos.6` ([GUIDE_STUDIO_CHAOS.md](GUIDE_STUDIO_CHAOS.md) § 4).
2. **VHS**, sans rien régler dans OBS :
   - Tester VHS avec Studio ou une fenêtre immobile sur l'écran 1 ;
   - le maintien doit bouger jusqu'au bout, à l'écran et dans « Écran ».
3. **Curseur** :
   - Diffusion OBS : choisir la source « Écran » et l'écran capturé, puis Curseur d'OBS → « Masquer pendant les
     effets ». C'est ton accord pour que Studio touche ce réglage d'OBS ;
   - Tester Miroir, puis Retournement : un seul curseur dans l'aperçu d'OBS ;
   - à la fin, « Capturer le curseur » de « Écran » est revenu tel qu'avant (propriétés de la source) ;
   - noter si la coupure d'une ou deux images au début et à la fin se voit.
4. STOP ALL pendant un miroir : curseur d'OBS rétabli aussitôt.
5. Si la coupure gêne : remettre « Laisser ». OBS n'est plus touché, et le double curseur revient.

**Retour arrière** : relancer `Raptoru Studio Setup 0.1.44-chaos.5.exe`.

## 5. Supprimer le flash noir de la bascule du curseur

Mandat d'Antoni du 24/11 au soir. Avec chaos.6/7, la suppression du double curseur fonctionne, mais un flash noir bref
et perceptible apparaît à chaque bascule.

### A. Diagnostic : ce qui se réinitialise dans OBS

Le diagnostic vient d'une lecture du code d'OBS (`master`) : `plugins/win-capture/duplicator-monitor-capture.c`,
`libobs-d3d11/d3d11-duplicator.cpp`, `cursor-capture.c` et `libobs/obs-scene.c`.

1. **Le déclenchement** : `SetInputSettings` (OBS WebSocket) appelle `obs_source_update`, puis la mise à jour de la
   source au tic vidéo suivant, puis `update_settings`. Cette fonction **ne compare rien**. Quel que soit le réglage
   changé (le curseur seul, ici), elle relâche la duplication de la source (`gs_duplicator_destroy`), remet sa taille à
   zéro et programme une recréation immédiate.
2. **Ce qui est recréé** : la duplication DXGI (`IDXGIOutputDuplication`). OBS la **partage entre toutes ses captures
   du même écran**, avec une table par écran et un compteur de références. Elle n'est détruite que lorsque la dernière
   capture de cet écran la relâche. « Écran » est la seule capture de son écran chez Antoni : chaque bascule détruit
   donc la duplication. La nouvelle ne livre pas d'image tout de suite. Pendant ce temps, la source ne dessine rien
   (`duplicator_capture_render` sort sans dessiner), d'où le noir.
3. **Recréation nécessaire ?** Non. Le curseur n'est pas dans la texture : OBS le dessine par-dessus, à part
   (`draw_cursor`, d'après `GetCursorInfo`). La recréation vient seulement de l'absence de comparaison dans
   `update_settings`. Seul un correctif d'OBS ou un plugin natif changerait ce code.
4. **Changer seulement la composition du curseur ?** Aucune API ne le permet sans passer par ce chemin.
   - En WGC, `winrt_capture_show_cursor` bascule le curseur sur la session vivante, mais la capture d'écran ne
     l'appelle pas : elle recrée aussi sa session.
   - Mesuré : 3 à 6 images vides par bascule en WGC, contre 0 à 2 en DXGI.
5. **Masquer le seul curseur par Windows ?**
   - OBS lit le curseur avec `GetCursorInfo` et met son image en cache par handle. La visibilité
     (`CURSOR_SHOWING`) et le dessin ne sont réévalués qu'au **changement de handle**.
   - `MagShowSystemCursor`, qu'utilise le moteur, ne touche pas `GetCursorInfo`.
   - Remplacer l'image d'un curseur système garde le même handle : OBS ne verrait rien.
   - `ShowCursor` ne vaut que pour un fil d'exécution.
   - Aucun réglage Windows propre ne cache le curseur à OBS seul, sans le dérégler.
6. **Garder la texture indépendamment du curseur : oui, par le partage.**
   - Une seconde capture du même écran, toujours affichée, garde la duplication en vie.
   - Quand « Écran » change de réglage, elle reprend la même duplication dans le même tic (`refs++`), avec sa texture
     déjà prête (`gs_duplicator_get_texture`).
   - La création et la lecture de l'image se font dans le même tic.
7. **DXGI ou WGC** : le partage n'existe qu'en DXGI. En WGC, chaque capture a sa propre session. « Écran » est en méthode
   Auto, et le journal d'OBS montre qu'elle tourne en DXGI.
8. **Pilotable depuis Studio, sans plugin** : `CreateInput`, `CreateSceneItem`, `SetSceneItemTransform`,
   `SetSceneItemIndex`, `SetSceneItemLocked`, `SetSceneItemEnabled`, `SetInputSettings`, `RemoveInput`.

### B. Architectures comparées

| Piste                                                                                                                  | Faisabilité OBS 33 | Preuve                                   | Ajouts dans OBS               | Plugin                   | Risque de noir                            | Risque de double curseur           | Remarques                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------- | ----------------------------- | ------------------------ | ----------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Actuelle (bascule `capture_cursor`)                                                                                    | oui                | mesuré : 0 à 2 images vides, une fois 15 | aucun                         | non                      | **oui**                                   | non                                | c'est le flash                                                                                                                    |
| **Relais** : petite capture sans curseur du même écran, hors cadre, dans chaque scène de « Écran » ; bascule inchangée | oui                | code lu, banc § C                        | 1 source, 1 élément par scène | non                      | nul attendu (§ C)                         | non                                | « Écran » ni déplacée ni masquée ; coût : une petite source qui partage la duplication                                            |
| Copie sans curseur **sous** « Écran »                                                                                  | oui                | code lu, banc § C                        | 1 source, 1 élément par scène | non                      | nul attendu, et filet si une image manque | non                                | sa visibilité doit suivre celle de « Écran » dans chaque scène (« Scène PS5 » : « Écran » masquée, la copie montrerait le bureau) |
| Deux captures, **visibilité** basculée                                                                                 | oui                | code lu, banc § C                        | 1 source, 1 élément par scène | non                      | nul grâce au même partage                 | possible 1 image à la réapparition | touche la visibilité d'éléments de production ; la capture masquée libère sa duplication                                          |
| Curseur hors DXGI (capture toujours sans curseur, curseur fourni à part)                                               | non sans plugin    | code lu                                  | source curseur                | **oui** pour être propre | —                                         | —                                  | OBS n'a pas de source « curseur » ; le déplacer par WebSocket = 60 requêtes/s, latence, formes non suivies                        |
| Côté Windows ou moteur (cacher le curseur à OBS seul)                                                                  | non                | code lu                                  | —                             | —                        | —                                         | —                                  | cache par handle dans OBS ; exclure le curseur Chaos donnerait au stream un curseur mal placé                                     |
| Correctif d'OBS (`update_settings` qui compare)                                                                        | hors Studio        | code lu                                  | —                             | build d'OBS              | nul                                       | non                                | à proposer à OBS, pas maintenable ici                                                                                             |

**Recommandation : le relais.** C'est la piste la plus simple qui supprime la cause, le noir, sans changer le
mécanisme validé :

- la bascule de « Capturer le curseur » reste ;
- « Écran » n'est ni déplacée, ni masquée, ni dupliquée avec ses filtres ;
- la bascule ne fait plus que relâcher puis reprendre une duplication qui reste vivante.

Le relais est hors cadre et minuscule. Il ne peut pas apparaître dans le stream, même si la visibilité de « Écran »
change dans une scène.

### C. Mesures (banc isolé, reproductible)

Commande : `chaos-obs-check.exe --cursor-relay --toggles 10 --canvas 1920x1080` (ou `2560x1440`).

- **Conditions** :
  - libobs 33.0.1 de l'OBS installé, chargée sans fenêtre ; l'OBS d'Antoni n'est pas touché ;
  - capture DXGI réelle de l'écran 1 (2560×1440), ajustée au canevas comme « Écran » ;
  - 60 i/s, 10 bascules par scénario ;
  - images comptées dans les 500 ms qui suivent chaque bascule ;
  - lancé le 24/11 vers 17 h 45, une fois la garde de jeu libre ;
  - rien d'affiché ni enregistré.

| Scénario                                                      | Images noires par bascule (1080p60) | (1440p60)         | « Écran » absente après bascule                           | GPU au repos (ms/image)                  | Mémoire vidéo du processus         | Images en retard |
| ------------------------------------------------------------- | ----------------------------------- | ----------------- | --------------------------------------------------------- | ---------------------------------------- | ---------------------------------- | ---------------- |
| Actuel (bascule seule)                                        | **1 à chaque bascule** (10/10)      | **1 à 2** (10/10) | 1 à 2                                                     | 1,23 / 1,48                              | 48,5 / 55,1 Mo                     | 0                |
| **Relais**                                                    | **0** (0/10)                        | **0** (0/10)      | **0**                                                     | 1,01 / 1,38–1,70                         | 48,5 / 55,1 Mo (identique)         | 0                |
| Copie dessous                                                 | 0                                   | 0                 | 0                                                         | 1,37 / 1,35                              | identique                          | 0                |
| Visibilité (masquer / réafficher)                             | 0                                   | 0                 | 0 à la réapparition (la copie couvre pendant le masquage) | 1,33 / 1,31                              | identique                          | 0                |
| Relais, 2 scènes, sortie basculée entre bascules (20 actions) | 0                                   | 0                 | 0                                                         | 1,27 / 1,40                              | identique                          | 0                |
| Scène type PS5 (« Écran » masquée, pas de relais)             | —                                   | —                 | « Écran » et relais **non affichés** : aucune capture     | 1,11 / 1,34 (plus bas : capture arrêtée) | 33,5 / 40,1 Mo (textures libérées) | 0                |

- **Le relais hors cadre garde la duplication.** OBS le tient pour affiché (`obs_source_showing` vrai). Le noir
  disparaît exactement comme le prévoit le code.
- **Coût du relais : aucun surcoût mesurable.**
  - La mémoire vidéo est identique, car la duplication et la texture sont partagées.
  - Les écarts de temps GPU, de −0,2 à +0,2 ms, d'un scénario à l'autre, restent dans le bruit de la mesure.
  - Une seule passe 1440p montre +0,2 ms, une autre −0,1 ms.
- **Limites** :
  - l'écran ne peut pas afficher de motif animé pendant le banc (interdit à l'agent) : une image **répétée** sur un
    écran immobile n'est pas détectable ; seules les images noires ou manquantes le sont ;
  - libobs sans encodeur ni autres sources : le coût absolu diffère du vrai OBS, seul l'écart entre scénarios compte ;
  - mesure DXGI seulement : le partage n'existe pas en WGC ;
  - la première passe 1440p avait un décalage de diagnostic fixe, corrigé et repassé ; ce sont les chiffres ci-dessus.

### D. Solution retenue : le relais (Studio `0.1.44-chaos.8`)

Studio › Chaos › Diffusion OBS › **Relais anti-coupure** (`apps/studio/server/src/chaos/obs-relay.ts`).

- **« Préparer le relais… »** montre un aperçu exact, demande confirmation, puis :
  - crée « Raptoru Chaos V2 · relais curseur · Écran » : capture d'écran du même écran, même méthode, sans curseur ;
  - l'ajoute **seulement aux scènes où « Écran » est visible** : Scène Fullscreen, Scène Dessin, Waiting screen ;
  - jamais dans Scène PS5, où « Écran » est masquée ;
  - en masquant l'élément le temps de le placer hors du cadre (−4000, −4000), à l'échelle 0,002, tout en bas et
    verrouillé, puis en l'affichant.
- **Idempotent** :
  - il complète une nouvelle scène où « Écran » est visible ;
  - il retire un relais resté dans une scène où « Écran » est devenue masquée ;
  - il suit « Écran » déplacée sur un autre écran.
- **La bascule du curseur ne change pas.** Le relais ne fait que garder la duplication en vie.
- **Rien d'autre n'est touché** : ni les réglages de « Écran », ni les autres sources, ni les filtres, ni les scènes.
- **Repli** : sans relais dans la scène affichée, le comportement est celui de chaos.6/7 (un curseur, coupure possible).
  Le panneau indique les scènes où il manque.

### E. Validation par Antoni (après son accord, hors live, jeu fermé)

1. Installer `0.1.44-chaos.8` ([GUIDE_STUDIO_CHAOS.md](GUIDE_STUDIO_CHAOS.md) § 4).
2. Diffusion OBS :
   - source « Écran » et écran capturé choisis ;
   - Curseur d'OBS → « Masquer pendant les effets » ;
   - **« Préparer le relais… »** : lire l'aperçu (trois scènes, pas Scène PS5), puis confirmer.

   C'est le seul ajout à ton OBS.

3. Dans OBS, vérifier :
   - « Raptoru Chaos V2 · relais curseur · Écran » est en bas des trois scènes, verrouillé et invisible dans l'aperçu ;
   - Scène PS5 est inchangée ;
   - « Écran » et ses réglages sont inchangés.
4. Scène Fullscreen, une fenêtre ou le jeu sur l'écran 1 :
   - Tester **Miroir** plusieurs fois de suite, puis **Écran retourné**, **Zoom** et **Écran ivre** ;
   - dans l'aperçu d'OBS : aucun flash noir au début ni à la fin, un seul curseur, bien placé ;
   - webcam et overlays inchangés.
5. Changer de scène pendant un miroir (Fullscreen → Dessin → Fullscreen) : aucun noir.
6. STOP ALL pendant un miroir : curseur d'OBS rétabli aussitôt, sans flash.
7. Sur Scène PS5 : rien de Chaos n'y capture l'écran du PC.

### F. Retour arrière

- **Immédiat** : « Retirer le relais… ». Le relais disparaît de toutes les scènes et on retrouve exactement le
  comportement de chaos.6/7.
- Ou Curseur d'OBS → « Laisser » : OBS n'est plus jamais touché (double curseur pendant les effets).
- Ou relancer `Raptoru Studio Setup 0.1.44-chaos.7.exe`. Retirer d'abord le relais depuis Studio, ou le supprimer à la
  main dans OBS : c'est une source ordinaire.
