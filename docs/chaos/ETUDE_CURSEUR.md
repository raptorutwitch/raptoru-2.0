# Retournement GPU : un seul curseur, retourné et juste ? (étude du 23/11/2026)

Demande : pendant le retournement par le calque GPU, un seul curseur visible, qui suit la rotation, des mouvements
inversés, des clics là où le curseur apparaît, retour immédiat à la normale. Contraintes absolues : aucune injection,
aucune modification de mémoire, aucun contournement d'anti-triche, aucune interception intrusive des entrées, rien qui
puisse laisser la souris masquée, bloquée ou inversée après un plantage. Pas de faux curseur, pas de double curseur.

Retour d'Antoni (23/11, Overwatch, champ de tir, OBS ouvert sans diffusion, moteur optimisé du jour) : retournement
correct, pas de ralentissement perceptible, fluidité satisfaisante ; **le vrai curseur ne suit pas la rotation**, les
clics ne correspondent pas à ce que l'on voit.

## 0. Suite du 23/11 après-midi : décision d'Antoni et essai de la piste C

**Décision d'Antoni** : la piste C est exactement l'objectif. Le curseur Windows garde ses coordonnées normales, les
clics vont aux coordonnées d'origine, et le curseur visible est celui de l'image retournée : il se déplace donc à
l'inverse des mouvements physiques. **Aucune inversion des vraies entrées.** Jamais deux curseurs visibles.

**Essai d'Antoni** (`--cursor-demo`, deux fois, reproductible) : les 12 cases se retournent ; au-dessus de la zone,
le curseur Windows disparaît bien, mais **aucun curseur n'apparaît dans l'image retournée** ; hors de la zone, le
curseur revient aussitôt et normalement.

**Cause la plus probable** (à confirmer par le diagnostic ci-dessous) : la capture de Windows (WGC) ne dessine le
curseur que s'il est visible. `MagShowSystemCursor(FALSE)` le masque pour tout le système, captures comprises : la
combinaison « masqué à l'écran, présent dans la capture » n'existe pas. Les documentations sont muettes sur ce point.

**Diagnostic** `chaos-bench.exe --cursor-proto --maintenant` (10 à 15 s, souris immobile au-dessus d'une fenêtre
ordinaire, sans jeu ; le curseur disparaît quelques secondes à deux reprises). Il distingue les causes :

| Étape | Question                                                                                        | Si « non »                                                     |
| ----- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| B1    | curseur visible : présent dans la texture d'une capture d'écran ? `IsCursorCaptureEnabled` relu | l'option n'est pas prise en compte                             |
| B2    | même chose pour une capture de fenêtre (le cas de la démo)                                      | la capture de fenêtre n'inclut pas le curseur                  |
| B3    | la chaîne GPU du moteur (retournement 180°) conserve-t-elle le curseur, au point retourné ?     | perte pendant la composition GPU                               |
| C1    | curseur masqué : drapeaux et forme lus par `GetCursorInfo`, état Desktop Duplication            | la forme du curseur n'est plus lisible une fois masqué         |
| C2-C3 | curseur masqué : encore présent dans la texture capturée (écran, fenêtre) ?                     | **Windows retire le curseur des captures quand il est masqué** |
| D1-D2 | processus masqueur tué, puis gelé : le curseur revient-il (seul, ou par le gardien) ?           | risque de curseur perdu                                        |

La présence se mesure par l'écart entre deux captures simultanées de la même cible, l'une avec le curseur, l'autre
sans, à l'endroit de la pointe. Rien n'est affiché, la souris n'est jamais déplacée.

**Alternative sans la capture : l'image du vrai curseur, dessinée retournée.** Si Windows retire le curseur des
captures, l'image de la piste C peut être obtenue autrement :

- à chaque image, Chaos lit **la forme et la position courantes du vrai curseur** (`GetCursorInfo`, lecture seule) ;
- Windows lui-même rend cette forme (`DrawIconEx`), exactement comme la capture du curseur d'OBS ;
- Chaos la pose **retournée au point miroir** dans l'image retournée ;
- le curseur matériel reste masqué au-dessus de la cible, les coordonnées et les clics restent ceux de Windows.

Le résultat à l'écran est celui que décrit Antoni : un seul curseur, celui de l'image retournée, juste au-dessus de ce
que le clic touchera. Différence avec la capture : c'est Chaos qui dépose l'image du curseur dans l'image retournée,
au lieu que la capture l'y mette. La forme suit le curseur réel (flèche, main, barre de texte, curseurs propres aux
jeux). Si le programme visé cache son curseur (visée d'un FPS), rien n'est dessiné.

- Démo : `chaos-bench.exe --cursor-demo` (cette voie par défaut ; l'ancienne : `--curseur capture`). Elle affiche aussi,
  pendant le masquage, ce que renvoie `GetCursorInfo`, et le retard du curseur dessiné (position lue → composition).
- Auto-test hors écran `chaos-bench.exe --cursor-selftest` (aucune fenêtre, curseur jamais masqué) : **6/6 le 23/11**.
  Flèche, barre de texte et main sont lues avec leur pointe ; la flèche est posée retournée, pointe au point miroir
  exact, et un seul curseur figure dans l'image.
- Limites connues : taille de pointeur agrandie dans les paramètres d'accessibilité (à vérifier), curseurs animés
  (première image seulement), environ une image de retard.

Rien n'est intégré au moteur principal avant des essais concluants.

## 1. Réponse courte (avant l'essai de la piste C)

1. **Avec le calque GPU, le curseur matériel de Windows ne peut pas suivre la rotation.** Windows le dessine toujours à
   sa position réelle, qui est aussi le point du clic. Une seule fonction de Windows déplace à la fois le curseur affiché
   et le repère des clics : l'orientation de l'affichage, c'est-à-dire un changement de mode (incident du 22/11).
2. **L'inversion des mouvements n'est jamais le problème.** Si le curseur visible est l'image retournée du vrai
   curseur, monter la souris le fait descendre et le clic tombe pile dessous, sans rien intercepter. Tout se ramène à
   « quel curseur est visible ».
3. **Une seule piste respecte toutes les contraintes techniques** : masquer le curseur matériel (API Loupe de Windows) et
   laisser Windows dessiner le curseur dans l'image capturée, retournée avec le reste. Un seul curseur visible, retourné,
   mouvements inversés, clics justes. Mais il passe par la capture (environ une image de retard) et n'est plus le
   plan matériel. **Est-ce un « faux curseur » ? C'est la décision d'Antoni.** Ses prérequis se vérifient avec le
   prototype du § 5 ; rien n'est branché dans le moteur.
4. Pour les jeux qui dessinent leur propre curseur, et pour la visée d'un FPS, le calque donne déjà le résultat complet
   (§ 3).

## 2. L'obstacle, précisément

Le calque montre le contenu du point P (repère réel de l'écran) au point retourné M(P) = (largeur − x, hauteur − y).

- Le clic tombe toujours en P, la position réelle du curseur : c'est Windows qui le route, le calque est traversable.
- Pour que le clic tombe « sous » le curseur visible, il faudrait voir le curseur en M(P).
- Le curseur matériel est dessiné par Windows en P, par-dessus tout, calque compris. Il n'est donc juste qu'au centre de
  l'écran.

Ce que Windows propose (sources dans le § 7) :

| Mécanisme                                                   | Ce qu'il fait                                                                                            | Verdict                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Orientation de l'affichage (`DMDO_180`, `SetDisplayConfig`) | Windows retourne l'écran, le curseur matériel et le repère des clics                                     | seule solution « curseur matériel » ; c'est un changement de mode : expérimental, coupé                             |
| Transformation d'affichage sans changement de mode          | n'existe pas : DirectComposition ne transforme que ses propres visuels                                   | impossible                                                                                                          |
| Loupe plein écran (`MagSetFullscreenTransform`)             | agrandissement de 1 à 4096 et décalage ; ni rotation ni miroir                                           | impossible                                                                                                          |
| Loupe fenêtrée (`MagSetWindowTransform`)                    | matrice documentée pour l'agrandissement seulement ; facteur inférieur à 1 invalide                      | impossible (miroir non documenté)                                                                                   |
| `MagSetInputTransform`                                      | reroute stylet, tactile et, depuis Windows 10 1703, la souris vers l'élément agrandi                     | exige **UIAccess** (programme signé, installé dans Program Files) ; miroir non documenté : écarté                   |
| Réglages de la souris (`SPI_*`)                             | vitesse, accélération, boutons inversés ; aucune inversion des axes                                      | impossible                                                                                                          |
| `SetCursorPos`                                              | déplace le curseur ; ne change pas le point du clic                                                      | ne résout rien, et déplacer le curseur sans cesse serait intrusif                                                   |
| Raw Input                                                   | lecture seule des mouvements ; ne peut ni modifier ni bloquer l'entrée des autres programmes             | utile pour mesurer, inutile pour corriger                                                                           |
| Crochet souris bas niveau, réinjection                      | intercepte et modifie la souris                                                                          | **interdit** (intrusif, anti-triche, souris bloquée si le programme gèle)                                           |
| `SetSystemCursor`                                           | remplace l'image des curseurs système ; persiste après un plantage ; ne touche pas les curseurs des jeux | écarté                                                                                                              |
| Pilote d'écran virtuel                                      | installation d'un pilote, jeu déplacé sur un écran fictif                                                | écarté                                                                                                              |
| `MagShowSystemCursor(FALSE)`                                | masque le curseur système, sans compteur, effet immédiat ; aucun droit particulier documenté             | **seul moyen documenté** de masquer le curseur pour tous les programmes ; comportement après plantage non documenté |
| `IsCursorCaptureEnabled` (Windows.Graphics.Capture)         | Windows dessine le curseur dans l'image capturée                                                         | permet d'afficher le vrai curseur **retourné avec l'image** ; inclus une fois masqué ? non documenté                |

## 3. Les jeux

| Situation                                                                                  | Avec le calque seul                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Visée à la souris (FPS, Overwatch en partie) : Raw Input, curseur masqué, viseur au centre | **effet complet** : image retournée, viseur au centre, contrôles visuellement inversés ; aucun curseur |
| Jeu qui dessine son curseur dans son image (curseur logiciel)                              | **effet complet** : le curseur fait partie de l'image capturée, il est retourné, ses clics sont justes |
| Jeu, menu ou bureau qui utilise le curseur de Windows (menus d'Overwatch, Dofus)           | **le problème** : curseur non retourné, clics décalés (sauf au centre)                                 |
| Plein écran exclusif                                                                       | refusé par le moteur (rien ne peut s'afficher par-dessus)                                              |

## 4. Les pistes

| Piste                                                                                            | Un seul curseur | Suit la rotation | Clics justes | Mouvements inversés | Coût et risques                                                                                                                             | État                                                              |
| ------------------------------------------------------------------------------------------------ | --------------- | ---------------- | ------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A. Calque seul                                                                                   | oui             | non              | non          | non                 | aucun                                                                                                                                       | **en service** (défaut)                                           |
| B. Windows retourne l'affichage                                                                  | oui (matériel)  | oui              | oui          | oui                 | deux changements de mode par effet : Overwatch à 17 images/s sur l'autre écran                                                              | expérimental, coupé, **jamais pour une activation communautaire** |
| C. Calque + curseur de Windows dans la capture + curseur matériel masqué (`MagShowSystemCursor`) | oui             | oui              | oui          | oui                 | environ une image de retard sur le curseur ; masqué aussi sur l'autre écran (à rétablir hors de la cible) ; plantage à vérifier ; OBS (§ 6) | **candidat**, prérequis au prototype (§ 5), décision d'Antoni     |
| D. Comme C, mais curseur dessiné par Chaos (forme lue par `GetCursorInfo`)                       | oui             | oui              | oui          | oui                 | comme C ; la forme est une copie                                                                                                            | écarté : c'est un faux curseur                                    |
| E. Crochet souris ou réinjection                                                                 | —               | —                | —            | —                   | interdit                                                                                                                                    | écarté                                                            |

Pourquoi C n'est pas un bricolage : aucune entrée n'est touchée ; Windows dessine lui-même le curseur dans l'image qu'il
capture ; Chaos ne fait que masquer le plan matériel pendant l'effet, avec une API documentée, puis le rétablit. Ce qui
le rendrait inacceptable : un curseur qui ne revient pas après un plantage (Q4), ou absent de la capture une fois masqué
(Q3).

Ce que C changerait encore (à décider avant toute implémentation) :

- Le curseur ne serait masqué que lorsqu'il est au-dessus de la cible, et rétabli dès qu'il en sort (sinon il
  disparaîtrait aussi sur l'autre écran).
- Le gardien (processus séparé) rétablirait le curseur si le moteur meurt, comme il rétablit déjà l'écran.
- Interrupteur « curseur retourné (expérimental) », coupé par défaut, jamais pour une activation communautaire tant
  qu'il n'est pas validé en jeu.
- Anti-triche : l'API Loupe est une API d'accessibilité, sans injection ; certains anti-triche surveillent les loupes
  utilisées comme calques de triche. Non documenté : à vérifier avant tout usage en partie classée.

## 5. Prototype isolé

`chaos-bench.exe --cursor-proto` ([tests/CursorProto.cs](../../apps/chaos-engine/tests/CursorProto.cs)) vérifie les
prérequis de C sans rien brancher dans le moteur :

- Q1 : la capture WGC contient-elle le curseur (référence) ?
- Q2 : `MagShowSystemCursor(FALSE)` le masque-t-il (état Windows, Desktop Duplication) ?
- Q3 : la capture WGC le contient-elle encore une fois masqué ?
- Q4 : si le processus qui l'a masqué est tué, revient-il seul ? Sinon, un autre processus (le gardien) peut-il le
  rétablir ?

Il ne déplace jamais la souris, n'intercepte rien, masque le curseur une seconde au plus à la fois et le rétablit
toujours. Il ne tourne que sans jeu ni plein écran, et si personne n'a touché la souris ou le clavier depuis 2 minutes
(`--maintenant` pour un essai voulu par Antoni).

**Résultats** : voir [PERFORMANCES_MOTEUR.md](PERFORMANCES_MOTEUR.md) § 7 (campagne du 23/11).

## 6. OBS et le curseur

Les scènes d'Antoni capturent l'écran (« Capture d'écran », méthode choisie par OBS : WGC, curseur capturé).

- Avec le calque seul, les spectateurs voient l'image retournée et le curseur à sa position réelle, comme Antoni.
- Avec la piste C, OBS ajoute son propre curseur (position réelle) si « Capturer le curseur » est coché : les
  spectateurs verraient deux curseurs. Il faudrait décocher cette option dans les scènes de jeu (réglage d'Antoni,
  jamais modifié par Chaos).

## 7. Sources

- Loupe : [MagShowSystemCursor](https://learn.microsoft.com/en-us/windows/win32/api/magnification/nf-magnification-magshowsystemcursor),
  [MagSetInputTransform](https://learn.microsoft.com/en-us/windows/win32/api/magnification/nf-magnification-magsetinputtransform),
  [MagSetFullscreenTransform](https://learn.microsoft.com/en-us/windows/win32/api/magnification/nf-magnification-magsetfullscreentransform),
  [MAGTRANSFORM](https://learn.microsoft.com/en-us/windows/win32/api/magnification/ns-magnification-magtransform).
- Capture : [IsCursorCaptureEnabled](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.iscursorcaptureenabled).
- Curseur et entrées : [SetSystemCursor](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setsystemcursor),
  [SetCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcursorpos),
  [RAWINPUTDEVICE](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawinputdevice),
  [souris relative dans les jeux](https://learn.microsoft.com/en-us/windows/uwp/gaming/relative-mouse-movement).
- Affichage : [ChangeDisplaySettingsEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-changedisplaysettingsexw),
  [SetDisplayConfig](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setdisplayconfig).
- OBS : [window-capture.c](https://github.com/obsproject/obs-studio/blob/master/plugins/win-capture/window-capture.c),
  [duplicator-monitor-capture.c](https://github.com/obsproject/obs-studio/blob/master/plugins/win-capture/duplicator-monitor-capture.c),
  [cursor-capture.c](https://github.com/obsproject/obs-studio/blob/master/plugins/win-capture/cursor-capture.c).
