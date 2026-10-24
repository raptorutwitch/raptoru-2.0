# Spotify V2 — « Choisi la prochaine musique ! » sans SAMMI

État (24/10) : **développé et testé en Lab (simulateur), non commité, non validé** — branche `feat/spotify-v2`, worktree
`C:\Users\Antoni\Documents\raptoru-spotify`. Rien n'est déployé, aucune récompense Twitch créée, aucun appel réel à
Spotify. Mise en service : § 12 (chaque étape sur GO). Suivi global : [ROADMAP.md](ROADMAP.md).

Référence métier : l'ancien service Node « Spotify V2 » du pont SAMMI, en production du 25/08 au 18/10/2026
(`Documents\Raptoru\CANONICAL_WORKSPACE\extension\spotify-v2\`, ses tests, le deck `SPOTIFY_ULTIMATE`, l'historique
`RUNTIME\spotify-v2\history.json`). Les règles, seuils et textes ci-dessous en sont repris ; chaque écart est listé § 9.

## 1. Répartition

| Couche     | Rôle                                                                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core**   | autorité : réglages, demandes et leur cycle de vie, file logique, limites, cooldown, idempotence, historique, commandes chat, décisions de modération, remboursements (intention), intégration Points de chaîne                                                       |
| **Studio** | seul à parler à Spotify : connexion OAuth sur le PC, jetons chiffrés localement, gestionnaire unique des appels (quota), recherche et score, ajout à la file, surveillance de la lecture, passage automatique des demandes annulées, supervision, panneau « Musique » |
| **Bot**    | reçoit les rédemptions (EventSub) et le chat comme aujourd'hui ; exécute côté Twitch les remboursements (statut CANCELED, jamais FULFILLED) et la création de la récompense, décidés par le Core                                                                      |

Aucun pont SAMMI, aucune seconde source de vérité, aucun polling Spotify ailleurs que dans Studio.

## 2. Demande d'un viewer (récompense « Choisi la prochaine musique ! », 1 000 points, texte obligatoire)

Points de chaîne → règle de la récompense → action `interaction: song_request` (nouvelle interaction native).

1. **Doublon** : une rédemption déjà reçue (même identifiant Twitch) ne crée rien (`DUPLICATE_REDEEM`).
2. **Module coupé / Studio absent / Spotify non connecté** : refus avant toute recherche, remboursé.
3. **Cooldown** (10 min) : refusé si la dernière demande du viewer **encore en attente de lecture** a été mise en file
   il y a moins de 10 min. Il tombe dès qu'elle commence à jouer (règle historique : la dernière demande à l'état
   `QUEUED`). Une demande du même viewer en cours de traitement compte comme en file à son instant de réception
   (équivalent de la sérialisation par viewer de l'ancien service).
4. **Demandes en attente** : au plus 2 par viewer (en file, en traitement, ou au résultat incertain mais prouvé en file ;
   la musique en cours ne compte pas).
5. **Référence** : lien `open.spotify.com/…/track/<id>` (y compris `intl-xx`), `spotify:track:<id>`, ou texte libre.
   Album, playlist, épisode, autre site → `INVALID_REFERENCE` ; vide → `INVALID_INPUT`.
6. **Recherche** (Studio) : `GET /search?type=track&limit=10` puis score historique déterministe
   (`0,55 × titre + 0,30 × artiste + 0,15 × global`, bonus de phrase, variantes live/remix…, regroupement des
   enregistrements équivalents) ; < 0,68 → `NOT_FOUND` ; marge < 0,08 ou même titre sans artiste → `AMBIGUOUS`.
   Le gagnant est relu (`GET /tracks/{id}`) pour sa durée.
7. **Durée** > 10 min → `TOO_LONG`.
8. **Appareil** : premier appareil Spotify actif et non restreint → sinon `NO_DEVICE`.
9. **Ajout** : `POST /me/player/queue`. Toute réponse autre que 204 (Spotify répondait 200) est « incertaine » : la file
   est relue (250, 500, 750, 1 000 ms) ; titre présent → `QUEUED` (confirmé par relecture) ; sinon `UNKNOWN` sans
   nouvelle tentative automatique.

Résultat : `QUEUED` → message de succès, la réclamation reste **PENDING** sur Twitch ; refus ou échec certain →
message + réclamation annulée (CANCELED = remboursement Twitch) ; `UNKNOWN` → message « résultat inconnu », réclamation
PENDING, rien d'autre (jamais de double ajout ni de double remboursement ; visible « à vérifier » dans Studio). Statuts
Twitch : § 7.

## 3. Commandes chat (réponses par LeCroupier\_)

| Commande                                         | Qui                    | Effet                                                                                                                                                                                                     |
| ------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!song`                                          | tous                   | titre en cours (lecture fraîche via Studio) ; « demandé par @x » seulement si la demande est identifiée avec certitude                                                                                    |
| `!songqueue`                                     | tous                   | les 3 prochaines demandes de la file logique, `+N` au-delà                                                                                                                                                |
| `!mysong`                                        | tous                   | sa demande en cours de lecture, ou la position de sa prochaine demande                                                                                                                                    |
| `!songcancel`                                    | tous                   | annule sa prochaine demande (remboursée, passée automatiquement si déjà dans la file Spotify) ; sa musique en cours seulement dans les 10 premières secondes (passée tout de suite) ; sinon « trop tard » |
| `!songremove <position>` / `!songremove @viewer` | modérateurs, diffuseur | retire une demande future (remboursée, passée automatiquement) ; refus si elle joue déjà (« Utilise !songskip. »)                                                                                         |
| `!songskip`                                      | modérateurs, diffuseur | passe la musique en cours ; la demande correspondante devient `SKIPPED`                                                                                                                                   |

Syntaxe stricte (docs/CHAT_COMMANDS.md) : un mot en trop n'est pas une commande, sauf l'argument documenté de
`!songremove`. Textes repris à l'identique de l'ancien service (§ 8).

## 4. File logique et suppression simulée

Spotify ne permet pas de retirer un titre de sa file. Une demande annulée ou retirée **reste** dans la file Spotify avec
un marqueur « à passer dès sa lecture ». Quand Spotify la joue, Studio envoie aussitôt `POST /me/player/next` :

- l'occurrence est identifiée par **la demande**, jamais par l'URI seule : les demandes de même titre sont prises dans
  l'ordre de la file (FIFO, l'ordre réel de la file utilisateur de Spotify) ; une seule demande peut consommer le
  passage ;
- le passage est réservé avant d'être envoyé (jamais deux skips pour une occurrence), puis rapporté au Core ;
- **voie rapide** : quand la musique en cours approche de sa fin (≤ 3,5 s) et que la demande suivante de la file est un
  marqueur, la lecture est surveillée toutes les 200 ms pendant 5 s au plus, pour passer le titre ~1 s après son début
  (mesuré : 1,0 à 1,2 s le 22/09) ; jamais en cas de limitation Spotify ;
- aucune garantie « première image » : Spotify ne fournit pas d'événement, seulement la lecture.

## 5. Consommation de l'API Spotify (priorité absolue)

Historique : 86 réponses 429 le 05/09 et un blocage de ~12 h (`Retry-After: 43 547`). Règles :

- **un seul gestionnaire** d'appels dans Studio ; aucune autre partie de Raptoru n'appelle Spotify ;
- lectures dédupliquées et mises en cache (lecture 1,5 s, file 3 s, recherche 5 min même texte, appareils 5 s, titre
  30 min) ; une lecture identique en vol est partagée ;
- surveillance **seulement quand il y a une raison** (demande en file ou en lecture, marqueur à passer) : 2,5 s actif,
  1 s en fin de titre, 30 s sur un titre étranger, rien au repos ; `!song` fait au plus une lecture ;
- **429** : tous les appels suspendus jusqu'à `Retry-After` (jamais raccourci), état « limité » visible dans Studio,
  persistant au redémarrage ; `QUOTA_EXCEEDED` distingué ; backoff exponentiel (max 60 s) sur les erreurs réseau/5xx ;
- **401** : un seul rafraîchissement du jeton (partagé), puis une nouvelle tentative ; **refresh `invalid_grant`**
  (jeton expiré au bout de 6 mois depuis 2026) → « reconnexion nécessaire » ; **403** : pas de nouvelle tentative
  (Premium, appareil restreint, droits) ;
- jamais de nouvelle tentative automatique d'une écriture (ajout, skip) au résultat incertain : relecture seulement ;
- budget de rafale : au plus ~1 appel / 200 ms en moyenne glissante, alerte au-delà de 60 appels / min.

## 6. Studio — panneau « Musique »

Connexion Spotify (appareil actif, compte, reconnexion), état (prêt / limité jusqu'à… / déconnecté / Spotify fermé),
musique en cours et demandeur, file logique, historique (refus, annulations, incertains), actions de modération
(retirer, passer), réglages (activation, 2 demandes, cooldown 10 min, durée 10 min, délai d'annulation 10 s),
récompense liée et état des remboursements.

## 7. Récompense Twitch et remboursements

- Seule l'application qui a créé une récompense peut valider / annuler ses rédemptions : l'ancienne récompense (créée
  par SAMMI) ne peut pas être remboursée par Raptoru.
- Raptoru crée une **nouvelle** récompense « Choisi la prochaine musique ! » (1 000 points, texte obligatoire) via le
  bot (jeton `raptoru_`, droit `channel:manage:redemptions`, déjà dans le profil approuvé) — **sur GO**.
- **Statuts de la réclamation (décision d'Antoni, 24/10)** — Raptoru n'envoie jamais FULFILLED, même après une
  lecture complète ; Antoni garde le choix de valider ou de rembourser lui-même depuis Twitch :

  | Moment                                                                    | Réclamation Twitch                                                                  |
  | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
  | achat, demande acceptée, ajoutée à la file Spotify, jouée, interrompue    | **PENDING** (rien n'est envoyé)                                                     |
  | refus ou échec certain (texte, recherche, durée, limites, Studio absent…) | **CANCELED** automatique (points rendus)                                            |
  | `!songcancel` (prochaine demande, ou musique en cours dans les 10 s)      | **CANCELED** de cette demande seulement                                             |
  | `!songremove` / « Retirer » dans Studio                                   | **CANCELED** de cette demande seulement                                             |
  | `!songcancel` trop tard, `!songskip`, « Passer la musique »               | PENDING                                                                             |
  | résultat incertain (« à vérifier »)                                       | PENDING jusqu'à « Rembourser » (CANCELED) ou « Garder » (rien d'envoyé) dans Studio |
  | récompense « Skip la musique » : passée / incertain / échec certain       | PENDING / PENDING / CANCELED                                                        |

- Remboursement = statut CANCELED demandé par le Core et exécuté une seule fois par le bot (clé d'idempotence par
  rédemption : un second remboursement de la même réclamation est impossible ; Twitch refuse aussi d'annuler une
  réclamation déjà traitée à la main). Une demande qui a été jouée (même interrompue) ne peut plus être remboursée par
  Raptoru. Sans récompense gérée par Raptoru : aucun appel, état « remboursement impossible » visible dans Studio et
  messages sans « remboursée ».

## 8. Textes du chat (repris de l'ancien service)

- succès : `@{viewer} → {Titre} — {Artistes} ajouté à la file !`
- refus : `@{viewer} → {message}` (messages de `errors.js`, ex. « Aucune piste suffisamment proche n’a été trouvée. »)
- cooldown : `@{viewer} → attends encore {N min | moins d’une minute} avant une nouvelle demande ; récompense remboursée.`
- `!song` : `🎵 En cours : {Titre} — {Artistes}[ • demandé par @{login}]` / `🎵 Aucune musique en cours.`
- `!songqueue` : `🎶 À suivre : #1 {Titre} — @{login} • … • +N` / `🎶 Aucune musique en attente.`
- `!mysong`, `!songcancel`, `!songremove`, `!songskip` : textes exacts dans `apps/core-api/src/spotify/messages.ts`.

## 9. Écarts avec l'ancien système (imposés ou assumés)

| Écart                                                                                            | Raison                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Réponses par LeCroupier\_ au lieu de `raptoru_`                                                  | règle Raptoru 2.0 (décision d'Antoni, 24/10)                                                                                        |
| Nouvelle récompense créée par Raptoru                                                            | seule façon de rembourser (Twitch) ; l'ancienne reste intacte jusqu'à décision                                                      |
| Doublons de titre : ordre FIFO de la file                                                        | l'ancien rapprochement prenait la demande la plus récente avant le début de lecture ; FIFO suit l'ordre réel de la file Spotify     |
| Passage manuel dans l'app Spotify vers une autre demande : la précédente devient « interrompue » | l'ancien service la laissait « en lecture » sans fin                                                                                |
| Push différé non repris                                                                          | dormant en production (`SPOTIFY_DEFERRED_PUSH_ENABLED=false`)                                                                       |
| `!songstats` / `!mysongstats` non repris                                                         | jamais branchés à un déclencheur                                                                                                    |
| Récompense « Skip la musique » : action `song_skip` disponible, récompense non recréée           | désactivée avant la migration                                                                                                       |
| Permissions `!songskip` : modérateurs + diffuseur                                                | règle des decks du 07/09 et du 15/09 ; le dernier deck (lead_moderator seul) n'est pas expliqué et Raptoru ne distingue pas ce rôle |
| Historique ancien (227 demandes, fichier JSON) non importé                                       | non nécessaire au fonctionnement                                                                                                    |
| Connexion OAuth PKCE (Client ID seul, pas de secret client) ; droit `user-read-private` en plus  | aucun secret d'application sur le PC ; affiche si le compte est Premium. Demande une nouvelle connexion du compte                   |
| Caches : recherche 5 min (5 s avant), titre 30 min (30 s avant) ; plafond 90 appels / min        | priorité à la consommation de l'API (blocage de ~12 h en septembre) ; mêmes résultats                                               |
| Studio réserve chaque passage automatique sur disque avant de l'envoyer                          | jamais deux passages pour une même demande, même après un redémarrage de Studio                                                     |
| Overlay « en cours », module extension                                                           | exclus de ce chantier                                                                                                               |

## 10. Implémentation

| Couche  | Fichiers                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schémas | `packages/schemas/src/spotify.ts` (règles, contrats Core ↔ Studio) ; interactions `song_request` / `song_skip` et actions Twitch dans `channel-points.ts`                                                                                                                           |
| Base    | `supabase/migrations/20261108130000_spotify.sql` (Production) = `20261108120000_spotify_lab.sql` (Lab) : `spotify_settings`, `spotify_studio`, `spotify_requests`, `spotify_jobs`, `cp_twitch_actions`, colonne `cp_rewards.managed_by_raptoru`                                     |
| Core    | `apps/core-api/src/spotify/` (`service.ts` admission, file logique, cycle de vie, remboursements ; `chat.ts` commandes ; `messages.ts` textes ; `reference.ts`) ; `channel-points/twitch-actions.ts` ; `http/spotify-routes.ts`                                                     |
| Studio  | `apps/studio/server/src/spotify/` (`search.ts` score historique ; `api.ts` gestionnaire unique des appels ; `oauth.ts` PKCE + DPAPI ; `runtime.ts` synchro, tâches, surveillance, passage automatique, routes du panneau ; `sim.ts` simulateur) ; `apps/studio/web/src/spotify*.ts` |
| Bot     | `apps/twitch-bot/src/cp-twitch-actions-executor.ts` (statut des rédemptions, création de la récompense ; une seule tentative) ; `twitch/helix.ts`                                                                                                                                   |

Flags (OFF par défaut) : Core `SPOTIFY_CHAT` (les six commandes), bot `CP_TWITCH_ACTIONS` (remboursements CANCELED et
création de la récompense). Le module a son propre interrupteur dans Studio (`spotify_settings.enabled`, OFF).

Tests : Core `spotify-service.test.ts` (32, dont les statuts de réclamation du § 7), `spotify.integration.test.ts` (7,
PostgreSQL réel : concurrence, idempotence des remboursements, aucun envoi après une lecture), `spotify-migration.test.ts` ; Studio `spotify-search.test.ts` (6, cas historiques), `spotify-api.test.ts`
(8 : espacement, plafond, cache, 429 persisté, 401 / 403 / 5xx, écritures, OAuth), `spotify-runtime.test.ts` (9 :
tâches, relectures, FIFO, passage unique après redémarrage, 429), `spotify-view.test.ts` (5) ; bot
`cp-twitch-actions-executor.test.ts` (5).

## 11. Tester dans le Lab

Profil Lab de Studio : Spotify est **toujours simulé** (`sim.ts` : jamais le compte ni la file réels). Points de
chaîne → section « Musique (Spotify) » : « Activer les demandes », puis « Simuler une demande » (viewers = identités du
simulateur de chat : `lab_viewer` 900101, `lab_modo` 900102, `raptoru_lab` 900100) et les boutons du simulateur (fin
du titre, titre hors demandes, appareil coupé, 429 pendant 30 s, réponse 200 / 500 au prochain ajout). Les commandes se
testent dans le chat simulé (onglet Simulation) avec les mêmes identités.

Parcours vérifié le 24/10 sur un Lab isolé (Core Lab + PostgreSQL + Studio + simulateur, base jetable, scripts
automatiques — pas une validation) : demande trouvée et ajoutée ; deuxième demande du même viewer → délai ; « numb »
seul → ambiguë ; titre de 10:01 → trop long ; lien `intl-fr` → ajouté, ordre FIFO ; retrait par le panneau puis fin du
titre → passage automatique de la demande retirée et la suivante attribuée à son viewer ; « Passer la musique » ;
`!song`, `!songqueue`, `!mysong`, `!songcancel`, `!songremove @…`, `!songskip` (modérateur) avec les textes
historiques ; `!song please` et le `!songskip` d'un viewer ignorés. Consommation sur ce parcours : 17 appels Spotify
dont 4 écritures, aucun 429.

## 12. Mise en service (chaque étape sur GO d'Antoni, dans cet ordre)

1. **Revue + commit** de la branche ; suites globales. Rien ne change en Production.
2. **Tableau de bord Spotify** (Antoni) : application Raptoru → ajouter la redirection
   `http://127.0.0.1:4100/api/spotify/oauth/callback` ; noter le Client ID. Vérifier que le compte du stream est
   Premium et inscrit parmi les utilisateurs de l'application (mode développement : 5 au maximum).
3. **Migration Production** `20261108130000_spotify.sql` (additive : nouvelles tables + une colonne de `cp_rewards`),
   puis **déploiement Core** (flags OFF) et **bot** (`CP_TWITCH_ACTIONS` OFF).
4. **Studio** : build installé ; profil Production → Points de chaîne → Musique : Client ID, « Connecter Spotify »,
   accepter dans le navigateur ; le panneau doit afficher le compte et ne pas signaler « pas Premium ».
5. **Droit Twitch** `channel:manage:redemptions` du jeton `raptoru_` (déjà dans le profil approuvé ; visible dans
   Studio → Connexions Twitch) ; activer `CP_TWITCH_ACTIONS` ; « Créer la récompense Raptoru » dans le panneau
   (« Choisi la prochaine musique ! », 1 000 points, texte obligatoire). L'ancienne récompense SAMMI n'est pas
   touchée : la mettre en pause est une décision d'Antoni.
6. Règle de la nouvelle récompense : Interaction native « Demande de musique (Spotify) » ; `SPOTIFY_CHAT=true` ;
   « Activer les demandes ».
7. **Test réel** hors live (Spotify ouvert sur le PC) : une demande jouée (la réclamation doit rester en attente dans
   la file des récompenses Twitch), une annulation dans les 10 s et un refus (remboursés), un `!songskip` (en attente) ;
   vérifier la file Spotify et les points rendus sur Twitch.

Retour arrière : « Couper les demandes » (Studio) ; `SPOTIFY_CHAT=false` ; `CP_TWITCH_ACTIONS=false` ; mettre la
récompense en pause dans Twitch. Les tables restent (additives).

## 13. Risques connus

- CGU Spotify : diffuser la musique en stream reste un risque de droits (signalé le 24/10), indépendant de Raptoru.
- Mode développement Spotify : 5 utilisateurs, quotas bas ; une extension demande une revue par Spotify.
- Le jeton de rafraîchissement expire au bout de 6 mois (ou à la révocation) : « reconnexion nécessaire » dans Studio ;
  les demandes sont refusées (et remboursées si la récompense est celle de Raptoru) en attendant.
- Studio fermé ou PC éteint : demandes refusées (« Studio absent ») ; une demande en cours quand Studio disparaît
  devient « à vérifier » (jamais rejouée).
- Spotify ne fournit pas d'événement de lecture : début / fin de titre et passage automatique sont déduits des
  lectures (~1 s près en voie rapide).
