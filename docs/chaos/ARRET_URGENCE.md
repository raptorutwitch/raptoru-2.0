# Arrêt d'urgence d'un effet Chaos

**Le retour à l'écran normal est garanti par l'architecture.** La fenêtre d'un effet appartient au processus moteur.
Quand le moteur s'arrête pour une raison quelconque, Windows détruit la fenêtre et l'écran redevient normal : il n'y a
rien à restaurer. La fenêtre ne prend jamais ni clic ni clavier : elle ne peut pas bloquer le jeu.

## Ce que fait Antoni

| Situation                                           | Geste                                                                                                     | Délai mesuré                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Un effet doit s'arrêter, n'importe où (même en jeu) | **Ctrl+Maj+F11** : le gardien demande l'arrêt de tout ; si le moteur n'obéit pas en 700 ms, il le termine | 26 à 27 ms (même chemin que le raccourci ; la touche réelle reste à essayer, R6) |
| Depuis Studio                                       | **STOP ALL** (en haut de la page Chaos)                                                                   | 6 à 10 ms à l'écran                                                              |
| Un seul effet                                       | « Arrêter » sur sa ligne, dans « En cours »                                                               | fin par la rotation de sortie (environ 0,25 à 0,55 s)                            |
| Plus rien ne répond                                 | fermer Studio (ou le Chaos Lab) : le moteur suit son parent                                               | environ 20 ms                                                                    |
| En dernier recours                                  | Gestionnaire des tâches › terminer `ChaosEngine.exe`                                                      | immédiat (7 à 16 ms mesurés)                                                     |

## Ce que fait le système, sans personne

| Panne                                                               | Réaction                                                                        | Délai                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------- |
| Studio planté ou fermé                                              | le moteur surveille son parent, puis sort                                       | environ 20 ms         |
| Studio figé (plus de battement)                                     | le moteur sort                                                                  | 3 s (réglable)        |
| Moteur figé (boucle de rendu bloquée) alors qu'un effet est visible | le gardien le termine ; le moteur se surveille aussi lui-même (2 s)             | environ 2,5 s mesurés |
| Moteur planté                                                       | Windows retire la fenêtre ; Studio relance le moteur (0,5 s, puis 2, 5 et 10 s) | immédiat              |
| Erreur GPU (Present refusé)                                         | le moteur sort proprement (`engine.error`) ; Studio le relance                  | immédiat              |
| Fenêtre du jeu fermée ou réduite                                    | effet terminé (`target_lost`) ou masqué                                         | moins de 0,1 s        |
| Effet en erreur                                                     | cet effet seul s'arrête (`effect.failed`), les autres continuent                | à l'image près        |
| Durée dépassée                                                      | fin automatique (60 s au plus, 30 s par défaut)                                 | —                     |

Aucune de ces protections ne dépend de l'interface de Studio. Le gardien (`ChaosEngine.exe --guardian`) est un
processus séparé. S'il disparaît, le moteur le relance chaque seconde.
