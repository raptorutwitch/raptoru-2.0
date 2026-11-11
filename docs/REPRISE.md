# Reprise : point d'entrée pour un agent (Claude, Codex ou autre)

**Mis à jour le 11/11/2026** (passe post-live). À lire **en premier**, puis vérifier l'état soi-même (§ 4). Période
précédente : [archive/REPRISE_2026-11-08_2026-11-10.md](archive/REPRISE_2026-11-08_2026-11-10.md). Les règles de
[`../CLAUDE.md`](../CLAUDE.md) priment sur tout outil ou plugin.

## 0. Résumé compact, à copier dans une nouvelle conversation

```text
Raptoru 2.0 — reprise au 10/11/2026 (source : docs/REPRISE.md du dépôt raptorutwitch/raptoru-2.0)

Projet : plateforme de stream auto-hébergée du streamer Twitch raptoru_ (id 83603689). Antoni décide seul.
Règle de partage : le Core décide (données, Jetons, règles, files), le bot LeCroupier_ parle à Twitch (EventSub, chat),
Raptoru Studio (Electron, PC d'Antoni) pilote OBS et affiche les lecteurs, l'extension Twitch et raptoru.fr parlent
aux viewers. SAMMI abandonné (20/10). Dépôt public : aucun secret.

Production (relevée le 10/11) : Core bbce104 et bot 900637f sur Coolify (sains), Studio 0.1.29 installé (bbce104),
site 74f7542. origin/main = afe98cf.
Music Hub : livré, ouvert aux seuls testeurs (MUSIC_HUB_EXTENSION=testers) ; extension shell v2 en Hosted Test avec
le ZIP raptoru-live-PRODUCTION-bbce1048a078-depuis-0bf7907-72-commits-shell-v2.zip (SHA-256 80bdab00…f9f5b,
worktree music-finish). Extension publique : présumée 0bf7907 (legacy), jamais prouvée.
Music Hub : passe de finition et parcours viewer réels NON validés.
OBS 33.0.1 réparé (shaderfilter 2.6.1, Composite Blur et Advanced Masks 1.6.1, Image Reaction 1.4, DSK 0.4.1,
Move 3.2.1), SE.Live désactivé. URL des sources navigateur nettoyées des paramètres SE.Live (10/11, 17:06).

Prochain chantier : Chaos V2, en CONCEPTION (rien de construit) — docs/chaos/. Lot 0 = mesures PresentMon + couper les
fenêtres Halloween permanentes + choisir 59/165 Hz ; lot 1 = lecteur natif (WGC sans curseur), flip seul.

Interdit sans GO explicite d'Antoni : push, fusion, déploiement, release Studio, migration distante, variable,
publication ou Hosted Test Twitch, action sur OBS / Wallet / chat. Jamais git clean / reset --hard / checkout . dans
le checkout principal (c'est le dossier de données du Studio installé). Travailler dans
Documents\Raptoru 2.0 - Worktrees\<nom>. « Validé » = testé à la main par Antoni.

À lire avant de coder : docs/REPRISE.md, CLAUDE.md, docs/PROJECT_STATUS.md, docs/ROADMAP.md, puis le document du module.
```

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
| Site raptoru.fr              | dépôt séparé `raptorutwitch/Leaderboard-Jeu-des-mots` | —                                      | Coolify              |

Monorepo npm workspaces + turbo. Environnements : **Production** (VPS + PC), **Lab** (Core local réel, base Docker,
jamais la Production), **Hosted Test** (extension visible des seuls testeurs), **staging** (`core-staging.raptoru.fr`).

## 2. Limites d'autonomie : jamais sans GO explicite d'Antoni

**Production, Twitch et OBS** :

- push, fusion dans `main`, déploiement Coolify, migration distante, variable ou drapeau, redémarrage d'un service ;
- release ou installation de Studio ;
- publication de l'extension, Hosted Test, console Twitch ;
- toute action sur OBS (scènes, sources, plugins), Twitch, StreamElements, Spotify ou le Wallet : soldes, crédits,
  débits, remboursements, sanctions, messages dans le vrai chat.

**Destruction** :

- `git clean`, `reset --hard`, `checkout .` ou `-f`, réécriture d'historique ;
- suppression de branche, de worktree, de sauvegarde, de média ou de données de Studio.

**Contenu et sécurité** :

- ne pas créer de contenu métier à la place d'Antoni : défis, montants, récompenses, cosmétiques ;
- dépôt **public** : aucun secret, `.env`, jeton, dump, journal ni donnée de viewer, y compris les clés des URL de
  sources OBS ([../SECURITY.md](../SECURITY.md)).

**Méthode** :

- lots verticaux en autonomie, puis un livrable testable ;
- interrompre Antoni seulement pour une décision métier, un blocage, la Production ou une action destructrice ;
- « **Validé** » = testé à la main par Antoni.

Registre des décisions et de leurs raisons : [DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md).

## 3. Où travailler sans rien casser

**Checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0`**

- C'est le **dossier de données du Studio installé** : `.env`, jetons Twitch, `apps/studio/server/.runtime`.
- Il est sur `main` local `11ffe3f`, **523 commits derrière** `origin/main`, avec 79 modifications non commitées.
- On n'y travaille pas et on ne le nettoie pas. Pour lire un document à jour depuis là :
  `git show origin/main:<chemin>`. Sa mise à jour demande un GO et une sauvegarde des données de Studio.

**Nouveaux worktrees** : **uniquement** dans `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\<nom>`, à partir de
`origin/main` ou de la branche du chantier.

**Carte des worktrees, branches et dossiers** : [WORKSPACES.md](WORKSPACES.md). Propositions de nettoyage, sans rien
supprimer : [CLEANUP_LATER.md](CLEANUP_LATER.md). Sauvegardes : [BACKUPS.md](BACKUPS.md). Ne jamais déplacer ni
supprimer `Documents\Sauvegarde Raptoru 2.0`, `Documents\OBS-Backups` ni `Documents\Raptoru 2.0 - Livraisons`.

**Ports du Studio installé** : 4100 (serveur et lecteurs OBS), 4110 (Dock), 3789. Tests : 4389–4399 (E2E),
4471–4482 (banc de l'extension). OBS WebSocket : 4455. Détail : [ARCHITECTURE.md](ARCHITECTURE.md).

**Tester sans toucher la Production** :

- `npm run studio:lab` (Lab isolé) ;
- **jamais `npm run studio` depuis le checkout principal**, qui ouvrirait le profil de Production ;
- `Ouvrir Music Hub (Lab).cmd` (à la racine d'un worktree à jour, absent du checkout principal en retard) pour voir l'extension du Lab en viewer, modérateur ou supermod.

## 4. Vérifier l'état soi-même (lecture seule)

```sh
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" fetch origin
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" log --oneline -5 origin/main
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" worktree list

# Depuis un worktree à jour (l'ancienne adresse coolify.raptoru.fr répond 502)
export COOLIFY_URL=https://dashboard.raptoru.fr
node scripts/coolify-deploy.mjs status core     # SHA déployé, santé, sauvegarde, commit vu par le Core, bail du bot
node scripts/coolify-deploy.mjs status bot
curl -s https://raptoru.fr/api/status

# Studio installé
cat "$LOCALAPPDATA/Programs/Raptoru Studio/resources/app/build-info.json"

# Archive de référence de l'extension
sha256sum "C:/Users/Antoni/Documents/Raptoru 2.0 - Worktrees/music-finish/apps/twitch-extension/release/raptoru-live-PRODUCTION-bbce1048a078-depuis-0bf7907-72-commits-shell-v2.zip"
```

**Relevé du 10/11** :

| Élément            | Valeur                                          |
| ------------------ | ----------------------------------------------- |
| `origin/main`      | `afe98cf`                                       |
| Core               | `bbce104`, sain ; dernière sauvegarde 04:00 UTC |
| Bot                | `900637f`, bail actif                           |
| Studio             | 0.1.29 (`bbce104`)                              |
| Site               | `74f7542`                                       |
| ZIP de l'extension | `80bdab00…f9f5b`                                |

Un écart veut dire que quelqu'un a agi depuis : le comprendre avant d'agir.

La version **publique** de l'extension ne se lit pas hors live. Antoni peut la prouver par la console Twitch, ou en
live par F12 › `shared/runtime-config.js` › `buildId` ([INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 3.3).

## 5. Situation au 10/11

**Passe post-live du 11/11** ([RAPPORT_POST_LIVE.md](RAPPORT_POST_LIVE.md)) — branche `feat/post-live-moderation`,
worktree `post-live`, **ni poussée ni déployée** : `!addpoints`/`!removepoints` pour les modérateurs (permission
« Portefeuille »), Tombola qui affiche tous les participants, achats Musique remboursables depuis la modération,
« Portefeuille » + recherche `@pseudo` dans l'extension. Livraison : Core + release Studio ensemble, nouveau ZIP
d'extension ; aucune migration, rien pour le bot. Prochaine étape : recette d'Antoni dans le Lab
([RECETTE_MODERATION_EXTENSION.md](RECETTE_MODERATION_EXTENSION.md)), puis GO de livraison.

**Ce qui vient d'être terminé**

- Livraison du 10/11 :
  - PR #59 à #62 ;
  - Core `bbce104`, bot `900637f` ;
  - Studio 0.1.28 puis **0.1.29**, installé ;
  - Music Hub ouvert aux testeurs ;
  - ZIP v2 en Hosted Test (Antoni).

  Détail : [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md), [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md).

- Réparation d'**OBS 33.0.1** et désactivation de SE.Live : [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md).
- **Recherche Chaos V2** : [chaos/](chaos/ARCHITECTURE_CHAOS_V2.md), § 0 pour le verdict.
- Cette consolidation.

**En Production** : tous les modules de [ROADMAP.md](ROADMAP.md) § 1 marqués « Livré ». Music Hub y est **seulement
pour les testeurs**.

**Seulement en Hosted Test** : le module Musique de l'extension et tout le shell v2 (ZIP `bbce104`). Le public garde
le shell legacy présumé `0bf7907`.

**Ce qui reste à vérifier** (Antoni) :

- Music Hub après la passe de finition, puis les parcours viewer réels
  ([extension/TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 6) ;
- la source OBS `Navigateur web 2` (ancienne clé TTS) ;
- les effets OBS ;
- la recette d'usage de Studio.

Liste : [PROJECT_STATUS.md](PROJECT_STATUS.md) § 12.

**Prochain chantier** : **Chaos V2, lot 0** ([chaos/ROADMAP_CHAOS_V2.md](chaos/ROADMAP_CHAOS_V2.md)).

- Lot 0 : couper les fenêtres Halloween permanentes, choisir la fréquence de l'écran, mesurer avec PresentMon.
- Lot 1 : lecteur natif limité au flip, sur GO.

## 6. Quels fichiers lire avant de coder

1. Ce fichier, puis [../CLAUDE.md](../CLAUDE.md).
2. [PROJECT_STATUS.md](PROJECT_STATUS.md) (état), [ROADMAP.md](ROADMAP.md) (§ 0–2).
3. [ARCHITECTURE.md](ARCHITECTURE.md) et [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md) (le code du module visé).
4. Selon le chantier :
   - Chaos V2 : `chaos/ARCHITECTURE_CHAOS_V2.md` puis `chaos/ROADMAP_CHAOS_V2.md` ;
   - musique : [music/MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) ;
   - extension : [extension/SOCLE.md](extension/SOCLE.md) ;
   - Studio : [studio-refonte/CONTEXTE.md](studio-refonte/CONTEXTE.md), puis
     [DESIGN_SYSTEM.md](studio-refonte/DESIGN_SYSTEM.md) et
     [architecture/GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md) ;
   - OBS : [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md).
5. Créer un worktree dans `…Worktrees\`, et tenir un journal de reprise du chantier.
6. Avant de s'arrêter : mettre à jour **ce fichier**, court. Le détail daté va dans `archive/`.

## 7. Ce qu'il ne faut surtout pas faire

- Lancer `npm run studio` depuis le checkout principal, ou y faire `git clean`, `reset` ou `checkout .`.
- Téléverser une ancienne archive : la seule référence est `bbce1048a078` ; les ZIP de `Documents\Raptoru\…` sont
  d'un ancien projet.
- Activer le Hosted Test sur la chaîne en live : il retire l'extension à tous les non-testeurs.
- Réactiver SE.Live ou SAMMI.
- Modifier une scène OBS ou une URL de source sans GO.
- Copier une URL de source OBS, un `.env`, un jeton ou un dump dans le dépôt.
- Présenter un test automatique, un déploiement ou une publication comme une validation.
- Présenter Chaos V2 comme existant : il est **en conception**.
