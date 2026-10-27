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
- **V1.1** (27–28/10, branche `feat/obs-dock-v11` depuis `origin/main` `d694dc8`, même worktree) : refonte de la page
  et interactions Raptoru dans la projection. Voir « V1.1 » ci-dessous. **Non livrée** (migration Production additive =
  GO d'Antoni).

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

## V1.1 — refonte et flux enrichi

### Ce qui change pour Antoni

- En-tête compact : « Activité », pastille de connexion (survol = détail), roue crantée. La barre de filtres disparaît.
- Roue crantée → préférences : cases par catégorie, « Tout afficher », « Afficher les coûts des récompenses » (**non**
  par défaut), « Réinitialiser ». Gardées dans le `localStorage` du dock (survivent au redémarrage d'OBS et du dock).
  Une catégorie masquée reste reçue et gardée : la réafficher la montre aussitôt, historique compris. Petit point sur
  la roue quand un filtre est actif.
- Ligne : icône de catégorie (SVG aux formes Lucide, licence ISC) dans une pastille teintée · **TITRE en gras et en
  couleur** (« NOUVEAU FOLLOW », « BONK × 8 », le vrai nom de la récompense ou du son) · note courte (tier, mois,
  viewers…) · icône d'état · pseudo(s) · temps relatif. Au plus une ligne d'aperçu (message, texte TTS). La couleur
  n'est jamais le seul repère : chaque catégorie a sa forme d'icône et son titre écrit.
- États en icônes avec info-bulle et nom accessible : coche verte (fait), croix rouge (échec / résultat inconnu),
  horloge (en attente / en cours / en validation), cercle barré (sans animation, annulé, flop). La raison d'un échec
  est dans l'info-bulle et le détail, jamais sur la ligne.
- Temps : « il y a quelques secondes » (< 1 min), « il y a quelques minutes » (< 5 min), puis 5, 10, 15, 20, 30,
  45 minutes, heures, jours jusqu'à 15, puis « il y a plus de 15 jours ». Heure exacte au survol.
- Détail (clic ou Entrée) seulement s'il apporte quelque chose : message de don / bits / récompense, texte TTS,
  bénéficiaires d'un cadeau communautaire, membres d'un groupe, raison d'un échec. Un follow ou un Bonk seul ne s'ouvre
  pas. Aucun champ technique.
- Replay : inchangé (alertes seulement, deux clics en 3 s, idempotent, zéro effet économique). Le bouton apparaît au
  survol sur le bord droit (toutes les lignes gardent les mêmes colonnes). Jamais pour Bonk, TTS, Soundboard ni
  récompenses.
- Flux chargé : pas de défilement automatique ; les lignes arrivent au-dessus sans déplacer ce qu'on lit (rendu par clé :
  les lignes inchangées gardent leur élément, l'ancrage du navigateur tient la position) ; « ↑ N nouveaux » compte les
  événements visibles arrivés pendant la lecture.

### Catégories et sources (canoniques, aucune nouvelle source ni scrutation)

| Catégorie (couleur)          | Types                                                               | Source projetée                                         |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| Follows (rose)               | `follow`                                                            | `alert_events` / `alert_items` (V1)                     |
| Abos et cadeaux (violet)     | `sub`, `resub`, `gift_targeted`, `gift_community`, `gift_recipient` | idem (bénéficiaires repliés dans le cadeau)             |
| Bits (cyan)                  | `bits`                                                              | idem                                                    |
| Raids (orange)               | `raid`                                                              | idem                                                    |
| Dons (vert)                  | `donation` (StreamElements)                                         | idem                                                    |
| Points de chaîne (ambre)     | `reward` (vrai nom de la récompense)                                | `cp_redemptions` (V1)                                   |
| TTS (bleu)                   | `tts` (texte ≤ 500 caractères, validation)                          | `tts_lab_interactions`                                  |
| Soundboard (turquoise)       | `soundboard` (nom exact du son)                                     | `sound_lab_interactions` (sauf son payé en points)      |
| Bonk (corail)                | `bonk` (emote, salve)                                               | `bonk_lab_interactions` (un tir = une ligne source)     |
| Tombola et Random Ban (gris) | `raffle`, `random_ban` (`!rb` du chat)                              | `lab_raffle_entries`, `rb_requests` (`source = 'chat'`) |

- Clés `ix:<type>:<id>`, `kind = 'interaction'` : migration additive `20261111130000_obs_dock_interactions.sql`
  (jumelle Lab `20261111120000_obs_dock_interactions_lab.sql`) qui élargit le check de `dock_activity.kind`. Retour :
  dans l'en-tête de la migration.
- Une ligne source = une activité ; un changement d'état (accepté → en cours → exécuté / échec / inconnu, validation,
  remboursement) met à jour **la même** activité (version `status|refund_status[|review_status]`), jamais un second
  événement.
- Ce que les points de chaîne ont payé (un son, un Random Ban) reste **une** activité : la rédemption.
- Bonk : `emote.glyph` pour une emote Unicode, sinon `emote.url` affichée en image **uniquement** en https depuis
  `static-cdn.jtvnw.net`, `cdn.7tv.app`, `cdn.betterttv.net`, `cdn.frankerfacez.com` (même liste dans la CSP `img-src`
  du serveur du dock).

### Regroupement (présentation seulement)

- Calculé par la page (`entries()` de `dock-view.js`) à chaque rendu, à partir des activités brutes, **après** les
  filtres ; rien n'est fusionné dans le Core ni en base.
- Peuvent partager une ligne : tous les Bonk ; le **même** son (par `sound.id`) ; tous les TTS. Jamais les alertes, les
  récompenses, la Tombola ni les Random Ban.
- Parcours du plus ancien au plus récent : une activité rejoint la ligne précédente si elle a la même clé de groupe,
  arrive **≤ 90 s** après le dernier déclencheur de la ligne et **≤ 5 min** après le premier. Un événement visible entre
  deux coupe la ligne ; un événement masqué ne la coupe pas.
- Déterministe : tri par (`occurred_at`, `activity_key`) seulement, donc même résultat quels que soient l'ordre
  d'arrivée, les reconnexions, la pagination, les changements d'état ou de filtre. Une ligne est identifiée par son
  premier déclencheur : elle garde sa place et son détail ouvert en grandissant ; charger l'historique ne change pas les
  lignes récentes.
- Titres « BONK × 5 », « Boop × 2 », « TTS × 3 ». Plusieurs viewers : « A et B », « A, B +N » (tous les noms au survol),
  jamais un seul nom. État = le pire des membres (échec > attente > fait), comptes au survol. Le détail liste chaque
  déclencheur (heure exacte, pseudo, emote, état, texte TTS).

### Remboursement depuis le dock (conception seulement, rien de codé)

- Aucun bouton tant qu'il ne fonctionne pas de bout en bout ; il n'y en a donc pas en V1.1.
- Chemin à réutiliser : la commande de modération existante `{ action: 'refund', module: tts|soundboard|bonk,
interaction_id, reason }` (permission `refund.manual`, auditée, idempotente côté module), jamais une écriture parallèle
  dans le Wallet.
- À construire : une route Studio → Core protégée comme le replay (clé du dock, Origin, JSON), limitée aux interactions
  `failed` / `execution_unknown` non remboursées, confirmation en deux clics ; le `refund_status` revient par le flux et
  la ligne se met à jour seule. Points de chaîne : le remboursement Twitch (annuler la rédemption) est un autre chemin.
- Décision produit pour Antoni : qui peut rembourser depuis le dock (lui seul ?) et avec quelle raison.

### Campagnes sponsorisées StreamElements / Streamlabs (recherche, rien de codé)

| Source                        | Statut         | Constat                                                                                                                                              |
| ----------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| SE Astro `channel.activities` | Officiel, flou | Liste les types `sponsorship` / `sponsorshipPassive` **sans charge utile documentée** (docs.streamelements.com/websockets/topics/channel-activities) |
| SE tableau de bord / overlays | UI seulement   | Les campagnes s'affichent dans l'interface SE ; pas d'API publique décrite                                                                           |
| Streamlabs Socket API         | Officiel       | Dons, follows, abos… ; **rien** sur les campagnes sponsorisées (dev.streamlabs.com/docs/socket-api)                                                  |
| Streamlabs, accès partenaires | Incertain      | Rien de public ; Raptoru n'a de toute façon aucune intégration Streamlabs                                                                            |

- Studio est déjà abonné à `channel.tips` (+ modération) avec le jeton SE (`alerts/se-tips.ts`) ; ajouter
  `channel.activities` sur la même connexion serait possible, mais le format n'est pas documenté : **ne pas construire**
  sans charge utile officielle. Pas de scraping.
- Pour aller plus loin : observer en local (sans stockage) un vrai événement `sponsorship` pendant une campagne pour
  connaître son format, puis décider.

### Limites connues

- Préférences propres au dock (origine `127.0.0.1:<port>`) : si le port du dock change, elles reviennent aux défauts.
- Premier scan d'une chaîne : 30 jours d'interactions (2000 lignes par scan, rattrapage aux scans suivants).
- « N nouveaux » compte des événements, pas des lignes (un Bonk qui agrandit un groupe compte pour 1).
- Image d'emote Bonk : chargée depuis le CDN de l'emote (requête sortante du dock vers ce CDN).

## Architecture

```
bot / extension / SE(Studio) → modules Core (inchangés) → tables existantes (alert_events, alert_items, cp_redemptions)
   → projeteur Core (dock/service.ts) → dock_activity (+ seq) → GET /v1/studio/dock/:ch/activity | /changes (long-poll)
   → Studio DockHub (une connexion, cache) → DockServer 127.0.0.1:4110 (page + SSE) → dock OBS (CEF)
Replay : dock → POST /api/replay (4110) → DockHub → POST /v1/studio/dock/:ch/alerts/:alert_id/replay
   → nouvel alert_items → lecteur d'alertes existant (source OBS)
```

## Fichiers

| Fichier                                                                                                                                                                                      | Rôle                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261110120000_obs_dock_lab.sql` / `20261110130000_obs_dock.sql`                                                                                                        | Tables `dock_activity`, `dock_activity_channels`, `dock_replays` ; index `alert_events_recent` (additif) |
| `apps/core-api/src/db/migration-scopes.ts`, `apps/studio/server/src/runtime/local-runtime.ts`, `apps/studio/server/scripts/bonk-lab.mjs`                                                     | Listes de migrations                                                                                     |
| `apps/core-api/src/dock/service.ts`                                                                                                                                                          | `DockActivityService` : `scan`, `recent`, `changes`, `replayAlert`                                       |
| `apps/core-api/src/http/dock-routes.ts`                                                                                                                                                      | Routes Production `/v1/studio/dock/*` (credential d'installation) et Lab `/v1/lab/dock/*`                |
| `apps/core-api/src/app.ts`, `http/server.ts`, `index.ts`, `bonk-lab/lab-core.ts`                                                                                                             | Câblage Core                                                                                             |
| `apps/studio/server/src/dock/hub.ts`                                                                                                                                                         | `DockHub` : suivi unique du flux Core                                                                    |
| `apps/studio/server/src/dock/server.ts`                                                                                                                                                      | `DockServer` (port dédié) et `DockKey`                                                                   |
| `apps/studio/server/src/dock/studio-api.ts`                                                                                                                                                  | `/api/dock` et `/api/dock/key` du panneau Studio                                                         |
| `apps/studio/server/src/index.ts`, `lab-moderation/proxy.ts`                                                                                                                                 | Câblage Studio (création, écoute, arrêt, préfixe Lab)                                                    |
| `apps/studio/server/dock-page/{index.html,dock.css,dock.js,dock-view.js}`                                                                                                                    | La page du dock (`dock-view.js` = partie pure testée)                                                    |
| `apps/studio/web/src/dock-panel.ts`, `alerts-tab.ts`                                                                                                                                         | Panneau « Dock OBS » de l'onglet Alertes                                                                 |
| `apps/studio/desktop/scripts/stage.mjs`, `eslint.config.js`                                                                                                                                  | Empaquetage de la page ; lint navigateur                                                                 |
| V1.1 : `supabase/migrations/20261111120000_obs_dock_interactions_lab.sql` / `20261111130000_obs_dock_interactions.sql`                                                                       | Check `dock_activity.kind` élargi à `interaction`                                                        |
| Tests : `apps/core-api/test/dock.test.ts`, `dock-interactions.test.ts`, `dock.integration.test.ts`, `migration-scopes.test.ts` ; `apps/studio/server/test/dock.test.ts`, `dock-view.test.js` |                                                                                                          |

## Contrats

Core (Studio seulement) :

- `GET /activity?limit=&before=&before_seq=` → `{ cursor, activities[], more }` (plus récents d'abord ; même instantané).
- `GET /changes?after=&limit=&wait_ms=` → `{ cursor, activities[] }` par `seq` croissant ; attend jusqu'à 20 s ;
  `reset: true` si `after` > curseur de la chaîne.
- Activité : `{ activity_key, kind: alert|channel_points|interaction, type, occurred_at, data, state, seq }`.
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
4. Roue crantée : catégories affichées, coûts des récompenses, réinitialisation.

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

V1.1 (28/10) :

- Core `dock-interactions.test.ts` 3/3 (PGlite) : Bonk seul et salve, Soundboard, TTS projetés une fois chacun, données
  d'affichage seulement ; TTS démarré puis terminé = la même activité mise à jour ; son payé en points non dupliqué.
  `dock.test.ts` 10/10 inchangé.
- PostgreSQL 17 réel (conteneur jetable) : `dock.integration`, `migration-main-core.integration` (55 migrations
  Production), `sub-wheel-v2.integration` : 58/58.
- Studio `dock-view.test.js` 30/30 : titres, catégories (icône distincte chacune), états des interactions (demandé, en
  cours, fait, échec, inconnu, annulé, en validation, remboursé), état en icône et raison hors de la ligne, replay jamais
  pour Bonk / TTS / sons / récompenses, échappement partout (TTS, sons, groupes), liste blanche des images d'emote,
  détail seulement s'il est utile, regroupement (Bonk, même son, TTS ; jamais les alertes ; coupé par un visible, pas
  par un masqué ; 90 s / 5 min ; viewers mélangés ; état du groupe ; déterminisme : ordre inverse, permutation,
  changement d'état, horodatages égaux ; clé stable en grandissant ; pagination sans effet sur les lignes récentes),
  préférences (défauts, lecture défensive, filtre sans perte), temps relatifs (chaque palier).
- Aperçu réel Chromium (Playwright, données factices, script hors dépôt) à 240/300/420 px, détail ouvert, préférences
  ouvertes : aucune erreur console, pas de défilement horizontal. Flux chargé simulé (un événement toutes les 300 ms,
  lecteur descendu de 600 px) : la ligne lue ne bouge pas (33 → 34 px), « 13 nouveaux » affiché, retour en haut au clic.
- Pas fait ici : OBS réel (CEF).

## Problèmes rencontrés

- Ordre à heure identique : départage par `seq`, clé de page `(occurred_at, seq)`.
- Port 4101 déjà utilisé par `bonk-lab` : dock sur Studio + 10.
- Un test bloquait sur une attente instantanée (boucle de reprise sans rendre la main) : attente réelle minimale dans
  les tests ; le code réel attend 1–10 s.

## Reste à faire

- V1.1 : livraison (migration Production additive `20261111130000` = **GO d'Antoni**, puis Core, puis Studio) ;
  validation par Antoni dans OBS (CEF : préférences gardées, images d'emote, largeurs).
- Plus tard : remboursement depuis le dock (conception ci-dessus, décision produit) ; état « traité » partagé ; dons SE
  manqués pendant Studio fermé (Astra §6, V2) ; campagnes SE si une charge utile officielle apparaît ; regrouper
  d'autres types (follows en rafale pendant un raid ?) si l'usage le demande.

## Prochaine action

V1.1 : PR ouverte, livraison seulement après le GO d'Antoni.
