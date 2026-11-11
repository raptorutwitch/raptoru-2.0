# Inventaire des commandes chat Twitch

**Mis à jour le 11/11/2026 (mission de nuit)**, sur le code de la branche `feat/post-live-moderation` (base
`origin/main` `b4e65c6`). Lecture du code : les commandes Commands V2 créées par Antoni dans Studio (contenu de la
base) ne sont pas comptées. Rien n'a été supprimé, renommé ni rendu public.

**Statuts** (colonne « État ») :

- **Prod** : dans le code déployé en Production (Core `bbce104`, bot `900637f`) et activée par ses interrupteurs ;
- **Branche** : écrit et testé sur la branche, **ni fusionné ni déployé** ;
- **Lab** : n'existe que dans le Lab ; **Muette** : présente mais coupée par un réglage ;
- aucune commande n'est « vérifiée en live » par cet inventaire : seul un test d'Antoni le dit.

Interrupteurs relevés le 11/11 (lecture seule) : bot `CHAT_GAMES`, `CHAT_GAMES_OUTPUT`, `LOYALTY_CHAT_COMMANDS`,
`DAILY_CHAT_COMMANDS` à `true` ; Core `SPOTIFY_CHAT`, `CAUTION_CHAT`, `VOTEKICK_CHAT` à `true`,
`ECONOMY_MODE=canonical`, `MUSIC_HUB_EXTENSION=on`.

## 1. Chemin d'un message

- **Bot, 8 mots** (`apps/twitch-bot/src/runtime.ts`) : `!daily`, `!streak`, `!solde`, `!balance`, `!compte`, `!give`,
  `!trade`, `!wallet`. Le bot répond lui-même, mais le Core décide (routes `/v1/bot/wallet/*`, `/v1/bot/daily`).
- **Tout le reste → Core** (`/v1/bot/chat`, si `CHAT_GAMES`), dans cet ordre : Tombola, Commands V2, Jeu des mots,
  mini-jeux, TTS, Random Ban, FX Cam, Caution, Votekick, Spotify, Boutique d'événement, Roue du Sub, modules de
  l'hôte, Progression, **Portefeuille** (branche).
- **Rôle** : le bot lit les badges ; « broadcaster » n'est accordé que **par identité** (`lab-chat/broadcaster.ts`) ;
  supermods et permissions viennent de l'équipe Coulisses (`lab_staff` + permissions, modération D4).
- **Restriction au live** (`stream/live-gate.ts`) : Production seulement.

## 2. Tableau des commandes

| Commande                                             | Alias                                  | Module               | Qui                                             | Coût / gain                  | État                            |
| ---------------------------------------------------- | -------------------------------------- | -------------------- | ----------------------------------------------- | ---------------------------- | ------------------------------- |
| `!daily`                                             | —                                      | Daily (bot)          | viewer                                          | gain 500 → 2 000             | Prod                            |
| `!streak`                                            | —                                      | Daily (bot)          | viewer                                          | —                            | Prod                            |
| `!solde [@x]`                                        | `!balance`, `!compte`                  | Wallet (bot)         | viewer, **y compris le solde d'un autre** (§ 4) | —                            | Prod                            |
| `!give @x N`                                         | `!trade`                               | Wallet (bot)         | viewer                                          | transfert sans taxe          | Prod                            |
| `!wallet add\|remove @x N [motif]`                   | —                                      | Portefeuille (bot)   | permission « Portefeuille » (§ 3)               | 1 à 1 000 000                | Prod (ancienne règle) · Branche |
| `!wallet set @x N`                                   | —                                      | Portefeuille (bot)   | **streamer seulement** (§ 3)                    | solde absolu                 | Prod (ancienne règle) · Branche |
| `!addpoints @x N [motif]`                            | `!crediter`                            | Portefeuille (Core)  | permission « Portefeuille »                     | 1 à 1 000 000                | Branche                         |
| `!removepoints @x N [motif]`                         | `!debiter`                             | Portefeuille (Core)  | permission « Portefeuille »                     | 1 à 1 000 000, jamais sous 0 | Branche                         |
| `!join`                                              | `!enter` (réglable)                    | Tombola              | viewer                                          | gratuit                      | Prod                            |
| `!annuletombola`                                     | réglable                               | Tombola              | modérateur et plus                              | —                            | Prod                            |
| `!mots`, `!streakmot`                                | —                                      | Jeu des mots         | viewer                                          | —                            | Prod                            |
| mot deviné (sans `!`)                                | —                                      | Jeu des mots         | viewer                                          | gain                         | Prod                            |
| `!roulette <mise>`                                   | `!gamble`                              | Mini-jeux            | viewer                                          | mise ≥ 20                    | Prod si interrupteur ON         |
| `!slots [mise]`                                      | `!slot`, `!slotmachine`, `!sm`, `!smp` | Mini-jeux            | viewer                                          | 20                           | Prod si interrupteur ON         |
| `!duel @x [mise]`, `!accept`, `!deny`, `!cancelduel` | —                                      | Duel                 | viewer / visé / lanceur                         | 0 à 100 000                  | Prod si interrupteur ON         |
| `!tts [texte]`                                       | —                                      | TTS                  | viewer                                          | palier 1 = 7 500 (réglable)  | Prod                            |
| `!rb`                                                | —                                      | Random Ban           | viewer                                          | 25 000 (réglable)            | Prod                            |
| `!fxcam <effet>`                                     | —                                      | FX Cam               | viewer                                          | 1 500 (réglable)             | Prod                            |
| `!caution <pseudo> [mode]` puis `oui`/`non`          | —                                      | Caution              | viewer (pas pour soi)                           | 1 000 / min                  | Prod                            |
| `!votekick <pseudo>`, `!kick`, `!save`               | —                                      | Votekick             | viewer, pas contre un modérateur                | gratuit                      | Prod                            |
| `!song`, `!songqueue`, `!mysong`, `!songcancel`      | —                                      | Musique              | viewer                                          | —                            | Prod                            |
| `!songremove`, `!songskip`                           | —                                      | Musique              | modérateur, streamer (rôle des badges)          | —                            | Prod                            |
| `!bonbons`, `!peur [effet]`                          | —                                      | Boutique d'événement | viewer                                          | Bonbons                      | Muette (événement fermé)        |
| `!roue [oui\|non]`                                   | —                                      | Roue du Sub V2       | viewer                                          | —                            | Muette en mode v1               |
| `!objectif`                                          | —                                      | Objectif de soirée   | viewer                                          | —                            | Lab                             |

Progression : lit chaque message pour l'XP, ne répond jamais ; **aucune** commande `!level`, `!xp`, `!niveau`.

**Totaux** : 34 commandes (32 avant la passe + `!addpoints`, `!removepoints`), 11 alias (9 + `!crediter`, `!debiter`),
45 mots déclencheurs dont 44 hors Lab. Le décompte suit la méthode de la passe du 11/11 (commande principale, alias,
mots de jeu comptés une fois) et ne compte pas les sous-commandes (`add|remove|set`, `oui|non`, seconds mots de
`!caution`).

## 3. Commandes Jetons de l'équipe (branche `feat/post-live-moderation`)

**Cause de la perte** : les commandes StreamElements (`!addpoints`…) n'ont jamais été portées ; la seule commande
restante, `!wallet`, vérifiait l'ancienne table `staff_roles` (sans écran dans Coulisses, sans le streamer d'office) :
les modérateurs recevaient « commande réservée à l'équipe ».

**Une seule décision, une seule opération** pour toutes les portes : la modération D4 (`wallet_adjust`), donc les mêmes
règles dans le chat, l'extension (Portefeuille) et Studio.

| Porte                                 | Qui peut                                                                 | Ce qui est fait                                                            |
| ------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `!addpoints` / `!removepoints` (Core) | streamer (par identité), supermod, modérateur **avec** « Portefeuille »  | `wallet_adjust`, clé `chat:<id du message>`                                |
| `!wallet add\|remove` (bot → Core)    | streamer (par identité), membre de l'équipe supermod ou « Portefeuille » | `wallet_adjust`, clé `chat-wallet:<id du message>`                         |
| `!wallet set` (bot → Core)            | **streamer seulement**                                                   | ensemble atomique du Wallet (inchangé), tracé dans le ledger avec l'auteur |
| Extension › Modération › Portefeuille | même permission                                                          | `wallet_adjust`, clé de l'action                                           |
| Studio (Coulisses)                    | streamer                                                                 | `wallet_adjust` / outils du Lab                                            |

Règles communes : entier de 1 à 1 000 000 par commande de chat ; retrait jamais sous 0 (le Core retire au plus le solde
et le dit) ; plafond du Wallet ; jamais sur son propre portefeuille sauf le streamer ; cible = compte Twitch du login
exact (Helix ou mention réelle ; sans Helix, un seul viewer connu) ; inconnu ou ambigu → rien ; un message rejoué ou
reçu par deux Cores ne compte qu'une fois (testé sur PostgreSQL réel) ; journal d'audit de la modération.

**Changement de comportement à connaître** : `!wallet` ne lit plus `staff_roles` dès que la modération est branchée
(toujours en Production). Une personne seulement dans `staff_roles` perd `!wallet` ; il faut l'ajouter à l'équipe dans
Coulisses (supermod ou permission « Portefeuille »). La route de `!wallet` ne transporte pas le badge : un membre retiré
de l'équipe perd l'accès immédiatement, mais un ancien modérateur Twitch resté dans l'équipe le garde jusqu'à son
retrait. `!addpoints` vérifie, lui, le badge **et** l'équipe. Retour arrière : redéployer `bbce104` (aucune migration).

## 4. `!solde @pseudo` : état actuel (inchangé, décision d'Antoni)

- **Qui** : tout viewer, si `LOYALTY_CHAT_COMMANDS=true` (le cas en Production).
- **Ce qui est visible** : le solde en Jetons de la personne visée (et la ligne Bonbons pendant un événement), dans le
  chat public ; la réponse s'adresse au demandeur (`wallet/chat.ts`, `balanceOf`).
- **Historique** : StreamElements répondait aussi à `!points @x` dans le chat (comportement par défaut de SE) ; non
  vérifié sur les réglages de la chaîne de l'époque.
- **Équivalents** : aucune autre commande de chat ne montre le solde d'un autre ; l'extension n'affiche que son propre
  solde. Ce que montre le classement de raptoru.fr n'a pas été vérifié pour cette question.
- **Options plus tard** : (a) garder ; (b) `!solde @x` réservé à l'équipe, `!solde` seul pour soi ; (c) réponse en
  chuchotement Twitch (exige un scope supplémentaire du bot). Changement localisé dans `wallet/chat.ts`, sans migration.

## 5. Tri des commandes (proposition, rien n'est supprimé)

| Catégorie                | Commandes                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actives, publiques       | `!daily`, `!streak`, `!solde`, `!give`, `!join`, `!mots`, `!streakmot`, `!roulette`, `!slots`, `!duel`…, `!tts`, `!rb`, `!fxcam`, `!caution`, `!votekick`, `!song*` (viewer) |
| Réservées à l'équipe     | `!addpoints`, `!removepoints`, `!crediter`, `!debiter`, `!wallet`, `!annuletombola`, `!songremove`, `!songskip`                                                              |
| Muettes / saisonnières   | `!bonbons`, `!peur` (événement), `!roue` (mode v1)                                                                                                                           |
| Lab                      | `!objectif`                                                                                                                                                                  |
| Conflictuelles           | mots non réservés dans Commands V2 (§ 6.1)                                                                                                                                   |
| À restaurer (candidates) | `!sniper`, `!groslot`, salut d'Aouh (Commands V2 + action son, type d'action à créer) ; `!help` / `!commandes` (lien vers le futur catalogue)                                |
| Candidates au retrait    | `!wallet set` (une fois `!addpoints` adopté) ; alias `!sm` / `!smp` si inutilisés                                                                                            |
| Historiques non migrées  | § 7                                                                                                                                                                          |

## 6. Anomalies

1. **Mots réservés incomplets** (non corrigé, choix d'Antoni) : `daily`, `streak`, `solde`, `balance`, `compte`,
   `give`, `trade`, `wallet`, `mots`, `streakmot`, `caution`, `votekick`, `kick`, `save`, `song*`, `peur`, `bonbons`,
   `roue`, `fx` ne sont pas réservés dans Commands V2 : une commande personnalisée de ce nom produirait deux réponses.
   Les mots du Portefeuille (`addpoints`, `crediter`, `removepoints`, `debiter`) **sont** réservés.
2. **Tutoriel de l'extension** : **corrigé sur la branche** (`63e74d73`) — plus de `!jetons`, `!cashin`, `!oracle`,
   `!bonk`, `!soundboard`, ni de prix ou de durée écrits en dur (les boutons affichent le coût réel).
3. Ni `!commands`, ni `!aide`, ni `!help`.
4. `!mots` / `!streakmot` répondent jeu coupé ; `!streakmot` sans cooldown.
5. `!solde @x` public (§ 4).
6. `!songremove` / `!songskip` se fient au rôle des badges sans la vérification d'identité de `chatRole` ; `!tts`,
   `!rb`, `!fxcam` n'ont pas d'interrupteur de déploiement propre.
7. `systemCommands` de Commands V2 jamais branché.

## 7. Commandes historiques non migrées (documentées seulement)

`!fx` (→ `!fxcam`), `!userid`, `!bonk` en Jetons (Bonk = extension), `!cashin`, `!blacklist`, `!whitelist`,
`!banque`, `!depot`, `!retrait`, 24H (`!code`, `!credits`, `!echange`, `!reset`, `!buy`), `!sniper`, `!groslot`, salut
d'Aouh, `!oracle`, `!spin`, `!jetons` (→ `!solde`), `!songstats`, `!mysongstats`, `!canceltts` (idée), `!recuperer`
(proposition), Level Up Wizebot (externe). Sources : `ECONOMY_MIGRATION.md`, `ROULETTE_SLOT_PARITY.md`,
`SPOTIFY_V2.md`, `Raptoru-2.0-ETAT-PROJET.md`.

## 8. Décisions laissées à Antoni

- `!solde @x` : garder public ou restreindre (§ 4).
- Réserver les mots du § 6.1.
- `!wallet set` : garder (streamer seulement) ou retirer.
- Commandes à restaurer (§ 5) et `!help`.
- Catalogue public : voir [CATALOGUE_COMMANDES_SITE.md](CATALOGUE_COMMANDES_SITE.md).
