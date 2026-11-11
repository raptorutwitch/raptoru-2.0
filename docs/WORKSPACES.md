# Espaces de travail : la carte des worktrees, branches et dossiers

Relevé du **10/11/2026**, en lecture seule : `git worktree list`, `git status`, `git rev-list`, `gh pr list`. Rien n'a
été déplacé ni supprimé. Propositions de retrait : [CLEANUP_LATER.md](CLEANUP_LATER.md), chacune sur accord d'Antoni.
Sauvegardes : [BACKUPS.md](BACKUPS.md).

## 1. Où travailler

- **Dépôt canonique** : `https://github.com/raptorutwitch/raptoru-2.0`, branche `main` (`afe98cf` le 10/11). C'est la
  seule source de vérité du code. Le checkout principal **n'est pas** à jour (§ 2).
- **Nouveau worktree** : uniquement dans `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\<nom>` :

  ```sh
  git -C "C:\Users\Antoni\Documents\Raptoru 2.0" fetch origin
  git -C "C:\Users\Antoni\Documents\Raptoru 2.0" worktree add -b <branche> "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\<nom>" origin/main
  ```

- **Jamais** de travail dans le checkout principal. Nulle part de `git clean`, `reset --hard` ni `checkout .` sans
  accord.

## 2. Worktrees (36 au 10/11)

« Non commités » : fichiers modifiés ou non suivis, hors `.runtime-*` de tests. « Fusion » : par rapport à
`origin/main`.

### Actifs ou à préserver

| Dossier                                      | Branche @ commit                                                        | Rôle                                                                                                                                                                                                          | Non commités | Fusion       | Importance                                |
| -------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------ | ----------------------------------------- |
| `Documents\Raptoru 2.0` (checkout principal) | `main` local @ `11ffe3f`, **523 commits de retard**                     | **dossier de données du Studio installé** ; vieux travail non commité (patch sauvegardé le 08/11)                                                                                                             | 79           | —            | **critique : ne pas toucher**             |
| `…Worktrees\post-live`                       | `feat/post-live-moderation` (PR #64, poussée)                           | **passe post-live du 11/11** : Portefeuille, `!addpoints`, Musique dans la modération, Tombola ; base de test Docker `raptoru_postlive_test` (conteneur `vk-test-pg`) ; captures `.lab-data/tombola-captures` | 0            | non (PR #64) |
| `…Worktrees\consolidation-1110`              | `docs/consolidation-2026-11-10` (au-dessus de `docs/chaos-v2-research`) | **cette consolidation** + recherche Chaos V2 ; locale, non poussée                                                                                                                                            | 0            | non          | **haute jusqu'à la fusion**               |
| `…Worktrees\chaos-v2`                        | `docs/chaos-v2-research` @ `252e9c6`                                    | recherche Chaos V2 (1 commit, **non poussé**), contenue dans la branche ci-dessus                                                                                                                             | 0            | non          | haute jusqu'à la fusion                   |
| `…Worktrees\music-finish`                    | `docs/music-hub-finish-delivery` @ `1dee670` (PR #62 fusionnée)         | contient le **ZIP de référence de l'extension** `bbce1048a078` (dossier `release\`, ignoré par Git)                                                                                                           | 0            | oui          | **haute : livrable unique sur le disque** |
| `…Worktrees\release-2026-11-10`              | `release/2026-11-10-finish` @ `5ee8623` (fusionnée)                     | ZIP précédents `5ee8623` et staging `715ac2c` (`release\`)                                                                                                                                                    | 0            | oui          | moyenne (archives)                        |
| `…Worktrees\music-hub`                       | `feat/music-hub` @ `831f8de` (fusionnée par #59)                        | chantier Music Hub ; bundle sauvegardé le 09/11                                                                                                                                                               | 0            | oui          | basse                                     |
| `…Worktrees\audit-fiabilite`                 | `audit/fiabilite-2026-11-09` @ `6f4cf9c` (fusionnée)                    | audit du 09/11                                                                                                                                                                                                | 0            | oui          | basse                                     |
| `…Worktrees\extension-next`                  | `feat/extension-next` @ `2f45ac1` (**fusionnée** par #59)               | Extension Next : journal, banc, comparateur `Comparer legacy et v2.cmd`                                                                                                                                       | 0            | oui          | moyenne (outils de recette)               |
| `…Worktrees\halloween-titles`                | `feat/studio-viewer-titles` @ `5d24614`                                 | PR #54 ; **1 commit local non poussé**                                                                                                                                                                        | 0            | non (+3)     | **moyenne : seule copie de `5d24614`**    |
| `…Worktrees\halloween-24h`                   | `feat/halloween-cauldron` @ `23d9c12`                                   | PR #47 brouillon                                                                                                                                                                                              | 1            | non (+1)     | moyenne                                   |
| `…Worktrees\live-feedback`                   | `feat/cosmetic-shop` @ `c4b1a6f`                                        | PR #44 brouillon (boutique livrée par #49)                                                                                                                                                                    | 0            | non (+6)     | basse                                     |
| `Documents\raptoru-roue-v2-backup`           | `backup/roue-v2-wip-2026-10-25` @ `99157a3`                             | **sauvegarde** (aussi en bundle)                                                                                                                                                                              | 0            | non (+1)     | **haute : garder**                        |

### Historiques (fusionnés ou dépassés)

| Dossier                                                                              | Branche @ commit                                              | Non commités  | Remarque                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…Worktrees\consolidation`                                                           | `docs/consolidation-2026-11` (fusionnée le 08/11)             | 0             | consolidation précédente                                                                                                                                                                                      |
| `…Worktrees\studio-ux`                                                               | `docs/extension-audit` @ `3834d6b` (fusionnée)                | 0             | base d'Extension Next                                                                                                                                                                                         |
| `…Worktrees\extension-next-packaging`                                                | `feat/extension-next-packaging` @ `80bbaee` (fusionnée)       | 0             | contient un ZIP staging du 08/11                                                                                                                                                                              |
| `…Worktrees\responsive-live`                                                         | `fix/extension-responsive` @ `a28be85` (fusionnée)            | 23            | à inspecter avant tout retrait                                                                                                                                                                                |
| `…Worktrees\site-hub-core`                                                           | `docs/site-hub-delivered` @ `68420a0` (fusionnée)             | 13            | à inspecter                                                                                                                                                                                                   |
| `…Worktrees\rollback-8a897a5`                                                        | détaché @ `8a897a5`                                           | 0             | outil de retour arrière du 07/11                                                                                                                                                                              |
| `…Worktrees\raptoru-fr-refonte`                                                      | (dépôt du site, pas ce dépôt)                                 | —             | chantier raptoru.fr V2                                                                                                                                                                                        |
| `Documents\raptoru-docs`, `raptoru-dock`                                             | `docs/workspace` (PR #36), `docs/handoff-2026-10-28` (PR #34) | 0             | anciens documents                                                                                                                                                                                             |
| `Documents\raptoru-release`                                                          | `chore/coolify-deploy` @ `1f10da3` (+3, déjà dans `main`)     | 0             | ancien outil de déploiement                                                                                                                                                                                   |
| `Documents\raptoru-cicd`, `raptoru-random-ban`, `raptoru-roue-v2`, `raptoru-spotify` | branches fusionnées                                           | 0 à 2         | anciens chantiers                                                                                                                                                                                             |
| `Documents\raptoru-halloween`                                                        | détaché @ `7223b0a`                                           | 0             | contient des ZIP Halloween du 28–29/10                                                                                                                                                                        |
| `AppData\Local\Temp\claude\…\scratchpad\{chat,deliv,node,rb,sb,solde,sup,vk,wg}-wt`  | branches fusionnées                                           | jusqu'à 2 725 | **fichiers effacés par le nettoyage des fichiers temporaires de Windows** (jusqu'à 2 690 « D ») plus 21 à 36 modifications : du travail d'octobre, déjà dans l'instantané du 24/10 ([BACKUPS.md](BACKUPS.md)) |
| `.claude\jobs\…\tmp\{sup10,supcheck}`                                                | détachés                                                      | 36 et 44      | ancien travail de supervision                                                                                                                                                                                 |

## 3. Branches importantes

| Branche                                                              | Où                           | Rôle                                                                    |
| -------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `main`                                                               | GitHub, `afe98cf`            | code en Production (Core `bbce104`, bot `900637f`, Studio 0.1.29)       |
| `feat/post-live-moderation`                                          | GitHub, PR #64               | passe post-live du 11/11 ([RAPPORT_POST_LIVE.md](RAPPORT_POST_LIVE.md)) |
| `docs/consolidation-2026-11-10`                                      | **locale**                   | consolidation du 10/11 + Chaos V2 : à pousser et fusionner sur GO       |
| `docs/chaos-v2-research`                                             | **locale**                   | recherche Chaos V2 (incluse dans la précédente)                         |
| `feat/studio-viewer-titles`                                          | GitHub + 1 commit local      | PR #54                                                                  |
| `feat/level-up-v2`, `feat/halloween-cauldron`, `feat/cosmetic-shop`  | GitHub                       | PR brouillons #43, #47, #44                                             |
| `backup/roue-v2-wip-2026-10-25`                                      | **locale seulement**, exprès | sauvegarde (aussi en bundle)                                            |
| Environ 70 branches `ci/*`, `docs/*`, `feat/*`, `fix/*`, `release/*` | locales                      | fusionnées : `git branch --merged origin/main`                          |

**PR ouvertes (11/11)** : **#64 (passe post-live)**, #34, #36, #38, #40, #48 (documents dépassés), #43, #44, #47 (brouillons), #54 (titres).
Triage : [CLEANUP_LATER.md](CLEANUP_LATER.md) § 2.

## 4. Autres dossiers du projet (hors Git)

| Dossier                                                                                        | Contenu                                                                                                                             | Règle                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `Documents\Raptoru 2.0 - Livraisons\`                                                          | paquets de livraison du 29–31/10 : médias Halloween v1–v3, extension Halloween, alertes, transition OBS, sécurité du site, captures | garder ; ne jamais copier dans Git                     |
| `Documents\Sauvegarde Raptoru 2.0\`                                                            | sauvegardes à accès restreint                                                                                                       | [BACKUPS.md](BACKUPS.md)                               |
| `Documents\OBS-Backups\`                                                                       | sauvegardes OBS du 10/11                                                                                                            | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) § 4       |
| `%APPDATA%\Raptoru Studio`, `%APPDATA%\Raptoru Studio Lab`                                     | profils de Studio (Production, Lab)                                                                                                 | ne pas déplacer                                        |
| `%LOCALAPPDATA%\Programs\Raptoru Studio`                                                       | installation de Studio                                                                                                              | ne pas toucher                                         |
| `Documents\Raptoru\` (dont `CANONICAL_WORKSPACE`, `Raptoru-Live-GitHub`, `_migration-exports`) | **ancien projet Raptoru** (avant 2.0) et exports privés de la migration du 20/10                                                    | historique ; `_migration-exports` contient des secrets |
| `Documents\ChatGPT\Extension Twitch\`                                                          | ancienne archive d'extension (septembre)                                                                                            | historique, à ne jamais téléverser                     |
