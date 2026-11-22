# Roadmap Chaos V2

10/11/2026. Lots verticaux, chacun testable dans le Lab puis en vrai par Antoni. Aucun lot ne démarre sans son GO.
Architecture : [ARCHITECTURE_CHAOS_V2.md](ARCHITECTURE_CHAOS_V2.md). Effets : [CATALOGUE](CATALOGUE_EFFETS_CHAOS_V2.md).

## Lot 0 — Mesurer avant de construire (aucun code ; 45 min d'Antoni)

**Pourquoi d'abord** : trois causes de chutes sont en concurrence (RECHERCHE § 3). Elles ne demandent pas les mêmes
corrections.

1. **Tout de suite, sans code** : Studio › Halloween › **« Overlay actif » sur off**.
   - Les deux fenêtres plein écran qui restent au-dessus du jeu depuis Halloween se ferment (AUDIT D1).
   - Rien d'autre ne les utilise : la boutique est fermée.
2. Choisir la fréquence de l'écran principal : il est à **59 Hz**, alors qu'il accepte 165 Hz. C'est un réglage
   Windows qui appartient à Antoni ; je ne le change pas.
3. Protocole E0 → E3 et E5 (V1 flip) de RECHERCHE § 6 sur **un** jeu (Overwatch), avec PresentMon.
   - J'installe seulement PresentMon depuis la version officielle, dans un dossier de travail, avec son GO.
   - J'analyse les CSV.

**Critère de sortie** : on sait si les fenêtres permanentes faisaient passer le jeu en « Composed: Flip » (E2/E3), et
quelle cadence réelle avait la copie V1 (E5).

## Lot 1 — Le lecteur natif, flip seulement, sans achat (le pari technique)

**But** : prouver sur le vrai PC le point le plus risqué. Un retournement à 180°, un seul vrai curseur, aucun carré,
une fluidité intacte.

> **Mise à jour du 22/11, mandat « architecture »** : le prototype est devenu le **moteur**
> ([`apps/chaos-engine`](../../apps/chaos-engine/README.md), branche locale `feat/chaos-engine`,
> [ARCHITECTURE_MOTEUR.md](ARCHITECTURE_MOTEUR.md)).
>
> - Il est intégré à Studio (page Chaos) et dispose d'un banc Chaos Lab.
> - Le retour d'Antoni sur le lot 1 est traité : l'ancien écran n'apparaît plus pendant la rotation, et le panneau
>   Windows a été remplacé par la page Studio.
> - Le lot 2 (module payant) n'est pas commencé.
> - **Correctif de conception du 22/11** : le retournement vise l'écran entier. Windows retourne l'affichage (vrai
>   curseur unique, souris inversée, clic sous le curseur) ; la couche Entrées est séparée du moteur visuel
>   ([COUCHE_ENTREES.md](COUCHE_ENTREES.md), compatibilité et restauration). La fenêtre seule devient un diagnostic.
>   Reste ouvert : les spectateurs (capture d'écran d'OBS) verraient la bascule sans les rotations animées, à
>   vérifier (R5). Sur un écran à 144 Hz, les rotations tournent à environ 60 images/s (calées sur l'écran principal) :
>   à revoir seulement si Antoni les trouve saccadées.
> - Le texte ci-dessous décrit le prototype du lot 1 (`apps/chaos-presenter`, branche `feat/chaos-presenter-lot1`).
>
> **État au 22/11/2026 : prototype livré, test réel d'Antoni attendu.**
>
> - **Livré** : lecteur autonome (mode D, et mode C en secours) et panneau de test avec les raccourcis
>   `Ctrl+Maj+F10` / `F11`, à la place du bouton Studio prévu plus bas.
> - **26 contrôles automatiques verts sur le PC** : aucun flash, clic traversant, focus intact, arrêt mesuré à l'écran en
>   10 à 35 ms, tous les chemins d'arrêt.
> - **Mesuré en 2560×1440** : 0,15 à 0,21 ms de GPU par image, 0,3 à 0,4 ms de traitement (médiane), 0,2 à 0,4 % de
>   CPU.
> - **Écarts au plan** :
>   - le lecteur est en **C# (.NET Framework 4.8, compilateur fourni par Windows)**, pas en Rust : l'installation de
>     Rust a été refusée par le garde-fou de l'agent ;
>   - il n'est pas encore branché à Studio ;
>   - seul le 180° existe (pas de miroir ni de vertical) ;
>   - la bascule animée dure 0,55 s pour respecter le plafond de 520°/s.
> - **Reste à prouver**, uniquement par Antoni : R1 à R5 (curseur unique en jeu, Dofus, Overwatch, jeu d'horreur, OBS)
>   et les critères de fluidité ci-dessous avec PresentMon.

- **Outillage** : Rust + `windows-rs`, build dans la CI Windows, exécutable embarqué par `studio:release`.
- **Lecteur** :
  - capture WGC d'une fenêtre (mode D) ou d'un écran (mode C), sans curseur ni bordure ;
  - shaders rotation / miroir / vertical ;
  - fenêtre traversable ;
  - battement ; arrêt sur stdin fermé ; durée maximale ;
  - statistiques ; bascule animée de 350 ms en option.
- **Studio** :
  - Electron main lance et arrête le lecteur et lui transmet STOP ALL `Ctrl+Maj+F12` ;
  - Chaos › « Tester » seulement : pas de Core, pas de Jetons.
- **Tests automatiques** :
  - protocole JSON du lecteur ;
  - arrêt sur battement manquant, sur stdin fermé, sur durée dépassée ;
  - Studio tué → aucune fenêtre ne reste, test de V1 repris.
- **Tests réels (Antoni)**, chacun avec le protocole de mesure E4 / E5 / E7 :

| #   | Jeu                          | Ce qu'on vérifie                                                                                            |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| R1  | Bureau                       | un seul curseur ; clics justes ; pas de flash à l'entrée ni à la sortie                                     |
| R2  | Dofus (Unity)                | **curseur du jeu** : système (bon) ou logiciel (retourné) → décide si Dofus est compatible (E5)             |
| R3  | Overwatch                    | sans bordure / plein écran (E8 : capture de fenêtre possible ?) ; FPS du jeu et images de la copie ; viseur |
| R4  | Un jeu d'horreur indépendant | idem R3                                                                                                     |
| R5  | OBS                          | en mode D, la capture « Écran » montre l'effet aux viewers                                                  |

**Critères d'acceptation** :

- copie ≥ 95 % de la fréquence de l'écran ;
- FPS du jeu ≥ 90 % du palier E1 ;
- latence ajoutée ≤ 2 images ;
- **aucun double curseur** sur R1 et R3 ;
- arrêt < 100 ms ;
- rien ne reste après avoir tué Studio.

**Si R3 échoue** (Overwatch refuse la capture de fenêtre) : mode C pour ce jeu. **Si les critères de fluidité
échouent** : on s'arrête, et Chaos V2 passe en architecture A (stream seulement) pour les effets de capture.

## Lot 2 — Le module `chaos` payant, de bout en bout dans le Lab

- **Core** :
  - module `chaos` du socle (Jetons, journal, file de 3, expiration 3 min remboursée, cooldowns par effet et par
    famille, variantes à prix fixe) ;
  - évolution du contrat du socle : `report(started)` et la règle de remboursement (ARCHITECTURE § 10.2) ;
  - libellés `queue_full` / `hors_live` / `lecteur_absent` ;
  - battement de Studio (lecteur prêt, mode, mode sûr).
- **Studio** :
  - runtime Chaos : réclame l'action suivante seulement quand elle peut jouer, rapporte `started` à la première image ;
  - page Coulisses : bandeau, en cours / file, tests, catalogue, sécurité ;
  - aucune fenêtre au repos.
- **Effets** : flip (lot 1), puis les premiers effets sur capture et en calque — Flou Kawase, Brouillard V2, Signal
  corrompu V2, Vision tunnel, Clignement.
- **Extension** : module Chaos (ARCHITECTURE § 10.5), testé à 318 / 400 / 565 px.
- **Tests** :
  - concurrence, idempotence et permissions sur **PostgreSQL réel** (règle du projet pour les Jetons) ;
  - double achat, achat pendant une coupure, Studio redémarré pendant un effet, Core injoignable ;
  - STOP ALL avec file ;
  - expiration remboursée une seule fois.
- **Critère** : parcours Lab complet ; extension → Jetons débités → effet → fin ou remboursement, sans aucun double
  débit.

## Lot 3 — Catalogue enrichi

Puzzle, penché, aberration, chaleur, VHS/CRT, pixellisation, couleurs inversées (fondu), pluie, sang, neige,
confettis, presets « Cauchemar » et « Panne TV ». Chaque effet arrive avec une capture de référence, une mesure
GPU (`stats` du lecteur) et un passage du contrôle de sécurité : luminance et fréquence, sur un enregistrement de
10 s analysé image par image.

## Lot 4 — Production

- Release Studio et déploiement Core : chacun avec le GO d'Antoni, selon OPERATIONS.
- Extension : nouvelle version publiée. Le module est visible pour les testeurs d'abord : le socle a déjà l'accès
  progressif.
- Une soirée de test sur un vrai live, effets en mode sûr, puis ouverture progressive.

## Lot 5 — Interactions avancées

Repère placé par un viewer : composant video overlay, variante mobile, modération. Messages à l'écran : texte
modéré. Seulement si les lots 1 à 4 sont validés.

## Dépendances et risques

| Risque                                    | Lot | Parade                                                                                              |
| ----------------------------------------- | --- | --------------------------------------------------------------------------------------------------- |
| Pas de compilateur sur le PC              | 1   | build en CI ; Rust en local seulement si Antoni l'accepte (installation développeur, réversible)    |
| Un jeu refuse la capture de fenêtre       | 1   | mode C (écran + exclusion)                                                                          |
| Curseur logiciel dans un jeu (Dofus ?)    | 1   | ce jeu est marqué « flip incompatible » dans Studio : l'effet est refusé avant débit                |
| Plein écran exclusif                      | 1   | mode A automatique (stream seulement), annoncé ; conseiller le mode sans bordure                    |
| Évolution du contrat du socle             | 2   | changement additif, tests du socle repris                                                           |
| OBS administrateur prioritaire sur le GPU | 0   | mesurer avec et sans administrateur ; décision d'Antoni (OBS en admin sert aussi à d'autres choses) |
| Mal des transports, flashs                | 3   | plafonds du CATALOGUE § 4, mode sûr par défaut au premier live                                      |
