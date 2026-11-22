# Lecteur Chaos V2 — prototype du lot 1 (retournement à 180°)

Prototype autonome du moteur de présentation recommandé par [`docs/chaos/ARCHITECTURE_CHAOS_V2.md`](../../docs/chaos/ARCHITECTURE_CHAOS_V2.md)
(mode D). Il ne touche ni au Core, ni aux Jetons, ni à l'extension, ni à OBS, ni à Studio. **Effet unique : retournement
à 180°.**

## Principe

```text
fenêtre du jeu ──WGC (curseur exclu à la source)──► texture GPU ──copie GPU──► shader 180° ──► fenêtre DirectComposition
                                                                                              traversable, au premier plan
```

- **Capture** : Windows.Graphics.Capture de la **fenêtre** choisie (mode D), `IsCursorCaptureEnabled = false` : le
  curseur n'entre jamais dans l'image. Aucun carré de masquage, aucun faux curseur. Le seul curseur visible est le
  vrai curseur Windows, dessiné par Windows au-dessus de toutes les fenêtres.
- **Pas de recapture** : une capture de fenêtre ne voit pas les fenêtres posées dessus. L'image retournée ne revient
  donc jamais dans sa propre capture.
- **GPU uniquement** : copie de texture à texture, puis un shader (pixel exact à 180°). Aucune lecture GPU → CPU par
  image. Seule exception : un contrôle 16×16 toutes les 2 s, qui signale une capture noire.
- **Fenêtre** : `TOPMOST | TRANSPARENT | LAYERED | NOACTIVATE | TOOLWINDOW | NOREDIRECTIONBITMAP`.
  - Les clics et le clavier vont au jeu.
  - Elle ne prend jamais le focus et n'apparaît pas dans la barre des tâches.
  - Elle n'apparaît qu'avec sa première image prête (pas de flash) et se place exactement sur la fenêtre du jeu.
- **OBS** : en mode D, la fenêtre n'est pas exclue des captures. La capture d'écran d'OBS montre donc l'effet aux
  viewers, sans filtre.
- **Mode C (secours)** : capture de l'écran entier et fenêtre exclue des captures (`WDA_EXCLUDEFROMCAPTURE`). L'effet
  est local seulement : OBS ne le voit pas.
- **Au premier plan seulement** (réglage par défaut) : si tu changes de fenêtre ou réduis le jeu, l'effet se masque.
  Il ne recouvre jamais une autre application.

Aucune injection, aucun accès à la mémoire ou au processus du jeu, aucune entrée interceptée ou modifiée, aucun
réglage Windows changé.

## Lancer et arrêter (Antoni)

1. Double-cliquer `bin\ChaosPresenter.exe` (à construire une fois avec `build.cmd`, voir plus bas) : le panneau
   s'ouvre.
2. Mettre le jeu en **fenêtré sans bordure** (le plein écran exclusif est refusé avec un message).
3. Deux façons de lancer :
   - **dans le jeu** : `Ctrl+Maj+F10` retourne la fenêtre au premier plan pendant la durée réglée ;
   - **depuis le panneau** : choisir la fenêtre, puis « Démarrer ». L'effet apparaît quand le jeu repasse au premier
     plan.
4. **Arrêter tout de suite** : `Ctrl+Maj+F11` (partout, même en jeu) ou le bouton **ARRÊTER**. Sinon, l'effet s'arrête
   seul à la fin de la durée (1 à 60 s).
5. Fermer le panneau arrête aussi tout.
6. Journal de chaque essai : `bin\chaos-journal.txt` (événements et mesures, sans titre de fenêtre).

Réglages du panneau : durée, bascule animée (0,55 s, ≤ 520°/s), mode D ou C, « seulement au premier plan ».

## Garanties d'arrêt (restauration par construction)

La fenêtre de l'effet appartient au processus lecteur. Quand le lecteur se termine, Windows détruit sa fenêtre et
l'écran redevient normal. Il n'y a rien à restaurer.

| Situation                                     | Ce qui arrête                                        | Mesuré (contrôles du 22/11) |
| --------------------------------------------- | ---------------------------------------------------- | --------------------------- |
| Fin normale                                   | durée interne au lecteur                             | 2 s + 0,55 s : 2 578 ms     |
| ARRÊTER / `Ctrl+Maj+F11`                      | `stop_all`, puis arrêt forcé à 500 ms si besoin      | écran normal en 10 à 35 ms  |
| Panneau fermé ou planté                       | tâche Windows « tuer à la fermeture » et stdin fermé | 17 à 26 ms                  |
| Panneau gelé                                  | plus de battement depuis 2 s                         | 2 044 à 2 053 ms            |
| Lecteur planté (tué)                          | Windows détruit la fenêtre                           | écran normal en 8 à 16 ms   |
| Fenêtre du jeu fermée                         | capture fermée et fenêtre disparue                   | 33 à 111 ms                 |
| Rendu bloqué (pilote, etc.)                   | délai absolu = durée + 3 s, depuis un autre fil      | non provoqué                |
| Durée demandée > 60 s                         | plafonnée à 60 s                                     | vérifié                     |
| Jeu en plein écran exclusif / fenêtre réduite | refus avant tout affichage                           | code vérifié, non provoqué  |

## Construire et tester

```bat
build.cmd                 :: compile avec le C# fourni par Windows (.NET Framework 4.8), rien à installer
bin\chaos-checks.exe      :: 26 contrôles automatiques (~50 s)
bin\chaos-checks.exe --with-monitor   :: + mode C (retourne tout l'écran secondaire 1,5 s)
```

Les contrôles affichent une mire de 400×240 sur l'écran secondaire, sans jamais l'activer. Ils lisent les pixels
réellement composés par Windows pour vérifier :

- l'absence de flash ;
- que le clic traverse la fenêtre ;
- que le focus n'a pas changé ;
- chaque chemin d'arrêt ;
- le chemin complet du panneau.

Ils mesurent aussi l'écran principal en 2560×1440 sans rien afficher.

**Langage** : C# sur .NET Framework 4.8, compilé par `csc.exe` de Windows. L'étude recommandait Rust, mais
l'installation de la chaîne Rust a été refusée par le garde-fou de l'agent. L'architecture est identique : un
processus séparé, WGC, D3D11, DirectComposition et le même protocole. Un portage Rust reste possible si Antoni installe
Rust.

## Protocole JSON (pour Studio, lot 2)

`ChaosPresenter.exe --serve [--parent <pid>]`, une ligne JSON par message.

- Commandes :
  - `{"cmd":"play","id":"…","effect":"flip","variant":"rotate180","max_ms":10000,"params":{"hwnd":123,"mode":"window"|"monitor","transition_ms":550,"follow_foreground":true}}` ;
  - `{"cmd":"stop_all"}` ;
  - `{"cmd":"ping"}`, au moins toutes les 2 s.
- Événements :
  - `ready` ;
  - `started` : première image réellement affichée, avec le mode, `first_frame_ms`, `setup_ms`, la bordure et l'adaptateur ;
  - `stats` : chaque seconde, capture et affichage par seconde, traitement p50/p95, GPU ms, CPU, Hz de composition, visible, noir ;
  - `warning` (`capture_black`) ;
  - `ended` : raison, `visible_ms`, totaux ;
  - `failed` : `no_window`, `target_minimized`, `exclusive_fullscreen`, `capture_denied`, `no_frame`, `busy`, … ;
  - `exit`.
- Un processus = un effet.

## Test réel sur le PC (Antoni, ~20 min)

Avant de commencer : fermer le panneau entre deux jeux si quelque chose paraît anormal. `Ctrl+Maj+F11` arrête tout.

| #   | Jeu                                | Faire                                                                                           | Regarder                                                                                                                                                             |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Bureau (explorateur ou navigateur) | panneau : choisir la fenêtre, « Démarrer », cliquer sur la fenêtre                              | **un seul curseur**, clics aux bons endroits, aucun carré ; aucun flash à l'entrée ni à la sortie, avec et sans « Bascule animée »                                   |
| R2  | Dofus (fenêtré sans bordure)       | en jeu, `Ctrl+Maj+F10`, se déplacer, cliquer des cases et l'interface                           | le curseur de Dofus est-il le vrai (normal) ou retourné avec l'image ? fluidité ; message « image noire » ?                                                          |
| R3  | Overwatch (fenêtré sans bordure)   | `Ctrl+Maj+F10` dans un menu, puis en partie d'entraînement                                      | curseur des menus ; le viseur (dessiné par le jeu, il tourne avec l'image : attendu) ; fluidité, sensation de latence ; FPS du jeu avant / pendant (compteur du jeu) |
| R4  | Un jeu d'horreur indépendant       | idem R3                                                                                         | idem ; capture refusée ou noire ?                                                                                                                                    |
| R5  | OBS (aperçu, sans diffuser)        | R3 avec la scène qui capture l'écran                                                            | l'aperçu montre l'effet (mode D)                                                                                                                                     |
| R6  | Arrêts                             | pendant un effet : `Ctrl+Maj+F11` ; une autre fois, fermer le panneau ; une autre fois, Alt+Tab | retour immédiat à la normale ; Alt+Tab masque l'effet, le retour au jeu le réaffiche                                                                                 |

Envoyer ensuite `bin\chaos-journal.txt` et une phrase par test : ce qui va, ce qui choque. Les mesures du lecteur
(capture et affichage par seconde, temps GPU) sont dans le panneau et le journal.

**Mesure fine facultative** (lot 0, GO d'Antoni pour installer PresentMon) : comparer les FPS affichés et le mode de
présentation du jeu sans effet et pendant l'effet. Voir [`RECHERCHE_CHAOS_V2.md`](../../docs/chaos/RECHERCHE_CHAOS_V2.md)
§ 6, paliers E1, E5 et E7. C'est la seule façon de mesurer la latence ajoutée réelle et la perte éventuelle de G-Sync.

## Limites connues

- **Plein écran exclusif** : rien ne peut s'afficher au-dessus. Le lecteur refuse avant de commencer.
- **Curseur ou viseur dessiné par le jeu** : il est dans l'image du jeu, donc retourné avec elle. On ne peut pas
  l'éviter sans injection, ce qui est interdit.
- **Latence** : le traitement du lecteur est mesuré à environ 0,4 ms (médiane, mire et écran 1440p). L'image retournée
  passe ensuite par une composition de Windows. La latence ajoutée attendue est d'environ une image d'affichage
  (estimation, non mesurée).
- **Pendant l'effet**, le jeu passe probablement de l'« independent flip » à la composition par Windows, avec une perte
  possible de G-Sync. À mesurer avec PresentMon (R3).
- **Alt+Tab** masque l'effet, mais la durée continue de s'écouler.
- Pas encore intégré à Studio ni payant : c'est le lot 2. Les raccourcis `Ctrl+Maj+F10` et `F11` du prototype
  diffèrent du STOP ALL de Studio (`Ctrl+Maj+F12`) pour ne pas entrer en conflit avec le Studio installé.
