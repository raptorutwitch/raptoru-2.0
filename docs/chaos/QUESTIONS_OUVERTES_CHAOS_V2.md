# Questions ouvertes Chaos V2

10/11/2026. Ce qui reste incertain, ce qui dépend d'un test réel, et les arbitrages qui reviennent à Antoni.

## 1. Arbitrages métier (Antoni)

| #   | Question                                                                                                                                                  | Ma recommandation                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Q1  | Monnaie : Jetons (mandat) — confirmer qu'aucun Bonbon n'est repris                                                                                        | Jetons seulement                                                                   |
| Q2  | Prix de chaque effet et de chaque variante (le skip musique coûte 25 000 Jetons : quelle échelle pour Chaos ?)                                            | 3 paliers (léger / fort / spectaculaire), chiffrés par Antoni                      |
| Q3  | STOP ALL d'Antoni sur un effet payé : rembourser ?                                                                                                        | rembourser automatiquement si arrêté avant 25 % de la durée, sinon non ; à décider |
| Q4  | Panne après démarrage : seuil de remboursement automatique (25 % proposé)                                                                                 | 25 %                                                                               |
| Q5  | Taille de la file (3) et expiration (3 min)                                                                                                               | garder 3 / 3 min au premier live                                                   |
| Q6  | Mode sûr activé par défaut au premier live ?                                                                                                              | oui                                                                                |
| Q7  | Effets « agressifs » (puzzle, couleurs inversées, datamosh, éblouissement) : à vendre ?                                                                   | oui, chers, avec un cooldown long, refusés en mode sûr                             |
| Q8  | Un effet incompatible avec le jeu du moment (Dofus si son curseur est logiciel, jeu en plein écran exclusif) : le cacher ou le montrer « indisponible » ? | le montrer indisponible avec la raison                                             |
| Q9  | OBS en administrateur : le garder ? Cela lui donne la priorité GPU sur le jeu                                                                             | décider **après** la mesure du lot 0                                               |
| Q10 | Écran principal à 59 Hz au lieu de 165 Hz : volontaire ?                                                                                                  | à vérifier ; ne rien mesurer avant de l'avoir fixé                                 |

## 2. Inconnues techniques (test réel nécessaire)

| #   | Inconnue                                                                                                                                                          | Test                                       | Lot   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----- |
| T1  | Les fenêtres V1 permanentes font-elles passer le jeu en « Composed: Flip » ?                                                                                      | E2 / E3                                    | 0     |
| T2  | Cadence réelle de la copie V1 pendant un flip (≈ 10 images/s ?)                                                                                                   | E5                                         | 0     |
| T3  | WGC capture-t-il la fenêtre d'Overwatch, de Dofus et d'un jeu d'horreur (noir, refus, anti-triche) ?                                                              | E8 / R3                                    | 1     |
| T4  | Curseur de Dofus : système ou logiciel ?                                                                                                                          | R2                                         | 1     |
| T5  | `IsCursorCaptureEnabled(false)` enlève-t-il aussi un curseur agrandi d'accessibilité ou en HDR ?                                                                  | régler un grand curseur, capture prototype | 1     |
| T6  | `IsBorderRequired(false)` sans invite pour un exécutable non empaqueté sur la build 26200 (le prototype Python n'a montré aucune bordure)                         | lot 1, premier lancement                   | 1     |
| T7  | Latence réellement ajoutée par le lecteur (1 ou 2 images)                                                                                                         | PresentMon `MsAllInputToPhotonLatency`     | 1     |
| T8  | G-Sync / VRR conservé pendant un effet ?                                                                                                                          | indicateur G-Sync du pilote + PresentMon   | 1     |
| T9  | Overwatch en « Plein écran » : exclusif ou optimisé par Windows ?                                                                                                 | `PresentMode` E0                           | 0     |
| T10 | Coût GPU réel de chaque shader en 1440p                                                                                                                           | statistiques du lecteur                    | 2 / 3 |
| T11 | Chromium en administrateur : capture refusée (`0x80070005` vu dans un prototype) ; le lecteur natif WGC, lui, a capturé depuis le même terminal en administrateur | sans objet si le lecteur natif est retenu  | —     |

## 3. Expériences prioritaires (ordre)

1. **Lot 0** : couper les fenêtres permanentes, puis E0 → E3 et E5 sur Overwatch (45 min avec Antoni).
2. **Lot 1, R1** : le premier binaire du lecteur sur le bureau. Il tranche **le curseur et le flash**.
3. **Lot 1, R2 + R3** : Dofus et Overwatch. Ils tranchent **la compatibilité et la fluidité**.

## 4. Ce qui est déjà tranché (pour ne pas y revenir)

- Pas de curseur faux ni de masquage du curseur. Pas d'état système (loupe, curseurs, rotation Windows).
- Pas d'injection, aucune modification des entrées : cela exclut aussi `MagSetInputTransform`.
- Pas de projecteur OBS comme rendu local : il prend les clics et le focus.
- Pas de capture par Chromium (`getDisplayMedia`) pour l'écran du joueur.
- Les screamers restent dans la fenêtre médias Electron, ouverte seulement pendant la lecture.
