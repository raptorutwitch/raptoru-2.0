# Casino V1 — intégration finale et mise en Production (journal de reprise)

Mandat d'Antoni du 20/11/2026 : « CASINO V1 : INTÉGRATION FINALE ET MISE EN PRODUCTION » (GO pour préparer et
déployer le Casino complet si tous les contrôles passent ; arrêter seulement une étape qui exige une autorisation
extérieure). Branche locale `feat/casino` (worktree `agent`).

## État

| Étape | État | Preuve |
| --- | --- | --- |
| Archive des prototypes | fait | `Documents\Sauvegarde Raptoru 2.0\2026-11-20-prototypes-casino` (593 fichiers, manifeste SHA-256 vérifié) |
| Prototypes versionnés | fait | commit `b04b39d1` (`prototypes/casino-blackjack`, `prototypes/casino-emotes`) |
| Core : blackjack + machine à émotes | fait | commit `d9d42006` ; `test/casino-blackjack.test.ts` |
| Core : test de concurrence vrai Postgres | à faire | `test/casino-blackjack.integration.test.ts` |
| Extension : blackjack, machine à émotes, spectateurs, annonce | à faire | |
| Studio : réglages et tables | à faire | réglages `casino.*` (module-settings, génériques) |
| Docs, CI, PR, déploiement | à faire | |

## Décisions techniques

- **Blackjack au Core** (`apps/core-api/src/casino/blackjack/`) : `rules.ts` et `paytable.ts` = le prototype à
  l'identique (test de parité sur 20 000 mains) ; `engine.ts` = la machine de table, pure ; `service.ts` = Postgres.
- **Une ligne par table** (`casino_bj_tables.state`), modifiée seulement sous le verrou de la ligne, dans la même
  transaction que les mouvements du Wallet (clés `casino:bj:<bet|unbet|double|split|ins|insp|pay|side>:…`).
- **Timers** : l'étape en attente est enregistrée avec la table (`next_at`) ; le Core la joue (tick 250 ms). Après un
  redémarrage, elle joue en retard avec son défaut sûr (RESTER, pas d'assurance, donne avec les prêts). Table vide :
  aucune étape.
- **Création des tables** sous le verrou du salon (`casino:bj:lobby:<chaîne>`) + unicité `(channel_id, table_no)`.
  Une table pleine (10) ouvre la suivante, au plus 8 tables.
- **Présence** : en mémoire (un seul processus Core en Production) ; un joueur non vu depuis 25 s est « déconnecté »
  (ne bloque jamais la donne, assurance refusée pour lui) ; 90 s hors manche = place libérée.
- **Annonce** : seulement le créateur de la table, sur clic, une fois, dans les 10 min ; au plus une annonce de table
  par chaîne toutes les `casino.bj_announce_gap_s` (600 s). File de messages existante (`cmd_steps`, `module:casino`).
- **Machine à émotes** : jeu `book` du service existant, tour entier tiré au spin (comme le Coffre) ; parité exacte avec
  le moteur du prototype (3 000 tours). Mise 20–1 000 par défaut (plafond de gain : § 13 de CASINO.md).
- **Historique** : une ligne `casino_rounds` (jeu `blackjack`) par joueur et manche réglée.
