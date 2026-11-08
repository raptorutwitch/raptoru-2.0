# Nettoyage différé : propositions, rien n'a été supprimé

Relevé du 08/11/2026, en lecture seule. **Chaque retrait demande l'accord d'Antoni**, au cas par cas.

Avant de retirer quoi que ce soit, il faut :

- regarder les modifications non commitées du worktree (`git -C <dossier> status`) et les sauver si elles comptent ;
- vérifier que la branche est bien fusionnée (`git branch --merged origin/main`) ;
- ne jamais toucher le checkout principal ni `Documents\Sauvegarde Raptoru 2.0`.

## 1. Worktrees

Carte complète (rôle, importance) : [WORKSPACES.md](WORKSPACES.md). Ci-dessous, seulement les propositions.

La colonne « non commités » compte les fichiers modifiés ou non suivis, hors dossiers `.runtime-*` laissés par des tests.

| Dossier                                                                                                   | Branche                              | Fusionnée dans `origin/main`                        | Non commités                     | Proposition                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Documents\Raptoru 2.0` (checkout principal)                                                              | `main` local, 429 commits de retard  | —                                                   | 79                               | **garder** (données du Studio installé) ; mise à jour sur GO, avec sauvegarde                                     |
| `…Worktrees\extension-next`                                                                               | `feat/extension-next`                | non                                                 | 0                                | **garder** (Extension Next, seule copie)                                                                          |
| `…Worktrees\consolidation`                                                                                | `docs/consolidation-2026-11`         | non                                                 | —                                | garder jusqu'à la fusion                                                                                          |
| `…Worktrees\studio-ux`                                                                                    | `docs/extension-audit`               | non (base des deux précédentes)                     | 0                                | garder jusqu'à la fusion d'Extension Next                                                                         |
| `…Worktrees\extension-next-packaging`                                                                     | `feat/extension-next-packaging`      | non, mais déjà fusionnée dans `feat/extension-next` | 0                                | retirable après la fusion d'Extension Next                                                                        |
| `…Worktrees\rollback-8a897a5`                                                                             | détachée (`8a897a5`)                 | —                                                   | 0                                | retirable (outil de retour arrière de la bascule du 07/11)                                                        |
| `…Worktrees\halloween-24h`                                                                                | `feat/halloween-cauldron` (PR #47)   | non                                                 | 1                                | décider du sort de la PR                                                                                          |
| `…Worktrees\halloween-titles`                                                                             | `feat/studio-viewer-titles` (PR #54) | non                                                 | 0                                | décider du sort de la PR                                                                                          |
| `…Worktrees\live-feedback`                                                                                | `feat/cosmetic-shop` (PR #44)        | non (boutique livrée par une autre PR)              | 0                                | fermer la PR, puis retirer                                                                                        |
| `…Worktrees\responsive-live`                                                                              | `fix/extension-responsive`           | oui                                                 | 23                               | inspecter les 23 fichiers, puis retirer                                                                           |
| `…Worktrees\site-hub-core`                                                                                | `docs/site-hub-delivered`            | oui                                                 | 13                               | inspecter, puis retirer                                                                                           |
| `Documents\raptoru-roue-v2-backup`                                                                        | `backup/roue-v2-wip-2026-10-25`      | non                                                 | 0                                | **garder** (sauvegarde, aussi en bundle)                                                                          |
| `Documents\raptoru-docs`                                                                                  | `docs/workspace` (PR #36)            | non                                                 | 0                                | contenu dépassé par cette consolidation : fermer la PR, puis retirer                                              |
| `Documents\raptoru-dock`                                                                                  | `docs/handoff-2026-10-28` (PR #34)   | non                                                 | 0                                | idem                                                                                                              |
| `Documents\raptoru-release`                                                                               | `chore/coolify-deploy`               | non (3 commits)                                     | 0                                | vérifier que le script est bien dans `main` (il y est), puis retirer                                              |
| `Documents\raptoru-cicd`, `raptoru-random-ban`, `raptoru-roue-v2`, `raptoru-spotify`, `raptoru-halloween` | fusionnées ou détachées              | oui                                                 | 0 à 2                            | inspecter, puis retirer                                                                                           |
| `AppData\Local\Temp\…\scratchpad\{chat,deliv,node,rb,sb,solde,sup,vk,wg}-wt`                              | branches toutes fusionnées           | oui                                                 | jusqu'à 2 700 (copies anciennes) | inspecter un exemple : probablement des fins de ligne ou des fichiers générés ; puis `git worktree remove` sur GO |
| `.claude\jobs\…\tmp\{sup10,supcheck}`                                                                     | détachées                            | —                                                   | 36 et 44                         | inspecter, puis retirer                                                                                           |

## 2. Branches locales

- **Fusionnées dans `origin/main`, supprimables plus tard** (`git branch -d`, jamais `-D` sans vérification) : environ 70
  branches `ci/*`, `docs/*-live`, `feat/*`, `fix/*`, `ops/*`, `release/*`. La liste se lit avec `git branch --merged origin/main`.
- **À garder** :
  - `feat/extension-next`, `docs/extension-audit`, `docs/consolidation-2026-11` ;
  - `backup/roue-v2-wip-2026-10-25` ;
  - les branches des PR ouvertes.
- **PR ouvertes** : triage ci-dessous.

### PR ouvertes (relevé du 08/11)

Toutes sont **en conflit avec `main`**, avec 184 à 270 commits de retard. Aucune n'a été fermée, fusionnée ni modifiée.

| PR  | Branche                               | Contenu                                                                                     | Situation                                                                                                                | Recommandation                                                              |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| #34 | `docs/handoff-2026-10-28`             | passation du 28/10 (Dock V1.2 clos et validé, état de Production)                           | dépassée par la consolidation ; sa seule information encore utile, la validation du Dock, est reprise dans `OBS_DOCK.md` | fermer sans fusion, sur accord                                              |
| #36 | `docs/workspace`                      | « un seul dépôt », inventaire des dossiers, règle des worktrees (`docs/WORKSPACE.md`)       | dépassée par [WORKSPACES.md](WORKSPACES.md) et `REPRISE.md` § 3                                                          | fermer sans fusion                                                          |
| #38 | `docs/halloween-delivered`            | Halloween livré le 29/10                                                                    | événement fermé ; état repris dans la roadmap                                                                            | fermer sans fusion                                                          |
| #40 | `docs/progression-delivery`           | livraison de la progression du 29/10 (Core `7264de0`, site `7181298`)                       | reprise dans la roadmap                                                                                                  | fermer sans fusion                                                          |
| #48 | `docs/reprise-halloween`              | état Halloween du 30/10, liste avant le live                                                | historique                                                                                                               | fermer sans fusion                                                          |
| #43 | `feat/level-up-v2` (brouillon)        | Level Up V2 : 1 000 XP par niveau, normalisation WizeBot, notifications par viewer, inactif | **fonctionnel, non livré** ; 39 fichiers, conflits                                                                       | **garder** ; décision produit d'Antoni, puis rebase dans une mission dédiée |
| #44 | `feat/cosmetic-shop` (brouillon)      | Boutique cosmétique V1                                                                      | la boutique a été **livrée par la PR #49** (fusionnée le 30/10) ; reste peut-être une différence de périmètre            | vérifier qu'aucun reste n'est voulu, puis fermer                            |
| #47 | `feat/halloween-cauldron` (brouillon) | Chaudron des subs (subgoal OBS), Lab, éteint                                                | fonctionnel, non livré                                                                                                   | **garder** si l'idée revient pour un événement ; sinon fermer               |
| #54 | `feat/studio-viewer-titles`           | Studio équipe et retire le titre d'un viewer                                                | fonctionnel ; **un commit local non poussé** (`5d24614`, historique des attributions)                                    | **garder** ; pousser `5d24614` et faire un rebase dans une mission dédiée   |

- `docs/coulisses-execution` (`be3d17e`) : son contenu est repris dans cette consolidation (commit `37f47fe`). Supprimable après la fusion.

## 3. Documents

- **Non suivis dans le checkout principal** ([archive/README.md](archive/README.md)) : à archiver ou à supprimer sur accord.
  - `RAPTORU_POST_MIGRATION_TRUTH_2026-10-23.md` ;
  - `TWITCH_CONNECTION_INCIDENT_2026-10-22.md` (sa § 9 contient des requêtes de diagnostic) ;
  - `CLAUDE_HANDOFF_CURRENT.md`, `RAPTORU_2_0_CHATGPT_HANDOFF_2026-10-23.md` ;
  - une ancienne copie de `docs/REPRISE.md`.

  Ne jamais committer `HANDOFF_MIGRATION_2026-10-20.md` ni `POST_LIVE_AUDIT_2026-10-20.md` : ils sont privés.

- **Candidats à l'archivage** : avant de déplacer, chercher les références (`git grep <nom>`) et corriger les liens.
  - `CUTOVER_PLAN_2026-10.md`, `TEST_REEL_STAGING_2026-10.md`, `bonk-lab.md`, `TWITCH_GEOMETRY_CALIBRATION_2026-10.md`,
    `SUPERVISION_LOTS_1_2.md`, `HALLOWEEN.md`, `HALLOWEEN_GO.md`, `PROGRESSION_GO.md`, `RELEASE_SITE_HUB.md`,
    `RAPTORU_STUDIO_UX_UI_2026-11-04.md` ;
  - `studio-refonte/{CHECKPOINT,ROADMAP,JOURNAL,FOUNDATION_COMPLETE,LIVRAISON}.md`.
- **À archiver seulement après avoir déplacé leur procédure de retour arrière dans `OPERATIONS.md`** :
  - `BOT_VPS_CUTOVER.md` (§ 10) ;
  - `SUB_WHEEL_V2_DELIVERY.md`.
- **`README.md` racine** : ses sections Daily, Présence, Wallet et Fidélité (environ l. 215–284) décrivent l'avant-bascule.
  À extraire dans les documents de module.
- **À rafraîchir** :
  - `OPERATIONS.md` § 5 (builds `0.1.7-sup.N`, obsolètes) ;
  - `BACKUPS.md` (inventaire détaillé au 24/10) ;
  - `CICD.md` (exemples de versions, coût du dépôt privé).

## 4. Fichiers et code

| Élément                                                                                                                         | Proposition                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Dossiers `.runtime-prod-transport-test-*`, `.runtime-sound-test-*`, `.runtime-tts-test-*` non suivis dans le checkout principal | restes de tests interrompus ; à supprimer sur GO, jamais avec `git clean` (le dossier contient les données de Studio) |
| `apps/viewer-web`                                                                                                               | squelette jamais utilisé (le site est dans un autre dépôt) : à retirer                                                |
| `apps/studio/web/src/{moderation.ts,moderation.css,tts-config.ts}`                                                              | code mort de Coulisses : décision d'Antoni ([studio-refonte/PARITE.md](studio-refonte/PARITE.md))                     |
| Ancien Lab de Studio (`studio:legacy`)                                                                                          | retrait préparé : [studio-refonte/RETRAIT_ANCIEN_LAB.md](studio-refonte/RETRAIT_ANCIEN_LAB.md) (choix A ou B)         |
| Shell legacy de l'extension (`overlay.js`, `mobile.js`, `shared/ui.js`, feuilles legacy)                                        | lot 6 d'Extension Next, au moins 2 semaines après une publication stable, sur accord                                  |
| `apps/twitch-extension/test/responsive/out/` (branche `feat/extension-next`)                                                    | sorties du banc, ignorées par Git : à vider quand on veut                                                             |
| Conteneur Docker `coulisses-rehearsal-pg`                                                                                       | répétition des migrations du 07/11 : à supprimer sur GO                                                               |
| Défaut `https://coolify.raptoru.fr` dans `scripts/coolify-deploy.mjs` et `scripts/delivery/status.mjs`                          | passer à `https://dashboard.raptoru.fr` (petit correctif de code, hors consolidation)                                 |
