# Moteur Chaos : procédure de test

## 1. Tests automatiques (aucun plein écran, aucune entrée simulée)

| Commande                                                                                     | Quoi                                                                                                                                                                                                                                                                                                                                                                                                                        | Durée      | Résultat au 22/11                                                                                     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `apps\chaos-engine\build.cmd`                                                                | compile le moteur, les tests unitaires et les contrôles (le C# de Windows)                                                                                                                                                                                                                                                                                                                                                  | 10 s       | ok                                                                                                    |
| `apps\chaos-engine\bin\chaos-unit.exe`                                                       | logique pure : registre (dont transformations d'entrée), paramètres, transitions (dont sortie retenue), configuration (migrations v1 à v5, fichier illisible), performances (profils, bornes), curseur retourné (déclaration, réglage), écrans (ordre réel, choix, écran débranché), réglages par effet, ordonnanceur (file, priorités, remplacement, prolongement, capacité, expiration, STOP ALL, idempotence), protocole | 1 s        | **27/27** (23/11)                                                                                     |
| `apps\chaos-engine\bin\chaos-checks.exe [--quick] [--no-screen] [--screen-only]`             | vrai moteur, vrai GPU, mire de 400×240 sur l'écran secondaire, pixels lus à l'écran ; puis l'écran secondaire **retourné par Windows** quelques secondes (détail ci-dessous)                                                                                                                                                                                                                                                | 75 à 95 s  | 51/51 le 22/11 avant l'incident ; depuis, 17/17 sans écran, séries visibles **non relancées** (garde) |
| `npx vitest run test/chaos-runtime.test.ts` (dans `apps/studio/server`)                      | pilote Studio : corrélation, battements, relance, arrêt ; API `/api/chaos` (protection, validation, cible écran) ; registre conforme au schéma zod ; vrai moteur sous Windows (configuration v3, écrans)                                                                                                                                                                                                                    | 3 s        | **10/10**                                                                                             |
| `npm run chaos:lab -- --no-open`, puis `npx tsx apps/studio/server/scripts/chaos-lab-e2e.ts` | page Studio › Chaos dans un Chromium sans fenêtre ([GUIDE_STUDIO_CHAOS.md](GUIDE_STUDIO_CHAOS.md)) : sans affichage, catalogue, fiche du retournement, écrans gauche → droite, chaque réglage enregistré et relu après rechargement, ni sélecteur global ni compte à rebours ; **visible** (garde) : Tester, Arrêter, Activer, STOP ALL                                                                                     | 30 s       | sans affichage **12/12** (23/11) ; partie visible non lancée (jeu en cours)                           |
| `ChaosEngine.exe --bench-gpu [--w --h --frames]`                                             | coût GPU par passe, hors écran                                                                                                                                                                                                                                                                                                                                                                                              | 5 s        | 0,02 à 0,08 ms par passe en 1440p                                                                     |
| `bin\chaos-bench.exe` (voir [PERFORMANCES_MOTEUR.md](PERFORMANCES_MOTEUR.md) § 6 et § 9)     | banc de performances : scénarios A à F, jeu témoin à charge GPU réglable, temps GPU du moteur, du témoin et de `dwm` ; deux versions du moteur comparées ; vrai jeu avec PresentMon (`--game`). **Visible : jamais automatique**                                                                                                                                                                                            | 1 à 2 min  | jamais lancé                                                                                          |
| `bin\chaos-bench.exe --cursor-selftest`                                                      | curseur retourné, hors écran : formes du vrai curseur lues (flèche, main, barre de texte), pointe sur le point transformé de la vraie position à 0, 37, 90, 143 et 180°                                                                                                                                                                                                                                                     | 2 s        | **8/8** (23/11)                                                                                       |
| `bin\chaos-bench.exe --cursor-check [--maintenant]`                                          | curseur retourné dans le moteur : mire placée sous le curseur (souris jamais déplacée), curseur matériel masqué, curseur retourné au point miroir, capture WGC (OBS), fin d'effet, arrêt d'urgence, moteur tué, moteur gelé, réglage coupé, latence. **Visible, masque le curseur** : garde de jeu et 2 min d'inactivité                                                                                                    | 40 s       | voir [PERFORMANCES_MOTEUR.md](PERFORMANCES_MOTEUR.md) § 7                                             |
| `bin\chaos-bench.exe --obs-compat`                                                           | ce que voient les méthodes de capture d'OBS (BitBlt, WGC écran et fenêtre, DXGI, fenêtre du calque), modes fenêtre et écran entier, en pleine rotation. **Visible**                                                                                                                                                                                                                                                         | 20 s       | voir [PERFORMANCES_MOTEUR.md](PERFORMANCES_MOTEUR.md) § 7                                             |
| `bin\chaos-bench.exe --cursor-demo`                                                          | démo à la main : 12 cases cliquables retournées, curseur retourné (prototype validé par Antoni le 23/11)                                                                                                                                                                                                                                                                                                                    | 30 s       | validé par Antoni (23/11)                                                                             |
| `ChaosEngine.exe --game-check`                                                               | garde : code 1 et la raison si un jeu ou une application plein écran est actif                                                                                                                                                                                                                                                                                                                                              | instantané | —                                                                                                     |
| `ChaosEngine.exe --render-preview <dossier>`                                                 | planche des transitions et des coins (contrôle visuel)                                                                                                                                                                                                                                                                                                                                                                      | 2 s        | —                                                                                                     |

`chaos-checks` vérifie :

- **protocole** : erreurs, configuration persistée ;
- **coupures** : stdin fermé, client muet, parent mort ;
- **retournement** : sans flash, clic traversant, aucun vol de focus ;
- **ordonnancement** : idempotence, file d'attente ;
- **capture partagée** : deux effets sur UNE capture ;
- **isolement** : un effet en panne s'arrête seul ;
- **cible** : redimensionnée et déplacée, puis fermée ;
- **arrêts** : STOP ALL en moins de 150 ms, arrêt pendant la rotation, arrêt d'urgence, moteur gelé (le gardien le
  tue), moteur tué ;
- **sobriété** : calque sans capture, mesures, repos sans fuite ;
- **écran entier** (écran secondaire seulement, jamais l'écran principal) : rotation animée puis bascule par Windows,
  ni calque ni capture pendant l'effet, retour animé ; STOP ALL, arrêt d'urgence, écran rétabli à la main, moteur gelé,
  moteur tué : l'écran revient chaque fois à l'endroit. L'orientation est relue par Windows (une capture GDI montre
  toujours l'écran à l'endroit). Un écran resté retourné serait rétabli par le contrôle lui-même.

Toujours lancer `chaos-checks` **hors partie et hors direct** : il affiche une petite mire sur l'écran secondaire
pendant environ une minute, sans jamais prendre le focus, puis retourne cet écran six fois quelques secondes
(`--no-screen` pour l'éviter).

## 2. Ce qui reste à confirmer à la main (Antoni)

Ces points ne peuvent pas être prouvés automatiquement ici :

- un vrai jeu ;
- la latence ressentie ;
- le curseur d'un jeu (fenêtre outil exclue de la liste) ;
- le raccourci Ctrl+Maj+F11 pressé physiquement ;
- OBS.

**Garde (depuis l'incident du 22/11)** : les contrôles, le parcours de la page et le banc ne lancent aucun essai
visible si un jeu ou une application plein écran est actif. Seul Antoni lève la garde (`--autorise-pendant-un-jeu`).

Par défaut, le retournement est le **calque** sur la fenêtre du jeu. R1 à R4 se font d'abord avec lui. La méthode
« Windows (expérimental) » (écran entier, souris inversée, [COUCHE_ENTREES.md](COUCHE_ENTREES.md)) ne s'essaie que hors
direct, sans autre jeu ouvert, après lecture de [ETUDE_PERFORMANCES_RETOURNEMENT.md](ETUDE_PERFORMANCES_RETOURNEMENT.md).

| #   | Test                                                                                                                       | Regarder                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Bureau : Chaos Lab › Tester, cible « Écran à gauche » (l'écran secondaire)                                                 | rotation animée sans l'ancien écran dans les coins ; **clignotement à la bascule ?** ; un seul curseur ; monter la souris le fait descendre ; un clic sur un lien tombe sous la pointe |
| R2  | Dofus (fenêtré sans bordure) : « Écran du jeu au premier plan, dans 3 s », puis passer dans le jeu                         | curseur de Dofus unique et juste ; clics sur les cases ; fluidité ; saccade du jeu à la bascule ?                                                                                      |
| R3  | Overwatch (fenêtré sans bordure), même méthode                                                                             | menus, viseur au centre, visée inversée (voulu) ; FPS du jeu avant et pendant ; le jeu se réinitialise-t-il à la bascule ?                                                             |
| R4  | Un jeu d'horreur indépendant                                                                                               | idem R3                                                                                                                                                                                |
| R5  | OBS ouvert, aperçu de la scène qui capture l'écran                                                                         | l'aperçu montre-t-il l'écran retourné ? (attendu : la bascule sans les rotations animées, que le calque exclut des captures)                                                           |
| R6  | Arrêts : Ctrl+Maj+F11 en jeu ; STOP ALL ; fermer le Chaos Lab ; terminer `ChaosEngine.exe` dans le Gestionnaire des tâches | l'écran revient à l'endroit à chaque fois                                                                                                                                              |
| R7  | Deux écrans : pendant un retournement, passer le curseur d'un écran à l'autre                                              | il passe par le bord réel, qui apparaît du côté opposé sur l'écran retourné (normal, à connaître)                                                                                      |

Avec le calque (défaut depuis le 23/11), le curseur est **retourné avec l'image** : un seul curseur visible, l'image
du vrai curseur au point miroir, qui se déplace à l'envers ; le clic tombe dessous. À vérifier en jeu :

| #                                              | Test                                                                                    | Regarder                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| C1                                             | Chaos Lab › Tester sur une fenêtre ordinaire, souris au-dessus puis à côté              | un seul curseur à tout moment ; retourné au-dessus, normal à côté ; clic sous le curseur visible |
| C2                                             | Dofus (fenêtré sans bordure) : clics sur les cases et les menus pendant le retournement | formes du curseur (main, flèche) suivies ; retard perceptible ?                                  |
| C3                                             | Overwatch : menus pendant le retournement, puis en partie                               | menus cliquables ; en partie (visée), aucun curseur dessiné                                      |
| C4                                             | OBS ouvert (aperçu, sans diffuser) pendant C1                                           | l'aperçu montre l'image retournée et **un seul** curseur, retourné                               |
| C5                                             | Ctrl+Maj+F11 pendant le retournement, curseur au-dessus de la cible                     | curseur de Windows de retour immédiatement                                                       |
| R5 à R7 concernent surtout la méthode Windows. |

Note sur l'**ancien panneau du lot 1** : s'il est ouvert, il tient Ctrl+Maj+F11, et le moteur le signale comme
« raccourci indisponible ». Le fermer avant ces tests.

## 3. Mesures en jeu (facultatif, avec GO d'Antoni pour PresentMon)

Procédure courte, Overwatch et OBS : [PERFORMANCES_MOTEUR.md](PERFORMANCES_MOTEUR.md) § 9 (`chaos-bench.exe --game`).

Protocole complet : [RECHERCHE_CHAOS_V2.md](RECHERCHE_CHAOS_V2.md) § 6, paliers E1 (jeu et OBS sans effet), E5
(retournement en cours) et E7 (retour à la normale). Il mesure la seule latence qui compte (`MsAllInputToPhotonLatency`)
et le mode de présentation du jeu pendant l'effet (perte possible de l'« independent flip » et de G-Sync). Les mesures
du moteur (Studio › Chaos › Moteur) sont internes et ne les remplacent pas.
