# Espace de travail — inventaire et organisation cible

Relevé en lecture seule le **28/10/2026** : rien n'a été déplacé ni supprimé. Le rangement se fera **après Halloween
(31/10)**, étape par étape, avec l'accord d'Antoni (§ 5). Sauvegardes et politique de conservation :
[BACKUPS.md](BACKUPS.md). Règles de travail : `CLAUDE.md` § « Workspace ».

## 1. Un seul projet

Raptoru 2.0 est **un seul dépôt Git** (`raptorutwitch/raptoru-2.0`) dont le checkout principal est
`Documents\Raptoru 2.0`. Tous les autres dossiers `raptoru-*` de Documents sont soit des **worktrees** de ce même dépôt
(une branche de travail, même historique), soit des copies de build, soit des paquets de livraison, soit des
sauvegardes. Il n'existe qu'**un seul Studio** : ses versions viennent toutes de ce dépôt (`npm run studio:release`).

**Halloween** n'est pas une application à part. C'est la branche `feat/halloween` (PR #35), développée dans le
worktree `Documents\raptoru-halloween` :

- un onglet du même Studio ;
- un module de la même extension ;
- un service du même Core ;
- une migration du même schéma.

Après la fusion, le worktree n'a plus d'utilité.

### Assets Halloween à la livraison

| Asset                                                       | Où il vit                                                                                                   | Livré par                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Page overlay (`halloween-overlay/`)                         | Git                                                                                                         | l'installateur Studio (`stage.mjs` l'embarque)            |
| Miniatures (`extension/assets/halloween/*.jpg`, `fx-*.svg`) | Git                                                                                                         | le paquet d'extension                                     |
| Catalogue, prix, règles                                     | Core (tables `event_*`, créées par la migration)                                                            | la migration + le Core                                    |
| **Vidéos des screamers** (30 WebM, 22 Mo)                   | **hors Git**, générées à partir des originaux (`Stream PROJET\Halloween`, `Anim de stream\Screameur Audio`) | le script `halloween-import.mjs`, à lancer à la livraison |

- **Où le Studio installé lit les vidéos** : le dossier de données du Studio installé (`dataRoot` = le checkout
  principal), c'est-à-dire `Documents\Raptoru 2.0\apps\studio\server\.runtime\halloween\media\`. Il n'y en a pas
  encore.
- **La copie du worktree** (`raptoru-halloween\…\.runtime\halloween\media\`) ne sert qu'au Lab : elle disparaît avec
  le worktree, et le Studio installé ne la lit jamais.
- **À la livraison** :
  1. Copier ces 30 fichiers et leur `manifest.json` dans le dossier du Studio installé. On peut aussi relancer le
     script avec `--out` (HALLOWEEN.md § 5).
  2. Garder une copie dans `Sauvegarde Raptoru 2.0\<date>-halloween-media\`.

  Raison : la seule commande `ffmpeg` du PC est celle d'iMyFone VoxBox. Si ce logiciel est désinstallé, la
  reconversion n'est plus possible sans réinstaller `ffmpeg`.

## 2. Inventaire (28/10)

### Dépôt principal

| Dossier                 | Rôle                                                                                             | État                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Documents\Raptoru 2.0` | checkout `main` **et** dossier de données du Studio installé (`.env`, jetons Twitch, `.runtime`) | `main` local @ `11ffe3f`, en retard sur `origin/main` ; 41 fichiers modifiés et 37 non suivis (ancienne copie Roue V2, correctif « écran gris », documents) ; aucun stash. **Jamais `git clean` / `reset --hard` / `checkout .`** |

### Worktrees Git dans Documents (même dépôt)

| Dossier                  | Branche                                  | Fusionnée dans `main`                                                  | Non commité                                               | Verdict                                                     |
| ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `raptoru-halloween`      | `feat/halloween`                         | non (PR #35 ouverte)                                                   | non ; `.runtime` Lab (médias, voir § 1)                   | **actif** jusqu'à la livraison Halloween                    |
| `raptoru-dock`           | `docs/handoff-2026-10-28`                | non (PR #34 ouverte)                                                   | non                                                       | actif jusqu'à la fusion de la PR #34                        |
| `raptoru-docs`           | `docs/workspace` (ce document)           | non                                                                    | non                                                       | worktree de documentation, à réutiliser                     |
| `raptoru-cicd`           | `ops/coolify-ports-closed`               | oui                                                                    | `vps-ports-commandes.txt`                                 | retirable après lecture de ce fichier                       |
| `raptoru-random-ban`     | `docs/rb-caution-test-live`              | oui                                                                    | `lab-rb3.cmd` (lanceur Lab)                               | retirable                                                   |
| `raptoru-roue-v2`        | `docs/stream-fixes-2b-live`              | oui                                                                    | `lab-v2.cmd` (Lab isolé, base Docker `raptoru-lab-v2-pg`) | retirable ; décider du conteneur Docker `raptoru-lab-v2-pg` |
| `raptoru-spotify`        | `feat/spotify-v2`                        | oui                                                                    | 2 restes de tests `.runtime-prod-transport-test-*`        | retirable                                                   |
| `raptoru-release`        | `chore/coolify-deploy` (locale)          | contenu identique dans `main` (`git cherry` : 3 commits déjà présents) | non                                                       | retirable ; BACKUPS § 3 (« unique copie ») est **dépassé**  |
| `raptoru-roue-v2-backup` | `backup/roue-v2-wip-2026-10-25` (locale) | non : **1 commit `99157a3` présent nulle part ailleurs**               | non                                                       | **à préserver** : archiver (bundle Git) avant tout retrait  |

### Worktrees Git hors Documents (risque de nettoyage automatique)

| Emplacement                                         | Worktrees                                                                           | État                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppData\Local\Temp\claude\…\c435dbde…\scratchpad\` | `deliv-wt`, `rb-wt`, `sb-wt`, `vk-wt`                                               | propres, fusionnés : retirables                                                                                                                                                                                                                                                                                       |
| idem                                                | `chat-wt` (21 modifiés), `sup-wt` (25), `wg-wt` (15), `solde-wt` (6), `node-wt` (2) | travail non commité, très probablement intégré depuis (lots livrés), **non prouvé fichier par fichier** ; instantané complet dans `Sauvegarde Raptoru 2.0\worktrees-2026-10-24\` (BACKUPS § 3), **vérifié identique à l'état actuel le 28/10** (empreinte du `git diff HEAD --binary` = patch sauvegardé, pour les 5) |
| `.claude\jobs\01d783c9\tmp\`                        | `sup10` (25 modifiés), `supcheck` (32)                                              | copies de vérification de builds (sup.10) faites par l'agent ; le dossier de job disparaîtra : à comparer à `sup-wt` puis retirer                                                                                                                                                                                     |

### Clones séparés (copies de build, pas des worktrees)

| Dossier  | Source                            | État                                                                                 | Contenu utile                                          |
| -------- | --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `rs017`  | le checkout principal @ `2d80c2a` | propre, commit contenu dans `main`                                                   | installateur 0.1.7 dans `apps\studio\desktop\release\` |
| `rs-sup` | `sup-wt` @ `2d80c2a`              | 37 modifications                                                                     | installateur 0.1.7-sup.2                               |
| `rs-vk`  | `vk-wt` @ `0f753c1`               | 43 modifications + **`stash@{0}` à ne pas supprimer** + dossier `GO\` (runbook, SQL) | installateurs sup.3 → sup.8                            |

### Paquets de livraison (« GO »)

`raptoru-pass2-GO`, `raptoru-roue-v2-GO`, `raptoru-spotify-GO`, `raptoru-studio-0.1.10-GO` … `0.1.15-GO` :
installateurs Studio, `latest.yml`, SQL et runbooks des livraisons du 24 au 27/10. Les installateurs officiels sont aussi
publiés sur GitHub (`raptoru-studio-releases`).

### Sauvegardes

- `Sauvegarde Raptoru 2.0\` (sauvegardes de référence : base de Production, données Studio, Roue V2, worktrees).
- `studio-backup-2026-10-2x-avant-sup3…sup10` (5), `backup-2026-10-24-avant-sup5…sup7` + `-w32time` (4),
  `obs-backup-2026-10-24-*` (9) : voir BACKUPS § 4, § 6, § 7 et la politique § 9.

### Hors Raptoru 2.0 (ne pas toucher dans le rangement 2.0)

- `Raptoru\` (1,4 Go) : l'ancien projet V1 (SAMMI, extension « canonical workspace »). Il contient **l'original du
  Chaos Overlay** (`Raptoru\Chaos-Overlay`) : référence historique, à conserver en l'état.
- `Raptoru-Secrets\` : secrets chiffrés (DPAPI), à conserver.
- `Stream PROJET\` : **originaux des médias** (dont Halloween), jamais déplacés.
- `SAMMI Extension\`, `Back up SAMMI\`, `ChatGPT\`, `Codex\`, `GitHub\` (vide) : historique ou autres outils.

## 3. Organisation cible

```
Documents\
  Raptoru 2.0\                 dépôt principal (main) + données du Studio installé — ne bouge jamais
  Raptoru 2.0 - Worktrees\     TOUS les worktrees temporaires : un sous-dossier par chantier (nom court de la branche)
  Raptoru 2.0 - Livraisons\    paquets GO : AAAA-MM-JJ-objet\ (installateurs, SQL, runbook, SHA256SUMS.txt)
  Sauvegarde Raptoru 2.0\      toutes les sauvegardes : AAAA-MM-JJ-objet\ (studio, obs, base, worktrees) + Archives\
  Raptoru-Secrets\             inchangé
  Raptoru\                     V1 historique, inchangé (lecture seule)
```

Les originaux du stream (`Stream PROJET\`, `Anim de stream\`) restent où ils sont : Raptoru les lit, il ne les déplace
pas.

## 4. Règles (aussi dans `CLAUDE.md`)

1. Un seul dépôt : jamais de nouveau clone de Raptoru 2.0. Un build ou une vérification se fait dans un worktree.
2. Un chantier = `git worktree add "..\Raptoru 2.0 - Worktrees\<nom>" -b <branche> origin/main`. Jamais à la racine de
   Documents, ni sous `AppData\Local\Temp`, ni dans un dossier de job ou de scratchpad d'un agent, ni dans
   `.claude\worktrees`.
3. Les paquets de livraison vont dans `Raptoru 2.0 - Livraisons\AAAA-MM-JJ-objet\`, les sauvegardes dans
   `Sauvegarde Raptoru 2.0\AAAA-MM-JJ-objet\`. Aucun dossier `*-GO`, `*-backup-*` ou `obs-backup-*` à la racine de
   Documents.
4. Les données de Studio (`.env`, jetons, `.runtime`, médias) n'existent que dans le checkout principal. Le `.runtime`
   d'un worktree est jetable. Les médias livrés passent par leur script d'import vers le checkout principal.
5. Un worktree se retire avec `git worktree remove`, et seulement s'il est fusionné, livré et propre. S'il reste du
   travail non commité, on l'archive d'abord (patch ou bundle dans `Sauvegarde`). On le déplace avec
   `git worktree move`. Jamais de `rm -rf`, jamais de déplacement à la main.
6. À chaque livraison, `docs/REPRISE.md` § 4 liste les worktrees encore ouverts et leur raison d'être.

## 5. Rangement contrôlé après Halloween (proposition, rien n'est fait)

Chaque étape demande l'accord d'Antoni. Les étapes vont de la moins risquée à la plus risquée.

1. **Après la livraison Halloween** :
   - copier les médias dans le Studio installé et dans `Sauvegarde` (§ 1) ;
   - fusionner la PR #35, puis retirer `raptoru-halloween` (`git worktree remove`).
2. **Créer** `Raptoru 2.0 - Worktrees\` et `Raptoru 2.0 - Livraisons\`.
3. **Worktrees fusionnés et propres** (aucune perte possible) : les retirer avec `git worktree remove`, puis lancer
   `git worktree prune`. Concerne `deliv-wt`, `rb-wt`, `sb-wt`, `vk-wt`, `raptoru-release`, `raptoru-docs` (une fois sa
   branche fusionnée), puis `raptoru-cicd`, `raptoru-random-ban`, `raptoru-roue-v2` et `raptoru-spotify`, après avoir
   lu leurs fichiers non suivis.
4. **Branche de sauvegarde Roue V2** :
   - `git bundle create "Sauvegarde Raptoru 2.0\Archives\roue-v2-wip-2026-10-25.bundle" backup/roue-v2-wip-2026-10-25` ;
   - vérifier avec `git bundle verify` ;
   - seulement ensuite, retirer le worktree `raptoru-roue-v2-backup`.
5. **Worktrees Temp avec travail non commité** (`chat-wt`, `sup-wt`, `wg-wt`, `solde-wt`, `node-wt`, `sup10`,
   `supcheck`) :
   - prouver, fichier par fichier, que chaque modification est dans `main` (sinon, en faire un patch daté dans
     `Sauvegarde`) ;
   - l'instantané du 24/10 reste la copie de secours ;
   - ensuite, `git worktree remove --force` (jamais avant la preuve).
6. **Clones de build** `rs017`, `rs-sup`, `rs-vk` :
   - archiver leurs installateurs utiles et le `GO\` de `rs-vk` dans `Livraisons\` ;
   - exporter le `stash@{0}` de `rs-vk` en patch dans `Sauvegarde` ;
   - puis archiver ou supprimer les clones, avec l'accord d'Antoni.
7. **Paquets `*-GO`** : déplacer vers `Raptoru 2.0 - Livraisons\AAAA-MM-JJ-…\`, sans rien supprimer. Les installateurs
   déjà publiés sur GitHub peuvent ensuite être éliminés selon BACKUPS § 9.
8. **Sauvegardes à la racine** (`studio-backup-*`, `backup-2026-10-24-*`, `obs-backup-*`) : les déplacer dans
   `Sauvegarde Raptoru 2.0\`, puis appliquer BACKUPS § 9.
9. **Checkout principal** : le mettre à jour sur `origin/main` en préservant les données de Studio et le correctif
   « écran gris » non commité (REPRISE § 5.5). C'est une étape à part, la plus délicate.

Copies devenues inutiles **une fois ces preuves faites** :

- les worktrees fusionnés (étape 3) ;
- `raptoru-release` ;
- `rs017` (après l'archivage de l'installateur 0.1.7) ;
- les worktrees Temp et de job (étape 5) ;
- les sauvegardes et installateurs déjà classés « supprimables » par BACKUPS § 9.

Le reste (V1, secrets, originaux, sauvegardes de référence) est conservé.
