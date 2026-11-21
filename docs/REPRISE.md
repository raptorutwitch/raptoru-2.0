# Reprise : point d'entrée unique (Claude Code, Codex, ChatGPT ou autre)

**Checkpoint global du 20/11/2026** (mandat d'Antoni « Checkpoint global & roadmap »). À lire **en premier**, puis
vérifier l'état soi-même (§ 4). Les règles de [`../CLAUDE.md`](../CLAUDE.md) priment sur tout outil ou plugin.
Version précédente de ce fichier (11 → 20/11) :
[archive/REPRISE_2026-11-11_2026-11-20.md](archive/REPRISE_2026-11-11_2026-11-20.md). Résumé à coller dans une
conversation ChatGPT : [REPRISE_CHATGPT.md](REPRISE_CHATGPT.md).

## 0. Résumé compact

```text
Raptoru 2.0 — checkpoint du 20/11/2026 (source : docs/REPRISE.md, dépôt public raptorutwitch/raptoru-2.0, branche main)
Plateforme de stream auto-hébergée du streamer Twitch raptoru_ (id 83603689). Antoni décide seul.
Le Core décide (données, Jetons, règles), le bot LeCroupier_ parle à Twitch, Raptoru Studio (Electron, PC d'Antoni)
pilote OBS, l'extension Twitch et raptoru.fr parlent aux viewers. SAMMI abandonné. Dépôt public : aucun secret.

Production (relevé du 20/11, 16:00 UTC) : Core 1f05b97c, bot 2c04a5db (un seul bot actif), Studio 0.1.42 publié ET
installé, extension publique be1744e75f63 (prouvée par Antoni dans la console Twitch le 20/11).
Casino V1 (4 jeux) : Core déployé, CASINO_EXTENSION=on, casino.open=1, 4 jeux ouverts, refusé hors live
(stream_offline). L'extension publique NE contient PAS le Casino. Post-live du 21/11 : lots A + B, machines à faible
hauteur, passe de nuit, passe de composition et passe corrective fusionnées (PR #99, #100, #102, #103, #105, #107 ;
extension seule, Core inchangé) ; ZIP suivant ecaa5841eb61 PAS ENCORE ÉCRIT : son inventaire (15 commits) attend la ligne d'Antoni (remplacera
76875d47e728). Banc : npm run casino:bench -w @raptoru/twitch-extension — par défaut la VRAIE extension (en-tête,
Mini-jeux) jouable en démo locale (CASINO.md § 14-17) ; test:casino-compose mesure la composition dans ce cadre.
Ne pas dire « Casino disponible pour tous ».
Niveaux : restauration WizeBot EXÉCUTÉE le 20/11 (432 comptes, définitive, NE JAMAIS LA REJOUER) ; badges tous les
25 niveaux ; anciennes annulations bloquées (Core 410 + Studio) ; rattachements WizeBot futurs non compressés.
Suspendu : personnalité IA de LeCroupier_ (ne rien proposer). Prochaines tâches : docs/REPRISE.md § 5.4.
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
[INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md).

## 2. Limites d'autonomie

Sans GO explicite d'Antoni pour l'étape (un mandat écrit peut le donner pour un lot entier) :

- **Production, Twitch, OBS** : push, fusion, déploiement Coolify, migration distante, variable ou drapeau,
  redémarrage, release ou installation de Studio, publication ou Hosted Test de l'extension, console Twitch, OBS,
  StreamElements, Spotify, Wallet (soldes, crédits, remboursements, sanctions), messages dans le vrai chat.
- **Destruction** : `git clean`, `reset --hard`, `checkout .`, réécriture d'historique, suppression de branche, de
  worktree, de sauvegarde, de média ou de données de Studio.
- **Contenu métier** : ne jamais inventer défis, montants, récompenses ni cosmétiques.
- **Dépôt public** : aucun secret, `.env`, jeton, dump, journal ni donnée de viewer ([../SECURITY.md](../SECURITY.md)).
- Une garde automatique qui refuse une opération ne se contourne pas : signaler l'action manuelle précise. Lancer un
  installateur de Studio est refusé par la garde : c'est Antoni qui installe.

Registre des décisions et de leurs raisons : [DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md). Méthode :
[AGENT_WORKFLOW.md](AGENT_WORKFLOW.md).

## 3. Où travailler sans rien casser

- **Checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0`** : c'est le **dossier de données du Studio installé**
  (`.env`, jetons Twitch, `apps/studio/server/.runtime`). Il est sur `main` local `11ffe3f9`, **683 commits derrière**
  `origin/main` (20/11), avec 88 entrées dans `git status`. On n'y travaille pas, on ne le nettoie pas, on n'y lance
  jamais `npm run studio`. Lire un document à jour depuis là : `git show origin/main:<chemin>`.
- **Worktrees** : uniquement dans `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\<nom>` (27 au 20/11), créés
  depuis `origin/main`. `agent` (réutilisable ; garde les ZIP de l'extension sous `apps/twitch-extension/release/`)
  et `levels` (dernier chantier) sont à jour. Carte : [WORKSPACES.md](WORKSPACES.md) ; nettoyage proposé :
  [CLEANUP_LATER.md](CLEANUP_LATER.md).
- **Branche de référence : `main`** (GitHub `raptorutwitch/raptoru-2.0`). Une PR par lot, CI verte avant fusion.
- **Dossiers à ne jamais déplacer ni supprimer** : `Documents\Sauvegarde Raptoru 2.0`, `Documents\OBS-Backups`,
  `Documents\Raptoru 2.0 - Livraisons`, `Documents\Raptoru\_migration-exports\` (exports privés des niveaux, hors Git).
- **Ports du Studio installé** : 4100 (serveur et lecteurs OBS), 4110 (Dock), 3789. Tests : 4389–4399 (E2E),
  4471–4482 (banc de l'extension). OBS WebSocket : 4455.
- **Tester sans toucher la Production** : `npm run studio:lab` depuis un worktree.

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

# Extension : version publique déclarée et ZIP du Hosted Test Casino
cat apps/twitch-extension/PUBLISHED
sha256sum "C:/Users/Antoni/Documents/Raptoru 2.0 - Worktrees/agent/apps/twitch-extension/release/raptoru-live-PRODUCTION-2e2eaf3ae34a-depuis-be1744e-8-commits-shell-v2.zip"
```

Un écart avec le § 5 veut dire que quelqu'un a agi depuis : le comprendre avant d'agir. La version publique de
l'extension se prouve dans la console Twitch (Antoni) ou en live par F12 › `shared/runtime-config.js` › `buildId`.

## 5. État exact au 20/11/2026

### 5.1 Versions (relevé du 20/11, ~16:00 UTC)

| Élément                      | Valeur                                                                                                                                                                         | Preuve                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `origin/main`                | `5ebf395e` (PR #95) ; dernier code `1f05b97c` (PR #94)                                                                                                                         | `git log`                         |
| Core                         | **`1f05b97c`**, déployé le 20/11 15:47 UTC (déploiement `v647t4hullbip5ezaqzx7khq`), `/health` et `/ready` OK ; aucune migration depuis Casino V1                              | `coolify-deploy.mjs status core`  |
| Bot                          | **`2c04a5db`** (16/11), actif, seul bail                                                                                                                                       | `status bot`                      |
| Studio                       | **0.1.42 publié (Latest) et installé** (`build-info.json` : 0.1.42, `1f05b97c`)                                                                                                | lu le 20/11                       |
| Extension publique           | **`be1744e75f63`** (shell v2, 95 commits depuis `0bf7907` : Level Up V2, mini-profil, Commandes V2.1, Mini-jeux V5, Music Hub), prouvée par Antoni le 20/11                    | `apps/twitch-extension/PUBLISHED` |
| Extension Hosted Test        | ZIP `raptoru-live-PRODUCTION-2e2eaf3ae34a-depuis-be1744e-8-commits-shell-v2.zip`, SHA-256 `df177a48…f1436868` (Casino, 8 commits), inventaire `298e940290ab` validé par Antoni | `Worktrees\agent\…\release\`      |
| Drapeaux du Core             | `CASINO_EXTENSION=on`, `MUSIC_HUB_EXTENSION=on`                                                                                                                                | API Coolify, lecture seule, 20/11 |
| Dernière sauvegarde manuelle | 20/11 15:28:18 UTC, `success`, 12 310 947 octets (avant le déploiement `1f05b97c`)                                                                                             | API Coolify                       |
| Retour arrière Core          | `node scripts/coolify-deploy.mjs deploy core 18a4b04828b1f214bb6122214d4dfc142a1d396f --rollback --go`                                                                         | livraison du 20/11                |

### 5.2 Casino V1 : développé et déployé côté Core ; ni essayé en réel, ni public

- **Code** : machine à fruits + Coffre du Raptor, roulette, machine à émotes, blackjack multijoueur (10 places par
  table, 8 tables au plus, spectateurs). Core `apps/core-api/src/casino/`, 4 migrations Casino appliquées le 20/11,
  Studio › Casino. PR #90 (`18a4b048`, déployé le 20/11 au matin), inventaire et release PR #93. Tests automatiques :
  parité des règles avec les prototypes (20 000 mains, 3 000 tours), concurrence sur vrai PostgreSQL, contrôle
  Chromium sur un Core local. Journal : [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md) ; module :
  [CASINO.md](CASINO.md).
- **Réglages en Production (relevés le 20/11)** : `casino.open=1`, les 4 jeux à 1 ; machine 20–10 000 Jetons ;
  émotes 20–1 000 ; roulette 100 000 max par tour (ALL-IN limité au plafond du tour) ; blackjack mise principale
  100 min, gain net 1 000 000 max par manche, paris annexes 100 000 max ; gain max par partie 1 000 000 ; partage dans
  le chat toutes les 300 s ; annonce de table toutes les 600 s ; annonces automatiques des gros gains **coupées**.
- **Garde conservée** : le Core refuse tout jeu hors live (`stream_offline`), avant tout débit.
- **Visibilité** : l'extension publique `be1744e75f63` ne contient pas le Casino. Avec `CASINO_EXTENSION=on`, **tous**
  les viewers le verront dès la publication de la version Casino.
- **Non fait** : aucune partie réelle avec de vrais viewers, aucune revue Twitch.

### 5.3 Progression, WizeBot et badges : clos le 20/11

- **Restauration exécutée le 20/11** (sauvegarde 12:57:26 UTC) : 1 159 comptes examinés ; **432 restaurés** (363
  WizeBot, 69 touchés par l'ancienne courbe) ; **3 441 niveaux rendus** (3 307 WizeBot, 134 courbe), niveau max
  60 → 141 ; 727 inchangés ; aucun badge perdu, aucun nouveau badge nécessaire ; 0 annonce, 0 message ; Semaine et
  Mois intacts ; rejeu complet = 0 changement (clés `wb-restore-v1-<id>`, `curve-restore-v1-<id>`).
- **Règles en vigueur** : 1 000 XP par niveau ; un message récompensé au plus toutes les 120 s ; badges sub tous les
  **25 niveaux** ; l'XP gagnée depuis la migration est conservée.
- **Sécurisation (PR #94, Core `1f05b97c`, Studio 0.1.42)** : « Annuler la normalisation » et « Annuler l'import »
  retirés de Studio ; le Core répond 410 (`level_v2_revert_disabled`, `import_revert_disabled`). Un historique WizeBot
  rattaché plus tard compte son niveau entier + l'XP gagnée entre-temps, une seule fois (clé `import:wizebot:<id>`).
- **Vérifié après déploiement** : les 432 comptes identiques avant et après (XP, niveaux, badges) ; 49 événements de
  Level Up, aucun nouveau. Un vrai rattachement futur n'est couvert que par les tests automatiques.
- **Traces privées, hors Git** : exports, plan, journaux et fichier de retour arrière (mode « retirer », mêmes
  montants) dans `Documents\Raptoru\_migration-exports\levels-2026-11-20\` (`restauration\`). Détail :
  [LEVEL_UP_V2.md](LEVEL_UP_V2.md) § 14–15.

### 5.4 Prochaines tâches (ordre réel)

Le Hosted Test ne permet **pas** un essai avec de vrais viewers sur `raptoru_` en live (il retire l'extension aux
non-testeurs, [CASINO.md](CASINO.md) § 6) et le Casino refuse hors live. D'où l'ordre :

0. **Antoni (21/11)** : essayer le banc (`npm run casino:bench -w @raptoru/twitch-extension`, mode « Extension
   complète ») ou regarder les captures (`Documents\Raptoru 2.0 - Livraisons\2026-11-21-casino-correctifs`), puis
   ajouter sa ligne à `apps/twitch-extension/release-inventory/INVENTAIRE-ecaa5841eb61.md` ; l'agent écrit alors le ZIP
   `ecaa5841eb61` (`package:production -- --shell v2`) et donne son SHA-256. Il remplace `76875d47e728`.
1. **Antoni** : vérifier ce ZIP en Hosted Test, **hors live**, sur un compte testeur (affichage, état « hors live »,
   navigation), y compris dans l'**application** Twitch du téléphone (portrait et paysage) : console › vue mobile
   activée pour cette version ; jamais le navigateur mobile, où Twitch n'affiche aucune extension.
2. **Antoni (décision)** : avant la publication, choisir `CASINO_EXTENSION=testers:<ids>` (essai réel restreint pendant
   un live, recommandé) ou garder `on` (ouvert à tous dès la publication).
3. **Antoni** : soumettre cette version à la revue Twitch (8 à 14 jours, une soumission à la fois).
4. Après approbation : publier, mettre à jour `PUBLISHED` (agent, commit), puis **essai réel en live** : mises, gains,
   remboursements, spectateurs, blackjack à plusieurs.
5. Corriger **uniquement** les problèmes observés ; passer `CASINO_EXTENSION=on` si l'accès était restreint.
6. Ensuite : [ROADMAP.md](ROADMAP.md) § 0.2.

## 6. Comment reprendre dans une nouvelle session

1. Lire ce fichier (§ 0, § 5), puis [../CLAUDE.md](../CLAUDE.md) et [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) § 0.
2. Lancer les commandes du § 4 ; comparer avec le § 5.1.
3. [ROADMAP.md](ROADMAP.md) § 0 (priorités, pauses) et § 1 (état de chaque module).
4. Au besoin, [PROJECT_STATUS.md](PROJECT_STATUS.md) (versions, tests, problèmes ouverts, actions d'Antoni).
5. Le document du module visé ([README.md](README.md) § 4), puis son code via
   [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md).
6. Créer un worktree (`git worktree add "../Raptoru 2.0 - Worktrees/<nom>" -b <branche> origin/main`) et y travailler.
7. Avant de s'arrêter : mettre ce fichier à jour, court ; le détail daté va dans `archive/` ou le journal du chantier.

**Si on change de modèle ou d'outil** : ce fichier et [REPRISE_CHATGPT.md](REPRISE_CHATGPT.md) suffisent comme
contexte ; ne pas refaire une analyse qu'un document enregistre, sauf si le code a changé depuis.

## 7. À ne jamais rejouer ni faire

- **Restauration des niveaux du 20/11** : ne pas la rejouer, ni l'annuler, ni recalculer ses XP. Ne pas rétablir les
  annulations « normalisation » ou « import ».
- Rejouer la normalisation WizeBot du 15/11, l'import économique du 20/10 ou une migration déjà appliquée.
- Toucher aux soldes de Jetons hors d'un parcours prévu ; régénérer un ZIP de l'extension sans changement de code.
- Activer le Hosted Test sur `raptoru_` pendant un live.
- Lancer `npm run studio` ou `git clean` / `reset` / `checkout .` dans le checkout principal.
- Réactiver SAMMI ou SE.Live ; modifier une scène ou une URL de source OBS sans GO.
- Présenter un test automatique, un déploiement, une publication ou un Hosted Test comme une validation.
- Relancer le projet suspendu de personnalité IA de LeCroupier_ ([ROADMAP.md](ROADMAP.md) § 6).

## 8. Risques connus

- Casino : `CASINO_EXTENSION=on` ouvre le Casino à tous au moment même de la publication Twitch (§ 5.4, point 2).
- Checkout principal très en retard : sa mise à jour demande un GO et une sauvegarde des données de Studio.
- Copies de la base hors VPS seulement manuelles ([BACKUPS.md](BACKUPS.md)).
- Deux fenêtres plein écran permanentes de Studio (Halloween, Chaos V1) si « Overlay actif » est allumé.
- Tests : plantage vitest Windows 0xC0000409 sous charge, E2E instables connus ([AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)).
- Détail : [PROJECT_STATUS.md](PROJECT_STATUS.md) § 9.
