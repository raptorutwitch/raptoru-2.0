# Reprise : point d'entrée pour un agent (Claude, Codex ou autre)

**Mis à jour le 17/11/2026** (Casino intégré en Lab, branche locale `feat/casino` ; avant : livraison de la Roue du Sub V3, journal
[archive/LIVRAISON_2026-11-16_ROUE_DU_SUB_V3.md](archive/LIVRAISON_2026-11-16_ROUE_DU_SUB_V3.md)). À lire **en premier**, puis vérifier l'état soi-même (§ 4). Période
précédente : [archive/REPRISE_2026-11-08_2026-11-10.md](archive/REPRISE_2026-11-08_2026-11-10.md). Les règles de
[`../CLAUDE.md`](../CLAUDE.md) priment sur tout outil ou plugin.

## 0. Résumé compact, à copier dans une nouvelle conversation

```text
Raptoru 2.0 — reprise au 16/11/2026 (source : docs/REPRISE.md du dépôt raptorutwitch/raptoru-2.0)
Roue du Sub V3 DÉPLOYÉE (16/11, mandat d'Antoni) : Core et bot 2c04a5db, migration 20261130130000_sub_wheel_v3 appliquée,
Studio 0.1.39 installé, barème V3 ACTIF (grid 3, choisi par Antoni le 16/11 à 10:22 UTC). Studio 0.1.40 publié (11:26 UTC) :
« Tester dans OBS » de la Roue joue la roue affichée dans OBS (PR #87).
Abonnements offerts exclus et ancienneté jamais prise pour « 1 mois » : actifs dès maintenant (Core + bot).
Journal : docs/archive/LIVRAISON_2026-11-16_ROUE_DU_SUB_V3.md ; module : docs/SUB_WHEEL_V3.md § 13.

Projet : plateforme de stream auto-hébergée du streamer Twitch raptoru_ (id 83603689). Antoni décide seul.
Règle de partage : le Core décide (données, Jetons, règles, files), le bot LeCroupier_ parle à Twitch (EventSub, chat),
Raptoru Studio (Electron, PC d'Antoni) pilote OBS et affiche les lecteurs, l'extension Twitch et raptoru.fr parlent
aux viewers. SAMMI abandonné (20/10). Dépôt public : aucun secret.

Production (relevé du 16/11, 11:30 UTC) : Core 2c04a5db, bot 2c04a5db (sains, un seul bot actif), Studio 0.1.40
publié (Latest), 0.1.39 installé sur le PC, site inchangé. Dernier code sur main : 3e27f454 (PR #87, Studio seul).
Sons de commandes immédiats : la demande de Studio attend sur le Core (wait_ms) au lieu d'interroger toutes les 2 s ;
mesuré dans le Lab : 30–120 ms du message reçu par le Core au son joué (avant : + 0 à 2 s d'attente). Pas mesuré
dans le vrai OBS ni avec le vrai chat Twitch.
Commandes Chat (docs/COMMANDS_V2_STATUS.md) : action « son » (joué par la source OBS sonore « Level Up »), viewers
précis par ID Twitch ; V2.1 : déclencheur « message contenant une expression » (sans « ! », une fois par message, mot
entier ou n'importe où) et édition déléguée (Studio › Règles › Modification déléguée : le viewer active / coupe la
commande et change ses expressions depuis l'extension, Commandes › « Mes commandes modifiables », Production comprise).
Le « bug Streamer » était le délai de 5 min par personne (refus silencieux) + le « Tester » de Studio avec un ID fictif
(corrigé : il parle avec l'ID de la chaîne).
Level Up V2 : 1 000 XP/niveau, normalisation WizeBot appliquée (910 comptes, 441 niveaux changés), 11 badges sub
(266 attributions), préférences historiques restaurées. Vraie annonce Twitch « 🚀 LEVEL UP — Pseudo [Titre] (niveau) »
groupée sur 5 min (8 pseudos), sans @ ; un seul son par annonce, 3 s avant le bandeau (0–5 s), seulement si un viewer
nommé l'a activé. Pseudos du classement repris de Twitch par l'identifiant (0 numérique). Studio › Level Up : réglages,
« Viewers avec son activé », « Pseudos du classement », vraie annonce [TEST] sur confirmation.
Extension : mini-profil (avatar, Jetons/Crédits, niveau et rang, abonnement et multiplicateur, restrictions, Préférences)
et « Mes commandes modifiables » fusionnés dans les deux shells, PAS ENCORE PUBLIC : inventaire a971386f8c8d
(95 commits) validé par Antoni le 16/11 ; ZIP construit le 16/11 :
raptoru-live-PRODUCTION-be1744e75f63-depuis-0bf7907-95-commits-shell-v2.zip (SHA-256 1e60fa0b…72375, dans
Worktrees\agent\apps\twitch-extension\release\) ; reste Hosted Test (Antoni), revue Twitch. Publique : présumée 0bf7907.

Gestes d'Antoni restants : installer Studio 0.1.40 (« Rechercher une mise à jour »), regarder le premier vrai tirage
V3 ; régler la commande d'Aouh (Déclenchement, Modification déléguée) et essayer en vrai les
expressions et la latence ; essayer « Envoyer une vraie annonce test » ; téléverser le ZIP be1744e75f63 en Hosted Test
(jamais pendant un live), l'essayer, puis la revue Twitch ; décider des propositions de règles de docs/AGENT_WORKFLOW.md
§ 15 ; choisir les directions du casino (prototypes/casino-directions, hors dépôt).
Casino (17/11, docs/CASINO.md) : machine à sous avec le Coffre, roulette, spectateurs, Studio › Casino — intégrés et
testés en Lab sur la branche LOCALE feat/casino (a8deef5f Core + migration 20261201130000_casino, 91839307 extension,
Studio, Lab). Non poussé, non fusionné, non déployé ; fermé par défaut (casino.open = 0, CASINO_EXTENSION = off).
Essayer : npm run casino:demo -w @raptoru/core-api (http://127.0.0.1:4497) ; contrôle : npm run casino:check.
À valider par Antoni avant la Production : CASINO.md § 10 (limites, plafond de gain, variable, jetons 40/200).
Prochain chantier : la validation du Casino par Antoni (Lab), ou au choix (par exemple Chaos V2 lot 0, docs/chaos/).

Interdit sans GO explicite d'Antoni : push, fusion, déploiement, release Studio, migration distante, variable,
publication ou Hosted Test Twitch, action sur OBS / Wallet / chat. Jamais git clean / reset --hard / checkout . dans
le checkout principal (c'est le dossier de données du Studio installé). Travailler dans
Documents\Raptoru 2.0 - Worktrees\<nom>. « Validé » = testé à la main par Antoni.

Méthode (adoptée le 15/11) : docs/AGENT_WORKFLOW.md — classes A/B/C/D, tests locaux ciblés, une seule CI (celle de
main), attentes en arrière-plan, doc dans la même PR. Le checkout principal est en retard sur main : lire les documents
avec git show origin/main:<chemin> ou dans Documents\Raptoru 2.0 - Worktrees\agent (worktree réutilisable).
À lire avant de coder : docs/AGENT_WORKFLOW.md § 0, docs/REPRISE.md § 0, puis au besoin docs/PROJECT_STATUS.md,
docs/ROADMAP.md et le document du module.
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

## 5. Situation au 15/11

**Level Up V2 : CLÔTURÉ le 15/11** (GO d'Antoni). Finitions déployées vers 14:25 UTC (Core et bot `d2fd5bb7`,
Studio 0.1.35) : [archive/LIVRAISON_2026-11-15_LEVEL_UP_FINITIONS.md](archive/LIVRAISON_2026-11-15_LEVEL_UP_FINITIONS.md).

Activation du matin (GO d'Antoni) :

- **Fusions** : PR #70 puis #71, `main` = `f04b41a2`.
- **Core** : `f04b41a2` déployé, migration `20261126130000_progression_level_up.sql` appliquée.
- **Level Up V2** : actif. Chiffres et retour arrière :
  [archive/LIVRAISON_2026-11-15_LEVEL_UP_MINI_PROFIL.md](archive/LIVRAISON_2026-11-15_LEVEL_UP_MINI_PROFIL.md).
- **Studio** : 0.1.34 publié.

**Ensuite (15/11)** : Commandes Chat (action son, viewers par ID, V2.1 expressions et édition déléguée, sons
immédiats) — Core `c1da930a`, Studio 0.1.38 ([COMMANDS_V2_STATUS.md](COMMANDS_V2_STATUS.md)) ; méthode de travail
[AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) (PR #82). Studio 0.1.38 est installé sur le PC.

**En attente d'Antoni** :

- **Roue du Sub V3** (16/11, mandat de livraison d'Antoni ; [SUB_WHEEL_V3.md](SUB_WHEEL_V3.md) § 13) :
  - barème : 12 parts (5 petits, 3 moyens, 3 bons, 1 jackpot), un palier par 3 mois d'ancienneté confirmée,
    (1 500 · 2 000 · 2 500 · 3 000) × (palier + 1) jusqu'à 60 mois ; Prime / T1 ×1, T2 ×2, T3 ×3 ; jackpot T3 de
    189 000 à 60 mois ; coût ≈ ×1,9 sur les 20 derniers vrais tirages ;
  - abonnement offert : jamais de roue (commit `f8f39218`) ; ancienneté inconnue : jamais tirée « à 1 mois », confirmée
    par le partage, le badge du chat ou Studio ;
  - barème choisi dans Studio › Roue du Sub › Barème (`sw_settings.grid`) ; un droit acquis avant garde l'ancienne roue ;
  - nouvelle roue Arcade dans le lecteur d'effets (`wheel-v3.js`) ; Studio installé avant la release : les tirages V3
    s'affichent avec l'ancienne roue (bons montants) ;
  - ordre : sauvegarde, Core (migration `20261130130000_sub_wheel_v3`), bot, release Studio, puis barème V3 ;
  - **déployé le 16/11** : Core et bot `2c04a5db` (PR #84, #85), migration appliquée après sauvegarde (04:41 UTC),
    Studio 0.1.39 publié ; barème toujours sur l'ancienne roue (`grid` 1) ;
  - Studio 0.1.39 installé, barème V3 choisi par Antoni (16/11, 10:22 UTC) ; reste à regarder le premier vrai tirage V3 ;
  - Studio 0.1.40 publié le 16/11 (11:26 UTC, depuis `3e27f454`, PR #87) : « Tester dans OBS » joue la roue affichée dans
    OBS (avant : il ouvrait seulement le panneau « Tests ») ; à installer par Antoni ;
- « Envoyer une vraie annonce test » (le son, puis le bandeau 3 s après) ;
- régler et essayer en vrai la commande d'Aouh (expressions, latence, édition déléguée après publication) ;
- l'extension : inventaire `INVENTAIRE-a971386f8c8d.md` (95 commits : Commandes V2.1 en plus de Level Up V2 et du
  mini-profil) **validé par Antoni le 16/11**, ZIP `be1744e75f63` construit
  ([INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 3.0) ; reste le Hosted Test (Antoni, hors live), puis la revue.

**En Production** : tous les modules de [ROADMAP.md](ROADMAP.md) § 1 marqués « Livré ». Music Hub y est **seulement
pour les testeurs**. Le public garde l'extension présumée `0bf7907` (shell legacy) : ni le mini-profil, ni
l'interrupteur du son, tant que la nouvelle version n'est pas publiée.

**Période précédente** (livraisons du 10 au 14/11, OBS, Chaos V2) :

- [REPRISE_SESSION_POST_LIVE_2026-11-11.md](REPRISE_SESSION_POST_LIVE_2026-11-11.md) ;
- [PROJECT_STATUS.md](PROJECT_STATUS.md), photographie du 10/11 ;
- [ROADMAP.md](ROADMAP.md).

**Ce qui reste à vérifier** (Antoni) : Music Hub et ses parcours viewer réels, la recette d'usage de Studio, les effets
OBS ([PROJECT_STATUS.md](PROJECT_STATUS.md) § 12).

**Prochain chantier possible** : **Chaos V2, lot 0** ([chaos/ROADMAP_CHAOS_V2.md](chaos/ROADMAP_CHAOS_V2.md)).

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
