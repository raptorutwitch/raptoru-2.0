# Inventaire des commandes chat Twitch

**Relevé le 11/11/2026**, sur le code de `origin/main` `b4e65c6` et la branche `feat/post-live-moderation`. Lecture du
code seulement : les commandes Commands V2 créées par Antoni dans Studio (contenu de la base) ne sont pas comptées.
Rien n'est renommé, supprimé ni rendu public par cet inventaire (mandat post-live : décision d'Antoni).

Légende : **bot** = le bot `LeCroupier_` répond lui-même ; **Core** = le message passe par `/v1/bot/chat` puis les
modules du Core. Interrupteurs relevés en Production le 11/11 : bot `CHAT_GAMES`, `CHAT_GAMES_OUTPUT`,
`LOYALTY_CHAT_COMMANDS`, `DAILY_CHAT_COMMANDS` à `true` ; Core `SPOTIFY_CHAT`, `CAUTION_CHAT`, `VOTEKICK_CHAT` à
`true`, `ECONOMY_MODE=canonical`, `MUSIC_HUB_EXTENSION=on`.

## 1. Chemin d'un message

- **Bot, 8 mots** (`apps/twitch-bot/src/runtime.ts`) : `!daily`, `!streak`, `!solde`, `!balance`, `!compte`, `!give`,
  `!trade`, `!wallet`. Réponse directe par Helix, sans limiteur.
- **Tout le reste → Core** (si `CHAT_GAMES`), dans cet ordre : Tombola, Commands V2, Jeu des mots, mini-jeux, TTS,
  Random Ban, FX Cam, Caution, Votekick, Spotify, Boutique d'événement, Roue du Sub, **Portefeuille** (nouveau),
  modules de l'hôte, Progression (`apps/core-api/src/lab-chat/games.ts`, `ext/public-frontier.ts`).
- **Rôle** : déduit des badges par le bot (broadcaster, moderator) ; les supermods et les permissions viennent de
  `lab_staff` + grants (modération D4). Exception : `!wallet` lit l'ancienne table `staff_roles`.
- **Restriction au live** (`stream/live-gate.ts`) : Production seulement.

## 2. Tableau des commandes

| Commande                                             | Alias                                  | Module               | Qui                                        | Coût / gain                  | Garde-fous                                  | Où                                      |
| ---------------------------------------------------- | -------------------------------------- | -------------------- | ------------------------------------------ | ---------------------------- | ------------------------------------------- | --------------------------------------- |
| `!daily`                                             | —                                      | Daily (bot)          | viewer                                     | gain 500 → 2 000             | 1 / stream, hors stream refusé              | `twitch-bot/src/chat-commands.ts`       |
| `!streak`                                            | —                                      | Daily (bot)          | viewer                                     | —                            | —                                           | idem                                    |
| `!solde [@x]`                                        | `!balance`, `!compte`                  | Wallet (bot)         | viewer, **y compris le solde d'un autre**  | —                            | —                                           | `loyalty-commands.ts`, `wallet/chat.ts` |
| `!give @x N`                                         | `!trade`                               | Wallet (bot)         | viewer                                     | transfert sans taxe          | entier ≥ 1, pas à soi, pas au-delà du solde | idem                                    |
| `!wallet add\|remove\|set @x N [motif]`              | —                                      | Wallet admin (bot)   | `staff_roles` owner/supermod **seulement** | —                            | idempotent par message                      | idem, `wallet/staff.ts`                 |
| **`!addpoints @x N [motif]`** (nouveau)              | **`!crediter`**                        | Portefeuille (Core)  | permission « Portefeuille »                | 1 à 1 000 000                | voir § 3                                    | `core-api/src/wallet/admin-chat.ts`     |
| **`!removepoints @x N [motif]`** (nouveau)           | **`!debiter`**                         | Portefeuille (Core)  | permission « Portefeuille »                | 1 à 1 000 000, jamais sous 0 | voir § 3                                    | idem                                    |
| `!join`                                              | `!enter` (réglable)                    | Tombola              | viewer                                     | gratuit                      | 1 entrée par tirage                         | `raffle-lab/rules.ts`                   |
| `!annuletombola`                                     | réglable                               | Tombola              | `raffle.moderate` (modérateur +)           | —                            | —                                           | idem                                    |
| `!mots`, `!streakmot`                                | —                                      | Jeu des mots         | viewer                                     | —                            | répondent même jeu coupé                    | `word-game/service.ts`                  |
| mot deviné (sans `!`)                                | —                                      | Jeu des mots         | viewer                                     | gain                         | live + mot actif                            | idem                                    |
| `!roulette <mise>`                                   | `!gamble`                              | Mini-jeux            | viewer                                     | mise ≥ 20                    | 10 s / viewer, interrupteur, live           | `mini-games/rules.ts`                   |
| `!slots [mise]`                                      | `!slot`, `!slotmachine`, `!sm`, `!smp` | Mini-jeux            | viewer                                     | 20                           | 2 s                                         | idem                                    |
| `!duel @x [mise]`, `!accept`, `!deny`, `!cancelduel` | —                                      | Duel                 | viewer / joueur visé / lanceur             | 0 à 100 000                  | 30 s, défi 120 s                            | `mini-games/duel-rules.ts`              |
| `!tts [texte]`                                       | —                                      | TTS                  | viewer                                     | palier 1 = 7 500             | aide 30 s, achat 60 s +                     | `tts-lab/chat.ts`                       |
| `!rb`                                                | —                                      | Random Ban           | viewer                                     | 25 000                       | 1 à la fois, live                           | `chat-interactions/random-ban-chat.ts`  |
| `!fxcam <effet>`                                     | —                                      | FX Cam               | viewer                                     | 1 500                        | Studio présent, règle active, live          | `fx-cam-chat.ts`                        |
| `!caution <pseudo> [mode]` puis `oui`/`non`          | —                                      | Caution              | viewer (pas pour soi)                      | 1 000 / min                  | 1 caution ouverte, devis 30 s               | `caution/service.ts`                    |
| `!votekick <pseudo>`, `!kick`, `!save`               | —                                      | Votekick             | viewer, pas contre un modérateur           | gratuit                      | lanceur 60 min, 1 vote à la fois            | `votekick/service.ts`                   |
| `!song`, `!songqueue`, `!mysong`, `!songcancel`      | —                                      | Musique              | viewer                                     | —                            | `!song` 30 s pour la chaîne                 | `spotify/chat.ts`                       |
| `!songremove`, `!songskip`                           | —                                      | Musique              | modérateur, broadcaster (rôle déclaré)     | —                            | —                                           | idem                                    |
| `!bonbons`, `!peur [effet]`                          | —                                      | Boutique d'événement | viewer                                     | prix en Bonbons              | événement ON, live                          | `event-shop/chat.ts`                    |
| `!roue [oui\|non]`                                   | —                                      | Roue du Sub V2       | viewer                                     | —                            | muet en mode v1                             | `sub-wheel/chat.ts`                     |
| `!objectif`                                          | —                                      | Objectif de soirée   | viewer                                     | —                            | **Lab seulement**                           | `modules/objectif-soiree.ts`            |

Progression : lit chaque message pour l'XP, ne répond jamais ; **aucune** commande `!level`, `!xp`, `!niveau`.

**Totaux** : 34 commandes (32 relevées + `!addpoints`, `!removepoints`), 11 alias (9 + `!crediter`, `!debiter`),
45 mots déclencheurs (44 en Production, `!objectif` étant Lab seulement).

## 3. Commandes Jetons des modérateurs (rétablies le 11/11)

**Cause de la perte** : les commandes StreamElements (`!addpoints`…) n'ont jamais été portées. La seule commande staff
restante, `!wallet add|remove|set`, vérifie l'ancienne table `staff_roles`, qui n'a pas d'écran dans Coulisses et
n'inclut pas le broadcaster d'office : les modérateurs de la chaîne recevaient « commande réservée à l'équipe ».

**Rétablissement** : `!addpoints` / `!crediter` et `!removepoints` / `!debiter`, montant et pseudo dans n'importe quel
ordre, motif libre (≤ 180 caractères). La commande **n'a rien à elle** : c'est un appel à l'action `wallet_adjust` de
la modération (celle du bouton « Portefeuille » de l'extension), donc mêmes règles :

- permission « Portefeuille » (grant `wallet`) : broadcaster, supermods, modérateurs à qui elle a été accordée ; un
  viewer est refusé **avant** toute recherche ; un modérateur sans la permission est refusé par le Core ;
- cible = le compte Twitch du login **exact** (Helix « Get Users ») ; sans Helix, un seul viewer connu sous ce login ;
  introuvable ou ambigu → rien n'est fait ;
- entier de 1 à 1 000 000 ; « 1k », négatif, décimal → message d'usage ; au-delà → refus ;
- un retrait ne descend jamais sous 0 (le Core retire au plus le solde et dit combien) ;
- pas sur soi-même (sauf le broadcaster) ;
- une fois par message Twitch (clé `chat:<message_id>`) : un message rejoué, ou livré à deux Cores, ne crédite qu'une
  fois (test PostgreSQL réel) ;
- journal d'audit de la modération (acteur, rôle, motif, avant/après, ligne de ledger) ;
- mots réservés dans Commands V2 : une commande personnalisée ne peut pas les prendre.

`!wallet add|remove|set` (bot) est **inchangé** : sa suppression ou son alignement sur la permission « Portefeuille »
est une décision d'Antoni (§ 5).

## 4. Commandes historiques non migrées (documentées seulement)

`!fx` (remplacée par `!fxcam`), `!userid`, `!bonk` en Jetons (Bonk = extension), `!cashin`, `!blacklist`,
`!whitelist`, `!banque`, `!depot`, `!retrait`, 24H (`!code`, `!credits`, `!echange`, `!reset`, `!buy`), `!sniper`,
`!groslot` et le salut d'Aouh (prévus en Commands V2 avec une action son, type d'action inexistant), `!oracle`, `!spin`,
`!jetons` (→ `!solde`), `!songstats`, `!mysongstats`, `!canceltts` (idée), `!recuperer` (proposition), `!soundboard`
(tutoriel seulement), Level Up Wizebot (externe). Sources : `ECONOMY_MIGRATION.md`, `ROULETTE_SLOT_PARITY.md`,
`SPOTIFY_V2.md`, `Raptoru-2.0-ETAT-PROJET.md`.

## 5. Anomalies relevées (non corrigées : décision ou chantier à part)

1. **Mots réservés incomplets** : `daily`, `streak`, `solde`, `balance`, `compte`, `give`, `trade`, `wallet`, `mots`,
   `streakmot`, `caution`, `votekick`, `kick`, `save`, `song*`, `peur`, `bonbons`, `roue`, `fx` ne sont pas réservés
   dans Commands V2 : une commande personnalisée de ce nom produirait deux réponses (`commands/reserved.ts`).
2. **Tutoriel de l'extension** (`shared/experience.js` l. 53, 61, 69, 76) : annonce `!jetons`, `!bonk`,
   `!soundboard`, `!cashin`, `!oracle`, qui n'existent pas, et « TTS 2 000 » alors que le palier 1 vaut 7 500.
3. Ni `!commands`, ni `!aide`, ni `!help`.
4. `!mots` / `!streakmot` répondent jeu coupé ; `!streakmot` sans cooldown.
5. `!solde @x` : tout viewer voit le solde de n'importe qui.
6. Deux notions de supermod : `lab_staff` (modération, Tombola, Musique, Portefeuille) et `staff_roles` (`!wallet`).
7. `!songremove` / `!songskip` se fient au rôle déclaré par les badges, sans la vérification d'identité de
   `chatRole` ; `!tts`, `!rb`, `!fxcam` n'ont pas d'interrupteur de déploiement propre.
8. `systemCommands` de Commands V2 jamais branché ; `!roue` muet en mode v1 ; `!objectif` Lab seulement.

Décisions à prendre par Antoni : aligner `!wallet` sur la permission « Portefeuille » ou le retirer ; réserver les mots
du § 5.1 ; corriger le tutoriel ; rendre `!solde @x` réservé à l'équipe ou non.
