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
