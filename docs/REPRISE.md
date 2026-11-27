# Reprise : point d'entrée unique (Claude Code, Codex, ChatGPT ou autre)

**Checkpoint du 22/11/2026 : fin du Casino V1, transition vers les Chatbox** (mandat d'Antoni « Checkpoint final
Casino V1 et transition Chatbox »). À lire **en premier**, puis vérifier l'état soi-même (§ 4). Les règles de
[`../CLAUDE.md`](../CLAUDE.md) priment sur tout outil ou plugin. Version précédente de ce fichier (20 → 22/11) :
[archive/REPRISE_2026-11-20_2026-11-22.md](archive/REPRISE_2026-11-20_2026-11-22.md). Résumé à coller dans une
conversation ChatGPT : [REPRISE_CHATGPT.md](REPRISE_CHATGPT.md).

## 0. Résumé compact

> **Livraison du 27/11/2026 (fin d'après-midi)** — prime sur le bloc ci-dessous pour ces points :
>
> - **Core `35cd4bd9` DÉPLOYÉ** le 27/11 à 14:52 UTC (aucune migration, sauvegarde fraîche juste avant ; retour arrière
>   `node scripts/coolify-deploy.mjs deploy core 9f5efcd28f8a4b458882eb1583a175a6be533265 --rollback --go`) ; bot
>   `df3adb5e` inchangé. Vérifié après coup : santé, frontière des viewers (Tombola, Casino, Chaos), Studio 0.1.45 ↔ Core
>   « Connecté ».
> - **Studio 0.1.46 PUBLIÉE** (étiquette `studio-v0.1.46` sur `35cd4bd9`) : Casino par joueur, « Nouveautés », vérification
>   toutes les 6 h. Installée par Antoni (Studio › « Mettre à jour ») ; 0.1.45 installée en attendant.
> - **Extension** : inventaire `094c4c52508f` validé (GO écrit d'Antoni du 27/11), archive de Production construite par la
>   CI de `main` `30c1775e` : `raptoru-live-PRODUCTION-30c1775e245b-depuis-be1744e-58-commits-shell-v2.zip`, SHA-256
>   `9f7f3fb2f1acb8fde9d3557bede1035e640b0def24575b634ba4c8d6e10c5396` (artefact `extension-production-30c1775e…`, copie
>   dans `Worktrees/agent/apps/twitch-extension/release/ci-30c1775e/`). **À téléverser par Antoni** dans la console Twitch
>   (Hosted Test, revue, Release ; console non automatisable). **Après la Release : `PUBLISHED` = `30c1775e…`** (commit
>   à faire, avec la note de version).
> - Chaos : **inchangé** — `CHAOS_EXTENSION=testers:83603689`, `chaos.enabled` = 1 (essai fermé d'Antoni).
>   Ouverture publique sur GO séparé : [chaos/DEPLOIEMENT_CHAOS.md](chaos/DEPLOIEMENT_CHAOS.md) § 9.
> - PR fusionnées le 27/11 : #134, #133, #132, #135, #136 (inventaire validé + la CI de `main` construit l'archive quand
>   l'inventaire change). Procédure standard : [CICD.md § 0](CICD.md). Autonomie : l'agent fusionne seul une PR verte ;
>   GO pour Production, ouverture publique de Chaos, économie Twitch, dépenses.

```text
Raptoru 2.0 — checkpoint du 22/11/2026 (source : docs/REPRISE.md, dépôt public raptorutwitch/raptoru-2.0, branche main)
Plateforme de stream auto-hébergée du streamer Twitch raptoru_ (id 83603689). Antoni décide seul.
Le Core décide (données, Jetons, règles), le bot LeCroupier_ parle à Twitch, Raptoru Studio (Electron, PC d'Antoni)
pilote OBS, l'extension Twitch et raptoru.fr parlent aux viewers. SAMMI abandonné. Dépôt public : aucun secret.

Production (relevé du 22/11, 14:15 UTC) : Core df3adb5e (sain), bot df3adb5e (un seul bot actif, CHATBOX_RELAY=true),
Studio 0.1.43 publiée (0.1.42 installée tant qu'Antoni n'a pas mis à jour), extension publique be1744e75f63, main 8f428a37.
Casino V1 : développement TERMINÉ et fusionné (PR #90 → #115, #111, #113) ; Core a94d1081 DÉPLOYÉ le 22/11 00:39 UTC
(nouvelles tables + réactions ; aucune migration ; retour arrière Core 1f05b97c) ; réglages ouverts, refus hors live.
ZIP PRÊT À PUBLIER, PAS téléversé (aucune preuve) : raptoru-live-PRODUCTION-d09fd03aa844-depuis-be1744e-20-commits-shell-v2.zip,
SHA-256 1ec79c2adc15c242f66da51d226726fd9ef9abd381d6b753f8734d8b66d76039 (inventaire 2411c992b26b validé par Antoni).
L'extension publique NE contient PAS le Casino ; aucune partie réelle avec de vrais viewers. Ne pas dire « Casino
disponible pour tous ». Gestes restants : Antoni (Hosted Test, revue Twitch) — § 5.4.
CHATBOX RAPTORU : EN SERVICE MASQUÉE le 22/11 (Core + bot df3adb5e, CHATBOX_RELAY=true, Studio 0.1.43 publiée, 5 sources
OBS « Chatbox Raptoru — … » ajoutées MASQUÉES au-dessus des anciennes). Reste : Antoni installe 0.1.43, essai en live,
bascule scène par scène SUR SON GO (docs/CHATBOX.md § 12.2). Ne rendre aucune source visible, ne toucher à aucune source
StreamElements sans GO. Chantier suivant : KO Overlay = Chaos V2 (§ C).
CHAOS V2 LOT 2 (26/11, LOCAL, rien de poussé ni déployé) : branche feat/chaos-integration (worktree « agent »), achats
réels sur le Core (devis, débit atomique, file, boucle Studio, remboursements automatiques, modération FX) ; parcours
Lab réel extension → Core Lab → Studio → moteur → écran vérifié par l'agent. Ordre et GO : docs/chaos/DEPLOIEMENT_CHAOS.md ;
état : docs/chaos/LIVRAISON_CHAOS_2026-11-26.md. Inventaire ZIP a4fd2972be05 à valider par Antoni (aucun ZIP écrit).
Niveaux : restauration WizeBot du 20/11 définitive (NE JAMAIS LA REJOUER).
Suspendu : personnalité IA de LeCroupier_ (ne rien proposer). Méthode : docs/AGENT_WORKFLOW.md § 0.
```

## 1. Le projet

- **Raptoru 2.0** : la plateforme de stream du streamer Twitch `raptoru_` (identifiant 83603689). Antoni est l'unique
  décideur ; « **validé** » = testé à la main par Antoni, jamais un test automatique.
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
jamais la Production), **Hosted Test** (extension visible des seuls comptes testeurs), **staging**
(`core-staging.raptoru.fr`). Architecture : [ARCHITECTURE.md](ARCHITECTURE.md) ; code par module :
[INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md). Hors du dépôt : StreamElements garde les dons et l'affichage du chat
dans OBS (trois overlays, [CHATBOX.md](CHATBOX.md)).

## 2. Limites d'autonomie

Sans GO explicite d'Antoni pour l'étape (un mandat écrit peut le donner pour un lot entier) :

- **Production, Twitch, OBS** : push, fusion, déploiement Coolify, migration distante, variable ou drapeau,
  redémarrage, release ou installation de Studio, publication ou Hosted Test de l'extension, console Twitch, OBS,
  StreamElements, Spotify, Wallet (soldes, crédits, remboursements, sanctions), messages dans le vrai chat.
- **Destruction** : `git clean`, `reset --hard`, `checkout .`, réécriture d'historique, suppression de branche, de
  worktree, de sauvegarde, de média ou de données de Studio.
- **Contenu métier** : ne jamais inventer défis, montants, récompenses ni cosmétiques.
- **Dépôt public** : aucun secret, `.env`, jeton, dump, journal ni donnée de viewer ([../SECURITY.md](../SECURITY.md)) ;
  jamais une URL d'overlay StreamElements (elle contient une clé).
- **Validation d'un ZIP** : la ligne « Validé par Antoni : oui » est écrite par Antoni, jamais inventée.
- Une garde automatique qui refuse une opération ne se contourne pas : signaler l'action manuelle précise. Lancer un
  installateur de Studio est refusé par la garde : c'est Antoni qui installe.

Registre des décisions et de leurs raisons : [DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md). Méthode :
[AGENT_WORKFLOW.md](AGENT_WORKFLOW.md).

## 3. Où travailler sans rien casser

- **Checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0`** : c'est le **dossier de données du Studio installé**
  (`.env`, jetons Twitch, `apps/studio/server/.runtime`). Il est sur `main` local `11ffe3f9`, très en retard sur
  `origin/main`, avec des dizaines d'entrées dans `git status`. On n'y travaille pas, on ne le nettoie pas, on n'y
  lance jamais `npm run studio`. Lire un document à jour depuis là : `git show origin/main:<chemin>`.
- **Worktrees** : uniquement dans `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\<nom>`, créés depuis
  `origin/main`. `agent` est réutilisable et garde les ZIP de l'extension sous `apps/twitch-extension/release/` (hors
  Git). `_recherches\` (même dossier, pas un worktree) garde les rapports de recherche privés (chatbox). Carte :
  [WORKSPACES.md](WORKSPACES.md) ; nettoyage proposé : [CLEANUP_LATER.md](CLEANUP_LATER.md).
- **Branche de référence : `main`** (GitHub `raptorutwitch/raptoru-2.0`). Une PR par lot, CI verte avant fusion.
- **Dossiers à ne jamais déplacer ni supprimer** : `Documents\Sauvegarde Raptoru 2.0`, `Documents\OBS-Backups`,
  `Documents\Raptoru 2.0 - Livraisons`, `Documents\Raptoru\_migration-exports\` (exports privés des niveaux, hors Git),
  `Documents\ChatGPT\Chatbox Twitch\` (copies des chatbox).
- **Ports du Studio installé** : 4100 (serveur et lecteurs OBS), 4110 (Dock), 3789. Tests : 4389–4399 (E2E),
  4471–4482 (banc de l'extension ; simulateur Casino détaché sur 4473 depuis `agent`). OBS WebSocket : 4455.
- **Tester sans toucher la Production** : `npm run studio:lab` depuis un worktree ; Casino :
  `npm run casino:bench -w @raptoru/twitch-extension`.

## 4. Vérifier l'état soi-même (lecture seule)

```sh
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" fetch origin
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" log --oneline -5 origin/main
git -C "C:\Users\Antoni\Documents\Raptoru 2.0" worktree list

# Depuis un worktree à jour (l'ancienne adresse coolify.raptoru.fr répond 502)
export COOLIFY_URL=https://dashboard.raptoru.fr
node scripts/coolify-deploy.mjs status core     # SHA déployé, santé, sauvegarde, bail du bot
node scripts/coolify-deploy.mjs status bot
curl -s https://raptoru.fr/api/status

# Studio installé
cat "$LOCALAPPDATA/Programs/Raptoru Studio/resources/app/build-info.json"

# Extension : version publique déclarée et ZIP Casino prêt
cat apps/twitch-extension/PUBLISHED
sha256sum "C:/Users/Antoni/Documents/Raptoru 2.0 - Worktrees/agent/apps/twitch-extension/release/raptoru-live-PRODUCTION-d09fd03aa844-depuis-be1744e-20-commits-shell-v2.zip"
```

Un écart avec le § 5 veut dire que quelqu'un a agi depuis : le comprendre avant d'agir. La version publique et le
Hosted Test de l'extension se prouvent dans la console Twitch (Antoni) ou en live par F12 ›
`shared/runtime-config.js` › `buildId`.

## 5. État exact au 22/11/2026

### 5.1 Versions (relevé du 22/11, 00:54 UTC, sauf mention)

| Élément                | Valeur                                                                                                                                                                                                                                                         | Preuve                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `origin/main`          | `302db793` (PR #113, inventaire validé) ; dernier code `a94d1081` (PR #111)                                                                                                                                                                                    | `git log`                                        |
| Core                   | **`df3adb5e`** (Chatbox), déployé le 22/11 14:10 UTC (déploiement `4jae1tmush9ronyffbl9wvbb`), `/health` et `/ready` OK ; aucune migration ; avant `a94d1081`                                                                                                  | `coolify-deploy.mjs status core`                 |
| Bot                    | **`df3adb5e`** (22/11 14:13 UTC, `CHATBOX_RELAY=true`), actif, seul bail ; avant `2c04a5db`                                                                                                                                                                    | `status core`                                    |
| Studio                 | **0.1.43 publiée (Latest) le 22/11** (Chatbox + interrupteurs des réactions du Casino) ; 0.1.42 installée jusqu'à la mise à jour par Antoni                                                                                                                    | `build-info.json`                                |
| Extension publique     | **`be1744e75f63`** (shell v2 : Level Up V2, mini-profil, Commandes V2.1, Mini-jeux V5, Music Hub), prouvée par Antoni le 20/11 ; sans Casino                                                                                                                   | `apps/twitch-extension/PUBLISHED`                |
| Hosted Test            | dernier téléversement **tracé** : `2e2eaf3ae34a` (Casino, 20/11). `76875d47e728` (20/11) construit, téléversement non tracé                                                                                                                                    | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) |
| **ZIP prêt à publier** | `raptoru-live-PRODUCTION-d09fd03aa844-depuis-be1744e-20-commits-shell-v2.zip`, SHA-256 `1ec79c2adc15c242f66da51d226726fd9ef9abd381d6b753f8734d8b66d76039`, source `d09fd03a`, 20 commits depuis `be1744e75f63` ; écrit et vérifié le 22/11 ; **non téléversé** | `Worktrees\agent\apps\twitch-extension\release\` |
| Drapeaux du Core       | `CASINO_EXTENSION=on`, `MUSIC_HUB_EXTENSION=on` (relevé du 20/11, inchangés depuis)                                                                                                                                                                            | API Coolify, lecture seule                       |
| Sauvegardes            | quotidienne : dernière réussie le 21/11 04:00 UTC ; dernière manuelle : 20/11 15:28 UTC                                                                                                                                                                        | `status core`, API Coolify                       |
| Retour arrière Core    | `node scripts/coolify-deploy.mjs deploy core 1f05b97c2c0133c1f222ff97d2003e218e9313ab --rollback --go`                                                                                                                                                         | livraison du 22/11                               |

### 5.2 Casino V1 : terminé, déployé côté Core, prêt à publier ; ni public ni essayé en réel

Les états ne se confondent pas (détail : [ROADMAP.md](ROADMAP.md) § 0.4) :

| État                                    | Casino V1 au 22/11                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Développement terminé, fusionné         | **oui** : PR #90 (V1, 20/11), #99 → #115 (post-live 21–22/11), #111 (Core tables et réactions), #113 (inventaire)                             |
| Core déployé                            | **oui** : `a94d1081`, 22/11 00:39 UTC ; réglages ouverts (`CASINO_EXTENSION=on`, `casino.open=1`, 4 jeux), refus hors live (`stream_offline`) |
| ZIP construit et vérifié                | **oui** : `d09fd03aa844` (§ 5.1), inventaire `2411c992b26b` validé par Antoni le 22/11                                                        |
| ZIP téléversé dans Twitch / Hosted Test | **non prouvé** (Antoni)                                                                                                                       |
| Extension publique (Released)           | **non** : `be1744e75f63` ne contient pas le Casino                                                                                            |
| Validation par Antoni / vrais viewers   | **non** : aucun essai du nouveau ZIP, aucune partie réelle                                                                                    |

- **Jeux** : machine à fruits + Coffre du Raptor, roulette, machine à émotes, blackjack multijoueur (spectateurs, jeu
  en solo, jusqu'à 4 mains après Split en pile animée, distribution et actions par main, assurance et Gain assuré,
  historique « Mes manches » et bilan de session, partage dans le chat, nouvelles tables publiques, plafond dynamique,
  nettoyage des tables vides, 7 réactions avec anti-spam, réactions du croupier en émote seule). Machines : lignes
  gagnantes explorées directement sur les rouleaux. Responsive PC, portrait et paysage ; garde contre les
  doubles-clics. Liste et décisions : [ROADMAP.md](ROADMAP.md) § 1 et § 5 ; détail : [CASINO.md](CASINO.md) § 12–18 ;
  journal : [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md).
- **Réglages en Production (relevés le 20/11)** : machine 20–10 000 Jetons ; émotes 20–1 000 ; roulette 100 000 max
  par tour ; blackjack mise principale 100 min, gain net 1 000 000 max par manche, paris annexes 100 000 max ; gain
  max par partie 1 000 000 ; partage dans le chat toutes les 300 s ; annonces automatiques des gros gains **coupées** ;
  annonce de table : `casino.bj_announce` à 0 par défaut depuis `a94d1081` (une valeur enregistrée reste).
- **Simulateur local** : `npm run casino:bench -w @raptoru/twitch-extension` (la vraie extension, Core fictif,
  Jetons fictifs) ; captures de la dernière passe : `Documents\Raptoru 2.0 - Livraisons\2026-11-22-casino-final`.

### 5.3 Progression, WizeBot et badges : clos le 20/11

- **Restauration exécutée le 20/11** (sauvegarde 12:57:26 UTC) : 1 159 comptes examinés ; **432 restaurés** (363
  WizeBot, 69 touchés par l'ancienne courbe) ; **3 441 niveaux rendus** ; aucun badge perdu ; 0 annonce, 0 message ;
  rejeu complet = 0 changement (clés `wb-restore-v1-<id>`, `curve-restore-v1-<id>`).
- **Règles en vigueur** : 1 000 XP par niveau ; un message récompensé au plus toutes les 120 s ; badges sub tous les
  **25 niveaux** ; annulations « normalisation » et « import » retirées (Core 410).
- **Traces privées, hors Git** : `Documents\Raptoru\_migration-exports\levels-2026-11-20\`. Détail :
  [LEVEL_UP_V2.md](LEVEL_UP_V2.md) § 14–15.

### 5.4 Prochaines tâches (ordre réel)

**A. Développement (agent, avec Antoni) : les Chatbox** — [CHATBOX.md](CHATBOX.md).

1. Lire [CHATBOX.md](CHATBOX.md), puis la présentation et le rapport privés qu'il cite (§ 1) ; ne refaire ni la
   reconnaissance ni la présentation. Direction décidée par Antoni le 22/11 (CHATBOX.md § 4).
2. Core et bot `df3adb5e` déployés le 22/11 (14:10 et 14:13 UTC, bot `CHATBOX_RELAY=true`), Studio 0.1.43 publiée, cinq sources OBS ajoutées **masquées** (CHATBOX.md § 12). Suite : Antoni installe 0.1.43, puis l'essai en live et la bascule scène par scène
   sur son GO (§ 12.2). Ensuite : KO Overlay = Chaos V2 (§ C ci-dessous).
3. Aucune source OBS active, widget StreamElements ni Production modifiés sans autorisation explicite d'Antoni.

**B. Casino jusqu'au public (gestes d'Antoni, en parallèle)**. Le Hosted Test ne permet **pas** un essai avec de vrais
viewers en live (il retire l'extension aux non-testeurs, [CASINO.md](CASINO.md) § 6) et le Casino refuse hors live.

1. Téléverser le ZIP `d09fd03aa844` (§ 5.1) comme nouvelle version, Hosted Test **hors live** sur un compte testeur
   (affichage, navigation, état « hors live »), y compris dans l'**application** Twitch du téléphone (portrait et
   paysage ; jamais le navigateur mobile, où Twitch n'affiche aucune extension).
2. Décision avant la publication : `CASINO_EXTENSION=testers:<ids>` (essai réel restreint pendant un live,
   recommandé) ou garder `on` (ouvert à tous dès la publication).
3. Soumettre à la revue Twitch (8 à 14 jours, une soumission à la fois).
4. Après approbation : publier ; l'agent met à jour `PUBLISHED` ; **essai réel en live** (mises, gains,
   remboursements, spectateurs, blackjack à plusieurs, nouvelles tables, réactions, téléphone).
5. Corriger **uniquement** les problèmes observés.

**C. Chaos V2 (« Chaos Overlay », que tu appelles aussi « KO Overlay »)** : moteur, curseur retourné, page Studio
(22–23/11), puis **bibliothèque de 13 effets** (nuit du 23 au 24/11), puis **passe de polissage + Performance Lab**
(24/11, après les essais d'Antoni dans 0.1.44-chaos.2), en local.

- **Où** : branche locale **`feat/chaos-studio`** (`origin/main` refusionné le 24/11 : Soundboard), worktree
  `Raptoru 2.0 - Worktrees\chaos-v2`. Lancer : `npm run chaos:lab` (recompile moteur et page).
- **Effets** : retournement, miroir, tremblement, zoom, écran ivre, vision tunnel, clignement des paupières, flash
  aveuglant avec rémanence, brouillard, flou, pixelisation, filtres de couleur, VHS / glitch. Chacun a sa fiche dans
  Studio (préréglages en un clic, réglages avancés repliés, point visé, aperçu rendu par le moteur hors écran). État,
  techniques, sources, limites : [chaos/ETUDE_EFFETS_V2.md](chaos/ETUDE_EFFETS_V2.md).
- **Polissage du 24/11** :
  - **tout l'écran, barre des tâches comprise** : mode E, [chaos/ECRAN_ENTIER.md](chaos/ECRAN_ENTIER.md) ;
  - clignement fermé à 100 %, brouillard à quatre niveaux d'occlusion, tunnel en vrai dégradé, flash à forte
    rémanence, ivre mort et vertige plus forts ;
  - **intensité** Léger / Marqué / Extrême / Personnalisé dans chaque fiche ;
  - **Chaos Performance Lab** : banc hors écran et validation en jeu, [chaos/PERFORMANCE_LAB.md](chaos/PERFORMANCE_LAB.md).

  Mesures et choix : [chaos/ETUDE_EFFETS_V2.md](chaos/ETUDE_EFFETS_V2.md) § 0 bis.

- **Enquête Halloween / V2 (24/11)** : [chaos/ETUDE_HALLOWEEN_VS_V2.md](chaos/ETUDE_HALLOWEEN_VS_V2.md).
  - Halloween utilisait déjà des filtres OBS pour le retournement (fenêtre exclue).
  - Chaos V2 en mode E est vu directement par « Écran » (DXGI).
  - Recommandation : mode automatique, calque capturé par défaut et filtres seulement sur le bureau, sous réserve de
    la sonde `chaos-bench.exe --capture-probe --screen \\.\DISPLAY1` (à lancer par Antoni).
  - Garde de jeu corrigée : les « plein écran » du 24/11 venaient des deux fenêtres Halloween de Studio (calques
    traversables, « Overlay actif » allumé), pas d'un jeu.
- **Banc des 13 effets (25/11)** : [chaos/BENCH_EFFETS.md](chaos/BENCH_EFFETS.md).
  - **Phase A, moteur hors écran à 1440p** : 0,09 ms (Flash) à 0,60 ms (Brouillard) de GPU par image au maintien, soit
    0,4 à 3,6 % du GPU à 60 Hz. Les plus coûteux : Brouillard, Écran ivre, VHS. Processeur et mémoire négligeables.
  - **Phase B, OBS isolé** réglé comme le profil Twitch (DXGI, relais, NVENC 1080p60) : 0 image en retard, sautée
    ou noire, sur tous les effets.
  - **Classement** : 11 effets « légers », Brouillard et Écran ivre « modérés », aucun « lourd ».
  - **Phase C, Overwatch réel** : première mesure d'Antoni le 25/11 à 14 h 07, analysée et collecteur corrigé
    (BENCH_EFFETS.md § 8). Avec calque, le jeu passe en composition Windows (SyncInterval 1, 60 Hz) : autant d'images,
    mais 4,9 % durent 33 ms (0,0 % sans calque), même avec Miroir ; pas le coût des shaders. Cause probable : ~58 i/s
    d'Overwatch dans une composition à 59,94 Hz. **Test A/B prêt** (`mesure-jeu.mjs --ab` : calque neutre
    `diag.watermark`, Miroir, Brouillard), à lancer par Antoni ; aucune perte d'images/s annoncée avant.
  - **Premier A/B (14 h 56) interrompu au 2e essai** : le Performance Lab rendait sa place à la sortie (asynchrone) du
    processus de télémétrie, après « done ». Corrigé (Studio : libération immédiate, `live_available` ; collecteur :
    état vérifié côté serveur, « busy » redemandé tant que le serveur le dit, nettoyage), test de six essais enchaînés
    sur le vrai runtime (BENCH_EFFETS.md § 8.6). Le calque neutre seul a fortement perturbé le jeu (27,9 i/s, 40,7 %
    d'images doublées) sans que le moteur cale : à confirmer par les six essais.
  - **A/B complet (15 h 39, 6/6)** : PresentMon sous-compte les images d'Overwatch en mode composé (21 à 29 i/s
    affichées alors que la capture du moteur reçoit 57,5 à 59,5 images neuves/s, processeur du jeu inchangé, ressenti
    fluide sur Brouillard) : ses chiffres en mode composé sont faux (BENCH_EFFETS.md § 9.2). Cause réelle des
    ralentissements de Miroir : le moteur ne redessinait les effets cadencés qu'au retour de balayage et perdait une
    image du jeu sur sept ou huit (50,7–52,5 présentées pour 58,5–59,1 captures) ; corrigé (`ddbe54bd`, captures rendues
    dès leur arrivée), simulation 25,5 % → 0 % d'images perdues. Version de test 0.1.44-chaos.10 ; manipulations
    Windows/NVIDIA/Overwatch réversibles au § 9.5, à faire par Antoni.
  - **Validation en jeu arrêtée après la référence (26/11, chaos.10 installée)** : Miroir 10 / 40 / 10 s ; le moteur
    validait la phase « effet » contre la durée maximale des effets du stream (Sécurité, 30 s) et refusait 40 s.
    Corrigé (`ec7406c0`) : phase « effet » d’une mesure bornée par le registre (60 s), refus montré aussitôt ; tests
    chaos-unit 39/39 et `chaos-perf-phases` (10 / 40 / 10 simulé). Version de test 0.1.44-chaos.11 (PERFORMANCE_LAB.md).
  - **26/11 : chaos.11 installée et validée par Antoni** (Miroir fluide, Brouillard sans lag, 10 / 40 / 10, curseur
    unique, aucun flash noir). Stabilisation des performances close. Suite : lot 2 (ROADMAP_CHAOS_V2.md, état en tête).
  - **Lot 2 (26/11, branche locale `feat/chaos-integration`, non poussée)** : Core `chaos` (migrations jumelles
    `20261206120000_chaos_lab.sql` / `20261206130000_chaos.sql`), boucle Studio `chaos/core-loop.ts`, extension
    `modules/interactions` sur le Core. Fermé par défaut (`chaos.enabled = 0`, `CHAOS_EXTENSION = off`). Contrat :
    [chaos/CONTRAT_LOT2.md](chaos/CONTRAT_LOT2.md) ; tarifs à valider : [chaos/TARIFS.md](chaos/TARIFS.md) ; déploiement :
    [chaos/DEPLOIEMENT_CHAOS.md](chaos/DEPLOIEMENT_CHAOS.md) ; état et tests :
    [chaos/LIVRAISON_CHAOS_2026-11-26.md](chaos/LIVRAISON_CHAOS_2026-11-26.md). Banc Lab réel : lanceur bonk-lab avec
    `CHAOS_ENGINE_EXE` (moteur installé) et `chaos.enabled = 1` dans la base isolée `raptoru_bonk_lab` (remis à 0).
    Éditeur de tarifs (26/11 soir, même branche) : Studio › Chaos › Tarifs, fourchettes par effet enregistrées par le
    Core (réglages masqués `chaos.price_<effet>_min|max`, aucune migration) ; minimum atteint au réglage le plus doux
    (TARIFS.md § Modèle) ; livraison : LIVRAISON_CHAOS_2026-11-26.md § 8.
    **27/11 : branche poussée, PR #130 (CI verte, non fusionnée)** ; ordre de livraison, essai fermé et retour arrière :
    DEPLOIEMENT_CHAOS.md § 3 à § 8 (Production avant livraison : Core `408f201a`, bot `df3adb5e`).
  - **Commits** `de06ee91`, `733cf5fa`, `9ba0e2e0`, `f7dc31a4` (locaux).
  - **Version de test** `0.1.44-chaos.9` (non installée) : chaos.8 plus la lecture seule des compteurs d'OBS pour la
    phase C. Version installée : chaos.10 (26/11) ; le relais a été validé par Antoni dans son OBS le 25/11 (chaos.8).
- **Flash noir de la bascule du curseur d'OBS (24/11 soir)** : [chaos/CURSEUR_OBS.md](chaos/CURSEUR_OBS.md) § 5.
  - **Cause** : OBS détruit puis recrée la duplication DXGI partagée de l'écran à chaque changement de réglage de sa
    seule capture.
  - **Solution mesurée** : le **relais**, une capture sans curseur du même écran, hors du cadre, dans les scènes où
    « Écran » est visible ; pas dans Scène PS5.
  - **Banc isolé 1080p60 et 1440p60** : bascule actuelle, 1 à 2 images noires par bascule ; relais, 0 ; même mémoire
    vidéo ; changements de scène, 0 ; scène type PS5, aucune capture.
  - **Corrigé en passant** : les réglages de fiche tapés coup sur coup ne se perdent plus. Le e2e de la page passe
    de 37 à 39/39.
  - **Commits** `6387c1e0`, `256308f3`, `dbb5aee2`, `dbe78017`, `984591ac`, `84b297e9` (locaux).
  - **Version** `0.1.44-chaos.8`, installée et **validée par Antoni le 25/11** dans son OBS : aucun flash noir
    perceptible, un seul curseur, transformation correcte (Miroir, Écran retourné).
- **« Aucune image capturée » (Miroir, Écran retourné) avec chaos.6 (24/11 soir)** : la cible « écran » avait choisi
  Discord, qui s'exclut des captures (affinité 0x11). WGC ne livrait aucune image et l'effet échouait au bout de 3 s.
  - Correctif `badada91` : une fenêtre protégée n'est plus jamais choisie.
  - Diagnostic sans affichage : `ChaosEngine.exe --capture-check`.
  - Version de test `0.1.44-chaos.7` (non installée). Doc : [chaos/CAPTURE_DIRECTE.md](chaos/CAPTURE_DIRECTE.md) § 6.
- **Curseur d'OBS et VHS (24/11 soir, après la validation du Miroir en capture directe par Antoni)** :
  doc [chaos/CURSEUR_OBS.md](chaos/CURSEUR_OBS.md).
  - **VHS figé au maintien** : le moteur ne redessinait plus sans nouvelle capture (tous modes).
    - Correctif : une image qui lit l'horloge de l'effet est redessinée à chaque rafraîchissement.
    - Non-régression : `ChaosEngine.exe --check-hold vhs --expect-motion` (0/582 → 582/582).
  - **Deux curseurs dans OBS** : Studio coupe « Capturer le curseur » de la source pendant les effets à curseur
    dessiné, puis rétablit la valeur d'avant.
    - Désactivé par défaut (« Laisser ») : à activer dans Diffusion OBS.
    - OBS redémarre sa capture à chaque changement : 0 à 2 images vides (DXGI).
  - Commits `c7e8c582`, `a3f878dd`, `f3ae3b3f` (locaux).
  - Tests : moteur 36/36, Studio ciblés 34/34, page 38/38.
  - Version de test `0.1.44-chaos.6` (non installée) : GUIDE_STUDIO_CHAOS.md § 4.
- **Capture directe par « Écran » (24/11 soir, priorité d'Antoni ; Miroir validé par Antoni en chaos.5)** : un seul rendu, vu à l'écran et capturé tel quel
  par « Écran » (DXGI), sans filtre. Doc : [chaos/CAPTURE_DIRECTE.md](chaos/CAPTURE_DIRECTE.md).
  - **Cause du Miroir absent d'OBS** : sans fenêtre couvrant 90 % de l'écran, la fiche partait en mode C, dont le
    calque est exclu des captures pendant tout l'effet.
  - **Correctif** (commits `21833432` et `f0c544d5`, locaux) :
    - écran seul → toujours mode E (fenêtre du dessus en direct, reste de l'écran figé), jamais exclu ;
    - mode C seulement avec les filtres ;
    - Studio part en « Écran uniquement » ;
    - sonde du vrai chemin `chaos-bench.exe --capture-probe --engine`.
  - **Tests** : unitaires moteur 35/35, Studio ciblés 25/25, page e2e non visible 36/36.
  - **Reste** : la validation visible d'Antoni (CAPTURE_DIRECTE.md § 5), avec la version de test `0.1.44-chaos.5`
    (GUIDE_STUDIO_CHAOS.md § 4).
- **Mode C (24/11, décision d'Antoni ; alternative depuis la capture directe)** : l'écran du streamer ET la source
  gameplay « Écran » d'OBS, sans double application. Doc : [chaos/MODE_C.md](chaos/MODE_C.md).
  - **Construit** : une activation à deux sorties (le moteur calcule la partition OBS avant la première image) ; calque
    exclu des captures pendant la sortie OBS ; panneau « Diffusion OBS » ; filtres « Raptoru Chaos V2 » préparés
    seulement sur clic, avec sauvegarde, sans toucher aux V1.
  - **Prouvé hors écran** : vrai moteur avec OBS simulé, et libobs 33.0.1 sans fenêtre (parité, arrêt anticipé,
    fenêtre de validité, décalage de départ).
  - **Reste à faire, côté Antoni** : test d'exclusion visible, GO pour les filtres dans son OBS, essai contrôlé.
    Le banc 1440p attend la garde de jeu ; le flash reste « écran seulement ».
  - Version de test `0.1.44-chaos.4` (non installée) : [chaos/GUIDE_STUDIO_CHAOS.md](chaos/GUIDE_STUDIO_CHAOS.md) § 4.
- **Chaos sur la source gameplay d'OBS seulement** (24/11, demande d'Antoni : webcam et alertes intactes) : étude et
  prototype, [chaos/OBS_SOURCE_GAMEPLAY.md](chaos/OBS_SOURCE_GAMEPLAY.md).
  - Architecture retenue : filtres obs-shaderfilter sur « Écran », shaders du moteur réécrits, logique en partition
    (`ChaosEngine.exe --obs-export`).
  - 12 effets sur 13 vérifiés dans le vrai moteur d'OBS 33.0.1 sans fenêtre (`chaos-obs-check.exe`) ; flash à venir.
  - Rien de touché dans l'OBS d'Antoni ; banc 1440p en attente de la garde de jeu.
- **Études OBS** (aucune modification d'OBS) : [chaos/ETUDE_OBS_WASTED.md](chaos/ETUDE_OBS_WASTED.md) (ralenti global +
  rattrapage) et [chaos/ETUDE_OBS_REPLAY.md](chaos/ETUDE_OBS_REPLAY.md) (replay des dernières secondes).
- **Studio installé** : `0.1.44-chaos.3` (installée par Antoni le 24/11).
  - **Version de test `0.1.44-chaos.3`** (polissage + Performance Lab) : construite, **non installée, non publiée**.
  - Chemin, empreinte, essais et protocole Overwatch + OBS : [chaos/GUIDE_STUDIO_CHAOS.md](chaos/GUIDE_STUDIO_CHAOS.md)
    § 4.
  - L'installation est faite par Antoni.
- **Tests passés** :
  - 34 tests unitaires du moteur ;
  - 23 tests Studio Chaos, dont le Performance Lab et les propriétés des effets mesurées hors écran par le vrai
    moteur (paupières 100 % fermées à toutes les proportions d'écran, niveaux du brouillard, dégradé du tunnel) ;
  - parcours de la page sans affichage : 30/30.
- **Non lancés** (garde de jeu, plein écran au premier plan) :
  - tout essai visible ;
  - le vrai banc GPU (seul le banc de fumée a tourné) ;
  - les essais en jeu et dans OBS ;
  - le banc de compatibilité OBS du mode E.
- **Règle** : aucun essai visible (calque, rotation, banc, curseur) pendant qu'un jeu tourne. La garde le refuse ;
  `--autorise-pendant-un-jeu` seulement sur accord d'Antoni.
- **Prochaine étape** :
  1. installer `0.1.44-chaos.3` ;
  2. vérifier la barre des tâches dans l'effet, à l'écran et dans OBS (capture d'écran) ;
  3. refaire les essais du clignement, du brouillard (Occultant), du tunnel, du flash et de l'écran ivre ;
  4. lancer le banc hors écran du Performance Lab, jeu fermé ;
  5. faire la validation en jeu sur Overwatch avec OBS (protocole : [chaos/PERFORMANCE_LAB.md](chaos/PERFORMANCE_LAB.md)
     § 4) ;
  6. ensuite, le lot 2 (achat par les viewers, Core) et un prototype OBS isolé si Antoni le décide.
- **Rien n'est poussé, fusionné ni publié.**

**D. Ensuite** : [ROADMAP.md](ROADMAP.md) § 0.2 (validations réelles en attente, finitions Studio).

**C bis. Chaos V2 côté viewer : module « Interactions » (26–28/11)** — [chaos/EXTENSION_INTERACTIONS.md](chaos/EXTENSION_INTERACTIONS.md).
**Interface validée par Antoni le 28/11** (plus de refonte). Dernière passe 28/11 : achats sans confirmation (case
visible), 60 s (réglage Studio seulement, § 5), plein écran (§ 5 bis : le moteur ne refuse qu'un vrai exclusif
Windows), remboursements automatiques et journal (§ 10 bis), aperçus Brouillard / Paupières / Tunnel / Tremblement,
proposition de tarifs ([chaos/TARIFS_PROPOSITION.md](chaos/TARIFS_PROPOSITION.md)). **Suite : § 12, vrais effets
depuis l'extension de test (sur GO d'Antoni).**
Direction validée le 26/11 ; finitions 27/11 et 28/11 : effets, préréglages et contrôles réels du registre,
prix selon la gêne, crédits (popover compact), « Conditions », achats répétés sans fermer la fiche, charges d'« Un
clignement », glissière Flou, fluidité ; modération FX dans la **vraie console D4** (point d'extension générique) et
**bouclier** générique des modérateurs dans le shell ; badge « Tombola » compact. Interactions = Lab seulement, faux Core ;
shell modifié sur la même branche locale `feat/ext-interactions` (worktree `agent`), non poussée, aucun ZIP. Aperçu :
`apps/twitch-extension/Apercu Effets live.cmd`. Travaux Studio / moteur / Core : § 13 ; décisions : § 16 ; pont de test
local : § 12. Chaos V2 lui-même : branche `feat/chaos-studio`.

**C ter. Trois correctifs extension (26/11)** — [extension/CORRECTIFS_2026-11-26.md](extension/CORRECTIFS_2026-11-26.md) :
solde Mini-jeux à 4 chiffres (`0d295667`), raccourci « Tombola ouverte » partout (`6d894bbc`), « conditions » = écran de
Twitch (mentions avant publication listée), aucun code. Même branche locale, non poussée ; aucun ZIP construit.

**D. Soundboard : ajouter un son depuis Studio (23/11)** — [SOUNDBOARD.md](SOUNDBOARD.md) § 3. PR #126 fusionnée
(`408f201a`). **Core `408f201a` déployé le 23/11 (déploiement lancé à 16:44 UTC)** (migration `20261205130000_sound_files.sql` appliquée,
sauvegarde Coolify 16:43:40 UTC, retour arrière `deploy core 2a41e06e… --rollback --go`) ; la réaction blackjack r6
(ICANT, réservée aux abonnés, PR #122) part avec, sur GO d'Antoni. Bot non redéployé. **Studio 0.1.44 Soundboard
construit, NON publié** (artefact `raptoru-studio-0.1.44` du run 45220697767, conservé jusqu'au 21/02/2027) : le Studio
installé est `0.1.44-chaos.1` (chantier Chaos, autre session) ; ne rien installer par-dessus. Soundboard et Chaos sont
réunis dans le build de test commun `0.1.44-chaos.2` (24/11, non installé : § C). Finitions Casino du 23/11
fusionnées (PR #127, `ed70a107`). **ZIP consolidé** Soundboard + Casino (36 commits, sans diagnostic actif, Hosted Test
seulement) : inventaire `INVENTAIRE-ed70a107018f.md` en attente de la ligne de validation d'Antoni.

**E. Casino vide sur téléphone : corrigé (24/11)** — cause : l'application Twitch ouvre `mobile.html` avec
`anchor=component`, lu comme surface « video » ([CASINO.md](CASINO.md) § composition). Correctif `app/layout.js`
validé par Antoni sur son vrai téléphone (banc mobile, build `banc-mobile-d4322f2213f5`). Branche
`fix/ext-mobile-surface` (PR vers `main`) : correctif + tests + banc mobile ([extension/BANC_MOBILE_TWITCH.md](extension/BANC_MOBILE_TWITCH.md)).
ZIP de Production `9da1d323642f` (37 commits = ZIP consolidé du 23/11 + ce correctif) : inventaire
`INVENTAIRE-9da1d323642f.md` en attente de la ligne de validation d'Antoni. Les mesures de diagnostic supplémentaires
restent sur la branche locale `diag/casino-mobile-vide`, hors livraison.

## 6. Comment reprendre dans une nouvelle session

1. Lire ce fichier (§ 0, § 5), puis [../CLAUDE.md](../CLAUDE.md) et [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) § 0.
2. Lancer les commandes du § 4 ; comparer avec le § 5.1.
3. [ROADMAP.md](ROADMAP.md) § 0 (priorités, pauses) et § 1 (état de chaque module).
4. Au besoin, [PROJECT_STATUS.md](PROJECT_STATUS.md) (versions, tests, problèmes ouverts, actions d'Antoni).
5. Le document du module visé ([README.md](README.md) § 4), puis son code via
   [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md).
6. Créer une branche dans le worktree `agent` (`git fetch` puis `git switch -c <branche> origin/main`) et y travailler.
7. Avant de s'arrêter : mettre ce fichier à jour, court ; le détail daté va dans `archive/` ou le journal du chantier.

**Principes de travail (décidés par Antoni ; détail : [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md))** :

- lire ce checkpoint avant de travailler ; ne pas refaire un audit, une recherche ou une analyse déjà enregistrés
  (sauf si le code a changé depuis) ;
- privilégier les modifications concrètes, en grands lots autonomes ; décider seul des questions techniques
  ordinaires ; pas de validation intermédiaire inutile ;
- tests ciblés pendant le travail, puis vérifications d'intégration pertinentes avant la livraison ; la CI de `main`
  fait les suites complètes ; pas de batteries de tests sans nécessité ;
- attendre la CI en arrière-plan ; une instabilité connue sans rapport : une seule relance, signalée ;
- travailler dans les worktrees, jamais nettoyer ni réinitialiser le checkout principal ;
- respecter les autorisations propres à la Production et aux opérations sensibles (§ 2) : un GO vaut pour l'étape
  nommée, pas pour la suivante.

**Si on change de modèle ou d'outil** : ce fichier et [REPRISE_CHATGPT.md](REPRISE_CHATGPT.md) suffisent comme
contexte ; ne pas refaire une analyse qu'un document enregistre, sauf si le code a changé depuis.

## 7. À ne jamais rejouer ni faire

- **Restauration des niveaux du 20/11** : ne pas la rejouer, ni l'annuler, ni recalculer ses XP. Ne pas rétablir les
  annulations « normalisation » ou « import ».
- Rejouer la normalisation WizeBot du 15/11, l'import économique du 20/10 ou une migration déjà appliquée.
- Toucher aux soldes de Jetons hors d'un parcours prévu ; régénérer un ZIP de l'extension sans changement de code.
- Activer le Hosted Test sur `raptoru_` pendant un live ; téléverser ou publier l'extension à la place d'Antoni.
- Lancer `npm run studio` ou `git clean` / `reset` / `checkout .` dans le checkout principal.
- Réactiver SAMMI ou SE.Live ; modifier une scène, une source OBS ou un overlay StreamElements sans GO ; recopier une
  URL d'overlay StreamElements.
- Présenter un test automatique, un déploiement, un ZIP construit ou un Hosted Test comme une validation ou une
  publication.
- Relancer le projet suspendu de personnalité IA de LeCroupier_ ([ROADMAP.md](ROADMAP.md) § 6).

## 8. Risques connus

- Casino : `CASINO_EXTENSION=on` ouvre le Casino à tous au moment même de la publication Twitch (§ 5.4 B, point 2).
- Chatbox : les copies locales des widgets ne sont pas prouvées identiques au code hébergé chez StreamElements
  ([CHATBOX.md](CHATBOX.md) § 3).
- Checkout principal très en retard : sa mise à jour demande un GO et une sauvegarde des données de Studio.
- Copies de la base hors VPS seulement manuelles ([BACKUPS.md](BACKUPS.md)).
- Deux fenêtres plein écran permanentes de Studio (Halloween, Chaos V1) si « Overlay actif » est allumé.
- Tests : plantage vitest Windows 0xC0000409 sous charge ; E2E instables connus, dont `progression-v2-level-up`
  ([AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)).
- Détail : [PROJECT_STATUS.md](PROJECT_STATUS.md) § 9.
