# Espaces de travail et sauvegardes : la carte

Relevé du **08/11/2026**, en lecture seule (`git worktree list`, `git status`, liste des dossiers). Rien n'a été déplacé ni
supprimé. Les propositions de retrait sont dans [CLEANUP_LATER.md](CLEANUP_LATER.md), et chacune demande l'accord d'Antoni.

## 1. Où travailler

- **Nouveau worktree** : uniquement dans `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\<nom>`, à partir de
  `origin/main` ou de la branche du chantier :

  ```sh
  git -C "C:\Users\Antoni\Documents\Raptoru 2.0" fetch origin
  git -C "C:\Users\Antoni\Documents\Raptoru 2.0" worktree add -b <branche> "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\<nom>" origin/main
  ```

- **Jamais** dans le checkout principal. Ni `git clean`, ni `reset --hard`, ni `checkout .`, nulle part sans accord.

## 2. Worktrees

La colonne « Non commités » compte les modifications au 08/11, hors dossiers `.runtime-*` laissés par des tests.

| Dossier                                                                                                   | Branche @ commit                                                  | Rôle                                                                                                                                                                  | Non commités | Importance                            |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------- |
| `Documents\Raptoru 2.0` (checkout principal)                                                              | `main` local @ `11ffe3f` (429 commits de retard)                  | **dossier de données du Studio installé** (`.env`, jetons Twitch, `apps/studio/server/.runtime`) ; ancien travail non commité (`tools/subgoal/`, copies de documents) | 79           | **critique : ne pas toucher**         |
| `…Worktrees\extension-next`                                                                               | `feat/extension-next` @ `2f45ac1`, **sur GitHub** depuis le 08/11 | Extension Next (shell v2), journal, banc, comparateur                                                                                                                 | 0            | **critique**                          |
| `…Worktrees\consolidation`                                                                                | `docs/consolidation-2026-11`                                      | consolidation documentaire (PR vers `main`)                                                                                                                           | 0            | haute jusqu'à la fusion               |
| `…Worktrees\studio-ux`                                                                                    | `docs/extension-audit` @ `3834d6b`                                | base commune des deux branches précédentes (documents d'audit) ; la refonte Studio y a été faite                                                                      | 0            | moyenne                               |
| `…Worktrees\extension-next-packaging`                                                                     | `feat/extension-next-packaging` @ `80bbaee`                       | emballage verrouillé, déjà fusionné dans `feat/extension-next`                                                                                                        | 0            | basse                                 |
| `…Worktrees\halloween-titles`                                                                             | `feat/studio-viewer-titles` @ `5d24614`                           | PR #54 ; **1 commit local non poussé** (`5d24614`)                                                                                                                    | 0            | moyenne                               |
| `…Worktrees\halloween-24h`                                                                                | `feat/halloween-cauldron` @ `23d9c12`                             | PR #47, brouillon                                                                                                                                                     | 1            | moyenne                               |
| `…Worktrees\live-feedback`                                                                                | `feat/cosmetic-shop` @ `c4b1a6f`                                  | PR #44, brouillon (boutique livrée par la PR #49)                                                                                                                     | 0            | basse                                 |
| `…Worktrees\responsive-live`                                                                              | `fix/extension-responsive` @ `a28be85` (fusionnée)                | ancien correctif responsive                                                                                                                                           | 23           | basse, à inspecter                    |
| `…Worktrees\site-hub-core`                                                                                | `docs/site-hub-delivered` @ `68420a0` (fusionnée)                 | livraison du site du 04/11                                                                                                                                            | 13           | basse, à inspecter                    |
| `…Worktrees\rollback-8a897a5`                                                                             | détaché @ `8a897a5`                                               | outil de retour arrière de la bascule du 07/11                                                                                                                        | 0            | basse                                 |
| `Documents\raptoru-roue-v2-backup`                                                                        | `backup/roue-v2-wip-2026-10-25` @ `99157a3`                       | **sauvegarde** de la Roue V2 en cours, avec le correctif « écran gris »                                                                                               | 0            | **haute : garder**                    |
| `Documents\raptoru-docs`, `raptoru-dock`                                                                  | `docs/workspace` (PR #36), `docs/handoff-2026-10-28` (PR #34)     | anciens documents                                                                                                                                                     | 0            | basse                                 |
| `Documents\raptoru-release`                                                                               | `chore/coolify-deploy` @ `1f10da3`                                | ancien outil de déploiement (aujourd'hui dans `main`)                                                                                                                 | 0            | basse                                 |
| `Documents\raptoru-cicd`, `raptoru-random-ban`, `raptoru-roue-v2`, `raptoru-spotify`, `raptoru-halloween` | branches fusionnées ou détachées                                  | anciens chantiers livrés                                                                                                                                              | 0 à 2        | basse                                 |
| `AppData\Local\Temp\…\scratchpad\*-wt` (9) et `.claude\jobs\…\tmp\{sup10,supcheck}`                       | branches fusionnées ou détachées                                  | chantiers d'octobre (chat, supervision, Votekick, Soundboard compact `0bf7907`…)                                                                                      | 3 à 2 700    | basse, à inspecter avant tout retrait |

## 3. Branches importantes

| Branche                                     | Où                           | Rôle                                                                                                        |
| ------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `main`                                      | GitHub, `13ed6e8` le 08/11   | code en Production : Core et bot `1b25f30` + Studio 0.1.27                                                  |
| `feat/extension-next`                       | **GitHub** `2f45ac1`         | Extension Next, **non fusionnée** (fusion à faire dans la mission de publication)                           |
| `docs/consolidation-2026-11`                | GitHub (PR)                  | consolidation                                                                                               |
| `backup/roue-v2-wip-2026-10-25` (`99157a3`) | **locale seulement**, exprès | sauvegarde. gitleaks : aucun secret ; gardée hors du dépôt public par prudence, elle existe aussi en bundle |
| `docs/extension-audit`                      | locale                       | ses 4 commits sont dans les deux branches précédentes                                                       |
| PR ouvertes                                 | GitHub                       | triage : [CLEANUP_LATER.md](CLEANUP_LATER.md) § 2                                                           |

## 4. Sauvegardes : `C:\Users\Antoni\Documents\Sauvegarde Raptoru 2.0\`

Le dossier est à accès restreint, et hors de Git. **Ne jamais déplacer, supprimer ni copier ces fichiers dans le dépôt.**

- Le type est déduit du nom du dossier : aucun dump n'a été ouvert pour ce relevé.
- La colonne « Vérification » cite le document qui la prouve ; « — » veut dire « non vérifiée ».
- La colonne « Confidentialité » dit ce qu'une fuite exposerait.

| Dossier                                                                         | Date        | Type                                                                     | Utilité                                | Vérification                               | Confidentialité                                     |
| ------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `prod-db-2026-11-07-avant-coulisses`                                            | 07/11       | dump de la base Production                                               | retour arrière de la bascule Coulisses | **restauré** (OPERATION_COULISSES § 12)    | **élevée** (portefeuilles et identités des viewers) |
| `prod-db-2026-10-30`, `prod-db-2026-10-24`, `2026-10-29-prod-db-avant-*`        | 24–30/10    | dumps Production                                                         | points antérieurs                      | 24/10 : lisible (BACKUPS § 2) ; autres : — | élevée                                              |
| `studio-data-2026-11-07-avant-coulisses`                                        | 07/11       | données du Studio installé (204 fichiers)                                | retour arrière de Studio               | **restauration d'essai 204/204**           | **élevée** (`.env`, jetons Twitch, jetons OBS)      |
| `studio-data-2026-10-24*`, `studio-data-2026-10-25-*`                           | 24–25/10    | données de Studio                                                        | anciens points                         | BACKUPS § 1                                | élevée                                              |
| `studio-profile-avant-0.1.*`, `2026-10-3*-studio-profil-*`                      | 26–31/10    | profil de Studio avant chaque mise à jour                                | retour arrière d'une version           | —                                          | moyenne à élevée (préférences, connexions)          |
| `studio-installer-0.1.25`, `-0.1.26`                                            | 07/11       | installateurs de Studio                                                  | réinstaller une version précédente     | —                                          | faible                                              |
| `Raptoru Studio`                                                                | 23/10       | ancienne copie de Studio                                                 | historique                             | —                                          | à évaluer                                           |
| `extension-next-2026-11-08`                                                     | 08/11       | bundle de `99157a3` + patch du travail non commité du checkout principal | preuve et reprise                      | bundle vérifié (`git bundle verify`)       | faible à moyenne (code, chemins locaux)             |
| `roue-v2-2026-10-25`                                                            | 25/10       | Roue V2 en cours                                                         | historique                             | —                                          | faible à moyenne                                    |
| `2026-10-29-wizebot-archive`                                                    | 29/10       | archive WizeBot (XP historique)                                          | reprise de la progression              | —                                          | moyenne (identités et statistiques des viewers)     |
| `halloween-items-2026-10-31`, `halloween-close-2026-11-02`, `titles-2026-10-31` | 31/10–02/11 | état de l'événement, des objets et des titres                            | historique de Halloween                | —                                          | moyenne (achats des viewers)                        |
| `worktrees-2026-10-24`                                                          | 24/10       | instantané des worktrees                                                 | historique                             | BACKUPS § 1                                | à évaluer (pourrait contenir des `.env`)            |

**Côté serveur** : sauvegarde automatique de la base par Coolify chaque jour à 04:00 UTC. La dernière réussie date du
08/11 (`coolify-deploy.mjs status core`).
