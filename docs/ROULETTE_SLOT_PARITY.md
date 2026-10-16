# Roulette et Slot V1 — référence de parité (RET-GAME-001 / 002)

> **Statut (16/10/2026) : règles décidées par Antoni ; implémentation Lab en cours.** Migration fonctionnelle rapide
> des jeux StreamElements, **sans refonte** (la refonte Extension viendra plus tard). Chat seulement, Wallet Lab
> (Jetons), réponses par LeCroupier_ via la file durable `cmd_steps`. Pas d'Extension, pas de framework de mini-jeux,
> pas de Wallet production. Production = StreamElements jusqu'au cutover économique.
>
> **Textes et symboles : ceux de la configuration StreamElements de la chaîne** (captures transcrites, 16/10/2026),
> mot pour mot (§ 5) ; une seule constante (`apps/core-api/src/mini-games/rules.ts`, `TEXTS` et `SLOT_SYMBOLS`).

## 1. Sources

- Paramètres et messages StreamElements de la chaîne : captures fournies par Antoni, transcrites le 16/10/2026.
- Documentation officielle StreamElements (modules et commandes Roulette / Slotmachine, changelog du 18/07/2026).
- Aucune trace dans SAMMI ni dans le dépôt : les deux jeux vivent entièrement dans le bot StreamElements.

## 2. Roulette (RET-GAME-001)

| Règle                        | V1                                                        | Preuve                                     |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| Commande                     | `!roulette <mise>`, alias `!gamble`                       | doc SE                                     |
| Victoire                     | **50 %**                                                  | réglage de la chaîne                       |
| Gain                         | victoire : **+1× la mise** (net) ; défaite : **−la mise** | doc SE (« even money »), décision d'Antoni |
| Mise minimale                | **20 Jetons**                                             | réglage de la chaîne                       |
| Cooldown                     | **10 s par viewer**, global 0                             | réglage de la chaîne                       |
| Mise `all`                   | tout le solde ; messages « all-in » dédiés                | doc SE                                     |
| Sans mise (`!roulette` seul) | ignoré                                                    | décision V1 (non documenté chez SE)        |

## 3. Slot (RET-GAME-002)

| Règle         | V1                                                                                    | Preuve                                                    |
| ------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Commande      | `!slots <mise>`, alias `!slot`, `!slotmachine`, `!sm`, `!smp`                         | doc SE                                                    |
| Rouleaux      | **3 rouleaux indépendants**, **5 symboles** (🍒 🍊 🍇 🍉 🍈, ordre de la capture)     | réglage de la chaîne                                      |
| Victoire      | **3 symboles identiques uniquement** (deux identiques = rien) → probabilité **1/25**  | doc SE                                                    |
| Gain          | victoire : **+24× la mise** (net, rendement théorique 100 %) ; défaite : **−la mise** | décision d'Antoni                                         |
| Mise minimale | **20 Jetons** ; `!slots` seul mise le minimum                                         | réglage de la chaîne ; doc SE (« minimum (and default) ») |
| Cooldown      | **2 s par viewer**, global 0                                                          | réglage de la chaîne                                      |
| Mise `all`    | non disponible (non documentée pour le Slot)                                          | doc SE                                                    |

## 4. Mise (les deux jeux)

- Formats : nombre (`100`), pourcentage du solde (`50%`, 1–100), `k` / `m` (`5k`, `1.5k`, `1m`), `all` (Roulette).
- Arrondi : toujours à l'entier inférieur (`50%` de 45 = 22 ; `1.5k` = 1 500).
- Refusé **sans réponse ni effet** (décision V1 : les captures ne montrent aucun message d'erreur) : mise invalide, sous le
  minimum, supérieure au solde, cooldown en cours, gain potentiel qui dépasserait le plafond du Wallet Lab.
- Pas de mise maximale (aucune chez StreamElements) ; on ne mise jamais plus que son solde, jamais de solde négatif.

## 5. Textes (configuration StreamElements de la chaîne, mot pour mot)

Variables StreamElements : `{user}` (nom affiché), `{bet}` (mise), `{points}`, `${pointsname}` (« Jetons »),
`{emotes}` (Slot : les 3 symboles, séparés par une espace). `{points}` = **Roulette : solde après la partie** ;
**Slot : montant du résultat** (gain net +24× la mise, ou la mise perdue), cohérent avec les règles de paiement V1.
Fautes de frappe (« uneuuuuh », « totu ») et emotes de la chaîne (`raptor199Pog`, `raptor199Money`) conservées.
Le `/me` initial n'est pas envoyable par l'API Twitch de LeCroupier_ : il est retiré, le texte part en message normal
(jamais un « /me » littéral).

| Message                  | Texte StreamElements                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Roulette victoire        | `/me {user} gagne {bet} ${pointsname} à la roulette et possède maintenant {points} ${pointsname} ! 😎`                          |
| Roulette défaite         | `/me {user} perd {bet} ${pointsname} à la roulette et possède maintenant {points} ${pointsname} ! ;)`                           |
| Roulette all-in victoire | `/me ✨ {user} a eu uneuuuuh chatte et remporte {bet} ${pointsname} ✨ {user} a maintenant {points} ${pointsname} raptor199Pog` |
| Roulette all-in défaite  | `/me {user} a all in et a totu perdu de ses {bet} ${pointsname} raptor199Money Gros naze !`                                     |
| Slot victoire            | `@{user} {emotes} tu remportes {points} ${pointsname} ! 🍀`                                                                     |
| Slot défaite             | `@{user} {emotes} tu perds {points} ${pointsname} 😳`                                                                           |

Symboles (ordre de la capture) : 🍒 🍊 🍇 🍉 🍈.

## 6. Exécution (Core)

- Un message = **une transaction** : verrou du Wallet du viewer, message déjà joué (même `message_id`) → rien,
  cooldown, contrôle de la mise et du solde, tirage, **une** écriture de solde, **une** ligne de ledger (`mini_game`,
  clé `mg:<chaîne>:<message_id>`), **une** ligne de partie, **un** message LeCroupier_ (`cmd_steps` origin
  `mini_game`). Tout ou rien.
- Idempotence : le `message_id` Twitch est la clé de la partie ; un renvoi ne rejoue ni ne repaie jamais.
- Concurrence : deux messages du même viewer sont sérialisés par le verrou du Wallet ; le second tombe dans le
  cooldown.
- Tirage : aléatoire cryptographique (`crypto.randomInt`), injectable dans les tests.
- **Interrupteur « Mini-jeux » OFF par défaut** (par chaîne, dans Core, réglé depuis Studio) : OFF = aucun message
  traité. Évite une double réponse avec StreamElements pendant les tests en vrai chat.
- Les commandes des deux jeux sont réservées : Commands V2 ne peut pas les utiliser.

## 7. Validation

Automatique : formats de mise, probabilités, gains, cooldowns, doublons, concurrence, refus, rollback.
Manuelle (Antoni) : Studio (simulateur), puis vrai chat Twitch avec les modules StreamElements Roulette / Slot coupés
pendant le test, Wallet Lab, LeCroupier_.

## 8. Plus tard (hors V1)

Module Extension dédié, visuels / animations, partage volontaire du résultat, Duel, Oracle, statistiques affichées,
réglages dans Studio, rééquilibrage.
