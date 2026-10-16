# Duel V1 — référence de parité (RET-GAME-003)

> **Statut (16/10/2026) : DUEL V1 FONCTIONNELLEMENT MIGRÉ ET VALIDÉ EN LAB — PAS EN PRODUCTION** (`2bf4fc8`).
> Validé par Antoni le 16/10/2026 dans l'onglet Simulation et en vrai chat Twitch avec de vrais comptes (création du
> défi, refus d'un second défi, acceptation, résultat). Transferts Wallet et protections : tests automatiques. Réserves
> (non bloquantes, non testées) : l'annonce réelle par LeCroupier\_ n'a pas été vérifiée pendant le dernier scénario
> (sortie chat réelle OFF) et la variation des deux soldes n'a pas été revérifiée à la main dans ce scénario. Depuis
> `85a48fe`, le transfert passe par `EconomyPort.transfer` (Wallet Lab, aucun cutover).
>
> Migration fonctionnelle rapide du Duel
> StreamElements, **sans refonte** : chat seulement, Wallet Lab (Jetons), réponses par LeCroupier_ via la file durable
> `cmd_steps`, même module Core que Roulette / Slot (`apps/core-api/src/mini-games/`) et même interrupteur
> « Mini-jeux » (OFF par défaut). Pas d'Extension, pas d'onglet Studio dédié. Production = StreamElements jusqu'au
> cutover économique.

## 1. Sources

- Paramètres et messages de la chaîne fournis par Antoni (16/10/2026) : mise maximale 100 000, cooldown personnel
  30 s, global 0, messages « Win » et « Points won ».
- Documentation officielle StreamElements (commande et module Duel) : syntaxe, `!accept` / `!deny` / `!cancelduel`,
  2 minutes, 50/50 tiré à l'acceptation, mise facultative (sans mise = 0), formats `k` / `m` / `%` / `all`, mise bornée
  par le solde des deux joueurs, mise au-delà du maximum ramenée au maximum, pas de duel contre soi-même, un seul défi
  sortant à la fois.
- Aucune trace dans SAMMI ni dans le dépôt.

## 2. Règles (prouvées ou décidées)

| Règle           | V1                                                                                               | Preuve                                      |
| --------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Défier          | `!duel <pseudo> [mise]` (`@` accepté devant le pseudo)                                           | doc SE                                      |
| Répondre        | `!accept`, `!deny` (la cible) ; `!cancelduel` (le lanceur)                                       | doc SE                                      |
| Expiration      | **2 minutes** ; aucun Jeton échangé                                                              | doc SE                                      |
| Résultat        | **50/50**                                                                                        | doc SE                                      |
| Gain            | le perdant verse sa mise au gagnant (aucun Jeton créé ni perdu)                                  | doc SE, décision d'Antoni                   |
| Sans mise       | duel gratuit (0) : aucun mouvement de Jetons                                                     | doc SE                                      |
| Mise maximale   | **100 000** ; une mise supérieure est **ramenée à 100 000**                                      | réglage de la chaîne ; doc SE (« reduced ») |
| Cooldown        | **30 s par viewer** après avoir participé à un duel terminé (pour en lancer un autre) ; global 0 | réglage de la chaîne ; doc SE               |
| Contre soi-même | refusé                                                                                           | doc SE                                      |
| Défi sortant    | un seul par viewer                                                                               | doc SE                                      |
| Formats de mise | nombre, `k`, `m`, `%`, `all` ; arrondi à l'entier inférieur                                      | doc SE                                      |

## 3. Identité des participants (décision d'Antoni)

- L'identité canonique est le **Twitch User ID**, jamais le pseudo. Le défi stocke les deux IDs ; toutes les
  vérifications (acceptation, refus, annulation) et tous les mouvements Wallet utilisent les IDs. Les pseudos ne servent
  qu'à l'affichage ; un changement de pseudo ne change ni le propriétaire d'un défi ni ses Jetons.
- Résolution du pseudo cible, **exacte** (insensible à la casse, aucune correspondance approchée) :
  - message du **vrai chat** : Helix « Get Users » par `login` (jeton d'application du Core Lab, déjà utilisé pour les
    avatars de la Tombola) ;
  - message du **simulateur** : d'abord les identités du simulateur ayant déjà écrit dans ce Core (mémoire, perdue au
    redémarrage du Core), puis Helix. Une identité de test n'est jamais confondue avec un vrai compte Twitch homonyme.
- Résolution impossible ou incertaine (inconnu, Helix indisponible ou non configuré) → **refus**, sans mouvement.

## 4. Décisions V1 (non documentées chez StreamElements)

1. **Base de `%` et `all`** : le solde du **lanceur** au moment du défi ; puis plafond 100 000.
2. **Pas de réservation des Jetons** au moment du défi : les deux soldes sont vérifiés **à l'acceptation**. Si l'un
   des deux ne couvre plus la mise (ou si un gain dépasserait le plafond du Wallet Lab), l'acceptation est refusée et le
   défi est annulé, sans mouvement.
3. **Une cible ne peut avoir qu'un défi entrant** en attente (sinon `!accept` serait ambigu) : un nouveau défi vers une
   cible déjà défiée est refusé.
4. **Expiration silencieuse** : pas de message à l'expiration (le défi ne peut simplement plus être accepté).
5. **Message de résultat** : « Win » pour un duel gratuit, « Points won » pour un duel avec mise.
6. **Résultat fixé à la création du défi** (50/50 cryptographique, stocké, jamais exposé) et révélé à l'acceptation :
   même probabilité pour les viewers, mais un `!accept` rejoué après un échec technique ne retire jamais au sort
   (exigence « tirage non rejoué »). Écart purement technique avec « tiré à l'acceptation ».
7. Refus annoncés (un message de LeCroupier_) : contre soi-même, solde insuffisant, défi déjà en attente, cible déjà
   défiée, pseudo introuvable. **Silencieux** : cooldown en cours, `!accept` / `!deny` / `!cancelduel` sans défi.
8. Duel gratuit : le cooldown s'applique aussi.

## 5. Textes

`{winner}`, `{loser}`, `{points}`, `${pointsname}` (« Jetons »), `{challenger}`, `{target}`, `{user}` (noms affichés).
Le `/me` initial est retiré à l'envoi (message normal, jamais un « /me » littéral).

| Message                             | Texte                                                                                                       | Source      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| Victoire (duel gratuit)             | `/me {winner} a gagné contre {loser} ! GG à {winner} 💪 //`                                                 | chaîne      |
| Victoire avec mise                  | `/me {winner} a gagné le duel contre {loser} \| {winner} remporte {points} ${pointsname} !`                 | chaîne      |
| Défi avec mise                      | `@{target}, {challenger} te défie en duel pour {points} ${pointsname} ! Tape !accept ou !deny (2 minutes).` | décision V1 |
| Défi gratuit                        | `@{target}, {challenger} te défie en duel ! Tape !accept ou !deny (2 minutes).`                             | décision V1 |
| Refus                               | `{target} refuse le duel de {challenger}.`                                                                  | décision V1 |
| Annulation                          | `{challenger} annule son défi contre {target}.`                                                             | décision V1 |
| Contre soi-même                     | `@{user}, tu ne peux pas te défier toi-même.`                                                               | décision V1 |
| Solde insuffisant (lanceur)         | `@{user}, tu n'as pas assez de ${pointsname} pour ce duel.`                                                 | décision V1 |
| Solde insuffisant (à l'acceptation) | `Duel annulé : {user} n'a pas assez de ${pointsname} ({points} ${pointsname}).`                             | décision V1 |
| Défi déjà en attente                | `@{user}, tu as déjà un défi en attente (!cancelduel pour l'annuler).`                                      | décision V1 |
| Cible déjà défiée                   | `@{user}, {target} a déjà un défi en attente.`                                                              | décision V1 |
| Pseudo introuvable                  | `@{user}, impossible de trouver {target} sur Twitch.`                                                       | décision V1 |

## 6. Exécution (Core)

- Table `mini_game_duels` : un défi = deux Twitch IDs, la mise, l'état (`pending` → `resolved` / `denied` /
  `cancelled` / `expired` / `refused`), l'échéance, le résultat fixé, les identifiants des messages. Un seul défi
  `pending` par lanceur et par cible (index uniques partiels).
- Idempotence : le `message_id` du défi est unique ; l'acceptation / le refus / l'annulation enregistrent leur
  `message_id` (un renvoi ne fait rien de plus).
- Acceptation = une transaction : verrou du défi, puis des deux Wallets **dans l'ordre des IDs** (pas d'interblocage),
  vérification des soldes et du plafond, débit du perdant, crédit du gagnant (deux lignes de ledger `mini_game`, somme
  nulle), défi `resolved`, message LeCroupier_. Tout ou rien.
- Deux `!accept` simultanés : un seul trouve le défi `pending`. Annulation, refus et expiration ne touchent aucun
  Wallet.
- Expiration appliquée paresseusement à chaque commande de duel (aucune tâche de fond).

## 7. Validation

Automatique : parsing, mises, états, transferts, idempotence, concurrence, expiration, rollback, mots réservés.
Manuelle (Antoni) : onglet Simulation avec deux identités (« Viewer Lab » = `lab_viewer`, « Modo Lab » = `lab_modo`),
puis vrai chat Twitch avec le Duel coupé dans StreamElements.

**Résultat (16/10/2026)** : validé par Antoni en Simulation (deux identités) puis en vrai chat Twitch (VieweruMobilu /
Raptoru\_ : défi, refus d'un second défi, acceptation, gagnant). Reste à observer une fois (réserves ci-dessus) :
l'annonce réelle avec la sortie LeCroupier\_ ON et les deux soldes avant / après un duel avec mise.

## 8. Plus tard (hors V1)

Extension, visuels, annonce d'expiration, statistiques de duels, réglages dans Studio.
