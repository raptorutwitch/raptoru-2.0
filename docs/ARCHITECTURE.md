# Architecture actuelle

État au **24/10/2026** (après la bascule du 20/10 et le déploiement du Core `0f753c1`). Spécification d'origine (vision,
principes, bus d'événements, idempotence, sécurité) : [`Raptoru Studio — Infrastructure Spec.md`](../Raptoru%20Studio%20—%20Infrastructure%20Spec.md).
Versions déployées et prochaine action : [REPRISE.md](REPRISE.md). Procédures : [OPERATIONS.md](OPERATIONS.md).

**Objectif final** : piloter tout le stream depuis Raptoru Studio. Règle de partage :
**le Core décide, le bot parle à Twitch, Studio pilote OBS et affiche, l'extension et le site parlent aux viewers.**

## 1. Composants

| Composant            | Code                               | Où il tourne                                                                                              | Responsabilité                                                                                                                                                                                                                                                                                                                                      | Ne fait jamais                                     |
| -------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Core API**         | `apps/core-api`                    | Coolify `raptoru-core` sur le VPS (`https://core.raptoru.fr`), base PostgreSQL 17 `raptoru-prod-postgres` | vérité de toutes les données : Wallet canonique (Jetons, crédits TTS / Soundboard), Daily, fidélité / présence, Tombola, Jeu des mots, Roulette / Slot / Duel, Commands V2 (`cmd_steps`), Points de chaîne, Random Ban, Roue du Sub, alertes, modération D4, Caution, Votekick (et ses réglages), frontière extension `/v1/ext`, bail du bot unique | parler à OBS                                       |
| **Bot LeCroupier_**  | `apps/twitch-bot`                  | Coolify `raptoru-bot`, conteneur sur le VPS, volume `/data` (`raptoru-bot-data`)                          | seul processus EventSub + chat : lit le chat et les événements (subs, bits, follows, points), les transmet au Core, exécute les actions Twitch décidées par le Core (réponses, timeouts Random Ban / Votekick, levées Caution) ; un seul bot actif (bail Core, auto-fencing)                                                                        | décider d'une règle métier ou d'un solde           |
| **Raptoru Studio**   | `apps/studio/{desktop,server,web}` | PC d'Antoni (Electron, serveur local `127.0.0.1:4100`), profil Production appairé au Core                 | console du streamer ; suit les files du Core et exécute localement : OBS (obs-websocket), lecteur d'effets, TTS, Soundboard, Bonk, Tombola, Jeu des mots (son), alertes V2, Votekick (overlay, mute du streamer, son de lancement), Centre de contrôle, supervision                                                                                 | décider d'un verdict, d'un débit ou d'une sanction |
| **OBS**              | —                                  | PC                                                                                                        | rendu du stream ; la scène **« Alerte complète »** est superposée à toutes les scènes par le **Downstream Keyer** et porte les sources Studio (`Alertes (V2)`, `Effets`, `TTS v2`, Tombola, `Bonk v2`, `Jeu des mots (SON)`, Votekick)                                                                                                              | —                                                  |
| **Extension Twitch** | `apps/twitch-extension`            | hébergée par Twitch (chaîne `raptoru_`, mono-chaîne)                                                      | interface viewer → Core `/v1/ext` (TTS, Soundboard, Bonk, Tombola, modération, Jetons) ; publiée à la main par Antoni dans la console Twitch                                                                                                                                                                                                        | garder un état faisant autorité                    |
| **viewer-web**       | `apps/viewer-web`                  | —                                                                                                         | site public viewer : **non commencé** (squelette)                                                                                                                                                                                                                                                                                                   | —                                                  |
| **Schémas**          | `packages/schemas`                 | bibliothèque                                                                                              | contrats Zod partagés (requêtes / réponses Core)                                                                                                                                                                                                                                                                                                    | logique métier                                     |
| **Migrations**       | `supabase/migrations`              | appliquées par le Core (`MIGRATION_SCOPE`)                                                                | schéma SQL versionné ; jumeaux `_lab` pour le Lab ; listes déclarées dans `apps/core-api/src/db/migration-scopes.ts`                                                                                                                                                                                                                                | —                                                  |

Environnements : **Production** (ci-dessus) ; **staging** `raptoru-core-staging` (`core-staging.raptoru.fr`, branche
`feat/compact-video-port`, Node non épinglé : décision en attente) ; **Lab** = Core local + simulateurs lancés par
Studio en développement (`npm run studio`), sans Twitch, OBS ni services de Production.

## 2. Flux principaux

- **Chat → effet** : Twitch → bot (EventSub / chat) → Core (règle, débit Jetons, idempotence) → réponse chat via
  `cmd_steps` → bot ; si un effet OBS est nécessaire, le Core le met en file → Studio le réclame, l'exécute, rend compte.
- **Extension → effet** : viewer → extension → Core `/v1/ext` (JWT Twitch) → file → Studio → OBS.
- **Points de chaîne** : rédemption Twitch → bot → Core (règle Raptoru) → file OBS → Studio (exécuteur typé, lecteur
  d'effets) ; Twitch reste maître des récompenses (lecture seule pour Raptoru).
- **Votekick** : `!votekick` → Core (vote, durée lue dans `votekick_settings`, verdict) → bot (timeout) ; mute du
  streamer et overlay → Studio (suivi toutes les 400 ms) → OBS (« Micro », filtres Votekick).
- **Supervision** : Studio lit l'état de ses modules et du bot (bail Core) → bandeau et notifications.

## 3. Ce qui reste externe

| Système                     | Rôle restant                                                                                             | Remarque                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| StreamElements              | dons ; affichage du chat dans OBS (ChatReact, Boîte de chat, Chatbox Dessin)                             | **n'est plus** la source des Jetons (points SE gelés le 20/10)                                                                                             |
| Wizebot                     | Emote only, level up                                                                                     | toléré                                                                                                                                                     |
| Twitch                      | récompenses de points de chaîne, comptes et droits (`lecroupier_` : modération ; `raptoru_` : diffuseur) | droits détaillés : [TWITCH_OAUTH.md](TWITCH_OAUTH.md)                                                                                                      |
| Coolify 4.4.7 / VPS Contabo | hébergement Core, bot, base, staging, sauvegardes                                                        | auto-deploy désactivé ; déploiement par script ([OPERATIONS.md](OPERATIONS.md))                                                                            |
| OBS + plugins               | Move Transition 3.2.1 (Audio Move), shaders Votekick                                                     | réglages de référence : [BACKUPS.md](BACKUPS.md) § 6                                                                                                       |
| SAMMI                       | **abandonné** (débranché le 20/10, ne jamais réactiver)                                                  | ses comportements servent seulement de référence de compatibilité ; des sources OBS historiques inertes subsistent (`Alerte (Sammi)`, `Micro (Obsolète)`…) |

## 4. Contraintes de Production

- Toute action de Production (push, déploiement, migration, flag, variable, redémarrage, installation Studio,
  modification OBS, remboursement / ajustement Wallet, sanction hors test consenti) exige le **GO explicite d'Antoni**.
- Ordre : migrations → Core → bot (le bot n'est déployé qu'une fois le Core sur le SHA cible). Jamais deux bots.
- Couper une fonction : ses deux flags (Core + bot) à `false`, puis redémarrage.
- Jetons, droits, transactions : tests de concurrence, d'idempotence et de permissions (PostgreSQL réel si verrous).
- Studio installé lit ses données dans le checkout principal (`dataRoot`) : voir [BACKUPS.md](BACKUPS.md) § 1.

## 5. Documents de référence par module

Les documents de module sont référencés par des commentaires du code : **ne pas les déplacer**.

| Module                                | Document                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Économie / Wallet / migration SE      | [ECONOMY_MIGRATION.md](ECONOMY_MIGRATION.md)                                                                                                                                                                 |
| Commands V2                           | [COMMANDS_V2_STATUS.md](COMMANDS_V2_STATUS.md), [CHAT_COMMANDS.md](CHAT_COMMANDS.md)                                                                                                                         |
| Modération D4                         | [moderation-v2-d4-parity.md](moderation-v2-d4-parity.md)                                                                                                                                                     |
| Tombola                               | [tombola-v2-parity.md](tombola-v2-parity.md)                                                                                                                                                                 |
| Jeu des mots · Roulette / Slot · Duel | [WORD_GAME_PARITY.md](WORD_GAME_PARITY.md) · [ROULETTE_SLOT_PARITY.md](ROULETTE_SLOT_PARITY.md) · [DUEL_PARITY.md](DUEL_PARITY.md)                                                                           |
| Bonk                                  | [BONK_VNEXT_AUDIT_2026-10.md](BONK_VNEXT_AUDIT_2026-10.md) (+ provenance [bonk-lab.md](bonk-lab.md))                                                                                                         |
| Alertes Twitch                        | [TWITCH_ALERTS_PARITY_2026-10.md](TWITCH_ALERTS_PARITY_2026-10.md)                                                                                                                                           |
| Points de chaîne · lecteur d'effets   | [CHANNEL_POINTS_V1.md](CHANNEL_POINTS_V1.md) · [EFFECTS_PLAYER.md](EFFECTS_PLAYER.md)                                                                                                                        |
| Random Ban                            | [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md)                                                                                                                                                                         |
| Roue du Sub                           | V2 (en Production) : [SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md) (livraison, états, retour arrière) · [SUB_WHEEL_V2_PLAN.md](SUB_WHEEL_V2_PLAN.md) (conception) ; V1 : [SUB_WHEEL.md](SUB_WHEEL.md) |
| Votekick · Caution                    | [VOTEKICK_V2.md](VOTEKICK_V2.md) · [CAUTION.md](CAUTION.md)                                                                                                                                                  |
| Centre de contrôle · bot unique       | [CONTROL_CENTER.md](CONTROL_CENTER.md) · [PLAN_POST_LIVE_2026-10-21.md](PLAN_POST_LIVE_2026-10-21.md) (lots 1–4)                                                                                             |
| Comptes Twitch / OAuth                | [TWITCH_OAUTH.md](TWITCH_OAUTH.md)                                                                                                                                                                           |
| Extension (calibration vidéo)         | [TWITCH_GEOMETRY_CALIBRATION_2026-10.md](TWITCH_GEOMETRY_CALIBRATION_2026-10.md), `apps/twitch-extension/README.md`                                                                                          |
| Registre d'audit (historique)         | [ASTRA_GLOBAL_AUDIT_2026-10.md](ASTRA_GLOBAL_AUDIT_2026-10.md)                                                                                                                                               |

Certains de ces documents ont un en-tête de statut antérieur à la Production (« non déployé ») : l'état qui fait foi
est celui de [ROADMAP.md](ROADMAP.md).
