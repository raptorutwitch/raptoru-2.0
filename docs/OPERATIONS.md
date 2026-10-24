# Opérations — procédures utilisées

Procédures réellement employées jusqu'au **24/10/2026**. Commandes de développement détaillées : [README](../README.md).
Sauvegardes : [BACKUPS.md](BACKUPS.md). Architecture : [ARCHITECTURE.md](ARCHITECTURE.md).

> Toute action qui touche la Production (push, déploiement, migration, flag, variable, redémarrage, installation
> Studio, OBS, Wallet, sanction hors test consenti) exige le **GO explicite d'Antoni**, pour cette action précise.

## 1. Secrets et emplacements (ne jamais afficher un secret)

| Élément                                                                               | Emplacement                                                                      |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Jeton API Coolify (`raptoru-deploy-automation` : read, read:sensitive, write, deploy) | `~/.raptoru/coolify-token.txt`                                                   |
| Mot de passe OBS WebSocket                                                            | `~/.raptoru/obs-ws-password.txt`                                                 |
| Journal des déploiements                                                              | `~/.raptoru/deploy-journal.log`                                                  |
| `.env` locaux, jetons Twitch du PC, données Studio                                    | checkout principal (dossier de données de Studio) : [BACKUPS.md](BACKUPS.md) § 1 |
| Exports privés de la migration                                                        | `C:\Users\Antoni\Documents\Raptoru\_migration-exports\`                          |

Coolify 4.4.7 : `http://62.84.187.170:8000`. Applications : `raptoru-core` `3m7cputub9wt7nwx2k78cme3`, `raptoru-bot`
`hdbljqmwoq5364w0ypqmz46p`, `raptoru-core-staging` `leadrn7q8x0efkc9u6nxtdic` ; base `4jaqdyvzlelgwkyvuxhjy4mr`.
**Auto Deploy désactivé** (vérifié le 24/10) : un push ne déploie rien.

## 2. Développement et tests

- Installation, développement, contrôle complet : `npm install`, `npm run dev`, `npm run check` (lint, format,
  typage, tests, build). Lab complet (Core local + simulateurs) : `npm run studio` (Studio en profil Lab).
- Suites par paquet : `npm test` dans `apps/core-api` (`--maxWorkers=4`) et `apps/studio/server` (`--maxWorkers=2`) ;
  lancer sans ces limites sature PGlite (faux échecs par délai dépassé).
- PostgreSQL réel (concurrence, verrous) : base jetable `TEST_DATABASE_URL=postgres://…@127.0.0.1:…/<nom contenant test>`
  (la base est vidée), par exemple un conteneur `postgres:17-alpine` dédié ; liste : script `test:integration` de
  `apps/core-api/package.json`.
- E2E navigateur : `npm run e2e` (pile isolée, port 4399).
- Pendant le développement : typage et tests ciblés ; avant livraison : suites globales, intégration, lint, build.
- Échecs intermittents connus sous charge (relancer seuls) : crash Windows vitest `0xC0000409`, Studio `brb`,
  `alerts-twitch-chain`, `creepy`, `word-game-service`, `bonk-lab`, `sub-wheel` « bad port », `random-ban` (délai).

## 3. Déployer le Core ou le bot (Coolify)

Outil : `C:\Users\Antoni\Documents\raptoru-release` (worktree, branche `chore/coolify-deploy` @ `80f3525`, **non
poussée**), `node scripts/coolify-deploy.mjs` (Node seul, sans dépendance).

1. Le SHA cible doit être sur `origin/main` (pousser d'abord, sur GO).
2. `node scripts/coolify-deploy.mjs plan core <sha40>` : lecture seule (commit déployé, fichiers, migrations de
   Production sélectionnées, fichiers lus par le bot, dernière sauvegarde) → verdict PRÊT / BLOQUÉ.
3. Migration présente : sauvegarde de la base < 60 min (« Backup now », [BACKUPS.md](BACKUPS.md) § 2), puis
   `--migrations-approved` (le Core applique la migration en post-déploiement ; le script lit les journaux et vérifie
   `applied:`), ou `--migrations-preapplied` (SQL appliqué à la main → conformité du schéma vérifiée sur la vraie base,
   puis enregistrement).
4. `… deploy core <sha40>` sans `--go` = simulation ; avec `--go` après le GO : suit le déploiement, vérifie le
   commit, `running:healthy`, `/health`, `/ready` → DÉPLOYÉ / ÉCHEC / BLOQUÉ et affiche la commande de retour.
5. Bot : seulement une fois le Core sur le SHA cible ; jamais en même temps que le Core ; jamais deux bots (bail).
6. Après : `… status core|bot`, supervision Studio verte, état du module concerné (sans action réelle).

Exemple réel (24/10) : sauvegarde 09:56 UTC → `plan core 0f753c1… --migrations-approved` PRÊT →
`deploy core 0f753c1… --migrations-approved --go` → `applied: 20261107130000_votekick_settings.sql`, 101 s.

## 4. Retour arrière

| Quoi            | Comment                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code Core / bot | `node scripts/coolify-deploy.mjs deploy core <sha précédent> --rollback --go` (idem avec `bot`) ; les migrations ne sont jamais annulées (additives, ignorées par l'ancien code)      |
| Une fonction    | ses deux flags (Core + bot, ex. `CAUTION_CHAT` / `CAUTION`, `VOTEKICK_CHAT` / `VOTEKICK`) à `false` dans Coolify, puis redémarrage Core et bot (~2 min chacun, bot ~75 s sans Twitch) |
| Bot VPS → PC    | [BOT_VPS_CUTOVER.md](BOT_VPS_CUTOVER.md) § 10 (stop Coolify, récupérer les jetons de `/data`, `run-production.ps1`)                                                                   |
| Base            | restaurer un dump Coolify dans une base (jamais sur la Production sans décision) ; format démontré le 20/10                                                                           |
| Studio          | réinstaller l'installateur précédent ([BACKUPS.md](BACKUPS.md) § 5)                                                                                                                   |

Variables de Production notables : Core `CAUTION_CHAT=true`, `VOTEKICK_CHAT=true` ; bot `CAUTION=true`,
`VOTEKICK=true`, `CAUTION_JOURNAL_FILE=/data/.caution-journal.json`, `VOTEKICK_JOURNAL_FILE=/data/.votekick-journal.json`
(posées par variables tant que l'image du bot n'inclut pas `cf21c4b`).

## 5. Studio

### Release officielle (`npm run studio:release`)

Pipeline et règles : [README](../README.md) « Studio releases ». Publie sur `raptorutwitch/raptoru-studio-releases`
(dernière : **0.1.6**, 20/10). Depuis le 21/10 (CLAUDE.md) : commit, push et release **seulement sur demande explicite
d'Antoni** ; un lot « validé en local » ne suffit pas. Exige `main` propre : impossible tant que le checkout principal
porte la Roue V2 non commitée.

### Build local de test (`0.1.7-sup.N`, utilisé du 23 au 24/10)

Clone de build `C:\Users\Antoni\Documents\rs-vk` (porte le patch `sup-wt` non commité ; remote = `vk-wt`, push désactivé) :

1. `git fetch origin <branche>` ; mettre le patch de côté (`git stash push`), `git checkout --detach <sha>`,
   `git stash apply` (fusion à 3 voies ; garder la stash comme copie de secours) ;
2. `npm run build` ; `cd apps/studio/desktop && node scripts/stage.mjs` ;
3. version `0.1.7-sup.N` dans `stage/app/package.json` et `stage/app/build-info.json` (build local, jamais publié) ;
4. `npx electron-builder --config electron-builder.json --win --x64 --publish never` → `release\Raptoru Studio Setup 0.1.7-sup.N.exe` ;
5. sur GO : vérifier qu'OBS n'est ni en live ni en enregistrement et qu'aucun vote / mute n'est en cours ; sauvegarder
   `%APPDATA%\Raptoru Studio` et `%APPDATA%\@raptoru` (tar dans `Documents\studio-backup-<date>-avant-supN\`) ;
   installer en silence (`Setup.exe /S`) ; relancer Studio ;
6. vérifier : `build-info.json` installé, `/api/supervision`, `/api/votekick/state`, état OBS au repos ([BACKUPS.md](BACKUPS.md) § 6).

## 6. Vérifications sans effet (lecture seule)

- Core : `https://core.raptoru.fr/health` et `/ready` ; `coolify-deploy.mjs status core|bot|core-staging`.
- Studio (en-tête `x-raptoru-studio: 1`, `127.0.0.1:4100`) : `/api/supervision`, `/api/control/status`,
  `/api/votekick/state`, `/api/votekick/settings`, `/api/caution/state`.
- OBS (obs-websocket, mot de passe ci-dessus) : `GetStreamStatus`, `GetRecordStatus`, filtres de « Micro » et de
  « overlay cam shushu » (état de référence : [BACKUPS.md](BACKUPS.md) § 6).
- Horloge : `w32tm /query /status` (synchronisation horaire attendue depuis le 24/10).

## 7. Extension Twitch

`npm run build -w @raptoru/twitch-extension` → `dist/` = paquet à téléverser ; publication **manuelle par Antoni**
dans la console Twitch (Hosted Test puis Release). Version réellement servie : à lire dans la console (non vérifiable
depuis le dépôt). Détails : `apps/twitch-extension/README.md`.
