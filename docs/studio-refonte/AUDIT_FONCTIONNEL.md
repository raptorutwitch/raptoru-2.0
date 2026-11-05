# Audit fonctionnel de Raptoru Studio — démarrages, cycle du live, automatisations, réglages

**04/11/2026.** Branche `feat/studio-ux` (locale), code audité : `f1f1b03` (= `origin/main` 8a897a5 + refonte).
Complète l'étude UX/UI d'Astra sans la refaire : ici, **les comportements**, pas l'interface.

**Méthode et niveau de preuve.**

- Lecture du code du Core, du bot, de Studio (Electron, serveur, interface), de l'extension et des lecteurs, croisée avec
  les documents des modules et les incidents du premier live (`docs/POST_LIVE_AUDIT_2026-10-20.md`, I1-I10).
- Quatre audits parallèles en lecture seule ; chaque constat retenu comme bug a été relu dans le code.
- **[code]** = prouvé par la lecture du code (fichier:ligne). **[à vérifier]** = le chemin existe, l'effet réel demande
  un essai en fonctionnement ou une lecture de la Production.
- Aucune action sur la Production. Aucun service, bot, OBS ni Studio installé lancé. Les tests exécutés tournent en
  mémoire, sur des ports aléatoires ou la pile E2E isolée (PGlite, port 4399). Les valeurs réelles des variables
  Coolify (`ALERTS_MODE`, `CHAT_GAMES`…) **n'ont pas été lues**.

Chemins abrégés : `core/` = `apps/core-api/src/`, `bot/` = `apps/twitch-bot/src/`, `studio/` =
`apps/studio/server/src/`, `web/` = `apps/studio/web/src/`, `ext/` = `apps/twitch-extension/extension/`.

---

## A. Synthèse exécutive

### A.1 Le diagnostic en une phrase

Raptoru 2.0 est **solide sur l'argent** : clés d'idempotence, journaux, verrous, refus avant débit, bail du bot unique.
Il est **faible sur la lisibilité de son propre état**. Le comportement d'un module dépend de quatre couches
réglées à quatre endroits, et Studio n'en voit qu'une partie :

- variables du Core, changées par redéploiement ;
- variables du bot, changées par redéploiement ;
- interrupteurs en base, réglés dans Studio ;
- fichiers locaux de Studio.

Le Centre de contrôle ne couvre que le bot et trois lecteurs. Il n'existe aucune préparation du live, et deux tables
différentes disent « le live est en cours ».

### A.2 Les problèmes de démarrage rapportés, vérifiés dans le code actuel

| Situation rapportée | Cause réelle | Type (§ 3 de la mission) | État aujourd'hui |
|---|---|---|---|
| Le bot n'était pas lancé (live du 20/10) | Le bot tournait sur le PC, avec un `.env` modifié 18 min avant le live (I5) | réglage manquant, action manuelle | **Corrigé structurellement** : le bot est sur le VPS depuis le 21/10, permanent, avec bail unique [code `bot/instance-lease.ts`]. **Reste** : ses fonctions sont des variables d'environnement, donc un redéploiement pour en changer une ; certaines pannes l'arrêtent ou le dégradent sans alerte claire (§ E.3). |
| Mini-jeux muets en début de live (I5, 17 min) | Variables `CHAT_GAMES` / `CHAT_GAMES_OUTPUT` absentes **et** interrupteur `mini_game_channels.enabled` sur OFF | réglage manquant + valeur par défaut OFF | L'interrupteur est persistant, il reste ON une fois mis [code `core/mini-games/service.ts:260-279`]. **Mais** il se trouve dans le widget « Simulation de stream », où il ressemblait à un réglage de test (**corrigé ce jour**, § I.0). Les variables du bot restent invisibles dans Studio. |
| Roue du Sub désactivée, un resub perdu (I2) | Interrupteur `sw_settings.enabled` activé 1 min 26 s trop tard | action manuelle, absence de contrôle avant live | ON en base depuis le 20/10. **Bug actif trouvé** : enregistrer un réglage de la roue pendant un live renvoie les subs du live en attente de présence (§ E.2, P0-3). |
| Extension inutilisable 52 min (I4) | Version Hosted Test servant le build staging | dépendance externe non contrôlée | Inchangé : aucun contrôle de la version servie (décision A6 du 21/10, **jamais construite**). |
| Fonctions nécessitant une modification du code | 23 variables d'environnement (9 Core, 14 bot) ; tables de réglages sans écran (`daily_config`, `loyalty_config`) ; prix et durées en constantes | réglage manquant / limitation historique | Inchangé (§ D.3). |
| Modules « actifs » mais pas prêts | Studio affiche l'intention (interrupteur) comme un état sain : Régie « Automatisations actives » en vert sur la seule base de l'interrupteur, « Aucun incident confirmé » pour tout ce qui n'est pas supervisé | état mal affiché ; « activé » ≠ « prêt » | À corriger (P0-8). Le Centre de contrôle a le bon modèle mais 2 fournisseurs seulement. |

**Le contrôle avant live, décidé le 21/10 (plan post-live, lot 5), n'a jamais été construit.** C'est la mesure qui
aurait évité I2, I4 et I5. Elle reste la plus rentable (P1-1).

### A.3 Ce qui fonctionne déjà et qu'il ne faut pas réinventer

- **Bot unique** : bail du Core, auto-fencing, journal d'exécution, outbox durables (fidélité, alertes, points de chaîne)
  [code `bot/instance-lease.ts`, `bot/loyalty-outbox.ts`].
- **Idempotence économique** sur tous les chemins clés :
  - Daily : `daily-claim:<id>` ;
  - jeux : `mg:<ch>:<msg_id>` ;
  - Jeu des mots : `jdm:<ch>:<msg_id>` ;
  - roue : par tirage ;
  - Tombola : une ligne par gagnant ;
  - points de chaîne : `cp:<source>:<id>:<i>` ;
  - cosmétiques ;
  - défis.
- **Refus avant débit** quand un lecteur manque (Soundboard, TTS, Bonk, Chaos), expiration avec remboursement unique
  [code `core/sound-lab/sound-lab-service.ts:396-409,1205-1219`].
- **« Jamais rejoué une fois commencé »** : un travail démarré sans compte rendu devient `execution_unknown`, jamais
  rejoué (Bonk, TTS, Soundboard, points de chaîne, roue).
- **OBS** : reconnexion automatique sans fin (1, 2, 5, puis 10 s), y compris quand OBS démarre après Studio
  [code `studio/bonk-lab/obs.ts:79-97`].
- **Tombola** : planificateur lié au live (démarre et s'arrête avec la session), sans saut ni doublon au redémarrage
  [code `core/raffle-lab/raffle-lab-service.ts:357-366,672-696`].
- **Jeu des mots** : entièrement automatique pendant le live.
- **Roue du Sub** : nouvelle tentative avec délai croissant, animation sautée au-delà de 10 min avec gain conservé,
  aucun tirage sans lecteur prêt.
- **Modèle du Centre de contrôle** (`ModuleStatus`, un fournisseur par module, panne isolée en 4 s) : bon socle, à
  étendre plutôt qu'à remplacer.
- **Supervision** : délai de grâce, distinction micro-coupure / incident, notifications Windows.

### A.4 Les améliorations les plus rentables

1. **Préparation du live**, dans le Centre de contrôle (P1-1). Une liste en lecture seule « prêt / pas prêt / pourquoi
   / quoi faire », à partir des fournisseurs existants.
2. **Vérité des états** (P0-7, P0-8, P1-2, P1-3). Pour chaque module :
   - séparer *intention* (activé / en pause / désactivé), *constat* (prêt / dépendance absente / erreur / inconnu) et
     *activité* (en cours ou non) ;
   - montrer la configuration effective du Core et du bot.
3. **Les quatre risques d'argent ou de file encore ouverts** (P0-1 à P0-4) :
   - travaux OBS des points de chaîne qui n'expirent jamais ;
   - actions monétaires de Studio sans clé stable ;
   - bug de la roue ;
   - garde Core du live simulé.
4. **Une seule vérité du live** (P0-5 puis P2-1) : c'est le prérequis de toute automatisation liée au stream.
5. **Réglages essentiels dans Studio** (P2-5) : prix, recharges, durées et limites aujourd'hui en constantes, dans les
   pages de module que la refonte reprend de toute façon.

### A.5 Ce que je déconseille

- Un moteur générique de déclencheurs et de workflows à la Streamer.bot. Raptoru a environ 25 modules connus et un seul
  opérateur ; des règles explicites par module suffisent.
- Un bouton « tout arrêter » : l'étude d'Astra le refuse déjà, à juste titre.
- Un démarrage automatique de tirages ou de mini-jeux au début du live. Les modules qui doivent démarrer seuls le font
  déjà (planificateur Tombola, Jeu des mots).
- Rendre réglables les cotes et les tables de gains (Roulette 50 %, Slot ×24, valeurs de la roue) : risque économique
  fort, valeur faible.

---

## B. Cartographie des démarrages et des états

### B.1 Grille d'états proposée (vocabulaire unique pour Studio)

Trois axes indépendants. Une ligne de module les affiche ensemble, jamais confondus.

| Axe | Valeurs | Qui le décide | Exemple |
|---|---|---|---|
| **Disponibilité** (capacité) | Autorisé · **Bloqué par le serveur** (variable Core / bot à `false`) · Non installé | déploiement | Caution : `CAUTION_CHAT=false` → « bloqué par le serveur » |
| **Intention** (état désiré) | **Activé** · **En pause** (volontaire, temporaire) · **Désactivé** (volontaire, durable) | Antoni, dans Studio | Roue du Sub : interrupteur ON |
| **Constat** (état observé) | **Prêt** · **En attente** (dépendance absente : lecteur, OBS, bot, live) · **En erreur** · **Inconnu** (source muette) | la supervision | Bonk : « En attente · source OBS non affichée » |
| **Activité** | Inactif · **En cours** (tirage ouvert, vote, roue, file non vide) | le module | Tombola : « tirage ouvert, 12 participants » |
| **Démarrage** (règle) | Permanent · Avec le live · Manuel | le module (réglable seulement si § H le décide) | Jeu des mots : « avec le live » |

Correspondance avec les notions de la mission :

| Notion de la mission | Axe et valeur de la grille |
|---|---|
| Processus lancé, service connecté | Constat |
| Service prêt | Constat = Prêt |
| Module installé | Disponibilité |
| Module configuré | Intention, plus « réglages valides » |
| Module activé | Intention = Activé |
| Disponible pour les viewers | Disponibilité = Autorisé, Intention = Activé et Constat = Prêt, plus la règle de démarrage si elle dépend du live |
| Actuellement utilisé | Activité |
| En pause | Intention = En pause |
| En erreur | Constat = En erreur |
| Volontairement désactivé | Intention = Désactivé |
| Dépendant d'un autre service | Constat = En attente, avec la dépendance nommée |
| En attente d'une action manuelle | Constat = En attente, avec « action : … » |

Le `ModuleStatus` existant porte déjà le niveau (`ok/warn/error/off/unknown`), le résumé, les faits et le conseil. Il
manque seulement trois champs, `intent`, `observed` et `activity`, et une règle de rendu : **une intention ON ne
s'affiche jamais en vert si le constat n'est pas « Prêt »**.

### B.2 Composants : qui les lance, ce qu'ils deviennent

| Composant | Lancé par | Persistance | Dépendances | Reprise | Fermeture de Studio |
|---|---|---|---|---|---|
| **Core** (VPS) | Coolify | PostgreSQL | — | santé `/ready` | sans effet |
| **Bot** (VPS) | Coolify, en continu | volume `/data` (jetons, outbox, journaux) | Core (bail), Twitch | EventSub : reconnexion 5 s, sans rattrapage [code `bot/twitch/eventsub.ts:166-177`] ; Core muet plus de 35 s → arrêt et attente du bail [code `bot/instance-lease.ts:146-156`] | sans effet |
| **Studio Electron** | Antoni (démarrage avec Windows décidé le 21/10, **non fait**) | `%APPDATA%` (OBS chiffré, profil) | — | serveur local relancé 3 fois en 3 min [code `apps/studio/desktop/src/server-supervisor.ts:85-94`] | — |
| **Serveur Studio** | Electron | `.runtime/` du dossier de données | Core du profil | `/health` répond toujours « ok » : « prêt » veut dire « HTTP répond » [code `studio/index.ts:378-380`] | les travaux en vol deviennent « inconnus » côté Core |
| **Lien OBS** | Electron, si un identifiant est enregistré | identifiant chiffré | OBS lancé, WebSocket | infinie, sauf refus d'authentification (arrêt définitif) | **déconnecté en premier** : micro, scène ou filtre modifiés restent tels quels (§ E.1) |
| **Lecteur Soundboard** (Production) | iframe **dans la fenêtre Studio** | choix « son activé » mémorisé | fenêtre Studio ouverte | rechargé au besoin | sons refusés avant débit |
| **Lecteurs OBS** (TTS, Bonk, alertes, effets, Tombola, Votekick, Jeu des mots, Halloween) | sources navigateur d'OBS | — | OBS, Studio | interrogent Studio en continu | refus avant débit (TTS, Bonk, Chaos) ; **file qui grossit** (alertes, travaux OBS des points de chaîne) |
| **Exécuteurs Studio** (points de chaîne, Random Ban, Votekick, Roue, Spotify, Halloween) | démarrage du serveur, sans interrupteur | journaux pour Bonk, TTS et Soundboard ; mémoire pour les autres | Core, OBS, lecteur d'effets | sondage à cadence fixe, **sans attente progressive après une erreur** (sauf Bonk, TTS et Soundboard) | voir § E.1 |
| **Dock OBS** | serveur Studio (port + 10) | clé dans `.runtime/dock/key.json` | — | suit le Core, s'éteint après 60 s sans client | indisponible |
| **Runtime Lab** (Postgres, Core Lab) | profil Lab seulement | base Lab | Docker | 3 relances en 5 min, figé si muet 20 s | arrêté |
| **Ingestion du chat Lab** | profil Lab, interrupteur **persistant** | `.runtime/lab-chat/ingress.json` | Twitch (vrai chat) | **reprend seule au démarrage si laissée ON** | arrêtée |
| **Supervision** | serveur Studio | mémoire (50 événements) | — | lecture toutes les 5 s, incident confirmé à 30 s | — |

**Le bot n'a aucune notion de Studio, et Studio n'en a aucune du live.** Studio ne lit pas l'état du stream Twitch : le
seul « live » qu'il affiche est la session de la Tombola [code `web/simulation.ts:69-73`, `web/tombola.ts:546`].

### B.3 Les quatre couches d'activation

**1. Variables du Core** (`core/config.ts`), changées par redéploiement Coolify :

- économie : `ECONOMY_MODE`, `DAILY_WALLET_CREDITS`, `LOYALTY_PREVIEW`, `LOYALTY_PASSIVE_CREDITS`,
  `LOYALTY_EVENT_CREDITS` ;
- modules : `CAUTION_CHAT`, `VOTEKICK_CHAT`, `SPOTIFY_CHAT`, `CHALLENGES_ENGINE` ;
- alertes : `ALERTS_MAX_AGE_SECONDS`.

**2. Variables du bot** (`bot/config.ts`), changées par redéploiement Coolify :

- commandes : `DAILY_CHAT_COMMANDS`, `LOYALTY_CHAT_COMMANDS` ;
- événements : `LOYALTY_TWITCH_EVENTS`, `CHANNEL_POINTS_EVENTS`, `PRESENCE_SHADOW` ;
- jeux du chat : `CHAT_GAMES`, `CHAT_GAMES_OUTPUT` ;
- alertes : `ALERTS_MODE`, `ALERTS_FOLLOW` ;
- exécuteurs : `RANDOM_BAN`, `CAUTION`, `VOTEKICK`, `CP_TWITCH_ACTIONS`.

`CP_TWITCH_ACTIONS` n'est pas dans la liste des fonctions remontée à Studio [code `bot/instance-lease.ts:197-209`].

**3. Interrupteurs en base**, réglés dans Studio :

- `cp_settings.enabled` (points de chaîne, OFF par défaut) ;
- `sw_settings` (roue) ;
- `mini_game_channels.enabled` (OFF) ;
- `cmd_channels.chat_output` (« Sortie chat », OFF) ;
- `spotify_settings.enabled` ;
- `event_shop_settings.enabled` ;
- `progression_settings.enabled` ;
- `lab_modules` (Soundboard, TTS, Bonk : actif / pause / désactivé, pour tout le Core et non par chaîne) ;
- `lab_raffle_settings` (planificateur Tombola) ;
- `votekick_settings`, TTS, sons.

**4. Fichiers locaux de Studio** :

- mode des alertes Lab (`twitch-mode.json`) et mode StreamElements (`se-mode.json`) : **un ACTIVE enregistré repart en
  TEST** [code `studio/alerts/runtime.ts:158-175`, `studio/alerts/se-tips.ts:248-256`] ;
- réglages Bonk, volume du Jeu des mots, Halloween, clé du Dock.

**Le cas « Sortie chat »** : toutes les réponses du Core passent par `cmd_steps`, et ne partent que si trois conditions
sont réunies :

- `cmd_channels.chat_output` est ON (réglé dans la page Commandes) ;
- `CHAT_GAMES` est vrai dans le bot ;
- `CHAT_GAMES_OUTPUT` est vrai dans le bot.

Les réponses concernées sont celles de la Tombola, du Jeu des mots, des mini-jeux, de Spotify, de l'invitation de la
roue et de la boutique saisonnière. Le Daily, `!solde` et `!give` passent par un autre chemin. Ce sont donc **deux
sorties chat aux règles différentes**, et l'argent bouge même quand la réponse se perd.

### B.4 Deux vérités du live [code]

| | `stream_sessions` | `lab_stream_sessions` |
|---|---|---|
| Écrite par | bot `stream-watch.ts` → `/v1/bot/stream/{online,offline,sync}` | bot (pont du chat) → `/v1/bot/stream`, **seulement si `CHAT_GAMES` ou les alertes sont actifs** ; boutons « Simuler début / fin de stream » |
| Réparation | Helix toutes les 60 s, **ignoré 5 min après un événement EventSub** | Helix sans délai de confiance, à chaque cycle et à chaque reconnexion |
| Lue par | Daily, présence et fidélité passive, XP, Roue du Sub, Bonbons de présence | Tombola (et son planificateur), Jeu des mots, Roulette / Slot / Duel, Commandes (`when: live`) |

Conséquences possibles :

- **Un retard de Helix rouvre la session « jeux » juste après la fin du stream** : mini-jeux ouverts hors live,
  planificateur Tombola relancé.
- À l'inverse, il peut la fermer au début du live.
- Une session simulée n'est jamais fermée par la fin du stream Twitch.

Les deux tables peuvent se contredire [code `bot/lab-chat-ingest.ts:219-248`, `bot/stream-watch.ts:12,54-80`]. Il faut
vérifier en réel la fréquence et l'ampleur des retards de Helix.

---

## C. Analyse module par module

Catégories (§ 7 de la mission) :

- **A** service permanent ;
- **B** lié au live ;
- **C** démarrage configurable ;
- **D** action volontairement manuelle ;
- **E** Lab / aperçu.

« Décision » renvoie au § H.

### Socle

**Bot LeCroupier_** — catégorie A.

- *Aujourd'hui* : permanent sur le VPS, bail unique.
- *Manque* :
  - un changement de fonction impose un redéploiement ;
  - l'échec du jeton `raptoru_` au démarrage coupe silencieusement fidélité et points de chaîne pour toute la session,
    alors que le conteneur reste « healthy » [code `bot/index.ts:499-503`, Dockerfile l.70] ;
  - une perte de ce jeton en cours de route arrête tout le bot (code 78).
- *Recommandé* :
  - fonctions visibles dans Studio (P1-3) ;
  - santé « dégradée » quand une capacité manque (P2-9) ;
  - garder les variables comme plafond de sécurité (§ F.2).

**Commandes V2** — catégorie A.

- *Aujourd'hui* : fiables (expiration 60 s, jamais de renvoi incertain).
- *Manque* :
  - la « Sortie chat réelle » vaut pour toute la chaîne mais se règle dans la page Commandes ;
  - deux chemins de sortie coexistent (B.3).
- *Recommandé* : déplacer ou refléter « Sortie chat » dans le Centre de contrôle, avec l'état des trois conditions
  (P1-11).

**Supervision et Centre de contrôle** — catégorie A.

- *Manque* :
  - non surveillés : lecteur d'effets, source Alertes, overlay Votekick, overlay Tombola, exécuteur des points de chaîne,
    lien OBS lui-même, StreamElements, Spotify ;
  - **un échec de démarrage du profil Production ne produit aucun signal** : tout paraît vert
    [code `studio/index.ts:686-718,1060-1101`] ;
  - hors live, une source Bonk non affichée devient un incident.
- *Recommandé* : P0-7, P1-2, P1-4.

**OBS** — catégorie A.

- *Bien* : reconnexion infinie.
- *Manque* :
  - à la fermeture de Studio, aucune restauration (micro coupé, filtres) [code `studio/channel-points/obs-actions.ts:97-100`,
    `studio/votekick/mute-controller.ts:192-195`] ;
  - une restauration en retard de plus d'1 h est abandonnée.
- *Recommandé* : P1-5.

**Bridge / Dock** — catégorie A.

- *Bien* : sans risque d'argent.
- *Manque* : « Rejeu » remet une alerte dans la vraie file sans le dire [code `core/dock/service.ts:662-745`].
- *Recommandé* : libellé « Rejouer sur le stream » (P1-13), panneau sous Système.

### Sons, voix, alertes

**Alertes** — catégorie A (elles jouent aussi hors live, décision du 16/10).

- *Manque* :
  - **file sans limite ni fraîcheur** (`ALERTS_MAX_AGE_SECONDS` absent) ;
  - aucun moyen de vider ou de passer : Studio fermé pendant un live, toutes les alertes rejouent à la réouverture
    [code `core/alerts/service.ts:34-45`] ;
  - StreamElements repart en TEST après chaque redémarrage ;
  - source absente de la supervision.
- *Recommandé* : P1-7, P1-9.
- *Décision* : H3, H5.

**Soundboard** — catégorie C.

- *Bien* : refus avant débit, expiration 2 min avec remboursement.
- *Manque* :
  - **lecteur de Production chargé seulement à l'ouverture de « Système »** (régression de la refonte : **corrigée ce
    jour**) ;
  - catalogue de sons écrit dans le code (`core/sound-lab/bank.ts`, 69 sons) ;
  - achats possibles hors live.
- *Décision* : H1.
- *Plus tard* : catalogue en données (P3).

**TTS** — catégorie C.

- *Manque* :
  - expiration de **30 min** : une voix payée en fin de live peut être lue hors stream ou à la réouverture de Studio
    [code `core/tts-lab/rules.ts:124`] ;
  - les commandes pause / arrêt / purge de l'extension ne transmettent pas la clé d'idempotence
    [code `core/ext/ext-facade.ts:1094-1112`] ;
  - « Valider avant lecture » renvoie 404.
- *Décision* : H1, H4.

**Bonk** — catégorie C.

- *Bien* : la porte la plus stricte (OBS et source affichée).
- *Manque* :
  - **prix 200 Jetons figé dans le code** ;
  - lignes de Production marquées `simulated`, `test_mode` et `real_debited=0` alors que le débit est réel
    [code `core/bonk-lab/bonk-lab-service.ts:78-80,527`] ;
  - source nommée « Raptoru Bonk Lab ».
- *Recommandé* : P2-5.
- *Décision* : H1, H12.

### Récompenses Twitch et effets

**Points de chaîne** — catégorie A (interrupteur en base).

- *Bien* :
  - interrupteur persistant ;
  - une utilisation reçue pendant la coupure n'est jamais rejouée ;
  - une utilisation de plus de 120 s ne verse que ses crédits.
- *Manque* :
  - **un travail OBS en file n'expire jamais** : bot actif et Studio fermé, les effets s'accumulent et s'enchaînent sur
    le vrai OBS à la réouverture de Studio, peut-être des heures plus tard [code `core/channel-points/service.ts:1101-1138,1247-1273` :
    la file n'a pas de limite d'âge, et `studioReady` n'est utilisé que par le chat FX Cam] ;
  - l'exécuteur prend un travail sans vérifier OBS ni le lecteur [code `studio/channel-points/runtime.ts:203-213`] ;
  - « Tester » exécute pour de vrai, Spotify compris, sans mode à blanc [à vérifier sur Spotify].
- *Recommandé* : P0-1, P0-6, P1-6.
- *Décision* : H2, H11.

**Effets, lecteur d'effets, Chaos** — catégorie C.

- *Bien* : jamais rejoué, refusé si la page est absente.
- *Manque* :
  - lecteur hors supervision ;
  - `docs/EFFECTS_PLAYER.md` se dit encore « non déployé / SAMMI ».
- *Recommandé* : P1-4.

**Random Ban** — catégorie C.

- *Manque* :
  - `!rb` n'a pas d'interrupteur propre et marche hors live ;
  - prix 25 000, durées 180 / 300 s et chance du streamer 2 % figés dans le code
    [code `core/chat-interactions/prices.ts:6`, `packages/schemas/src/random-ban.ts`] ;
  - les tests « mute du streamer » et « Caution » sont réels ;
  - les remboursements des points de chaîne restent manuels.
- *Décision* : H1, H10.

**Caution** — catégorie C.

- *Manque* :
  - activable seulement par variables (Core + bot) ;
  - prix figés ;
  - **le voyant affichait « prête » avec un bot mort (corrigé ce jour)**.
- *Décision* : H1, H10.

**Votekick** — catégorie C.

- *Manque* :
  - variables Core + bot ;
  - seule la durée du vote est réglable ;
  - **aucune vue du vote en cours, du mute ni de l'exécuteur** : la route `/api/votekick/state` existe, aucune page ne
    la lit ;
  - aucune annulation.
- *Recommandé* : P1-12.
- *Décision* : H10.

**Roue du Sub** — catégorie A.

- *Bien* : riche en états, aucune étape manuelle par live.
- *Manque* :
  - **bug de frontière** : `setInvitations`, `setAnnounceDelay` et `setMode` repoussent `updated_at`, qui sert de
    frontière « sub reçu pendant ce live » [code `core/sub-wheel/service.ts:403-475`, `draws.ts:60-63`] ;
  - le choix de mode v1 / v2 est un reste du déploiement ;
  - les invitations dépendent de la « Sortie chat », réglée ailleurs.
- *Recommandé* : P0-3.
- *Décision* : H13.

**Spotify** — catégorie C.

- *Bien* : l'écran le plus complet (fermé / ouvert / refusé avec raison).
- *Manque* :
  - trois interrupteurs à trois endroits (`SPOTIFY_CHAT`, `CP_TWITCH_ACTIONS`, ouverture dans Studio) ;
  - demandes non jouées en fin de live jamais remboursées ;
  - états `UNKNOWN` en attente de décision.
- *Décision* : H6.

### Jeux et tirages

**Tombola** — catégories B et D.

- *Bien* :
  - planificateur lié au live ;
  - tirage et paiements dans une seule transaction.
- *Manque* :
  - **« Simuler début de stream » en profil Production ouvrait la vraie session partagée**, qui déverrouille les jeux
    payants sur le vrai Wallet et que la fin Twitch ne ferme jamais (**bloqué côté Studio ce jour** ; garde Core = P0-4) ;
  - aucun voyant bot / sortie chat / overlay.
- *Recommandé* : P1-2.

**Jeu des mots** — catégorie B.

- *Bien* : automatique.
- *Manque* :
  - aucun interrupteur durable (« Arrêter » ne vaut que pour la session) ;
  - intervalle de 5 à 15 min figé ;
  - présence de la source son connue de Studio mais cachée.
- *Recommandé* : P2-6.
- *Décision* : H8.

**Roulette / Slot / Duel** — catégorie B, avec l'interrupteur.

- *Manque* :
  - interrupteur réel des viewers placé dans le widget « Simulation » (**libellé et confirmation corrigés ce jour**) ;
  - aucune page propre ni historique ;
  - mise minimale, recharges et maximum du duel figés.
- *Recommandé* : P1-12, P2-5.
- *Décision* : H10.

**Halloween / saisonnier** — catégorie D.

- *Manque* :
  - identifiant de saison `halloween-2026` figé dans le code ;
  - fermer une saison demande quatre actions (boutique, profil d'alertes, ambiance, OBS) ;
  - les minuteries Studio tournent encore, événement fermé.
- *Recommandé* : P3-2.

### Communauté et économie

**Daily** — catégorie B.

- *Bien* : automatique, sans double paiement.
- *Manque* :
  - la table `daily_config` n'a ni route ni écran ;
  - remise à zéro à 16:00 figée.
- *Décision* : H14.

**Fidélité / présence** — catégorie B.

- *Bien* : liée au live, avec bail de présence.
- *Manque* :
  - `loyalty_config` n'a pas d'écran ;
  - les gains passifs `tier_unknown` sont perdus quand l'instantané des abonnés a plus de 36 h, sans recrédit, et
    l'échec de l'instantané ne laisse qu'une ligne de journal [code `core/loyalty/tiers.ts:14,30-35`] [à vérifier :
    nombre de lignes en Production].
- *Recommandé* : P1-10.
- *Décision* : H9.

**Progression / XP** — catégorie A (interrupteur en base).

- *Manque* :
  - « live » vient de `stream_sessions` sans filtre de chaîne ;
  - changer la courbe remet tout le monde à niveau et verse les récompenses de niveau, sans le dire
    [code `core/progression/service.ts:195-216`] ;
  - le choix « Annoncer mes Level Up » de l'extension n'est lu par rien.
- *Décision* : H15.

**Boutique** — catégorie A.

- *Manque* :
  - **« Donner » : un double clic créditait deux fois, jusqu'à 1 000 000 de Jetons (corrigé ce jour par un verrou
    d'action)** ;
  - écriture au registre avec le type `mini_game`.
- *Recommandé* : P0-2 pour la clé par formulaire.

**Défis** — catégorie A (moteur en variable).

- *Manque* :
  - `CHALLENGES_ENGINE` est coupé en Production ;
  - Studio ne voit pas l'état du moteur et écrit « Versée automatiquement » [code `web/challenges.ts:391`] ;
  - une période non recomptée est perdue.
- *Décision* : H16 (déjà ouverte côté site).

**Modération D4** — catégorie A.

- *Manque* :
  - **« Créditer / Débiter » depuis Studio n'envoie pas de clé** : clé aléatoire côté Core, donc double clic ou nouvel
    essai = double écriture sur le vrai Wallet [code `core/lab-moderation/service.ts:540`, `studio/lab-moderation/proxy.ts:222-225`] ;
  - l'onglet dit « Core local » en Production ;
  - la recharge « ce stream » dure 3 h fixes.
- *Recommandé* : P0-2, P1-13.

**Historiques et statistiques** — catégorie A.

- *Manque* : un historique par module, dispersés ; aucune vue Studio des statistiques.
- *Plus tard* : P3-4, page Activité.

### Extension et Laboratoire

**Extension Twitch** — catégorie A.

- *Manque* :
  - nouvelle clé d'idempotence à chaque clic pour Soundboard, Bonk simple, boutique, titres et Tombola : un clic après un
    délai dépassé peut payer deux fois [code `ext/shared/api.js:492-499`] [à vérifier] ;
  - page de configuration héritée (SAMMI, « Production » en Lab, modules tous « actifs ») ;
  - version servie non contrôlée (I4).
- *Recommandé* : P0-10, P1-1 (A6).

**Extension Lab** — catégorie E.

- *Bien* : isolée du Core de Production par trois barrières [code].
- *Manque* :
  - peut jouer sur le vrai OBS (même lecteur) ;
  - montre la Roue et les Commandes publiques que la Production n'active pas.
- *Recommandé* : P1-13 (badge), lot 9.

**Simulation, Test Lab, chat Lab** — catégorie E.

- *Manque* :
  - live simulé et mini-jeux en Production (**corrigé ce jour**) ;
  - **le Test Lab pouvait lancer un second bot Twitch en profil Production, hors bail** (**bloqué ce jour**) ;
  - l'ingestion du chat Lab reprend seule et lit le vrai chat.
- *Recommandé* : lot 9.

---

## D. Automatisations recommandées

### D.1 Le cycle du live, phase par phase

**A. Hors ligne.**

Doivent rester disponibles :

- Core, bot, Daily (fenêtre de réclamation), Boutique ;
- défis, statistiques, raptoru.fr ;
- alertes (décision du 16/10) ;
- configuration complète de Studio.

Sont déjà fermés par le live : mini-jeux, Jeu des mots, présence, XP, planificateur Tombola.

**Restent ouverts sans décision explicite** : Soundboard, TTS, Bonk, Chaos, `!rb`, Caution, Votekick, Spotify,
points de chaîne (H1). Toutes les configurations sont conservées : rien ne se réinitialise hors ligne, ce qui est
correct.

**B. Préparation** (P1-1). Une liste « Prêt pour le live » dans le Centre de contrôle, en lecture seule, ligne par
ligne avec la raison et le geste :

1. bot actif, chat et EventSub joints, jeton `raptoru_` valide, fonctions attendues présentes ;
2. Core joignable, profil Production effectif ;
3. OBS connecté ; sources présentes et à la bonne adresse (Alertes, Effets, TTS, Bonk, Tombola, Votekick, Jeu des
   mots) ;
4. lecteurs vus récemment (Soundboard intégré, TTS, effets, alertes) ;
5. interrupteurs d'intention : points de chaîne, roue, mini-jeux, Sortie chat, Spotify, StreamElements en ACTIVE ;
6. extension servie : environnement, API, empreinte (A6, demande un marqueur de build) ;
7. instantané des abonnés de moins de 12 h.

Un lecteur absent se signale comme : « Bonk : achats refusés tant que la source n'est pas affichée (aucun Jeton
débité) ». Le message dit **la conséquence pour les viewers**, pas un code technique.

**C. Début du live.**

- Démarrent déjà seuls : présence et fidélité, Daily, Jeu des mots (premier mot 5 à 15 min plus tard), mini-jeux,
  planificateur Tombola **s'il est activé**, Commandes `when: live`.
- **Je ne recommande aucun démarrage automatique supplémentaire** :
  - un tirage, un vote ou l'ouverture de Spotify restent des intentions d'Antoni ;
  - si H1 retient « pendant le live seulement », les achats payants s'ouvriront et se fermeront avec le live, par
    construction et sans action.
- **Une seule automatisation utile** : relancer la liste de préparation au passage en live et notifier ce qui n'est pas
  prêt (P1-1).

**D. Pendant le live.**

- À détecter :
  - lecteur disparu, source OBS cachée, bot muet ;
  - file d'alertes ou de travaux OBS qui grossit sans consommateur ;
  - exécuteur absent ;
  - jeton `raptoru_` perdu.
- Se reconnectent déjà : OBS, EventSub, lien Production, lecteurs.
- **Pause volontaire contre panne** : l'intention « En pause » est posée par Antoni ; une panne est un constat qui
  contredit une intention « Activé ». Studio ne doit jamais présenter l'un pour l'autre (grille B.1). Il ne doit pas
  non plus classer « incident » une source Bonk non affichée sur une scène où elle n'a pas lieu d'être : gravité selon
  le live et la scène (P1-4).

**E. Fin du live.** Règles à rendre explicites, affichées dans la Régie sous « À la fin du live » :

| Élément | Aujourd'hui | Recommandé |
|---|---|---|
| Tirage Tombola ouvert | se termine et paie | garder |
| Vote Votekick en cours | se termine | garder |
| Tours de roue dus | gardés pour un live suivant | garder (règle validée) |
| Mots du Jeu des mots | `active` jusqu'à la session suivante | marquer abandonnés à la fin (cosmétique, sans argent) |
| Demandes Spotify non jouées | restent en file, jamais remboursées | **H6** |
| Travaux OBS de points de chaîne en file | n'expirent jamais | **H2** |
| Alertes en file | restent | **H3** |
| TTS en attente | lues jusqu'à 30 min plus tard | **H4** |
| Compteurs | aucun remis à zéro, à juste titre (Daily et séries ont leurs propres règles) | — |

### D.2 Classement recommandé

| Catégorie | Modules |
|---|---|
| **A — permanent** | Core, bot, Commandes, supervision, OBS, Dock, alertes, points de chaîne (interrupteur), Roue du Sub, Progression, Boutique, Défis, Modération, historiques, extension |
| **B — lié au live** | présence et fidélité, Daily, Jeu des mots, Roulette / Slot / Duel, planificateur Tombola, XP |
| **C — configurable** | Soundboard, TTS, Bonk, Chaos et effets payants, `!rb`, Caution, Votekick, Spotify : « toujours » ou « pendant le live » (H1) |
| **D — manuel** | lancer un tirage, ouvrir une saison, relancer un tour de roue, rembourser, sanctionner, recompter un défi, « Exécuter » une récompense |
| **E — Lab / aperçu** | Extension Lab, Simulation (chat simulé), Test Lab, aperçus Alertes / cosmétiques / sons |

### D.3 Réglages : sélection argumentée

**Essentiels (à mettre dans la page du module)** :

- prix `!rb` (25 000), FX Cam (1 500) et Bonk (200) ;
- Caution : 1 000 par minute et 300 par 10 s ;
- durées Random Ban (180 / 300 s), chance du streamer (2 %) et durée du mute (60 s) ;
- Votekick : recharge (1 h) et durée de sanction (5-30 min) ;
- Roulette / Slot : mise minimale (20) et recharges (10 s / 2 s) ;
- Duel : maximum (100 000) et recharge (30 s) ;
- intervalle du Jeu des mots (5-15 min) ;
- paliers du Daily ;
- taux de fidélité (la table existe, sans écran) ;
- expiration TTS ;
- fraîcheur des alertes ;
- pour chaque module de catégorie C, son interrupteur et sa règle de live.

Ces valeurs vivent dans le Core (tables par chaîne), jamais dans Studio, pour rester la seule vérité.

**Avancés (repliés dans « Paramètres avancés »)** :

- Tombola : nombre automatique de gagnants, préréglages du planificateur ;
- Roue du Sub : délai d'annonce, durée de vie des invitations, fraîcheur de présence ;
- seuil « tardif » des points de chaîne (120 s) ;
- quorum Votekick (3) et pile ou face (4 votes) ;
- seuil sensible de la modération ;
- noms des sources et filtres OBS (BRB, Creepy, `RAPTORU_MUTE_FX`) : aujourd'hui figés, alors que
  `VOTEKICK_V2.md` les dit configurables ;
- heure de remise à zéro du Daily ;
- volume du son Creepy ;
- délai de confirmation d'un incident (30 s).

**Techniques (restent internes)** : baux, cadences de sondage, délais réseau, tentatives, budgets de relance, fenêtres
de confiance Helix et EventSub, nombre maximal d'effets simultanés, tailles de file internes.

**Inutiles** :

- symboles de la Slot ;
- groupes de phrases ;
- délai de reprise du son de lancement Votekick ;
- champs morts `conversion_rate` et `conversion_cap_per_hour` de la boutique saisonnière ;
- mode v1 / v2 de la roue, à replier.

**Volontairement exclus** : cotes et tables de gains (Roulette 50 %, Slot ×24, valeurs de la roue, mots dorés). Une
erreur de saisie crée ou détruit de la monnaie. À rouvrir seulement sur demande, avec un aperçu de l'espérance de gain.

### D.4 Automatisations transversales, évaluées

| Piste | Valeur réelle | Verdict |
|---|---|---|
| Préparation automatique avant live (vérifications) | très forte (I2, I4, I5) | **P1-1** |
| Vérification OBS et lecteurs | forte | dans P1-1 et P1-4 |
| Activer un ensemble de modules au début du live | faible : ce qui doit démarrer démarre déjà ; le reste est une intention | non, sauf H1 |
| Pause cohérente lors d'un incident | moyenne, risquée (couper l'argent ou une file de façon imprévisible) | non automatique ; la Régie montre l'incident et le module concerné, la coupure reste nommée et manuelle |
| Fermeture d'interactions en fin de live | moyenne | règles par module (D.1 E), après H1 / H6 |
| Profils de stream (« jeu », « discussion », « événement ») | utile plus tard ; aujourd'hui un seul type de live | **P3-1** |
| Contrôle centralisé des états | très forte | P1-2 |
| Alertes sur modules indisponibles | forte | P1-4 + notifications existantes |
| Gestion des dépendances | forte, déjà dans les modules ; manque l'affichage | P1-2 (champ « dépend de ») |
| Récupération après redémarrage | moyenne : la logique est déjà sûre (« jamais rejoué ») ; manque la restauration OBS | P1-5 |

### D.5 Présentation dans le Centre de contrôle et la Régie

Une ligne par module, quatre zones, aucune liste d'interrupteurs :

```text
Roue du Sub     ● Prêt          Activé · avec le live      Dépend : lecteur d'effets ✓, bot ✓, Sortie chat ✓
Bonk            ● En attente    Activé                     Source « Raptoru Bonk » non affichée → achats refusés (aucun Jeton débité)
Caution         ○ Bloqué        Serveur : CAUTION_CHAT=false (redéploiement du Core)
Spotify         ● Prêt          Ouvert · 3 demandes        Fin du live : demandes gardées (règle H6)
```

- **Centre de contrôle** : « Prêt pour le live » en tête, puis les modules non prêts, puis les autres repliés.
- **Régie** : seulement ce qui est en cours, les files et les actions nommées, plus « À la fin du live ».
- Les interrupteurs restent dans la page de chaque module. Le Centre y mène et ne duplique aucun gestionnaire, comme le
  veut la règle de la refonte.

---

## E. Fiabilité

### E.1 Scénarios d'incident

| Scénario | Mécanisme existant | Insuffisant ou manquant | Risque de double exécution | Amélioration |
|---|---|---|---|---|
| Studio démarre avant OBS | reconnexion OBS infinie [code] | — | non | — |
| OBS démarre après Studio | idem, reprise en ~10 s | les points de chaîne ont pu prendre des travaux entre-temps : échec « OBS non connecté » au lieu d'attendre | non | P1-6 |
| Bot en retard | bail et attente ; Core idempotent | ce qui arrive avant les abonnements EventSub est perdu (aucun rattrapage) | non | — (limite Twitch, § F.5) |
| Core indisponible | outbox du bot (fidélité, alertes, points) ; Studio relance | **plus de 35 s : le bot s'arrête** et tout ce qui arrive pendant est perdu ; messages de jeux perdus après 15 s ; `!daily` après 1 essai ; exécuteurs Studio sans attente progressive | non | P2-9 (grâce du bail), P2-8 |
| Twitch coupe brièvement | reconnexion EventSub 5 s ; déduplication par identifiant de message | pas de rattrapage | non | — |
| Studio redémarré pendant le live | journaux Bonk, TTS et Soundboard ; « jamais rejoué » | effets, Halloween, compte rendu de la roue en mémoire (→ « À vérifier ») ; **micro, scène et filtres non restaurés** ; quitter n'est jamais bloqué | non | P1-5 |
| Lecteur fermé par accident | refus avant débit (Soundboard, TTS, Bonk, Chaos) ; la roue attend | **alertes et travaux OBS en file sans limite** ; lecteur d'effets, alertes, Tombola et Votekick hors supervision | non, mais **rafale différée** | P0-1, P1-4, P1-7 |
| Perte d'Internet du PC | lien Production, reprises | file Core qui grossit (alertes, points) pendant ce temps | rafale différée | idem |
| Stream interrompu puis repris | même identifiant de stream = même session ; nouvel identifiant = nouvelle session, sans double Daily | Jeu des mots remis à zéro si l'identifiant change ; présence : jusqu'à 3 min non créditées | non | P2-1 |
| Module en pause volontaire | état en base, persistant | affiché comme les pannes dans certaines vues | non | P0-8 |
| État persistant ≠ état mémoire | intention en base, constat recalculé | réglages locaux qui repartent autrement (SE ACTIVE → TEST, chat Lab ON → reprise) | non | H5, lot 9 |

### E.2 Risques d'argent ou de double exécution encore ouverts

| # | Risque | Preuve | Effet | État |
|---|---|---|---|---|
| R1 | « Créditer / Débiter » en Modération depuis Studio : clé aléatoire côté Core | `core/lab-moderation/service.ts:540` | double écriture sur double clic ou nouvel essai | ouvert → P0-2 |
| R2 | « Donner » (Boutique) : clé créée au clic | `web/cosmetics.ts:713` | double crédit | **double clic bloqué ce jour** ; clé par formulaire → P0-2 |
| R3 | Extension : clé par clic pour Soundboard, Bonk simple, boutique, titres, Tombola | `ext/shared/api.js:492-499` | double paiement possible après un délai dépassé [à vérifier] | P0-10 (publication de l'extension) |
| R4 | Live simulé ouvert sur le Core de Production | `core/http/studio-cockpit-routes.ts:16`, `raffle-lab-service.ts:1753` | jeux payants ouverts hors live, jamais fermés | **bloqué côté Studio ce jour** ; garde Core → P0-4 |
| R5 | Test Lab : second bot Twitch hors bail | `studio/index.ts` (actions Test Lab), `studio/test-lab/test-lab.ts` | réponses et jetons en conflit avec le bot du VPS | **bloqué ce jour** |
| R6 | Identité du bot lors d'un déploiement progressif Coolify | `bot/index.ts:58-64`, `core/bot-instance/service.ts:62-73` | deux détenteurs si `BOT_INSTANCE_ID` est fixe ou le nom d'hôte partagé | **[à vérifier]** P0-9 |
| R7 | Travaux OBS des points de chaîne sans expiration | `core/channel-points/service.ts:1247-1273` | effets joués des heures plus tard | P0-1 (H2) |
| R8 | « Tester » une récompense Spotify | `core/spotify/service.ts` (aucune branche « à blanc ») | vraie demande ou vrai passage de morceau [à vérifier] | P0-6 |
| R9 | Bug de frontière de la roue | `core/sub-wheel/service.ts:403-475` | subs du live remis en attente de présence | P0-3 |
| R10 | Gains passifs `tier_unknown` | `core/loyalty/tiers.ts:30-35` | Jetons non versés, en silence | P1-10 (H9) |

Aucun chemin de **double versement automatique** n'a été trouvé dans les rejeux EventSub, les outbox, la bascule PC ↔ VPS,
la Tombola, la roue, le Daily ou les jeux : les clés tiennent [code]. Les risques restants viennent d'**actions humaines
répétées** (R1-R3) ou de **chemins de test** (R4, R5, R8).

### E.3 État désiré contre état constaté

C'est le principe de réconciliation des contrôleurs Kubernetes : l'intention est stockée, le constat est relu, la
différence se montre. Il s'applique ici sans moteur générique :

- **l'intention** vit dans le Core (interrupteurs en base) ;
- **le constat** est calculé par chaque fournisseur du Centre de contrôle ;
- **Studio affiche l'écart** (« Activé mais en attente : … »).

Seuls les éléments locaux par nature ont une boucle de rattrapage : lien OBS, lecteurs, restaurations OBS. Les
transitions du live sont rejouables sans effet par construction : le passage en live s'appuie sur des sessions
idempotentes, jamais sur « exécuter X à l'événement online », pour éviter les activations fantômes et les doublons après
une reconnexion.

---

## F. Modernisation fonctionnelle

1. **Un service de session de live**, et non la Tombola. Aujourd'hui, la session dont dépendent quatre modules vit dans
   la Tombola (choix historique, ASTRA-P1-007) et suit d'autres règles que la session canonique. Cible :
   - `lab_stream_sessions` devient une vue ou un miroir de `stream_sessions` ;
   - un seul chemin du bot, une seule règle de réparation ;
   - un événement interne « live terminé » que les modules écoutent (D.1 E) ;
   - le live simulé n'existe plus qu'en profil Lab.

   C'est le prérequis de H1 (P2-1).

2. **Variables = plafond, base = intention.** Garder les variables pour ce qui protège (économie, crédits, identité,
   jetons) et comme plafond « autorisé ». Les interrupteurs de comportement passent en base, réglés dans Studio :
   `CAUTION_CHAT`, `VOTEKICK_CHAT`, `SPOTIFY_CHAT`, `CHALLENGES_ENGINE`, `ALERTS_MAX_AGE_SECONDS`, puis côté bot
   `CAUTION`, `VOTEKICK` et `RANDOM_BAN` en « capacité installée ». Un changement de comportement ne demande plus de
   redéploiement, et la sécurité reste au serveur (P2-2).

3. **« Sortie chat » devient un réglage de chaîne** visible au Centre, avec l'état des trois conditions et l'explication
   des deux chemins (P1-11).

4. **Pages de module complètes** pour ce qui n'en a pas, dans la refonte :
   - Roulette / Slot / Duel (hors « Simulation ») ;
   - Votekick en direct (vote, mute, exécuteur, historique) ;
   - Daily ;
   - fidélité ;
   - Bonk (prix).

   Chaque page porte l'interrupteur, la règle de live, les réglages essentiels et la ligne d'état de la grille B.1.

5. **Ce qui ne se rattrape pas, dit honnêtement.** Twitch ne rejoue rien après une coupure EventSub. Une lecture Helix
   des utilisations de points `UNFULFILLED` (lot 11 du plan post-live) suffit à montrer les pertes ; un vrai rattrapage
   n'est pas proportionné.

6. **Saisons réutilisables** : identifiant, dates, action « fermer la saison » qui ferme boutique, profil d'alertes,
   ambiance et filtres OBS ensemble (P3-2).

7. **Catalogue Soundboard en données** : ajout de sons depuis Studio, comme les sons d'effets. Aujourd'hui il faut une
   publication du Core et de l'extension (P3-3).

### F.1 Frontières Production / Lab / Simulation / Aperçu (§ 13 de la mission)

| Outil | Ce qu'il fait réellement | Catégorie | Correction |
|---|---|---|---|
| Widget « Simulation de stream » en Production | live simulé (**retiré ce jour**) ; interrupteur réel des mini-jeux (**libellé PRODUCTION + confirmation ce jour**) | Production, sous un nom de simulation | lot 9 : retirer le widget de la barre en Production ; l'interrupteur va dans la page Mini-jeux |
| Tombola « Simuler début / fin de stream » | session réelle sur le Core du profil | Lab seulement | **fait côté Studio** ; P0-4 côté Core |
| Test Lab | lance Core et bot locaux avec les jetons du PC | diagnostic Lab | **démarrages bloqués en Production ce jour** ; lot 9 : sort du Test Lab « temporaire » |
| Ingestion chat Lab | lit le vrai chat, reprend seule si laissée ON | Lab, entrée réelle | lot 9 : ne jamais reprendre seule, ou demander au démarrage |
| « Tester » une récompense | exécute pour de vrai (OBS, sons, effets, Spotify) ; crédits et Random Ban à blanc | **Production** | P0-6 : « Exécuter maintenant (réel) », liste des actions réelles, Spotify à blanc |
| Alertes « Envoyer dans la file » | vraie file, vraie source OBS | Simulation dans le circuit réel | P1-13 : profil affiché, confirmation en Production |
| Dock « Rejeu » | nouvelle alerte dans la vraie file | Production | P1-13 : « Rejouer sur le stream » |
| Random Ban « Tester le mute du streamer » / « Test Caution » | mute OBS réel 60 s / sanction réelle payée | Production | P1-13 : libellés « réel » |
| Random Ban « Tirage à blanc » | lecture Twitch réelle, aucun timeout | Simulation | garder |
| Extension Lab | Core Lab local, Jetons fictifs ; peut jouer sur le vrai OBS | Aperçu + Simulation | lot 9 : badge « joue sur OBS » ; aligner les modules montrés sur la Production |
| Aperçus Alertes, cosmétiques, « Écouter » | rendu sans effet | Aperçu local | garder |
| Halloween « Tester » | « joue réellement, sans achat » | Production, libellé honnête | garder |

---

## G. Backlog priorisé

Effort : S (moins d'une demi-journée), M (environ un jour), L (plusieurs jours). « Livré par » indique ce qui demande un GO.

### P0 — sécurité et fiabilité

| ID | Quoi | Valeur | Effort | Risque | Livré par | État |
|---|---|---|---|---|---|---|
| — | Lecteur Soundboard de Production chargé au lancement (régression de la refonte) | Soundboard utilisable sans ouvrir Système | S | faible | Studio | **fait** `0675b9b` |
| — | Live simulé refusé en Production (serveur Studio, Tombola, widget) | aucune session réelle ouverte par erreur | S | faible | Studio | **fait** `0675b9b` |
| — | Interrupteur mini-jeux annoncé réel + confirmation | fin de l'ambiguïté I5 | S | nul | Studio | **fait** `0675b9b` |
| — | Voyant Caution : plus « prête » avec un bot muet | état vrai | S | nul | Studio | **fait** `0675b9b` |
| — | Test Lab : démarrages refusés en Production | jamais deux bots | S | faible | Studio | **fait** `cde6c4f` |
| — | Boutique : une action à la fois (« Donner ») | plus de double crédit au double clic | S | nul | Studio | **fait** `a49178a` |
| P0-1 | Travaux OBS des points de chaîne : expiration (« Studio absent »), visibles dans l'historique | plus de rafale d'effets différée | S | faible | Core | après **H2** |
| P0-2 | Clé d'idempotence par formulaire ouvert pour « Créditer / Débiter » (Modération) et « Donner » (Boutique) ; type de registre corrigé | plus de double écriture Wallet | S-M | faible | Studio + Core | à faire |
| P0-3 | Roue : seule l'activation déplace la frontière « sub reçu pendant ce live » (colonne `enabled_at` ou `updated_at` réservé) ; ligne d'audit à l'activation | subs du live tirés normalement | S | faible (migration additive) | Core | à faire |
| P0-4 | Core : `stream_start` / `stream_end` refusés par le cockpit sur l'économie canonique | défense en profondeur de R4 | S | nul | Core | à faire |
| P0-5 | Bot : `stream-watch` ne marque l'événement qu'après succès du Core ; le pont des jeux applique la même fenêtre de confiance Helix | plus de live manqué 5 min ni de session des jeux rouverte hors live | S | faible | bot | à faire |
| P0-6 | « Tester » une récompense : « Exécuter maintenant (réel) », liste des types d'action réels, Spotify à blanc (ou bloqué) | fin d'un test réel caché | S | faible | Studio + Core | à faire (vérifier R8) |
| P0-7 | Échec de démarrage du profil Production → incident visible (signal `start_failed`), Centre rouge | plus de faux « tout va bien » | S | nul | Studio | à faire |
| P0-8 | Régie et Centre : jamais de vert sur une intention seule (points de chaîne, TTS, Spotify) ; « Aucun incident confirmé » remplacé par l'état réel couvert | état vrai | S | nul | Studio (refonte 7a) | à faire |
| P0-9 | Vérifier en lecture seule dans Coolify que `BOT_INSTANCE_ID` n'est pas fixe et que le déploiement ne recouvre pas deux conteneurs actifs | exclut R6 | S | nul | Antoni (lecture) | à faire |
| P0-10 | Extension : une clé par intention pour tout achat ; clé transmise aux contrôles TTS ; retrait de « Valider avant lecture » (404) | plus de double paiement après un délai dépassé | M | moyen (publication de l'extension) | extension (Antoni) | à faire |

### P1 — confort quotidien

| ID | Quoi | Valeur | Effort | Livré par |
|---|---|---|---|---|
| P1-1 | **Prêt pour le live** : liste en lecture seule (§ D.1 B), relancée au passage en live, notification de ce qui manque ; route Core d'agrégation en lecture | évite I2, I4, I5 | M | Core (lecture) + Studio |
| P1-2 | Fournisseurs du Centre de contrôle pour chaque module (intention, constat, activité, dépendances, règle de démarrage) | « qu'est-ce qui marche, pourquoi pas » | M-L | Studio |
| P1-3 | Configuration effective : variables du Core (route ops existante) et du bot (`CP_TWITCH_ACTIONS` compris) affichées comme « Bloqué par le serveur » | fin des surprises de variables | S-M | Core + bot + Studio |
| P1-4 | Supervision : lecteur d'effets, source Alertes, overlays Votekick et Tombola, exécuteur des points de chaîne, lien OBS ; gravité selon le live | pannes vues avant les viewers | M | Studio |
| P1-5 | Fermeture et redémarrage de Studio : restaurer micro et filtres avant de déconnecter OBS ; avertir avant de quitter pendant un effet ou un mute | plus de micro coupé « fantôme » | S-M | Studio |
| P1-6 | Exécuteurs points de chaîne et animations Random Ban : ne prendre un travail que si OBS et le lecteur sont prêts (comme la roue) ; attente progressive sur erreur | moins d'échecs inutiles | S | Studio |
| P1-7 | Alertes : fraîcheur (H3) et « Vider / passer la file » (sans effet économique) | contrôle de la file | S-M | Core + Studio |
| P1-8 | Démarrage avec Windows (A7, décidé le 21/10, désactivé par défaut) | Studio prêt sans y penser | S | Studio |
| P1-9 | StreamElements : rappel dans « Prêt pour le live » si le mode est TEST (ou H5) | dons affichés | S | Studio |
| P1-10 | Âge de l'instantané des abonnés surveillé (alerte au-delà de 12 h) ; traitement `tier_unknown` selon H9 | Jetons non perdus en silence | S-M | bot + Core + Studio |
| P1-11 | « Sortie chat » réglée et expliquée au Centre (trois conditions, deux chemins) | réponses perdues visibles | S | Studio |
| P1-12 | Pages Mini-jeux (interrupteur, parties récentes) et Votekick en direct (lit `/api/votekick/state`) | écrans manquants | M | Studio (refonte lots 4 / 6) |
| P1-13 | Libellés de portée en Production : « Envoyer dans la file », « Rejeu », tests Random Ban, « Core local » en Modération, « Wallet de test » masqué, Extension Lab « joue sur OBS » | plus de test réel caché | S | Studio |

### P2 — améliorations fonctionnelles

| ID | Quoi | Dépend de | Effort |
|---|---|---|---|
| P2-1 | Service de session de live unique + événement « live terminé » ; « ce stream » de la modération sur la vraie session | P0-5 | L |
| P2-2 | Interrupteurs de comportement en base (variables = plafond) | P1-3 | M-L |
| P2-3 | Règle « toujours / pendant le live » pour les modules C | H1, P2-1 | M |
| P2-4 | Règles de fin de live (Spotify, mots, travaux en file) | H6, P2-1 | M |
| P2-5 | Réglages essentiels (§ D.3) dans les pages de module, valeurs dans le Core | H10 | L (par lots) |
| P2-6 | Jeu des mots : interrupteur durable et intervalle réglable | H8 | S-M |
| P2-7 | Défis : état du moteur visible, texte « versée automatiquement » exact, périodes manquées | H16 | S-M |
| P2-8 | Sondage du Core distant : attente progressive sur erreur (points de chaîne, Votekick, Random Ban, roue) ; minuteries Halloween coupées hors événement | — | S |
| P2-9 | Bot : délai de grâce avant de s'arrêter sur Core muet ; santé dégradée si le jeton `raptoru_` manque | — | M |

### P3 — évolutions futures

- **P3-1** Profils de stream.
- **P3-2** Saisons réutilisables.
- **P3-3** Catalogue Soundboard en données.
- **P3-4** Historique unifié dans Activité et statistiques des modules dans Studio.
- **P3-5** Lecture Helix des utilisations « unfulfilled » (lot 11).
- **P3-6** Level Up V2.
- **P3-7** Aperçu de l'effet d'un changement de courbe d'XP.

---

## H. Arbitrages pour Antoni

> **05/11/2026 : arbitrages tranchés par Antoni.** Décisions et état de mise en œuvre : [CONTEXTE.md](CONTEXTE.md) § 18 ;
> choix techniques pris en les appliquant : § 19. Le tableau ci-dessous reste l'état du 04/11 (historique).

Tant qu'une décision n'est pas prise, **le comportement actuel est conservé**. Les évidences techniques ne sont pas
listées ici : elles sont traitées dans le backlog.

| # | Question | Aujourd'hui | Recommandation | Pourquoi | Risque | Options |
|---|---|---|---|---|---|---|
| **H1** | Achats et interactions **hors live** : Soundboard, TTS, Bonk, Chaos, `!rb`, Caution, Votekick, Spotify, effets de points de chaîne | possibles si Studio et les lecteurs sont prêts | **Un réglage par module**, par défaut « pendant le live seulement » pour tout ce qui agit sur le stream (sons, voix, Bonk, effets, Random Ban, Caution, Votekick, Spotify) ; les tests se font en profil Lab | un achat hors live ne profite à personne et peut sortir au mauvais moment (Studio ouvert, stream coupé) | viewers surpris par un refus, à annoncer | a) garder « toujours » ; b) « pendant le live » partout ; c) **par module (reco)** |
| **H2** | Utilisation de points de chaîne quand **Studio est absent** (effets OBS) | attend indéfiniment et s'exécute à la réouverture | **Expirer au bout de 2 min** (même seuil que « tardif »), statut « Studio absent » ; rembourser sur Twitch si la récompense est gérée par Raptoru (cohérent avec A5 : échec définitif = remboursement unique) | évite une rafale d'effets des heures plus tard | points perdus si la récompense n'est pas gérable | a) expirer sans remboursement ; b) **expirer + rembourser si possible** ; c) garder |
| **H3** | **Fraîcheur des alertes** | aucune : tout l'arriéré rejoue | **30 min**, plus un bouton « Vider la file » | remercier un sub reste utile ; une heure plus tard, non | une alerte perdue après une longue panne | 10 min / 30 min / jamais |
| **H4** | **Expiration TTS** | 30 min | **5 min** | une voix payée doit être lue dans le moment | plus de remboursements pendant les pannes | 2 / 5 / 30 min |
| **H5** | StreamElements au **redémarrage** de Studio | ACTIVE repart en TEST | **En Production, reprendre ACTIVE** (en Lab, TEST) + ligne dans « Prêt pour le live » | les dons ne doivent pas tomber en silence | aucun en Production (c'est le comportement voulu en live) | garder / **reprendre en Production** |
| **H6** | **Demandes Spotify non jouées** en fin de live | restent en file, jamais remboursées | **Fermer les demandes à la fin du live** et rembourser les non jouées (récompense gérée) | une demande payée pour ce live | aucune | garder / fermer seulement / **fermer + rembourser** |
| **H7** | **Démarrage automatique** au début du live d'un module interactif (tirage, vote, ouverture Spotify) | aucun (seuls le planificateur Tombola, s'il est activé, et le Jeu des mots démarrent) | **ne rien ajouter** | ce sont des intentions ; ce qui doit démarrer le fait déjà | — | confirmer |
| **H8** | **Jeu des mots** : interrupteur durable et intervalle | pas d'arrêt durable ; 5-15 min figé | ajouter l'interrupteur (ON par défaut) et l'intervalle réglable (5-15 min par défaut) | seul module payant sans arrêt durable | — | valeurs à choisir |
| **H9** | Gains passifs **`tier_unknown`** (instantané des abonnés trop vieux) | perdus | **verser au taux de base** sur le moment, puis le complément quand le niveau est connu | aucune perte silencieuse | faible (montants petits) | perdre / taux de base / complément différé |
| **H10** | **Quelles limites deviennent réglables** | toutes figées | prix, recharges, durées, maximums (§ D.3 Essentiels), **pas** les cotes ni les tables de gains | valeur forte, risque maîtrisé avec des bornes | saisie d'une valeur extrême (bornes Core) | liste à valider ; `!rb` séparé de la récompense ? |
| **H11** | **« Tester »** une récompense en Production | exécution réelle | garder l'exécution réelle, renommée « Exécuter maintenant (réel) », confirmation qui liste les actions ; Spotify à blanc | utile pour vérifier OBS en live ; le danger venait du nom | — | réel nommé / à blanc seulement / scène de test |
| **H12** | **Prix et recharge du Bonk** | 200 Jetons, aucune recharge | réglables (P2-5) ; valeurs à choisir | — | — | valeurs |
| **H13** | Mode **v1 / v2** de la Roue du Sub | visible dans les réglages | replier dans « Avancé / retour arrière » | V2 en Production depuis le 26/10 | aucun | garder visible / replier / retirer |
| **H14** | **Daily** : paliers et heure de remise à zéro (16:00) | figés (table sans écran) | paliers réglables, heure figée | la table existe déjà | — | — |
| **H15** | Choix « Annoncer mes Level Up » dans l'extension | affiché, lu par rien | **masquer** jusqu'à Level Up V2 | option trompeuse | aucun | masquer / garder |
| **H16** | **Moteur des défis** en Production (`CHALLENGES_ENGINE`) | coupé ; recomptage manuel | déjà ouvert côté site (`SITE_CONTEXT.md`) ; ici seulement afficher l'état | — | périodes perdues tant qu'il est coupé | — |

Toute suppression de fonction existante, comme le widget Simulation en Production ou le Test Lab « temporaire », sera
présentée avec ses usages au lot 9, avant d'être faite.

---

## I. Plan de réalisation

Principe : **lots verticaux, un module n'est refondu qu'une fois**. Quand la refonte UX touche une page, elle embarque les
points fonctionnels de ce module (réglages, état, libellés de portée). Rien n'est publié ni déployé sans GO d'Antoni.

### I.0 Fait pendant cet audit (branche `feat/studio-ux`, non publié, non validé)

| Commit | Contenu | Tests |
|---|---|---|
| `0675b9b` | lecteur Soundboard de Production chargé au lancement ; live simulé refusé en Production (serveur Studio + Tombola + widget), fin d'un live Twitch jamais permise ; interrupteur mini-jeux annoncé réel avec confirmation ; voyant Caution vrai | `raffle-lab` (+4), `caution-view` (+1), `simulation-view` (+1), `studio-shell`, `control-center` : 59/59 ; typecheck, lint, Prettier, build |
| `cde6c4f` | Test Lab : seulement les arrêts en Production | `test-lab` (+1), `extension-lab`, `twitch-connections-routing` : 29/29 |
| `a49178a` | Boutique : une action à la fois | E2E `cosmetic-shop`, `cosmetic-edit`, `cosmetic-frames` verts |

**Non vérifiable ici** : le lecteur Soundboard dans le vrai Studio Electron en profil Production, et la reprise
automatique de « Activer le son » (règle d'autoplay d'Electron) [à vérifier par Antoni].

L'E2E `tombola-bonbons` échoue (délai dépassé en attendant les Bonbons des gagnants) **aussi sur `f1f1b03`, sans ces
changements** : défaut antérieur, cause non analysée.

### I.1 Lots

| Lot | Contenu | Livré par | Tests | Critère d'acceptation |
|---|---|---|---|---|
| **F1 — Vérité des états** (avec refonte 7a / 8) | P0-7, P0-8, P1-13, libellés « Tester » (P0-6, partie Studio) | Studio | unitaires des vues (chaque état), captures | aucun vert sur une intention seule ; chaque action réelle dit « réel » en Production ; échec Production visible |
| **F2 — Argent et files** | P0-1 (après H2), P0-2, P0-3, P0-4, P0-6 Spotify, P1-7 | Core + Studio | PostgreSQL réel : concurrence, idempotence, double clic, rejeu ; frontière de la roue | aucune double écriture sur 2 envois de la même intention ; aucun travail OBS joué après expiration ; un réglage enregistré pendant un live ne change aucun tirage dû |
| **F3 — Bot et live** | P0-5, P0-9, `CP_TWITCH_ACTIONS` dans les fonctions remontées, P1-10, P2-9 | bot (+ Core) | faux Core qui échoue au passage en live ; retard Helix simulé | un live manqué est réparé au cycle suivant ; la session des jeux ne se rouvre pas hors live |
| **F4 — Centre de contrôle et préparation** | P1-1, P1-2, P1-3, P1-4, P1-9, P1-11 | Core (lecture) + Studio | chaque contrôle en vert et en rouge ; fournisseur en panne isolé | Antoni coupe la roue → la ligne passe au rouge avec la raison ; lecteur fermé → « en attente » avec la conséquence viewer |
| **F5 — Reprise propre** | P1-5, P1-6, P1-8, P2-8 | Studio | redémarrage pendant un mute (OBS simulé), quitter pendant un effet | après fermeture de Studio, micro et filtres sont rétablis ; aucun travail pris sans OBS |
| **F6 — Réglages essentiels** (avec refonte lots 4 et 6) | P1-12, P2-5, P2-6, P2-7, H13, H15 | Core + Studio | bornes refusées côté Core ; valeurs conservées au redémarrage | chaque valeur Essentielle du § D.3 se règle dans la page du module, sans redéploiement |
| **F7 — Cycle du live** (après H1, H6) | P2-1, P2-2, P2-3, P2-4 | Core + bot + Studio | transitions online / offline rejouées ; double événement ; coupure courte | aucun module ne s'ouvre ou ne se ferme deux fois ; les règles de fin de live sont affichées et appliquées |
| **F8 — Plus tard** | P3 | — | — | — |

**Ordre recommandé** : F1 → F2 → F4 → F3 → F5 → F6 (au fil de la refonte des pages) → F7.

F1 et F4 sont surtout Studio et ne demandent ni déploiement ni décision. F2 et F3 touchent l'argent et Twitch : tests sur
PostgreSQL réel, puis GO de déploiement. F7 attend H1 et H6.

---

## Références externes (recherche ciblée)

- [Twitch — Getting Events Using WebSockets](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/) et
  [WebSocket Messages](https://dev.twitch.tv/docs/eventsub/websocket-reference/) :
  - un message renvoyé garde son `message_id` : déduplication sur cet identifiant, ce que fait déjà le bot ;
  - `session_reconnect` donne l'adresse de reprise ;
  - le délai de keepalive se règle de 10 à 600 s ;
  - aucun rejeu vers une nouvelle session : la perte pendant une coupure est une limite de Twitch, pas de Raptoru.
- `stream.online` porte un champ `type` (`live`, `playlist`, `watch_party`, `premiere`, `rerun`), selon les bibliothèques
  [twurple](https://d-fischer.github.io/twitch-eventsub/reference/classes/EventSubStreamOnlineEvent.html) et
  [twitch_api](https://docs.rs/crate/twitch_api/latest/source/src/eventsub/stream/online.rs). À vérifier dans
  `stream-watch.ts` lors de F3 : une rediffusion ne doit pas ouvrir de session.
- [Streamer.bot — Triggers](https://docs.streamer.bot/guide/triggers) et
  [Test trigger](https://docs.streamer.bot/api/triggers/core/test) :
  - déclencheurs activables un par un ;
  - un test marqué `isTest` que l'action peut reconnaître.

  Pour Raptoru, cela confirme qu'un test doit **se déclarer** comme tel jusqu'au bout (P0-6). Le modèle « tout est un
  déclencheur » n'est pas retenu (§ A.5).
- [Mix It Up — Event Commands](https://wiki.mixitupapp.com/commands/event-commands) : « Stream Start / Stop » ne se
  déclenchent qu'une fois par lancement de l'application. C'est la fragilité d'un modèle événementiel qu'évite une
  session idempotente côté Core (§ E.3).
- [Elgato — Smart Profiles](https://help.elgato.com/hc/en-us/articles/360053419071) : les profils changent selon le
  contexte. C'est la référence de P3-1, sans valeur aujourd'hui avec un seul type de live.
- Réconciliation « état désiré / état constaté » des contrôleurs Kubernetes
  ([explication](https://www.golinuxcloud.com/kubernetes-reconcile-loop-explained/)) : un contrôleur qui part de l'état
  courant tolère les événements manqués et les redémarrages. C'est le principe du § E.3.
