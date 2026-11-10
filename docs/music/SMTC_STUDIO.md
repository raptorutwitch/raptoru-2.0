# Musique en cours (Windows SMTC) et musiques du stream (09/11/2026)

> Lab seulement, branche `feat/music-hub`. Rien de poussé, déployé ni publié. **Non validé par Antoni.**
> Prototype de départ : [SMTC_PROBE.md](SMTC_PROBE.md). Coûts API : [SPOTIFY_QUOTA.md](SPOTIFY_QUOTA.md) § 6.

## 1. En une phrase

Studio écoute ce que **Windows** dit de Spotify Desktop (titre, artiste, album, pochette, durée, position, lecture /
pause), l'affiche aussitôt dans sa page Spotify et l'envoie au Core. L'extension affiche alors le même « en cours »,
et le Core note chaque titre passé **pendant un live** : c'est l'historique « Musiques du stream ».

**Règle de sécurité.** SMTC sert à l'affichage et à l'observation locale. Spotify V2 et le Core restent la vérité des
demandes. SMTC n'a pas d'identifiant Spotify : aucune demande n'est validée, attribuée, terminée ni remboursée à partir
de lui.

## 2. Le chemin

```
Spotify Desktop ─► Windows (SMTC) ─► sonde --studio ─► Studio (suivi, page) ─► Core POST …/now ─► extension (état musique)
                                                         │                       └─► historique (module_activity)
                                                         └─ 1 lecture API par changement : le titre EXACT (uri, pochette)
```

- **Sonde** (`tools/smtc-probe`, mode `--studio`) :
  - processus enfant de Studio, qui en construit sa propre copie dans `.lab-data/smtc-probe/studio/` ;
  - écrit des lignes JSON (événements Windows, un contrôle local toutes les 5 s) ;
  - envoie les octets de la pochette une seule fois par pochette ;
  - s'arrête seule quand Studio ferme son entrée ; relancée avec un délai croissant (2 s → 5 min), jamais en boucle.
- **Suivi** (`apps/studio/server/src/spotify/smtc.ts`, `SmtcTracker`) : une **occurrence** (`gen`) par changement de
  titre ou par titre rejoué depuis le début.
  - Ignorés : les doublons de Spotify, le titre vide d'une transition, une ligne plus ancienne.
  - Distingués : pause / reprise, recherche dans le titre (_seek_), Spotify fermé, source absente.
  - « Non confirmé » : 20 s sans nouvelle de Windows, ou titre 15 s au-delà de sa fin.
- **Titre exact** : 1,2 s après un changement annoncé, **une** lecture `GET /me/player`.
  - Elle n'est retenue pour cette occurrence que si elle est postérieure au changement, avec le même titre et la même
    durée (± 2,5 s). Le titre sert seulement à rejeter une lecture de la piste précédente ; l'identité est l'uri de l'API.
  - Une seule nouvelle tentative 2 s plus tard, puis rien.
  - Jamais pendant un 429, jamais sans compte connecté, au plus une toutes les 3 s.
  - Si Studio surveille déjà (une demande en jeu), c'est la lecture prévue qui est avancée : aucune lecture en plus.
- **Vers le Core** : `POST /v1/lab/spotify/{ch}/now` (Production : `/v1/studio/spotify/{ch}/now`), même authentification
  que la synchro de Studio, schéma strict `SpotifyLiveNow`.
  - Envoyé à chaque changement, puis toutes les 30 s. Jamais une fois par seconde pour la barre.
  - Ordre garanti : `boot` (un démarrage de Studio) + `seq`. Un message déjà reçu, plus ancien, ou venu d'un Studio
    plus ancien ne change rien.
  - Un Core sans cette route : Studio ne la redemande pas avant 10 min.
- **Core** (`apps/core-api/src/spotify/live-music.ts`) : l'état en cours est rangé dans `module_state`, l'historique dans
  `module_activity` (`music_history`). Ce sont les tables de l'hôte de modules : **aucune migration nouvelle**.
  - Le tout passe sous le verrou de chaîne de Spotify V2, comme la synchro : pas de course.
- **Extension** : relit l'état toutes les 4 s, comme avant.
  - La barre avance avec l'horloge du navigateur à partir de la position que donne le Core.
  - Une seule relecture en plus, juste après la fin prévue d'un titre : le suivant s'affiche aussitôt.
  - Un viewer n'appelle jamais Windows ni Studio. Aucune nouvelle commande ne lui est ouverte.

## 3. Ce qui s'affiche

| Où        | Quoi                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio    | Bloc « En cours » : pochette de Windows (servie par Studio), titre, artistes, album, temps, barre fluide, état. Relu chaque seconde, sans appel au Core ni à Spotify. |
| Studio    | Onglet « Musiques du stream » à côté de la file : par live, le plus récent d'abord, 50 par page.                                                                      |
| Extension | Ligne « EN COURS » : la même, plus une barre fine et « 1:23 / 3:45 » (masqué sous 340 px), une entrée douce au changement de titre.                                   |
| Extension | Horloge « Musiques de la soirée » : tous les titres des lives (ta musique comprise), 20 par page.                                                                     |

- **Demandes.** Sans relevé de Windows (sonde absente, autre PC), on revient à l'ancien affichage, tiré de la lecture
  de l'API.
- **Animations.** Elles sont coupées si le système demande moins d'animations.

## 4. L'historique

- **Ouverture.** Une entrée s'ouvre quand un titre **joue** pendant un live :
  - en Lab, le live simulé (`lab_stream_sessions`) ;
  - en Production, le live canonique (`stream_sessions`).
- **Hors live.** Rien n'est noté ; le titre en cours s'affiche quand même.
- **Contenu.** Titre, artistes, album, pochette, heure de début observée, live, temps écouté estimé, demandeur si
  reconnu, fin.
- **Doublons.** Une entrée par occurrence, sous la clé `boot:gen` (un message rejoué n'écrit jamais deux fois).
  - Un vrai « rejoué depuis le début » ouvre une nouvelle entrée.
  - Moins de 5 s écoutées : un « survol » (playlist parcourue, demande annulée passée d'office), gardé mais jamais listé.
- **Redémarrage de Studio** sur le même titre commencé au même moment (± 20 s) : même entrée.
  - Sinon, l'ancienne se ferme « fin inconnue ».
  - Le Core garde tout en base (redémarrage du Core sans perte).
- **Période.** Le Daily en cours seulement (décidé le 09/11 : un nouveau Daily = un historique visible vide ; stream_day
  du projet, 16:00 → 16:00 Paris ; les lignes plus anciennes restent en base). 30 jours au plus.
  - Les demandes que le Core a vues jouer sans relevé de Windows y sont aussi, sans doublon (rattachées par l'id de
    demande, jamais par un titre).

### Demande reconnue

Une entrée devient « demande de X » seulement si les deux conditions sont réunies :

1. **Titre exact.** L'uri exacte de l'occurrence (lecture API) est celle de la demande.
2. **Même début.** Le Core a lui-même vu cette demande commencer au même moment (± 30 s). C'est son attribution
   existante, FIFO comprise.

Une demande n'est jamais rattachée à deux entrées. Un même titre joué par le streamer reste « titre perso ». Sans titre
exact lu (API limitée), pas de demandeur.

### Statut de fin (`classifyEnd`, affichage seulement)

| Classement interne        | Affiché                  | Quand                                                                                                                                                |
| ------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skip confirmé             | **Skippé**               | Une **commande** de Raptoru (Studio « Passer », `!songskip`, lecteur supermods) a passé **ce titre exact** ; ou le Core a fini la demande `SKIPPED`. |
| Interruption probable     | « Interrompu » (discret) | Un autre titre (ou le même depuis le début) a commencé plus de 15 s avant la fin, sans commande : skip à la main dans Spotify, autre morceau cliqué… |
| Fin normale ou compatible | rien                     | Changement dans les 15 dernières secondes (fin, fondu enchaîné, skip tout à la fin), ou demande `PLAYED` selon le Core.                              |
| Fin inconnue              | rien                     | Spotify fermé, sonde perdue, Studio redémarré sur un autre titre, fin du live, position inconnue.                                                    |

- **Pause.** Une pause n'est jamais une fin.
- **Interrompu.** Une interruption n'est jamais affichée « Skippé ».
- **Sans effet métier.** Rien de ce classement ne remonte au Core comme décision (remboursement, fin de demande).

## 5. Pochettes (correctif)

- **Cause.** La CSP de l'extension servie par le Lab (`extension-lab/serve.ts`) imitait la liste d'images autorisées de
  Twitch **sans** `https://i.scdn.co`.
  - Les pochettes du simulateur (`data:`) passaient.
  - Celles du vrai catalogue étaient bloquées par le navigateur.
- **Correctif.** `img-src` ajoute `https://i.scdn.co`, et lui seul : pas de joker, `connect-src` inchangé ; un test le
  vérifie.
- **Image qui ne charge pas.** Une image qui ne charge pas devient l'icône note (gestionnaire délégué, CSP sans script
  en ligne).
- **Pochette du titre en cours :**
  - **Studio** : les octets de Windows, servis en local (`/api/spotify/live/cover?v=<hash>`, mis en cache par hash).
  - **Extension et historique** : l'URL Spotify de l'occurrence (`i.scdn.co`, lue avec le titre exact).
  - **Core** : ne transporte jamais d'image.
- **Le jour de la publication** : déclarer `https://i.scdn.co` dans la console Twitch (« Allowlist for Image Domains »).

## 6. Tester soi-même

- **Simulé** (`Ouvrir Music Hub (Lab).cmd`). Studio › Spotify › panneau Simulateur, bloc « Musique en cours » :
  1. « Démarrer un live simulé ».
  2. « Skip à la main ».
  3. « Pause dans Spotify ».
  4. « Rejouer le titre ».
  5. « Fermer / Rouvrir Spotify ».
  6. « Passer la musique » (commande).
  7. Onglet « Musiques du stream », et l'horloge dans l'extension.
- **Réel** (`Ouvrir Music Hub (Lab, Spotify reel).cmd`, lecture seule par défaut) : Studio lance la sonde tout seul.
  - Lance Spotify Desktop.
  - Démarre un live simulé (Studio › Simulation), puis utilise Spotify normalement.
  - `LAB_SMTC=off` coupe la sonde.

## 7. Limites

- **Autre appareil.** Lecture sur un autre appareil (téléphone, enceinte via Spotify Connect) : Windows ne voit plus le
  titre. Studio montre « Spotify fermé » ou garde le dernier titre « non confirmé ». L'entrée en cours finit « inconnue ».
- **Réglage Spotify.** Le réglage « Afficher la superposition du bureau… » doit rester activé.
- **Latence.** La latence de bout en bout (action dans Spotify → Windows) reste à mesurer sur le PC ; du côté de la
  sonde, elle est de 0 à 6 ms.
  - **Déjà vu sur le PC** (journal du 09/11, 05:15) : changements de titre, pause et reprise, doublons.
  - **Pas encore vu** : fermeture / réouverture, téléphone.
- **Production.** Pas branchée. La sonde ne tourne qu'en Lab sur le vrai compte ; Studio installé ne l'embarque pas
  encore. Il faudra la livrer avec Studio, ce qui demande un GO.
- **Overlay OBS.** Non fait ; il pourra lire le même état (`/state`, `live_core` / `/api/spotify/live`).
- **Historique, cas rares (assumés).**
  - **Demande en double.** Si Studio n'a jamais pu lire le titre exact d'une demande (API limitée), elle apparaît deux
    fois : en « titre » sans pseudo, et en « demande » (vue par le Core).
  - **Demande absente.** Une demande passée en moins de 5 s (« survol ») n'apparaît pas.
  - **Même horodatage.** Deux entrées à la même milliseconde en limite de page peuvent en sauter une.
