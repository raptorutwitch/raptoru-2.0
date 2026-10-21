# Plan d'exécution après le premier live (21/10/2026)

Sources : `docs/POST_LIVE_AUDIT_2026-10-20.md`, en particulier le § 14 (preuves rattachées aux décisions), et les décisions d'Antoni du 21/10.

État du dépôt : `main` sur `473de25`, rien de modifié hormis les documents de migration et d'audit, qui ne sont pas suivis par git.

Ce plan ne déploie rien, ne modifie aucune donnée Production et ne déclenche aucun tirage. Chaque lot est implémenté, testé, puis
validé par Antoni avant le suivant.

**Objectif final :** j'allume le PC, je lance Raptoru Studio et OBS, et tout le reste fonctionne. Plus de PowerShell pour streamer.

---

## 0. Constats qui fondent le plan (vérifiés)

| Constat                                                                                                                                                                                                                                                        | Conséquence                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Le bot ne parle qu'au Core (`CORE_API_URL`) et à Twitch : aucun appel vers Studio, OBS ou `127.0.0.1`. OBS, les effets, l'audio et les animations passent déjà par les files du Core, que Studio vient lire                                                    | Le bot peut quitter le PC **sans rien changer** à Studio ni à OBS                              |
| Le bot garde son état sur disque : `.twitch-tokens.json` (LeCroupier_), `.twitch-tokens.broadcaster.json` (raptoru_), 3 files durables (`.loyalty/.alerts/.channel-points-outbox.json`) et 2 journaux (`.chat-games-journal.json`, `.random-ban-journal.json`) | Il faut un **volume persistant** sur le VPS. Les jetons sont renouvelés et réécrits par le bot |
| Le verrou des jetons (`token-store.ts`) est un fichier **local**. Aucun mécanisme n'empêche un bot sur le PC et un bot sur le VPS de tourner en même temps. Seule la présence a un bail central (`presence_lease`)                                             | **Il faut un bail d'instance central dans le Core** avant toute bascule (lot 1)                |
| Les commandes chat sont dédoublonnées par l'identifiant du message Twitch, et les événements EventSub par leur identifiant : l'économie est idempotente. En revanche, les **réponses chat directes** et le **renouvellement des jetons** ne le sont pas        | Deux bots actifs, même brièvement, produiraient des réponses doubles et des conflits de jetons |
| Coolify fait des mises à jour en continu : le nouveau conteneur démarre **avant** l'arrêt de l'ancien                                                                                                                                                          | Sans bail, chaque redéploiement créerait une courte fenêtre à deux bots                        |
| `0xC0000409` (18:36:06) est distinct de la fermeture de la fenêtre : la ligne a été écrite par un superviseur vivant, qui a relancé le bot (audit § 14.1)                                                                                                      | Cause non attribuée : il faut capturer des preuves (lot 2)                                     |
| PC : Node v24.15.0 sous Windows. Image du Core : `node:22-bookworm-slim`                                                                                                                                                                                       | Le bot hébergé tournera sous Linux et Node 22, ce qui écarte la piste Windows sans la prouver  |
| Alertes et Roue du Sub : `channel.chat.notification` (un seul avis). Fidélité : `channel.subscribe` + `channel.subscription.message`                                                                                                                           | La déduplication de la fidélité (lot 6) ne touche **ni** les alertes **ni** la roue            |

---

## 1. Ordre d'exécution

Toutes les priorités sont P1 (bloquantes avant le prochain live), sauf indication contraire.

| Lot | Contenu                                                               | Priorité     | Livré par                              |
| --- | --------------------------------------------------------------------- | ------------ | -------------------------------------- |
| 1   | Core : bail d'instance unique du bot et battement de cœur             | P1           | déploiement Core A                     |
| 2   | Bot : bail, mode attente, arrêt propre, journalisation, image Docker  | P1           | image du bot                           |
| 3   | Studio : état réel du bot et des services, diagnostics lisibles       | P1           | release Studio A                       |
| 4   | Coolify : application bot, bascule PC → VPS, retour arrière           | P1           | gestes d'Antoni dans Coolify           |
| 5   | Contrôles automatiques avant live dans Studio                         | P1           | déploiement Core A et release Studio A |
| 6   | Fidélité : un seul bonus par renouvellement d'abonnement              | P1           | déploiement Core A                     |
| 7   | Tour de roue de Wenuyr : procédure tracée, tirage sur ta confirmation | P1           | déploiement Core A, puis ton GO        |
| 8   | PC, mode de secours : journal du bot et preuves de plantage           | P1 (petit)   | script seulement, aucun déploiement    |
| 9   | Ban aléatoire : fiche mise à jour à la fin de l'exécution             | P2           | déploiement Core A                     |
| 10  | Fonds de test : compte technique hors classements et statistiques     | P2           | déploiement Core A, puis ta validation |
| 11  | Récompenses Twitch restées « unfulfilled »                            | P2           | après le lot 4                         |
| 12  | Curseur de volume du Jeu des mots dans Studio                         | P2 (confort) | release Studio A ou B                  |
| 13  | Trou de présence après un changement de bot                           | P3           | plus tard                              |

On regroupe les livraisons pour limiter les redémarrages : **un seul déploiement Core** (lots 1, 6, 7, 9 et 10, chacun validé en local)
et **une seule release Studio** (lots 3, 5 et 12), **hors live**. Le lot 8 n'attend rien et peut être fait tout de suite.

---

## Lot 1 — Core : bail d'instance unique du bot (P1)

**But :** une seule instance Production du bot peut être active, où qu'elle tourne, et le Core sait laquelle, avec son état.

- **Migration Production additive `bot_instances` :**
  - colonnes : `instance_id`, `host` (« vps » / « pc »), `version`, `started_at`, `last_heartbeat_at`, `state` (`active` / `standby` / `stopped`) ;
  - drapeaux du bot (sans valeurs secrètes) ;
  - santé : EventSub joint ou non, chat joint ou non, jetons valides ou non, dernière erreur ;
  - plus une ligne de bail unique (`bot_lease`, sur le modèle de `presence_lease`).
- **Routes bot (`BOT_SECRET`) :**
  - `POST /v1/bot/instance/lease` : obtenir ou renouveler le bail. Durée proposée : 45 s, renouvelé toutes les 15 s. Une autre instance active non expirée → réponse `standby`.
  - `POST /v1/bot/instance/release` : libération à l'arrêt propre.
  - `POST /v1/bot/instance/heartbeat` : avec l'état.
- **Route Studio (installation appariée), lecture seule :** `GET /v1/studio/status/bot`. Elle se trouve hors du relais cockpit, qui ne relaie que des routes Lab.
- **Fichiers :**
  - nouveaux : `apps/core-api/src/bot-instance/service.ts`, `supabase/migrations/2026103113xxxx_bot_instance.sql` ;
  - à modifier : `apps/core-api/src/db/migration-scopes.ts` (portée `prod`), routes dans `apps/core-api/src/http/`, câblage dans `app.ts`.
- **Tests :**
  - premier bail accordé ; second refusé tant que le premier est vivant ;
  - reprise après expiration ; libération puis reprise immédiate ;
  - même `instance_id` après un redémarrage ;
  - deux demandes concurrentes : une seule gagne (verrou de ligne) ;
  - horloge injectée ;
  - route Studio refusée sans installation valide.
- **Risque de régression :** faible. Le changement est additif et ne touche aucune route existante. Un bot ancien qui n'utilise pas le bail continue de fonctionner, d'où l'ordre de bascule du lot 4.
- **Validation :** tests et `npm run check`. Après le déploiement, la route Studio répond `no_instance` tant que le bot du PC n'est pas mis à jour.

## Lot 2 — Bot : service autonome (P1)

**But :** un bot prêt pour un conteneur, qui n'agit que s'il détient le bail.

- **Au démarrage :** demander le bail.
  - Bail accordé : démarrer EventSub, chat, présence et exécuteurs, comme aujourd'hui.
  - Bail refusé : **mode attente**. Aucune connexion Twitch, aucun renouvellement de jeton ; nouvel essai toutes les 15 s, avec un journal lisible : « en attente : instance active ailleurs (pc, depuis …) ».
- **Bail perdu en cours de route** (réseau, Core injoignable plus longtemps que la durée du bail) : arrêt immédiat des consommateurs, puis retour en attente. Cela évite deux actifs après une coupure réseau.
- **Arrêt propre sur SIGTERM :** arrêter les consommateurs, vider les files durables, libérer le bail, puis sortir. Code de sortie 0 pour un arrêt demandé.
- **Journalisation :**
  - une ligne par événement, horodatée en UTC, avec un niveau (`info` / `warn` / `error`) et le module ;
  - **filtre de masquage** : jetons, `Authorization`, `client_secret` et `BOT_SECRET` ne sont jamais écrits, avec un test dédié ;
  - aucun compteur de messages viewers en clair au-delà de ce qui existe.
- **Image Docker :** `apps/twitch-bot/Dockerfile`, même modèle que `apps/core-api/Dockerfile` (`node:22-bookworm-slim`, utilisateur `node`).
  - Tous les fichiers d'état sont sous `/data`, à travers les variables existantes `TWITCH_TOKEN_FILE`, `TWITCH_BROADCASTER_TOKEN_FILE`, `*_OUTBOX_FILE` et `*_JOURNAL_FILE`.
  - `HEALTHCHECK` sur un fichier de vie (`/data/alive`) mis à jour à chaque renouvellement de bail, puisque le bot n'a pas de serveur HTTP.
  - `.dockerignore` exclut déjà `.twitch-tokens*.json` et `.env*`.
- **Fichiers :**
  - à modifier : `apps/twitch-bot/src/index.ts` (orchestration bail / attente, arrêt propre), `src/core-client.ts` (routes du bail), `src/config.ts` (`BOT_INSTANCE_ID` et `BOT_HOST`, avec des valeurs par défaut stables) ;
  - nouveaux : `src/instance-lease.ts`, `src/log.ts` (masquage), `apps/twitch-bot/Dockerfile`.
- **Tests :**
  - en attente, aucune connexion Twitch n'est ouverte (Twitch simulé) ;
  - bascule attente → active à l'expiration du bail adverse ;
  - perte du bail → consommateurs arrêtés ;
  - SIGTERM → bail libéré et files vidées ;
  - masquage des secrets ;
  - construction de l'image en local (`docker build`) et démarrage à blanc contre un Core local.
- **Risque de régression :** moyen, car le démarrage du bot change. Les modules eux-mêmes restent intacts. Les tests existants du bot (`npm test -w @raptoru/twitch-bot`) doivent passer à l'identique.
- **Validation :** conteneur local avec Core local et Twitch de test, puis bot réel uniquement au lot 4.

## Lot 3 — Studio : état réel des services (P1)

**But :** Studio montre l'état du bot et des services sans qu'il faille ouvrir Coolify.

- **Accueil de Studio (`apps/studio/web/src/studio-home.ts`) :** une carte « Services du live », avec un indicateur vert / orange / rouge et une phrase simple pour chaque élément :
  - **Core :** joignable, version ;
  - **Bot :** actif où (VPS / PC), depuis quand, dernier signe de vie ; EventSub et chat joints ; jetons Twitch valides ; une instance en attente éventuelle ;
  - **Économie :** mode canonique et drapeaux ;
  - **OBS :** connecté ou non (déjà connu de Studio).
- **Messages d'erreur avec l'action à faire.** Exemples :
  - « Bot hors ligne depuis 2 min — redémarrage automatique en cours ; si ça dure, Coolify → raptoru-bot → Redémarrer » ;
  - « Jeton Twitch de raptoru_ expiré — reconnecter dans Studio → Connexions Twitch ».
- **Fichiers :**
  - serveur Studio : client vers `GET /v1/studio/status/bot`, à côté du client cockpit existant de `apps/studio/server/src/` ;
  - interface : `studio-home.ts`, `studio-home.css`.
- **Tests :**
  - interprétation des états (instance active, en attente, aucune, signe de vie trop ancien, Core injoignable) ;
  - aucun secret affiché.
- **Risque :** faible, l'affichage est en lecture seule.
- **Validation :** Antoni, dans Studio. Il arrête le conteneur dans Coolify et vérifie que la carte passe au rouge avec le bon message, puis le redémarre.

## Lot 4 — Coolify : bascule PC → VPS sans double bot (P1)

**Configuration Coolify** (gestes d'Antoni dans l'interface ; le garde-fou bloque mes appels de déploiement) :

- **Application et image :** projet Raptoru 2.0, environnement `production`, nouvelle application **`raptoru-bot`**.
  - Dépôt et branche de `raptoru-core`, build pack Dockerfile, fichier `/apps/twitch-bot/Dockerfile`, répertoire de base `/`.
  - Déploiement automatique **désactivé**.
- **Réseau :** **aucun domaine, aucun port exposé.**
- **Stockage persistant :** un volume monté sur `/data`.
- **Journaux :** rotation Docker via les options d'exécution `--log-opt max-size=10m --log-opt max-file=5`, soit environ 50 Mo conservés.
- **Variables :**
  - celles de `.env.production`, valeurs jamais affichées : `TWITCH_ENABLED`, `CORE_API_URL`, `BOT_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_BROADCASTER_ID` et les drapeaux ;
  - les chemins `/data/...` ;
  - `BOT_HOST=vps`.
- **Démarrage initial :** l'application est créée **arrêtée** jusqu'à la bascule.

**Préparation sans risque :**

1. Lots 1 et 2 déployés. Le bot du PC passe à la version avec bail (`run-production.ps1`, identique) et détient le bail : Studio affiche « Bot actif : PC ».
2. Construction de l'image sur Coolify **sans démarrer** le conteneur. Si Coolify ne permet pas de construire sans démarrer : démarrage avec `TWITCH_ENABLED=false`, qui sort aussitôt sans rien connecter.

**Bascule, hors live, environ 10 min :**

1. Studio affiche « Bot actif : PC ».
2. Copier les fichiers de jetons du PC vers le volume `/data` du VPS, par `scp` dans le tunnel SSH, sans afficher leur contenu. Les files durables doivent être vides (`pending: []`) avant l'arrêt : le vérifier.
3. Arrêt propre du bot du PC (Ctrl+C) : le bail est libéré. Studio affiche « aucune instance ».
4. Démarrer `raptoru-bot` dans Coolify. Il obtient le bail, et Studio affiche « Bot actif : VPS ».
5. **Le PC ne garde plus de copie active des jetons.** Les fichiers sont renommés en `.vps-actif` pour qu'un lancement accidentel sur le PC tombe en mode attente, sans renouveler les jetons.
6. Tests de fonctionnement (ci-dessous), puis surveillance pendant un court live de test ou une soirée hors live.

**Retour arrière :**

1. Arrêter `raptoru-bot` dans Coolify : le bail est libéré.
2. Récupérer depuis `/data` les jetons **les plus récents** (le VPS les a peut-être renouvelés) et les remettre dans `apps/twitch-bot/` sur le PC.
3. Relancer `run-production.ps1`. Le bot du PC obtient le bail.

Si le VPS meurt sans libérer le bail, le PC prend le relais 45 s plus tard, sans intervention.

**Tests de fonctionnement et de non-régression après la bascule** (sans dépenser de Jetons, sauf avec les fonds de test) :

| Domaine          | Vérification                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Chat             | `!solde` (lecture)                                                                                                         |
| Daily            | `!daily` impossible hors live : on vérifie seulement la réponse « pas de live »                                            |
| Présence         | elle ne tourne qu'en live : à vérifier au premier live                                                                     |
| Points de chaîne | Couleur Cam par une vraie utilisation de raptoru_ : effet OBS reçu par Studio depuis le Core                               |
| Alertes          | un follow de test ou le bouton « Tester » de Studio                                                                        |
| Roue du Sub      | « Tester » dans Studio (gain marqué `test`)                                                                                |
| Mini-jeux        | `!slot` avec les fonds de test de `lecroupier_`, ou à 0 Jeton                                                              |
| Random Ban       | essai à blanc (`dry_run`) depuis Studio                                                                                    |
| Robustesse       | redémarrage du conteneur dans Coolify : reprise sous 1 min, aucune réponse en double, aucune perte dans les files durables |

**Dépendances qui restent sur le PC :**

- **Studio** sert les sources navigateur OBS (`127.0.0.1:4100`). Studio fermé = effets, TTS et Jeu des mots muets. C'est voulu : Studio est l'application du live.
  Option : lancer Studio au démarrage de Windows.
- **Reconnexion Twitch** (`twitch:auth`, rappel sur `localhost`) : reste un outil de maintenance du PC. Si une reconnexion est un jour nécessaire,
  il faut un geste guidé depuis Studio (lot 3) qui dépose les jetons sur le VPS. **Jamais un prérequis au live.**
- **Tunnel SSH :** utile seulement pour les audits. Il n'est pas nécessaire au live.
- `run-production.ps1` est conservé comme **mode de secours et de maintenance**, documenté, jamais comme prérequis.

## Lot 5 — Contrôles automatiques avant live (P1)

**But :** un bouton « Vérifier avant le live » dans Studio. Chaque ligne est verte ou rouge et dit quoi faire.

| Contrôle                                                                                                          | Source                                  |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Bot actif, une seule instance, EventSub et chat joints, signe de vie de moins de 30 s                             | lot 1                                   |
| Drapeaux du bot conformes au profil live (`CHAT_GAMES`, `CHAT_GAMES_OUTPUT`, `RANDOM_BAN`, `ALERTS_MODE=active`…) | état envoyé par le bot (lot 1)          |
| Économie canonique et les 3 drapeaux de crédit actifs                                                             | Core                                    |
| Daily : configuration aux paliers 500…2000                                                                        | Core                                    |
| Roue du Sub ON (l'incident I2)                                                                                    | `sw_settings`                           |
| Mini-jeux ON (l'incident I5) et sortie chat ON                                                                    | `mini_game_channels`, `cmd_channels`    |
| Points de chaîne : interrupteur général ON, règles actives = récompenses Twitch actives                           | `cp_settings`, `cp_rules`, `cp_rewards` |
| OBS connecté ; sources « R2 Effets », Jeu des mots, roue et alertes présentes avec la bonne adresse               | Studio, en local                        |
| Extension Production : la version servie appelle bien `core.raptoru.fr` (l'incident I4)                           | voir l'ambiguïté A6 : à confirmer       |

- **Fichiers :**
  - Core : route de lecture qui agrège les contrôles ci-dessus, `apps/core-api/src/studio/readiness.ts` (nouveau) ;
  - Studio : `studio-home.ts`, serveur Studio pour les contrôles OBS.
- **Tests :** chaque contrôle, en vert et en rouge.
- **Risque :** faible, tout est en lecture seule.
- **Validation :** Antoni coupe volontairement la roue, vérifie que la ligne passe au rouge, puis la réactive.

## Lot 6 — Fidélité : un seul bonus par renouvellement (P1)

**Règle proposée :** un **renouvellement** est l'ensemble des notifications Twitch qui décrivent **le même mois d'abonnement d'un même viewer**,
c'est-à-dire au plus **un** `channel.subscribe` non offert et **un** `channel.subscription.message`. **Un renouvellement donne un seul bonus.**

Une notification **rejoint** un renouvellement existant si les quatre conditions suivantes sont réunies :

1. même viewer (Twitch ID) ;
2. le renouvellement ne contient pas déjà une notification du même type (deux messages ou deux subscribes distincts = deux renouvellements) ;
3. aucun `channel.subscription.end` de ce viewer n'a été reçu entre les deux ;
4. l'écart entre les deux heures Twitch (`occurredAt`, jamais l'heure de réception) est inférieur à la **durée minimale d'un mois facturé Twitch (28 jours)**.

Cette borne n'est pas arbitraire. Un vrai renouvellement suivant ne peut pas arriver avant un mois facturé : la règle ne peut donc jamais
absorber le bonus du mois suivant. Dans le cas limite d'un message partagé après le 28ᵉ jour, elle **paie** au lieu de supprimer.

Sinon, la notification ouvre un nouveau renouvellement et donne droit à son bonus.

- **Ordre et rejeu :**
  - le **premier** événement traité ouvre le renouvellement et donne le bonus, quel que soit l'ordre ;
  - le second est enregistré dans `loyalty_rewards` avec `status='excluded'` et `breakdown.excluded='same_renewal'`, plus le lien vers la récompense payée (même mécanisme que `before_cutover`) ;
  - un rejeu d'un même identifiant d'événement reste une simple répétition (clé `twitch:<type>:<eventId>` inchangée) ;
  - verrou par viewer (verrou de ligne ou verrou consultatif) pour que deux notifications simultanées ne paient pas deux fois.
- **Inchangé :**
  - `subgift` : c'est l'offreur qui est récompensé ;
  - destinataire d'un sub offert : déjà exclu (`gift_recipient`) ;
  - bits, dons, follows ;
  - alertes et Roue du Sub : autre chemin EventSub, non touché.
- **Fichiers :**
  - `apps/core-api/src/loyalty/engine.ts` (`eventReward`, transaction) ;
  - migration Production additive : journal `loyalty_sub_events` (viewer, type, identifiant d'événement, heure Twitch), indispensable pour la condition 3 ;
  - `apps/twitch-bot/src/loyalty-events.ts`, seulement si `channel.subscription.end` doit passer son heure Twitch, à vérifier ;
  - nouveau test `apps/core-api/test/loyalty-renewal.test.ts`.
- **Tests :**
  - **ordre :** sub puis resub, et resub puis sub → 1 bonus ;
  - **rejeu :** rejeu de chacun → aucun nouveau bonus ;
  - **retard :** resub reçu 2 h après, via la file durable (heure Twitch d'origine) → 1 bonus ;
  - **abonnement interrompu :** sub, fin d'abonnement, sub → 2 bonus ;
  - **mois suivant :** resub du mois N puis du mois N+1 → 2 bonus ; sub puis resub 30 jours après → 2 bonus ;
  - **cadeaux :** destinataire d'un cadeau qui partage ensuite son propre resub → 1 bonus (le resub) ; cadeau offert par un viewer qui se réabonne → 2 bonus (subgift + sub) ;
  - **viewers différents, même seconde** → 2 bonus ;
  - **concurrence :** les deux notifications du même viewer en parallèle → 1 bonus ;
  - **modes :** `shadow`, `preview` et `before_cutover` inchangés ;
  - **Prime / T1 / niveaux différents :** voir l'ambiguïté A2 ;
  - **non-régression :** tous les tests existants de fidélité, d'alertes et de la Roue du Sub, à l'identique.
- **Risque de régression :** moyen, car le chemin touche l'argent. Il est limité aux sources `sub` et `resub`.
- **Validation :** tests ; rejeu du cas Silverriusss (les deux identifiants réels) sur une base locale, qui doit donner 1 bonus ; Antoni valide.
  **Les 2 000 de Silverriusss ne sont pas repris.**

## Lot 7 — Tour de roue de Wenuyr (P1, tirage sur ta confirmation)

**Mécanisme officiel conservé :** on reprend **la ligne existante** `sw_spins 2e3e4a3d…` (clé de l'événement d'origine), au lieu d'en créer une nouvelle.

- **Nouvelle action « Attribuer le tour manqué » (`SubWheelService.grantMissed(spinId, actor, note)`)**, n'acceptant qu'une ligne :
  - `source='twitch'`, `status='ignored'`, `reason='disabled'`, `award_status='none'` ;
  - avec un Twitch ID ;
  - type `sub` ou `resub`.
- **Dans une seule transaction (verrou de ligne) :**
  - tirage `randomInt(subWheelLayout(months).length)`, le même que `admit()`, avec les mêmes probabilités et la même grille (34 mois, T3) ;
  - `amount = subWheelAmount(...)` ;
  - `award_status='pending'`, puis crédit par `credit()`, avec la clé `spin_id` (idempotente côté portefeuille) ;
  - note `« tour manqué attribué à la main (audit I2) par … le … »` et trace dans l'audit de modération.
- **Protection contre le second tirage :**
  - un second appel échoue (`409 not_missed`) ;
  - un rejeu de l'événement Twitch tombe sur `unique (channel_id, event_key)` et ne tire jamais ;
  - aucune nouvelle ligne n'est créée.
- **Exclu :** aucun montant arbitraire, aucun faux abonnement, rien sans le tirage.
- **Fichiers :**
  - `apps/core-api/src/sub-wheel/service.ts` ;
  - une route Studio protégée (installation appariée) ;
  - un bouton dans `apps/studio/web/src/sub-wheel-view.ts`, sur les tours `ignored`.
- **Tests :**
  - tirage avec un générateur injecté ;
  - montant égal à la grille ;
  - un seul crédit ;
  - second appel refusé ;
  - rejeu de l'événement d'origine sans tirage ;
  - lignes `test`, `simulation`, `shown` et sans Twitch ID refusées ;
  - mode non canonique : aucun crédit.
- **Risque :** faible, la nouvelle action est isolée.
- **Validation :** essai complet sur une base locale ; préparation en Production en lecture seule (« la ligne est éligible ») ; **puis tirage réel seulement après ton GO**.
  L'animation est à préciser (ambiguïté A1).

## Lot 8 — PC en mode de secours : journal et preuves de plantage (P1, petit)

- **`run-production.ps1` :**
  - sortie du bot redirigée vers `logs\bot-AAAA-MM-JJ.log`, avec rotation à 14 fichiers ;
  - le code de sortie est traduit en clair (`0xC0000409`, `0xC000013A` = Ctrl+C) ;
  - Node lancé avec `--report-on-fatalerror --report-uncaught-exception --report-directory=logs\reports`.
- **Capture d'un vidage mémoire (WER LocalDumps) pour `node.exe`, en mode administrateur :** clé de registre donnée à Antoni. Un `0xC0000409` (arrêt brutal) contourne le
  rapport de Node : seul le vidage Windows le capture.
- **Analyse du crash :** si un vidage apparaît, on l'examine (pile, version de Node). Sur le VPS (Linux, Node 22), on compare la stabilité.
  **Aucune cause attribuée sans preuve.**
- **Test :** lancement à blanc avec `TWITCH_ENABLED=false` ; vérification du fichier de journal et de l'absence de secret.
- **Risque :** très faible, seul le script change.

## Lot 9 — Ban aléatoire : fiche mise à jour à la fin (P2)

- **Correction :** quand une `rb_requests` atteint un état final (`confirmed`, `failed`, …), la fiche `cp_redemptions` liée est mise à jour **dans la même transaction**.
  Cela remplace la mise à jour faite seulement à l'ouverture de l'onglet Studio (`settleRandomBans` dans `state()`, qui reste comme rattrapage).
- **Fichiers :** `apps/core-api/src/random-ban/service.ts`, `apps/core-api/src/channel-points/service.ts`, câblage dans `app.ts`.
- **Tests :**
  - Ban aléatoire confirmé → fiche `done`, sans ouvrir l'onglet ;
  - échec → fiche `failed` ;
  - rejeu de l'état final → aucun double effet.
- **Les 5 fiches du 20/10 :** le rattrapage existant les corrigera dès la prochaine ouverture de l'onglet Points de chaîne de Studio. C'est une simple mise à jour d'affichage, qui ne touche
  aucun Jeton : je te le signale pour qu'elle ne te surprenne pas.

## Lot 10 — Fonds de test : compte technique (P2)

- **Nouvelle table Production additive `technical_accounts`** (Twitch ID, libellé, motif, auteur, date). Inscrire `lecroupier_` demande **ta validation**, car c'est une écriture de configuration, pas une écriture portefeuille.
- **Exclusions :**
  - `/v1/wallet/leaderboard` (donc le « Classement » de l'extension) ;
  - le classement Daily ;
  - les statistiques de distribution des futurs audits.
- **Ce qui ne change pas :** la **comptabilité générale reste complète**. Le total des portefeuilles inclut toujours ces fonds, affichés séparément (« dont fonds de test : 43 460 »).
- **Grand livre :** les écritures 1657, 1658 et 1670 restent telles quelles. Elles sont documentées dans l'audit (§ 14.3) et reconnaissables par le compte technique.
- **Gains passifs du bot (+20 par tic) :** voir l'ambiguïté A3.
- **Fichiers :** `apps/core-api/src/wallet/wallet-service.ts` (`leaderboard`), `apps/core-api/src/daily/daily-service.ts` (`leaderboard`), migration, tests.
- **Risque :** faible.

## Lot 11 — Récompenses Twitch « unfulfilled » (P2)

1. **Diagnostic en lecture seule**, fait par le bot hébergé, qui est le seul détenteur des jetons : cela évite qu'un script parallèle renouvelle les jetons.
   - lecture Helix des récompenses gérables par l'application Raptoru (`only_manageable_rewards=true`) ;
   - nombre d'utilisations `UNFULFILLED` par récompense ;
   - affichage du résultat dans Studio.
2. **Ensuite, selon ta règle (ambiguïté A5) :** marquer « fulfilled » ce qui a été exécuté, et annuler (points rendus) ce qui a échoué. Ce n'est possible que pour les
   récompenses créées par l'application Raptoru.

## Lot 12 — Volume du Jeu des mots (P2, confort)

- **Comportement :**
  - le réglage `volume` (0 à 100, défaut 100) est conservé par le serveur Studio ;
  - il est envoyé à chaque événement à la source OBS (`audio.volume = volume / 100`) et appliqué dès le mot suivant, sans recharger OBS ;
  - un curseur dans la carte Jeu des mots ;
  - aucun autre son n'est touché.
- **Fichiers :** `apps/studio/server/src/word-game/runtime.ts`, `apps/studio/server/word-game-player/player.js`, `apps/studio/web/src/word-game-view.ts` et `word-game.ts`.
- **Tests :**
  - réglage conservé après un redémarrage ;
  - valeur hors limites refusée ;
  - volume présent dans l'événement envoyé.
- **Risque :** très faible. La source OBS n'a besoin d'être rechargée qu'une fois.

## Lot 13 — Trou de présence après un changement de bot (P3)

Après une reprise du bail, le nouveau worker pourrait reprendre la référence du précédent au lieu de refaire un cycle de référence. Le gain est d'environ 2 minutes par changement.
C'est à reprendre seulement si les changements de bot restent fréquents. Avec le bot sur le VPS, ils deviennent rares.

---

## 2. Décisions d'Antoni (21/10/2026, définitives)

| #   | Décision                                                                                                                                                                                                                                                  | Effet sur le plan                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Wenuyr reçoit son tour manqué, **animé dans OBS au prochain live**, avec les probabilités normales, lié à l'événement Twitch d'origine, sans double attribution                                                                                           | Lot 7 : la ligne `ignored` est tirée et mise en file d'animation au moment où Studio la déclenche (pas de filtre « trop tard » pour ce tour), crédit à l'affichage par le mécanisme normal ; jamais sans ton GO |
| A2  | **Un seul bonus** par renouvellement ; plusieurs niveaux signalés pour le même renouvellement : on retient le **niveau le plus élevé réellement confirmé**. Les 2 000 de Silverriusss ne sont pas repris                                                  | Lot 6 : si le niveau le plus élevé arrive en second, seul le **complément** est versé (une fois) ; sinon le second est `excluded: same_renewal`                                                                 |
| A3  | `lecroupier_` est un **compte technique** : exclu des gains passifs et du classement public. Portefeuille et 50 000 historiques conservés, aucune correction rétroactive                                                                                  | Lot 10 : compte technique + `loyalty_exclusions` (mécanisme existant) ; les deux inscriptions sont des écritures de configuration Production, faites seulement avec ton accord au moment du déploiement         |
| A4  | **Réseau Docker privé** entre le bot et le Core, si compatible avec Coolify                                                                                                                                                                               | Lot 4 : `CORE_API_URL=http://<uuid de raptoru-core>:3000` sur le réseau Coolify, à vérifier depuis le conteneur du bot avant la bascule ; repli : `https://core.raptoru.fr`                                     |
| A5  | **Pas de validation automatique.** Exécution confirmée → la récompense **reste « unfulfilled »** (validation manuelle) ; **échec définitif** → remboursement des points (cancel), **une seule fois** ; jamais sur erreur temporaire ou résultat incertain | Lot 11 : remboursement uniquement sur les états finaux `failed` sans ambiguïté, clé d'idempotence par redemption ; aucune action sur `done`, `pending`, `uncertain`                                             |
| A6  | Contrôle avant live de l'extension : **build réellement servi, environnement Production, API cible et connectivité**                                                                                                                                      | Lot 5 : marqueur de build envoyé par l'extension (environnement, `apiBase`, empreinte du ZIP) + test de connectivité depuis Studio                                                                              |
| A7  | Studio propose le **démarrage automatique avec Windows**, activable / désactivable depuis Studio                                                                                                                                                          | Lot 3 (réglage Studio, option désactivée par défaut)                                                                                                                                                            |
| A8  | Fermeture accidentelle de la fenêtre PowerShell **confirmée**. Aucune heure exacte non prouvée ne lui est attribuée, et elle n'est pas confondue avec le plantage `0xC0000409`                                                                            | Audit § 14.1 corrigé                                                                                                                                                                                            |
| A9  | Aouh est la **supermodératrice** : tous les droits (wallet, permissions, sensitive) sont voulus                                                                                                                                                           | Rien à corriger (audit § 14.5)                                                                                                                                                                                  |

## 3. Ce qui n'est pas fait sans ton accord explicite

- **Déploiements et bot :**
  - aucun déploiement Core ou release Studio ;
  - aucune création ou démarrage de `raptoru-bot` dans Coolify ;
  - aucun arrêt du bot actuel ;
  - aucune seconde instance Production.
- **Opérations économiques :**
  - aucun tirage réel pour Wenuyr ;
  - aucune reprise des 2 000 de Silverriusss ;
  - aucune écriture sur le portefeuille de `lecroupier_`.
- **Données :** aucune écriture de configuration en Production (inscription du compte technique, exclusion de la fidélité).

---

## 4. Avancement — lots 1 et 2 (21/10/2026 : implémentés et testés en local, NON déployés)

### Ce qui est fait

- **Core (lot 1) :**
  - migration Production additive `20261031130000_bot_instance.sql` (`bot_lease`, `bot_instances`), portée `prod` ;
  - service `apps/core-api/src/bot-instance/service.ts` : bail de 45 s, renouvelé toutes les 15 s, verrou consultatif, attente enregistrée, libération ;
  - routes `apps/core-api/src/http/bot-instance-routes.ts` :
    - `POST /v1/bot/instance/lease` et `/release` (secret du bot) ;
    - `GET /v1/studio/status/bot` (installation Studio appariée, lecture seule, aucun secret) ;
  - schémas partagés `packages/schemas/src/bot-instance.ts` : seuls des booléens et le mode des alertes sont acceptés comme indicateurs, toute valeur ressemblant à un secret est refusée.
- **Bot (lot 2) :**
  - `apps/twitch-bot/src/instance-lease.ts` : **rien ne touche Twitch, pas même un renouvellement de jeton, avant le bail** ;
  - attente journalisée une fois par changement ;
  - bail perdu (une autre instance nommée détentrice) → arrêt immédiat, sortie 75, et le superviseur le relance en attente ;
  - **arrêt de sécurité (revue du 21/10) :** sans renouvellement accordé pendant 35 s (bail de 45 s moins 10 s de marge), comptées depuis l'**envoi** de la dernière demande accordée, le bot s'arrête de lui-même (sortie 75), sans libérer le bail. Il s'arrête donc toujours avant que le Core puisse attribuer le bail à une autre instance ;
  - Core sans API de bail (404) → **le bot attend**, sans aucune connexion Twitch. Le repli permissif n'existe qu'avec `BOT_LEASE_OPTIONAL=true`, refusé à la configuration si `CORE_API_URL` n'est pas un Core local (`localhost`, `127.0.0.1`, `[::1]`) ;
  - chaque appel bot → Core porte l'en-tête `x-raptoru-bot-instance`. Le Core refuse en `409 not_lease_holder` toute route bot venant d'une autre instance tant qu'un bail est vivant ;
  - arrêt propre (SIGTERM, SIGINT, autorisation perdue) : consommateurs arrêtés, bail libéré (≤ 3 s), puis sortie. Tout appel attend le **même** arrêt : aucun code ne s'exécute après ;
  - journalisation `apps/twitch-bot/src/log.ts` : heure UTC et niveau sur chaque ligne, secrets configurés masqués par valeur, jetons et `client_secret` masqués par forme ;
  - santé envoyée au Core : EventSub du bot et du diffuseur joints, jeton diffuseur, indicateurs (`connected()` ajouté à `runEventSub`) ;
  - nouvelles variables `BOT_HOST` (défaut `pc`), `BOT_INSTANCE_ID` (défaut `hôte-machine-pid` : un conteneur garde son nom et le PID 1), `BOT_ALIVE_FILE` ;
  - image `apps/twitch-bot/Dockerfile` :
    - `node:22-bookworm-slim`, utilisateur `node` ;
    - état sur le volume `/data` (jetons, files, journaux) ;
    - `HEALTHCHECK` = « le Core a répondu au bail il y a moins de 90 s », titulaire **ou** en attente, pour qu'un déploiement en continu ne se bloque pas ;
  - `.dockerignore` : fichiers d'état du bot exclus.

### Revue ciblée du 21/10 : deux scénarios

**1. Coupure réseau prolongée, expiration du bail, puis reprise par une autre instance.**

- **Défaut prouvé avant correction :** sans renouvellement, le bot actif « continuait » sans limite. Après l'expiration du bail (45 s) et sa reprise par une autre
  instance, l'ancienne pouvait encore traiter les événements Twitch et répondre dans le chat jusqu'au retour du réseau, puis jusqu'à son renouvellement suivant.
- **Correction, en deux protections indépendantes :**
  - **côté bot (`instance-lease.ts`) :** un minuteur d'arrêt, réarmé à chaque renouvellement accordé, se déclenche 35 s après l'**envoi** de la
    dernière demande accordée. Le Core ayant accordé le bail au plus tôt à cet envoi, celui-ci court jusqu'à au moins + 45 s : l'ancienne
    instance est arrêtée au moins 10 s avant qu'une autre puisse l'obtenir, quelle que soit la latence. L'arrêt stoppe EventSub, le chat, la présence et les
    exécuteurs, puis sort en 75 sans libérer le bail. Ses files durables restent sur disque et ne sont rejouées qu'après un nouveau bail, côté Core,
    de façon idempotente ;
  - **côté Core (`server.ts`, `BotInstanceService.writer`) :** tant qu'un bail est vivant, toutes les routes bot, hors routes du bail, refusent en `409`
    une autre instance, ou un bot qui ne s'identifie pas. Les effets économiques d'une instance non titulaire sont donc refusés à la source,
    même en cas de bug du bot. Sans bail vivant, rien n'est refusé : c'est la compatibilité avec le bot actuel du PC tant qu'il n'est pas mis à jour.
- **Effet secondaire assumé :** une coupure du Core de plus de 35 s arrête le bot, qui repart en attente et reprend dès que le Core répond. Les
  événements Twitch arrivés pendant la coupure ne sont plus mis en file par cette instance. D'où la règle : **ne jamais redéployer le Core pendant un live**.

**2. Core Production sans API de bail (404).**

- **Défaut prouvé avant correction :** un 404 faisait démarrer le bot sans protection.
- **Correction :**
  - un 404 est une erreur : le bot reste en attente, sans aucune connexion Twitch, avec le message « Core sans API de bail (404) : déployer le Core à jour avant ce bot » ;
  - un 404 **en cours de fonctionnement** (Core revenu à une version antérieure) déclenche l'arrêt de sécurité ;
  - le repli permissif n'existe qu'avec `BOT_LEASE_OPTIONAL=true`, que `loadConfig` refuse si `CORE_API_URL` n'est pas un Core local (adresse
    publique, nom Docker interne, IP du réseau local : refusés).

**Durcissement découvert pendant la revue :** une erreur dans le calcul de la santé envoyée au Core faisait échouer les renouvellements, et donc arrêter le bot.
Chaque sonde de santé vaut désormais `null` en cas d'erreur.

### Tests exécutés

| Suite                                                                               | Résultat                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core complet (PGlite)                                                               | **838 réussis**, 52 sautés (intégration sans base)                                                                                                                                                                                                                                                                                                                                                                                            |
| Core, intégration sur PostgreSQL réel (base jetable `raptoru_lot1_test`, supprimée) | **18/18, 51/51** (après la revue) ; avant, un passage à 17/18 par un fichier interrompu sans échec d'assertion                                                                                                                                                                                                                                                                                                                                |
| Bot complet                                                                         | **25 fichiers, 230 tests réussis**                                                                                                                                                                                                                                                                                                                                                                                                            |
| Nouveaux tests                                                                      | `apps/core-api/test/bot-instance.test.ts` (10, dont le refus serveur `409`), `apps/twitch-bot/test/instance-lease.test.ts` (12 : attente, 404 refusé, repli de développement, perte, arrêt de sécurité, réarmement, réponse lente, Core revenu en arrière), `config-lease.test.ts` (3), `log.test.ts` (3), `eventsub.test.ts` (+1), `lab-chat-auth-wiring.test.ts` (+2 : en-tête d'instance, arrêt de sécurité du bot principal en sortie 75) |
| Type-check du dépôt                                                                 | 8/8                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Lint et format                                                                      | propres sur les fichiers modifiés                                                                                                                                                                                                                                                                                                                                                                                                             |
| Image Docker, faux Core local, **aucun jeton, aucun appel Twitch**                  | attente (un seul message), `healthy` en attente, `docker stop` → bail libéré, sortie 0 en 0,55 s ; bail accordé → `no_token` → bail libéré, sortie 78. Conteneur, volume et image supprimés ensuite                                                                                                                                                                                                                                           |

Tests existants mis à jour, sans changer leur intention :

- `migration-scopes.test.ts` et `migration-main-core.integration.test.ts` : nombres figés, une migration Production en plus (25 → 26, 29 → 30, 38 → 39) ;
- `lab-chat-auth-wiring.test.ts` : le faux Core accorde le bail ; la sortie 78 du bot principal passe désormais après la libération du bail ;
- `runtime.test.ts` : nouvelle variable `BOT_HOST`.

### Risques restants

- **Ordre de déploiement :** **Core d'abord**. Un bot de cette version contre l'ancien Core **reste en attente** et ne se connecte pas à Twitch. Il ne faut donc
  **pas** relancer le bot du PC avec cette version avant le déploiement du Core. Le bot actuel (ancienne version, déjà lancé) n'est pas concerné.
- **Bot sur le PC après un plantage :** le nouveau processus a un autre PID, donc il attend jusqu'à 45 s que le bail expire. Sur le VPS, le même conteneur garde son identité et reprend aussitôt.
- **Coupure entre le bot actif et le Core de plus de 35 s :** le bot s'arrête (voir la revue). Les événements Twitch arrivés pendant la coupure peuvent être perdus
  pour cette instance. Une coupure plus courte ne change rien.
- **Mise en veille du PC (non vérifié) :** je n'ai pas vérifié si les minuteurs de Node comptent le temps de veille sous Windows. Au pire, au réveil, l'ancien bot
  tourne encore jusqu'à son renouvellement suivant (15 s au plus), qui l'arrête si une autre instance a pris le bail. Pendant ce temps, le Core refuse en
  `409` toutes ses routes bot, donc aucun effet économique. Ses éventuels messages directs dans le chat ne sont couverts que par cette fenêtre de 15 s. Sur le VPS,
  pas de veille.
- **Bot actuel du PC (sans l'en-tête), une fois qu'une autre instance tient un bail :** ses écritures sont refusées en `409`. C'est voulu (c'est la
  protection), mais il faut l'arrêter dès que le bot du VPS est actif.
- **`TWITCH_ENABLED=false` ou un jeton manquant (sortie 0 ou 78) :** Docker relance en boucle, alors que le superviseur PowerShell s'arrêtait. Le problème reste visible (Coolify, journaux, Studio au lot 3), mais il n'y a pas d'arrêt définitif automatique.
- **Volume `/data` :** créé par l'image avec l'utilisateur `node`. Si Coolify monte un dossier de l'hôte appartenant à `root`, il faut corriger le propriétaire une fois (`chown 1000:1000`).
- **Réseau Docker privé (A4) :** pas encore vérifié sur le VPS (lot 4).
- **Plantage `0xC0000409` :** toujours inexpliqué (lot 8).

### Validation avant déploiement (par Antoni)

1. Relire le diff des lots 1 et 2 ; en local, `npm run check`.
2. **Déployer le Core** (migration 39, additive) **hors live**. Vérifier `GET /ready` et que la route Studio répond `{"state":"none"}`. Vérifier aussi que le
   bot actuel du PC (ancienne version, sans bail) continue de fonctionner, par exemple `!solde` : sans bail vivant, rien ne lui est refusé.
3. Reconstruire le bot du PC (`npm run build -w @raptoru/twitch-bot`) et le relancer avec `run-production.ps1`. Le journal doit afficher `bail obtenu : cette instance est le bot actif`, et le statut Studio du Core `active` avec `host: pc`.
4. Lancer une seconde fois `run-production.ps1` dans une autre fenêtre. Le second bot doit rester `en attente … aucune connexion Twitch`, puis être fermé. C'est le test anti-double bot.
5. Seulement ensuite : lot 3 (affichage Studio), puis lot 4 (conteneur VPS en attente, bascule).

**Suite complète du dépôt (`npm run check`) :**

- lint : propre ;
- format : seul `docs/LEGACY_DATA_MIGRATION_AUDIT_2026-10.md` est signalé, un document privé exclu de git (`.git/info/exclude`, du 16/10), que je n'ai pas modifié ;
- type-check : 8/8 ; build : 8/8 ;
- Studio serveur, lancé par Turbo : 1 test instable sous charge à chaque passage, jamais le même (`alerts-twitch-chain`, `brb`), qui passe 3 fois sur 3 seul. Un passage a aussi vu un processus de test Vitest s'arrêter avec le code **`0xC0000409`** (3221226505). C'est le plantage Windows connu du projet, et le même code que le bot le 20/10 : un indice pour le lot 8 (Node v24.15 sur ce PC), pas une preuve ;
- Studio n'utilise pas le code modifié (le Core Lab a son propre serveur). Les 14 fichiers Studio qui utilisent le serveur de Production passent (144 tests).
