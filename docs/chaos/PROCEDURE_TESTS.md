# Moteur Chaos : procédure de test

## 1. Tests automatiques (aucun plein écran, aucune entrée simulée)

| Commande                                                                                     | Quoi                                                                                                                                                                                                               | Durée     | Résultat au 22/11                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------------------------------- |
| `apps\chaos-engine\build.cmd`                                                                | compile le moteur, les tests unitaires et les contrôles (le C# de Windows)                                                                                                                                         | 10 s      | ok                                |
| `apps\chaos-engine\bin\chaos-unit.exe`                                                       | logique pure : registre, paramètres, transitions, configuration (migration, fichier illisible), ordonnanceur (file, priorités, remplacement, prolongement, capacité, expiration, STOP ALL, idempotence), protocole | 1 s       | **21/21**                         |
| `apps\chaos-engine\bin\chaos-checks.exe [--quick]`                                           | vrai moteur, vrai GPU, mire de 400×240 sur l'écran secondaire, pixels lus à l'écran (détail ci-dessous)                                                                                                            | 60 à 75 s | **39/39** (38 en `--quick`)       |
| `npx vitest run test/chaos-runtime.test.ts` (dans `apps/studio/server`)                      | pilote Studio : corrélation, battements, relance, arrêt ; API `/api/chaos` (protection, validation) ; registre conforme au schéma zod ; vrai moteur sous Windows                                                   | 3 s       | **10/10**                         |
| `npm run chaos:lab -- --no-open`, puis `npx tsx apps/studio/server/scripts/chaos-lab-e2e.ts` | page Studio › Chaos dans un Chromium sans fenêtre : « Tester » retourne vraiment la mire (pixels), STOP ALL, réglages enregistrés, captures de la page                                                             | 20 s      | **8/8**                           |
| `ChaosEngine.exe --bench-gpu [--w --h --frames]`                                             | coût GPU par passe, hors écran                                                                                                                                                                                     | 5 s       | 0,02 à 0,08 ms par passe en 1440p |
| `ChaosEngine.exe --render-preview <dossier>`                                                 | planche des transitions et des coins (contrôle visuel)                                                                                                                                                             | 2 s       | —                                 |

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
- **sobriété** : calque sans capture, mesures, repos sans fuite.

Toujours lancer `chaos-checks` **hors partie** : il affiche une petite mire sur l'écran secondaire pendant environ une
minute, sans jamais prendre le focus.

## 2. Ce qui reste à confirmer à la main (Antoni)

Ces points ne peuvent pas être prouvés automatiquement ici :

- un vrai jeu ;
- la latence ressentie ;
- le curseur d'un jeu (fenêtre outil exclue de la liste) ;
- le raccourci Ctrl+Maj+F11 pressé physiquement ;
- OBS.

| #   | Test                                                                                          | Regarder                                                                                                  |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R1  | Bureau (navigateur) : Chaos Lab › Tester sur la fenêtre                                       | un seul curseur, clics justes, aucune image de l'ancien écran pendant la rotation (coins « Miroir flou ») |
| R2  | Dofus (fenêtré sans bordure) : « Fenêtre au premier plan, dans 3 s », puis passer dans le jeu | curseur de Dofus : le vrai (bien) ou retourné avec l'image ; fluidité ; « image noire » ?                 |
| R3  | Overwatch (fenêtré sans bordure), même méthode                                                | menus, viseur (il tourne avec l'image : attendu), fluidité, FPS du jeu avant et pendant                   |
| R4  | Un jeu d'horreur indépendant                                                                  | idem R3                                                                                                   |
| R5  | OBS ouvert, aperçu de la scène qui capture l'écran                                            | l'aperçu montre l'effet (mode D)                                                                          |
| R6  | Arrêts : Ctrl+Maj+F11 en jeu ; STOP ALL ; fermer le Chaos Lab ; Alt+Tab                       | retour immédiat à la normale ; Alt+Tab masque l'effet                                                     |

Note sur l'**ancien panneau du lot 1** : s'il est ouvert, il tient Ctrl+Maj+F11, et le moteur le signale comme
« raccourci indisponible ». Le fermer avant ces tests.

## 3. Mesures en jeu (facultatif, avec GO d'Antoni pour PresentMon)

Protocole complet : [RECHERCHE_CHAOS_V2.md](RECHERCHE_CHAOS_V2.md) § 6, paliers E1 (jeu et OBS sans effet), E5
(retournement en cours) et E7 (retour à la normale). Il mesure la seule latence qui compte (`MsAllInputToPhotonLatency`)
et le mode de présentation du jeu pendant l'effet (perte possible de l'« independent flip » et de G-Sync). Les mesures
du moteur (Studio › Chaos › Moteur) sont internes et ne les remplacent pas.
