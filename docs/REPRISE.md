# Reprise : point d'entrée unique (Claude Code, Codex, ChatGPT ou autre)

**Checkpoint du 22/11/2026 : fin du Casino V1, transition vers les Chatbox** (mandat d'Antoni « Checkpoint final
Casino V1 et transition Chatbox »). À lire **en premier**, puis vérifier l'état soi-même (§ 4). Les règles de
[`../CLAUDE.md`](../CLAUDE.md) priment sur tout outil ou plugin. Version précédente de ce fichier (20 → 22/11) :
[archive/REPRISE_2026-11-20_2026-11-22.md](archive/REPRISE_2026-11-20_2026-11-22.md). Résumé à coller dans une
conversation ChatGPT : [REPRISE_CHATGPT.md](REPRISE_CHATGPT.md).

## 0. Résumé compact

```text
Raptoru 2.0 — checkpoint du 22/11/2026 (source : docs/REPRISE.md, dépôt public raptorutwitch/raptoru-2.0, branche main)
Plateforme de stream auto-hébergée du streamer Twitch raptoru_ (id 83603689). Antoni décide seul.
Le Core décide (données, Jetons, règles), le bot LeCroupier_ parle à Twitch, Raptoru Studio (Electron, PC d'Antoni)
pilote OBS, l'extension Twitch et raptoru.fr parlent aux viewers. SAMMI abandonné. Dépôt public : aucun secret.

Production (relevé du 22/11, 00:54 UTC) : Core a94d1081 (sain), bot 2c04a5db (un seul bot actif), Studio 0.1.42
publié ET installé (relevé du 20/11), extension publique be1744e75f63 (prouvée par Antoni le 20/11), main 302db793.
Casino V1 : développement TERMINÉ et fusionné (PR #90 → #115, #111, #113) ; Core a94d1081 DÉPLOYÉ le 22/11 00:39 UTC
(nouvelles tables + réactions ; aucune migration ; retour arrière Core 1f05b97c) ; réglages ouverts, refus hors live.
ZIP PRÊT À PUBLIER, PAS téléversé (aucune preuve) : raptoru-live-PRODUCTION-d09fd03aa844-depuis-be1744e-20-commits-shell-v2.zip,
SHA-256 1ec79c2adc15c242f66da51d226726fd9ef9abd381d6b753f8734d8b66d76039 (inventaire 2411c992b26b validé par Antoni).
L'extension publique NE contient PAS le Casino ; aucune partie réelle avec de vrais viewers. Ne pas dire « Casino
disponible pour tous ». Gestes restants : Antoni (Hosted Test, revue Twitch) — § 5.4.
PRIORITÉ DE DÉVELOPPEMENT : remplacer les 3 chatbox StreamElements (Just Chatting, React, Dessin) par une chatbox
Raptoru. Architecture validée et spécification complète le 22/11 ; jalon 1 (prototype Lab + démonstration) en cours :
docs/CHATBOX.md (+ rapport et présentation privés hors Git). Sources OBS, StreamElements, Production : sans GO, rien.
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
| Core                   | **`a94d1081`**, déployé le 22/11 00:39 UTC (déploiement `5wucyqh9ekhb8i3ehgllxldu`), `/health` et `/ready` OK ; aucune migration depuis Casino V1                                                                                                              | `coolify-deploy.mjs status core`                 |
| Bot                    | **`2c04a5db`** (16/11), actif, seul bail (vu par le Core le 22/11)                                                                                                                                                                                             | `status core`                                    |
| Studio                 | **0.1.42 publié (Latest) et installé** (relevé du 20/11 ; les interrupteurs des réactions du Casino viendront avec une prochaine version)                                                                                                                      | `build-info.json`                                |
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
2. Jalon en cours : CHATBOX.md § 10 (prototype Lab sur la branche `feat/chatbox-lab`, worktree `agent`).
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

**C. Chaos V2 (« Chaos Overlay », que tu appelles aussi « KO Overlay »)** : moteur, curseur retourné et catalogue
d'effets construits les 22 et 23/11, en local.

- **Où** : branche locale `feat/chaos-engine` (après `feat/chaos-presenter-lot1`), worktree
  `Raptoru 2.0 - Worktrees\chaos-v2`. Lancer : `npm run chaos:lab` (recompile moteur et page).
- **Quoi** :
  - moteur natif C# ([apps/chaos-engine](../apps/chaos-engine/README.md)) : registre partagé, configuration,
    ordonnanceur, transitions, capture partagée sans copie, rendu cadencé par écran, profils de performance, gardien,
    Ctrl+Maj+F11 ([chaos/ARCHITECTURE_MOTEUR.md](chaos/ARCHITECTURE_MOTEUR.md),
    [chaos/PERFORMANCES_MOTEUR.md](chaos/PERFORMANCES_MOTEUR.md)) ;
  - **retournement 180° = calque GPU + curseur retourné** (décision d'Antoni du 23/11, essai Overwatch fluide) : le
    curseur de Windows est masqué au-dessus de la cible et son image est redessinée au point miroir, entrées intactes
    ([chaos/ETUDE_CURSEUR.md](chaos/ETUDE_CURSEUR.md)) ;
  - rotation native de Windows **expérimentale, coupée**, jamais pour une activation communautaire ;
  - **page Studio › Chaos = catalogue d'effets** : une carte et une fiche par effet (écran gauche / droit / tous,
    durée, transitions, paramètres, curseur, disponibilité), Tester et Activer / Arrêter, états du moteur
    ([chaos/GUIDE_STUDIO_CHAOS.md](chaos/GUIDE_STUDIO_CHAOS.md)).
- **Tests** : 27 unitaires ; 17 contrôles sans écran ; curseur hors écran 8/8 ; 11 Studio ; parcours de la page sans
  affichage 12/12. **Non lancés** (garde de jeu, jeu ou plein écran actif) : contrôles visibles, `--cursor-check`,
  banc A/B, `--obs-compat`, partie visible du parcours.
- **Règle** : aucun essai visible (mire, calque, rotation, banc, curseur) pendant qu'un jeu tourne. La garde le refuse ;
  `--autorise-pendant-un-jeu` seulement sur accord d'Antoni.
- **Prochaine étape** : essais d'Antoni sur la nouvelle page (Tester / Activer sur l'écran choisi, C1 à C5 de
  [chaos/PROCEDURE_TESTS.md](chaos/PROCEDURE_TESTS.md)) ; mesures visibles quand aucun jeu ne tourne ; puis les
  nouveaux effets, conçus séparément, et le lot 2 (module payant, Core).
- **Rien n'est poussé, fusionné ni publié** : aucun Studio installé ne contient la page.

**D. Ensuite** : [ROADMAP.md](ROADMAP.md) § 0.2 (validations réelles en attente, finitions Studio).

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
