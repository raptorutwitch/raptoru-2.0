# Arrêt d'urgence d'un effet Chaos

**Le retour à l'écran normal est garanti par l'architecture.**

- La fenêtre d'un effet appartient au processus moteur. Quand le moteur s'arrête pour une raison quelconque, Windows
  détruit la fenêtre.
- L'écran retourné par Windows (retournement de l'écran entier, [COUCHE_ENTREES.md](COUCHE_ENTREES.md)) est un mode
  temporaire qui appartient lui aussi au processus moteur. À sa mort, Windows remet l'écran à l'endroit tout seul
  (vérifié : 86 à 88 ms). Rien n'est jamais enregistré dans les réglages de Windows : un redémarrage rétablit aussi
  tout.
- La fenêtre ne prend jamais ni clic ni clavier : elle ne peut pas bloquer le jeu. La souris n'est jamais interceptée.

## Ce que fait Antoni

| Situation                                           | Geste                                                                                                     | Délai mesuré                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Un effet doit s'arrêter, n'importe où (même en jeu) | **Ctrl+Maj+F11** : le gardien demande l'arrêt de tout ; si le moteur n'obéit pas en 700 ms, il le termine | 26 à 37 ms ; écran entier retourné : 87 à 109 ms (même chemin que le raccourci ; la touche réelle reste à essayer, R6) |
| Depuis Studio                                       | **STOP ALL** (en haut de la page Chaos)                                                                   | 6 à 10 ms à l'écran ; écran entier retourné : 81 à 90 ms                                                               |
| Un seul effet                                       | « Arrêter » sur sa ligne, dans « En cours »                                                               | fin par la rotation de sortie (environ 0,25 à 0,55 s)                                                                  |
| Plus rien ne répond                                 | fermer Studio (ou le Chaos Lab) : le moteur suit son parent                                               | environ 20 ms                                                                                                          |
| En dernier recours                                  | Gestionnaire des tâches › terminer `ChaosEngine.exe`                                                      | immédiat (7 à 16 ms mesurés ; écran retourné rétabli par Windows en 86 à 88 ms)                                        |
| Écran resté retourné (jamais observé)               | `ChaosEngine.exe --restore-display`, ou Paramètres › Affichage › Orientation › Paysage                    | immédiat                                                                                                               |

## Ce que fait le système, sans personne

| Panne                                                                                           | Réaction                                                                                      | Délai                       |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| Studio planté ou fermé                                                                          | le moteur surveille son parent, puis sort                                                     | environ 20 ms               |
| Studio figé (plus de battement)                                                                 | le moteur sort                                                                                | 3 s (réglable)              |
| Moteur figé (boucle de rendu bloquée) alors qu'un effet est visible ou qu'un écran est retourné | le gardien le termine, Windows rétablit l'écran ; le moteur se surveille aussi lui-même (2 s) | environ 2,5 à 2,7 s mesurés |
| Curseur retourné : moteur arrêté, tué ou planté                                                 | le curseur de Windows est rétabli en premier (arrêt) ou par le gardien (mort du moteur)       | dès la fin du moteur        |
| Curseur retourné : moteur gelé                                                                  | le gardien rétablit le curseur, puis arrête le moteur                                         | 1,2 s puis 2,5 s            |
| Écran rétabli à la main pendant un effet (Paramètres de Windows)                                | l'effet s'arrête (`display_changed`)                                                          | moins de 0,25 s             |
| Moteur planté                                                                                   | Windows retire la fenêtre ; Studio relance le moteur (0,5 s, puis 2, 5 et 10 s)               | immédiat                    |
| Erreur GPU (Present refusé)                                                                     | le moteur sort proprement (`engine.error`) ; Studio le relance                                | immédiat                    |
| Fenêtre du jeu fermée ou réduite                                                                | effet terminé (`target_lost`) ou masqué                                                       | moins de 0,1 s              |
| Effet en erreur                                                                                 | cet effet seul s'arrête (`effect.failed`), les autres continuent                              | à l'image près              |
| Durée dépassée                                                                                  | fin automatique (60 s au plus, 30 s par défaut)                                               | —                           |

Aucune de ces protections ne dépend de l'interface de Studio. Le gardien (`ChaosEngine.exe --guardian`) est un
processus séparé. S'il disparaît, le moteur le relance chaque seconde.
