# Moteur Chaos : couche Entrées (souris inversée du retournement)

> **Statut au 22/11 au soir : expérimental, coupé par défaut.** Pendant mes essais, chaque bascule d'orientation a fait
> tomber Overwatch, qui tournait sur l'autre écran, à environ 17 images/s : elle reconfigure l'affichage de tout le PC.
> Cette méthode ne s'active que sur décision explicite (Studio › Chaos › Méthode « Windows (expérimental) »), jamais en
> direct. Analyse, comparaison et candidat sans bascule : [ETUDE_PERFORMANCES_RETOURNEMENT.md](ETUDE_PERFORMANCES_RETOURNEMENT.md).
>
> **23/11** : le calque GPU devient la technologie principale (essai d'Antoni dans Overwatch : fluide, sans
> ralentissement perceptible). Cette méthode reste coupée par défaut et le moteur ne l'applique **jamais** à une
> activation communautaire (Core, extension, points de chaîne) : la demande passe alors par le calque
> (`target.input_blocked`). Curseur : [ETUDE_CURSEUR.md](ETUDE_CURSEUR.md).

22/11/2026. Spécification d'Antoni pour le retournement à 180° :

- l'effet vise l'écran entier ;
- un seul curseur visible, le vrai curseur Windows ;
- la souris est inversée en X et en Y ;
- le clic tombe là où se trouve le curseur visible ;
- tout redevient normal immédiatement à la fin.

Code : [`src/Input/InputLayer.cs`](../../apps/chaos-engine/src/Input/InputLayer.cs). Intégration :
`EngineHost.StepInput` ([`Engine.cs`](../../apps/chaos-engine/src/Host/Engine.cs)).

## 1. Le choix, en bref

**Windows retourne lui-même l'affichage de l'écran visé**, comme le réglage Paramètres › Affichage › Orientation ›
« Paysage (retourné) », mais de façon temporaire et sans rien enregistrer.

Windows dessine alors le vrai curseur et place les clics dans le repère retourné :

- monter la souris fait descendre le curseur à l'écran, aller à gauche le fait aller à droite ;
- le clic tombe exactement sous la pointe du curseur ;
- un seul curseur, aucun faux curseur, aucun crochet souris, aucune entrée injectée ;
- rien n'entre dans les processus des jeux.

**Pourquoi pas « inverser la souris » sous l'image retournée du lot 1.** C'est impossible à rendre cohérent :

- Windows dessine toujours le vrai curseur à sa position réelle, par-dessus le calque ;
- le clic tombe donc au point symétrique de ce que l'on voit sous le curseur, quelle que soit la façon dont on inverse
  ses mouvements ;
- et l'inversion elle-même demanderait d'intercepter la souris et de réinjecter des mouvements, ce que les anti-triche
  repèrent et que les mandats précédents interdisaient.

L'orientation de l'écran est le seul niveau où « écran retourné + vrai curseur + souris inversée + clic juste » tient
ensemble.

## 2. Déroulé d'un retournement de l'écran entier

1. **Entrée animée** (550 ms par défaut) : le calque du moteur fait tourner la capture de l'écran, Windows est
   inchangé.
2. **Bascule** : à la fin de la rotation, Windows retourne l'écran (environ 130 ms sur la RTX 3070).
   - Si le retournement est seul sur cet écran, le calque se retire : ni fenêtre ni capture pendant l'effet. Le coût
     du moteur est alors nul ; Windows fait la rotation.
3. **Avant la fin** (400 ms avant la fin prévue, ou dès un arrêt demandé) : le calque revient. Il montre la même image
   que Windows, car le rendu compense la rotation déjà appliquée par Windows.
4. **Retour** : Windows rétablit l'écran (environ 80 à 110 ms), puis le calque anime le retour et disparaît.

Pendant les deux rotations animées, le vrai curseur reste à sa position réelle : il est hors de l'image retournée
pendant une demi-seconde. Il passe dans le repère retourné au moment de la bascule.

La fenêtre seule (cible « fenêtre », diagnostic seulement) garde l'ancien comportement : l'image seule, la souris
normale, et des clics qui ne tombent pas sous ce que l'on voit.

## 3. Restauration garantie

De la plus courante à la plus rare :

| Situation                                            | Ce qui rétablit l'écran                                                                   | Mesuré le 22/11                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| Fin normale, arrêt, STOP ALL                         | le moteur (`ChangeDisplaySettingsEx`, réglages enregistrés)                               | STOP ALL : écran rétabli en 81 ms |
| Ctrl+Maj+F11 (arrêt d'urgence)                       | le moteur ; s'il ne réagit pas en 700 ms, le gardien le tue (ligne suivante)              | 87 à 109 ms                       |
| Moteur gelé (même sans calque visible)               | le gardien le tue au bout de 2,5 s, puis Windows rétablit l'écran                         | environ 2,7 s                     |
| Moteur tué, planté, Studio fermé                     | **Windows lui-même** : le mode temporaire appartient au processus qui l'a demandé         | 86 à 88 ms après la mort          |
| Écran rétabli à la main pendant l'effet (Paramètres) | l'effet le voit en moins de 250 ms et s'arrête (`display_changed`)                        | contrôlé                          |
| Redémarrage, fermeture de session                    | rien n'a été enregistré dans Windows                                                      | —                                 |
| Secours manuel                                       | `ChaosEngine.exe --restore-display` : tous les écrans reviennent aux réglages enregistrés | —                                 |

En dernier recours, le réglage Windows fonctionne toujours : Paramètres › Affichage › Orientation › Paysage.

## 4. Compatibilité : ce qui marche, ce qui est refusé, ce qui reste à vérifier

**Vérifié ici** (22/11, RTX 3070, Windows 11 26200, écran secondaire 1920×1080 à 144 Hz) :

- bascule et retour sur l'écran secondaire. L'écran principal n'a jamais été retourné par les tests ;
- la capture de l'écran continue pendant la bascule et voit toujours l'image à l'endroit, ce qui rend le relais
  calque ↔ Windows sans saut ;
- restauration dans tous les cas du tableau § 3.

**Refusé (le moteur le dit au lieu d'essayer)** :

- **jeu en plein écran exclusif** : le retournement provoquerait un changement de mode, et le jeu perdrait son plein
  écran ou se réduirait. Il faut passer le jeu en fenêtré sans bordure ;
- un écran déjà retourné par un autre effet (`input_busy`) ;
- un écran que Windows refuse de retourner (`input_unavailable`, rare : pilote).

**Observé (22/11)** : chaque bascule perturbe **tous** les jeux, même sur un autre écran (Overwatch à environ
17 images/s pendant des bascules d'essai en rafale). C'est la limite qui rend la méthode expérimentale.

**Attendu mais pas vérifiable ici** (essais R2 à R6 de [PROCEDURE_TESTS.md](PROCEDURE_TESTS.md)) :

| Sujet                                     | Attendu                                                                                                                                                                                    | À regarder                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Clignotement à la bascule                 | dépend du pilote ; la bascule ne prend qu'environ 130 ms, donc probablement un court clignotement ou aucun                                                                                 | à l'œil, en jeu                 |
| Jeux à curseur (Dofus)                    | le jeu ne sait rien ; Windows retourne son image, son curseur et ses clics                                                                                                                 | curseur unique, clics justes    |
| FPS (Overwatch, entrée brute)             | la caméra reçoit les mouvements bruts : à l'écran retourné, viser devient inversé, comme voulu ; le viseur reste au centre                                                                 | jouabilité, viseur              |
| Jeux qui réagissent au changement d'écran | certains réinitialisent leur rendu à la bascule : une saccade, ou la fenêtre recentrée                                                                                                     | jeu par jeu                     |
| Fluidité et latence                       | Windows compose l'image retournée lui-même : le jeu peut perdre l'affichage direct (« independent flip ») et G-Sync/VRR pendant l'effet, soit environ une image de latence en plus au pire | PresentMon, § 3 de la procédure |
| Anti-triche                               | aucun mécanisme visé (ni crochet, ni injection, ni accès aux processus) : c'est le réglage d'orientation de Windows. Non vérifié jeu par jeu                                               | —                               |
| OBS, capture d'écran                      | selon la méthode de capture, OBS suit l'orientation (la scène montre l'écran retourné) ou non                                                                                              | aperçu OBS, R5                  |
| OBS, animations                           | le calque est exclu des captures (sinon il se capturerait lui-même) : les spectateurs verraient la bascule **sans** les rotations animées                                                  | aperçu OBS, R5                  |
| OBS, capture de jeu ou de fenêtre         | montre l'image propre du jeu, jamais retournée (comme avant)                                                                                                                               | aperçu OBS                      |
| Plusieurs écrans                          | le curseur passe d'un écran à l'autre par le bord réel. Sur l'écran retourné, ce bord apparaît du côté opposé (l'écran de gauche retourné se quitte par sa gauche visible)                 | normal, à connaître             |
| Tactile, stylet                           | suivent l'orientation (Windows)                                                                                                                                                            | —                               |
| Écran de verrouillage, UAC, veille        | non essayés pendant un effet ; au pire, le redémarrage rétablit tout                                                                                                                       | —                               |

## 5. Ajouter une transformation d'entrée

Le registre déclare les transformations connues (`input_effects`), et un effet s'y relie par `"input": "<id>"`. Le
moteur refuse de démarrer si un effet cite une transformation inconnue.

Une nouvelle primitive se code dans `InputLayer` avec les mêmes obligations :

- s'appliquer et se rétablir sur commande ;
- disparaître d'elle-même avec le processus, ou à défaut être rétablie par le gardien ;
- n'enregistrer rien de durable ;
- être détectée si quelqu'un d'autre la défait ;
- figurer dans ce document avec ses limites.

Une transformation qui exigerait d'intercepter ou d'injecter des entrées ne remplit pas ces conditions et sort du cadre
fixé par Antoni.
