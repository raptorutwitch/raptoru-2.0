# Sauvegardes — inventaire et récupération

Relevé du **24/10/2026 ~12:20**, complété le **24/10 ~13:30** par deux sauvegardes réellement faites (§ 1) ; aucune
sauvegarde restaurée ni supprimée.
Mettre à jour ce fichier à chaque nouvelle sauvegarde ou suppression. Procédures d'exploitation : [OPERATIONS.md](OPERATIONS.md).

Niveaux de confiance : **A** restauration démontrée · **B** intégrité vérifiée (patch qui s'applique, archive lisible,
exécution « success ») mais restauration jamais faite · **C** présence seulement · **—** sans objet.

## 1. Sauvegardes faites le 24/10 et risques encore ouverts

Dossiers créés dans `C:\Users\Antoni\Documents\Sauvegarde Raptoru 2.0\`, **hors du dépôt Git**, accès restreint à
Antoni + SYSTEM (héritage NTFS coupé : le dossier `Documents` donne aussi « Modifier » à `CodexSandboxUsers` et à un SID
inconnu). Ils contiennent des secrets et des données de Production : ne jamais les copier dans un dépôt.

**Restreindre l'accès (procédure corrigée le 25/10)** : sur le **dossier seul**, sans `/T` — les fichiers héritent :

```powershell
icacls "<dossier>" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" "SYSTEM:(OI)(CI)F"
```

Ne jamais combiner `/inheritance:r` et `/T` : chaque fichier perd ses droits hérités et reste sans aucun accès, même pour
Antoni (cas des sauvegardes `avant-sup9` et `avant-sup10`, réparé le 25/10 par `icacls "<dossier>\*" /reset /T`).
Contrôle après chaque sauvegarde : `python studio_backup.py verify` doit relire l'archive (pas seulement la lister).

Sauvegardes avant installation de Studio (accès Antoni + SYSTEM, relues le 25/10) : `studio-data-2026-10-24-avant-sup9`
(113/113 identiques au manifeste) et `studio-data-2026-10-25-avant-sup10` (115/115, SHA-256 de l'archive
`086d471ed6b6a8f3ed511e9fedba83dc6eaf58cb983e7f31233acb43f1a9d3bb` ; extraction complète testée dans un dossier vide :
115/115 identiques), plus les archives du profil `Documents\studio-backup-2026-10-2{4,5}-avant-sup{9,10}\` (lues
jusqu'au bout).

| Sauvegarde                                                                                                                                                                                             | Contenu                                                                                                                                                                                                                                                                                                        | Vérification                                                                                                                                                             | Confiance                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `studio-data-2026-10-24\studio-data.tar.gz` (27,6 Mo ; SHA-256 de l'archive `be564a666d4daa894dc44c09906980df2081232e4ec3d92e0f90b2304e0ff29b`) + `MANIFEST.json`, `RESTAURER.txt`, `studio_backup.py` | 113 fichiers : `apps/studio/server/.runtime/` entier, `apps/core-api/.env`, `apps/twitch-bot/.env*`, `.twitch-tokens*`, journaux et outbox du bot, `logs/`, `Backkup/`, documents privés, `.claude/settings.local.json`, `%APPDATA%\Raptoru Studio\{studio,obs-connection,se-connection}.json`, `~/.raptoru/*` | archive relue membre par membre : 113/113 identiques au manifeste (taille + SHA-256), 0 source modifiée pendant la copie ; `python studio_backup.py verify` la revérifie | **B** (jamais restaurée)       |
| `prod-db-2026-10-24\pg-dump-raptoru_prod-1792835783-oy8iwqxrerbpt6qe6vaapes3.dmp` (SHA-256 `fa3385771881b32ebe69dc65723ef0c61f9c2217256a769fcd69b66dbe62a852`) + `LISEZMOI.txt`                        | dump Coolify du 24/10 09:56:23 UTC (juste **avant** la migration `votekick_settings` de 09:57), téléchargé par Antoni depuis l'interface Coolify                                                                                                                                                               | taille identique à Coolify (2 058 761 octets) ; `pg_restore --list` (`postgres:17-alpine`, sans base) : 540 entrées, 104 tables avec données, aucune erreur              | **B** (format **A**, voir § 2) |

Risques encore ouverts :

| Risque                                                | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pas de sauvegarde **régulière** des données de Studio | la copie du 24/10 est ponctuelle ; jetons et `.runtime` changent à chaque live. Les données vivent **dans le checkout principal** `C:\Users\Antoni\Documents\Raptoru 2.0` (Studio installé l'utilise comme `dataRoot`, `%APPDATA%\Raptoru Studio\studio.json`) : un `git clean -x` ou une réinitialisation du checkout les efface. Les « sauvegardes Studio » du § 4 ne les contiennent pas. Refaire : relancer `studio_backup.py` après avoir changé la date du dossier dans le script. |
| Copie hors VPS **manuelle**                           | la seule copie récente est celle du 24/10 ; l'API Coolify ne permet pas de télécharger un dump (le jeton est renvoyé vers `/login`) et le PC n'a pas de clé SSH : chaque copie demande un clic « Download » d'Antoni dans Coolify. Pas de S3.                                                                                                                                                                                                                                            |
| Restauration régulière de la base                     | démontrée **une seule fois** (20/10 : dump de 13:57 UTC restauré sans erreur dans une base jetable, `HANDOFF_MIGRATION_2026-10-20.md` § 4, document privé) ; jamais refaite depuis. `RAPTORU_POST_MIGRATION_TRUTH_2026-10-23.md` § 7 la note « jamais testée » : contradiction, l'essai du 20/10 fait foi pour le format.                                                                                                                                                                |

Propositions (accord d'Antoni requis) : voir [REPRISE.md](REPRISE.md) « Actions en attente d'accord ».

## 2. Base de Production (Coolify)

| Élément         | Valeur                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base            | `raptoru-prod-postgres` (`4jaqdyvzlelgwkyvuxhjy4mr`), base `raptoru_prod`                                                                                                                                                                                                                                                                                                                                                                           |
| Configuration   | `ha3t1pu8q83re2gjvg5wetbu` : quotidienne `0 4 * * *` (04:00 UTC), activée, **stockage local seulement** (`save_s3: false`), rétention **14 copies**                                                                                                                                                                                                                                                                                                 |
| Exécutions      | 14 conservées, 14 « success », 0 échec ; la plus ancienne 20/10 03:54, la plus récente **24/10 09:56:23 UTC** (2 058 761 octets, « Backup now » avant la migration `votekick_settings`)                                                                                                                                                                                                                                                             |
| Confiance       | **B** pour les dumps conservés (statut « success » + taille cohérente) ; le **format** est **A** : un dump Coolify (`.dmp`, `pg_dump` custom) du 20/10 a été restauré sans erreur en base jetable                                                                                                                                                                                                                                                   |
| Copies hors VPS | **24/10 09:56 UTC** : `Documents\Sauvegarde Raptoru 2.0\prod-db-2026-10-24\` (§ 1, la plus récente). Anciennes, antérieures à l'import économique (preuves, pas un état utilisable) : `C:\Users\Antoni\Downloads\pg-dump-raptoru_prod-1792504648-…dmp` (20/10 13:57 UTC) et `Raptoru 2.0\Backkup\pg-dump-raptoru_prod-1792510159-…dmp` (20/10 15:29 UTC), toutes deux lisibles par `pg_restore --list` (97 tables, aucune erreur, vérifié le 24/10) |
| Copier          | Coolify → `raptoru-prod-postgres` → Backups → Download (session web d'Antoni), puis ranger le fichier dans un dossier restreint et le vérifier (`pg_restore --list`, taille = Coolify) ; le navigateur a enregistré celui du 24/10 à la racine du checkout : toujours le sortir du dépôt                                                                                                                                                            |
| Déclencher      | API `PATCH /api/v1/databases/<base>/backups/<config>` `{"backup_now":true}` ou Coolify → base → Backups → Backup now ; le script de déploiement exige une sauvegarde < 60 min avant toute migration                                                                                                                                                                                                                                                 |

Staging (`raptoru-core-staging`) : base distincte, pas d'inventaire de sauvegarde fait.

### Preuves et exports privés de la migration (20/10)

`C:\Users\Antoni\Documents\Raptoru\_migration-exports\` (72 Mo, dernière écriture 23/10) : exports StreamElements et
legacy, preuves du gel, manifestes d'ouverture, outils de bascule, `production\core.env`, un jeton. **Contient des
secrets : ne jamais committer ni copier dans le dépôt.** Décrit par `docs/ECONOMY_MIGRATION.md` et par le document privé
`docs/HANDOFF_MIGRATION_2026-10-20.md` (checkout principal, non suivi, à ne jamais committer).

## 3. Travail non commité (Git)

| Élément                  | Emplacement                                                                                      | Date        | Contenu                                                                                                                                                                                                                                                                                       | Confiance                                                                                                                                            | Remarque                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instantané des worktrees | `C:\Users\Antoni\Documents\Sauvegarde Raptoru 2.0\worktrees-2026-10-24\`                         | 24/10 12:15 | pour chacun de `chat-wt`, `sup-wt`, `wg-wt`, `solde-wt`, `node-wt` et du checkout principal (Roue V2) : `<nom>.tracked.patch` (`git diff HEAD --binary`), `<nom>.untracked.txt` + `.tar` (fichiers non suivis, sans `.runtime-*`), `MANIFEST.txt` (commit de base, branche), `SHA256SUMS.txt` | **B** : chaque patch passe `git apply --check` sur son commit de base (index temporaire), archives listées ; toutes les bases sont sur `origin/main` | fait parce que 5 worktrees sont sous `AppData\Local\Temp` et que **l'Assistant de stockage Windows (nettoyage des fichiers temporaires) est activé** |
| Stash `rs-vk`            | `C:\Users\Antoni\Documents\rs-vk`, `stash@{0}` « sup-wt patch (sup.7 build) on 9563e20 »         | 24/10 11:3x | patch supervision (`sup-wt`) tel qu'utilisé pour sup.7 ; le même patch est aussi appliqué (non commité) dans l'arbre de `rs-vk` (build sup.8)                                                                                                                                                 | **B** (réappliqué avec succès pour sup.8)                                                                                                            | ne pas `git stash drop`                                                                                                                              |
| Copie du patch sup-wt    | `C:\Users\Antoni\.claude\jobs\01d783c9\tmp\rsvk\sup-patch-on-9563e20.diff`                       | 24/10       | idem                                                                                                                                                                                                                                                                                          | C                                                                                                                                                    | **éphémère** (dossier de job Claude) ; la copie durable est le stash + l'instantané ci-dessus                                                        |
| Script de déploiement    | worktree `C:\Users\Antoni\Documents\raptoru-release`, branche `chore/coolify-deploy` @ `80f3525` | 23/10       | `scripts/coolify-deploy.mjs` (+ tests)                                                                                                                                                                                                                                                        | C                                                                                                                                                    | commits locaux, mais **contenu identique dans `main`** (PR #1 ; `git cherry` du 28/10) : plus une copie unique                                       |

Restaurer un instantané : sur un worktree propre au commit de base du `MANIFEST.txt` : `git apply --index <nom>.tracked.patch`
puis `tar -xf <nom>.untracked.tar`.

## 4. Studio (profil Electron)

Contenu : profil Chromium/Electron (`%APPDATA%\Raptoru Studio` : `studio.json`, `obs-connection.json`,
`se-connection.json`, Local Storage, journaux, caches) et `%APPDATA%\@raptoru`. **Pas** les données de travail (§ 1).

| Dossier (`C:\Users\Antoni\Documents\…`)            | Date                        | Taille  | Contenu                                                                                        | Confiance            |
| -------------------------------------------------- | --------------------------- | ------- | ---------------------------------------------------------------------------------------------- | -------------------- |
| `studio-backup-2026-10-23-avant-sup3`              | 23/10 18:29                 | 0,5 Mo  | `roaming-raptoru-studio.tar` (sans caches)                                                     | C                    |
| `studio-backup-2026-10-24-avant-sup4`              | 24/10 01:19                 | 0,5 Mo  | idem                                                                                           | C                    |
| `backup-2026-10-24-avant-sup5` · `-sup6` · `-sup7` | 24/10 02:53 · 10:01 · 10:32 | ~0,9 Mo | tar Roaming + collection OBS + filtres OBS (avant / après)                                     | C                    |
| `studio-backup-2026-10-24-avant-sup8`              | 24/10 11:45                 | 129 Mo  | `raptoru-studio.tar` (avec caches ; `Network/Cookies` verrouillé non copié) + `at-raptoru.tar` | C (archives listées) |
| `Sauvegarde Raptoru 2.0\Raptoru Studio`            | 23/10 12:03                 | 112 Mo  | copie brute du profil Roaming                                                                  | C                    |

Restauration démontrée : aucune (les installations sup.3→sup.8 ont conservé le profil sans y recourir).

## 5. Installateurs Studio

| Version                 | Emplacement                                                                              | Date          | Base                       | Remarque                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.1 → **0.1.6**       | GitHub `raptorutwitch/raptoru-studio-releases` (releases publiques, flux de mise à jour) | 26/09 → 20/10 | —                          | 0.1.6 = dernière release officielle                                                                                                               |
| 0.1.6                   | `Raptoru 2.0\apps\studio\desktop\release\`                                               | 20/10         | —                          | copie locale                                                                                                                                      |
| 0.1.7                   | `rs017\apps\studio\desktop\release\`                                                     | 22/10         | `2d80c2a`                  | candidat non publié                                                                                                                               |
| 0.1.7-sup.2             | `rs-sup\apps\studio\desktop\release\`                                                    | 23/10         | `2d80c2a` + sup-wt         | build local                                                                                                                                       |
| 0.1.7-sup.3 → **sup.8** | `rs-vk\apps\studio\desktop\release\`                                                     | 23/10 → 24/10 | sup.8 = `0f753c1` + sup-wt | **sup.8 installé** (SHA-256 `9d01aca621e6dfab223e2f3a069a3cbaf8f81ae5c879cfb97797facc359f414c`) ; sommes des précédents dans l'archive de REPRISE |

Retour arrière Studio : réinstaller l'installateur précédent (`/S`), le profil et les données de travail sont conservés
par l'installateur NSIS. Confiance : A pour l'installation par-dessus (faite 6 fois le 23–24/10), retour arrière jamais fait.

## 6. OBS

| Élément                        | Emplacement                                                                                                     | Date         | Contenu                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| Collection active              | `%APPDATA%\obs-studio\basic\scenes\Twitch_Dofus.codex-backup-20260919-144407.json` (+ `.bak` automatique d'OBS) | 24/10        | **c'est la collection en service malgré son nom** : ne pas supprimer |
| Anciennes collections / `.bak` | même dossier (`Twitch_Dofus.json*`, `24_Halloween…`)                                                            | 2024–09/2026 | historiques OBS                                                      |
| Référence zoom fonctionnel     | `Documents\obs-backup-2026-10-24-zoom-reference\`                                                               | 24/10 02:19  | collection + `filters-reference.json`                                |
| Diagnostic zoom                | `Documents\obs-backup-2026-10-24-zoom\`, `-zoom-works\`                                                         | 24/10        | filtres avant/après ×5, collection                                   |
| Tests de mute                  | `Documents\obs-backup-2026-10-24-mute-test*` (5 dossiers)                                                       | 24/10        | état avant/après de chaque test (identiques au repos)                |
| Plugin Move Transition 3.1.1   | `Documents\obs-backup-2026-10-24-move-3.1.1\`                                                                   | 24/10 01:57  | DLL 3.1.1 + config OBS avant la mise à jour 3.2.1                    |

État OBS de référence au repos (24/10 11:50) : « Micro » non muté, « Votekick Zoom Drive » de « Micro » désactivé
(facteur 0,8), « Votekick Zoom » désactivé (`zoom` 1,000001, `zoom_max` 1,101), « Votekick Mute » désactivé
(`mute_duration` 110), drive de « Micro (Obsolète) » désactivé. Confiance : C (aucune restauration de collection faite).

## 7. Poste Windows

| Élément       | Emplacement                            | Contenu                                                                                            |
| ------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Temps Windows | `Documents\backup-2026-10-24-w32time\` | `w32time-before.reg`, `w32time-after.reg`, `sc-qc-before.txt` (avant/après la correction du 24/10) |

## 8. Hors projet (ne pas confondre)

- `Documents\Back up SAMMI\` (05/2026) : exports de decks SAMMI — **SAMMI est abandonné**, référence de comportement
  historique seulement.
- `Documents\Save backup\` : sauvegarde de jeu (2022), sans rapport.
- `Documents\Raptoru 2.0` : à la fois checkout Git principal **et** dossier de données de Studio (§ 1).

## 9. Politique de conservation proposée (non appliquée)

- Garder : la dernière sauvegarde Studio avant chaque installation (aujourd'hui `avant-sup8`), les 2 derniers
  installateurs installés (sup.7, sup.8) + 0.1.6, la référence OBS `zoom-reference`, l'instantané des worktrees jusqu'au
  commit ou à l'abandon de chaque chantier.
- Supprimables après accord : `studio-backup-…-sup3/sup4`, `backup-…-sup5/sup6`, installateurs sup.2→sup.6, dossiers
  `obs-backup-…-mute-test*` et `-zoom` (diagnostic clos).
- Garder aussi : `studio-data-2026-10-24` et `prod-db-2026-10-24` (§ 1) jusqu'à leur remplacement par plus récent.
- À organiser (accord requis) : rythme des copies hors VPS (par exemple chaque semaine et avant toute migration) ou
  stockage S3 dans Coolify ; sauvegarde régulière des données de travail de Studio (§ 1) ; nouveau test de restauration
  de la base dans une base jetable.
