# Dock OBS unifié — suivi du chantier

Document de reprise du chantier « Dock OBS » (démarré le 27/10/2026). À lire avec `docs/REPRISE.md`. Source d'étude :
rapport Astra `C:\Users\Antoni\Documents\Codex\2026-10-27\files-pasted-by-the-user-mission\outputs\ASTRA_DOCK_OBS_DOSSIER_CLAUDE_2026-10-27.md`
(lu intégralement ; architecture « C » retenue, simplifiée ci-dessous).

## Où en est le travail

- Branche `feat/obs-dock`, worktree `C:\Users\Antoni\Documents\raptoru-dock` (depuis `origin/main` `5835fd8`).
- **Lot 1 (Core)** : en cours — migration, projeteur, flux, replay, routes, tests PGlite (9/9). Test PostgreSQL réel écrit
  (`test/dock.integration.test.ts`), à exécuter.
- Lots 2–4 : à faire (voir « Lots »).
- Rien de poussé, rien de déployé. Aucune migration appliquée hors bases de test.

## Décisions (et pourquoi)

| Décision                                                                                                                                     | Justification                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal d'activité **projeté** dans le Core (`dock_activity`) à partir des tables existantes, sans toucher aux transactions des modules      | Zéro risque pour l'économie et les modules validés ; reconstructible ; aucun handler métier rappelé                                                                    |
| `seq` donné sous le verrou de ligne `dock_activity_channels` (… `for update`) tenu jusqu'au commit                                           | Ordre des `seq` = ordre des commits : un lecteur « after N » ne rate jamais une ligne commitée tard (piège Astra §8)                                                   |
| Une ligne qui change (alerte jouée, rédemption terminée, replay) reprend un nouveau `seq`                                                    | Le flux transporte les mises à jour, pas seulement les créations ; le dock remplace par `activity_key`                                                                 |
| Détection des changements par **version** (statuts concaténés) et non par filigrane de date                                                  | Une source commitée tard ou modifiée est toujours rattrapée                                                                                                            |
| Projeteur actif seulement quand quelqu'un lit (scan 1,5 s, arrêt 10 min après la dernière lecture) ; premier scan = 30 jours                 | Pas de charge sans dock ; rattrapage de l'historique au premier usage                                                                                                  |
| Replay = **nouvel `alert_items`** (variante et données figées de l'original), audité dans `dock_replays`                                     | La file d'alertes n'a aucun effet économique (vérifié) ; jamais `receive` (donc jamais Roue/fidélité/chat)                                                             |
| Replay idempotent par clé de clic ; un seul replay en attente par original ; refusé si l'original n'a pas encore joué ou n'a pas d'animation | Protection double clic / deux interfaces ; pas de file qui gonfle                                                                                                      |
| Studio relaie (une seule connexion Core en long-poll) ; le dock est servi sur **un port local dédié** qui n'expose que flux + replay         | Pas d'accès du dock au reste de l'API Studio ; aucun secret Core/Twitch/OBS dans CEF                                                                                   |
| Accès dock par une clé dans le **fragment** de l'URL (non envoyé dans les requêtes/journaux), régénérable dans Studio                        | Simple et adapté à CEF ; la capacité est étroite (lecture + replay visuel). Écart assumé vs l'appairage à usage unique d'Astra (complexité sans gain proportionné ici) |
| Historique 30 jours ; « nouveau » géré localement par le dock (pas d'état « traité » partagé en V1)                                          | Choix par défaut, réversibles                                                                                                                                          |

## Architecture

```
bot / extension / SE(Studio) → modules Core (inchangés) → tables existantes (alert_events, alert_items, cp_redemptions)
   → projeteur Core (dock/service.ts) → dock_activity (+ seq) → GET /v1/studio/dock/:ch/activity | /changes (long-poll)
   → Studio (lot 2 : un relais, cache, curseur) → dock OBS (lot 3 : page locale, port dédié)
Replay : dock → Studio → POST /v1/studio/dock/:ch/alerts/:alert_id/replay → nouvel alert_items → lecteur d'alertes existant
```

## Fichiers

| Fichier                                                                                                                                  | Rôle                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261110120000_obs_dock_lab.sql` / `20261110130000_obs_dock.sql`                                                    | Tables `dock_activity`, `dock_activity_channels`, `dock_replays` ; index `alert_events_recent` (additif) |
| `apps/core-api/src/db/migration-scopes.ts`, `apps/studio/server/src/runtime/local-runtime.ts`, `apps/studio/server/scripts/bonk-lab.mjs` | Listes de migrations                                                                                     |
| `apps/core-api/src/dock/service.ts`                                                                                                      | `DockActivityService` : `scan`, `recent`, `changes`, `replayAlert`                                       |
| `apps/core-api/src/http/dock-routes.ts`                                                                                                  | Routes Production `/v1/studio/dock/*` (credential d'installation) et Lab `/v1/lab/dock/*`                |
| `apps/core-api/src/app.ts`, `http/server.ts`, `index.ts`, `bonk-lab/lab-core.ts`                                                         | Câblage                                                                                                  |
| `apps/core-api/test/dock.test.ts`, `dock.integration.test.ts`                                                                            | Tests                                                                                                    |

## Contrat du flux (Core)

- `GET /activity?limit=&before=&before_seq=` → `{ cursor, activities[], more }` (plus récents d'abord ; même instantané).
- `GET /changes?after=&limit=&wait_ms=` → `{ cursor, activities[] }` par `seq` croissant ; attend jusqu'à 20 s ;
  `reset: true` si `after` > curseur de la chaîne (repartir de `/activity`).
- Activité : `{ activity_key, kind: alert|channel_points, type, occurred_at, data, state, seq }`. `data` = champs
  d'affichage (texte viewer non fiable, à insérer en texte), `state` = statuts (alerte : `outcome`, `alert_id`,
  `alert_status`, `failure`, `replay{alert_id,status,count}` ; points : `status`, `reason`, `twitch_status`).
- `POST /alerts/:alert_id/replay { replay_key: uuid }` → `{ replay_alert_id, created, already_pending? }` ;
  409 `original_not_played_yet`, `replay_key_reused` ; 404 `alert_not_replayable`.

## Tests effectués

- `test/dock.test.ts` (PGlite) 9/9 : projection de tous les événements (animés, absorbés, sous le seuil), données
  d'affichage seulement, changements avec nouveau `seq`, points de chaîne et mises à jour, long-poll, reset, pagination ;
  replay : seules `alert_items` (+1), `dock_replays` (+1) et la projection changent (recensement de toutes les tables),
  idempotence de clé, un seul replay en attente, refus (non joué, sans animation, inconnu, item de replay, autre chaîne),
  statut du replay visible dans le flux.

## Problèmes rencontrés

- Ordre à heure identique : départage par `seq` (ordre de projection), clé de page `(occurred_at, seq)`.

## Reste à faire

- Lot 1 : exécuter `dock.integration.test.ts` (PostgreSQL réel) ; tests de routes (auth, canal) ; suite Core et
  migration-scopes.
- Lot 2 (Studio) : relais `DockHub` (long-poll Core unique, cache borné, curseur, reset), serveur dock sur port dédié
  (page, SSE, POST replay, clé, Host/Origin), panneau Studio (URL à copier, régénérer la clé).
- Lot 3 (page du dock) : fil compact sombre, filtres, « N nouveaux » sans saut, détail, replay discret, états de
  connexion ; tests de rendu (largeurs 240–420 px, XSS, textes longs).
- Lot 4 : robustesse (redémarrages, rafales), documentation utilisateur, livraison (migration Production = GO d'Antoni).
- V1.1 : interactions Raptoru (extension, mini-jeux…) dans la projection.

## Prochaine action

Exécuter `apps/core-api/test/dock.integration.test.ts` sur la base de test locale, puis commencer le lot 2.
