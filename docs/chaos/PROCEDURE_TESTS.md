# Moteur Chaos : procédure de test

## 1. Tests automatiques (aucun plein écran, aucune entrée simulée)

| Commande                                                                                     | Quoi                                                                                                                                                                                                                                                                               | Durée     | Résultat au 22/11                 |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------- |
| `apps\chaos-engine\build.cmd`                                                                | compile le moteur, les tests unitaires et les contrôles (le C# de Windows)                                                                                                                                                                                                         | 10 s      | ok                                |
| `apps\chaos-engine\bin\chaos-unit.exe`                                                       | logique pure : registre (dont transformations d'entrée), paramètres, transitions (dont sortie retenue), configuration (migrations v1 et v2, fichier illisible), ordonnanceur (file, priorités, remplacement, prolongement, capacité, expiration, STOP ALL, idempotence), protocole | 1 s       | **22/22**                         |
| `apps\chaos-engine\bin\chaos-checks.exe [--quick] [--no-screen] [--screen-only]`             | vrai moteur, vrai GPU, mire de 400×240 sur l'écran secondaire, pixels lus à l'écran ; puis l'écran secondaire **retourné par Windows** quelques secondes (détail ci-dessous)                                                                                                       | 75 à 95 s | **51/51** (50 en `--quick`)       |
| `npx vitest run test/chaos-runtime.test.ts` (dans `apps/studio/server`)                      | pilote Studio : corrélation, battements, relance, arrêt ; API `/api/chaos` (protection, validation, cible écran) ; registre conforme au schéma zod ; vrai moteur sous Windows (configuration v3, écrans)                                                                           | 3 s       | **10/10**                         |
| `npm run chaos:lab -- --no-open`, puis `npx tsx apps/studio/server/scripts/chaos-lab-e2e.ts` | page Studio › Chaos dans un Chromium sans fenêtre : « Tester » sur l'écran secondaire (Windows le retourne, orientation relue), STOP ALL ; en diagnostic, la mire en fenêtre seule (pixels) ; réglages enregistrés                                                                 | 30 s      | **11/11**                         |
| `ChaosEngine.exe --bench-gpu [--w --h --frames]`                                             | coût GPU par passe, hors écran                                                                                                                                                                                                                                                     | 5 s       | 0,02 à 0,08 ms par passe en 1440p |
| `ChaosEngine.exe --render-preview <dossier>`                                                 | planche des transitions et des coins (contrôle visuel)                                                                                                                                                                                                                             | 2 s       | —                                 |

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

Le retournement vise **l'écran entier** : Windows retourne l'affichage, le vrai curseur reste le seul, la souris est
inversée et le clic tombe sous le curseur ([COUCHE_ENTREES.md](COUCHE_ENTREES.md)).

| #   | Test                                                                                                                       | Regarder                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Bureau : Chaos Lab › Tester, cible « Écran à gauche » (l'écran secondaire)                                                 | rotation animée sans l'ancien écran dans les coins ; **clignotement à la bascule ?** ; un seul curseur ; monter la souris le fait descendre ; un clic sur un lien tombe sous la pointe |
| R2  | Dofus (fenêtré sans bordure) : « Écran du jeu au premier plan, dans 3 s », puis passer dans le jeu                         | curseur de Dofus unique et juste ; clics sur les cases ; fluidité ; saccade du jeu à la bascule ?                                                                                      |
| R3  | Overwatch (fenêtré sans bordure), même méthode                                                                             | menus, viseur au centre, visée inversée (voulu) ; FPS du jeu avant et pendant ; le jeu se réinitialise-t-il à la bascule ?                                                             |
| R4  | Un jeu d'horreur indépendant                                                                                               | idem R3                                                                                                                                                                                |
| R5  | OBS ouvert, aperçu de la scène qui capture l'écran                                                                         | l'aperçu montre-t-il l'écran retourné ? (attendu : la bascule sans les rotations animées, que le calque exclut des captures)                                                           |
| R6  | Arrêts : Ctrl+Maj+F11 en jeu ; STOP ALL ; fermer le Chaos Lab ; terminer `ChaosEngine.exe` dans le Gestionnaire des tâches | l'écran revient à l'endroit à chaque fois                                                                                                                                              |
| R7  | Deux écrans : pendant un retournement, passer le curseur d'un écran à l'autre                                              | il passe par le bord réel, qui apparaît du côté opposé sur l'écran retourné (normal, à connaître)                                                                                      |

La cible « fenêtre seule » n'apparaît qu'en mode Diagnostic : image seule, souris normale, clics non alignés.

Note sur l'**ancien panneau du lot 1** : s'il est ouvert, il tient Ctrl+Maj+F11, et le moteur le signale comme
« raccourci indisponible ». Le fermer avant ces tests.

## 3. Mesures en jeu (facultatif, avec GO d'Antoni pour PresentMon)

Protocole complet : [RECHERCHE_CHAOS_V2.md](RECHERCHE_CHAOS_V2.md) § 6, paliers E1 (jeu et OBS sans effet), E5
(retournement en cours) et E7 (retour à la normale). Il mesure la seule latence qui compte (`MsAllInputToPhotonLatency`)
et le mode de présentation du jeu pendant l'effet (perte possible de l'« independent flip » et de G-Sync). Les mesures
du moteur (Studio › Chaos › Moteur) sont internes et ne les remplacent pas.
