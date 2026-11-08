# Reprise : point d'entrée pour un agent (Claude, Codex ou autre)

**Mis à jour le 08/11/2026** (consolidation générale). À lire **en premier**, puis vérifier soi-même l'état (§ 4).

- La période précédente (04 → 07/11) est archivée dans [archive/REPRISE_2026-11-04_2026-11-07.md](archive/REPRISE_2026-11-04_2026-11-07.md).
- Les règles complètes sont dans [`../CLAUDE.md`](../CLAUDE.md) : elles priment sur tout outil ou plugin.

## 1. Le projet en dix lignes

- **Raptoru 2.0** : la plateforme de stream auto-hébergée du streamer Twitch `raptoru_` (identifiant 83603689).
  Antoni est l'unique décideur.
- **Le Core décide, le bot parle à Twitch, Studio pilote OBS et affiche, l'extension et le site parlent aux viewers.**

| Composant                    | Code                                                  | Technologie                            | Où il tourne         |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------- | -------------------- |
| Core API                     | `apps/core-api`                                       | Node, Fastify, PostgreSQL 17           | Coolify (VPS)        |
| Bot `LeCroupier_`            | `apps/twitch-bot`                                     | EventSub, chat                         | Coolify (VPS)        |
| Raptoru Studio « Coulisses » | `apps/studio/{desktop,server,web}`                    | Electron                               | PC d'Antoni          |
| Extension Twitch             | `apps/twitch-extension`                               | HTML, CSS et JavaScript sans framework | hébergée par Twitch  |
| Contrats partagés            | `packages/schemas`                                    | Zod                                    | —                    |
| Schéma SQL                   | `supabase/migrations`                                 | SQL                                    | appliqué par le Core |
| Site raptoru.fr              | dépôt séparé `raptorutwitch/Leaderboard-Jeu-des-mots` | —                                      | —                    |

**Monorepo** npm workspaces + turbo.

**Environnements**

- **Production** : Core, bot et base sur le VPS ; Studio installé sur le PC.
- **Lab** : Core local réel, avec sa base Docker et le dossier `%APPDATA%\Raptoru Studio Lab` ; jamais la Production.
- **staging** : `core-staging.raptoru.fr`.

État détaillé, versions, tests et problèmes ouverts : **[PROJECT_STATUS.md](PROJECT_STATUS.md)**.
Roadmap : [ROADMAP.md](ROADMAP.md). Index : [README.md](README.md).

## 2. Limites d'autonomie : ce qu'on ne fait jamais sans GO explicite d'Antoni

**Production, Twitch et OBS**

- Push, fusion dans `main`, déploiement Coolify, migration distante, drapeau ou variable, redémarrage d'un service.
- Release ou installation de Studio. `npm run studio:release` seulement quand Antoni le demande.
- Publication de l'extension, Hosted Test sur un compte réel, modification de la console Twitch.
- Toute action sur OBS, Twitch, StreamElements ou le Wallet : soldes, crédits, débits, remboursements, sanctions.
  Les messages dans le vrai chat aussi.

**Destruction**

- `git clean`, `reset --hard`, `checkout .` ou `-f`, réécriture d'historique, suppression de branche ou de worktree.
- Suppression de sauvegardes, de médias ou de données de Studio.

**Contenu et sécurité**

- Créer du contenu métier à sa place : défis, montants, récompenses, objets, cosmétiques.
- Le dépôt est **public** : aucun secret, `.env`, jeton, dump, journal ni donnée de viewer dans un fichier commité,
  un rapport ou une réponse ([../SECURITY.md](../SECURITY.md)).
- Ne jamais committer `docs/HANDOFF_MIGRATION_2026-10-20.md` ni `docs/POST_LIVE_AUDIT_2026-10-20.md`.

**Méthode attendue (08/11)**

- Pour un lot autorisé : travailler en autonomie (décisions techniques ordinaires, corrections, tests, commits locaux,
  journal), puis rendre un livrable testable.
- Interrompre Antoni seulement pour :
  - une décision métier ou artistique ;
  - un blocage insoluble ;
  - une action de Production ;
  - une action destructrice.
- « **Validé** » = testé à la main par Antoni. Un test automatique n'est jamais une validation.

## 3. Où travailler sans rien casser

**Checkout principal** `C:\Users\Antoni\Documents\Raptoru 2.0`

- C'est le **dossier de données du Studio installé** (`.env`, jetons Twitch, `apps/studio/server/.runtime`).
- Il est sur `main` local, **429 commits derrière** `origin/main`, avec du travail non commité.
- On n'y travaille pas ; on ne le nettoie pas.
- Pour lire un document à jour depuis là : `git show origin/main:<chemin>`.
- Sa mise à jour demande un GO et une sauvegarde des données de Studio.
- Conseil : retirer d'abord les copies non suivies qui bloqueraient la mise à jour, par exemple un ancien `docs/REPRISE.md`.

**Nouveaux worktrees**

- **Uniquement** dans `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\<nom>`.
- Partir de `origin/main`, ou de la branche du chantier.

**À préserver absolument** (branches et worktrees)

| Branche                                                                    | Worktree                           | Pourquoi                                              |
| -------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `feat/extension-next`                                                      | `…Worktrees\extension-next`        | **Extension Next, seule copie** : locale, non poussée |
| `docs/consolidation-2026-11`                                               | `…Worktrees\consolidation`         | cette documentation                                   |
| `docs/extension-audit`                                                     | `…Worktrees\studio-ux`             | base des deux branches précédentes                    |
| `backup/roue-v2-wip-2026-10-25` (`99157a3`)                                | `Documents\raptoru-roue-v2-backup` | sauvegarde, aussi conservée en bundle                 |
| `feat/studio-viewer-titles`, `feat/level-up-v2`, `feat/halloween-cauldron` | —                                  | PR non fusionnées                                     |

Les anciens worktrees sont listés, sans aucune suppression, dans [CLEANUP_LATER.md](CLEANUP_LATER.md).

**Sauvegardes** : `C:\Users\Antoni\Documents\Sauvegarde Raptoru 2.0\`, à accès restreint. Ne jamais les déplacer ni les supprimer.

**Ports réservés au Studio installé** : 4100 (serveur), 4110 (Dock), 3789. Les tests utilisent 4389–4399 (E2E) et
4471–4482 (banc de l'extension).

## 4. Vérifier l'état soi-même (lecture seule)

```sh
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" fetch origin
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" log --oneline -5 origin/main
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" worktree list

# Depuis un worktree à jour. L'ancienne adresse coolify.raptoru.fr répond 502.
export COOLIFY_URL=https://dashboard.raptoru.fr
node scripts/coolify-deploy.mjs status core     # SHA déployé, santé, sauvegarde, commit vu par le Core, bail du bot
node scripts/coolify-deploy.mjs status bot
curl -s https://raptoru.fr/api/status           # build du site

# Studio installé
cat "$LOCALAPPDATA/Programs/Raptoru Studio/resources/app/build-info.json"
```

La version de l'extension **servie par Twitch** ne se lit pas d'ici. Il faut la console Twitch, ou sur
twitch.tv/raptoru_ : F12 › Sources › `shared/runtime-config.js` › `buildId`.

**Relevé du 08/11**

- Core et bot `1b25f30`, sains, bail actif.
- Studio 0.1.27, construit depuis `13ed6e8`.
- Site `74f7542`.
- `origin/main` `13ed6e8`.

## 5. Situation au 08/11

**En Production**

- Opération Coulisses (07/11) : Core et bot `1b25f30`, 5 migrations ; Studio 0.1.26, puis 0.1.27.
- Les modules déjà en service : liste dans [ROADMAP.md](ROADMAP.md) § 1.

**Extension Next**

- **Développé, non livré.**
- Branche `feat/extension-next`, commit de tête `38323bb`, basée sur `3834d6b` = `origin/main` + 4 commits de documents d'audit.
- Recette visuelle d'Antoni en Lab : retour très positif (08/11).
- Ses documents de travail sont **sur la branche** :
  - `docs/extension/EXTENSION_NEXT_EXECUTION_STATE.md` : journal de reprise ;
  - `docs/extension/SOCLE.md` : guide développeur ;
  - `docs/extension/EXTENSION_NEXT_PUBLICATION.md` : Hosted Test, publication, retour arrière.
- Pour les lire sans changer de branche :
  `git show feat/extension-next:docs/extension/EXTENSION_NEXT_EXECUTION_STATE.md`.
- L'audit et le plan sont aussi dans cette branche-ci : [extension/](extension/PLAN_REFONTE_EXTENSION_2026-11-08.md).

**Comparer les shells legacy et v2 dans le Lab**

- Double-cliquer `…Worktrees\extension-next\apps\twitch-extension\Comparer legacy et v2.cmd`, ou lancer `npm run lab:compare` dans ce dossier.
- Une page s'ouvre sur `127.0.0.1:4480`, legacy à gauche, v2 à droite : 18 tailles, 8 écrans, données fictives.
- Aucun service n'est appelé.
- Autre option : le Studio de développement avec `RAPTORU_EXT_SHELL=v2`, ou `?shell=v2` sur une page de l'extension servie par le Lab.

**Builds sûrs de l'extension**

- Sur `main` : seul `npm run build:production -w @raptoru/twitch-extension` vise le bon serveur
  (`core.raptoru.fr/v1/ext`). Ne jamais utiliser `npm run build`, qui emballe l'ancien `raptoru.fr/api`.
- Sur `feat/extension-next` : `node scripts/package.mjs --target production|staging|calibration [--shell v2] [--check]`.
  La Production y est refusée sans inventaire validé par Antoni ; `npm run build` n'emballe plus rien.
- Aucun emballage n'est une publication.

**Builds sûrs de Studio**

- Développement : `npm run studio`.
- Lab : `npm run studio:lab`.
- Release : `npm run studio:release`, **seulement sur demande d'Antoni**.
- Le numéro de version des `package.json` du dépôt (0.1.6) n'est pas celui des releases : c'est l'étiquette `studio-v*` qui fait foi.

## 6. Prochain travail réalisable

1. **Extension Next vers la publication** ([ROADMAP.md](ROADMAP.md) § 2.1).
   Côté agent : les restes non bloquants, ou ce qu'Antoni relève en recette.
   Côté Antoni : push et fusion, preuve de la version servie, inventaire, Hosted Test, soumission.
2. Puis **une passe « expérience » sur des modules existants**, et la **Roulette visuelle** ([ROADMAP.md](ROADMAP.md) § 4).
3. **Avant toute publication de l'extension**, il faut :
   - la version servie prouvée ;
   - l'inventaire validé par Antoni ;
   - un Hosted Test réussi sur vrais appareils ;
   - le GO explicite.

## 7. Si on change de modèle demain

1. Lire ce fichier en entier, puis [../CLAUDE.md](../CLAUDE.md) (règles), puis [PROJECT_STATUS.md](PROJECT_STATUS.md)
   (état), puis [ROADMAP.md](ROADMAP.md) (§ 2 et § 4).
2. Lancer les commandes du § 4 et comparer avec le relevé du 08/11. **Un écart veut dire que quelqu'un a agi depuis** :
   le comprendre avant d'agir.
3. Selon le chantier :
   - extension : lire le journal de la branche (§ 5) et `SOCLE.md` ;
   - Studio : [studio-refonte/CONTEXTE.md](studio-refonte/CONTEXTE.md), puis
     [DESIGN_SYSTEM.md](studio-refonte/DESIGN_SYSTEM.md) et [architecture/GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md) ;
   - un module : son document, listé dans [ARCHITECTURE.md](ARCHITECTURE.md) § 5.
4. Créer un worktree dans `…Worktrees\` et ne jamais toucher le checkout principal.
5. Tenir un journal de reprise du chantier (modèle : `EXTENSION_NEXT_EXECUTION_STATE.md`).
6. Avant de s'arrêter : mettre à jour **ce fichier**, court. Le détail daté va dans `archive/`.
