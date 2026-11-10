# Music Hub — état (08/11/2026, design final intégré en Lab)

> Branche `feat/music-hub` (worktree `Raptoru 2.0 - Worktrees\music-hub`, partie de `feat/extension-next` 2f45ac1).
> **Lab uniquement.** Rien n'est poussé, fusionné, déployé ni publié. Non validé par Antoni.
> V1 : commits 626d353 → 2722108. V2 : 006cfac, c9e88a8, 5860b81. Design final intégré : voir `git log`.

## 0. Où reprendre

- **09/11 (nuit) — passe de finalisation** : § 14 ci-dessous. Lab seulement, non validé, rien de poussé ni déployé.
  - Overlay OBS événementiel (30 s à chaque nouveau titre, « Afficher » = armé) : [MUSIC_OVERLAYS.md](MUSIC_OVERLAYS.md) § 3 ter.
  - `!song` en annonce Twitch (repli en message normal), 30 s de délai global, réponse depuis Windows sans appel Spotify.
  - Vue modérateur : Pause / Passer directement sur « en cours » (supermods, streamer), seek confirmé sur la barre.
  - **Skip payant des viewers** (25 000 Jetons, doublé dans les 30 min, global au stream) et **Open Bar**.
  - **Prochaine étape** : essai d’Antoni (§ 14.8), puis OBS réel.

- **09/11 (soir) — Overlay musique OBS** : [MUSIC_OVERLAYS.md](MUSIC_OVERLAYS.md). Non validé, **jamais essayé dans OBS**.
  - **Studio.** Une page « Overlay musique » (Modules › Musique) : 6 archétypes et 2 presets, aperçu réel 16:9
    (démo isolée), variantes, Afficher / Masquer, assistant OBS qui ne fait qu'ajouter.
  - **Historique.** Remis à zéro à chaque nouveau Daily (`stream_day`), plus de doublon d'une demande non identifiée.
  - **Lab en lecture seule.** Le lecteur est grisé, avec sa raison.
  - **Prochaine étape.** Essai d'Antoni : § 9 de MUSIC_OVERLAYS.md, puis un vrai OBS.

- **09/11 — musique en cours (Windows SMTC) et musiques du stream** : [SMTC_STUDIO.md](SMTC_STUDIO.md). Non validé.
  - **Studio.** La page Spotify affiche ce que joue Spotify Desktop (pochette, titre, album, barre fluide, état), et
    un onglet « Musiques du stream ».
  - **Extension.** Même « en cours » (barre et temps), plus l'historique de **tous** les titres des lives, demandes
    reconnues par le Core seulement, « Skippé » seulement sur une commande.
  - **Pochettes du vrai catalogue réparées** (CSP du Lab).
  - **Coût.** Spotify V2 est inchangé ; +1 lecture par titre quand rien n'est surveillé.
  - **Prochaine étape.** Test d'Antoni ([SMTC_STUDIO.md](SMTC_STUDIO.md) § 6). Restent à observer en réel : la
    fermeture / réouverture de Spotify et le téléphone.

- **09/11 — optimisation Spotify V2 + catalogue réel prêt en Lab** :
  - Consommation et priorités (voies essentielle / catalogue, recherches hors de la boucle, cadence de lecture,
    compteurs locaux) : [SPOTIFY_QUOTA.md](SPOTIFY_QUOTA.md). Simulé : 1 400 → 630 lectures / h de demandes, skip
    derrière 30 recherches 6,2 s → 0,8 s.
  - **Mode B « Lab sur ton compte Spotify »** (lecture seule par défaut, ajouts sur autorisation par session) :
    `Ouvrir Music Hub (Lab, Spotify reel).cmd`, procédure [SPOTIFY_REEL_LAB.md](SPOTIFY_REEL_LAB.md). Prêt, **pas encore
    essayé avec le vrai compte** (action d'Antoni). Mode A (simulé) inchangé : `Ouvrir Music Hub (Lab).cmd`.
  - Spotify V2 Production : rien de déployé ; ces changements n'y arriveront qu'avec un GO (Core + release Studio).

- **Design final intégré dans le vrai module** (retour du 08/11 « une seule liste musicale ») :
  `apps/twitch-extension/extension/modules/music/view.js` + `music.css`. Référence visuelle : prototype
  `prototypes/music-hub/f3-hybride.html` (« F3 finale »). À tester par Antoni : `Ouvrir Music Hub (Lab).cmd`.
  - Champ compact ; en tapant, un **rideau** de résultats descend par-dessus la liste (version exacte, barre
    « Demander · ◆ prix », Échap replie et garde la saisie, défilement indépendant, flèches).
  - **Bandeau** : prix · demandes disponibles (`n / max`) · délai quand il court. Survol = halo ; clic ou Entrée =
    courte explication **des règles de Core** (quota = demandes en cours d'ajout + en file ; délai compté depuis
    l'ajout de la dernière demande, même retirée ensuite), contenue dans le module.
  - **Une seule liste** : « EN COURS » (halo vert, égaliseur) ou « EN PAUSE » = ce que le lecteur **confirme**
    (`now_playing`), demandeur seulement pour une demande ; sinon la 1re demande porte « PROCHAINE MUSIQUE » ;
    file vide + musique = « Rien d'autre en file » ; rien du tout = état vide. Plus de widget flottant.
  - Retrait : poubelle → confirmation (« Conserver » / « Retirer », texte selon en file / en cours d'ajout) →
    remboursement une fois (Core). Modération : menu « … » (avec / sans remboursement). Supermods : lecteur derrière
    l'icône de la ligne « en cours » (pause, passer, volume ; Core vérifie `music.player`).
  - **Notifications** (centre existant via `host.notify`, id stable `music:<demande>:<état>`, jamais en double) :
    retirée par la modération, retirée de la file, non ajoutée (+ remboursement) ; « Pendant ton absence » si c'est
    arrivé avant l'ouverture. Retours d'action en direct (ajoutée à la file, ta musique passe, refus, délai, erreur
    de recherche / lecteur) dans le toast du module.
  - **Musiques de la soirée** (horloge) : données réelles de Core, nouvelle route Lab
    `GET /v1/ext/music/history?before=` → `extensionHistory` (demandes PLAYED / SKIPPED depuis le début du live,
    sinon 12 h, 20 par page). La musique du streamer n'est pas listée (jamais enregistrée).
  - Relectures : l'état toutes les 4 s comme avant, plus **une** relecture seulement quand le résumé musique de la
    session change (avant : une à chaque rafraîchissement de l'hôte) ; l'historique seulement quand on l'ouvre.
- **Ajouts Core (Lab, additifs)** : `me.history[].ended_at` / `reason` ; `extensionHistory` + route
  `/v1/lab/spotify-ext/{ch}/history`. Aucune règle de file, de quota, de délai ni de remboursement modifiée.
- **Tests** : Core 1430 ; extension 127 + `test:music-stability` (stabilité, rideau, bandeau, historique,
  318 → 651 px) + `test:requests` identique ; E2E `music-hub.e2e.ts` réécrit sur le vrai Lab (demande, retrait
  confirmé et remboursé, délai, lien, modération notifiée une fois, pause, transition, historique, relectures).
- **Non couvert par un test UI réel** : retrait **pendant l'ajout** (trop rapide pour le simulateur : couvert par les
  tests Core et la calibration) ; « rien en lecture » sur le vrai Lab (le simulateur joue toujours : couvert par le
  prototype et les tests de calibration).
- **Connexion Spotify réelle** : procédure préparée, rien d'activé — [SPOTIFY_CATALOGUE.md](SPOTIFY_CATALOGUE.md) § 5.
- **Design Lab** (prototypes locaux, jamais versionnés) : comparateur `prototypes/music-hub/index.html` ; versions
  précédentes conservées (`f3-widget-accroche.html`, `f3-pastille-flottante.html`, F2, F, A–E). Sauvegarde :
  `Documents\Sauvegarde Raptoru 2.0\music-hub-design-lab-2026-11-08\` (SHA-256 dans `LISEZMOI.txt`).

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

## 14. Passe de finalisation (09/11, nuit)

Lab seulement. Le Core décide tout ; Studio et l'extension montrent et demandent. Aucune migration : l'état vit dans les
tables du socle de modules (`module_state`, `module_activity`).

### 14.1 Skip payant des viewers (règle validée par Antoni)

- **Prix** : 25 000 Jetons. Chaque skip payé **réussi** dans les 30 min du précédent double le prix suivant
  (25 000 → 50 000 → 100 000 → 200 000…). La fenêtre repart à chaque skip payé réussi ; 30 min sans skip payé réussi :
  retour à 25 000. **Global au stream**, jamais par viewer : changer de compte ne contourne rien.
- **Ne comptent pas** :
  - les skips de la modération et du streamer ;
  - la récompense « Skip la musique » ;
  - tout skip payé qui n'a pas eu lieu.
- **Achat**, sous le verrou de la chaîne. Le Core vérifie dans l'ordre :
  - interrupteur allumé, entrée extension active, demandes ouvertes ;
  - Studio présent, pas de 429 en cours, pas de Lab en lecture seule ;
  - un titre identifié (son uri exact) **en lecture**, pas en pause ;
  - aucun autre skip en route (payé ou de modération) ;
  - prix attendu = prix du Core, solde suffisant.

  Le débit et le job de skip sont écrits ensemble. La même clé (double clic, réseau perdu) rend la même tentative,
  jamais deux débits.

- **Studio** ne passe que **ce titre-là** (`expect_uri`) : si un autre titre joue → `TRACK_CHANGED`, rien n'est envoyé.
- **Règlement** :
  - passé et prouvé par la relecture de Studio → `done`, le prix monte, un message dans le chat ;
  - échec, 429, titre déjà changé, résultat incertain, Studio absent (job jamais pris, 15 s) ou perdu (bail expiré) →
    **remboursé une fois**, le prix et sa fenêtre ne bougent pas ;
  - jamais décidé sur la seule information de Windows (SMTC).
- **Demandes payées protégées** (par défaut, interrupteur « Protéger les demandes payées » dans Studio). Un viewer ne
  peut pas payer pour passer la demande d'un autre, qu'elle soit payée en points ou en Jetons. La modération garde son
  skip gratuit. Raptoru n'éteint jamais l'interrupteur : c'est à Antoni d'arbitrer.
- **Historique** :
  - un skip payé réussi marque le titre « Skippé » (même chemin que la modération) ;
  - « Interrompu » reste un changement manuel probable ;
  - une fin normale n'a aucun badge.
- **Stockage** : `module_activity` (module `music_skip`, une ligne par tentative : `queued` → `done` / `refunded`). Le
  débit et le remboursement passent par le Wallet existant (module `music`), une seule fois par tentative.

### 14.2 Open Bar

- **Studio** : bouton « Ouvrir l'Open Bar » / « Fermer l'Open Bar » sur la page Spotify, avec une confirmation à
  l'ouverture. L'état et l'heure d'ouverture sont visibles ; ouverture et fermeture sont journalisées (`module_activity`,
  module `music_hub`).
- **Ouvert** : les demandes **depuis l'extension** coûtent 0 Jeton et n'ont plus de limite de nombre par personne.
- **Ce qui reste en place** :
  - 20 s entre deux demandes d'une même personne (limite de fréquence courte, affichée) ;
  - 50 musiques au plus dans la file (en file + en cours d'ajout) ;
  - doublons refusés, recherches limitées ;
  - modération et disponibilité de Spotify.
- **Les skips payants restent payants.** La récompense de points de chaîne ne change pas : son coût est fixé par Twitch.
- **Robustesse** :
  - le Core relit l'état sous le même verrou que chaque demande : effet immédiat, et les demandes déjà payées gardent
    leur prix ;
  - une page restée sur « gratuit » après la fermeture reçoit `price_changed` : rien de gratuit après la fermeture ;
  - l'état persiste (redémarrage du Core testé).
- **Fermé** : prix et limites habituels reviennent. Le délai normal entre deux demandes compte depuis la dernière
  demande, comme toujours.

### 14.3 Vue modérateur

- **Qui voit quoi** :
  - supermods et streamer (permission existante `music.player`) : **Pause / Reprendre** et **Passer** directement sur
    la ligne « en cours », le volume derrière l'icône de réglages ;
  - un modérateur simple n'a pas ces boutons et garde le retrait des demandes ;
  - un viewer voit le bouton du skip payant.
- **Seek** : clic (ou flèches) sur la barre → « Aller à 1:36 ? » → « Aller ». C'est une vraie commande Spotify
  (`PUT /me/player/seek`), sur **le titre vu** ; si un autre titre joue, rien n'est envoyé.
  - Jamais dans les 6 premières ni les 8 dernières secondes : ce serait une nouvelle lecture ou un skip déguisé.
  - Un seek n'est ni une nouvelle musique, ni un skip, ni une décision d'historique.
  - Mêmes conditions que les autres commandes (« Commandes du lecteur » dans Studio).
- **Indisponible** (Studio absent, commandes coupées, **Lab en lecture seule**) : boutons grisés, avec la raison écrite.
- **Résultat affiché** : toujours la réponse de Studio, jamais « Pause demandée » comme un succès. La page Spotify de
  Studio suit maintenant aussi la réponse réelle de ses propres boutons.
- **Lab en lecture seule** : Studio le signale au Core (`read_only`, seulement en Lab réel). Le Core refuse alors pause,
  skip, seek et skip payant (`lab_read_only`).

### 14.4 `!song`

- **Annonce Twitch** : le Core utilise le mode `announce` du bot, déjà en place (scope `moderator:manage:announcements`
  de LeCroupier_, qui est modérateur). Aucune nouvelle permission demandée, aucune permission de Production élargie.
- **Repli** : si le bot ne peut pas annoncer (scope absent, refus de Twitch), le Core réécrit **une fois** la même réponse
  en message normal. Jamais après un envoi « incertain » : il a peut-être été vu.
- **30 s de délai global** entre deux réponses : les `!song` entre-temps sont ignorés en silence (rien n'est écrit,
  aucun job).
- **Source** : Windows (SMTC via Studio) répond tout de suite, **sans appel Spotify** (« En cours » ou « En pause »). Le
  demandeur n'est cité que sur l'attribution exacte du Core.
  - Windows muet (90 s) ou état périmé : une lecture de Studio, comme avant.
  - Rien ne joue : « Aucune musique en cours. »
- ⚠ **Changement de comportement en Production** au prochain déploiement du Core (annonce, délai, réponse SMTC) : à
  valider par Antoni avant tout GO.

### 14.5 Historique par Daily

Le principe du 09/11 ne change pas : un nouveau Daily = un historique visible vide. Le Daily est maintenant pris sur la
**session** (son `stream_day`, l'identifiant du module Daily) quand un live canonique est en cours. Sinon, c'est la
journée de stream de l'instant (fenêtre 16:00 → 16:00, Paris) : un live qui traverse minuit garde son historique.

### 14.6 Tests (09/11)

- **Core `music-rules.test.ts`** (nouveau) : 24/24.
  - Prix : 25 000 → 200 000, retour au prix de base, fenêtre relancée, global, skips de modération exclus, prix changé.
  - Achat : solde insuffisant, double clic, deux achats simultanés, skip de modération en route.
  - Échecs (429, Spotify, titre changé, incertain) : remboursés une fois, prix et fenêtre inchangés ; Studio absent ou
    perdu ; cible exacte.
  - Refus : rien, pause, lecture seule, 429, Studio, fermé ; demande protégée.
  - Open Bar : gratuit, sans limite, 20 s, retour aux prix, demande payée avant conservée, file plafonnée, doublon,
    skip toujours payant, fermeture concurrente, redémarrage, journal.
  - `!song` : SMTC, annonce, délai, Windows muet, repli en message.
  - Seek : permissions, bornes, lecture seule.
- **Studio `spotify-runtime.test.ts`** : skip ciblé (`TRACK_CHANGED`), seek prouvé par la relecture — 26/26.
- **E2E `music-final.e2e.ts`** (nouveau, vrai Lab simulé) : vert.
  - Pause / Passer directs, seek confirmé, modérateur sans lecteur.
  - Skip payé 25 000 puis 50 000 : débit unique, « Skippé » dans l'historique.
  - Open Bar depuis Studio (gratuit, retour à 500), panneau, contrôles coupés expliqués.
- **E2E `music-hub`, `music-live`, `music-overlay` (×2)** : verts.

Voir le rapport de livraison pour les suites globales.

### 14.6 bis Audit de fiabilité (09/11, nuit)

Revue contradictoire de cafbf80 (rapport : docs/AUDIT_FIABILITE_2026-11-09.md sur la branche audit/fiabilite-2026-11-09). Corrigé ici :

- **Skip de modération pendant un skip payé** (P1) : refusé (`songskip_busy`, dit dans le chat, Studio et l’extension) — sinon, les jobs passant dans l’ordre, il passait aussi le titre suivant. La récompense « Skip la musique » (désactivée) n’est pas modifiée.
- **Fin de titre** (P2) : skip payé refusé dans les 10 dernières secondes (`track_ending`, avant tout débit) ; Studio refuse aussi à moins de 5 s de la fin (`TRACK_CHANGED`, remboursé).
- **Fraîcheur** (P3) : la cible d’un skip payé ou d’un seek n’est prise que sur une lecture Studio de moins de 15 s ; prix attendu obligatoire pour un skip payé.
- **`!song` en Production** (P2) : le nouveau `!song` (annonce, délai de 30 s, réponse Windows) est derrière `songV2`, allumé dans le Lab seulement. Un Core de Production garde le `!song` historique tant qu’Antoni n’a pas décidé.
- Toast du seek : la position réellement appliquée (bornée par le Core).
- Restent documentés (non corrigés) : skip payé exigeant un Studio à jour (un Studio 0.1.27 ferait un skip non ciblé) ; un skip réellement fait mais non prouvé (bail expiré) est remboursé ; réannonce de l’overlay après une coupure Windows ou un redémarrage de Studio sans recharger OBS ; coût du poll Musique (règles relues à chaque poll).

### 14.7 Limites

- Rien n'a été essayé avec un vrai compte Spotify en écriture, sur Twitch, ni dans un vrai OBS.
- L'annonce Twitch n'a pas été envoyée pour de vrai (bot de Production non touché) ; le repli est testé côté Core.
- Le skip payant n'existe que depuis l'extension, comme les demandes en Jetons (pas de commande de chat).
- Le prix est plafonné à 25 000 × 2^15 (limite des montants du Wallet), inatteignable en pratique.
- Après la fermeture de l'Open Bar, le délai normal (10 min) compte depuis la dernière demande, même gratuite.

### 14.8 Essayer (Lab simulé)

1. `Ouvrir Music Hub (Lab).cmd` (il allume aussi le skip payant du Lab).
2. Viewer : bouton ⏭◆ sur « en cours » → le prix (25 000) → « Passer ». Le prix suivant est 50 000.
3. Supermod : Pause / Passer sur « en cours » ; clic sur la barre → « Aller ».
4. Studio › Spotify : « Ouvrir l'Open Bar » → l'extension affiche « Open Bar », la demande est gratuite ;
   « Fermer l'Open Bar » → 500 Jetons.
5. Chat simulé : `!song` deux fois de suite → une seule réponse.
6. Overlay : [MUSIC_OVERLAYS.md](MUSIC_OVERLAYS.md) § 3 ter.

## 15. Passe après le test réel d'Antoni (10/11)

Antoni a testé Studio 0.1.28 et le Hosted Test sur son vrai Spotify Desktop : pause, reprise, skip, volume et
affichage fonctionnent. Corrigé ensuite, sur la branche `fix/music-hub-finish` :

- **Clignotement de la carte « en cours » (Studio)**
  - Cause : la carte était réécrite d'un bloc (`innerHTML`) dès qu'un caractère changeait. Une action, chaque
    événement Windows (son compteur entrait dans la signature) et la relecture après l'action reconstruisaient
    plusieurs fois de suite la pochette, le titre, les boutons et le curseur.
  - Correction : `morph()` (`web/src/ds/ds.ts`) garde les nœuds et ne réécrit que ce qui change. La barre et les temps
    (`data-own`) restent au script, et un bouton du lecteur garde le focus.
- **« Le lecteur n'a pas confirmé l'action » alors que Spotify l'avait faite**
  - Causes :
    - une seule relecture, aussitôt après la commande, alors que `/me/player` rend encore l'ancien état un moment ;
    - après un 5xx (Spotify exécute parfois une commande en répondant 502), la pause de 1 s de Studio refusait cette
      relecture (`TEMPORARY_ERROR`) ;
    - un skip incertain n'avait qu'une relecture, à 250 ms.
  - Correction :
    - relectures à 0 / 0,3 / 0,7 / 1,2 / 1,8 s jusqu'à la preuve ; non prouvé : « incertain » ;
    - la commande n'est **jamais renvoyée** ;
    - la page attend 12 s et distingue « pas confirmé à temps » d'un refus.
- **Progression du skip payant réglable dans Studio** (Spotify › Extension) : prix de base, multiplicateur, retour au
  prix de base.
  - Défauts inchangés : 25 000, ×2, 30 min. Le Core les valide (base de 100 à 10 000 000, multiplicateur de 1 à 10
    avec deux décimales au plus, fenêtre de 1 à 720 min) et journalise chaque changement.
  - Prix = base × multiplicateur^n, avec n le nombre de skips payés réussis enchaînés, plafonné à 1 000 000 000.
  - Un changement en cours de série s'applique au prochain skip, sur le même n ; une page restée sur l'ancien prix
    reçoit `price_changed`.
- **Vue supermod** : Pause / Reprendre et Passer étaient déjà directs. Le troisième bouton (volume) a maintenant un
  haut-parleur au lieu d'une icône de réglages ambiguë. E2E `music-roles` (318 / 400 / 565 px), captures dans
  `.lab-data/music-hub-captures/roles`.
- **Prévisualiser les vues sans la Production** : `Ouvrir Music Hub (Lab).cmd` ouvre l'extension du Lab en viewer,
  modérateur et supermod. Le Studio de Production reste séparé du Lab.

Livraison :
- Core, pour les réglages de progression ;
- Studio 0.1.29, pour le clignotement, les confirmations et le panneau ;
- nouveau ZIP, pour l'icône du volume et le texte du multiplicateur. Dans Twitch, il remplace les fichiers de la
  version en Hosted Test, sans nouveau numéro de version.
