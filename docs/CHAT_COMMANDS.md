# Commandes chat — convention commune (décidée le 22/10/2026)

S'applique à toute nouvelle commande chat de Raptoru 2.0 (bot LeCroupier\_ → Core). Les commandes existantes ne sont
mises en conformité qu'au moment où elles sont modifiées.

## Règles

1. **Pseudo avec ou sans @.** Toute commande qui accepte un pseudo accepte indifféremment `Pseudo` et `@Pseudo`, sans
   tenir compte de la casse, et résout le **même compte Twitch** : d'abord la mention réelle du message (fragment
   EventSub, identifiant Twitch fourni par Twitch), sinon une recherche Twitch par login, retenue seulement si Twitch
   renvoie exactement ce login.
2. **Syntaxe stricte.** Une commande n'agit que sur ses formes documentées. Le message commence par la commande (espaces
   extérieurs ignorés) ; aucun mot avant, aucun argument en trop. Une forme non documentée n'est pas une commande :
   aucune action, aucune réponse (`Salut !solde`, `!solde pour voir tes jetons`, `!solde @Pseudo salut`, `!solde @`).
3. **Pas de repli sur l'auteur.** Un pseudo introuvable, non résolu ou une erreur de l'API Twitch ne fait jamais agir
   la commande sur le compte de l'auteur (ni sur un autre) : réponse claire (« viewer « x » introuvable » ou
   « indisponible »).
4. **Mot unique ambigu.** Un mot isolé (`!solde pour`) a la forme d'un pseudo : il n'est consulté que si Twitch le
   résout en un vrai compte ; sinon « introuvable ».
5. **Arguments libres conservés.** Les commandes dont la syntaxe documentée prend un texte libre (ex. `!tts <texte>`)
   le gardent : la règle 2 interdit les arguments non documentés, pas les textes libres prévus.

## Syntaxes

| Commande                         | Formes acceptées                              | Effet                                                |
| -------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `!solde` (`!balance`, `!compte`) | `!solde` · `!solde Pseudo` · `!solde @Pseudo` | son solde · le solde du viewer nommé (lecture seule) |

Implémentation de référence : `apps/twitch-bot/src/loyalty-commands.ts` (`parseLoyaltyCommand`,
`handleLoyaltyMessage`), réponse construite par le Core (`apps/core-api/src/wallet/chat.ts`,
`walletMessages.balance` / `balanceOf`).

## Interactions payantes depuis le chat (22/10/2026)

Principe : une commande chat **achète exactement ce que l'extension achète**, par le même service du Core (prix,
contrôles, modération, cooldowns, remboursements), payé par l'auteur du message (identité Twitch d'EventSub), une seule
fois par message Twitch (clé d'idempotence = identifiant du message : un événement rejoué rejoue le même achat, jamais un
2ᵉ débit). Un refus (solde, cooldown, blocage, pause…) ne débite rien, n'enregistre rien et ne consomme aucun cooldown.
Les réponses passent par la file chat durable du Core (une par message Twitch). Le bot ne décide rien : il transmet
chaque message au Core (`/v1/bot/chat`), qui le route vers ses modules (`lab-chat/router.ts`).

| Commande | Formes acceptées                                                                                                                                         | Effet                                                                                                                                                                                                                                                                        | État                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!tts`   | `!tts` · `!tts <texte libre>`                                                                                                                            | aide gratuite (« Écris ton message après la commande — {prix du 1er palier} Jetons », au plus une fois toutes les 30 s par viewer) · achat du TTS de l'extension (palier selon la longueur, personnage tiré au sort par le Core ; un `@pseudo` dans le texte reste du texte) | en place (`apps/core-api/src/tts-lab/chat.ts`)                                                                                                                  |
| `!rb`    | `!rb` (aucun argument ; `!rb salut` ignoré)                                                                                                              | Random Ban payé **25 000 Jetons**, second moyen de paiement du Random Ban des Points de chaîne (même demande, exécuteur, immunités, timeout, animation)                                                                                                                      | en place (`apps/core-api/src/chat-interactions/random-ban-chat.ts`)                                                                                             |
| `!fxcam` | `!fxcam <effet>` (`prison`, `bighead`, `pixel`, `drunk`, `glitch`, `rage`, casse ignorée, un seul mot ; `!fxcam` seul ou effet inconnu : liste gratuite) | effet caméra payé **1 500 Jetons**, second moyen de paiement du FX Cam des Points de chaîne (même action, job Studio, lecteur d'effets)                                                                                                                                      | en place (`apps/core-api/src/chat-interactions/fx-cam-chat.ts`) — migration `20261104120000_cp_redemptions_chat_source_lab.sql` **à appliquer** avant livraison |

Solde insuffisant, format commun : « @Pseudo — Il te faut {prix} Jetons pour utiliser {module}. Solde : {solde} Jetons
(il te manque {écart}). » — prix et solde lus dans le refus du Wallet, jamais recalculés.

`!tts` est un mot réservé de Commands V2 (`commands/reserved.ts`) : aucune commande personnalisée ne peut y répondre.

### `!rb` — règles

- Refus **avant tout débit** si l'exécuteur Twitch (le bot) ne s'est pas signalé depuis 15 s ou n'a pas les droits
  de recherche / timeout, ou si Raptoru est en pause globale.
- Demande Random Ban (source `chat`, référence = identifiant du message Twitch) et débit Wallet dans **une seule
  transaction** : solde refusé → aucune demande ; même message rejoué → la même demande, aucun 2ᵉ débit.
- Le chat n'apprend que « en file » à l'achat : jamais un succès avant le résultat de l'exécuteur.
- Remboursement automatique en Jetons, une seule fois, quand la demande se termine **sans rien avoir fait**
  (`refund = needed` : exécuteur absent / perdu, droits manquants, refus Twitch) : message « … Jetons remboursés ».
  Un résultat **incertain** (le timeout a pu partir) n'est jamais remboursé automatiquement : « à vérifier », comme
  pour les Points de chaîne.
- Points de chaîne et chat partagent la file : un Random Ban à la fois, dans l'ordre d'arrivée ; seuls les achats chat
  touchent au Wallet.
- Simulateur de Studio : exécution à blanc (`dry_run`), jamais de timeout réel.

### Tarifs

Un seul endroit côté Core : `apps/core-api/src/chat-interactions/prices.ts` (`CHAT_INTERACTION_PRICES`, lu par
l'interface `ChatPrices`). Studio pourra les régler plus tard en remplaçant ce lecteur, sans toucher aux commandes.

### `!fxcam` — règles

- Seuls les identifiants exacts du catalogue (casse ignorée). `!fxcam` seul ou un nom inconnu : la liste et le prix,
  gratuitement (au plus une fois toutes les 30 s par viewer). Un mot en plus (`!fxcam drunk salut`) : ignoré.
- Refus **avant tout débit** si Studio n'a pas demandé de job depuis 15 s, si les automatisations Points de chaîne sont
  OFF, si aucune règle active ne propose FX Cam, ou si Raptoru est en pause globale.
- L'achat est enregistré comme une rédemption (source `chat`, identifiant = message Twitch) avec la même action et le
  même job Studio, **dans la transaction du débit** ; même message rejoué → rien de nouveau, aucun 2ᵉ débit.
- « en file » seulement à l'achat. Remboursement en Jetons, une seule fois, quand l'action a **certainement échoué**
  (Studio absent, échec signalé, jamais démarrée) ; jamais si son issue est **inconnue** (démarrée sans fin signalée :
  l'effet a pu jouer) → marquée « à vérifier ».
- Points de chaîne et chat partagent la file des jobs : un à la fois par chaîne.
- Migration requise : `cp_redemptions.source` accepte `chat` (additive, rejouable) — Lab et Core principal ; **non
  appliquée** sur les bases distantes.

### Cooldowns (`!rb`, `!fxcam`)

Constat : les cooldowns et limites des récompenses (cooldown global, max par stream, max par viewer) sont réglés **sur
Twitch** et appliqués par Twitch seul ; le bot lit les récompenses (`getCustomRewards`) mais n'en transmet ni le cooldown
ni les limites, et le Core ne les connaît pas. Les seules limites côté Core, appliquées au chat comme aux points : un
Random Ban à la fois, un job Studio à la fois (file). Aucun cooldown arbitraire n'a été ajouté.

Pour des limites cohérentes, modification proposée (non faite) : le bot transmet `global_cooldown_setting`,
`max_per_stream_setting` et `max_per_user_per_stream_setting` de chaque récompense ; le Core les stocke (migration
`cp_rewards`) et applique **les mêmes valeurs** aux achats chat de la récompense correspondante (dernière exécution
toutes sources confondues, compteurs du stream). Les réglages Twitch restent la seule source.
