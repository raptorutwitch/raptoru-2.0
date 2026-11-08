# Music Hub — « Musiques de la soirée » : faisabilité (relevé du 08/11/2026)

> Besoin (retour d'Antoni sur F) : voir les morceaux **réellement passés pendant le stream en cours**, demandés par un
> viewer **ou** lancés par le streamer, avec l'heure, la pochette, le titre, l'artiste et le demandeur ; une nouvelle
> liste à chaque stream ; chargement progressif (une soirée de 100 titres). Dans la maquette F2, cette liste est
> **simulée**. Rien n'est modifié dans le Core ou Studio pendant cette mission.

## 1. Ce que Spotify V2 observe et garde aujourd'hui (code lu)

| Question                            | Réponse                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Événements de lecture observés   | Studio lit `GET /me/player` et l'envoie au Core à chaque synchro ; le Core (`observe()`, `spotify/service.ts`) détecte un **changement d'occurrence** : autre titre, ou même titre recommencé (progression qui revient sous 5 s).                                                                                                      |
| … mais seulement quand              | Studio ne lit Spotify **que lorsque le Core le demande** (`watch` : une demande en file, une tombe à passer, une tâche en cours), environ toutes les 0,5–2,5 s. Sans demande en cours, **la lecture n'est pas lue du tout** (choix d'économie d'appels, plafond 90/min).                                                               |
| 2. Titres personnels du streamer    | Vus seulement pendant une surveillance (ex. le titre externe qui joue avant une demande). Ils servent à décider (« interrompue par un autre titre »), **jamais enregistrés**.                                                                                                                                                          |
| 3. Morceaux demandés suivis         | Tous : `spotify_requests` (récompense, extension, simulation) avec `track` (titre, artistes, durée, id), demandeur, état final (`PLAYED`, `SKIPPED`, `CANCELED`, `REMOVED_BY_MOD`, `FAILED`…).                                                                                                                                         |
| 4. Horodatages                      | Demande : `received_at`, `queued_at`, `playback_started_at`, `ended_at`, `canceled_at`. Lecture courante : `spotify_studio.playback.observed_at` et `playback_at`.                                                                                                                                                                     |
| 5. Identifiant de session de stream | Oui, mais pas dans Spotify V2 : `stream_sessions` (`stream_id`, `started_at`, `ended_at`, une seule ouverte à la fois — `activeSession()`). Les demandes ne portent pas de `stream_id` ; on peut les rattacher par l'heure (`playback_started_at` entre `started_at` et `ended_at`).                                                   |
| 6. Début et fin de stream           | Session canonique ouverte/fermée par les événements de live ; Spotify V2 considère le live fini **10 min** après la fin de la dernière session (`SPOTIFY_END_GRACE_MS`), une coupure brève n'est pas une fin.                                                                                                                          |
| 7. Stocké / non stocké              | Stocké : les demandes (≈ fenêtre d'activité récente lue par `live()`, toutes en base). Non stocké : toute lecture qui n'est pas une demande ; l'instantané `spotify_studio.playback` est **écrasé** à chaque relevé.                                                                                                                   |
| 8. Doublons dus au relevé           | Le relevé voit le même titre des dizaines de fois ; `observe()` ne réagit qu'au **changement d'occurrence** (titre différent ou redémarrage), ce qui est exactement la clé anti-doublon nécessaire. Cas limites : pause / reprise (même occurrence, pas de doublon), même titre rejoué volontairement (nouvelle occurrence, à garder). |
| 9. Conservation raisonnable         | Rien n'existe pour les lectures. Proposition : la soirée en cours + les 30 derniers jours (ou les 20 dernières sessions), purge automatique.                                                                                                                                                                                           |

## 2. Ce que la liste peut montrer AUJOURD'HUI, sans rien changer

- Les **demandes** jouées ou passées pendant le stream en cours : `spotify_requests` dont `playback_started_at` tombe
  dans la session active (`stream_sessions`), triées par heure de début, avec titre, artistes, demandeur, et la
  pochette quand elle a été retenue (`display.image_url`, extension) — sinon la pochette n'est pas connue du Core.
- **Pas** les musiques personnelles du streamer.

## 3. Travail nécessaire pour l'historique complet (hors de cette mission)

1. **Core** — une table `spotify_plays` (chaîne, `stream_id`, `started_at`, `track` id/titre/artistes/durée,
   `request_id` nullable, pochette nullable) ; une ligne **par changement d'occurrence** dans `observe()` (la logique
   anti-doublon existe déjà), rattachée à la session active ; une route paginée (`?before=<curseur>&limit=20`) pour la
   façade de l'extension ; purge (30 jours). Migration additive, donc GO de migration au déploiement.
2. **Studio** — lire la lecture **pendant tout le live**, pas seulement sous surveillance : un relevé lent (ex. toutes
   les 10–15 s hors demande, soit 4–6 appels/min sur les 90/min) suffit pour un historique ; envoyer la pochette déjà
   lue (`album.images`, comme pour les demandes de l'extension).
3. **Extension** — la liste « Musiques de la soirée » de F2, chargée par pages de 20 (déjà prévu dans la maquette).
4. **Tests** — doublons (même titre relu 100 fois = 1 ligne ; pause/reprise = 1 ligne ; rejoué = 2 lignes), coupure
   de stream de moins de 10 min (même soirée), nouvelle session (nouvelle liste), Studio absent (trou honnête, pas
   d'invention), pagination.

Limites à accepter : un titre écouté moins longtemps que l'intervalle de relevé lent peut manquer ; si Studio est
fermé, rien n'est vu ; les conditions Spotify sur l'affichage des métadonnées s'appliquent (voir
[SPOTIFY_CATALOGUE.md](SPOTIFY_CATALOGUE.md)).

## 4. Recommandation

Intégrer F2 avec la version « demandes de la soirée » (§ 2, données existantes, aucune modification Core/Studio),
puis ajouter la collecte complète (§ 3) dans un lot séparé, sur GO, si Antoni la veut vraiment.
