# Music Hub — état (08/11/2026, deuxième passe « V2 »)

> Branche `feat/music-hub` (worktree `Raptoru 2.0 - Worktrees\music-hub`, partie de `feat/extension-next` 2f45ac1).
> **Lab uniquement.** Rien n'est poussé, fusionné, déployé ni publié. Non validé par Antoni.
> V1 : commits 626d353 → 2722108. V2 (retour du 08/11) : 006cfac, c9e88a8, 5860b81 et la doc.

## 0. Où reprendre (08/11, après le Design Lab)

- **F3 « compacte »** (F2 validée dans son principe, puis optimisée en hauteur) : `prototypes/music-hub/f3-hybride.html`,
  ouverte par défaut dans le comparateur (mode « F2 ↔ F3 »). **À valider avant intégration.** Même file, même rideau,
  mêmes interactions que F2 ; champ bas au repos (36 px, 42 au focus sans rien pousser) ; économie et libellé de la file
  sur une ligne ; « en cours » = pastille flottante de 40 px dans le coin inférieur droit (disque qui tourne en
  lecture, immobile en pause, inactive si rien ne joue), qui s'élargit vers la gauche avec titre, artiste et
  « Demandé par @pseudo » pour une demande. Titres entièrement visibles (F2 → F3) : 565 × 376 3 → 4 ; 651 × 434
  4 → 5 ; 521 × 347 3 → 4 ; panel court 2 → 3 ; panel 5 → 6 ; paysage 3 → 4. L'intégration suivra F3 (même plan
  que pour F2 ci-dessous).

- **F2 « finale »** (retour d'Antoni sur F) : `prototypes/music-hub/f2-hybride.html`, ouverte par défaut dans le
  comparateur (mode « F ↔ F2 » pour comparer). **À valider par Antoni avant toute intégration.** La file est le module ;
  le catalogue descend en rideau par-dessus ; économie en mots ; mini-player flottant dépliable ; « Musiques de la
  soirée » (simulée) derrière l'horloge. Faisabilité de l'historique complet : [HISTORIQUE_SOIREE.md](HISTORIQUE_SOIREE.md).
- **Après validation de F2** : réécrire `apps/twitch-extension/extension/modules/music/view.js` et `music.css` selon F2
  (mêmes appels `client.music*`, mêmes droits `st.can`, aucun changement Core/Studio) ; historique = demandes de la
  soirée (données existantes) ; garder verts `test:music-stability`, `music-hub.e2e.ts`, la matrice responsive (ajouter
  521 × 347 et le panel court), et transformer les contrôles de F2 (rideau, Échap, clic extérieur, focus) en tests.

- **Direction F « Hybride » (A + B + E)**, issue du retour d'Antoni sur les cinq maquettes :
  `prototypes/music-hub/f-hybride.html`, première du comparateur. **À valider par Antoni avant toute intégration.**
  Recherche en haut, résultats et demande de E (barre courte), « À suivre » numéroté de B (colonne repliable, tiroir
  en étroit, playlist quand rien n'est tapé), bande « En cours » en bas dépliée sur place, un seul historique
  « Derniers titres passés » (panneau interne + Retour), retrait par poubelle avec confirmation par-dessus le module.
- **Historique, limite des données** : Spotify V2 garde les demandes (`spotify_requests`, avec leur début de lecture)
  et seulement l'instantané de ce qui joue (`spotify_studio.playback`). Les musiques personnelles du streamer ne sont
  enregistrées nulle part : « Derniers titres passés » montre les **demandes** jouées ou passées, pas les autres
  titres. Les garder demanderait un changement Core/Studio (hors de cette mission).
- **Sauvegarde du Design Lab** (prototypes jamais versionnés) : `Documents\Sauvegarde Raptoru 2.0\music-hub-design-lab-2026-11-08\` (archive vérifiée à l'extraction, SHA-256 dans `LISEZMOI.txt`).

- **Design en cours de choix** : cinq directions comparables dans `prototypes/music-hub/` (double-clic
  `Ouvrir le comparateur Music Hub.cmd`). Recommandation : **D — Raptoru Néon** (voir son README et le comparateur).
  Ce dossier est local (exclu de git par `.git/info/exclude`, comme tous les prototypes) : il vit dans le worktree.
  **Rien n'est intégré** : le module V2 actuel reste la référence fonctionnelle jusqu'au choix d'Antoni.
- **Prochaine mission** : intégrer la direction retenue dans `apps/twitch-extension/extension/modules/music/`
  (`view.js`, `music.css`) sans toucher Core, Spotify V2, Jetons ni droits ; garder `test:music-stability`, l'E2E
  `music-hub.e2e.ts` et la matrice responsive verts.
- **Corrigé le 08/11** (commit fa09c88) : « Historique » qui se refermait et focus perdu à chaque relevé (4 s) —
  une zone n'est redessinée que si elle change, le focus revient au même contrôle. Le saut de la file après un retrait
  observé pendant l'enquête venait de l'outil de test (défilement pour cliquer), pas du module.
- **Catalogue Spotify** : faisabilité et autorisations dans [SPOTIFY_CATALOGUE.md](SPOTIFY_CATALOGUE.md).

## 1. En une phrase

Le module « Musique » de l'extension (shell v2) est une **nouvelle entrée dans la file Spotify V2 existante**,
payée en Jetons, centrée sur la **recherche**. Ce n'est ni un second lecteur ni une seconde file. La récompense
« Choisi la prochaine musique » (1 500 points) reste inchangée.

## 2. Le système existant (Spotify V2, en Production depuis le 25/10) — référence `docs/SPOTIFY_V2.md`

- **Core** (`apps/core-api/src/spotify/service.ts`) : seule autorité.
  - Il tient les demandes dans `spotify_requests` : file logique FIFO, quotas par viewer, exceptions, commandes
    `!song*`, fin du live.
  - Il confie le travail à Studio par `spotify_jobs`.
  - Il rembourse les points par une action Twitch CANCELED (`cp_twitch_actions`, exécutée par le bot).
- **Studio** (`apps/studio/server/src/spotify/*`) : seul à appeler Spotify (OAuth PKCE, recherche notée,
  `POST /me/player/queue`, suivi de la lecture, passage automatique des demandes annulées, simulateur du Lab `sim.ts`).
- **Bot** : remboursements Twitch (`CP_TWITCH_ACTIONS`), relais du chat (`SPOTIFY_CHAT`).

**Annulation logique (existante, conservée).** Spotify ne permet pas de retirer un titre de sa file. Une demande
annulée devient une « tombe » (`CANCELED` / `REMOVED_BY_MOD`, `auto_skip`) : elle disparaît de la file de Raptoru,
elle est remboursée une fois, et Studio la **passe dès qu'elle commence** (`autoSkip`, réservation persistée, jamais
deux fois). Le titre reste dans la file Spotify jusque-là ; aucune suppression physique n'est tentée.

## 3. Ce qui est réutilisé tel quel

- File, ordre, quotas (`usage()`), exceptions, délai entre deux demandes. Ce délai compte aussi une demande retirée
  par le viewer : règle anti-abus existante, conservée.
- Fin du live, `!song`, `!songqueue`, `!mysong`, `!songcancel`, `!songremove`, `!songskip`.
- Job `song_request`, chemin exact de Studio, ajout réel, passage automatique, suivi de lecture, rythme des appels.
- **Résolution des liens** : `parseTrackReference` (`reference.ts`, mêmes règles que la récompense) et
  `api.track(id)` côté Studio.
- **Grades** : `lab-moderation` (`lab_staff`, `PERMISSIONS`, `access()`) ; un supermod est un modérateur nommé par le
  streamer.
- **Overlay** : le lecteur d'effets OBS (source « Effets ») ; **Dock** : la projection `dock_activity` existante.

## 4. Ce qui est ajouté

| Couche         | Ajout                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration (V1) | `20261122130000_music_hub.sql` et son jumeau Lab, additive : réglages `extension_enabled` (false), `extension_price_tokens` (500), `no_duplicates` (true), `player_controls` (false) ; demande : `payment`, `price_tokens`, `refund_status`, `display`. **V2 n'ajoute aucune migration.**                                                                                                                                                                 |
| Core (V1)      | Recherche par job (réutilisée 5 min, 20/min/viewer), demande en Jetons débitée **dans la même transaction**, `refundPayment` (un seul chemin de remboursement), `keepPayment`, façade `/v1/ext/music/*` **seulement si `config.lab`**.                                                                                                                                                                                                                    |
| Core (V2)      | Permission `music.player` = **supermod** (pause, reprise, passer, volume depuis l'extension). L'état dit à chacun ce qu'il peut faire (`can`). **Annulation pendant l'ajout** (`cancelInFlight`). **Lien collé** → le titre exact. Historique du viewer (`me.history`). Source Dock « musique ». Compte Lab « Supermod Lab » (900103).                                                                                                                    |
| Studio (V2)    | Recherche par identifiant (lien) ; catalogue fictif enrichi (« Néon Sauvage » en 10 versions) ; **carte musique** de l'overlay (`spotify/overlay.ts`, kind `music` du lecteur d'effets) ; réglages « Overlay OBS » dans la page Spotify ; jeton Lab `labRole=supermod`.                                                                                                                                                                                   |
| Extension (V2) | Vue refaite autour de la recherche : champ en tête (titre, artiste ou lien), liste de catalogue (pochette, titre, artiste · album, durée, ajout), squelettes de chargement, erreurs avec « Réessayer », clavier ; « File » avec **tes demandes** d'abord, puis la file, puis l'historique ; bande « en cours » d'une ligne en bas ; **panneau Lecteur séparé, supermods seulement**. En-tête « Prochaine musique ». Calibration par rôle (`?calibRole=`). |

## 5. Deux entrées, une file

```
Récompense (1 500 pts) ─┐                        ┌─ !song / !songqueue / !songcancel / !songremove / !songskip
                        ├─► spotify_requests ─► job song_request ─► Studio ─► file Spotify ─► lecture
Extension (500 Jetons) ─┘    (une file, un usage(), un ordre)       (même chemin exact)
```

Seul le paiement diffère : **points** → Twitch CANCELED par le bot ; **Jetons** → `economy.refund` une seule fois
(`refund_status`), « sans rembourser » → `kept`. Les points ne sont jamais convertis en Jetons ; une demande n'est
jamais payée deux fois.

**Retrait pendant l'ajout (V2).** Avant, une demande « en cours d'ajout » ne pouvait pas être retirée.

| Moment du retrait                             | Ce qui se passe                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reçue, pas encore prise par Studio (RECEIVED) | Remboursée une fois, son job est retiré : Studio ne l'ajoute jamais.                                                                                        |
| Studio est en train de l'ajouter (SEARCHING)  | Remboursée une fois, marquée « à passer ». Si Spotify l'accepte quand même, elle devient une tombe et est passée dès qu'elle commence. Sinon, rien de plus. |
| Dans la file Spotify (QUEUED)                 | Comportement existant : tombe, passée dès qu'elle commence.                                                                                                 |
| En cours (dans les 10 s de grâce)             | Comportement existant : passée tout de suite.                                                                                                               |

Les deux mouvements (retrait et rapport de Studio) passent sous le même verrou de chaîne : pas de course. `!songcancel`
seul fait la même chose quand l'unique demande du viewer est en cours d'ajout (avant : « aucune demande annulable »).
**Latence mesurée dans le simulateur** : titre retiré passé ~200 ms après son début (Studio relit Spotify toutes les
~0,5 s quand il surveille une tombe). Ce n'est pas une promesse à la frame près ; le réel dépend de Spotify.

## 6. Permissions (vérifiées par le Core, jamais par un bouton)

| Qui                  | Peut                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| Viewer (anonyme)     | Voir la file, chercher (identité requise pour chercher et demander)                    |
| Viewer (identifié)   | Chercher, coller un lien, demander, retirer **ses** demandes, voir son historique      |
| Modérateur           | En plus : retirer une demande avec ou sans remboursement (`queue.cancel`, `refund`)    |
| Supermod et streamer | En plus : pause, reprise, passer, volume (`music.player`), ouvrir / fermer (`modules`) |

Le rôle vient du JWT Twitch vérifié (la façade ne lit jamais un rôle envoyé par le navigateur) ; le grade supermod
vient de `lab_staff`. Un modérateur qui appelle la commande « pause » reçoit `forbidden` (testé). Le streamer garde
toujours la main dans Studio (page Spotify). Les commandes du lecteur restent coupées tant que « Commandes du lecteur »
est éteint dans Studio, et l'extension n'existe que dans le Lab.

## 7. Overlay OBS et Dock

- **Carte musique** : une brève carte (« Nouvelle demande » ou « À l'écoute », titre, artiste, viewer), dans un coin,
  avec un son d'alerte facultatif (catalogue ou importé), son volume et sa durée (3 à 15 s). Elle passe par le
  **lecteur d'effets** (source OBS « Effets ») comme le flop du Random Ban : aucune nouvelle source, aucun second
  système d'alertes, **jamais la musique elle-même**. Studio lit l'état Spotify du Core toutes les 2,5 s **seulement
  si la carte est activée** ; chaque carte une fois, jamais en retard (au démarrage ou après une coupure, ce qui est
  déjà là est seulement noté), une à la fois, 4 au plus en attente. **Éteinte par défaut.**
  Réglages : Studio → Spotify → « Overlay OBS » (activation, à chaque demande, au début de la lecture, son ou carte
  silencieuse, volume, durée, position, « Prévisualiser »).
- **Dock** : une demande faite depuis l'extension = **une** activité « Musique » dont le statut suit la demande (reçue,
  en file, en lecture, jouée, retirée, retirée par l'équipe, passée, échec, « remboursée »). Une demande payée en
  points reste sa rédemption (règle du Dock : jamais une seconde activité).
- Les alertes Twitch (`alert_items`) ne sont pas utilisées : leurs types sont fixes (follow, sub…), aucun module n'y
  ajoute le sien ; les modules visuels passent par le lecteur d'effets.

## 8. Tests (08/11, V2)

| Suite                                                                                                                                                                                      | Résultat                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Core `music-hub.test.ts` (V1 11 + V2 7 + Dock 1) : supermods, deux supermods à la fois, retrait RECEIVED / SEARCHING, `!songcancel` pendant l'ajout, lien collé, Dock                      | 19/19                                     |
| Core Spotify V2 et modération existants (`spotify-*`, `lab-moderation`, `moderation-d4`, `dock*`)                                                                                          | verts                                     |
| Studio `spotify-runtime` (+ lien exact, 10 versions, latence du passage automatique), `music-overlay`, `effects-player`, `spotify-view`, `dock-view`                                       | verts                                     |
| Extension vitest                                                                                                                                                                           | 127/127                                   |
| Matrice responsive v2 `--views hub,music` (19 tailles dont 565 × 376 et 651 × 434)                                                                                                         | 0 coupé, 0 chevauchement, 0 cible < 24 px |
| Captures par rôle (viewer, modérateur, supermod) × (651 × 434, 565 × 376, 390 × 844), recherche, confirmation, file, lecteur                                                               | aucune erreur JS                          |
| E2E Lab `music-hub.e2e.ts` : viewer, lien collé, lien d'album refusé, demande, retrait remboursé une fois, délai, modérateur sans lecteur, supermod pause / reprise, réglages de l'overlay | vert                                      |
| E2E `effects-player.e2e.ts` (vraie page OBS) : carte avec son, carte silencieuse, position, durée                                                                                          | vert                                      |

Globales et E2E complet : voir le rapport de livraison. **Rien n'a été testé à la main par Antoni**, ni avec un vrai
compte Spotify, ni sur Twitch, ni dans un vrai OBS.

## 9. Voir le résultat

- **Le plus simple (données fictives, rien d'autre à lancer)** : double-clic sur
  `apps/twitch-extension/Comparer legacy et v2.cmd`, Données « Calibration », Écran « Musique », puis **Rôle** :
  Viewer, Modérateur ou Supermod. Lecture seule : une demande y est refusée « not_available ».
- **Le vrai parcours (Lab)** : fermer Raptoru Studio et démarrer Docker Desktop, puis double-clic sur
  **`Ouvrir Music Hub (Lab).cmd`** à la racine de ce worktree. Il lance `npm run studio:lab`, ouvre la musique **dans
  le Lab** (demandes, entrée extension, commandes du lecteur), puis l'extension en viewer, modérateur et supermod.
  Chercher « néon » (10 versions), « nuit bl », « odyssée » (trop long), « session perdue » (indisponible), ou coller
  `https://open.spotify.com/track/LABMUSIC00000000000029`. L'overlay : Studio → Spotify → « Overlay OBS ».
  Le script refuse d'agir si le Studio qui répond n'est pas le Lab.

## 10. Conformité, par fonction (textes officiels lus le 08/11)

| Fonction                                        | Constat                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recherche** dans le catalogue                 | Spotify : afficher des métadonnées est permis sous conditions (attribution, lien vers Spotify, pochette non recadrée). **Attribution et lien restent à ajouter** avant tout fournisseur réel. Lab : catalogue fictif, signalé comme tel sous les résultats.                                                                                                                                                                                                    |
| **Suggestions** (titres passés récemment)       | Données de Raptoru (son historique de demandes), pas d'API de recommandation. Mêmes conditions d'affichage que la recherche.                                                                                                                                                                                                                                                                                                                                   |
| **Pilotage du lecteur** (pause, passer, volume) | Spotify : l'API le permet au propriétaire du compte ; le faire piloter par des tiers n'est pas clairement couvert. Réservé aux supermods, coupé par défaut, Lab seulement.                                                                                                                                                                                                                                                                                     |
| **Diffusion musicale** sur le stream            | Spotify : **interdite** (Developer Policy III.4/5/6/10, conditions d'utilisation, « broadcasting »). Concerne aussi la récompense déjà en Production. Le Music Hub ne diffuse rien lui-même ; l'overlay n'affiche que du texte et un son d'alerte.                                                                                                                                                                                                             |
| **Programme DJ Twitch**                         | Conditions officielles (lues en traduction : `legal.twitch.com/ko-kr/legal/dj-program-terms`, `/zh-tw/…`) : pas de diffusion **automatisée** ou sans performance en direct, ne pas diffuser une demande du public **immédiatement** après qu'elle est faite, pas d'album entier, catalogue du programme seulement. Une file de demandes jouée automatiquement est donc **à risque** dans ce programme ; l'original anglais est à relire avant toute ouverture. |
| **Jetons** comme paiement                       | Twitch : pas de Bits pour un jukebox (Extension Policy 6.2.2) ; points de fidélité permis. Spotify : monétisation autour du contenu plutôt défavorable (IV.2.2, II.2).                                                                                                                                                                                                                                                                                         |
| Marque                                          | Aucun logo ni vert Spotify : émeraude propre à Raptoru, interface propre (pas de copie de celle de Spotify).                                                                                                                                                                                                                                                                                                                                                   |

Rien n'utilise d'API privée, de scraping ni d'extraction audio. Aucun contournement.

## 11. Garde-fous Production

- La façade `/v1/ext/music/*` et le résumé de session ne répondent que si `config.lab` : en Production, l'extension
  ne voit pas le module.
- `extension_enabled`, `player_controls` et l'overlay sont éteints par défaut ; la récompense et le chat se comportent
  comme avant. Changement de Production à arbitrer : `!songcancel` seul annule aussi une demande en cours d'ajout.
- La permission `music.player` ne touche que l'extension (la page Studio reste au streamer).
- Migration V1 additive ; un déploiement du Core exige `--migrations-approved`, donc un GO explicite. V2 : aucune.

## 12. Décisions ouvertes (Antoni)

1. **Conformité** : ouvrir le Music Hub sur Spotify malgré § 10 (diffusion interdite, programme DJ) ? Un autre
   fournisseur sous licence ? Le garder comme « file de suggestions » sans lecture automatique ?
2. **Prix** : 500 Jetons (provisoire).
3. **Choix artistiques** à valider : recherche en tête et bande « en cours » en bas ; en-tête « Prochaine musique » ;
   carte OBS (coin haut droit, 6 s, émeraude, sans son par défaut) ; titre « Néon Sauvage » du catalogue fictif.
4. **`!songcancel` pendant l'ajout** en Production (§ 11).
5. **Ouverture en Production** : façade, migration, Core, Studio, extension — chaque étape sur GO.

## 13. Reste à faire (non bloquant pour le Lab)

- Attribution et lien Spotify dans le module, si un fournisseur réel est retenu.
- Messages de chat propres aux demandes de l'extension (aujourd'hui silencieuses, l'extension affiche le résultat).
- Exceptions individuelles (`overrides`) : existantes côté Studio, pas encore affichées dans l'extension.
- Carte OBS pour une demande de la récompense : déjà incluse (même file) ; Dock : la rédemption seule.
