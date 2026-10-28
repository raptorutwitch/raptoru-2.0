# Dock OBS — référence

**Module clos.** Dock OBS **V1.2 validé à 100 % par Antoni dans son vrai OBS** (28/10/2026, Studio 0.1.17 installé).
Ce document décrit l'état final ; les étapes V1 → V1.2 sont résumées au § 1. Aucun travail n'est engagé : les pistes
du § 9 ne s'ouvrent que sur demande d'Antoni.

Source d'étude initiale : rapport Astra
`C:\Users\Antoni\Documents\Codex\2026-10-27\files-pasted-by-the-user-mission\outputs\ASTRA_DOCK_OBS_DOSSIER_CLAUDE_2026-10-27.md`
(architecture « C », simplifiée).

## 1. Livraisons

| Version  | Date  | PR (merge)               | Core déployé                                                     | Studio | Contenu                                                                                                                    |
| -------- | ----- | ------------------------ | ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| V1       | 27/10 | #28 (`d1dcdca`), doc #29 | `d1dcdca` + migration `20261110130000_obs_dock.sql`              | 0.1.15 | journal d'activité Core, relais Studio, page du dock, rejeu visuel des alertes                                             |
| V1.1     | 27/10 | #30 (`190bc0a`), doc #31 | `190bc0a` + migration `20261111130000_obs_dock_interactions.sql` | 0.1.16 | refonte visuelle, préférences, interactions Raptoru (Bonk, Soundboard, TTS, Tombola, `!rb`)                                |
| **V1.2** | 28/10 | #32 (`dc06344`), doc #33 | `dc06344`, **sans migration**                                    | 0.1.17 | identité par famille, avatars, rejeu en un clic, Bonk seul regroupé, filtres détaillés, sélection et corbeille d'affichage |

Chaque livraison : sauvegarde de la base avant une migration, Core seul (bot jamais touché, `4ba9243`), Studio publié
par le workflow GitHub avec test de mise à jour (fichiers utilisateur identiques). L'URL et la clé du dock n'ont jamais
changé ; les préférences V1.1 ont été reprises en V1.2.

**Validation** : V1 utilisée en vrai (rejeu compris) avant la V1.1 ; **V1.2 testée et validée à 100 % par Antoni dans
OBS le 28/10**. Cette validation porte sur l'usage réel ; les situations rares (réseau lent, doubles clics, reconnexions,
désordre) sont couvertes par les tests automatiques du § 7, pas par cette validation.

## 2. Ce que fait le dock (V1.2)

### Événements affichés (sources canoniques, aucune nouvelle source ni scrutation)

| Famille (couleur, icône Lucide)                                  | Types                                                                         | Source projetée par le Core                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| Follow (rouge rosé, cœur plein)                                  | `follow`                                                                      | `alert_events` / `alert_items`                        |
| Sub (violet, étoile pleine) · Resub (violet clair, médaille)     | `sub`, `resub`                                                                | idem                                                  |
| Subgift (fuchsia, cadeau)                                        | `gift_targeted`, `gift_community` (+ bénéficiaires repliés), `gift_recipient` | idem                                                  |
| Bits (cyan, diamant) · Raid (orange, fusée) · Don (vert, pièces) | `bits`, `raid`, `donation` (StreamElements)                                   | idem                                                  |
| Points de chaîne (or, étincelle)                                 | `reward` (vrai nom de la récompense)                                          | `cp_redemptions`                                      |
| TTS (bleu, bulle)                                                | `tts` (texte ≤ 500 caractères, validation)                                    | `tts_lab_interactions`                                |
| Soundboard (vert lime, haut-parleur)                             | `soundboard` (nom du son en note)                                             | `sound_lab_interactions` (sauf un son payé en points) |
| Bonk (cuivre, marteau)                                           | `bonk` (emote, salve)                                                         | `bonk_lab_interactions` (un tir = une ligne source)   |
| Random Ban (rouge, marteau de juge)                              | `random_ban` (`!rb` du chat)                                                  | `rb_requests` (`source = 'chat'`)                     |
| Tombola (turquoise, ticket)                                      | `raffle` (participation)                                                      | `lab_raffle_entries`                                  |

- Une ligne source = une activité ; un changement d'état (accepté → en cours → exécuté / échec / inconnu, validation,
  remboursement, alerte jouée, rejeu) met à jour **la même** activité, jamais un second événement.
- Ce que les points de chaîne ont payé (un son, un Random Ban) reste **une** activité : la rédemption.

### Vignettes

- Une carte par événement, teintée par sa famille (léger dégradé depuis la gauche, fin liseré, icône et libellé
  colorés, survol un peu plus lumineux). La couleur n'est jamais le seul repère : icône et libellé écrits.
- Hiérarchie : **[avatar] [icône + LIBELLÉ] [pseudo] … [état] [rejeu]**, puis **[temps · note]** discret (tier, mois,
  nom du son, emote, cible, coût si demandé), puis le texte du viewer sur une ligne s'il y en a un.
- Libellés : FOLLOW, SUB, RESUB, SUBGIFT (× N), 1 500 BITS, RAID, DON 10,00 €, le vrai nom de la récompense (sa casse),
  TTS, SOUNDBOARD, BONK, RANDOM BAN, TOMBOLA. Un libellé générique n'est jamais coupé : le pseudo cède (nom complet au
  survol) ; le nom d'une récompense peut être coupé (nom complet au survol).
- Pseudo semi-gras. Temps : « à l'instant », « 3 min », « 2 h », « 3 j » ; date et heure exactes au survol.
- États en icônes avec info-bulle : coche (fait), croix (échec / résultat inconnu), horloge (en attente / en cours /
  en validation), cercle barré (sans animation, annulé, flop). La raison d'un échec n'est jamais sur la ligne.
- Nouvel événement : fondu court puis liseré lumineux une minute ; rien d'animé en continu ; aucune animation avec
  « réduire les animations ».
- Détails seulement s'ils ajoutent quelque chose : Bonks d'une salve, bénéficiaires d'un cadeau, raison d'un échec ; un
  texte de viewer coupé sur sa ligne s'ouvre en entier. Rien à ouvrir pour un follow, un sub, un Bonk seul, un son.

### Avatars

- Le Core joint à chaque acteur la photo du cache Twitch existant (`lab_viewer_avatars`, Helix Get Users par 100 avec le
  jeton d'application déjà utilisé par Votekick et la Tombola, `raffle-lab/avatars.ts`). La photo fait partie de la
  version de la ligne : trouvée plus tard, elle ramène la ligne dans le flux à sa place.
- Après un scan, les viewers sans photo sont demandés au cache en arrière-plan (au plus 100 par scan, jamais attendu ;
  24 h de validité, 1 h avant de réessayer un échec). La réception des événements ne dépend jamais des images.
- Page : seules les URL https de `static-cdn.jtvnw.net` sont affichées ; avatar de taille fixe (aucun décalage),
  initiale en attendant ou si la photo échoue, icône de la famille pour un anonyme, nombre de viewers pour une salve.

### Rejeu des alertes (un clic)

- Seulement pour une alerte jouée (ou en échec / expirée) sans rejeu en attente ; jamais pour Bonk, TTS, Soundboard,
  récompenses. Un clic : bouton verrouillé pendant la demande, coche une fois acceptée, message en cas de refus.
- Garanties : rejeu = **nouvel `alert_items`** (variante et données figées de l'original), audité dans `dock_replays` ;
  jamais `receive` (donc jamais Roue, fidélité, chat, jetons, droits ou paiements) ; clé d'idempotence par intention ;
  un seul rejeu en attente par original ; refusé si l'original n'a pas joué ou n'a pas d'animation.

### Regroupement : les Bonks seulement

- Bonks consécutifs → « BONK × N » : ≤ 90 s entre deux, ≤ 5 min depuis le premier, coupé par tout autre événement
  visible (jamais par un masqué), déterministe (tri par horodatage et clé), ligne identifiée par son premier Bonk.
  Plusieurs viewers : « A et B » / « A, B +N », « N viewers » en note, le détail liste chaque Bonk.
- Tout le reste (TTS, sons, Random Ban, Tombola, récompenses, alertes) : une ligne chacun. Le cadeau communautaire reste
  une ligne (un seul événement métier).
- Présentation uniquement : rien n'est fusionné dans le Core ni en base.

### Préférences (roue crantée)

- Treize filtres indépendants en trois groupes (case de groupe à trois états) : **Chaîne Twitch** (Follows, Subs,
  Resubs, Subgifts, Bits, Raids, Dons) · **Points de chaîne** (toutes, puis une par une, plus « Afficher les coûts des
  récompenses », **non** par défaut) · **Interactions Raptoru** (TTS, Soundboard, Bonk, Random Ban, Tombola).
  « Tout afficher », « Tout masquer », « Réinitialiser ».
- Récompenses une par une par leur **identifiant Twitch stable** (liste des récompenses vues, 200 au plus) : une
  récompense renommée garde son choix.
- `localStorage` du dock, clé `dock.prefs` (version 2 ; les préférences V1.1 sont reprises). Affichage seulement : un
  événement masqué reste reçu, traité, gardé dans l'historique.

### Sélection et corbeille d'affichage

- Ctrl + clic (ajouter / retirer), Maj + clic (plage), bouton « Sélectionner » (un clic sélectionne) ; clavier : Espace,
  Suppr (masquer), Échap. Dès qu'une sélection existe, un clic sélectionne au lieu d'ouvrir ; le rejeu reste à part.
- « Masquer » (ou la corbeille de l'en-tête) envoie la sélection dans la **corbeille d'affichage** ; « Annuler » 7 s.
  Une salve masquée masque tous ses Bonks, gardés un par un (jamais réapparus après une recomposition).
- Corbeille (`dock.trash`, `localStorage`, 31 jours et 5 000 éléments au plus) : restaurer un élément, une salve ou un
  seul de ses Bonks, « Tout restaurer », « Vider la corbeille » (confirmation ; éléments masqués définitivement dans ce
  dock). Compteur sur l'icône.
- **Jamais une suppression** : aucun événement Core, alerte, transaction, jeton, achat, journal ou donnée Twitch n'est
  touché. Préférences, corbeille, historique canonique et actions métier sont séparés.

### Flux, défilement, connexion

- Pas de défilement automatique : les lignes arrivent au-dessus sans déplacer ce qu'on lit (rendu par clé, ancrage du
  navigateur) ; « ↑ N nouveaux » ; « Revenir aux récents » quand on est descendu loin.
- Pastille de connexion dans l'en-tête et bandeau quand Studio ou le Core est injoignable ; reprise automatique ;
  historique ancien par « Charger les plus anciens ».

## 3. Architecture

```
bot / extension / SE (Studio) → modules Core (inchangés) → tables existantes
   (alert_events, alert_items, cp_redemptions, bonk/sound/tts_lab_interactions, lab_raffle_entries, rb_requests,
    lab_viewer_avatars pour les photos)
   → projeteur Core (dock/service.ts) → dock_activity (+ seq) → GET /v1/studio/dock/:ch/activity | /changes (long-poll)
   → Studio DockHub (une connexion, cache) → DockServer 127.0.0.1:4110 (page + SSE) → dock navigateur OBS (CEF)
Rejeu : dock → POST /api/replay (4110) → DockHub → POST /v1/studio/dock/:ch/alerts/:alert_id/replay
   → nouvel alert_items → lecteur d'alertes existant (source OBS)
```

| Décision                                                                                                                                                                                              | Justification                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Journal **projeté** dans le Core (`dock_activity`) depuis les tables existantes, en lecture seule                                                                                                     | zéro risque pour l'économie et les modules ; reconstructible ; aucun handler métier rappelé   |
| `seq` donné sous le verrou `dock_activity_channels` (`for update`) tenu jusqu'au commit                                                                                                               | ordre des `seq` = ordre des commits : un lecteur « after N » ne rate jamais une ligne tardive |
| Changements détectés par **version** (statuts concaténés, photo comprise) ; une ligne modifiée reprend un nouveau `seq`                                                                               | une source commitée tard ou modifiée est toujours rattrapée ; le dock remplace par clé        |
| Projeteur actif seulement quand un dock lit (scan 1,5 s, arrêt 10 min après la dernière lecture) ; premier scan 30 jours, puis fenêtre de 24 h                                                        | aucune charge sans dock                                                                       |
| Studio relaie (une connexion Core en long-poll, cache 500, curseur, reprise 1–10 s), seulement si un dock est ouvert (+60 s)                                                                          | une connexion quel que soit le nombre de docks                                                |
| Port local dédié (Studio + 10 = **4110**, `DOCK_PORT`) qui n'expose que page, flux, historique, rejeu                                                                                                 | l'origine du dock ne peut appeler aucune autre API Studio ; 4101 est pris par `bonk-lab`      |
| Clé dans le **fragment** de l'URL (`#key=`), en-tête `x-dock-key`, comparaison en temps constant, régénérable dans Studio ; stockée dans le dossier d'exécution de Studio (`<runtime>/dock/key.json`) | absente des journaux et du Referer ; conservée par les mises à jour de Studio                 |
| Host vérifié, Origin + JSON pour le rejeu, CSP stricte (`script-src 'self'`, images limitées aux CDN Twitch / 7TV / BTTV / FFZ), nosniff, no-referrer                                                 | défense en profondeur dans CEF                                                                |
| Flux SSE lu par `fetch` ; client lent coupé (512 Kio) puis reconnexion + instantané                                                                                                                   | pas de mémoire illimitée                                                                      |
| Texte viewer toujours échappé ; jamais d'HTML viewer                                                                                                                                                  | pseudos, messages, noms non fiables                                                           |
| Préférences et corbeille dans le `localStorage` du dock, pas en base                                                                                                                                  | affichage propre à ce dock ; aucune migration ; aucune donnée métier touchée                  |

## 4. Contrats

Core (Studio seulement, credential d'installation ; Lab : `/v1/lab/dock/*`) :

- `GET /v1/studio/dock/:ch/activity?limit=&before=&before_seq=` → `{ cursor, activities[], more }` (plus récents
  d'abord, même instantané).
- `GET /v1/studio/dock/:ch/changes?after=&limit=&wait_ms=` → `{ cursor, activities[] }` par `seq` croissant ; attend
  jusqu'à 20 s ; `reset: true` si `after` dépasse le curseur.
- Activité : `{ activity_key, kind: alert | channel_points | interaction, type, occurred_at, data, state, seq }` ;
  `data.actor.avatar` quand une photo est connue ; clés `alert:…`, `cp:…`, `ix:<type>:<id>`.
- `POST /v1/studio/dock/:ch/alerts/:alert_id/replay { replay_key: uuid }` → `{ replay_alert_id, created,
already_pending? }` ; 409 `original_not_played_yet` / `replay_key_reused` ; 404 `alert_not_replayable`.

Dock (127.0.0.1:4110, en-tête `x-dock-key`) : `GET /api/stream` (SSE `snapshot`, `upsert`, `status`),
`GET /api/history?before=&before_seq=`, `POST /api/replay { alert_id, replay_key }` (Origin du dock + JSON).

Studio : `GET /api/dock` → `{ available, reason, url, clients, feed }` ; `POST /api/dock/key` (nouvelle clé).

## 5. Fichiers

| Fichier                                                                                                                            | Rôle                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261110120000_obs_dock_lab.sql` / `20261110130000_obs_dock.sql`                                              | tables `dock_activity`, `dock_activity_channels`, `dock_replays` ; index `alert_events_recent` |
| `supabase/migrations/20261111120000_obs_dock_interactions_lab.sql` / `20261111130000_obs_dock_interactions.sql`                    | check `dock_activity.kind` élargi à `interaction` (retour arrière dans l'en-tête)              |
| `apps/core-api/src/dock/service.ts`                                                                                                | `DockActivityService` : projection, photos, `recent`, `changes`, `replayAlert`                 |
| `apps/core-api/src/http/dock-routes.ts` ; `app.ts`, `http/server.ts`, `index.ts`, `ext/public-frontier.ts`, `bonk-lab/lab-core.ts` | routes et câblage (dont le branchement du cache de photos)                                     |
| `apps/studio/server/src/dock/{hub,server,studio-api}.ts` ; `src/index.ts`, `lab-moderation/proxy.ts`                               | relais, serveur dédié et clé, API du panneau, câblage                                          |
| `apps/studio/server/dock-page/{index.html,dock.css,dock.js,dock-view.js}`                                                          | la page (`dock-view.js` = partie pure testée)                                                  |
| `apps/studio/web/src/dock-panel.ts`, `alerts-tab.ts`                                                                               | panneau « Dock OBS » (onglet Alertes)                                                          |
| `apps/studio/desktop/scripts/stage.mjs`, `eslint.config.js`                                                                        | empaquetage, lint navigateur                                                                   |
| Tests Core : `test/dock.test.ts`, `dock-interactions.test.ts`, `dock.integration.test.ts`, `migration-scopes.test.ts`              |                                                                                                |
| Tests Studio : `test/dock.test.ts`, `test/dock-view.test.js`, `e2e/dock.e2e.ts`                                                    |                                                                                                |

## 6. Utilisation (pour Antoni)

1. Studio → **Alertes** → **Dock OBS** → **Copier** l'URL (déjà faite : le dock « Raptoru » d'OBS l'utilise).
2. OBS → Docks → Docks de navigateur personnalisés → URL collée. Après une mise à jour de Studio : clic droit dans le
   dock → Actualiser.
3. Rejouer une alerte : survoler → ⟲ (un clic) — l'animation seulement.
4. Roue crantée : filtres, récompenses une par une, coûts, réinitialisation.
5. Nettoyer le fil : Ctrl + clic / Maj + clic → Masquer ; corbeille de l'en-tête pour restaurer.

## 7. Tests automatiques (distincts de la validation réelle)

- Core : `dock.test.ts` 10/10 (projection de tous les événements, changements, points de chaîne, long-poll, reset,
  pagination ; rejeu : seules la file d'alertes, `dock_replays` et la projection changent, idempotence, refus, routes),
  `dock-interactions.test.ts` 4/4 (interactions projetées une fois, mise à jour en place, son payé en points non
  dupliqué, photos), `dock.integration.test.ts` 2/2 sur PostgreSQL réel (lecteur sans trou pendant des scans concurrents,
  quatre clics simultanés → un seul rejeu).
- Studio : `dock.test.ts` 8/8 (relais, reprise, cache borné, serveur : en-têtes, clé, Host, flux, rejeu, historique),
  `dock-view.test.js` 40/40 (familles, libellés, avatars, états, rejeu, échappement, détails, regroupement Bonk seul et
  déterministe, préférences et reprise V1.1, corbeille bornée, plage de sélection, temps), `e2e/dock.e2e.ts` 4/4 dans
  Chromium (rejeu : double clic + clic sous réponse lente = une requête ; sélection Ctrl / Maj ; corbeille et
  préférences après rechargement).
- Aperçus Chromium à 240 / 300 / 420 px et flux chargé simulé (la ligne lue ne bouge pas).

## 8. Limites connues

- Préférences et corbeille propres à ce dock (origine `127.0.0.1:<port>`) : un autre dock ou un autre port repart des
  défauts.
- Premier scan d'un Core : 30 jours, 2 000 lignes par source et par scan (les plus anciennes d'abord), puis 24 h : au-delà
  de 2 000 interactions sur 30 jours, une partie de l'historique de plus de 24 h peut manquer dans le dock (rien d'autre).
- Un viewer jamais vu s'affiche d'abord avec son initiale ; Lab : pas de photos (viewers simulés).
- « N nouveaux » compte des événements, pas des lignes.
- Images d'emotes et photos chargées depuis les CDN (requêtes sortantes du dock).

## 9. Pistes futures (non engagées — seulement sur demande d'Antoni)

- **Remboursement depuis le dock** (conception, rien de codé) : réutiliser la commande de modération existante
  `{ action: 'refund', module: tts | soundboard | bonk, interaction_id, reason }` (permission `refund.manual`,
  auditée, idempotente) via une route protégée comme le rejeu, limitée aux interactions `failed` /
  `execution_unknown` non remboursées ; points de chaîne = autre chemin (annulation Twitch, permissions et limites
  Twitch à vérifier). Décision produit à prendre : qui peut rembourser, avec quelle raison.
- **Campagnes sponsorisées** : SE Astro `channel.activities` liste `sponsorship` / `sponsorshipPassive` sans charge
  utile documentée (docs.streamelements.com/websockets/topics/channel-activities) ; Streamlabs Socket API : rien
  (dev.streamlabs.com/docs/socket-api) ; Raptoru n'a aucune intégration Streamlabs. Ne pas construire sans format
  officiel ; pas de scraping. Option : observer en local un vrai événement pendant une campagne, puis décider.
- Évolutions après plusieurs streams d'usage ; état « traité » partagé ; dons SE manqués pendant que Studio est fermé.

## 10. Notes de développement

- Ordre à heure identique : départage par `seq`, page `(occurred_at, seq)`.
- Port 4101 pris par `bonk-lab` : dock sur Studio + 10.
- Au déploiement d'un Core dont la formule de version change (V1.2 : photo), les lignes récentes sont reprojetées une
  fois ; un retour au Core précédent fait de même, sans autre effet.
- Test Studio local `sub-wheel-v2-studio` « Lab bug » (délai de 50 ms) : échoue sur le PC d'Antoni même sans le dock,
  vert en CI.
