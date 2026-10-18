# Raptoru 2.0 — État du projet et roadmap globale

**Vue d'ensemble principale du projet** : où en est tout Raptoru 2.0, ce qui est validé, où chaque brique tourne
(local / staging / Hosted Test / release / production), ce qui reste, les priorités, les bloquants et les dettes.
Mis à jour le **18/10/2026** : § 0.0 (point d'avancement SAMMI → Raptoru, roadmap des migrations) est la référence
centrale ; le reste du § 0 date du 16/10/2026 sauf les lignes marquées « 18/10 ».

Répartition des documents (une seule source de vérité par sujet) :

| Document | Rôle |
| --- | --- |
| **ce fichier** | vue globale, roadmap, santé du projet, statut de chaque module |
| [`Raptoru-2.0-HANDOFF.md`](Raptoru-2.0-HANDOFF.md) | reprise rapide d'un agent : règles non négociables, commandes, pièges, contexte opérationnel |
| [`docs/CUTOVER_PLAN_2026-10.md`](docs/CUTOVER_PLAN_2026-10.md) | déploiement, staging, migration legacy → 2.0, P1 de cutover, rollback, décisions D1–D6 |
| [`docs/BONK_VNEXT_AUDIT_2026-10.md`](docs/BONK_VNEXT_AUDIT_2026-10.md) | détail technique de Bonk VNext (§ 0 = état) |
| [`docs/COMMANDS_V2_STATUS.md`](docs/COMMANDS_V2_STATUS.md) | détail de Commands V2 |
| [`docs/WORD_GAME_PARITY.md`](docs/WORD_GAME_PARITY.md) | Jeu des mots V1 : règles de parité, checkpoint de migration (§ 0), statuts RET-WORD |
| [`docs/ROULETTE_SLOT_PARITY.md`](docs/ROULETTE_SLOT_PARITY.md) | Roulette et Slot V1 : règles de parité, checkpoint (§ 0), statuts RET-GAME-001 / 002 |
| [`docs/ASTRA_GLOBAL_AUDIT_2026-10.md`](docs/ASTRA_GLOBAL_AUDIT_2026-10.md) | registre des findings d'audit (statut, preuve, commit) |
| autres `docs/` | détail technique ou historique d'un module (matrices de parité, calibration, procédures) |

---

# 0. État courant — 18/10/2026

## 0.0 Point d'avancement SAMMI → Raptoru (18/10/2026) — référence centrale

Vérifié le 18/10/2026 sur : base Lab (`cp_rewards`, `cp_rules`, `cp_redemptions`), decks SAMMI
(`SAMMI.2022.5.3.x64/json/decks_data.json`, 16/10 21:24, lecture seule), collection OBS active, processus et ports de
la machine, Git (HEAD `8e37c35`). Remplace les inventaires partiels précédents (audit SAMMI du 17/10, § 0.5b, tableau
§ 7 de `docs/CHANNEL_POINTS_V1.md`). **Rien de Raptoru 2.0 n'est en production** : tout ce qui suit est Lab (Studio
source + Core Lab + adaptateur Twitch Lab), sauf mention « staging ».

### 0.0.1 Résumé

- **Migré et validé dans le vrai OBS (Lab)** : lecteur d'effets + sons d'effet, NTM, Creepy, BRB, FX Cam, Couleur Cam ;
  alertes Twitch (rendu, files) ; plus, depuis début octobre, Bonk VNext, Soundboard, TTS, Tombola,
  Modération, Commands, Jeu des mots, Roulette / Slot, Duel.
- **Validé par une vraie redemption Twitch** (Points de chaîne, automatisations ON) : « Test Lab » (scène, 17/10),
  **FX Cam** (« drunk », 18/10 09:21 UTC), **Couleur Cam** (« emeraude », 18/10 10:33 UTC, SAMMI fermé — validé de bout
  en bout par Antoni) ; trace d'une vraie redemption **Creepy** exécutée (18/10 09:21:12 UTC, non commentée par
  Antoni).
- **Toujours 100 % SAMMI en production** : tout (le stream réel n'utilise aucune brique Raptoru 2.0). Fonctions **sans
  équivalent Raptoru** : modération ludique (Ban aléatoire, Votekick, Caution), Spotify, Level Up Wizebot, commandes
  viewer avec son, 24H / crédits, banque, cash-in, roue des subs, `!fx` / `!rb` / `!tts` / `!bonk` en jetons.
- **Restant avant de pouvoir couper SAMMI** : 3 lots fonctionnels (modération ludique, Spotify, petits restes), l'audit
  technique global, puis le cutover (Core + bot de production, Studio publié, Extension publiée, économie).

### 0.0.2 Points de chaîne — 37 récompenses (liste Twitch synchronisée en Lab)

Catégories : **A** validé dans OBS (Tester Studio) · **B** validé par une vraie redemption · **C** développé, non testé
en réel · **D** partiellement migré · **E** encore exclusivement SAMMI (ou autre outil legacy) · **F** à supprimer /
fusionner / remplacer. « Twitch » = état de la récompense sur Twitch (ON / OFF).

| Récompense (coût) | Twitch | Production aujourd'hui | Raptoru (Lab) | Cat. | Prochaine action |
| --- | --- | --- | --- | --- | --- |
| FX cam (500) | ON | SAMMI ID12 + minuteur ID26 | interaction `fx_cam`, règle ON ; vraie redemption validée | **B** | cutover ; `!fx` jetons avec l'économie |
| Creepy (700) | ON | SAMMI ID28 | interaction `creepy`, règle ON ; validé OBS ; 1 vraie redemption exécutée (trace) | **A** (+ trace B) | confirmer en réel |
| Be Right Back (1500) | ON | SAMMI ID48 | interaction `brb`, règle ON ; validé OBS (latence au départ, réserve) | **A** | vraie redemption ; latence → audit global |
| ntm (2000) | ON | SAMMI ID18 | vidéo d'effet, règle ON ; validé OBS | **A** | vraie redemption |
| Eren cri (1500) | ON | SAMMI ID15 (son) | son d'effet, règle ON ; validé OBS | **A** | vraie redemption |
| Couleur Cam (100) | ON | SAMMI ID45 — **cible « Groupe 2 » supprimée d'OBS** (voir risques) | interaction `color_cam`, règle ON ; rendu validé OBS ; **vraie redemption validée** (« emeraude », 18/10) | **B** | cutover (bouton SAMMI ID45 à couper) |
| Tiens bon ! (500), Bzez (1500), Skyzz (1000 → « Glory holes »), Seigneur Percé (1500 → « Quoicoubaka bibou ») | ON | SAMMI ID16 / 22 / 23 / 24 (sons) | sons importés dans le catalogue du lecteur d'effets ; **aucune règle saisie** | **C** | saisir 4 règles « Son d'effet » + Tester (config, pas de code) |
| Arrêteuh (1500) | OFF | SAMMI ID17 (son) | son « Karma — Arrêteuh » importé, pas de règle | **C** | règle si la récompense revient |
| Test Lab (100) | ON | — (récompense de test d'Antoni) | scène « Waiting screen » ; vraie redemption validée 17/10 | **B** | supprimer de Twitch après le cutover |
| Hello (100) | OFF | — | son Soundboard, règle ON (tests Studio) | **C** | décision : garder ? |
| Ban aléatoire (3000) | ON | SAMMI ID56 « RB PDC » (timeout, animation, son) | rien | **E** | lot « modération ludique » |
| Choisi la prochaine musique ! (1000) | ON | SAMMI Spotify → `sammi-bridge` 127.0.0.1:9567 | rien | **E** | lot « Spotify » |
| Skip la musique (2000) | OFF | SAMMI ID50 → 9567 | rien | **E** | lot « Spotify » (ou supprimer) |
| TTS (1000), Soundboard (1000) | ON | **aucun bouton SAMMI** : probablement l'Extension / EBS legacy (non prouvé) | TTS V2 / Soundboard V2 (Extension) | **D** | vérifier qui les traite ; fusion avec l'Extension au cutover |
| Emote only (10000) | ON | **aucun bouton SAMMI** ; Wizebot selon l'inventaire du 26/09 (non revérifié) | rien | **E** | peut rester Wizebot ; décision |
| Led couleur (250) | ON | **aucun bouton SAMMI trouvé** : traitement inconnu (StreamDock / Neewer ?) | rien | **E ?** | Antoni : qui l'exécute ? |
| Couleur Overlay (250) | OFF | SAMMI deck « Overlay Color » ID160 (encore actif) | rien | **F ?** | décision : supprimer ou fusionner avec Couleur Cam |
| Couleur overlay Cam (100) | OFF | ancien bouton ID102 (deck inactif) | remplacée par Couleur Cam | **F** | supprimer de Twitch |
| Cash-In (1) | OFF | SAMMI `!cashin` + redemption (StreamElements) | rien | **E** (économie) | décision au cutover économique |
| Je t'offre le sub / le ubereat / Jeu offert | ON / OFF / OFF | manuel (aucun bouton) | — | hors périmètre | — |
| Wasted, Boop!, Ohlala, 200 IQ, Dance Fortnite, Musique refusée, Fais moi écouter ta musique !, Ban forcé, Lever le ban, Counter Ban 1 / 5 | OFF | aucun bouton SAMMI actif | — | **F ?** | décision : nettoyer sur Twitch |
| Lucky Wheel, Blrt Tells a Dad Joke | absentes de Twitch | decks « Lucky Wheel » (`!spin` encore actif) et « Deck 1 » | — | **F** | désactiver les decks au cutover |

Limites : Raptoru ne peut **ni valider ni rembourser** ces récompenses (créées par SAMMI / Twitch, pas par l'app
Raptoru) — les refus (mauvaise scène, couleur inconnue, déjà actif) sont enregistrés mais non remboursés ;
interrupteur des automatisations **OFF** au 18/10 (12:15).

### 0.0.3 Le reste du stream (hors Points de chaîne)

| Domaine | Production aujourd'hui | Raptoru 2.0 | Cat. |
| --- | --- | --- | --- |
| Alertes follow / sub / gifts / bits / raid / don | SAMMI (ID_FOLLOW, ID1, ID39, ID_SUBGIFT_TARGETED, ID_BITS_ALERT) → source « Alerte Twitch » + `alertes_server.js` (port 3001, tourne) ; dons StreamElements | Alertes V1 : rendu, files, calibrages **validés OBS** ; vrais événements en TEST ; bot de production non raccordé | **D** |
| Roue des subs (crédit de Jetons) | SAMMI ID1 → StreamElements | rien (RET-ECO-007, économie) | **E** |
| Soundboard, TTS, Bonk (Extension) | Extension publiée → EBS `raptoru.fr/api` → déclencheurs SAMMI (`RAPTORU_EXT_SOUNDBOARD_V2`, `RAPTORU_EXT_TTS_V2`, `RAPTORU_EXT_BONK_V3`) | V2 validés Lab + staging (07/10), Bonk VNext validé Lab | **D** |
| `!tts` (jetons), `!bonk` (jetons) | SAMMI → StreamElements | via l'Extension seulement ; paiement réel non branché | **E** (économie) |
| Tombola (`!join`, tirage, paiement) | SAMMI + EBS legacy + StreamElements | Tombola V2 validée Lab + staging | **D** |
| Jeu des mots | deck SAMMI | V1 validé en vrai chat (Wallet Lab) | **D** |
| Roulette, Slot, Duel | StreamElements | V1 validés (Wallet Lab) | **D** |
| `!daily`, `!streak`, StartStream | SAMMI → `raptoru.fr` (EBS legacy) + StreamElements | Daily / streak Core (drapeaux OFF, import legacy prévu) ; état du live par Twitch | **D** |
| Votekick (`!votekick`, `!kick`, `!save`, `!userid`), Caution (`!caution`, `oui` / `non`), Unmute secours | SAMMI (timeouts Twitch, filtres OBS « Votekick Zoom / Mute » sur « overlay cam shushu », sons ; Caution en jetons) | rien | **E** |
| Ban aléatoire en jetons (`!rb`) + animation de ban | SAMMI ID74 / ID63 (StreamElements) | rien | **E** |
| Spotify (`!song`, `!songqueue`, `!mysong`, `!songskip`, `!songcancel`, `!songremove`) | SAMMI → `sammi-bridge` 9567 | rien | **E** |
| Level Up Wizebot (son) | SAMMI (message de Wizebot) → 9567 | rien | **E** |
| Commandes viewer avec son (`!sniper`, `!groslot` d'Aouh, salut d'Aouh) | SAMMI | Commands V2 : réponses chat seulement (aucune action son) | **E** |
| 24H / crédits (`!code`, `!credits`, `!echange`, `!reset`, crédits sur sub / gift), « Barre de reset » (gifts) | SAMMI + StreamElements | rien (crédits = décision D2) | **E** (économie) |
| Banque (`!banque`, `!depot`, `!retrait`), `!blacklist` / `!whitelist` | SAMMI → StreamElements | rien | **E** (économie) |
| Overlay Shushu (expressions aléatoires) | page `shushu_overlay_obs_v3.html` (autonome ; bouton SAMMI ID666 entièrement désactivé) | rien à migrer (la page tourne seule) | — |
| « Detective Filtre » (raccourci clavier) | SAMMI ID70 (filtre OBS) | rien | **F ?** (raccourci OBS natif) |
| Emote only, modération Wizebot | Wizebot | — | hors SAMMI |

### 0.0.4 Dépendances historiques

| Dépendance | État au 18/10 | Statut |
| --- | --- | --- |
| SAMMI Core + decks actifs (Deck Principal, Points de chaine, 24H, Overlay Color, Lucky Wheel, OBS Audio Monitoring, Deck 1, SPOTIFY_ULTIMATE, Jeu des mots) | **non lancé au moment du relevé** (lancé pour le live) | **indispensable** jusqu'au cutover |
| StreamElements (Jetons, Roulette / Slot / Duel, dons, loyalty) | cloud | **indispensable** jusqu'au cutover économique |
| EBS legacy `raptoru.fr/api` (Coolify) + Extension publiée + Supabase | production | **indispensable** jusqu'au cutover |
| Wizebot (Emote only, level up) | cloud | indispensable (Emote only peut rester externe) |
| `sammi-bridge` (9567 : Spotify, level up) | lancé avec SAMMI (non vu au relevé) | indispensable jusqu'au lot Spotify |
| `alertes_server.js` (3001, « Alerte Twitch ») | **tourne** (depuis le 15/10) | temporaire jusqu'au cutover des alertes |
| Bridge Shushu (17371) | non lancé ; la page Shushu ne l'écoute pas | **inutile** (prouvé) |
| « Groupe 2 » (OBS) | **supprimé par Antoni** | remplacé par « Raptoru — Couleur Cam » ; SAMMI ID45 le cible encore |
| Boutons SAMMI morts (ID12ancien, ID19ancien, ID45_SYNCH, ID666, ID102, exemples OBSAM) | inactifs | **inutiles** |
| Lucky Wheel, Dad Joke | récompenses absentes de Twitch | probablement inutiles (à confirmer : `!spin`) |
| Ne pas supprimer avant le cutover | SAMMI, StreamElements, EBS legacy, Extension publiée, `sammi-bridge`, `alertes_server.js`, filtres « Votekick » / « mute » de « overlay cam shushu » | **dangereux à supprimer** |

### 0.0.5 Économie

Prêt (Lab, tests) : Wallet Core multi-monnaie idempotent, `EconomyPort` (débit + admission atomiques) utilisé par Jeu
des mots, Roulette / Slot, Duel, gains Tombola ; Daily / Loyalty (drapeaux OFF) ; import legacy Daily prévu. Non fait :
D1 (soldes StreamElements au point de coupure, import), D2 (crédits / Points de chaîne), lecteurs qui n'acceptent que
`simulated`, toutes les commandes payantes legacy (`!fx`, `!rb`, `!tts`, `!bonk`, Caution, banque, cash-in, 24H,
roue des subs), audit des données (`docs/LEGACY_DATA_MIGRATION_AUDIT_2026-10.md`, non suivi). **Aucun solde migré.**

### 0.0.6 Roadmap des migrations (proposée le 18/10/2026, à valider par Antoni)

| Lot | Objectif | Fonctions | Complexité | Dépendances | Critère de validation | Pourquoi ici |
| --- | --- | --- | --- | --- | --- | --- |
| **M0 — Finir les Points de chaîne simples** (18/10 : **migration fonctionnelle terminée** — NTM, Creepy, BRB, FX Cam, Couleur Cam ; FX Cam et Couleur Cam validées par une vraie redemption) | plus aucune récompense « simple » chez SAMMI | reste : 4 règles « Son d'effet » **non configurées** (Tiens bon !, Bzez, Skyzz, Seigneur Percé : sons déjà importés), décisions Couleur Overlay / Led couleur / récompenses OFF ; **plus tard (décision, après le cutover)** : transfert de ces sons temporaires vers le Soundboard de l'Extension | faible (configuration, aucun code) | aucune | vraie redemption de chaque récompense jouée par Studio | gratuit, ferme la catégorie « effets » |
| **M1 — Modération ludique** | Ban aléatoire + Votekick sans SAMMI | Ban aléatoire (récompense), Votekick (`!votekick`, `!kick`, `!save`), animation de ban, filtres OBS « Votekick Zoom / Mute », restauration (ex-« Unmute secours ») ; `!rb` et Caution (jetons) → lot économie | élevée | droit Twitch de timeout pour le compte qui agit (à décider), liste des chatters (déjà lue), lecteur d'effets, retour sûr OBS | vraie redemption « Ban aléatoire » + un vrai votekick en Lab, timeouts réels levés | fonction signature, 100 % SAMMI, réutilise effets / interactions |
| **M2 — Spotify** | file musicale sans `sammi-bridge` | récompense « Choisi la prochaine musique ! », `!song`, `!songqueue`, `!mysong`, `!songskip`, `!songcancel`, `!songremove`, Level Up Wizebot (même bridge) | moyenne à élevée | compte Spotify (OAuth), remboursement impossible sur une récompense SAMMI (décision D7) | demande réelle ajoutée à la file, `!song` correct, annulation | dernier gros bloc non économique |
| **M3 — Petits restes** | vider les decks SAMMI non économiques | commandes viewer avec son (`!sniper`, `!groslot`, salut d'Aouh : action « son » typée dans Commands V2), « Detective Filtre », Couleur Overlay si gardée | faible à moyenne | Commands V2 | chaque commande en vrai chat | regroupe des petites choses similaires |
| **AUDIT — audit technique global** | revue transversale avant cutover | dont latence BRB, coexistence des sources OBS, charge, reprise après coupure | moyenne | M0–M3 | rapport + correctifs | demandé après les migrations, avant cutover |
| **CUTOVER — technique** | faire tourner Raptoru en production | Core de production + migrations (alertes, Points de chaîne), bot de production (alertes + Points de chaîne, un seul consommateur EventSub), Studio publié, Extension publiée, décision D7 | élevée | accord d'Antoni à chaque étape | bascule récompense par récompense, retour arrière testé | — |
| **ÉCONOMIE — en dernier** | remplacer StreamElements | D1 / D2, import des soldes, commandes payantes (`!fx`, `!rb`, `!tts`, `!bonk`, Caution, banque, cash-in, 24H, roue des subs, `!blacklist`), Roulette / Slot / Duel / Jeu des mots / Tombola en réel | élevée | audit des données, gel court | soldes contrôlés après import | demandé en dernier |

Prochaine migration recommandée : **M1 — Modération ludique** (après M0, qui n'est que de la configuration).

### 0.0.7 Risques et points ouverts

1. **Couleur Cam en production cassée côté SAMMI** : « Groupe 2 » n'existe plus, le bouton SAMMI ID45 anime un filtre
   absent → pendant un live servi par SAMMI, une redemption « Couleur Cam » ne fait rien et n'est pas remboursée. Le
   chemin Raptoru est prouvé (vraie redemption du 18/10) : en live, soit récompense désactivée, soit SAMMI ID45 coupé
   et Raptoru ON pour cette seule règle.
   Décision d'Antoni : désactiver la récompense en live, la faire servir par Raptoru (Studio Lab + automatisations ON
   pour cette seule règle), ou recréer temporairement le filtre attendu par SAMMI.
2. **Double exécution** : automatisations Raptoru ON + SAMMI lancé = les deux traitent la même redemption (FX Cam, BRB,
   Creepy…). Règle : en Lab, ne garder ON que des récompenses dont le bouton SAMMI est coupé, ou SAMMI fermé ; au
   cutover, bouton SAMMI désactivé **avant** l'interrupteur.
3. **D7 (nouvelle décision)** : rembourser exige des récompenses créées par l'app Raptoru (recréation sur Twitch,
   droit `channel:manage:redemptions`) — nécessaire pour la parité « remboursé » de BRB, FX Cam, Couleur Cam, Spotify.
4. Processus résiduels : `alerts-dbg.mts` d'une ancienne session (port 3379, depuis le 16/10) tourne encore — à arrêter
   par Antoni s'il ne sert plus.
5. Non prouvé : qui traite les récompenses TTS, Soundboard, Emote only, Led couleur ; le comportement de SAMMI en live
   (non lancé pendant le relevé) ; `!spin` encore utilisé ou non.

### 0.0.8 Environnements (relevé du 18/10/2026, 12:15)

- **Production** : legacy uniquement (SAMMI au live, StreamElements, Wizebot, EBS `raptoru.fr/api`, Extension publiée).
  Bot Raptoru de production **non démarré** (`TWITCH_ENABLED=false`).
- **Lab (cette machine)** : `npm run studio` (Electron, serveur Studio **4100**, Core Lab **4301**, base
  `raptoru_bonk_lab`), adaptateur Twitch Lab `lab-chat-main` (réception des Points de chaîne, alertes TEST, chat) ;
  OBS (obs-websocket **4455**) ; `alertes_server.js` legacy **3001**. SAMMI Core non lancé au relevé.
- **Staging** : Core `c7f20de` (14/10) + Hosted Test ; rien de postérieur (ni Bonk VNext, ni jeux, ni alertes, ni Points
  de chaîne, ni effets).
- **Studio publié** : 0.1.5 (30/09). **62 commits locaux** non poussés depuis `c7f20de`.
- Conditions minimales d'un cutover sûr : § 0.7 + plan `docs/CUTOVER_PLAN_2026-10.md` (dont § 13 alertes, § 14 Points
  de chaîne) ; une fonction à la fois, bouton SAMMI coupé avant activation Raptoru, retour arrière = interrupteur OFF +
  bouton SAMMI rallumé.


## 0.1 Git et environnements (vérifiés le 16/10/2026)

| Élément | Valeur |
| --- | --- |
| Branche de travail | `feat/compact-video-port`, dernier commit de code **`166e7ed`** (consolidation alertes A2) — + le commit docs de ce checkpoint ; alertes A1 `5d86e2b` / A2 `b942b58`, `EconomyPort` `85a48fe`, Duel `2bf4fc8`, Roulette / Slot `d4b6b0b`, Simulation `42efc87`, Jeu des mots jusqu'à `b82851f`, Bonk VNext jusqu'à `c4b82c9` |
| `main` | **`d2b61ef`** = `origin/main` (intact depuis le 14/10/2026) |
| `origin/feat/compact-video-port` | **`c7f20de`** — tout ce qui suit est **local, non poussé** : Bonk VNext (`c410833` → `c4b82c9`), Jeu des mots V1 (`b4a67aa` → `b82851f`), Roulette / Slot et Simulation (`d4b6b0b` → `42efc87`), Duel (`2bf4fc8`), `EconomyPort` (`85a48fe`), alertes A1 / A2 (`5d86e2b` → `166e7ed`) + docs |
| Remote | `origin` = `github.com/raptorutwitch/raptoru-2.0` (privé) ; branche locale annexe `feat/calibration-video-component` (`d13dfb9`) |
| **Staging Coolify** (`raptoru-core-staging`, `https://core-staging.raptoru.fr`) | Core sur **`c7f20de`** (déployé le 14/10/2026, manuel), PostgreSQL 17 dédié, chaîne `raptoru_` (83603689), paiement **simulé** (Wallet de test) |
| **Hosted Test** (console Twitch, comptes testeurs) | ZIP **`raptoru-live-STAGING-hosted-test-c7f20de4430a.zip`** → Core staging |
| **Studio publié** | **0.1.5** (30/09/2026, feed `raptorutwitch/raptoru-studio-releases`). 0.1.6 construit le 06/10 sur `5de2444`, **jamais publié, désormais périmé** |
| **Production réelle** | **Legacy uniquement** : SAMMI + StreamElements + EBS `raptoru.fr/api` + Extension publiée `20260920-095259Z`. Aucune brique Raptoru 2.0 en production |

## 0.2 Santé du projet

- **Tests (16/10/2026, `166e7ed`)** : Core 675 (+22 ignorés : tests sur PostgreSQL réel, base locale non lancée ;
  `--maxWorkers=4`) · Studio server 381 · Bot 111 · Playwright 13/13 (dont 7 alertes, Chromium ; `npm run e2e`) ;
  Desktop 24 · Extension 41 (15/10, non touchés depuis) ; lint, format, typecheck, build verts. En suite complète sous
  charge, quelques tests lourds Studio peuvent tomber et passent seuls (connu).
- **Audit Astra** : P0 = 0. Restent ouverts les **5 P1 de cutover** (001, 006, 007, 010, 019 — en cours ou bloqués par
  une décision), 3 P2 différés (015, 021, 025) et 3 P3 volontaires (001 signature Windows, 002 nommage BonkLab, 006 UX).
- **Ce qui va bien** : tous les modules V2 du stream (Hub, Bonk, Soundboard, TTS, Tombola, Modération, Commands) sont
  validés localement par Antoni ; un premier live réel Hosted Test → Core staging → Studio → OBS a été validé le
  07/10/2026 ; **Bonk VNext fonctionnellement terminé et validé en local** (Lots 0–3, 5, 6 + tutoriel / UX, 14–15/10/2026) ;
  **Jeu des mots V1 fonctionnellement migré et validé en conditions réelles le 16/10/2026** (vrai chat Twitch, Wallet
  Lab, sortie LeCroupier_, son OBS SSE, Studio) ; **Roulette et Slot V1 fonctionnellement migrés et validés en
  conditions réelles le 16/10/2026** (vrai chat Twitch, Wallet Lab, LeCroupier_) ; onglet Studio **Simulation** validé ;
  **Duel V1 validé en Lab** (Simulation + vrai chat, réserves mineures) ; économie des modules **unifiée sur
  `EconomyPort`** (Lab) ; **Alertes V1 (17/10/2026) : développement terminé / prêt pour cutover / non déployé** (animations,
  calibrages et files simultanées validés dans OBS ; vrai follow et connexion StreamElements en TEST ;
  `docs/TWITCH_ALERTS_PARITY_2026-10.md` § 23).
- **Ce qui manque pour la production** : l'économie réelle (Wallet canonique, import StreamElements, Points de chaîne),
  la publication de l'Extension, les données historiques, et la migration des fonctionnalités legacy encore absentes
  (Oracle, FX / Points de chaîne, modération ludique, progression…) ; les alertes sont prêtes pour le cutover (bot Twitch de production à raccorder, validations réelles différées) et à valider
  dans OBS. Voir 0.5b, 0.6 et 0.7.
- **Écart local / livré** : beaucoup de travail validé n'est **pas encore livré** : rien depuis Studio 0.1.5 n'est
  publié ; Bonk VNext n'est même pas sur le staging.

## 0.3 Légende des statuts

`NON COMMENCÉ` · `EN COURS` · `IMPLÉMENTÉ LOCAL` (codé, tests auto) · `VALIDÉ LOCAL` (testé par Antoni, Lab ou
Studio source) · `STAGING` (déployé sur le Core staging / Hosted Test) · `VALIDÉ STAGING` (testé par Antoni sur le
staging) · `RELEASED` (dans une release Studio publiée) · `PROD` (utilisé par le vrai stream) · `BLOQUÉ` · `REPORTÉ`.
« Validé » = testé par Antoni lui-même, jamais un test automatique. Une brique peut être `VALIDÉ LOCAL` **et** absente de
tout environnement livré : les deux colonnes se lisent séparément.

## 0.4 Modules — état réel

| Module | Implémentation | Validation Antoni | Environnement atteint | Bloquants restants | Prochaine action |
| --- | --- | --- | --- | --- | --- |
| **Core API** | Core unique : Wallet, Loyalty, Daily, Presence, modules V2 (Bonk, Sons, TTS, Tombola, Modération, Commands), frontière viewer `/v1/ext`, transport Studio `/v1/studio/*`, cockpit | modules validés en Lab ; staging validé le 07/10 | **STAGING** (`c7f20de`) ; Lot 0 VNext (sweep périodique, `wrong_channel`) **VALIDÉ LOCAL** seulement | P1 de cutover (0.7) ; ordre de déploiement **Core avant Studio** | déploiement coordonné du Lot 0 sur le staging (sur accord) |
| **Twitch Bot** | adaptateur EventSub / Helix : Presence (chatters), Loyalty / Rewards (outbox durable), exécuteur chat de Commands (compte LeCroupier_), ingestion chat Lab (OFF par défaut) | Presence réelle (25/09), sortie chat réelle Commands (phase C) | **VALIDÉ LOCAL** ; pas sur le staging | P1-007 (un seul consommateur EventSub en production) ; bot et Commands **hors cutover** pour l'instant | aucune avant la décision de cutover |
| **Studio / Desktop** | app Electron Windows : runtime local supervisé, profils Lab / Production (P1-019), cockpit Production, lecteurs Bonk / Sons / TTS / Tombola, Commandes, Modération, réglages Bonk | 0.1.5 validé ; Modération, Tombola, profils, cockpit, Bonk VNext validés localement | **RELEASED 0.1.5** (sans Modération V2, Tombola V2, profils, Bonk VNext) ; reste **VALIDÉ LOCAL** | release seulement **après** un Core staging compatible (champ heartbeat `channel_id`) | release après le déploiement Core coordonné et la validation staging |
| **Twitch Extension** (Raptoru Live 2.0) | vraie extension importée et refondue : Hub, modules V2, Modération, Commands public, profil compact-video 565×376, restrictions viewer, emotes Twitch OAuth | live Hosted Test validé (07/10) ; OAuth emotes partiellement (14/10) ; compact-video, restrictions et passe UX TTS : **validation non consignée** | **STAGING / Hosted Test** (`c7f20de4430a`) ; **jamais publiée** — la production est l'extension legacy | vrai secret d'Extension, publication, capacité (P2-025), cutover économique | consigner la validation des lots non validés ; publication seulement au cutover |
| **Viewer Web** | placeholder (`apps/viewer-web`, non relié au Core) | — | **NON COMMENCÉ** | hors phase (site, profils, stats) | après la migration des modules |
| **Hub / navigation** | Hub Pop Premium, dots + lanceur, molette ; variante compact-video | **VALIDÉ** 28–29/09 (Lab) | **RELEASED 0.1.5** (copie Lab) + **Hosted Test** | publication de l'Extension | — |
| **Wallet / crédits / Jetons** | Wallet Core multi-monnaie (idempotent, ledger) ; Wallet **de test** Lab utilisé par tous les modules (Lab et staging) ; port économique P1-001 lot 1 (débit + admission atomiques) ; **modules unifiés sur `EconomyPort`** le 16/10 (Jeu des mots, Roulette / Slot, Duel, gains Tombola : `hold` / `move` / `transfer` dans la transaction métier ; Lab uniquement, canonique refusé explicitement — `docs/CUTOVER_PLAN_2026-10.md` § 4.1) | Wallet Core validé techniquement (tests) ; Wallet de test validé avec les modules | Wallet de test : **STAGING** ; Wallet Core : **IMPLÉMENTÉ LOCAL**, non branché ; Jetons réels = **PROD legacy** (StreamElements) | **BLOQUÉ** par D1 (soldes SE au cutover), D2 (crédits), import SE, lecteurs n'acceptant que `simulated` | décision D1 / D2, puis P1-001 lot 2 |
| **Loyalty / Rewards / Daily** | gains passifs, sub / gift / bits / follow, Daily + streak, crédit Wallet derrière drapeaux | validés techniquement (Presence réelle 25/09) | **IMPLÉMENTÉ LOCAL**, drapeaux économiques **OFF** ; production = StreamElements / SAMMI | cutover économique unique | au cutover |
| **Presence / sessions de stream** | Presence shadow (chatters toutes les ~2 min) ; P1-007 lot 1 : une session = un live Twitch (Tombola, Commands) | Presence validée en réel (25/09) | **VALIDÉ LOCAL** ; migration de session appliquée au staging | P1-007 frontière production (lecture des sessions, consommateur unique) | avec le raccordement production |
| **Bonk VNext** | Lots 0–3 (fondation prod, moteur de rendu, cible Manuel / Plein écran, **Auto OBS** sans IA, physique à contact systématique), Lot 5 Salves / Chargeur, Lot 6 FX historique + combo multi-viewer, tutoriel et UX Bonk | **FONCTIONNELLEMENT TERMINÉ ET VALIDÉ LOCAL** 14–15/10/2026 ; paramètres visuels / audio et physique **figés** ; Lot 4 FX rares reporté (non bloquant) | **local uniquement** (commits jusqu'à `c4b82c9`) — pas sur le staging, pas publié | déploiement coordonné (Core, migration Lab, Studio, nouveau ZIP Extension) ; paiement réel (lecteur `simulated`) | staging / Hosted Test / cutover sur accord — détail : [`docs/BONK_VNEXT_AUDIT_2026-10.md`](docs/BONK_VNEXT_AUDIT_2026-10.md) |
| **Bonk (picker et providers)** | picker V2 (Récents, Favoris, Twitch, Bits, 7TV / BTTV / FFZ, Twemoji), validation Core par provider / id | **VALIDÉ** 27/09 (Lab) ; Bonk **VALIDÉ STAGING** au live du 07/10 | **RELEASED 0.1.5** (ancien rendu) + **STAGING** | autoriser les CDN 7TV / BTTV / FFZ dans la console Twitch (publication) | — |
| **OAuth / emotes viewer** | Lab : OAuth `user:read:emotes` (callback local) ; public : OAuth sur `/v1/ext` (callback HTTPS, jetons chiffrés `EXT_TOKEN_KEY`), états `not_linked / syncing / ready / stale / reauth_required` | Lab validé ; Hosted Test 14/10 : OAuth, callback, vraies emotes, persistance, Bonk accepté **validés** ; affichage overlay **non validé** (bascule de chaîne) | **STAGING** (`6d7d381` + `c7f20de`, migration `bonk_lab_viewer_oauth` appliquée) | affichage overlay à revalider ; rapport B3 final | refaire un Bonk Twitch sur `raptoru_` après le prochain déploiement |
| **Soundboard V2** | 69 sons, réglages Studio, protection volume, stop / remboursement | **VALIDÉ** 28/09 (Lab) ; **VALIDÉ STAGING** 07/10 | **RELEASED 0.1.5** (Lab) + **STAGING** ; production = SAMMI | cutover | — |
| **TTS V2** | règles legacy, cast décidé par Core, lecteur OBS, modération ; passe UX « Envoyer un autre message » (`8b297a7`) | **VALIDÉ** 30/09 (Lab) ; **VALIDÉ STAGING** 07/10 ; passe UX : non consignée | **RELEASED 0.1.5** (Lab) + **STAGING** ; production = SAMMI | dette : lecture avant la fin du reveal | — |
| **Tombola V2** | Core + planificateur, Studio, Extension, overlay OBS, modération D4 — **checkpoint figé** | **VALIDÉ** 02–03/10 (Lab) ; **VALIDÉ STAGING** 07/10 | **STAGING** ; **pas** dans 0.1.5 | release Studio ; cutover (paiement des gains) | ne plus modifier sauf bug réel |
| **Modération V2** | parité D4 complète ; vue Restrictions (`b6c5895`, `48ef6db`) ; retour viewer des restrictions (`1865d1e`, `2ed1d94`, `3bc40cb`) | D4 **VALIDÉ** 01/10 (Lab), **VALIDÉ STAGING** 07/10 ; Restrictions : **validation non consignée** | **STAGING** ; **pas** dans 0.1.5 | badges VIP / Sub et synchro ban / timeout Twitch (dépendances extérieures) | consigner la validation des Restrictions |
| **Jeu des mots V1** | parité legacy (deck SAMMI) : règles pures + banque, service Core (session live, cycle 5–15 min, transaction unique, un crédit Wallet par message, idempotence), sortie chat par `cmd_steps` (LeCroupier_), Bot qui transmet tout le chat, panneau Studio (« Voir la réponse » local), son OBS par push SSE — `b4a67aa` → `b82851f` | **VALIDÉ** en conditions réelles le **16/10/2026** (Studio Lab, vrai chat Twitch, Wallet Lab, OBS) | **local uniquement** — pas sur le staging, pas publié ; production = deck SAMMI | cutover économique (Wallet canonique P1-001 lot 2) et chat / session de production (P1-007) ; RET-WORD-005 : affichage des stats plus tard | aucune avant le cutover ; détail : [`docs/WORD_GAME_PARITY.md`](docs/WORD_GAME_PARITY.md) § 0 |
| **Roulette / Slot V1** | parité StreamElements : règles pures (mises nombre / % / k / m / `all`, 50 % / 3 rouleaux 1/25, net +1× / +24×), service Core (transaction unique sous verrou Wallet, cooldowns 10 s / 2 s, idempotence, refus silencieux, plafond Wallet avant tirage), textes et symboles de la chaîne, réponses LeCroupier_ par `cmd_steps`, interrupteur Mini-jeux OFF par défaut — `d4b6b0b` | **VALIDÉ** en conditions réelles le **16/10/2026** (vrai chat Twitch, Wallet Lab ; défaites au simulateur) | **local uniquement** — pas sur le staging, pas publié ; production = StreamElements | cutover économique (P1-001 lot 2) et chat / session de production (P1-007) | aucune avant le cutover ; détail : [`docs/ROULETTE_SLOT_PARITY.md`](docs/ROULETTE_SLOT_PARITY.md) § 0 |
| **Duel V1** | parité StreamElements (`!duel <pseudo> [mise]`, `!accept` / `!deny` / `!cancelduel`, 2 min, 50/50, mise max 100 000 ramenée, transfert perdant → gagnant via `EconomyPort.transfer`, idempotence, concurrence), même module et interrupteur que Roulette / Slot — `2bf4fc8` | **VALIDÉ** en Lab le 16/10/2026 (Simulation + vrai chat avec de vrais comptes : défi, refus d'un second défi, acceptation, résultat) ; réserves : annonce réelle LeCroupier\_ et variation des deux soldes non revérifiées dans ce scénario | **local uniquement** ; production = StreamElements | cutover économique (P1-001 lot 2, P1-007) | observer une fois l'annonce réelle et les soldes ; détail : [`docs/DUEL_PARITY.md`](docs/DUEL_PARITY.md) |
| **Studio — Simulation** | panneau rapide « Simulation » (barre du haut : live simulé, ingestion, sortie réelle, mini-jeux, confirmations) `73f0235` ; onglet **Simulation** (chat Lab déplacé depuis Tombola, chat simulé universel : messages reçus gardés en mémoire par Core + vraies réponses `cmd_steps`, statuts honnêtes) `42efc87` | **VALIDÉ** par Antoni le 16/10/2026 | **local uniquement** (pas dans une release) | — | — |
| **Commands V2** | A0 → F : modèle, admission, file, onglet Studio, Extension (modération + public) | **VALIDÉ LOCAL** (Lab) | **local uniquement** — migrations Commands jamais au staging | hors cutover (décision) ; dettes mineures (`COMMANDS_V2_STATUS.md`) | — |
| **Points de chaîne** (18/10) | V1 : réception EventSub (bot) → Core (règles, dédoublonnage, interrupteur OFF) → Studio (OBS, lecteur d'effets, interactions natives Creepy / BRB / FX Cam / Couleur Cam) ; lecture seule (ni validation ni remboursement) | **VALIDÉ LOCAL** 17/10 ; effets validés OBS 17–18/10 ; vraies redemptions : Test Lab, FX Cam, Couleur Cam | **local uniquement** ; production = SAMMI | Core + bot de production (P1-010), D2 économie, D7 remboursements | § 0.0.2 |
| **Activity / overlays** | overlays existants : Bonk, lecteur TTS, overlay Tombola, lecteur Soundboard ; historique / classement de l'Extension | overlays validés avec leurs modules | comme leurs modules | — | — |
| **Alertes Twitch** (follow, sub, gifts, bits, raid, don) | A0–A2 puis 17/10 : files par famille, calibrage persistant, rechargement des sources OBS périmées, réception Twitch réelle (adaptateur Lab) et dons StreamElements (Astro), **module officiel préparé** (schéma et routes de production `/v1/studio/alerts`, runtime Studio multi-profil, ACTIVE jamais repris au démarrage) — `13507bf` … `97761a0` + passe production | **validé par Antoni** : animations, calibrages, files simultanées dans OBS, vrai follow en TEST, connexion StreamElements ; le reste : tests auto | **local uniquement** ; production = SAMMI / StreamElements legacy | bot Twitch de production non raccordé aux alertes ; Core de production non déployé (migration `20261024120000_alerts.sql` non appliquée) ; vrai don, sous-types Twitch réels, bascule OBS, stabilité en live non validés | décider la réception Twitch de production ; détail, checklist OBS et retour arrière : [`docs/TWITCH_ALERTS_PARITY_2026-10.md`](docs/TWITCH_ALERTS_PARITY_2026-10.md) § 22 |
| **Intégration OBS** | obs-websocket **lecture seule** : sources Bonk, reconnexion auto + mot de passe chiffré (`safeStorage`), capture de scène, cible Auto | **VALIDÉ LOCAL** (Lots 0–3) | **local** ; Studio 0.1.5 n'a que la connexion manuelle | contrôle OBS par les Points de chaîne (18/10) : scène / source / filtre temporaires avec retour sûr, captures, coupures audio, réglages de filtre — **VALIDÉ LOCAL** (§ 0.0) | — |
| **Transport Studio ↔ Core** (P1-019) | identité d'installation, HTTPS, protocole, profils, cockpit Production | **VALIDÉ STAGING** (06–07/10) | **STAGING** | rate limiting, coupures réseau réelles, cockpit incomplet (Commands…), URL en constante de build | `wrong_channel` réel au prochain déploiement |
| **Frontière viewer** `/v1/ext` (P1-006) | JWT d'Extension vérifié par le Core, acteur du JWT, rate limit, CORS, idempotence | **VALIDÉ STAGING** (live 07/10, paiement simulé) | **STAGING** | vrai secret d'Extension, publication, capacité | au cutover |
| **Déploiement / updater / release** | Coolify manuel ; updater Studio validé (0.1.0 → 0.1.1) ; `npm run studio:release` | pipeline validé | Core : **STAGING** ; Studio : **RELEASED 0.1.5** | ordre Core → Studio ; signature Windows (P3-001) avant diffusion large | prochain déploiement coordonné (0.6 D) |
| **Migration legacy → 2.0** | plan de cutover par étapes, cutover économique unique, import SE à la toute fin | — | **EN COURS** (préparation) ; **aucun cutover** | 0.7 | suivre l'ordre du plan de cutover |

## 0.5 Ce qui est vraiment validé (par Antoni)

- **Lab local** : Studio autonome + supervision ; Hub ; Bonk V2 (picker, providers) ; Soundboard V2 ; TTS V2 ;
  Modération V2 D4 ; Tombola V2 (figée) ; Commands V2 A0 → F ; P1-019 lots 1–2 ; Bonk VNext complet (Lots 0–3, 5, 6, tutoriel / UX).
- **Lab + vrai chat Twitch** : **Jeu des mots V1** — validation réelle le 16/10/2026 (vrai chat, Wallet Lab, annonces
  LeCroupier_, son OBS SSE, Studio ; SAMMI fermé pendant le test) ; **Roulette et Slot V1** — validation réelle le
  16/10/2026 (victoires Roulette / Slot / all-in en vrai chat, défaites au simulateur, Wallet Lab, LeCroupier_) ;
  onglet **Simulation** de Studio (16/10/2026) ; **Duel V1** (16/10/2026, Simulation + vrai chat ; réserves : annonce
  réelle et soldes non revérifiés dans ce scénario).
- **Examen visuel (Studio, vrais médias)** : alertes A2 — résultat général satisfaisant selon Antoni, avec réserves
  de formatage / animation ; **pas** de test dans OBS ni avec de vrais événements.
- **Staging réel** : Core staging (06/10) ; Studio Production appairé ; **live Hosted Test → Core staging → Studio →
  OBS (07/10)** : Soundboard, TTS, STOP / remboursement, Bonk, Modération, Tombola ; OAuth emotes viewer (14/10, sauf
  affichage overlay).
- **Publié** : Studio 0.1.5 (Studio autonome, Hub, Bonk V2, Soundboard V2, TTS V2, en mode Lab).
- **Production** : rien de Raptoru 2.0.

## 0.5b Fonctions legacy retenues (registre figé du 06/10/2026, 76 entrées)

Le registre lui-même (PDF du 06/10) n'est pas modifié et n'est pas dans le dépôt. Décompte au 16/10/2026, à partir du
dernier point (checkpoint global du 16/10 : **26 migrées / 18 partielles / 32 absentes** ; un autre rapport citait
25 / 19 / 32 — écart d'une entrée non résolu) et des preuves enregistrées depuis :

| Statut | Nombre | Contenu |
| --- | --- | --- |
| Migrées et validées (Lab ou réel) | **26** | dont Jeu des mots (RET-WORD-001 à 004), Roulette / Slot (RET-GAME-001 / 002), Duel (RET-GAME-003, réserves) ; une dizaine validées aussi au staging (live du 07/10 : Hub, TTS, Sons, Bonk V2, Tombola, Modération) |
| Partielles | **25** | les 18 précédentes + **RET-ALERT-001 à 007** (fonctionnelles en Lab, examinées visuellement ; non branchées aux événements Twitch, non testées dans OBS) |
| Absentes | **25** | Oracle, effets OBS / Points de chaîne, modération ludique, économie sub, progression, site / profils, Shushu, musique |
| Actives en production | **0** | la production reste legacy |

Incertitude : les libellés exacts des sept entrées RET-ALERT ne sont pas relus (registre hors dépôt) ; elles sont
comptées ensemble comme partielles. « Migrée » n'implique aucun environnement livré.

## 0.6 Roadmap globale (ordre logique)

**A. Consigner les validations manquantes** (code déjà livré au staging / Hosted Test, validation non consignée) :
vue Restrictions et retour viewer des restrictions ; profil compact-video du Video Component ; passe UX TTS
(`8b297a7`) ; affichage overlay d'un Bonk Twitch (B3).

**B. TERMINÉ — Bonk VNext fonctionnellement terminé et validé en local (15/10/2026).** Lot 5 Salves / Chargeur
(Core `f32dab9`, Studio `7ebf478`, Extension `b64c3b9` + `6290b72`), Lot 6 FX historique + combo multi-viewer (Studio
`8d54b8f`) et tutoriel / UX Bonk (Extension `c4b82c9`) **validés manuellement par Antoni**. Lot 4 FX rares : reporté, non
bloquant. Détail : [`docs/BONK_VNEXT_AUDIT_2026-10.md`](docs/BONK_VNEXT_AUDIT_2026-10.md) § 0.

**B2. TERMINÉ — Jeu des mots V1 fonctionnellement migré et validé en conditions réelles (16/10/2026).** Lots 0–5,
correctif son push SSE (`3a89b9c`) et « Voir la réponse » Studio (`b82851f`). RET-WORD-001 à 004 MIGRÉ, RET-WORD-005
PARTIEL (stats enregistrées, affichage plus tard). Activation production au cutover économique (deck SAMMI coupé à ce
moment-là). Détail : [`docs/WORD_GAME_PARITY.md`](docs/WORD_GAME_PARITY.md) § 0.

**B3. TERMINÉ — Roulette et Slot V1 fonctionnellement migrés et validés en conditions réelles (16/10/2026).**
`d4b6b0b` (Core), `73f0235` (panneau rapide Simulation), `42efc87` (onglet Simulation + chat simulé universel).
RET-GAME-001 et 002 MIGRÉ (Wallet Lab). Activation production au cutover économique (Roulette / Slot coupés dans
StreamElements à ce moment-là). Détail : [`docs/ROULETTE_SLOT_PARITY.md`](docs/ROULETTE_SLOT_PARITY.md) § 0.

**B4. TERMINÉ (en Lab) — Duel V1, économie unifiée, alertes A0–A2 (16/10/2026).** Duel `2bf4fc8` validé en Lab
(réserves mineures, `docs/DUEL_PARITY.md`) ; `EconomyPort` pour Jeu des mots, Roulette / Slot, Duel et gains Tombola
(`85a48fe` ; Bonk / Sons / TTS inchangés ; Wallet canonique plus tard) ; alertes A0 audit, A1 fondation `5d86e2b`, A2
rendu OBS + aperçu Studio `b942b58` / `166e7ed` (réserves UX, `docs/TWITCH_ALERTS_PARITY_2026-10.md` § 16).

**C. Déploiement coordonné du travail validé** (sur accord d'Antoni) : Core staging (Lot 0 : sweep périodique,
`wrong_channel`) **puis** Studio, validation staging (sweep et `wrong_channel` réels, chaîne complète Hosted Test →
Core → Studio → OBS avec Bonk VNext), puis seulement décision de release Studio. Bonk VNext demande aussi la
migration Lab du Lot 5 sur le staging et un **nouveau ZIP Extension** (chargeur, tutoriel) pour le Hosted Test.

**D. Préparation du cutover** (ordre du plan) : P1-019 (reste) → P1-001 port économique (décisions D1 / D2, lot 2,
lecteurs non simulés) → P1-006 (vrai secret, capacité) → parcours vertical § 7 (Bonk payé en Jetons de test sur le
staging) → P1-007 frontière production → P1-010 Points de chaîne → cutover économique unique.

**E. Migration fonctionnelle restante** — **remplacé le 18/10/2026 par la roadmap § 0.0.6** (M0 → M3, audit, cutover,
économie). Ancien texte, pour mémoire (inventaire § 13, ordre indicatif ; stratégie : finir la migration du legacy
retenu avant les gros reworks) : ~~Jeu des mots~~ (migré, 16/10/2026) → ~~Roulette et Slot~~ (migrés, 16/10/2026)
→ ~~Duel~~ (migré en Lab, 16/10/2026) → ~~alertes Twitch~~ (Alertes V1 clôturé le 17/10/2026 : prêt pour le
cutover, non déployé, § 23 du doc alertes) → Oracle (RET-GAME-004) → instrumentation stats /
profils →
achievements / cosmétiques → FX / Creepy / BRB / NTM et alertes → Votekick / Caution / Ban aléatoire → Spotify →
commandes viewer personnalisées, cash-in PDC → site / Viewer Web. En parallèle : décisions et imports historiques
nécessaires au Wallet canonique (D1, D2, DM1–DM9 de l'audit données).

**F. Cutover final** : audit SE / SAMMI, import des soldes (dry-run, contrôle), gel court, bascule économique, puis
modules un par un ; legacy coupé ensuite.

## 0.7 Bloquants production (distincts de la roadmap)

1. **Économie réelle** (P1-001) : Wallet canonique non branché ; D1 (soldes SE au point de coupure, import) et D2
   (crédits) non tranchées ; lecteurs et overlay qui n'acceptent que `payment_mode = simulated` ; le Core public
   débite le Wallet de test (`labEconomy`).
2. **Points de chaîne** (P1-010) : modèle de redemption (D2) non décidé pour l'économie ; **Points de chaîne V1**
   (17/10/2026) fournit la réception, les règles et les actions OBS / son (`docs/CHANNEL_POINTS_V1.md`), en lecture
   seule (Raptoru ne peut ni valider ni rembourser les récompenses existantes) ; **validé en Lab le 17/10/2026**
   (réception, exécution OBS et son réelles), non déployé.
3. **Extension** : jamais publiée ; vrai secret d'Extension à poser ; domaines CDN emotes à autoriser ; capacité de
   l'EBS public (P2-025).
4. **Session de stream** (P1-007) : en production, Tombola / Commands doivent lire la session canonique et le bot
   principal rester l'unique consommateur EventSub.
5. **Transport** (P1-019) : rate limiting, coupures réseau réelles, cockpit Production incomplet (Commands, config
   encore sous `STUDIO_SECRET`).
6. **Fonctionnel** : Oracle, FX / Points de chaîne, Votekick… pas encore migrés ; Alertes V1 prêtes pour le cutover
   (validées dans OBS, Core de production préparé, bot Twitch de production à raccorder) — SAMMI / StreamElements doivent continuer à servir tout cela
   ou une décision l'abandonne avant la coupure. Le Jeu des mots, Roulette / Slot et le Duel sont migrés en Lab
   (16/10/2026) mais restent servis par SAMMI / StreamElements jusqu'au cutover économique.
7. **Livraison** : Studio 0.1.5 est loin du HEAD ; une release suppose le Core compatible déployé d'abord.

## 0.8 Dettes connues

- TTS : la lecture peut démarrer avant la fin de l'animation shuffle / reveal.
- Extension : défilement des noms longs encore saccadé (compact-video) ; Commands : catégories sans version,
  libellés dupliqués Studio / Extension, pas de rafraîchissement automatique pendant l'édition.
- Modération : badges VIP / Sub inconnus du Core ; aucune synchro ban / timeout Twitch ; pop-out Twitch réel non
  configuré.
- Bonk : source overlay trouvée par son nom « Raptoru Bonk Lab » ; Manuel par scène reporté ; occultation d'une
  caméra par une source opaque non calculée.
- Staging : sans migrations, le Core ne démarre pas sur une base vierge ; une coupure PostgreSQL > ~40 s retire le
  conteneur du routage Coolify ; le Core n'expose pas son SHA.
- Audit : P2-015 (preuve d'exécution agrégée), P2-021 (quotas Commands sur historique croissant), P2-025 (polling) ;
  P3-001 (signature Windows), P3-002 (nommage « Lab » des tables / modules), P3-006 (harmonisation UX).

## 0.9 Décisions en attente (Antoni)

- **D1** soldes Jetons au cutover (import SE recommandé) · **D2** modèle Points de chaîne / crédits · **D5** définition de
  « ce stream » (recommandation : session pour le live, `stream_day` pour les quotas ; appliquée en partie par P1-007).
  D3 (PostgreSQL dédié), D4 (Hosted Test) et D6 (une app, deux profils) sont tranchées et appliquées.
- Salves : nombre maximal de munitions par salve — la règle canonique (§ 4 de l'audit Bonk) reste 10, réglée en un
  seul endroit du Core ; les prototypes montraient 20 (à trancher si Antoni veut 20).
- Moment du déploiement coordonné et de la prochaine release Studio.

## 0.10 Prochaine étape recommandée

**18/10/2026** : voir § 0.0.6 — M0 (configuration des Points de chaîne simples) puis **M1 modération ludique** ; décision
urgente § 0.0.7 point 1 (Couleur Cam servie par SAMMI cassée en live). Texte du 17/10 ci-dessous pour mémoire.

**Alertes V1 clôturées (17/10/2026)** : développement terminé, prêt pour le cutover, non déployé (checklist :
`docs/CUTOVER_PLAN_2026-10.md` § 13). **Priorité « zéro SAMMI »** (audit SAMMI du 17/10/2026 : au moins 29 groupes de
fonctions encore exécutés par SAMMI, dont 13 derrière la réception des récompenses et les actions OBS) : **Points de
chaîne V1** clôturé (`docs/CHANNEL_POINTS_V1.md` : validé en Lab, prêt pour la préparation du cutover, non déployé) →
reprise des récompenses SAMMI sur ce socle → modération ludique → Spotify. Le **déploiement coordonné** (Core staging + migrations Lab, puis Studio, nouveau ZIP
Hosted Test) reste une étape séparée, seulement avec l'accord d'Antoni.

---

# Référence détaillée et historique

Les sections suivantes gardent le détail par domaine et l'historique daté. **L'état courant est § 0** : en cas
d'écart, § 0 fait foi.

## Checkpoint du 03/10/2026 (historique)

Il ne faut pas utiliser le mot **« terminé »** de façon ambiguë. Distinguer systématiquement :
1. **Core / moteur techniquement validé** ;
2. **feature fonctionnelle migrée et prête** ;
3. **activée en production**.

Vérifié le 03/10/2026 par `git status` / `git log` et relance des tests sur le HEAD.
- **Git** : branche `main`, HEAD fonctionnel `ed781f6 — feat: post-Tombola UX pass — Studio Tombola sections and Moderation header actions (Lab)`, suivi du commit docs de checkpoint Tombola. Aucun remote Git sur le repo source (rien n’est poussé), aucun tag dans le repo source. `prototypes/` présent sur disque, exclu via `.git/info/exclude`, jamais versionné ni embarqué.
- **Tests sur le HEAD** : Core 257 (7 skipped), Studio server 92, Desktop 17, Extension 12, Bot 77 ; lint, format, typecheck verts. **E2E** (Electron, environnement isolé Studio 4111 / Core Lab 4311, bases dédiées supprimées après usage) : D4 95/95 · UX 34/34 · console G 23/23 · Studio 46/46 · Extension 49/49 · Phase H Tombola A–L 57/57. Les scripts E2E restent dans le scratchpad de session : **ils ne sont pas dans le repo**.

| Élément | Statut |
|---|---|
| Studio 0.1.5 (Studio autonome + supervision Electron, Hub, Bonk V2, Soundboard V2, TTS V2 réel) | **VALIDÉ MANUELLEMENT** par Antoni, **RELEASE PUBLIQUE** (`v0.1.5`, feed `raptorutwitch/raptoru-studio-releases`), installé |
| **Modération V2 — parité D4 complète** (`5b66579`) : permissions fines par mod, sanctions sensibles, mots surveillés / bloqués, notes internes, pause globale, cooldown D4, wallet admin, stop / remboursements Soundboard, débit Bonk, historiques Core ; console unique extension + Studio | **IMPLÉMENTÉ + TEST AUTOMATISÉ + E2E 95/95**, package `release/moderation-d4`, **VALIDÉE MANUELLEMENT par Antoni le 01/10/2026** (permissions, mots surveillés / bloqués, pause globale, remboursements, cooldown D4, notes, arrêt Soundboard, surfaces Extension), **NON RELEASE** |
| **Tombola V2** (`023cb64` → `ed781f6`) : Core, planificateur, Studio, Extension Panel / Mobile / Vidéo, overlay OBS, modération D4, noms figés, monnaies Je / Cr | **TERMINÉE / VALIDÉE / CHECKPOINT FIGÉ** (Lab) — validée manuellement par Antoni les 02–03/10/2026 ; Phase H A–L 57/57 ; **NON RELEASE, NON PACKAGÉE** ; ne plus modifier sauf bug réel en usage ou nouvelle feature décidée (§ 16 « Tombola V2 ») |
| Passe UX post-Tombola (`ed781f6`) : onglet Studio Tombola en sections repliables ; Modération V2 sans menu « … », actions en icônes d’en-tête | **VALIDÉE MANUELLEMENT** le 03/10/2026, **NON RELEASE** |
| Correctif « Effacer le cooldown TTS » + message `viewer_busy` (`890e71d`), conservé sur le modèle cooldown D4 | **IMPLÉMENTÉ + TEST AUTOMATISÉ + E2E**, validé avec le cooldown D4 le 01/10/2026, **NON RELEASE** |
| Consoles précédentes (`12ffdd0` simplifiée, `a5b5d5e` mini-passe) et packages `release/mini-d4`, `release/win-unpacked` | **REMPLACÉES / OBSOLÈTES** — ne pas tester |
| Lecture TTS pouvant démarrer avant la fin du shuffle / reveal de l’extension | **DETTE CONNUE** |
| Badges VIP / Sub, mouvements automatiques du Wallet réel, synchro ban / timeout Twitch, pop-out Twitch réel | **DÉPENDANCES EXTÉRIEURES** (API Twitch broadcaster non autorisée, cutover économie non décidé, publication extension interdite) |
| Tombola (inventaire legacy § 13) | **Migrée en Tombola V2** : lancement automatique (planificateur lié au stream), montant aléatoire, `!join` + alias + Extension, anti-spoil, overlay, SUPER (ex-Big Tombola), FULL OSEILLE, Giveaway, paiement automatique — validée en Lab, pas en production |
| Décisions de modération | **Tranchées le 30/09** (voir § « Modération V2 — parité D4 complète ») |
| Production | SAMMI + StreamElements (+ ancienne extension publiée) ; aucun cutover, aucune migration prod |

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
- Node 24 en développement (Studio installé : Node embarqué par Electron) ;
- TypeScript strict ;
- Electron pour Studio ;
- Core API ;
- Twitch Bot ;
- Postgres local via Docker ;
- PostgreSQL dédié côté serveur (Coolify, décision D3 ; le staging tourne ainsi depuis le 06/10/2026) ;
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
- `5b66579 — feat: complete Moderation V2 with full D4 parity (Lab)` (non releasé)
- `e535b26 — docs: record Moderation V2 full D4 parity (Lab, awaiting validation)`
- `3bef3ba`, `c353bee` — docs (état pré-D4 nettoyé ; validation manuelle de la Modération V2 D4, Tombola exclue)
- Tombola V2 (Lab, non releasé) : `023cb64 — feat: Tombola V2 Core model in the Lab (phase C)` · `3cc5fab — feat: Tombola V2 automatic scheduler and launch sound in Core (Lab)` · `fef50df` (phase D, Studio + ingestion chat Lab unique) · `0e90f13` (phase E, Extension) · `72269b1` (phase F, overlay OBS)
- **`ecc0275 — feat: Tombola V2 moderation in the D4 console, frozen round names and final polish (phase G, Lab)`** — checkpoint Tombola (fonctionnel)
- **`ed781f6 — feat: post-Tombola UX pass — Studio Tombola sections and Moderation header actions (Lab)`** — checkpoint Tombola (UX final) ; **dernier commit fonctionnel**

La liste ci-dessus s’arrête au checkpoint Tombola (03/10/2026). La suite (préparation du cutover, staging, Hosted
Test, compact-video, restrictions, emotes OAuth, Bonk VNext) se lit dans `git log` ; les repères utiles sont dans
§ 0.1, dans `docs/CUTOVER_PLAN_2026-10.md` et dans `docs/BONK_VNEXT_AUDIT_2026-10.md`.

Règles Git (mises à jour le 15/10/2026 ; l’ancienne règle « aucun remote, aucun push » est périmée) :
- remote `origin` = `github.com/raptorutwitch/raptoru-2.0` (privé) : `main` et la branche de travail y sont
  poussés **uniquement sur accord explicite d’Antoni** ;
- travail courant sur `feat/compact-video-port` (§ 0.1) ; jamais de merge dans `main` sans accord ;
- aucun tag dans le repo source.

Le pipeline `studio:release` crée un commit local de version après publication réussie ; toujours vérifier `git log -n 10` avant de reprendre.

# 4. Presence (shadow)

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

> **État au 15/10/2026 :** dernière release publique **0.1.5** (30/09). Depuis : profils Lab / Production et cockpit
> Production (P1-019), Modération V2, Tombola V2, Bonk VNext (cible Auto / Manuel / Plein écran, reconnexion OBS avec
> mot de passe chiffré) — **validés localement, non publiés**. 0.1.6 a été construit le 06/10 sans être publié (périmé).
> Prochaine release seulement après un Core staging compatible (§ 0.6 C).

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

> **État au 15/10/2026 :** la **production** utilise toujours l’extension legacy publiée (`20260920-095259Z`, EBS
> `raptoru.fr/api`). L’extension Raptoru 2.0 tourne en **Hosted Test** (ZIP STAGING `c7f20de4430a` → Core staging),
> jamais publiée. Géométrie du Video Component mesurée sur Twitch : 65 % · 3:2 · dimensions automatiques OFF →
> **565 × 376** ; profil compact-video et Lab recalés (`docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md`).

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
- Video component : preset « Twitch réel » 565 × 376 (et comparaison 651 × 434) — l’ancien calcul 60 % · 3:2 − 48 px est abandonné ;
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

**Tombola : Tombola V2 complète dans le Core Lab** (checkpoint figé `ecc0275` + `ed781f6`) : écran V2 Panel / Mobile / Vidéo lu depuis Core (`GET /raffle/state`), carte Hub au nom actif, anti-spoil, historique du stream ; l’ancienne simulation en mémoire de la façade LabEbs ne sert plus qu’hors Core Lab. Voir § 16 « Tombola V2 ».

**TTS V2 : exécution réelle en mode Lab** depuis le 30/09/2026 (même Core Lab que Bonk / Soundboard) : extension → façade LabEbs → Core local/test → worker Studio → lecteur OBS (Web Speech + personnage) → ACK. Voir § 16 « TTS V2 — runtime réel validé ». L’ancien formulaire TTS reste affiché quand le module n’a pas de données `tts_v2` (démo, prod).

**Soundboard : exécution réelle en mode Lab** depuis le 28/09/2026 (même Core Lab que Bonk) : extension → façade LabEbs → Core local/test → worker Studio → page lecteur audio locale (à activer d’un clic) → ACK. Voir § 16 « Soundboard V2 — état validé ».

**Modération V2 : console réelle dans le Lab** (session `moderation_v2`, relais `/moderation/v2/*` de la façade LabEbs → Core Lab). État actuel = parité D4 complète `5b66579`, **validée manuellement le 01/10/2026, non releasée**. Hors Lab, l’ancien écran de modération reste affiché. Voir § 16 « Modération V2 ».

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

État au 16/10/2026 : moteur porté en Lab (A1 file durable, A2 source OBS + aperçu Studio), non branché aux vrais
événements, non testé dans OBS ; SAMMI reste la production. Voir § 0.4 et `docs/TWITCH_ALERTS_PARITY_2026-10.md` § 16.

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

→ **Migré : Soundboard V2** (validé en Lab, validé au staging le 07/10/2026 ; production = SAMMI).

## TTS
- texte saisi dans l’extension pour ne pas spoiler le texte dans le chat ;
- voix aléatoire ;
- petit personnage animé aléatoire synchronisé ;
- HTTP requests + animations WEBM ;
- assets/dossiers existants à récupérer.

→ **Migré : TTS V2** (validé en Lab, validé au staging le 07/10/2026 ; production = SAMMI).

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

## Onglet Studio « Commandes » (demandé le 01/10/2026 — construit : Commands V2 phase D, validée)

Un onglet global de Studio pour voir et modifier toutes les commandes chat, organisé par catégorie / module
(Tombola, TTS, Soundboard, Bonk, modération, commandes globales…), avec recherche et sections repliables. Pas de
liste plate illisible. Il s'appuiera sur l'ingestion chat unique du Lab (`/v1/lab/chat`, routée par Core vers chaque
module) ; en attendant, chaque module garde son éditeur (ex. Tombola : commande principale + alias).

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

→ **Migrée en Lab : Tombola V2** (validée le 02–03/10/2026, checkpoint figé ; Big Tombola = SUPER, FULL OSEILLE ajoutée). Voir § 16 « Tombola V2 ».

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

→ **Bonk VNext** (Lots 0–3 validés localement le 15/10/2026) : cible caméra Auto / Manuel / Plein écran, physique à
contact systématique ; les vraies rafales = **Lot 5 Salves (NEXT, non commencé)**, combos en option.

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
**Module le plus populaire du stream. Priorité forte.** → **Migré en V1 de parité et validé en conditions réelles le
16/10/2026** ; production = SAMMI jusqu'au cutover économique. Référence : `docs/WORD_GAME_PARITY.md`.

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

# 16. Modules — détail validé et roadmap au 03/10/2026 (historique daté)

> La roadmap et le statut courant sont en **§ 0.4 et § 0.6**. Cette section garde le détail technique de chaque module
> tel que validé, avec ses dates.

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
Lancement historique : `npm run bonk:lab` (Studio 4101, Lab Core 4301) ; aujourd’hui le Studio autonome démarre le runtime Lab lui-même (4100 / 4301). Connexion OBS par mot de passe dans l’UI du Lab (non stocké à l’époque ; depuis Bonk VNext Lot 0 : mot de passe chiffré par `safeStorage`, reconnexion automatique).
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

### Bonk Fidelity — remplacé par Bonk VNext (15/10/2026)
- historique : impact FX, ciblage caméra, variation de taille, disparition ;
- traité par Bonk VNext (moteur de rendu, cible Manuel / Plein écran / Auto OBS, physique à contact systématique),
  Lots 0–3 validés, non déployés : voir `docs/BONK_VNEXT_AUDIT_2026-10.md` § 0.

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

## Modération V2 — parité D4 complète (Lab, 01/10/2026 — validée manuellement le 01/10/2026)
Statut : **IMPLÉMENTÉ + TEST AUTOMATISÉ + E2E 95/95 · VALIDÉE MANUELLEMENT par Antoni le 01/10/2026 (package `release/moderation-d4`) · NON RELEASE** ; la Tombola V2 minimale qu’elle incluait a été remplacée par la Tombola V2 complète (§ « Tombola V2 »). Passe UX du 03/10/2026 (`ed781f6`) : plus de menu « … » dans les en-têtes de modules, actions en icônes (voir `docs/moderation-v2-d4-parity.md` § 4). Commit `5b66579`. Référence : `prototypes/moderation-v2-d4/` ; matrices initiale et finale : `docs/moderation-v2-d4-parity.md` (75 lignes, aucune « backend manquant », placeholder, fake ou suppression silencieuse).

**Décisions d’Antoni (30/09/2026)** : Tombola = modèle réel (inscription gratuite, une par viewer, cagnotte offerte par la chaîne) ; mot surveillé = TTS **retenu** jusqu’à « Laisser passer » (la file continue sans lui ; expiration = remboursement) ; un mod avec « Gérer les permissions » ne modifie que les droits d’un autre mod, parmi ceux qu’il possède, jamais les siens ni ceux d’un supermod / du broadcaster ; « Rembourser » une interaction terminée (ajout hors D4) = « Admin Wallet ». Remboursements D4 = tout mod. Cooldown = modèle D4.

- **Core (Lab)** — migration `20261007120000_moderation_d4.sql` (ajoutée à `LAB_MIGRATIONS`, `bonk-lab.mjs`, `stage.mjs`) : `lab_staff` (rôles broadcaster / supermod / moderator + `grants`), `lab_viewers` (annuaire : recherche, premier passage, noms), `lab_global_state` (pause globale + compteur de refus), `lab_viewer_cooldowns` refaite (délai, fin de période, « Ce stream »), `lab_viewer_notes`, `lab_tts_words`, revue TTS (`review_status`, `review_hits`, `reviewed_by/at`), remboursements Soundboard / Bonk (`refund_status`), `sound_lab_deliveries.stopped_at`, ledger `admin` / `raffle_win`, Tombola (`lab_raffles`, `lab_raffle_entries`, `lab_raffle_winners`).
- **Permissions** (`lab-moderation/store.ts`) : standard Mod = pause / reprise, stop, retrait, purge, **remboursements**, Laisser passer, blocage ≤ 1 h par module, cooldown, notes, lecture ; 6 permissions D4 accordables ; Supermod / Broadcaster = tout ; broadcaster seul = configuration TTS, supermods, outils wallet de test, Tombola. Refus Core `403 forbidden` avec la permission D4 nommée.
- **Commandes** (`POST /v1/lab/moderation/:c/actions`) : `module_state` (4 modules, « Désactivé » vers ou depuis = permission), `stop_current`, `cancel` (TTS / Soundboard, attente ou en cours), `stop_all`, `purge`, `refund` (après coup), `allow`, `block_viewer` / `unblock_viewer` (dont Tombola), `set_cooldown` / `clear_cooldown`, `global_pause`, `set_permission`, `set_staff`, `add_note`, `add_word` / `remove_word`, `wallet_adjust`, `raffle_open` / `raffle_close` / `raffle_draw`. Tout est audité (`lab_moderation_audit`).
- **Read models** : `overview` (+ Tombola, pause globale), `search` (rôle + badge de restriction), `viewers/:id` (rôle, premier passage, aujourd’hui, notes, restrictions, ledger typé), `interactions` (tous modules, filtres module / statut / viewer / période « Ce stream » = depuis 16:00 Paris, pagination), `interactions/:id` (actions liées, mouvements), `ledger` (viewer ou chaîne, types + `visible_in_moderation_activity`, liens remboursement / débit), `team`, `words`, `audit`. Un viewer ne les lit jamais (façade `as` / `as_role`, refus Core).
- **Admissions** : pause globale (TTS, sons, bonks, tombola ; compteur), mots bloqués / surveillés (TTS), cooldown personnel D4 (TTS / Soundboard / Bonk), débit du wallet Lab pour Soundboard et Bonk (remboursement automatique si jamais joué / affiché), annuaire des viewers.
- **Soundboard stop** : Core annule → le worker Studio l’apprend (lecture Core) → ordre `stop` au lecteur → le lecteur coupe le son et envoie l’ACK `stopped` → Core enregistre `stopped_at` ; les ACK tardifs sont ignorés.
- **Tombola V2 minimale** (historique `5b66579`, **remplacée depuis par la Tombola V2 complète** — § « Tombola V2 ») (`raffle-lab/raffle-lab-service.ts`) : une manche ouverte à la fois, fermeture automatique à l’échéance, inscription gratuite idempotente, contrôles module / blocage / pause globale, tirage (gagnants au hasard, cagnotte partagée) payé sur le wallet Lab. La façade LabEbs lit l’état Core pour la session de l’extension ; les contrôles « Tombola » de l’Extension Lab et de Studio passent par Core.
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
- **Implémentation (01/10/2026, locale, validée manuellement le 01/10/2026, non releasée)** : **parité D4 complète** (`5b66579`), voir § « Modération V2 — parité D4 complète » et `docs/moderation-v2-d4-parity.md`. Dépendances extérieures restantes : badges VIP / Sub, mouvements automatiques du Wallet réel, pop-out Twitch réel.

## Tombola V2 — TERMINÉE / VALIDÉE / CHECKPOINT FIGÉ (Lab, 03/10/2026)

**Ne plus modifier Tombola V2 sauf bug réel découvert en usage ou nouvelle feature explicitement décidée par Antoni. Les petites préférences UX futures ne rouvrent pas le chantier métier.**

- **Spécification** : `prototypes/tombola-v2/` ; matrice de parité et plan C → H : `docs/tombola-v2-parity.md`.
- **Périmètre validé manuellement par Antoni (02–03/10/2026)** : phases E (Extension Panel / Mobile / Vidéo), F (overlay OBS unique, son de lancement joué une fois), G (modération D4 : permissions existantes, ajout / retrait, forcer = « Sanctions sensibles », audit) et H (validation de bout en bout) ; planificateur lié au stream ; paiements / wallet Lab exacts ; noms figés par manche (+ nom actif sur la carte Hub) ; anti-spoil (compte jusqu’à 0, marge configurée) ; SUPER / FULL OSEILLE / Giveaway / aucun participant / annulation ; monnaies compactes Je / Cr ; passe UX Studio Tombola ; Modération V2 sans menu « … ».
- **Commits de référence** : `ecc0275` (fonctionnel / modération / noms figés / monnaies) · `ed781f6` (UX final).
- **Migrations figées** — appliquées, **ne jamais les réécrire** ; toute évolution future passe par une **migration additive** : `20261008120000_raffle_v2.sql` · `20261009120000_raffle_scheduler.sql` · `20261010120000_raffle_round_labels.sql` ; dépendance Modération D4 : `20261007120000_moderation_d4.sql`.
- **Tests de référence (verts sur `ed781f6`)** : Core 257 · Studio server 92 · Bot 77 · Extension 12 · Desktop 17 · lint / format / typecheck OK · E2E UX 34/34 · E2E D4 95/95 · E2E console G 23/23 · E2E Studio 46/46 · E2E Extension 49/49 · Phase H A–L 57/57.
- **Pas fait volontairement** : package local, release, publication de l’extension, activation production (SAMMI + StreamElements restent la production). L’ingestion chat Twitch réelle du Lab reste un interrupteur OFF par défaut, jamais activé automatiquement.

## Roadmap après Bonk (historique du 03/10/2026, remplacée par § 0.6)
Ordre recommandé à date (checkpoint 30/09/2026 : Studio autonome + Hub + Bonk V2 + Soundboard V2 + TTS V2 validés) :
1. ~~Soundboard~~ (validé en Lab le 28/09/2026) ;
2. ~~TTS~~ (runtime réel validé en Lab le 30/09/2026) ;
3. ~~Modération V2~~ (parité D4 complète, validée en Lab le 01/10/2026, `5b66579` ; en-têtes sans « … » le 03/10/2026) ;
4. ~~Tombola V2~~ (**TERMINÉE / VALIDÉE / CHECKPOINT FIGÉ** en Lab le 03/10/2026, `ecc0275` + `ed781f6`) ;
5. ~~Bonk Fidelity (polish, non bloquant)~~ → remplacé par Bonk VNext (Lots 0–3 validés le 15/10/2026) ;
6. instrumentation stats/profil au fil des modules ;
7. Jeu des mots 2.0 ;
8. achievements/cosmétiques ;
9. FX/Creepy/BRB/NTM ;
10. Votekick/Caution/Random Ban ;
11. Spotify ;
12. duel/roulette/slots/oracle et satellites.

Cette roadmap reste modulable après audit réel de chaque feature.

**Modules terminés / validés en Lab (non activés en production)** : Hub, Bonk V2, Soundboard V2, TTS V2, Modération V2 (D4), **Tombola V2**. **Restent à migrer** : tout le reste de l’inventaire § 13 (alertes, Jeu des mots, Votekick / Caution / Random Ban, Spotify, Cash-in PDC, commandes personnalisées, onglet Studio « Commandes », stats / profils, achievements / cosmétiques…) puis le cutover — **Raptoru 2.0 n’est pas terminé.**

**Prochaines actions : à décider par Antoni** — package local puis release Studio (embarquant Modération V2 + Tombola V2, validées en Lab ; uniquement sur feu vert explicite) ; audits de parité des autres modules à prototype validé (historique). Aucun chantier ouvert au 03/10/2026. *(Historique : ont suivi la consolidation de l’audit, Commands V2, la préparation du cutover, le staging, le live Hosted Test, compact-video, les restrictions, l’OAuth emotes public et Bonk VNext — § 0.)*

# 17. Import des données historiques / cutover

> Procédure détaillée, ordre des P1 et rollback : `docs/CUTOVER_PLAN_2026-10.md` (canonique).

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

Aucun `AGENTS.md` n’existe dans le repo (vérifié le 15/10/2026) : les règles agents sont dans `CLAUDE.md` et le HANDOFF.

# 19. Reprise dans une nouvelle conversation / nouvel agent

Au démarrage d’une nouvelle conversation ou d’une session Astra/Claude :

1. travailler uniquement dans :
   `C:\Users\Antoni\Documents\Raptoru 2.0`
2. lire **d’abord `Raptoru-2.0-HANDOFF.md`** (règles, commandes, pièges), puis **§ 0 de ce fichier** (état et roadmap) ;
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
11. Bonk : V2 et VNext Lots 0–3 validés ; paramètres visuels / audio et physique figés ; le prochain lot est le Lot 5 Salves (§ 0.6).

### Audit Bonk de référence
Rapport :
`outputs/Audit-Bonk-V2.md` dans la session Astra qui l’a produit, ou fichier exporté fourni par l’utilisateur.

Le rapport est un audit statique. Aucun test OBS/SAMMI/prod n’a été exécuté pendant cet audit.

### État Git à revérifier (historique du 01/10/2026 — l’état courant est § 0.1)
Au 01/10/2026 (handoff) :
- branche `main`, aucun remote, aucun tag dans le repo source ;
- HEAD fonctionnel `5b66579` (Modération V2 — parité D4 complète), suivi uniquement de commits docs ;
- dernière release publique : Studio 0.1.5 (`f81955d`, tag `v0.1.5` sur `raptorutwitch/raptoru-studio-releases`) ; `435f78d`, `706f8c7`, `12ffdd0`, `890e71d`, `a5b5d5e`, `5b66579` **non releasés** ;
- tree propre attendu, hors `prototypes/` (local, exclu, non versionné) et runtime / .env ignorés ;
- package validé le 01/10/2026 : `apps/studio/desktop/release/moderation-d4/win-unpacked/Raptoru Studio.exe` (fermer d’abord tout autre Studio : verrou partagé) ; **ne pas** tester `release/mini-d4` ni `release/win-unpacked` (obsolètes) ;
- release uniquement après validation explicite (« c’est bon », « validé », « go ») via `npm run studio:release` (voir `CLAUDE.md`).

Toujours vérifier l’état actuel avant toute modification.

# 20. Résumé ultra-court (16/10/2026)

```text
Raptoru 2.0 = Core central + Twitch Bot fin + Studio Electron local + Extension viewer + PostgreSQL.

PRODUCTION RÉELLE : legacy uniquement (SAMMI + StreamElements + EBS raptoru.fr/api + Extension publiée).
Aucune brique Raptoru 2.0 en production. Import des soldes SE : seulement juste avant le cutover.

GIT : feat/compact-video-port @ 42efc87 (+ ce commit) ; main = origin/main = d2b61ef ;
      origin/feat/compact-video-port = c7f20de ; Bonk VNext, Jeu des mots, Roulette / Slot = local uniquement.

STAGING (Core c7f20de, Hosted Test ZIP c7f20de4430a, paiement simulé) :
- live validé le 07/10 : Soundboard, TTS, STOP / remboursement, Bonk, Modération, Tombola
- OAuth emotes viewer validé le 14/10 (sauf affichage overlay) ; transport Studio ↔ Core validé

PUBLIÉ : Studio 0.1.5 (Studio autonome, Hub, Bonk V2, Soundboard V2, TTS V2 — mode Lab).

VALIDÉ LOCAL, PAS ENCORE LIVRÉ : Bonk VNext complet (Lots 0–3, 5, 6, tutoriel / UX) ; Jeu des mots V1 (validation
réelle 16/10 : vrai chat Twitch, Wallet Lab, LeCroupier_, OBS SSE, Studio) ; Roulette / Slot V1 (validation réelle
16/10) ; onglet Simulation ; Commands V2 A0 → F ; Studio profils / cockpit, Modération V2, Tombola V2 (pas
dans 0.1.5).

À CONSIGNER : Restrictions (vue + retour viewer), compact-video, passe UX TTS, affichage d'un Bonk Twitch (B3).

NEXT : migration legacy suivante — Duel (RET-GAME-003) en V1 de parité, sur accord d'Antoni (alternative du
registre : alertes). Déploiement coordonné (Core staging puis Studio) toujours sur accord d'Antoni.

BLOQUANTS PROD : Wallet réel (D1 / D2, import SE), Points de chaîne (P1-010), Extension non publiée (vrai secret),
session prod (P1-007), transport (rate limit, cockpit), modules legacy non migrés (duel / oracle, alertes, FX…).

RÈGLES : prototype validé = spécification ; « validé » = testé par Antoni ; aucun push / deploy / release /
migration distante / changement Twitch sans son accord ; ordre de déploiement Core → Studio.
```
