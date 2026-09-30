# Raptoru 2.0 — État du projet / fichier de reprise

**Dernière mise à jour : 1er octobre 2026 — Studio 0.1.5 = dernière release publique (validée) ; HEAD fonctionnel `5b66579` (Modération V2 — parité D4 complète, Core Lab + console unique extension / Studio) implémenté, testé automatiquement et en E2E (95/95), package local construit (`release/moderation-d4`), NON validé manuellement par Antoni, NON releasé.**

> **Nouvel agent : lire d’abord [`Raptoru-2.0-HANDOFF.md`](Raptoru-2.0-HANDOFF.md)** (état courant, règles de reprise, matrice de validation, prochaine action). Ce fichier-ci garde l’historique et le détail par domaine.

## But de ce fichier
Ce fichier est la source de continuité du projet. Il doit permettre de reprendre Raptoru 2.0 dans une nouvelle conversation sans perdre :
- l’architecture validée ;
- les décisions produit ;
- les validations réellement effectuées ;
- ce qui est fini techniquement ;
- ce qui reste à migrer/repenser ;
- les règles de cutover ;
- la direction produit autour de l’extension, du site, des stats et des cosmétiques.

## État courant (résumé — détail et matrice complète dans `Raptoru-2.0-HANDOFF.md`)
Vérifié le 01/10/2026 par `git status` / `git log` et relance des tests sur le HEAD.
- **Git** : branche `main`, HEAD fonctionnel `5b66579 — feat: complete Moderation V2 with full D4 parity (Lab)`, suivi uniquement de commits de documentation. Aucun remote Git sur le repo source (rien n’est poussé), aucun tag dans le repo source. `prototypes/` présent sur disque, exclu via `.git/info/exclude`, jamais versionné ni embarqué.
- **Tests sur le HEAD** : Core 208 (7 skipped), Studio server 64, desktop 17, extension 10, bot 69 ; lint, format, typecheck verts. **E2E réel 95/95** (Electron, environnement isolé Studio 4111 / Core Lab 4311, base dédiée `raptoru_bonk_lab_modd4e2e` supprimée après usage, vrais lecteurs, vrais achats Lab EBS, clics dans la console sur Panel / Vidéo / Mobile / Moderator Window / Studio). Les scripts E2E sont restés dans le scratchpad de session : **ils ne sont pas dans le repo**.

| Élément | Statut |
|---|---|
| Studio 0.1.5 (Studio autonome + supervision Electron, Hub, Bonk V2, Soundboard V2, TTS V2 réel) | **VALIDÉ MANUELLEMENT** par Antoni, **RELEASE PUBLIQUE** (`v0.1.5`, feed `raptorutwitch/raptoru-studio-releases`), installé |
| **Modération V2 — parité D4 complète** (`5b66579`) : permissions fines par mod, sanctions sensibles, mots surveillés / bloqués, notes internes, pause globale, cooldown D4, wallet admin, stop / remboursements Soundboard, débit Bonk, Tombola V2 minimale, historiques Core ; console unique extension + Studio | **IMPLÉMENTÉ + TEST AUTOMATISÉ + E2E 95/95**, **PACKAGE LOCAL À VALIDER** : `apps/studio/desktop/release/moderation-d4/win-unpacked/Raptoru Studio.exe`, **NON VALIDÉ MANUELLEMENT**, **NON RELEASE** |
| Correctif « Effacer le cooldown TTS » + message `viewer_busy` (`890e71d`), conservé sur le modèle cooldown D4 | **IMPLÉMENTÉ + TEST AUTOMATISÉ + E2E**, **NON VALIDÉ MANUELLEMENT**, **NON RELEASE** |
| Consoles précédentes (`12ffdd0` simplifiée, `a5b5d5e` mini-passe) et packages `release/mini-d4`, `release/win-unpacked` | **REMPLACÉES / OBSOLÈTES** — ne pas tester |
| Lecture TTS pouvant démarrer avant la fin du shuffle / reveal de l’extension | **DETTE CONNUE** |
| Badges VIP / Sub, mouvements automatiques du Wallet réel, synchro ban / timeout Twitch, pop-out Twitch réel | **DÉPENDANCES EXTÉRIEURES** (API Twitch broadcaster non autorisée, cutover économie non décidé, publication extension interdite) |
| Tombola | **Tombola V2 minimale dans Core** (modèle réel : inscription gratuite, cagnotte, tirage Studio) ; écran viewer inchangé ; lancement automatique / Big Tombola legacy non migrés |
| Décisions de modération | **Tranchées le 30/09** (voir § « Modération V2 — parité D4 complète ») |
| Production | SAMMI + StreamElements (+ ancienne extension publiée) ; aucun cutover, aucune migration prod |

Il ne faut pas utiliser le mot **« terminé »** de façon ambiguë. Distinguer systématiquement :
1. **Core / moteur techniquement validé** ;
2. **feature fonctionnelle migrée et prête** ;
3. **activée en production**.

---

# 1. Règles de travail verrouillées

- Toujours auditer l’existant avant de modifier.
- Identifier le workspace canonique et le dernier état réellement utilisé avant toute action.
- Correctifs minimaux et causaux ; éviter les refactors opportunistes.
- Tester les non-régressions.
- Ne pas déployer ni pousser sans validation explicite.
- Aucun cutover partiel juste parce qu’un module est techniquement valide.
- **SAMMI + StreamElements restent la production/référence jusqu’au feu vert GLOBAL.**
- Raptoru 2.0 peut être entièrement construit, branché et testé en parallèle.
- Les flags de crédit/chat réels restent OFF tant que le cutover global n’a pas lieu.
- Ne jamais committer `.env`, tokens OAuth, secrets ou fichiers runtime.
- Le Core est la source de vérité métier et économique.
- Le Twitch Bot reste un adaptateur fin Twitch → Core.
- Le Studio est le cockpit local streamer, pas un moteur de logique métier.
- Une logique métier ne doit exister qu’une seule fois dans Core.
- Ne pas recréer SAMMI sous forme d’un moteur générique/DSL de workflows.
- Les données historiques StreamElements (soldes, stats utiles, etc.) seront importées **à la toute fin**, juste avant le cutover, pour éviter qu’elles deviennent obsolètes pendant que les viewers continuent d’utiliser l’ancien système.

## Règles de reprise (texte complet : `Raptoru-2.0-HANDOFF.md` § 0)
- **Prototype = spécification**, pas inspiration : toute migration commence par une matrice `élément prototype | backend existe | porté | adaptation | bloqué` ; rien n’est supprimé, simplifié ou remplacé silencieusement ; une limitation backend reste une limitation backend (élément visible, désactivé, marqué).
- **Validation** : distinguer code / tests auto / E2E / validation manuelle Antoni / package local / release publique. Ne jamais écrire « validé » pour ce qu’Antoni n’a pas testé.
- **Pas de simulation présentée comme backend réel.** Pas de logique métier dans l’extension.
- **Pas de push, pas de tag, pas de `npm run studio:release` sans validation explicite d’Antoni.**

---

# 2. Workspace et stack

## Workspace canonique
`C:\Users\Antoni\Documents\Raptoru 2.0`

## Stack
- monorepo npm workspaces + Turborepo ;
- Node 22 ;
- TypeScript strict ;
- Electron pour Studio ;
- Core API ;
- Twitch Bot ;
- Postgres local via Docker ;
- Supabase/Postgres dans l’architecture serveur ;
- Twitch EventSub / Helix ;
- obs-websocket v5, local et réservé au Studio.

## Architecture cible

### Core API
Cerveau/source de vérité :
- Wallet ;
- Loyalty ;
- Daily ;
- Presence ;
- interactions futures ;
- jeux futurs ;
- stats ;
- achievements/cosmétiques futurs ;
- configuration ;
- état durable ;
- règles de calcul ;
- idempotence ;
- historique/audit.

### Twitch Bot
Adaptateur Twitch :
- EventSub ;
- Helix ;
- chat ingress ;
- normalisation des événements ;
- forwarding durable vers Core ;
- aucune logique économique métier propre.

### Studio
Application locale streamer :
- contrôle Start/Stop ;
- état des services ;
- previews ;
- configuration future ;
- obs-websocket ;
- exécution locale des effets/overlays futurs ;
- outils de test.

### Extension Twitch
**Direction produit désormais prioritaire : l’extension doit devenir l’interface principale des viewers.**

Elle sert à :
- découvrir les interactions disponibles ;
- payer/déclencher des actions ;
- utiliser Bonk / Soundboard / TTS / Tombola et futurs modules ;
- afficher prix, cooldowns, disponibilité ;
- afficher profil, progression, stats, achievements et cosmétiques à terme.

L’extension ne possède jamais l’état économique : elle parle au Core.

### Site
Le site doit exploiter la même donnée Core que l’extension :
- profils viewers ;
- stats détaillées ;
- leaderboards ;
- achievements ;
- cosmétiques débloqués/équipés ;
- progression persistante.

---

# 3. Checkpoints Git importants

Historique principal :
- `90bb9a5 — chore: bootstrap clean Raptoru 2.0 monorepo`
- `69e813e — feat: add core daily vertical slice`
- `511744b — feat: add shadow presence tracking`
- `ea5455f — feat: add Studio test lab`
- `0329682 — feat: add core wallet and loyalty foundation`
- `f5e3985 — feat: add loyalty engine preview with presence integration`
- `322b85f — feat: package Raptoru Studio as a Windows installer`
- `22e1716 — feat: finalize Twitch rewards v1 with durable forwarding`
- `a7cc705 — feat: connect daily claims to the core wallet behind a flag`
- `ab7171f — test: strengthen wallet chat and identity coverage`
- `d02b3e5 — feat: import the production Twitch extension as static files`
- `7f90710 — feat: add Extension Lab tab to Raptoru Studio`
- `e8fbdbb — feat: add Raptoru Studio auto-update v1`
- `4995dad — configuration du vrai feed GitHub Releases + correction install/relaunch updater`
- `e12638d — bump Studio 0.1.0 → 0.1.1 pour le premier test réel d’auto-update`
- `1f8cfb0 — style: format wallet tests`
- `6d92a76 — feat: add one-command Raptoru Studio release pipeline`
- `353b052 — hook de test d’échec/rollback du pipeline release`
- `228980f — chore: release Raptoru Studio 0.1.2` (commit de release créé par le pipeline)
- `3665773 — feat: add Bonk Lab interactions to Core`
- `760cd5e — fix: harden Bonk Lab admission and worker readiness`
- `6fbdd0e — feat: add Bonk Lab Studio worker and OBS overlay`
- `45e6cd9 — feat: add Twitch viewer identity and emote catalog to Bonk Lab`
- `717d97b — feat: complete Bonk V2 picker and emote providers`
- commit `docs: update Raptoru 2.0 project state` (ce fichier, désormais versionné), puis commit de release Studio créé par `npm run studio:release` : SHA à lire dans `git log -n 10`.
- `cd7b411 — chore: release Raptoru Studio 0.1.3`
- `4df6af5 — feat: add Soundboard V2 Lab execution and Studio configuration`
- `0a5c4e9 — feat: add Pop Premium Hub, global wallet switch and Soundboard V2 UI`
- commit `docs: update Raptoru 2.0 project state` (28/09/2026) : SHA à lire dans `git log -n 10`. Pas de release Studio pour ce checkpoint (en attente d'un feu vert explicite).
- `31dfd7a — chore: release Raptoru Studio 0.1.4` (release validée explicitement, pipeline existant)
- `dbfb91b — feat: separate Soundboard default and custom sound names` (pas de release Studio supplémentaire à ce stade)
- `4454c8f — docs: update Raptoru 2.0 project state`
- `5538111 — feat: refine Hub carousel navigation and launcher` (29/09/2026 : dots, grille + lanceur dense, molette verticale, glow adouci ; pas de release Studio, extension non publiée)
- `6b75309 — docs: update Raptoru 2.0 project state` (29/09/2026)
- `986ae84 — docs: sync Raptoru 2.0 project state` (29/09/2026)
- `76c94c4 — feat: make Raptoru Studio start its local runtime`
- `eb798b9 — feat: run TTS V2 through Core, the Studio worker and an OBS player`
- `bcfc7ee — feat: integrate the TTS V2 D3 flow in the extension`
- `ef4025d — fix: let Electron supervise and recover the Studio server`
- `ced73d4 — docs: record the Studio + TTS V2 checkpoint`
- `030576e — chore: keep local prototypes out of lint and format checks`
- `f81955d — chore: release Raptoru Studio 0.1.5` (release validée, pipeline `studio:release`, tag `v0.1.5` sur le repo de releases uniquement)
- `435f78d — feat: add Moderation V2, TTS configuration and a Lab test wallet to Core` (non releasé)
- `706f8c7 — feat: add the Studio moderation cockpit and route the extension to Core` (non releasé)
- `0da412d — docs: record Moderation V2 and TTS configuration (Lab)`
- `12ffdd0 — feat(extension): Moderation V2 D4 console on the real Core (Lab)` (non releasé ; malgré son titre, **pas une parité D4** : audit = fortement simplifiée, corrigée partiellement par `a5b5d5e`, remplacée par `5b66579`)
- `5d48cee — docs: record the closing audit of Moderation V2 (Lab)`
- `890e71d — fix: keep a manual TTS cooldown clear effective` (non releasé)
- `a5b5d5e — feat(extension): bring the moderation console closer to D4` (non releasé ; remplacé par `5b66579`)
- `3add3dd — docs: add the Raptoru 2.0 handoff and clean the project state`
- `5b66579 — feat: complete Moderation V2 with full D4 parity (Lab)` (non releasé ; **dernier commit fonctionnel**)
- `e535b26 — docs: record Moderation V2 full D4 parity (Lab, awaiting validation)`

Règles Git inchangées :
- branche `main` ;
- le repo local Raptoru 2.0 n’a pas de remote Git configuré ;
- aucun push du repo source effectué ;
- un ancien repo privé `raptorutwitch/raptoru-2.0` existe sur GitHub mais contient l’ancien historique et ne doit pas être traité comme miroir du workspace local actuel.

Le pipeline `studio:release` crée un commit local de version après publication réussie ; toujours vérifier `git log -n 10` avant de reprendre.

# 4. État technique actuel — résumé fiable

## Presence
**Techniquement VALIDÉ. Production : NON.**

- Get Chatters environ toutes les 2 minutes pendant le live ;
- snapshots durables ;
- présence validée sur 2 snapshots consécutifs ;
- séparation max 180 s ;
- erreurs/gaps sans rattrapage aveugle ;
- lease worker/channel ;
- `estimated_watch_seconds` ;
- fermeture/reconciliation stream sécurisée.

### Test réel du 25/09/2026
Stream `317823244002` :
`2026-09-25T18:08:21Z → 2026-09-26T01:29:50Z` (~7 h 21)

Résultat :
```text
63 viewers
1762 passive ticks
191350 Jetons passifs théoriques
0 tier_unknown
109900 Jetons événements théoriques
0 transaction Wallet réelle
```

Comparaison StreamElements : écart observé de 0 à 6 minutes sur les viewers comparés.

### Correctifs fermeture live
- reconciliation tardive basée sur la dernière confirmation live ;
- aucun crédit Presence si confirmation live >10 min (`live_unconfirmed`) ;
- Stop All lance `stream:reconcile` via Helix avant arrêt Core ;
- une erreur Helix n’est jamais interprétée comme offline.

---

# 5. Wallet / monnaie

## Wallet Core V1
**Techniquement VALIDÉ. Production : NON.**

Le moteur Wallet est considéré fini techniquement. Il comprend :
- currencies ;
- wallets ;
- opérations ;
- ledger/transactions immuables ;
- idempotence forte ;
- opérations atomiques ;
- locks ciblés/stables ;
- multi-currency natif ;
- balance sans cap ;
- lifetime earned/spent séparés des transferts ;
- staff roles ;
- fondations taux individuels/boosts.

Ledger types :
- reward ;
- spend ;
- transfer_out / transfer_in ;
- admin_add / admin_remove ;
- admin_set_adjustment ;
- penalty ;
- refund ;
- opening_balance.

Pas de dette pour les dépenses normales. Un malus explicite futur pourra rendre une balance négative si cette feature est décidée.

## Multi-currency
**La capacité technique existe déjà dans Wallet. Ce n’est PAS un futur chantier de fondation.**

Les travaux futurs portent seulement sur les usages : monnaies d’événement, règles, affichage, conversion éventuelle, expiration éventuelle, modules qui choisissent leur currency.

---

# 6. Wallet Commands + Permissions

**Techniquement VALIDÉ. Production : NON.**

Commit de couverture :
`ab7171f — test: strengthen wallet chat and identity coverage`

Commandes viewer :
```text
!solde
!balance
!compte
!give
!trade
```

Transfert :
```text
!give @pseudo 500
!give 500 @pseudo
```

Règles :
- minimum 1 ;
- pas de taxe ;
- pas de limite quotidienne ;
- pas de self-transfer ;
- pas de dépassement du solde ;
- atomique ;
- idempotent ;
- monnaie principale par défaut.

Permissions :
- viewer : droits Wallet normaux ;
- mod Twitch normal : mêmes droits qu’un viewer ;
- supermod : admin Wallet ;
- owner/broadcaster : admin Wallet.

Admin : add / remove / set. `set` reste un ajustement ledger et jamais un écrasement silencieux.

Identité canonique : `twitch_user_id`. Le changement de login garde le même wallet.

Dernière validation annoncée :
- Core API : 124 tests passés, 6 skipped ;
- Twitch Bot : 69 tests passés ;
- vrai Postgres déjà couvert par les tests d’intégration/concurrence ;
- `LOYALTY_CHAT_COMMANDS=false` reste OFF.

---

# 7. Loyalty / gains de Jetons

**Techniquement VALIDÉ. Production : NON.**

Les viewers peuvent gagner des Jetons par plusieurs sources déjà raccordées au nouveau système :
- présence/watchtime passif ;
- sub/resub ;
- subgifts ;
- Bits ;
- Follow ;
- Daily.

## Passif
`50 Jetons toutes les 6 minutes validées`

Multiplicateurs :
```text
non-sub : x1
T1      : x2
T2      : x2.5
T3      : x4
```

Taux individuel : remplace le multiplicateur tier pour le passif, sans cumul avec le tier.

Exclusions passives locales/configurables :
- `lecroupier_`
- `streamelements`
- `wizebot`

`Raptoru_` reste éligible pour tester le vrai parcours économique.

## Rewards Twitch V1
**Techniquement VALIDÉ. Production : NON.**

### Sub / Resub
```text
T1 : +2000
T2 : +4000
T3 : +10000
```

### Subgift
Gifter récompensé, recipient non récompensé comme gifter, anonymous sans identité récompensable.

Bonus volume :
```text
1–4   : +0 %
5–9   : +5 %
10–19 : +10 %
20+   : +20 %
```

Les gifts sponsorisés (ex. compte `minecraft`) sont autorisés à gagner des Jetons.

### Bits — calcul marginal progressif
```text
1–499 bits      : 700 Jetons / 100 bits
500–999 bits    : 900 Jetons / 100 bits
1000+ bits      : 1000 Jetons / 100 bits
```

### Follow
`+500 Jetons`, une fois par identité Twitch sur la durée de vie. Un unfollow/refollow ne crée pas une nouvelle récompense.

### Durabilité Rewards
Commit : `22e1716`

- outbox persistante `.loyalty-outbox.json` ;
- écriture avant envoi Core ;
- suppression après acceptation/replay/refus définitif ;
- survit aux restarts et indisponibilités Core ;
- journal des refus définitifs ;
- retry avec délai borné ;
- protection contre plusieurs consommateurs EventSub actifs.

Un cas de course extrême multi-bot subsiste théoriquement mais est considéré non bloquant dans l’usage normal Studio qui démarre une seule instance.

---

# 8. Daily V1

**Techniquement VALIDÉ et raccordé au Wallet. Production : NON.**

Commit initial : `69e813e`

Connexion Wallet : `a7cc705 — feat: connect daily claims to the core wallet behind a flag`

Le Daily possède :
- stream-day ;
- reset 16:00 Europe/Paris ;
- stream-day figé à partir du Twitch `started_at` ;
- plusieurs lives du même stream-day partagent le Daily ;
- streak ;
- éligibilité ;
- reward configurable ;
- claims idempotents ;
- historique.

Récompense actuelle par défaut :
`500 + 150 × streak`, capée à `2000` (configurable).

Le Daily reste propriétaire de :
- l’éligibilité ;
- la streak ;
- le montant ;
- le stream-day ;
- l’unicité du claim.

Le Wallet ne fait que recevoir la décision de crédit.

Connexion Daily → Wallet :
- `DAILY_WALLET_CREDITS=false` par défaut ;
- idempotency key ;
- `wallet_operation_id` ;
- retry des crédits pending ;
- stale `sending` requeue possible car Wallet idempotent ;
- aucun changement produit tant que flag OFF.

**Conclusion économique actuelle : le moteur de monnaie + les principales sources de gains + le Daily sont raccordés proprement.**

---

# 9. Flags de sécurité actuels

État attendu :
```text
LOYALTY_PREVIEW=true
LOYALTY_TWITCH_EVENTS=true
LOYALTY_PASSIVE_CREDITS=false
LOYALTY_EVENT_CREDITS=false
DAILY_WALLET_CREDITS=false
DAILY_CHAT_COMMANDS=false
LOYALTY_CHAT_COMMANDS=false
PRESENCE_SHADOW=true
```

Principe : techniquement validé ≠ activé en prod.

---

# 10. Twitch Auth

## LeCroupier_
Usage Presence / chatters.
Scope principal : `moderator:read:chatters`.

## Raptoru_
Broadcaster ID : `83603689`

Scopes validés :
```text
channel:read:subscriptions
bits:read
moderator:read:followers
```

Le snapshot abonnements réel et les preflights ont été validés.

---

# 11. Raptoru Studio Windows

**Application Windows installable + Extension Lab + auto-update + pipeline de release : VALIDÉS techniquement.**

## Packaging
Format officiel : installateur NSIS x64 per-user.

Install :
`%LOCALAPPDATA%\Programs\Raptoru Studio`

Config data root :
`%APPDATA%\Raptoru Studio\studio.json`

Exemple :
```json
{"dataRoot":"C:/Users/Antoni/Documents/Raptoru 2.0"}
```

Fonctionnement validé :
- lancement raccourci ;
- Node embarqué par Electron ;
- pas de console nécessaire ;
- single instance ;
- Start All / Stop All ;
- Test Lab ;
- Extension Lab ;
- secrets non packagés ;
- ports libérés après arrêt ;
- updater intégré.

## Auto-update réel
Commit de base :
`e8fbdbb — feat: add Raptoru Studio auto-update v1`

Comportement :
- version affichée dans la topbar ;
- bouton `Rechercher une mise à jour` ;
- détection d’une version plus récente ;
- bouton `Mettre à jour` ;
- téléchargement ;
- arrêt propre du serveur local/Core avant installation ;
- installation silencieuse puis relance avec `quitAndInstall(true, true)`.

Le test réel `0.1.0 → 0.1.1` a été validé de bout en bout :
```text
détection
→ téléchargement
→ arrêt propre
→ installation NSIS
→ relance automatique
→ app.getVersion() = 0.1.1
→ Extension Lab toujours présent
```

Le test `0.1.1 → 0.1.2` a validé la **détection réelle depuis l’application installée** :
`Nouvelle version : 0.1.2` + bouton `Mettre à jour`.

Ne pas prétendre que `0.1.2` a été installée si ce point n’a pas été revérifié au runtime au moment de la reprise.

## Repo public de Releases
Repo dédié :
`raptorutwitch/raptoru-studio-releases`

Principes :
- public ;
- ne contient pas le code source Raptoru 2.0 ;
- sert uniquement aux GitHub Releases Studio ;
- updater sans token embarqué ;
- artefacts de release : installateur `.exe`, `.blockmap`, `latest.yml`.

## Pipeline one-command
Commande canonique :
```text
npm run studio:release
```

Dry-run :
```text
npm run studio:release -- --dry-run
```

Le pipeline :
1. vérifie workspace / Git / feed / auth `gh` ;
2. refuse un working tree dirty ;
3. calcule le prochain patch ;
4. bump package + lockfile ;
5. lance les checks ;
6. package Studio ;
7. vérifie version, noms, taille, sha512, blockmap et secrets ;
8. crée d’abord une GitHub Release brouillon ;
9. vérifie les assets ;
10. rend la release publique/latest ;
11. retélécharge anonymement et compare les fichiers ;
12. crée le commit local de release ;
13. ne pousse jamais le repo source.

En cas d’échec :
- arrêt à l’étape fautive ;
- rollback du bump ;
- nettoyage de la release/draft créée quand possible ;
- aucun changement de l’installation Studio courante.

Le dry-run a été validé complètement, ainsi qu’un rollback injecté. La vraie release `v0.1.2` a été publiée avec succès et détectée par le Studio 0.1.1 installé.

## Règle workflow
Après une feature qui impacte Studio :
- développer ;
- tester ;
- obtenir une validation explicite du résultat ;
- lancer `npm run studio:release` ;
- le Studio installé récupère ensuite la nouvelle version via son bouton.

Pas de publication automatique à chaque commit.

## Studio autonome — runtime local + supervision (validé le 30/09/2026)
Commits `76c94c4` (runtime local) et `ef4025d` (supervision Electron). Validé manuellement : Studio source lancé seul, Hub + Bonk V2 + Soundboard V2 + TTS V2 dans une seule application, sans terminal ni `npm run bonk:lab`.
- Chaîne de supervision : **Electron main → serveur Studio → Local Runtime Manager → Core local / workers / lecteurs**.
- Runtime local (serveur Studio) : Postgres Docker → base `raptoru_bonk_lab` + migrations Lab → Core Lab 127.0.0.1:4301 ; politique de crash du Core, collision de port, Core orphelin retrouvé et arrêté (PID) ; onglet « Studio » (état des services, connexions, modules, Dev/Lab, journal).
- Supervision du serveur Studio par Electron : états stopped / starting / ready / degraded / crashed / restarting / fatal ; attente de `/health` ; surveillance process + santé ; relance automatique avec backoff (3 max en 3 min, puis fatal) ; nettoyage de l’ancien process et vérification du port avant relance ; sortie du serveur conservée dans `%APPDATA%\Raptoru Studio\logs\studio-server.log` (+ `.1` pour le lancement précédent).
- Page d’état propre à Electron (démarrage serveur → Core local → prêt ; serveur perdu / relance / action requise) avec « Relancer le serveur Studio » et « Redémarrer Raptoru Studio » par IPC : fonctionnent avec 127.0.0.1:4100 totalement mort.
- Une seule instance, que Studio soit lancé depuis le repo (`npm run studio`) ou installé (même profil, même verrou) : une seconde ouverture met la première au premier plan, sans second serveur.
- Serveur : port 4100 occupé → arrêt immédiat (code 3, message explicite, pas de boucle) ; traces de crash sur stderr ; arrêt propre (Core compris) si Electron disparaît (fermeture forcée) ; fenêtre non ralentie en arrière-plan (lecteurs actifs).
- Tests réels validés : crash serveur → relance auto ; fatal → relance manuelle depuis l’UI ; crash Core seul ; port 4100 occupé ; double instance ; fermeture normale et forcée sans process ni port restant.
- Cause de la panne observée le 30/09 : deux fenêtres Studio (dev + installé, verrous différents) partageaient un serveur ; la fermeture de l’une arrêtait le serveur de l’autre. Corrigé.
- Studio installé, Studio source (`npm run studio`) et package local partagent désormais le même verrou : un seul à la fois. Le Studio installé embarque une **copie figée** de l’extension (il ne montre jamais les changements locaux).

## Limites non bloquantes
- installateur non signé → SmartScreen possible en téléchargement manuel ;
- UI Studio encore technique, grosse refonte UX finale repoussée ;
- ne pas transformer le pipeline release en CI/CD complexe sans besoin réel.

# 12. Extension Twitch + Extension Lab

## Extension Twitch actuelle
L’extension de production existante a été importée dans Raptoru 2.0 comme fichiers statiques.

Commit :
`d02b3e5 — feat: import the production Twitch extension as static files`

Archive de référence importée :
`raptoru-live-production-20260920-095259Z-consolidated-final.zip`

Elle contient notamment :
- Bonk ;
- Soundboard ;
- TTS ;
- Tombola ;
- historique/classement ;
- préférences/notifications ;
- surfaces panel, mobile, video component, config et live config.

Direction produit verrouillée :
**Extension-first pour les viewers.**

L’extension doit devenir l’interface principale pour découvrir, payer et déclencher les interactions. Le chat reste un raccourci/fallback, pas l’UX principale des catalogues complexes.

## Extension Lab local
Commit :
`7f90710 — feat: add Extension Lab tab to Raptoru Studio`

Le Lab sert **la vraie extension importée**, mais remplace :
- Twitch helper par un mock local `window.Twitch.ext` ;
- runtime API prod par un EBS Lab local ;
- identité/contexte Twitch par des simulations ;
- économie réelle par des Jetons/crédits fictifs.

Surfaces testables :
- Panel viewer 318×496 ;
- Mobile viewer ;
- Video component, 60 % du player, ratio 3:2 ;
- Config ;
- Live config.

Rôles/contextes :
- viewer ;
- modérateur ;
- broadcaster ;
- identité Twitch partagée/non partagée.

Le Lab actuel permet de tester visuellement :
- Soundboard ;
- Bonk ;
- TTS ;
- Tombola ;
- modération/états UI.

**Tombola : Tombola V2 minimale dans le Core Lab** depuis `5b66579` (inscription gratuite, tirage depuis Studio, gains sur le wallet Lab) ; l’ancienne simulation en mémoire de la façade LabEbs ne sert plus qu’hors Core Lab.

**TTS V2 : exécution réelle en mode Lab** depuis le 30/09/2026 (même Core Lab que Bonk / Soundboard) : extension → façade LabEbs → Core local/test → worker Studio → lecteur OBS (Web Speech + personnage) → ACK. Voir § 16 « TTS V2 — runtime réel validé ». L’ancien formulaire TTS reste affiché quand le module n’a pas de données `tts_v2` (démo, prod).

**Soundboard : exécution réelle en mode Lab** depuis le 28/09/2026 (même Core Lab que Bonk) : extension → façade LabEbs → Core local/test → worker Studio → page lecteur audio locale (à activer d’un clic) → ACK. Voir § 16 « Soundboard V2 — état validé ».

**Modération V2 : console réelle dans le Lab** (session `moderation_v2`, relais `/moderation/v2/*` de la façade LabEbs → Core Lab). État actuel = parité D4 complète `5b66579`, **non validée manuellement, non releasée**. Hors Lab, l’ancien écran de modération reste affiché. Voir § 16 « Modération V2 ».

**Bonk : exécution réelle en Lab** (historique : lancé d’abord via `npm run bonk:lab`, Studio 4101 / Core Lab 4301 ; depuis le 30/09/2026 le Studio autonome démarre lui-même le runtime Lab sur 4100 / 4301, base `raptoru_bonk_lab`) :
```text
extension réelle servie localement
→ façade LabEbs
→ Core local/test (validation, idempotence, channel_sequence)
→ worker Studio
→ obs-websocket + source navigateur « Raptoru Bonk Lab »
→ overlay OBS → ACK started / completed / failed
```
Voir § 16 « Bonk V2 — état validé ».

## Paiements
Les moyens de paiement Jetons et crédits d’extension doivent rester conceptuellement distincts jusqu’à audit complet.

Ne pas transformer aveuglément les crédits d’extension en currency Wallet. Chaque module déclarera plus tard les moyens de paiement acceptés.

Aucune économie réelle n’est utilisée par le Lab.

# 13. Inventaire fonctionnel actuel du stream à migrer/repenser

Cette liste vient de l’inventaire utilisateur du 26/09/2026. Elle devient la base de la roadmap fonctionnelle. Elle n’implique pas que tout sera recodé tel quel : chaque élément doit être audité et classé garder/améliorer/fusionner/remplacer/supprimer.

## Alertes stream
SAMMI gère actuellement :
- Raid ;
- Follow ;
- Sub ;
- Bits ;
- Don ;
- Gift.

Objectif futur : moteur d’alertes centralisé, cohérent avec Raptoru 2.0, sans multiplier des boutons SAMMI indépendants.

## Cam / OBS / ambiance
- overlay cam Shushu animé avec expressions ;
- changement de couleur via point de chaîne / presets filtre OBS ;
- LED derrière le streamer ;
- FX caméra via user-defined shader / obs-shaderfilter ;
- effet **Creepy** : fade noir, coupe micro, freeze frame, grosse distorsion/effet creepy, SFX, restauration de scène ;
- **We’ll Be Right Back** : texte animé + freeze cam en carré + mute + restauration ;
- **NTM** : vidéo transparente simple superposée ;
- effets spéciaux liés au mute streamer après votekick.

Le Creepy est une feature signature à préserver/améliorer.

## Soundboard
- grosse banque de sons ;
- historiquement exécutée par SAMMI ;
- extension actuelle déclenche SAMMI ;
- objectif : migration vers Core/Studio avec catalogue propre, extension-first, recherche/catégories/prix/cooldowns possibles.

## TTS
- texte saisi dans l’extension pour ne pas spoiler le texte dans le chat ;
- voix aléatoire ;
- petit personnage animé aléatoire synchronisé ;
- HTTP requests + animations WEBM ;
- assets/dossiers existants à récupérer.

## Ban aléatoire
- choisit dans les viewers ;
- vérifie follow pour éviter les bots ;
- exclut/protège selon règles mod/ban ;
- distingue sub/non-sub ;
- timeout 3 min si sub, 5 min sinon ;
- animation 2D maison + phrase X a banni Y ;
- déclenchable PDC et Jetons ;
- souhait futur : extension.

## Emote-only
- actuellement redemption PDC gérée par Wizebot ;
- peut rester externe au début.

## Spotify / file musique
- redemption PDC ;
- entrée `titre + artiste` ou lien ;
- recherche et ajout queue ;
- refund auto si introuvable ou ambigu ;
- `!song` donne titre actuel + demandeur ;
- viewer peut annuler sa propre chanson avant lecture et être remboursé ;
- contournement queue Spotify : chanson annulée = skip instantané quand elle arrive ;
- mods : `!songskip` ;
- skip viewer existe mais doit être limité/cooldown pour éviter abus.

## Commandes viewer personnalisées
Certains viewers ont leur propre commande pouvant déclencher :
- un son ;
- une phrase chat ;
- autres petites actions personnalisées.

À conserver sous forme configurable/permissionnée.

## Tombola
Feature très populaire.

- lancement automatique à intervalles aléatoires ;
- montant aléatoire ;
- 60 s pour join ;
- `!join` ou extension ;
- extension affiche participants + timer + gagnants ;
- différé pour ne pas spoiler avant overlay ;
- overlay type bandeau d’info TV ;
- jackpot normal environ 5 000–50 000 ;
- chance ~1/100 de Big Tombola or à ~200 000 ;
- distribution automatique des gains.

## Cash-in PDC → Jetons
Ancien système :
- `!cashin <somme>` ;
- ajuste dynamiquement le prix d’une redemption ;
- viewer achète la redemption ;
- conversion `10 PDC = 1 Jeton` ;
- ratio volontairement très peu rentable.

À décider plus tard si on conserve.

## Daily / streak
Daily nouveau système déjà validé. Ancien `!streak` à reproduire/adapter au nouveau Daily si désiré.

## Start stream flag
Ancien bouton manuel SAMMI servant de garde-fou “stream lancé”.
Dans Raptoru 2.0, la source doit être Twitch/stream state fiable, pas un bouton manuel sauf override de secours explicite.

## Bonk
Feature signature, déjà dans l’extension actuelle.

- viewer choisit une emote ;
- emote projetée vers la cam ;
- physique/rebond/bruit ;
- roule/disparaît/tombe ;
- chat ou extension ;
- Jetons only actuellement ;
- providers : Twitch, emotes de chaînes suivies/sub, 7TV, BTTV, FFZ, emoji style Discord/mobile souhaité ;
- ancien mode lock/loop/spam bancal : envoi par paquets de 5, pas fidèle à l’intention ;
- objectif : queue/burst/combo beaucoup plus précis.

## Level Up Wizebot
- détecte message Wizebot de level-up ;
- joue un son ;
- option par viewer dans l’extension ;
- désactivée par défaut ;
- feature utile à conserver.

## Votekick
Feature sociale importante.

- 1 initiation / heure / viewer ;
- vote 60 s ;
- majority yes → cible timeout ;
- majorité no → initiateur sanctionné ;
- égalité → coin flip ;
- logique “double peine” si unanimité/conditions spécifiques ;
- durée TO augmente avec nombre de votes ;
- mods non ciblables ;
- streamer ciblable ;
- si streamer perd : stream continue, micro forcé mute + animation “muted” réactive à l’audio.

## Caution
- `!caution @pseudo` ;
- vérifie si la cible est timeout ;
- calcule temps restant + prix ;
- confirmation avant paiement ;
- permet de libérer presque tout timeout si paiement ;
- fonctionne aussi sur le mute forcé streamer.

Le raccord mute/demute actuel est imparfait et doit être refait proprement.

## Jeu des mots
**Module le plus populaire du stream. Priorité forte.**

- banque ~16K mots français ;
- mot choisi périodiquement ;
- lettres mélangées ;
- récompense `100 Jetons × nombre de lettres` ;
- <30 s : bonus rapide x3 ;
- 30 s–5 min : x1 ;
- mot très ancien trouvé : x2 ;
- multi-mots dans un message → bonus ;
- streak dynamique à partir de 3 ;
- annonce à chaque palier atteint selon résultat du message ;
- Golden Word aléatoire x4, cumulable avec autres bonus ;
- streak breaker avec prime croissante ;
- problèmes historiques : duplicate/rapid race, messages simultanés qui se squeezent ;
- mode futur **mot maudit** avec lettre cachée ;
- ouvert à de nouveaux modes/événements sans casser la mécanique principale.

## StreamElements — jeux/commandes encore utilisés
- Jetons passifs : déjà remplacés techniquement par Presence/Loyalty ;
- `!duel` : duel pour X Jetons, coin flip, texte seulement actuellement ;
- roulette : mise Jetons, environ 50/50, texte actuellement ;
- slots : 3 emojis identiques ;
- `!oracle` : réponses audio/préenregistrées aléatoires ;
- combo d’emotes chat + breaker ;
- souhait : duel/roulette/slot surtout via extension avec visuels/animations et partage volontaire du résultat pour éviter spam chat ;
- Oracle pourrait devenir plus intelligent/contextuel plus tard.

## Wizebot — reste
- messages d’annonce ;
- commandes classiques d’info ;
- infos jeux, réseaux, codes, etc.

Orientation : déplacer les infos durables vers le site, conserver seulement quelques annonces/commandes utiles dans le chat.

## Stats / leaderboards actuels souhaités
- watchtime global / mois / semaine ;
- messages global / mois / semaine ;
- niveaux + titres ;
- futurs classements spécifiques par module.

---

# 14. Data, profils, achievements et cosmétiques — direction produit

Objectif : **un maximum de modules doit produire sa propre donnée structurée**, non seulement pour l’audit mais pour alimenter le site, les profils et la progression.

Exemples de stats :
- Bonks envoyés, emotes/providers, combos ;
- TTS envoyés, voix/personnages ;
- sons Soundboard ;
- Tombolas participées/gagnées, jackpots ;
- mots trouvés, vitesse, Golden, streaks, breakers ;
- roulette/slots/duels ;
- watchtime/messages ;
- Daily/streak ;
- gains/dépenses cumulés.

## Achievements
Le site doit pouvoir déverrouiller des succès à partir des événements/stats.

Exemples :
- premier Bonk ;
- 100 Bonks ;
- premier Golden Word ;
- streak Jeu des mots ;
- Big Tombola gagnée ;
- 100 h / 500 h / 1000 h watchtime ;
- longue streak Daily ;
- gros win casino ;
- etc.

## Récompenses cosmétiques
Le système futur doit distinguer **possédé** et **équipé**.

Idées :
- titres ;
- bordures leaderboard ;
- cartes de visite ;
- backgrounds/profils ;
- styles de pseudo ;
- FX autour du pseudo ;
- petits effets visuels rares ;
- autres éléments de personnalisation.

But produit : donner une progression persistante et des objectifs amusants qui donnent envie de revenir/farmer sans réduire le stream à une simple monnaie.

---

# 15. Briques communes futures à mutualiser

À construire seulement quand un premier vrai module l’exige, pas comme gros framework abstrait.

Briques probables :
- paiement Wallet / crédits ;
- moyen de paiement autorisé par module ;
- cooldowns ;
- permissions ;
- queue ;
- exécution ;
- ACK ;
- refund automatique si action non exécutée ;
- logs/audit ;
- stats/event emission ;
- configuration Studio ;
- pont vers overlays/OBS.

Flux cible typique :
```text
Extension/chat
  → Core valide l’intention
  → paiement/réservation
  → action en queue
  → Studio/overlay exécute
  → ACK succès
  → stats
```

Si exécution impossible : refund idempotent.

Ne pas créer un moteur générique de workflows. Construire le minimum commun nécessaire aux modules réels.

---

# 16. Roadmap fonctionnelle — état actuel

**Ne plus travailler sur l’infrastructure générale sauf bug réel.**
Le socle nécessaire au développement des features est maintenant suffisamment solide.

## Socle fermé techniquement
- Presence ;
- Wallet Core ;
- Wallet Commands + Permissions ;
- Loyalty passif ;
- Rewards Twitch V1 ;
- Daily V1 ;
- Daily → Wallet ;
- durabilité/restarts ;
- Studio runtime/package Windows ;
- Extension Twitch importée ;
- Extension Lab local ;
- auto-update Studio réel ;
- pipeline `studio:release` one-command ;
- Bonk V2 Lab (Extension Lab → Core → Studio → OBS, picker V2 + providers) ;
- Studio autonome (runtime local + supervision Electron du serveur Studio) ;
- Soundboard V2 Lab ;
- TTS V2 Lab (runtime réel).

Tous ces éléments restent distincts d’un cutover production global.

## Bonk V2 — état validé

**Validé visuellement le 27/09/2026. Techniquement validé, mais PAS activé en production.**
SAMMI / StreamElements / système actuel restent la production jusqu’au feu vert global Raptoru 2.0.

Commits : `3665773`, `760cd5e`, `6fbdd0e`, `45e6cd9`, `717d97b` (voir § 3).

### Pipeline réel Lab
```text
Extension Lab (vraie extension servie localement)
→ façade LabEbs (Studio)
→ Core local/test (Lab Core 4301, base raptoru_bonk_lab)
   - validation emote par provider/id
   - idempotence (idempotency key + hash de requête)
   - interaction persistante, ordre durable channel_sequence
   - paiement simulé
→ worker Studio (journal, claims/leases, ACK)
→ OBS (obs-websocket, source navigateur « Raptoru Bonk Lab » 1920×1080)
→ overlay → ACK started / completed / failed
```
Lancement historique : `npm run bonk:lab` (Studio 4101, Lab Core 4301) ; aujourd’hui le Studio autonome démarre le runtime Lab lui-même (4100 / 4301). Connexion OBS par mot de passe dans l’UI du Lab (non stocké).
Statuts : `accepted → queued → executing → completed` / `failed` / `execution_unknown` ; `executing` seulement après ACK `started`, `completed` seulement après fin réelle du rendu.

### Catalogue
- Twitch viewer OAuth `user:read:emotes` (compte test raptoru_), token stocké uniquement dans la base Lab, jamais exposé à l’extension/OBS ;
- catalogue viewer Twitch réel (Get User Emotes, ~1141 emotes) ;
- Twitch statiques + animées ;
- Bits regroupés via `emote_type = bitstier` ;
- Twemoji complet (~1914, banque Unicode de l’extension) ;
- 7TV, BTTV, FFZ : catalogues publics de la chaîne (globales + chaîne), sans token, cache Core 10 min ;
- validation Core par provider/id : le client n’envoie que `provider` + `provider:id` ;
- Core construit lui-même les URL (Twemoji local, CDN Twitch/7TV/BTTV/FFZ à gabarit fixe) ; aucune URL arbitraire client ; Core ne sert/proxy aucune image ;
- l’overlay n’accepte que ces formes d’URL, sinon échec explicite.

### Organisation finale du picker
Rail :
- Récents
- Favoris
- Twitch
- Bits
- Extension
- Emoji

Extension :
- Raptoru_
  - 7TV
  - BTTV
  - FFZ seulement si présent
- Globales
  - 7TV
  - BTTV
  - FFZ

Emoji : Smileys & personnes, Animaux & nature, Nourriture, Activités, Voyage & lieux, Objets, Symboles, Drapeaux.

### UX validée
- rail hiérarchique/repliable (état persisté localement) ;
- continuous scroll ;
- picker persistant entre les polls (aucun rebuild complet toutes les 5 s) ;
- lazy rendering par tranches de lignes ;
- recherche multi-provider (nom d’emote, chaîne, provider, emoji) ;
- emotes animées directement dans la grille ;
- tailles finales plus grandes (panel 4 colonnes, mobile 5, video 10) ;
- favoris (ordre personnel persisté) ;
- drag & drop de l’ordre des favoris (souris, section Favoris uniquement) ;
- étoile desktop discrète (hitbox locale 24 px, anti-clic accidentel) ;
- bouton favori tactile dans la barre du bas (masqué sur desktop) ;
- scroll stable pendant polling.

Façade Lab : catalogues en stale-while-revalidate (aucune requête ne dépasse le timeout 8 s de l’extension).

### Isolation
- `test_mode = true` imposé serveur ;
- paiement simulé (`payment_mode = simulated`) ;
- `real_debited = 0` (contrainte DB) ;
- aucun Wallet réel ;
- aucune progression/stats réelles ;
- zéro SAMMI, zéro StreamElements, zéro EBS prod.

### Bonk Fidelity — encore à faire plus tard (polish futur, non bloquant)
- impact FX plus proche du legacy ;
- ciblage centre caméra ;
- réglages variation de taille ;
- disparition plus punchy / variantes.

### Encore à faire avant tout usage production (avec le feu vert global seulement)
- nouvelle Twitch Extension non publiée : la console Twitch devra autoriser les domaines d’images `cdn.7tv.app`, `cdn.betterttv.net`, `cdn.frankerfacez.com` ;
- stats structurées Bonk ;
- Wallet réel + refund idempotent ;
- cutover uniquement avec le feu vert global.

### Production
**Bonk V2 est techniquement validé mais n’est PAS activé en production.**
SAMMI / StreamElements / système actuel restent production jusqu’au feu vert global Raptoru 2.0.

## Soundboard V2 — état validé
Validé fonctionnellement, visuellement et à l’écoute le 28/09/2026 (Lab uniquement). Commits `4df6af5` (Core + Studio) et `0a5c4e9` (extension).
- Banque complète : 69 sons (hello / on-est-bien-d-accord / sarah corrigés, sarah = 3 variantes, « Aléatoire »). Le catalogue vient de Core ; le client n’envoie que le `sound_id`.
- Réglages par son dans Studio (onglet « Soundboard config ») : nom, actif, prix jetons, prix crédits, cooldown, lecture Superposer / File / Ignorer si actif, volume ; persistés et validés par Core.
- Protection volume globale (Désactivée / Légère / Moyenne) : atténuation progressive du seul mix Soundboard quand plusieurs sons se superposent.
- Cooldown par son décidé par Core (deux viewers simultanés : un seul passe), idempotence, ACK, `execution_unknown` après redémarrage (jamais de rejeu aveugle), fichier manquant / son désactivé / lecteur hors ligne refusés proprement.
- Extension : cartes de sons, aperçu distinct de l’achat, favoris / récents / recherche / tri, barre d’action compacte, états cooldown / en cours / indisponible, volume des aperçus.
- test_mode=true, payment_mode=simulated, real_debited=0 ; aucun Wallet réel, aucune prod.
- Le lecteur audio Studio doit être activé d’un clic à chaque chargement (règle d’autoplay des navigateurs).

### Noms des sons — validé (28/09/2026, commit `dbfb91b`)
- `sound_id` = identifiant technique stable, jamais modifié ; fichiers audio et mappings inchangés.
- `default_label` = nom canonique dans la banque Core (`bank.ts`) ; `custom_label` = renommage Studio optionnel (base, colonne `sound_lab_sounds.custom_label`).
- Nom affiché partout (configuration, catalogue viewer, historique d’achat) = `custom_label ?? default_label`.
- Renommage Studio persistant validé (accents, apostrophes et caractères français, survit au redémarrage du Core).
- Bouton « ↺ Nom par défaut » validé (visible seulement si un nom personnalisé existe) ; vider le champ revient aussi au nom par défaut.
- 6 labels canoniques corrigés : « Sigma - À genoux », « Maintenant, tais-toi », « Sardoche - C’était sûr ! », « C’est moi qui les ai plantés », « Sac à merde - Ptitchef », « Hell’s Kitchen Violin ». Cas douteux laissés tels quels : « Sigma freudonne », « Lacrimatica ».
- Migration `20261003120000_sound_lab_custom_label.sql` déterministe : une valeur égale à l’ancien nom par défaut de son `sound_id` → null ; les 19 renommages existants du Lab ont été préservés à l’identique (prix, cooldowns, modes, volumes et historique inchangés).
- Tests : Core 158/158, Studio 40/40, extension 10/10.

## TTS V2 — runtime réel validé (30/09/2026, Lab)
Prototype UX D3 + prototype player transformés en vrai module Lab (commits `eb798b9`, `bcfc7ee`, correctif viewer lié à Twitch dans `ef4025d`). **Validé manuellement par l’utilisateur le 30/09/2026 : le TTS joue réellement.** Publié avec le checkpoint Studio 0.1.5. **Pas en prod** (SAMMI + StreamElements restent la prod TTS).
- **Règles Core** (`apps/core-api/src/tts-lab/rules.ts`), reprises du legacy `tts-rules.js` (« tts-anti-abuse-v1 ») : base 7 500 jetons ; paliers 1–80 ×1 / 60 s, 81–150 ×1,5 / 90 s, 151–300 ×2 / 120 s, 301–500 ×3 / 180 s, 501+ ×5 / 300 s ; 1 crédit TTS par message (legacy : 1 récompense PDC = 1 TTS) ; 1 TTS par viewer en attente ou en lecture ; 5 en attente max (celui en lecture non compté) ; plafond de durée totale en attente configurable (désactivé par défaut) ; limite technique 2 000 points de code (legacy 800, les paliers au-delà de 500 ne changent pas). Probabilités de voix legacy : japonais 20 %, variante « bourré » 25 % (Golem 50 %), réduites sur les longs messages (×1 / 0,8 / 0,5 / 0,25 / 0,1) ; jamais deux fois le même personnage d’affilée.
- **Cast décidé une seule fois par Core à l’admission** `{ character_id, voice_profile_id }` (+ catégorie), idempotent (clé + empreinte de la requête), jamais retiré au sort ailleurs ; le client n’impose ni prix, ni cast, ni cooldown, ni position, ni remboursement.
- **File** : ordre par `channel_sequence`, lecture strictement une à une, pause entre deux TTS 1,5 s ; file pleine / pause / désactivé / viewer bloqué / cooldown / lecteur absent refusés **avant tout paiement**.
- **Cooldown** démarré au vrai début de lecture (1er `onstart` audible = narration « <pseudo> a dit », comme le legacy).
- **Remboursement** unique et tracé (audit) si le message n’a jamais été lu (échec avant lecture, expiration 30 min, annulation / stop / purge avec remboursement) ; `execution_unknown` (lecteur coupé pendant la lecture, redémarrage Studio) n’est pas remboursé automatiquement et n’est jamais rejoué.
- **États module** actif / en pause (la file est gardée, le TTS en cours finit) / désactivé ; « dégradé » = lecteur absent ou Core injoignable (affiché, refus avant paiement).
- **Modération (API Core, Studio seulement)** : pause, reprise, désactivation, stop du TTS en cours, purge, annulation d’un message, remboursement, blocage / déblocage d’un viewer (avec ou sans échéance), cooldown imposé ou levé, inspection de la file, journal d’audit. Hook lexical côté Core (filtre de message branchable, aucun mot bloqué par défaut). *(État au checkpoint 0.1.5 ; la modération V2 a ensuite été implémentée localement, non releasée : voir § « Modération V2 réelle ».)*
- **Twitch ban / timeout** : le bot n’a pas d’abonnement EventSub ban / timeout ; aucun effet automatique. Seul le blocage manuel par viewer (Core) existe.
- **Studio** : worker TTS (journal durable, jamais de rejeu d’un TTS remis au lecteur), page lecteur `/tts-lab/player.html` = source navigateur OBS 1920×1080 transparente (un seul lecteur à la fois : OBS ou l’aperçu Studio), carte « TTS V2 Lab » dans l’Extension Lab (état, lecteur, file + durée, en cours, historique, URL OBS, pause / reprise / stop / purge), entrées dans l’onglet Studio. Migration `20261004120000_tts_lab.sql` appliquée par le runtime local.
- **Lecteur** : séquence legacy (narration « <pseudo> a dit », entrée du personnage, texte en morceaux de 180 caractères, bouche à chaque mot, bulle + sous-titres 68 caractères, sortie), voix Web Speech du profil tiré (repli legacy : mot-clé → langue → préfixe → français ; voix stricte absente = échec avant lecture, remboursé), débit / hauteur avec la variation du profil. Scène portée du prototype player ; 10 médias legacy copiés à l’identique (`extension/assets/tts/`, SHA-256 vérifiés).
- **Extension** : UX D3 intégrée telle quelle (Panel / Vidéo / Mobile) dans le vrai écran module ; source unique personnages / voix / calibration `shared/tts-characters.js` (calibration finale du 30/09) ; clé d’idempotence enregistrée avant l’envoi et réutilisée (double clic, retry, refresh : un seul paiement) ; reprise de la transaction en cours après refresh ; le tirage n’anime que le cast déjà décidé par Core ; `calibrate.html` reste utilisable en Dev/Lab (réglage local prévisualisé dans l’extension Lab seulement).
- test_mode=true, payment_mode=simulated, real_debited=0 ; wallet Lab fictif débité une fois, rendu une fois au remboursement.
- Tests : Core 170 (dont 12 TTS), Studio 57 (dont 9 TTS), extension 10, bot 69, desktop 17 ; E2E Electron (Panel / Vidéo / Mobile, lecteur OBS réel, file, pause, refresh, crash lecteur, non-régression Soundboard).
- **Dette connue (documentée, non corrigée dans ce checkpoint)** :
  1. le lecteur peut commencer la lecture avant la fin de l’animation shuffle / reveal de l’extension : fonctionnement acceptable pour ce checkpoint, synchronisation UX stricte non garantie ;
  2. ~~pas encore de panneau Studio pour configurer les règles TTS~~ → fait le 30/09/2026 (Studio → Modération → Configuration TTS, voir § « Modération V2 réelle + configuration TTS »), en attente de validation.

## Modération V2 — parité D4 complète (Lab, 01/10/2026 — état actuel, en attente de validation)
Statut : **IMPLÉMENTÉ + TEST AUTOMATISÉ + E2E 95/95 · PACKAGE LOCAL À VALIDER (`release/moderation-d4`) · NON VALIDÉ MANUELLEMENT · NON RELEASE**. Commit `5b66579`. Référence : `prototypes/moderation-v2-d4/` ; matrices initiale et finale : `docs/moderation-v2-d4-parity.md` (75 lignes, aucune « backend manquant », placeholder, fake ou suppression silencieuse).

**Décisions d’Antoni (30/09/2026)** : Tombola = modèle réel (inscription gratuite, une par viewer, cagnotte offerte par la chaîne) ; mot surveillé = TTS **retenu** jusqu’à « Laisser passer » (la file continue sans lui ; expiration = remboursement) ; un mod avec « Gérer les permissions » ne modifie que les droits d’un autre mod, parmi ceux qu’il possède, jamais les siens ni ceux d’un supermod / du broadcaster ; « Rembourser » une interaction terminée (ajout hors D4) = « Admin Wallet ». Remboursements D4 = tout mod. Cooldown = modèle D4.

- **Core (Lab)** — migration `20261007120000_moderation_d4.sql` (ajoutée à `LAB_MIGRATIONS`, `bonk-lab.mjs`, `stage.mjs`) : `lab_staff` (rôles broadcaster / supermod / moderator + `grants`), `lab_viewers` (annuaire : recherche, premier passage, noms), `lab_global_state` (pause globale + compteur de refus), `lab_viewer_cooldowns` refaite (délai, fin de période, « Ce stream »), `lab_viewer_notes`, `lab_tts_words`, revue TTS (`review_status`, `review_hits`, `reviewed_by/at`), remboursements Soundboard / Bonk (`refund_status`), `sound_lab_deliveries.stopped_at`, ledger `admin` / `raffle_win`, Tombola (`lab_raffles`, `lab_raffle_entries`, `lab_raffle_winners`).
- **Permissions** (`lab-moderation/store.ts`) : standard Mod = pause / reprise, stop, retrait, purge, **remboursements**, Laisser passer, blocage ≤ 1 h par module, cooldown, notes, lecture ; 6 permissions D4 accordables ; Supermod / Broadcaster = tout ; broadcaster seul = configuration TTS, supermods, outils wallet de test, Tombola. Refus Core `403 forbidden` avec la permission D4 nommée.
- **Commandes** (`POST /v1/lab/moderation/:c/actions`) : `module_state` (4 modules, « Désactivé » vers ou depuis = permission), `stop_current`, `cancel` (TTS / Soundboard, attente ou en cours), `stop_all`, `purge`, `refund` (après coup), `allow`, `block_viewer` / `unblock_viewer` (dont Tombola), `set_cooldown` / `clear_cooldown`, `global_pause`, `set_permission`, `set_staff`, `add_note`, `add_word` / `remove_word`, `wallet_adjust`, `raffle_open` / `raffle_close` / `raffle_draw`. Tout est audité (`lab_moderation_audit`).
- **Read models** : `overview` (+ Tombola, pause globale), `search` (rôle + badge de restriction), `viewers/:id` (rôle, premier passage, aujourd’hui, notes, restrictions, ledger typé), `interactions` (tous modules, filtres module / statut / viewer / période « Ce stream » = depuis 16:00 Paris, pagination), `interactions/:id` (actions liées, mouvements), `ledger` (viewer ou chaîne, types + `visible_in_moderation_activity`, liens remboursement / débit), `team`, `words`, `audit`. Un viewer ne les lit jamais (façade `as` / `as_role`, refus Core).
- **Admissions** : pause globale (TTS, sons, bonks, tombola ; compteur), mots bloqués / surveillés (TTS), cooldown personnel D4 (TTS / Soundboard / Bonk), débit du wallet Lab pour Soundboard et Bonk (remboursement automatique si jamais joué / affiché), annuaire des viewers.
- **Soundboard stop** : Core annule → le worker Studio l’apprend (lecture Core) → ordre `stop` au lecteur → le lecteur coupe le son et envoie l’ACK `stopped` → Core enregistre `stopped_at` ; les ACK tardifs sont ignorés.
- **Tombola V2 minimale** (`raffle-lab/raffle-lab-service.ts`) : une manche ouverte à la fois, fermeture automatique à l’échéance, inscription gratuite idempotente, contrôles module / blocage / pause globale, tirage (gagnants au hasard, cagnotte partagée) payé sur le wallet Lab. La façade LabEbs lit l’état Core pour la session de l’extension ; les contrôles « Tombola » de l’Extension Lab et de Studio passent par Core.
- **Console unique** (`apps/twitch-extension/extension/shared/moderation-v2.js`) : parité D4 écran par écran (modules, file, À vérifier, Laisser passer, Stop / Stop tous les sons, fiche viewer, Plus, Notes, Wallet admin, Détails, Bloquer avec verrou sensible, Cooldown D4, Surveillance, Équipe & permissions, pause globale + bandeau, Tombola, Historique Interactions / Jetons / Modération avec filtres Core). Montée par l’extension (acteur = identité Twitch) **et** par l’onglet Studio « Modération » (acteur = broadcaster), avec les outils Studio : Tombola, Supermods, Configuration TTS, Wallet de test (dont « Effacer le cooldown TTS »). Extension Lab : surface « Moderator Window » 1100×720.
- **Extension viewer** : messages `global_pause`, `message_blocked`, `raffle_paused`, `module_disabled` ; le TTS affiche « en pause » pendant une pause globale.
- **Tests** : Core 208 (+25 D4 : permissions, anti-escalade, sanctions sensibles, mots, notes, pause globale, cooldown D4, non-régression clear, wallet admin, stop / stop all / remboursements Soundboard, débit Bonk, Tombola, read models), Studio server 64 (+4 : synchro Studio ⇄ extension dans les deux sens, lecteur viewer refusé, Tombola via façade, chaîne stop Core → worker → lecteur → ACK). **E2E réel 95/95**. **Aucune de ces vérifications ne remplace la validation manuelle d’Antoni.**

## Historique — Modération V2 avant la parité D4 (30/09/2026, remplacé par `5b66579`)
*Historique daté : les étapes ci-dessous ne décrivent **pas** l’état actuel (voir § « Modération V2 — parité D4 complète »), sauf les points marqués « toujours valable ».*
- `435f78d` (Core Lab : états de module, blocages, cooldowns en blocage temporaire, supermods, wallet de test, audit, configuration TTS) et `706f8c7` (cockpit Studio « inspiré de D4 », non audité en parité) — le cockpit a depuis été remplacé par la console D4 partagée ; le cooldown par le modèle D4 ; le remboursement « Supermod uniquement » par la règle D4 (tout mod).
- `12ffdd0` : première console extension annoncée « D4 » à tort (audit strict du 30/09 : ~50 % du prototype absent ou remplacé sans le signaler).
- `a5b5d5e` : mini-passe de parité (sans changement Core, E2E 36/36, package `release/mini-d4` — **obsolète**). À cette date, Tombola Core, pause globale, notes, mots surveillés / bloqués, permissions fines, stop / remboursement Soundboard, Jetons de toute la chaîne et cooldown D4 étaient affichés « backend manquant » : **tous implémentés depuis dans `5b66579`**. Les décisions alors en attente ont été tranchées le 30/09.
- Toujours valable :
- **Configuration TTS réelle** (Studio → Modération → Configuration TTS) : paliers (min / max / prix jetons / crédits / cooldown), longueur max, nombre max en attente, durée max en attente (facultative), délai entre deux TTS, TTS simultanés par viewer, état du module. Valeurs lues dans Core ; validation stricte côté Core (chevauchement, trou, bornes, dernier palier seul ouvert, longueur max ≤ dernier palier fermé) avec message clair ; stockage `tts_lab_settings.rules`, appliqué au prochain achat sans redémarrage ; « Restaurer les valeurs par défaut » (legacy) avec confirmation ; avant / après dans l’audit. Prix désormais absolus par palier (défauts legacy 7 500 / 11 250 / 15 000 / 22 500 / 37 500).
- **Wallet de test (Lab)** : jetons, crédits TTS, crédits Soundboard par viewer, en base Lab (`lab_wallets` + journal `lab_wallet_ledger`), jamais l’économie réelle. Édition réservée à Studio (broadcaster) : Définir, +10 000 jetons, +1 crédit, Reset test. Le TTS débite ce wallet **dans la transaction d’admission** (solde insuffisant = refus avant tout enregistrement) ; un remboursement rend exactement le montant débité, au plus une fois (entrée de journal unique). Depuis `5b66579`, Soundboard et Bonk débitent aussi ce wallet ; le Wallet admin D4 (créditer / débiter) est disponible dans la console avec la permission « Admin Wallet ». L’extension affiche les valeurs de ce wallet.
- **Bug manuel corrigé (30/09/2026, IMPLÉMENTÉ + TEST AUTOMATISÉ, à valider manuellement, NON RELEASE)** : le cooldown TTS est armé au vrai début de lecture (événement `started`) ; un effacement fait pendant que le TTS du viewer était encore en attente / remis au lecteur était donc écrasé au démarrage (le cooldown revenait, l’achat suivant était refusé `viewer_cooldown`). Correction Core : colonne `tts_lab_viewers.cooldown_cleared_at` (migration Lab `20261006120000_tts_lab_cooldown_clear.sql`, ajoutée aux listes `LAB_MIGRATIONS` / `bonk-lab.mjs` / `stage.mjs`) posée par l’action « clear » ; au démarrage, un TTS admis avant le dernier effacement ne réarme plus le cooldown (les TTS achetés après l’effacement gardent le cooldown normal ; sans effacement manuel, comportement legacy inchangé). La règle « un TTS par viewer » (`viewer_busy`) est conservée : effacer le cooldown ne permet pas d’acheter tant que le TTS précédent n’est pas terminé. Extension : message `viewer_busy` remplacé par « Ton TTS précédent n’est pas encore terminé » (⏳, couleur distincte) ; le cooldown garde « Prochain TTS dans mm:ss » (⏱). Tests Core ajoutés : effacement avant `started` → 0 après le démarrage → nouvel achat accepté dès la fin ; effacement pendant et après lecture ; plusieurs TTS en file (seuls ceux achetés avant l’effacement sont exemptés) ; non-régression sans effacement. Vérifié aussi en réel (lecteur, environnement isolé) et E2E de non-régression (console modération extension 21/21, synchro Studio ⇄ extension 3/3).
- **Audit Soundboard (sons simultanés)** : modes réels `stack` / `queue` / `ignore_if_running` (pas de `replace`). `queue` et `ignore_if_running` ne s’appliquent qu’entre instances **du même son** ; deux sons différents sont toujours remis en parallèle (8 max). E2E réel : deux sons « stack » (`bowser-theme` + `boom`) joués simultanément par le lecteur (2 éléments audio actifs).
- **Twitch ban / timeout** : aucune synchro. Tout blocage est **interne Raptoru** ; le bot ne reçoit ni ban ni timeout Twitch (pas d’abonnement EventSub correspondant).

## Wallet switch global — validé
Composant `createCurrencySwitch` (extension, `shared/ui-primitives.js` + `currency-switch.css`), variante « Peek slide » validée le 28/09/2026 :
- largeur fixe, montant immobile dans sa case, abréviation 1,2K / 12K / 985K / 1,2M ;
- zone sombre autour de la pill, survol = amorce du changement, clic = fin du mouvement ;
- infobulle du solde exact au survol / focus clavier, fermée au clic, jamais au tactile ;
- utilisé dans le Hub (Jetons + total des crédits, détail par module dans l’infobulle ; consultation seulement), l’Historique (idem), les en-têtes Soundboard / TTS (monnaie de paiement), les barres de paiement Soundboard / TTS, et Bonk / Tombola (jetons seuls, sans bascule).
- **Ancien wallet Historique : migré** (ainsi que les en-têtes Bonk et Tombola). Plus aucun ancien rendu wallet actif dans l’extension.
- Les crédits restent propres à chaque module : le total affiché n’en fait pas une monnaie globale. Aucune logique Wallet / paiement modifiée.

## Hub Pop Premium — validé / fermé
Nouveau Hub de l’extension, validé définitivement le 28/09/2026 (`shared/hub-carousel.js` + `hub.css` + vue d’accueil de `shared/ui.js`) :
- carousel horizontal aimanté, boucle infinie sans clone, cartes de face, carte active plus grande, animation amortie sans rebond (y compris en rafale) ;
- flèches, clic voisin, glisser / swipe, molette horizontale, clavier ← → / Entrée ;
- ~~rail d’accès rapide + popover « Tous »~~ → remplacés le 29/09/2026 par dots + grille (voir « Navigation Hub » ci-dessous) ;
- style « Pop Premium » (couleur franche par module, disque blanc + pictogramme, Bonk = emote projetée) ;
- vrais modules uniquement : TTS, Soundboard, Bonk, Tombola, Modération (modérateurs seulement) ; « Ouverte » seulement si la Tombola est ouverte, « En pause » pour le TTS en pause ou un module désactivé (non ouvrable) ;
- Historique et Classement visibles sur le Hub, Tutoriel conservé (contenu à refaire plus tard), « Actualiser » dans Préférences (plus de bouton ↻ visible) ;
- en Vidéo, Échap ne vide plus le composant (il ne ferme que les couches internes).
Validé dans le Lab en Viewer / Modérateur × Panel / Mobile / Vidéo. Extension non publiée.

### Navigation Hub — validée (29/09/2026, commit `5538111`)
Issue des prototypes locaux `prototypes/hub-nav-dots/` et `prototypes/hub-nav-dots-footer/` (non versionnés), variante retenue **C · Tous dominant** :
- rangée permanente de mini-logos **retirée** ;
- **dots de position** sous le carousel : un par carte, dot actif allongé à la couleur du module, synchronisés avec flèches, clavier, glisser, clic voisin, molettes et boucle (repère visuel seulement, non cliquables) ;
- **navigation secondaire** sous un trait fin : Historique discret à gauche · **bouton grille** au centre · Classement discret à droite (Historique et Classement ne sont pas des cartes du carousel) ;
- **bouton grille** : icône seule (ni texte « Tous », ni compteur), infobulle « Voir tous les modules », ouvre le **lanceur dense** (petites cases icône + nom + pastille d’état, uniquement les modules du carousel) ; choisir un module ferme le lanceur, positionne le carousel et le dot ; fermeture aussi par clic extérieur / Échap ;
- **molette verticale** sur la zone du carousel (cartes et flèches) : bas = carte suivante, haut = précédente, **1 geste = 1 carte** (inertie trackpad / molette libre absorbées) ; aucun effet hors carousel ; Ctrl+molette non bloqué ; molette horizontale et Maj+molette inchangées ;
- **glow de la carte active adouci** : plus d’anneau net, ombres en couches + aura radiale fondue à la couleur du module ;
- **Tutoriel « ? » conservé provisoirement** au bord droit du pied de page.
- Refonte tutoriel / onboarding **repoussée** à après la migration des modules principaux. Piste : tutoriel automatique à la première ouverture, possibilité de le passer, et de le rouvrir ensuite. Non implémenté.
- Tests : extension 10/10, build extension OK ; validé dans l’Extension Lab (source) en Vidéo / Panel / Mobile avec de vraies molettes système.
- Incluse dans la release Studio 0.1.5 (le Studio installé embarque une copie figée de l’extension).
- Toujours aucune publication Twitch, aucune production.

## Modération V2 — direction UX D4 validée (29/09/2026)
**`prototypes/moderation-v2-d4/` est la spécification UX et fonctionnelle de la modération** (pas une inspiration). Conception validée au niveau prototype le 29/09 ; l’implémentation est décrite dans § « Modération V2 réelle ».
- exploration A/B/C (`prototypes/moderation-v2/`), puis direction minimaliste D1/D2/D3 (`prototypes/moderation-v2-refined/`), puis convergence **D4** (`prototypes/moderation-v2-d4/`) — prototypes HTML locaux, **non versionnés**, données fictives ;
- D4 = base D2 (colonne gauche : recherche + modules + Historique ; zone droite : une seule intention — module, fiche viewer, historique ou détail), file TTS / Soundboard complète reprise de D3 ;
- contenus validés : états module Actif / En pause / Désactivé via menu compact, pause avec « garder la file / annuler + rembourser », retrait / stop avec ou sans remboursement (poubelle + menu), fiche viewer compacte (restrictions avec ×, Bloquer / Cooldown / Plus, activité récente, Activité Jetons), blocage global ou par module (30 s / 1 min / 5 min / personnalisé, aucune sanction Twitch), cooldown personnel (délai imposé + durée), notes internes discrètes, historique léger + détails techniques au clic, **Activité Jetons** (mouvements automatiques masqués via un futur `visible_in_moderation_activity`), **mots surveillés TTS** (« À vérifier », jamais bloqué automatiquement ; mots bloqués = concept seulement — *prototype ; décision du 30/09 : TTS surveillé retenu jusqu’à « Laisser passer », mots bloqués réels*), pause globale supermod (refuse les nouvelles interactions sans stopper / purger / rembourser), permissions Mod / Supermod / Broadcaster avec délégation individuelle, infobulles ;
- surface de référence Video Component 600×432 ; **Moderator Window** = Panel Twitch ouvert en pop-out (pop-out documenté par Twitch pour les Panels et la Live Config, pas pour le Video Component ; option à vérifier dans la console Twitch ; non configuré) ; portail web `raptoru.fr/moderation` non nécessaire pour la V1, non créé.
- **Implémentation (01/10/2026, locale, non validée manuellement, non releasée)** : **parité D4 complète** (`5b66579`), voir § « Modération V2 — parité D4 complète » et `docs/moderation-v2-d4-parity.md`. Dépendances extérieures restantes : badges VIP / Sub, mouvements automatiques du Wallet réel, pop-out Twitch réel.

## Roadmap après Bonk
Ordre recommandé à date (checkpoint 30/09/2026 : Studio autonome + Hub + Bonk V2 + Soundboard V2 + TTS V2 validés) :
1. ~~Soundboard~~ (validé en Lab le 28/09/2026) ;
2. ~~TTS~~ (runtime réel validé en Lab le 30/09/2026) ;
3. **Modération V2** (parité D4 complète en Lab le 01/10/2026, `5b66579` ; validation manuelle d’Antoni en attente) ;
4. **Tombola V2** (minimale dans Core depuis `5b66579` ; refonte complète — écran viewer, lancement automatique — quand un prototype existera) ;
5. Bonk Fidelity (polish, non bloquant) ;
6. instrumentation stats/profil au fil des modules ;
7. Jeu des mots 2.0 ;
8. achievements/cosmétiques ;
9. FX/Creepy/BRB/NTM ;
10. Votekick/Caution/Random Ban ;
11. Spotify ;
12. duel/roulette/slots/oracle et satellites.

Cette roadmap reste modulable après audit réel de chaque feature.

**Prochaines actions (ordre) : 1. validation manuelle du package `release/moderation-d4` ; 2. corriger uniquement les écarts constatés ; 3. ensuite seulement, release Studio ; 4. audits de parité des autres modules à prototype validé ; 5. Tombola V2 complète quand un prototype existera** (voir HANDOFF § 11).

# 17. Import des données historiques / cutover

**À FAIRE TOUT À LA FIN.**

Ne pas importer maintenant les soldes/statistiques StreamElements car ils continuent de bouger en production.

Plan final attendu :
1. tout le nouveau système fonctionnel est prêt ;
2. audit final StreamElements/SAMMI ;
3. extraction des soldes/stats à conserver ;
4. dry-run import ;
5. comparaison ;
6. éventuel gel très court ;
7. import final ;
8. validation ;
9. feu vert global ;
10. ancien chemin OFF → nouveau chemin ON.

Pas de cutover économique avant ce moment.

---

# 18. Agents de code / modèles — règle pratique

## Claude Code
Utilisé comme agent principal jusqu’ici.

Choix pratique :
- petite tâche / docs / fix mécanique : Sonnet ;
- slice normal multi-fichiers : Sonnet ;
- architecture, concurrence, idempotence, migration risquée : Opus 5.5.

Ne pas utiliser Opus par réflexe si Sonnet suffit.

## Astra Mid via Codex Code / app bureau ChatGPT
Astra Mid a maintenant accès directement au même workspace canonique :
`C:\Users\Antoni\Documents\Raptoru 2.0`

Accès confirmé :
- Git ;
- branche `main` ;
- fichiers du repo ;
- 8 workspaces npm ;
- scripts `dev`, `build`, `test`, `typecheck`, `lint`, `check`, `studio`, `studio:desktop`, `studio:package`, `studio:release`.

Il a déjà réalisé l’audit Bonk V2 complet sans modifier la prod ni le code.

Conclusion pratique :
- Astra peut servir de complément quand Claude manque de crédits ;
- il peut aussi faire audits, revues croisées et slices bien bornés ;
- ne jamais faire travailler Claude et Astra simultanément en écriture sur le même workspace ;
- préférer : agent A → commit/checkpoint propre → agent B reprend ;
- toujours relire Git status/diff/log avant de reprendre un chantier.

## Documentation commune
`CLAUDE.md` existe à la racine pour les règles Claude/release.

Un `AGENTS.md` commun à tous les agents a été proposé mais **n’est pas confirmé comme créé** à ce checkpoint. Ne pas supposer son existence : vérifier le repo.

# 19. Reprise dans une nouvelle conversation / nouvel agent

Au démarrage d’une nouvelle conversation ou d’une session Astra/Claude :

1. travailler uniquement dans :
   `C:\Users\Antoni\Documents\Raptoru 2.0`
2. lire **d’abord `Raptoru-2.0-HANDOFF.md`**, puis ce fichier pour le détail ;
3. lire `CLAUDE.md`, `README.md` et les docs pertinentes du module ;
4. exécuter au minimum `git status`, `git log -n 10 --oneline` et vérifier le HEAD réel ;
5. ne jamais supposer qu’un SHA de ce document est encore le HEAD ;
6. rappeler que SAMMI + StreamElements restent la prod/référence ;
7. rappeler que les données historiques SE seront migrées à la toute fin ;
8. distinguer :
   - techniquement validé ;
   - migré/branché ;
   - activé en production ;
9. ne jamais cutover un module juste parce qu’il passe ses tests ;
10. pour Studio, une feature validée peut ensuite passer par `npm run studio:release` ;
11. Bonk V2 est validé (§ 16) : ne pas le refaire ; seul le polish Bonk Fidelity reste, non bloquant.

### Audit Bonk de référence
Rapport :
`outputs/Audit-Bonk-V2.md` dans la session Astra qui l’a produit, ou fichier exporté fourni par l’utilisateur.

Le rapport est un audit statique. Aucun test OBS/SAMMI/prod n’a été exécuté pendant cet audit.

### État Git à revérifier
Au 01/10/2026 (handoff) :
- branche `main`, aucun remote, aucun tag dans le repo source ;
- HEAD fonctionnel `5b66579` (Modération V2 — parité D4 complète), suivi uniquement de commits docs ;
- dernière release publique : Studio 0.1.5 (`f81955d`, tag `v0.1.5` sur `raptorutwitch/raptoru-studio-releases`) ; `435f78d`, `706f8c7`, `12ffdd0`, `890e71d`, `a5b5d5e`, `5b66579` **non releasés** ;
- tree propre attendu, hors `prototypes/` (local, exclu, non versionné) et runtime / .env ignorés ;
- package à tester : `apps/studio/desktop/release/moderation-d4/win-unpacked/Raptoru Studio.exe` (fermer d’abord tout autre Studio : verrou partagé) ; **ne pas** tester `release/mini-d4` ni `release/win-unpacked` (obsolètes) ;
- release uniquement après validation explicite (« c’est bon », « validé », « go ») via `npm run studio:release` (voir `CLAUDE.md`).

Toujours vérifier l’état actuel avant toute modification.

# 20. Résumé ultra-court

```text
Raptoru 2.0 = Core central + Twitch Bot fin + Studio Electron local + Extension viewer + Postgres.

VALIDÉ TECHNIQUEMENT, mais pas activé prod :
- Presence
- Wallet Core
- Wallet Commands + Permissions
- Loyalty passif
- Rewards Twitch
- Daily
- Daily → Wallet
- durabilité/restarts
- Studio Windows
- Extension Lab
- auto-update Studio
- pipeline studio:release
- Bonk V2 Lab (validé visuellement le 27/09/2026)
- Soundboard V2 Lab (validé le 28/09/2026 ; noms des sons default_label + custom_label validés)
- wallet switch global de l’extension (validé le 28/09/2026)
- Hub Pop Premium (validé / fermé le 28/09/2026)
- navigation Hub : dots + grille / lanceur dense + molette verticale (validée le 29/09/2026, `5538111`)
- Studio autonome : runtime local + supervision Electron du serveur Studio (validé le 30/09/2026)
- TTS V2 Lab runtime réel (validé le 30/09/2026 ; dette : synchro reveal / lecture)

IMPLÉMENTÉ + TESTS AUTO + E2E 95/95, PACKAGE LOCAL (release/moderation-d4), NON VALIDÉ PAR ANTONI, NON RELEASE :
- Modération V2 — parité D4 complète (5b66579) : permissions fines par mod (Core), sanctions sensibles,
  mots surveillés (TTS retenu) / bloqués, notes, pause globale, cooldown D4, wallet admin,
  stop / remboursements Soundboard (Core → worker → lecteur → ACK), débit Bonk, Tombola V2 minimale,
  historiques Core ; une seule console pour l'extension et l'onglet Studio « Modération »
- correctif « Effacer le cooldown TTS » (890e71d), non régressé

DÉPENDANCES EXTÉRIEURES : badges VIP / Sub (API Twitch broadcaster), mouvements automatiques (Wallet réel),
  pop-out Twitch réel (publication), synchro ban / timeout Twitch

Studio :
- updater réel validé en 0.1.0 → 0.1.1
- v0.1.2 publiée via le pipeline one-command
- Studio 0.1.1 détecte bien v0.1.2
- v0.1.5 = checkpoint Studio autonome + Hub + Bonk V2 + Soundboard V2 + TTS V2 (dernière release, validée ; ne contient pas la Modération V2)
- feed public = raptorutwitch/raptoru-studio-releases
- repo source local non poussé

Extension :
- vraie extension prod importée
- Tombola du Lab = Tombola V2 minimale dans le Core Lab (inscription gratuite, tirage Studio, gains sur le wallet Lab)
- TTS V2 exécuté réellement en Lab (Core Lab → Studio → lecteur OBS), validé
- Soundboard V2 exécuté réellement en Lab (Core Lab → Studio → lecteur audio local)
- Hub Pop Premium + wallet switch global (anciens wallets migrés)
- nouvelle extension (picker V2, Soundboard V2, Hub) NON publiée sur Twitch

BONK V2 = VALIDÉ (Lab), PAS ACTIVÉ EN PROD :
- Extension Lab → Core local/test → Studio → OBS → overlay (ACK started/completed/failed)
- catalogue : Twitch viewer (OAuth user:read:emotes) statiques + animées, Bits,
  7TV / BTTV / FFZ (chaîne + globales), Twemoji complet (~1914)
- Core valide provider/id et construit les URL ; aucune URL client
- picker : rail Récents / Favoris / Twitch / Bits / Extension / Emoji,
  continuous scroll, lazy, persistant entre les polls, recherche multi-provider,
  animées dans la grille, favoris + drag & drop, étoile desktop, bouton favori tactile
- test_mode=true, payment_mode=simulated, real_debited=0
- zéro Wallet réel, zéro stats/progression réelle, zéro prod
- reste (non bloquant) : Bonk Fidelity (impact FX, centre caméra, tailles, disparition)

PROCHAINE ACTION : validation manuelle du package release/moderation-d4 par Antoni → corrections ciblées → release Studio.
RÈGLE : prototype validé = spécification ; rien n’est supprimé ou simplifié silencieusement.
Roadmap indicative ensuite : stats/profils → Jeu des mots 2.0 → achievements/cosmétiques → FX → modération sociale → Spotify/casino.

Production réelle actuelle :
SAMMI + StreamElements.

Import historique :
SEULEMENT à la toute fin juste avant cutover global.

Agents :
- Claude Code = agent principal
- Astra Mid/Codex Code = accès confirmé au même workspace, bon pour audit/review/slices bornés
- jamais deux agents en écriture en parallèle
```

