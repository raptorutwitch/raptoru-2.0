# Statistiques des modules par viewer (raptoru.fr lot 4) — Lab, non livré

Agrégats **en lecture seule**, calculés à partir de ce que chaque module écrit **déjà** en Production. Rien de nouveau
n'est enregistré, rien n'est estimé. Code : `apps/core-api/src/module-stats/service.ts` ; test :
`test/module-stats.test.ts`.

## Route

`GET /v1/site/modules/viewers/:id` — **jeton du site seulement** (absente sans `SITE_TOKEN`). Le site ne l'appelle que
pour le viewer de SA session : chacun voit ses propres totaux. **Aucune route publique** tant qu'Antoni n'a pas décidé
quels totaux deviennent publics (`lb-app/docs/ROADMAP_SITE.md` § 4.1).

## Sources et règles

| Champ                                                     | Source (Production)                                                      | Compté                                                                                          | Exclu                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `interactions.<module>` (bonk, tts, soundboard…)          | Wallet canonique : opérations `interaction:<id>:debit` (source = module) | utilisations **payées**                                                                         | remboursées (`interaction:<id>:refund` appliqué) ; usages gratuits (aucune trace) |
| `random_ban.sent / landed / backfired / flops / received` | `rb_requests`, mode `real`                                               | envoyés ; touché un autre ; retourné contre l'acheteur ; personne touché ; subis (par un autre) | tests et animations Studio                                                        |
| `roulette`, `slot` (`plays`, `wins`)                      | `mini_game_plays`                                                        | parties, victoires                                                                              | —                                                                                 |
| `duels.played / won`                                      | `mini_game_duels`                                                        | duels `resolved`                                                                                | refusés, expirés, annulés                                                         |
| `sub_wheel.spins`                                         | `sw_spins`, source `twitch`, statut `shown`                              | tours affichés                                                                                  | simulations, tests, échecs                                                        |
| `screamers.<saison>`                                      | `event_shop_purchases`                                                   | achats `completed`                                                                              | échoués, remboursés                                                               |

`since.<source>` : le premier enregistrement que le Core possède pour cette source sur la chaîne (cache 10 min).

## Limites historiques (à afficher, jamais à combler)

- Tout ce qui précède le basculement du **20/10/2026** (SAMMI, StreamElements, ancien site) n'est pas dans ces tables :
  ces totaux commencent à `since`, jamais avant.
- Les montants (mises, gains, Jetons dépensés) ne sont **pas** exposés : décision d'Antoni (« mises : à décider »).
- `random_ban.received` (« a été banni X fois ») n'est visible que par le viewer lui-même.
- Mots et Tombola ont déjà leurs classements (`/v1/word-game/leaderboard`, `/v1/raffle/leaderboard`) : non dupliqués ici.
- Votekick et Caution : modération, jamais exposés.

## Décisions attendues d'Antoni

1. Quels totaux deviennent **publics** (profil visible par tous, classements par module) ?
2. Les mises et gains des jeux : jamais, au propriétaire seulement, ou publics ?
