# Archives documentaires

Documents historiques conservés pour leurs preuves et leur détail. **Ils ne décrivent pas l'état courant** : voir
[../REPRISE.md](../REPRISE.md), [../PROJECT_STATUS.md](../PROJECT_STATUS.md) et [../ROADMAP.md](../ROADMAP.md). Index de
toute la documentation : [../README.md](../README.md).

## Archivés ici

| Document                                                                   | Date          | Ce qu'il garde d'unique                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [REPRISE_journal_2026-10-21_24.md](REPRISE_journal_2026-10-21_24.md)       | 21 → 24/10    | journal intégral : débogage zoom / mute Votekick (cause racine du zoom entier), installations sup.3→sup.8 et leurs SHA-256, livraisons du 22/10, **chantier Roue du Sub V2** (décisions, fichiers, tests, ordre de déploiement), bilan du live du 21/10, mode d'emploi initial du déploiement Coolify |
| [STATE_AUDIT_2026-10-23.md](STATE_AUDIT_2026-10-23.md)                     | 23/10         | contradictions C1–C14 entre documents, § 5 « migré vs encore SAMMI / SE »                                                                                                                                                                                                                             |
| [LIVE_2026-10-23_VOTEKICK_CAUTION.md](LIVE_2026-10-23_VOTEKICK_CAUTION.md) | 23/10         | runbook de mise en service Caution + Votekick (ordre, retour arrière) ; sa variante d'overlay D a été abandonnée                                                                                                                                                                                      |
| [REPRISE_2026-10-28_2026-11-04.md](REPRISE_2026-10-28_2026-11-04.md)       | 28/10 → 04/11 | point d’entrée de travail de cette période : fermeture d’Halloween (02/11), points en attente (alertes Halloween, achat d’un viewer), chantier raptoru.fr V2 (lots, SHAs, intégration, répétition, livraison du 04/11), espaces de travail détaillés                                                  |
| [REPRISE_2026-11-04_2026-11-07.md](REPRISE_2026-11-04_2026-11-07.md)       | 04/11 → 07/11 | point d'entrée de cette période : Production `8a897a5` / Studio 0.1.25, préparation de l'Opération Coulisses, points ouverts hors site au 04/11, espaces de travail. Archivé par la consolidation du 08/11                                                                                            |
| [ROADMAP_2026-10-24_2026-10-29.md](ROADMAP_2026-10-24_2026-10-29.md)       | 24/10 → 29/10 | roadmap consolidée du 24/10 (échelle 1–5 par module, sources TRUTH / SA / PPL / ETAT, arbitrages), plan « monnaies du Wallet et gestionnaire d'événements » du 29/10 (détail repris en résumé dans la roadmap actuelle § 3)                                                                           |
| [REPRISE_2026-11-08_2026-11-10.md](REPRISE_2026-11-08_2026-11-10.md)       | 08/11 → 10/11 | point d'entrée de la consolidation « Final Freeze » du 08/11 : relevé de Production `1b25f30` / Studio 0.1.27, Extension Next sur branche, missions proposées. Archivé par la consolidation du 10/11                                                                                                  |
| [PROJECT_STATUS_2026-11-08.md](PROJECT_STATUS_2026-11-08.md)               | 08/11         | état du projet au 08/11 : tests de Coulisses et d'Extension Next (§ 7), travaux du 20/10 au 08/11 (§ 6), décisions de l'extension et du Studio (§ 10)                                                                                                                                                 |
| [ROADMAP_2026-11-08.md](ROADMAP_2026-11-08.md)                             | 08/11         | roadmap du 08/11 : pistes de modules détaillées (Roulette, Slot, socle temps réel, Blackjack), étapes d'Extension Next                                                                                                                                                                                |

## Historiques laissés à leur place (référencés par le code, la configuration ou de nombreux liens)

`Raptoru-2.0-HANDOFF.md` (figé 21/10), `Raptoru-2.0-ETAT-PROJET.md` (figé 19/10), `docs/CUTOVER_PLAN_2026-10.md`,
`docs/ECONOMY_MIGRATION.md`, `docs/PLAN_POST_LIVE_2026-10-21.md`, `docs/BOT_VPS_CUTOVER.md`, `docs/TEST_REEL_STAGING_2026-10.md`,
`docs/bonk-lab.md`, `docs/ASTRA_GLOBAL_AUDIT_2026-10.md` (registre d'audit). Les déplacer casserait des références.

## Non suivis par Git (checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0`, non déplacés)

| Document                                                                                          | Statut                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `docs/REPRISE.md`                                                                                 | ancienne copie de travail du point d'entrée (périmée : le point d'entrée suivi est [../REPRISE.md](../REPRISE.md)) |
| `docs/SUB_WHEEL_V2_PLAN.md`                                                                       | ancienne copie : la version de référence est suivie sur `main` depuis le 26/10 (PR #11)                            |
| `docs/PLAN_SUPERVISION_2026-10-23.md`                                                             | plan supervision (lots 3–4 restants) : à committer avec `sup-wt`                                                   |
| `docs/RAPTORU_POST_MIGRATION_TRUTH_2026-10-23.md`                                                 | état prouvé après bascule (23/10) ; consolidé dans ROADMAP / ARCHITECTURE ; à archiver                             |
| `docs/TWITCH_CONNECTION_INCIDENT_2026-10-22.md`                                                   | enquête incident du 22/10 (§ 9 requêtes de diagnostic) ; à archiver                                                |
| `docs/CLAUDE_HANDOFF_CURRENT.md`, `RAPTORU_2_0_CHATGPT_HANDOFF_2026-10-23.md`                     | passations du 23/10, remplacées par REPRISE ; à archiver                                                           |
| `docs/HANDOFF_MIGRATION_2026-10-20.md`, `docs/POST_LIVE_AUDIT_2026-10-20.md`                      | **privés : ne jamais committer**                                                                                   |
| `docs/LEGACY_DATA_MIGRATION_AUDIT_2026-10.md`, `docs/RAPTORU_2_0_GLOBAL_CHECKPOINT_2026-10-16.md` | **privés** (exclus par `.git/info/exclude`)                                                                        |

Autres worktrees : `sup-wt/docs/SUPERVISION_LOTS_1_2.md` (à committer avec `sup-wt`), `node-wt/docs/NODE_SECURITY_2026-10-23.md`
(seule trace des CVE Node et de l'exposition), copies identiques ou périmées de `CHAT_COMMANDS.md` / `WORD_GAME_PARITY.md`
dans `chat-wt`, `solde-wt`, `wg-wt`.

L'archivage des documents non suivis (copie ici, puis retrait du checkout principal) attend l'accord d'Antoni : ils
vivent dans le checkout principal, à côté de l'ancienne copie non commitée de la Roue V2 (remplacée par `main`).
