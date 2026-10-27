# Dock OBS unifié — suivi du chantier

Document de reprise du chantier « Dock OBS » (démarré le 27/10/2026). À lire avec `docs/REPRISE.md`. Source d'étude :
rapport Astra `C:\Users\Antoni\Documents\Codex\2026-10-27\files-pasted-by-the-user-mission\outputs\ASTRA_DOCK_OBS_DOSSIER_CLAUDE_2026-10-27.md`
(lu intégralement ; architecture « C » retenue, simplifiée ci-dessous).

## Où en est le travail

- Branche `feat/obs-dock`, worktree `C:\Users\Antoni\Documents\raptoru-dock` (depuis `origin/main` `5835fd8`).
- **Lot 1 (Core)** : fait (commit `feat(dock): Lot 1`) — migration, projeteur, flux, replay, routes ; tests PGlite et
  PostgreSQL réel verts.
- **Lot 2 (Studio)** : fait — relais `DockHub`, serveur du dock (port Studio + 10 = **4110**), panneau Studio (onglet
  Alertes → « Dock OBS »).
- **Lot 3 (page du dock)** : V1 faite — fil compact, filtres, « N nouveaux », détail, replay en deux clics, cadeaux
  communautaires repliés, états de connexion. Aperçu vérifié dans Chromium (240/300/420 px, aucune erreur console).
- **Lot 4** : **livré le 27/10** — PR #28 fusionnée (`d1dcdca`), sauvegarde de la base (17:18 UTC), Core déployé avec la
  migration en post-deploy (`DÉPLOYÉ`, santé OK), bot inchangé, Studio **0.1.15** publiée (installateur vérifié).
  Reste : installation par Antoni et validation dans OBS.

## Décisions (et pourquoi)

| Décision                                                                                                                                                        | Justification                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Journal d'activité **projeté** dans le Core (`dock_activity`) à partir des tables existantes, sans toucher aux transactions des modules                         | Zéro risque pour l'économie et les modules validés ; reconstructible ; aucun handler métier rappelé                                  |
| `seq` donné sous le verrou de ligne `dock_activity_channels` (… `for update`) tenu jusqu'au commit                                                              | Ordre des `seq` = ordre des commits : un lecteur « after N » ne rate jamais une ligne commitée tard (piège Astra §8)                 |
| Une ligne qui change (alerte jouée, rédemption terminée, replay) reprend un nouveau `seq`                                                                       | Le flux transporte les mises à jour ; le dock remplace par `activity_key`                                                            |
| Détection des changements par **version** (statuts concaténés), pas par filigrane de date                                                                       | Une source commitée tard ou modifiée est toujours rattrapée                                                                          |
| Projeteur actif seulement quand quelqu'un lit (scan 1,5 s, arrêt 10 min après la dernière lecture) ; premier scan = 30 jours                                    | Pas de charge sans dock ; rattrapage de l'historique au premier usage                                                                |
| Replay = **nouvel `alert_items`** (variante et données figées de l'original), audité dans `dock_replays`                                                        | La file d'alertes n'a aucun effet économique (vérifié) ; jamais `receive` (donc jamais Roue/fidélité/chat)                           |
| Replay idempotent par clé de clic ; un seul replay en attente par original ; refusé si l'original n'a pas encore joué ou n'a pas d'animation                    | Doubles clics, deux interfaces, réseau rejoué                                                                                        |
| Studio relaie (une seule connexion Core en long-poll, cache 500, curseur, reprise) ; il ne suit le Core que si un dock est ouvert (+60 s)                       | Une connexion quel que soit le nombre de docks ; aucune charge sans dock                                                             |
| Le dock est servi sur **un port local dédié** (Studio + 10 ; `DOCK_PORT`) qui n'expose que la page, le flux, l'historique et le replay                          | L'origine du dock ne peut appeler aucune autre API Studio ; 4101 est pris par `bonk-lab`                                             |
| Accès par une clé dans le **fragment** de l'URL (`#key=`), envoyée en en-tête `x-dock-key`, comparée en temps constant ; régénérable dans Studio (docks fermés) | Pas dans les journaux ni le Referer ; capacité étroite (lecture + replay visuel). Écart assumé vs l'appairage à usage unique d'Astra |
| Host vérifié (anti-rebinding), Origin + JSON exigés pour le replay, CSP stricte (`script-src 'self'`, pas d'inline), nosniff, no-referrer                       | Défense en profondeur dans CEF                                                                                                       |
| Flux = SSE lu par `fetch` (EventSource ne peut pas envoyer l'en-tête) ; client lent coupé (512 Kio) puis reconnexion + instantané                               | Pas de mémoire illimitée                                                                                                             |
| Texte viewer toujours échappé (`esc`) ; jamais d'HTML viewer                                                                                                    | Pseudos, messages, titres de récompense non fiables                                                                                  |
| Bénéficiaires d'un cadeau communautaire (`absorbed` + `community_gift_id`) repliés dans la ligne du cadeau                                                      | Une ligne par lot ; recommandation Astra                                                                                             |
| Historique 30 jours ; « nouveau » local au dock (pas d'état « traité » partagé en V1)                                                                           | Choix par défaut, réversibles                                                                                                        |

## Architecture

```
bot / extension / SE(Studio) → modules Core (inchangés) → tables existantes (alert_events, alert_items, cp_redemptions)
   → projeteur Core (dock/service.ts) → dock_activity (+ seq) → GET /v1/studio/dock/:ch/activity | /changes (long-poll)
   → Studio DockHub (une connexion, cache) → DockServer 127.0.0.1:4110 (page + SSE) → dock OBS (CEF)
Replay : dock → POST /api/replay (4110) → DockHub → POST /v1/studio/dock/:ch/alerts/:alert_id/replay
   → nouvel alert_items → lecteur d'alertes existant (source OBS)
```

## Fichiers

| Fichier                                                                                                                                                         | Rôle                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261110120000_obs_dock_lab.sql` / `20261110130000_obs_dock.sql`                                                                           | Tables `dock_activity`, `dock_activity_channels`, `dock_replays` ; index `alert_events_recent` (additif) |
| `apps/core-api/src/db/migration-scopes.ts`, `apps/studio/server/src/runtime/local-runtime.ts`, `apps/studio/server/scripts/bonk-lab.mjs`                        | Listes de migrations                                                                                     |
| `apps/core-api/src/dock/service.ts`                                                                                                                             | `DockActivityService` : `scan`, `recent`, `changes`, `replayAlert`                                       |
| `apps/core-api/src/http/dock-routes.ts`                                                                                                                         | Routes Production `/v1/studio/dock/*` (credential d'installation) et Lab `/v1/lab/dock/*`                |
| `apps/core-api/src/app.ts`, `http/server.ts`, `index.ts`, `bonk-lab/lab-core.ts`                                                                                | Câblage Core                                                                                             |
| `apps/studio/server/src/dock/hub.ts`                                                                                                                            | `DockHub` : suivi unique du flux Core                                                                    |
| `apps/studio/server/src/dock/server.ts`                                                                                                                         | `DockServer` (port dédié) et `DockKey`                                                                   |
| `apps/studio/server/src/dock/studio-api.ts`                                                                                                                     | `/api/dock` et `/api/dock/key` du panneau Studio                                                         |
| `apps/studio/server/src/index.ts`, `lab-moderation/proxy.ts`                                                                                                    | Câblage Studio (création, écoute, arrêt, préfixe Lab)                                                    |
| `apps/studio/server/dock-page/{index.html,dock.css,dock.js,dock-view.js}`                                                                                       | La page du dock (`dock-view.js` = partie pure testée)                                                    |
| `apps/studio/web/src/dock-panel.ts`, `alerts-tab.ts`                                                                                                            | Panneau « Dock OBS » de l'onglet Alertes                                                                 |
| `apps/studio/desktop/scripts/stage.mjs`, `eslint.config.js`                                                                                                     | Empaquetage de la page ; lint navigateur                                                                 |
| Tests : `apps/core-api/test/dock.test.ts`, `dock.integration.test.ts`, `migration-scopes.test.ts` ; `apps/studio/server/test/dock.test.ts`, `dock-view.test.js` |                                                                                                          |

## Contrats

Core (Studio seulement) :

- `GET /activity?limit=&before=&before_seq=` → `{ cursor, activities[], more }` (plus récents d'abord ; même instantané).
- `GET /changes?after=&limit=&wait_ms=` → `{ cursor, activities[] }` par `seq` croissant ; attend jusqu'à 20 s ;
  `reset: true` si `after` > curseur de la chaîne.
- Activité : `{ activity_key, kind: alert|channel_points, type, occurred_at, data, state, seq }`.
- `POST /alerts/:alert_id/replay { replay_key: uuid }` → `{ replay_alert_id, created, already_pending? }` ; 409
  `original_not_played_yet` / `replay_key_reused` ; 404 `alert_not_replayable`.

Dock (127.0.0.1:4110, en-tête `x-dock-key`) : `GET /api/stream` (SSE : `snapshot`, `upsert`, `status`), `GET
/api/history?before=&before_seq=`, `POST /api/replay { alert_id, replay_key }` (Origin du dock + JSON).

Studio : `GET /api/dock` → `{ available, reason, url, clients, feed }` ; `POST /api/dock/key`.

## Utilisation (pour Antoni)

1. Studio → onglet **Alertes** → section **Dock OBS** → **Copier** l'URL.
2. OBS → **Docks** → **Docks de navigateur personnalisés** → nom « Raptoru », URL collée → Appliquer.
3. Le dock suit les événements tant que Studio est ouvert. Rejouer : survoler une alerte → ⟲ → **Rejouer ?** (second
   clic dans les 3 s). Le replay rejoue l'animation seulement : aucun jeton, droit, Roue, fidélité ni message chat.

## Tests effectués

- Core `dock.test.ts` (PGlite) 10/10 : projection de tous les événements (animés, absorbés, sous le seuil), données
  d'affichage seulement, changements avec nouveau `seq`, points de chaîne et mises à jour, long-poll, reset, pagination ;
  replay : recensement de toutes les tables (seules la file d'alertes +1, `dock_replays` +1 et la projection changent),
  clé idempotente, un seul replay en attente, refus (non joué, sans animation, inconnu, item de replay, autre chaîne),
  statut du replay dans le flux ; routes (credential, canal, requêtes et corps validés).
- Core `dock.integration.test.ts` (PostgreSQL 17 réel, deux Cores) 2/2 : lecteur sans trou pendant réceptions et scans
  concurrents ; quatre clics simultanés → un seul replay.
- Core `migration-scopes.test.ts` 22/22 (nouvelle migration déclarée « après 25/10 »).
- Studio `dock.test.ts` 8/8 : relais (instantané, mises à jour dans l'ordre, Core injoignable puis rétabli, reset, cache
  borné, arrêt sans dock) ; serveur (en-têtes, clé, Host, chemins, flux, nouvelle clé, replay origine/JSON/uuid, refus
  du Core relayé, historique, API du panneau).
- Studio `dock-view.test.js` 15/15 : textes FR de chaque type, monnaie d'origine, états, bouton de replay, échappement
  (pseudo, message, titre, bénéficiaire), textes très longs, ordre, SSE, panneau (clé masquée), repliage des cadeaux.
- Aperçu réel Chromium (Playwright, données factices) à 240/300/420 px : aucune erreur console, pas de défilement
  horizontal, lignes compactes.
- Typecheck, lint et build globaux OK ; suites complètes : bot 285, desktop 34, Core 1188 (+ `sub-wheel-r2` intermittent,
  vert seul), Studio 758 (+ plantage Windows connu de `prod-transport`, vert seul) ; intégration PostgreSQL réelle verte
  (les tests de migration comptent la nouvelle migration). CI de la PR #28 verte.

## Problèmes rencontrés

- Ordre à heure identique : départage par `seq`, clé de page `(occurred_at, seq)`.
- Port 4101 déjà utilisé par `bonk-lab` : dock sur Studio + 10.
- Un test bloquait sur une attente instantanée (boucle de reprise sans rendre la main) : attente réelle minimale dans
  les tests ; le code réel attend 1–10 s.

## Reste à faire

- Lot 4 : suites complètes Core/Studio/bot, lint global, build ; doc utilisateur courte ; PR ; livraison (migration
  Production additive = **GO d'Antoni**, puis Core, puis Studio ; validation manuelle par Antoni dans OBS).
- À observer en vrai : CEF d'OBS (clé conservée après redémarrage, `fetch` en flux, largeur), lecteur d'alertes à
  l'antenne pour le replay.
- V1.1 (après retour d'usage) : interactions Raptoru (extension, mini-jeux…) dans la projection ; état « traité »
  partagé ; dons SE manqués pendant Studio fermé (Astra §6, V2).

## Prochaine action

Antoni installe Studio 0.1.15, connecte le dock (« Utilisation ») et le valide en vrai ; V1.1 après son retour.
