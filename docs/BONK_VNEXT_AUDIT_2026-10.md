# Bonk VNext — document de référence (état au 15/10/2026)

> **Document canonique de Bonk VNext.** La section 0 donne l'état exact (lots, commits, validations, règles figées,
> déploiement, suite). Les sections 1–2 décrivent le Bonk **d'avant VNext** (audit du 14/10/2026 sur `c7f20de`,
> historique). Les sections 3–17 sont l'architecture validée par Antoni le 14/10/2026 ; quand l'implémentation
> diffère du plan, une note « Implémenté » le dit.

## 0. État au 15/10/2026

**Bonk VNext est FONCTIONNELLEMENT TERMINÉ ET VALIDÉ EN LOCAL** (Lots 0–3, 5 et 6 + tutoriel / UX, validation
manuelle d'Antoni dans le vrai Studio + vrai OBS, 14–15/10/2026). Lot 4 FX rares : reporté, non bloquant.

Branche `feat/compact-video-port`, dernier commit de code Bonk `c4b82c9` (+ le commit docs de ce checkpoint). **Tout est
local** : rien n'est poussé au-delà de `c7f20de`, rien n'est déployé, rien n'est dans `main`, aucune release Studio.
Staging, Hosted Test et cutover restent des étapes séparées.

| Lot                                        | Statut                    | Commits                                                                 | Validation manuelle (Antoni, vrai Studio + vrai OBS) |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| 0 — fondation production                   | **VALIDÉ**                | `c410833`, `ba2dfc8`                                                    | OK le 14/10/2026 (Lab)                               |
| 1 — renderer VNext                         | **VALIDÉ**                | `af5c78e`                                                               | OK le 14/10/2026                                     |
| 2 — cible Manuel / Plein écran             | **VALIDÉ**                | `895e5dd`                                                               | OK le 14/10/2026                                     |
| 3 — Auto OBS (+ correctif, + physique)     | **VALIDÉ**                | `8267fda` (lot 3), `e5dab8e` (échelle négative), `639fc0f` (contact)    | OK le 15/10/2026                                     |
| 5 — Salves / Chargeur                      | **VALIDÉ**                | `f32dab9` (Core), `7ebf478` (Studio), `b64c3b9` + `6290b72` (Extension) | OK le 15/10/2026                                     |
| 6 — FX historique + combo multi-viewer     | **VALIDÉ**                | `8d54b8f` (Studio, overlay)                                             | OK le 15/10/2026                                     |
| Tutoriel + UX Bonk (catalogue, chargeur)   | **VALIDÉ**                | `c4b82c9` (Extension)                                                   | OK le 15/10/2026                                     |
| 4 — FX rares (explosion mini-emotes, etc.) | **reporté**, non bloquant | —                                                                       | —                                                    |

### Lot 0 — fondation production (VALIDÉ)

- **Sweep périodique** Bonk, Soundboard et TTS (Core public, toutes les 15 s, indépendant des claims) : un élément
  orphelin (aucun Studio ne réclame sa chaîne) expire, remboursement au plus une fois, aucune ligne supprimée, baux
  perdus → `execution_unknown`. Sûr avec plusieurs instances Core (verrou de chaîne, transitions conditionnelles,
  index unique du registre ; test PostgreSQL réel à 3 Core).
- **`wrong_channel`** : un Studio d'une autre chaîne que le Core est refusé en 409 au heartbeat (non enregistré →
  viewer refusé `studio_offline` avant tout débit) et au claim, pour Bonk, Soundboard et TTS ; un Studio sans
  `channel_id` dans son heartbeat reste accepté.
- **Reconnexion OBS automatique** (1 / 2 / 5 / 10 s, arrêt sur mot de passe refusé) ; **mot de passe OBS** gardé par
  Electron main via `safeStorage` (DPAPI sous Windows) dans `%APPDATA%\Raptoru Studio\obs-connection.json` (port en
  clair, mot de passe chiffré, jamais en clair), rejoué au serveur à chaque démarrage.
- **Reste à faire :** `wrong_channel` et le sweep ont une forte couverture automatique, mais **leur validation sur le
  staging réel reste à faire au prochain déploiement**.
- **Ordre de déploiement obligatoire : Core d'abord, Studio ensuite.** L'ancien Core staging refuse le nouveau champ
  `channel_id` du heartbeat (schéma strict, 400 `invalid_request`) : un Studio de cette branche contre l'ancien Core
  perd Bonk / Soundboard / TTS en profil Production.

### Lot 1 — renderer VNext (VALIDÉ)

- Moteur séparé `apps/studio/server/bonk-overlay/engine/` (`size`, `target`, `families`, `presets`, `physics`,
  `plan`, `density`, `audio`, `scene`) ; `overlay.js` garde le transport et câble le moteur ; `bonk-v3-core.js`
  inchangé (seul son générateur à graine est importé).
- Tailles autour de **140 px** (80 % à ±10 px, 94 % à ±20 px, gros rares) ; **8 familles** de trajectoires pondérées
  avec anti-répétition ; impacts variés ; rotations (lent / rapide / vrille) ; presets communs (impact, squash, rebond,
  glisse, chute, vrille) ; densité **18 / 30** sans jamais perdre un tir payé ; **audio adaptatif** (1 sur 2 / 3 / 5,
  ≤ 5 sons/s, volume jusqu'à 45 % en rafale, retour après calme) ; graine = `interaction_id`.
- **Tester 1 / 5 / 10** : aperçu renderer-only (ni Core, ni wallet, ni journal, ni ACK, ni historique — test
  d'invariant).
- Aucun changement Core / paiement / transport / cadence / ACK.
- **Paramètres visuels et audio validés : ne plus les modifier sans décision explicite d'Antoni.**

### Lot 2 — cible Manuel / Plein écran (VALIDÉ)

- Modes Manuel et Plein écran ; réglages **par profil** (`bonk-settings.json` à côté du journal Lab / Production),
  écriture atomique, conservés au redémarrage.
- Éditeur « Cible des Bonk » : capture de la scène programme OBS (lecture seule), rectangle déplaçable /
  redimensionnable, champs en pixels, aimantation ; **brouillon local** jusqu'à « Enregistrer » ; « Annuler » revient à
  la valeur enregistrée ; « Réinitialiser » remet la zone par défaut (480 × 300 autour de 960 × 400) dans le brouillon.

### Lot 3 — Auto OBS (VALIDÉ)

- **Aucune vision / IA** : uniquement obs-websocket en lecture seule (`GetVideoSettings`, `GetCurrentProgramScene`,
  `GetSceneItemList`, `GetGroupSceneItemList`, `GetSourceScreenshot`), jamais de `Set…`.
- Scène programme lue récursivement (groupes, scènes imbriquées) ; modèle libobs composé en matrices affines :
  **crop, bounds, échelle, rotation, échelle négative (flip)**, découpage à chaque niveau (crop, `cropToBounds`, canvas
  imbriqué), boîte englobante du polygone final dans l'espace de l'overlay.
- **Candidats caméra déterministes et expliqués** (type de source, nom, surface) ; Browser / Game / Display / Window
  Capture, images, texte, couleur, audio exclus ; deux caméras de taille proche → aucune cible Auto.
- **Source préférée / épinglage** (par `sourceUuid`, sinon par nom), persisté par profil (réglages v2 ; fichiers v1
  relus en v2).
- **Fallback** : source épinglée visible → sinon meilleur candidat fiable visible → sinon zone Manuel du profil.
  **Jamais une vieille géométrie Auto** : un événement qui peut masquer une caméra efface la cible Auto
  immédiatement (Manuel jusqu'à la relecture), et l'overlay relit la cible juste avant chaque tir.
- Suivi sur événements OBS (recalcul 150 ms après le dernier) + resynchronisation toutes les 10 s ; sans lecture
  réussie depuis 15 s → Manuel.
- Éditeur : modes Auto / Manuel / Plein écran, rectangle Auto en lecture seule sur la capture, libellé
  « Auto : source · chemin », état, sélecteur de source préférée, candidats et leurs raisons, **Copier vers Manuel**.
- **Bug réel corrigé pendant la validation (`e5dab8e`).** Structure réelle d'Antoni :
  `Scène Dessin > overlay cam shushu > Rognage > Camera > Cam`. « Cam » était bien trouvée mais supprimée par le
  calcul géométrique : l'item « Camera » a un `scaleX` négatif (retourné) et le moteur prenait `abs(scaleX)`.
  Correctif : garder le signe de l'échelle comme libobs (la boîte part de l'autre côté du point d'ancrage) ; test avec
  la structure et les transforms réels. Auto détecte maintenant « Cam ».
- **Validé dans le vrai OBS :** Auto prêt sur « Cam » ; déplacement / resize / crop / rotation / flip suivis ;
  changement de scène et masquage → fallback correct ; Manuel, Plein écran, épinglage et persistance OK.
- **Non fait (assumé) :** Manuel par scène (reporté) ; occultation d'une caméra par une source opaque au-dessus
  (OBS ne donne pas la transparence — l'épinglage règle ce cas).

### Physique Bonk — décision produit FIGÉE (`639fc0f`, validée visuellement)

**Tous les Bonk ont un contact physique lisible avec la cible.** Supprimés : traversée libre de la zone, passage à
côté, traversée de l'écran en Plein écran.

| Point d'impact        | Part | Contact                                                      |
| --------------------- | ---- | ------------------------------------------------------------ |
| Bord                  | 45 % | rebond vers l'extérieur                                      |
| Intérieur hors centre | 22 % | choc sur la surface, rebond vers le haut                     |
| Ras du bord (graze)   | 30 % | rebond vers l'extérieur (à moins de 0,4 × la taille du bord) |
| Centre                | 3 %  | choc sur la surface                                          |

- Plein écran : toujours un choc sur l'écran (« glass »), rebond.
- **Intensité du rebond** : fort 25 %, normal 50 %, faible 25 % (× restitution du preset). Tout contact sur un bord
  repart **vers l'extérieur**, avec une vitesse minimale lisible.
- Retombées existantes conservées (glissade, chute, rebond au sol, vrille).
- **Ne plus modifier cette physique sans décision explicite d'Antoni.**

### État de déploiement (rien de VNext n'est déployé)

- Travail **validé localement** sur `feat/compact-video-port` ; `main` intact (`d2b61ef`, = `origin/main`).
- **Staging Coolify** (`raptoru-core-staging`) : toujours sur l'état déployé précédemment, `c7f20de` (= dernier commit
  poussé de `origin/feat/compact-video-port` ; emotes Twitch OAuth B1 / B2), chaîne `raptoru_` (83603689), déploiement
  manuel. Il ne contient **aucun** lot VNext.
- **Hosted Test** : toujours le ZIP `raptoru-live-STAGING-hosted-test-c7f20de4430a.zip`. Le Lot 5 et la passe
  tutoriel / UX touchent l'Extension : **un nouveau ZIP sera nécessaire** au prochain test Hosted Test.
- **Studio publié** : n'a reçu aucun lot VNext.
- **Prochain déploiement coordonné** (seulement avec l'accord d'Antoni) : Core staging d'abord, puis Studio,
  validation sur le staging (dont `wrong_channel` et le sweep réels), puis seulement décision de promotion.
- **Bloquants prod toujours ouverts** (hors Bonk VNext) : l'overlay refuse tout paiement non simulé ; le Core public
  débite le Wallet de test (`labEconomy`) — lot cutover Wallet. La source overlay reste trouvée par son nom
  « Raptoru Bonk Lab ».

### Lot 5 — Salves / Chargeur : VALIDÉ (15/10/2026)

**Référence visuelle et fonctionnelle :** le prototype `prototypes/bonk-salves-ux/serie7/final.html` (+ `cg7.js`,
`cg7.css` ; dossier ignoré par Git, sur le poste d'Antoni). C'est une **spécification** : rien ne s'en retire, ne se
simplifie ou ne se remplace en silence. Les séries 1 à 6 du même dossier sont de l'historique.

Direction produit inchangée (§ 4) : une salve = **N Bonk individuels**, **admission atomique**, **aucun Bonk payé
perdu**, cadence pilotée **côté overlay**. L'auto-fire maintenu reste hors scope.

**Deux modes seulement** :

| Mode   | Un clic sur le prix                                          | Prix affiché                            | Économie                                                                                       |
| ------ | ------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Manuel | **1 Bonk**, la munition suivante, dans l'ordre               | prix d'**un** Bonk                      | une admission Bonk individuelle normale par clic ; **pas de prépaiement du chargeur**          |
| Auto   | **toute la salve restante**, d'affilée, à la cadence choisie | **munitions restantes × coût unitaire** | **une admission atomique de toute la salve** : débit total ou rien ; jamais de salve partielle |

- **Prix** recalculé immédiatement dans les deux sens (ex. 7 restantes × 200 : Manuel 200, Auto 1 400, retour Manuel
  200). 1 munition en Auto = même prix que Manuel (1 × coût) : normal.
- **Cadence Auto** : bouton éclair compact, 4 niveaux (clic = niveau suivant) — **Lent 420 ms · Moyen 260 ms · Rapide
  160 ms · Très rapide 95 ms** entre deux départs ; le libellé n'est qu'en infobulle / aide.
- **Pendant une salve Auto** (admise, donc payée d'un bloc) : le switch Manuel / Auto est **verrouillé et visiblement
  désactivé** (« Salve en cours… ») ; le prix Auto peut suivre les munitions restantes ; à la fin, le switch se libère
  et le chargeur se recharge (la sélection reste pour relancer).
- **Switch Manuel / Auto** : glissant, position et taille fixes ; **conserve le chargeur** (Auto envoie ce qui reste) ;
  **ne rejoue jamais l'animation de recharge** ; aucune variation de géométrie.
- **Supprimés** : la **Boucle** (doublon de « ↻ Recharger », gratuit, quand le chargeur est vide) et **Rafale ×N**
  (aucun multiplicateur de chargement : un clic catalogue = une munition).

**Invariants UX à ne pas modifier** :

- Rangée fixe `[compartiment][switch 72 px][emplacement 28 px : vide en Manuel, éclair en Auto][prix 84 px]` : rien ne
  bouge ni ne change de taille entre Manuel et Auto, déplié comme replié.
- Compartiment sombre de largeur fixe ; emotes chargées **de gauche à droite** (une vignette par emote + badge de
  quantité ; clic = −1, clic droit / appui long = retirer l'emote) ; jauge de munitions **de gauche à droite** (segments
  compacts qui allongent la barre, ne se resserrent que quand la place manque).
- Débordement : **aucune barre de défilement ni compteur** ; une petite flèche seulement du côté qui cache encore des
  emotes ; molette / glisser / aimantation **captifs** au module (la page ne défile jamais).
- **Vider** : languette qui sort du rebord gauche du compartiment (rattachée au rebord, côté libre arrondi), en
  **overlay** (ne pousse rien), vide tout le chargeur, **annulable** (« Chargeur vidé · Annuler »).
- **Recharge** : animation validée (segments un par un en accélérant, ~0,7 s) ; jouée seulement quand la réserve est
  vraiment reconstruite (après une salve Auto, « ↻ Recharger », aléatoire, Annuler), **jamais** au changement de mode.
- **Repli** : la rangée de munitions glisse dans la jauge ; replié, on tire et on change de mode, même géométrie.
- **Catalogue** : aucun état de sélection redondant ; un clic = une munition ; l'emote vole vers le chargeur.
- Aide « ? » : fiche des vrais contrôles, survol = mise en évidence dans le chargeur.

**Nombre maximal de munitions : décision canonique conservée.** Les prototypes utilisaient 20 ; ce n'était pas une
décision. La règle canonique est celle du § 4 et du § 12 : **bornes Core `shot_count` 1–10 et `cadence_ms` 90–600,
réglages économiques du Core, jamais fixés par le client**. Le Lot 5 les garde dans **une seule** valeur Core
(`BONK_LAB_RULES`), exposée à l'Extension qui l'affiche ; passer à 20 = changer cette seule valeur (décision d'Antoni).

**Implémentation (15/10/2026, locale, validée par Antoni le 15/10/2026)** — option C du § 4, sans architecture parallèle :

- **Core** (`f32dab9`) : `admitVolley` = N Bonk individuels dans **une** transaction (modération une fois, chaque
  emote résolue, séquences de chaîne contiguës, **un débit par tir** : un refus — solde, emote, file, bornes — et
  rien n'est stocké ni payé). Idempotence par salve (clé `<clé>#<index>`, même hash ; rejouée = mêmes tirs, rien
  repayé). `claimBatch` remet le tir suivant **et le reste de sa salve** dans la même transaction (chacun avec sa
  livraison, son bail, son ACK, son remboursement avant démarrage, son sweep) ; le `claim` historique ne prend
  toujours qu'un tir (jamais un tir réservé sans être rendu). Le Bonk simple (Manuel) est inchangé.
- **Contrats** : migration Lab additive `20261018120000_bonk_lab_volleys.sql` (`volley_id`, `volley_index`,
  `volley_count`, `cadence_ms`, nulles pour un Bonk simple ; périmètres Lab + extra staging, jamais prod) ;
  `POST /v1/lab/bonk/volleys` ; `GET /v1/lab/bonk/rules` ; réponse du claim `{interaction, volley}` (champ ajouté,
  ignoré par un ancien Studio) ; interaction `volley: {id, index, count, cadence_ms} | null` ; `/v1/ext` et la
  façade Lab acceptent `payload.shots` + `cadence_ms` et exposent `module.volley` (bornes Core).
- **Studio** (`7ebf478`) : le worker journalise une entrée par tir, dans l'ordre (garanties inchangées : « sent »
  avant l'effet, redémarrage = `execution_unknown`, jamais rejoué). L'overlay démarre le tir k+1 `cadence_ms` après
  le tir k (`engine/cadence.js`, pur et testé) en relisant la cible juste avant chaque tir ; tailles, trajectoires,
  physique, son et cibles inchangés.
- **Extension** (`b64c3b9`, `6290b72`) : chargeur persistant `shared/bonk-chargeur.js` (+ modèle pur
  `bonk-chargeur-model.js`, `bonk-chargeur.css`) ; `ui.js` ne fait que le câbler (−358 lignes : ancien dock,
  Boucle, tiroir et composer retirés). Manuel = `/actions/tokens` par clic (munition rendue si refus) ; Auto =
  `spendBonkSalve` avec une clé conservée pour la même salve (retry réseau / double clic : jamais payé deux fois),
  switch verrouillé pendant la lecture locale à la cadence, puis recharge.
- **Preuves automatiques** : Core 469 tests (dont 12 salves : atomicité, solde insuffisant, idempotence, bornes,
  ordre, claim groupé, remboursement par tir, Studio perdu, expiration, routes, `/v1/ext`) + PostgreSQL réel à
  3 Core (même salve deux fois en parallèle + Bonk simples : une salve, séquences contiguës, payée une fois, remise
  entière) ; Studio 283 (salve de bout en bout dans le worker, 4 cadences) ; Extension (modèle du chargeur).
  Banc isolé avec la **vraie** extension à 565 × 376 + vrai Core Lab + vrai worker : 2 tirs Manuel joués, salve
  « Rapide » à 161–169 ms entre départs, géométrie identique au switch, en replié et poubelle ouverte, plein à 10,
  Vider / Annuler, aide.
- **Validé localement par Antoni (15/10/2026)**, avec la passe tutoriel / UX `c4b82c9` : tutoriel Bonk à bulles (carte
  fixe centrée, mise en avant douce, « Ne plus afficher ce tutoriel automatiquement », « ? »), catalogue (catégories
  repliables, scroll doux, distinction groupe / catégorie, Récents figés pendant l'ouverture), chargeur toujours
  visible même vide, retrait d'emotes (clic gauche, clic droit, dernière unité, pile > 1 — sortie sur place),
  poubelle compacte + Vider tout / Annuler, feedbacks dans la bulle du chargeur.
- **Reste (étapes séparées, accord d'Antoni)** : staging (migration Lab à appliquer), Hosted Test (nouveau ZIP
  Extension), vrai Twitch. Non fait : test Core Wallet canonique d'une salve (le Lab débite le Wallet de test) ; la
  lecture locale de la salve dans l'Extension est une estimation à la cadence (l'Extension ne voit pas l'overlay).

### Lot 6 — FX d'impact historique + combo multi-viewer : VALIDÉ (15/10/2026)

Commit `8d54b8f` (Studio, overlay uniquement ; local, non poussé). Aucun changement Core, Extension, contrat,
migration, wallet ni admission. **Les Bonks normaux sont identiques** au moteur validé : 8 000 plans comparés à
`b5740b4` (zone par défaut, Plein écran, autre zone, scène dense) → 0 différence (tailles, trajectoires, physique,
contact, rebonds, sons, densité, cibles, cadences inchangés).

**FX d'impact = la FX historique** (source de vérité : `Alerte_system.html` de l'ancien overlay, `spawnBonkImpact`

- `.bonk-wave` / `.bonk-streak` / `.bonk-particle` et leurs keyframes, identiques dans toutes les versions sauvegardées
  de juin à août 2026). `engine/impact-fx.js` + `overlay.css` : 12 streaks (mêmes angles, longueurs, épaisseurs, rayons,
  dégradé, `bonkStreak` 576 ms `cubic-bezier(.1,.75,.22,1)`), réglages `spread 0.68`, `epais 1.9`, `lent 1.6`, échelle
  `taille / 130`, centrée sur l'emote au contact, onde derrière l'emote, éclats devant, retirée à 812 ms.

* **Deux variantes** tirées par l'id du tir : **Legacy sans cercle 70 %**, **Legacy exact (onde `bonkWave`) 30 %**.
* **Seul écart avec le legacy** (demande d'Antoni) : 8 particules au lieu de 11 (les 3 plus petites retirées).
* Remplace l'ancien « puff » ; comme lui, pas de FX en scène dense (≥ 18 projectiles).

**Combo multi-viewer** (`engine/combo.js`, branché dans `overlay.js` sur le vrai flux d'exécution) :

- compte les **viewers distincts** (`Set` de `viewer_id`) parmi les Bonks **réellement joués** (après `started`) —
  jamais les tirs : une salve de 10 d'un viewer = 1 participant ; jamais les aperçus « Tester » ; un `interaction_id`
  rejoué (retry / idempotence Core) est déjà écarté par le renderer ;
- fenêtre **`COMBO.windowMs = 5000`** (valeur canonique `BONK_COMBO_WINDOW_MS` du moteur legacy), rafraîchie par chaque
  Bonk ; à l'expiration : **≥ 2 viewers → un finisher**, sinon rien ; puis remise à zéro complète. Un seul timer
  vivant, un timer périmé ne ferme jamais une fenêtre plus récente (pas de double finisher, pas de combo fantôme) ;
- état minimal : le `Set` des viewers + un compteur par emote distincte ; **emote du finisher** = la plus utilisée du
  combo, la plus récente en cas d'égalité (déterministe).

**Finisher** : une seule grosse emote jouée par **la même scène et le même simulateur** (`planShot` avec
`finisherSize`, pas de moteur parallèle), jamais d'ACK ni d'appel Core (effet visuel, rien de payé n'en dépend).

- **Taille = nombre de viewers distincts uniquement**, volontairement absurde : 2 → 260 px, 3 → 340, 4 → 430,
  5 → 530, 6 → 640, 7 → 760, 8 → 880, 9 → 1 000, 10 → 1 100 (toute la hauteur), puis +130 px par viewer ;
  **borne technique seule** `FINISHER.maxSize = 2400` px.
- **Masse dérivée de la taille** (`finisherMass`, poids = log2(taille / 140)) : entrée plus lente, moins de rotation,
  rebond plus mou, écrasement plus fort, plus longtemps au sol ; famille « lourd » (son lourd) ; départ entièrement
  hors écran ; au-delà de 400 px, sortie par rétrécissement. Mesuré : normal ≈ 0,7 s d'entrée / 2,9 s à l'écran ;
  2 viewers ≈ 1,1 / 3,4 s ; 10 viewers ≈ 1,6 / 4,6 s.
- FX **Legacy exact** forcée, à l'échelle de l'emote ; jamais réduit par la densité ; hors du contexte
  anti-répétition des Bonks normaux.

**Preuves automatiques** : Studio 303 tests (dont 20 nouveaux du lot 6 : 1 viewer seul, 2 / 3 / 5 / 10 viewers, un viewer
qui envoie plusieurs Bonks, salve d'un viewer, deux viewers avec salves, expiration, reset, timer périmé, emote du
finisher, tailles et masse, trajectoire du finisher finie / bornée / passant par l'impact, FX exact / sans cercle,
répartition 30 / 70, nettoyage du DOM, Bonk normal identique après un finisher géant), lint, typecheck. Banc
navigateur : le **vrai** `overlay.js` dans Chromium, routes renderer de Studio simulées — salve solo de 6 → aucun
finisher ; 3 viewers → finisher 340 px ; 12 viewers → finisher 1 360 px plein écran ; Bonk normal ensuite ; 25 / 25
interactions `started` + `completed`, scène vide à la fin, aucune erreur.

**Validé localement par Antoni (15/10/2026)** : FX Legacy / Legacy sans cercle, combo multi-viewer et finisher
géant. Staging / Hosted Test restent des étapes séparées (accord d'Antoni). Lot 4 « FX rares » : **reporté**, non
bloquant (éventuel polish futur).

## 1. Architecture Bonk avant VNext (audit du 14/10/2026, historique)

| #   | Étape            | Fichiers                                                                                                                                                         | Données                                                                                                                                                                                                                                                                                                                                        | Côté      |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Clic viewer      | `extension/shared/ui.js` (`sendBonk` l.2100, formulaire l.3780+, « + Munitions » l.3543)                                                                         | `spendTokens('bonk', {emote_source, emotes:[id], emote_glyph})` + clé d'idempotence par clic                                                                                                                                                                                                                                                   | Extension |
| 2   | Frontière viewer | `core-api/src/ext/ext-facade.ts` `spend()` l.560                                                                                                                 | JWT → viewer ; `emotes.length` doit valoir **1** ; `channel_id` = chaîne du Core                                                                                                                                                                                                                                                               | Core      |
| 3   | Admission        | `core-api/src/bonk-lab/bonk-lab-service.ts` `admitTx()` l.354                                                                                                    | 1 transaction : verrou canal → idempotence (hash) → pause globale / module / blocage / cooldown → validation emote (catalogue Twitch du viewer, 7TV/BTTV/FFZ, Twemoji) → `sweep` → Studio prêt (heartbeat < 10 s, OBS, source, renderer) → file ≤ 50 → `channel_sequence` +1 → ligne `queued` (`expires_at` = +120 s) → débit wallet (même tx) | Core      |
| 4   | Paiement         | `economy.debit` (défaut `labEconomy`, Jetons de test) ; `refund` idempotent (expiré, échec avant start, modération)                                              | 200 `jetons_lab`, `real_debited = 0`                                                                                                                                                                                                                                                                                                           | Core      |
| 5   | Claim            | `bonk-lab-service.ts` `claim()` l.651 ; route `http/studio-transport-routes.ts`                                                                                  | Studio prêt + module actif + **aucun claim non démarré** → plus ancien `queued` par `channel_sequence` → delivery (attempt, bail 30 s)                                                                                                                                                                                                         | Core      |
| 6   | Studio           | `studio/server/src/bonk-lab/worker.ts`, `runtime.ts`, `worker-loop.ts`                                                                                           | Boucle 150 ms : heartbeat, ACK en attente, claim (≤ 12 entrées locales). Journal disque : `sent` écrit **avant** de donner l'effet → jamais de rejeu                                                                                                                                                                                           | Studio    |
| 7   | Overlay          | `studio/server/bonk-overlay/overlay.js` + `bonk-v3-core.js` (moteur legacy copié octet pour octet)                                                               | Poll `/next` toutes les 100 ms ; vérifie l'URL d'emote (allowlist CDN) ; **refuse tout ce qui n'est pas `test_mode` + `simulated`** ; anime ; ACK `started` puis `completed` (retry ACK seulement)                                                                                                                                             | Overlay   |
| 8   | ACK              | Studio journalise puis relaie à Core (`ack()` l.702) : `started` → `executing` (bail 60 s), `completed`, `failed` (+ refund si non démarré), `execution_unknown` | Core                                                                                                                                                                                                                                                                                                                                           |

### Où sont calculés les paramètres visuels aujourd'hui (tout overlay-side)

| Paramètre         | Où                    | Valeur actuelle                                                                                                                                                                           |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position d'impact | `overlay.js`          | **fixe** (960, 400) sur un canvas fixe 1920×1080                                                                                                                                          |
| Taille            | `overlay.js`          | **fixe 150 px** (`sampleBonkSize` existe dans le moteur mais n'est pas utilisé ; il donnerait 0,45×–1,55×, soit un écart ×3,4)                                                            |
| Rotation          | `buildBonkTrajectory` | 50 % lente (35–145°/s), 50 % rapide (250–620°/s), puis roulage physique                                                                                                                   |
| Trajectoire       | `buildBonkTrajectory` | 1 seule famille balistique, 6 entrées (top ×2, left, right, topleft, topright), gravité 3 800, rebond sol/bords, sortie « fall » ou « shrink » ; graine = `interaction_id` (déterministe) |
| Durée             | `buildBonkTrajectory` | ≈ 2,6–4,5 s                                                                                                                                                                               |
| Son               | `overlay.js`          | `punch-2.mp3`, volume 0,4, **à chaque impact** (la pool de 7 sons du moteur n'est pas utilisée)                                                                                           |
| Burst / combo     | `bonk-v3-core.js`     | `createBonkComboController`, Giga : **présents mais non branchés**                                                                                                                        |
| Cible caméra      | —                     | aucune (`DEFAULT_CAMERA` constant dans le moteur)                                                                                                                                         |

### Réponses directes

- **1 clic = 1 interaction** Core. Aucun lot. Le mode « Munitions » de l'extension est un chargeur local : chaque clic tire la munition suivante, toujours 1 requête.
- **Ordre** : `channel_sequence` alloué sous verrou de canal, claim strictement dans l'ordre.
- **Délais** : expiration 120 s si jamais démarré ; bail 30 s claim→started ; 60 s started→completed ; `sweep` → `failed(expired)` + remboursement, ou `execution_unknown`.
- **Plusieurs Bonk rapides** : animations superposées dans l'overlay, mais **les départs sont sérialisés** : un nouveau claim n'est possible qu'après l'ACK `started` du précédent. Chaque Bonk coûte un aller-retour : poll overlay 100 ms → Studio → ACK → tick 150 ms → Core (réseau) → claim. Cadence réelle ≈ 2–4 Bonk/s, avec du jitter réseau : **aucune maîtrise du rythme**.
- **Densité** : file ≤ 50 ouverts par canal (refus `queue_full`), ≤ 12 entrées locales Studio. **Aucune limite visuelle** dans l'overlay.
- **Son** : un `new Audio()` par impact, sans plafond.

## 2. Limites constatées avant VNext (historique)

> Statut au 15/10/2026 : 1 → cible réglable (Lots 2–3), source overlay toujours au nom imposé ; 2 et 3 → résolus
> (Lot 1) ; 4 → reste (Salves) ; 5 → OBS et sweep résolus (Lot 0), paiement simulé et `labEconomy` toujours ouverts ;
> 6 → résolu (Lot 0, `wrong_channel`).

1. Cible fixe, canvas fixe 1920×1080, source OBS au nom imposé « Raptoru Bonk Lab ».
2. Taille unique ; une seule famille de trajectoire ; aucun FX hormis l'anneau jaune « Lab ».
3. Son systématique, sans gouverneur.
4. Rythme non maîtrisable (sérialisation claim/started + réseau).
5. **Bloquants prod** (indépendants du visuel) :
   - l'overlay refuse tout paiement non simulé ;
   - le Core public utilise `labEconomy` (le Wallet réel n'est pas branché) ;
   - le mot de passe OBS n'est pas persisté et la connexion ne se refait pas seule : après un redémarrage de Studio ou d'OBS, Bonk reste indisponible jusqu'à une reconnexion manuelle ;
   - le `sweep` d'une chaîne ne tourne qu'au claim ou à l'admission sur cette chaîne : des `queued` orphelins restent (cas LeCroupier_ en B3).
6. Le Studio claim avec la chaîne de son build, et le Core ne vérifie pas qu'elle est la sienne : claim vide silencieux (vu en B3).

## 3. Architecture VNext recommandée

Principe : **le Core reste l'autorité économique et d'ordre, l'overlay devient un vrai moteur de rendu, et Studio fournit la cible.**

```
Extension ── shot ou salve ──▶ Core (admission atomique : N interactions, 1 transaction, N débits)
                                  │ claim (unitaire, ou toute la salve d'un coup)
                                  ▼
Studio ── journal (inchangé) ── cible résolue (Auto OBS / Manuel / Fullscreen) + réglages de rendu
                                  ▼
Overlay ── planificateur (cadence locale) → gouverneur densité → sélection famille/preset (graine)
        → moteur physique → gouverneur audio → ACK par shot
```

- **Core** : ne connaît **aucun** paramètre visuel. Il ajoute seulement la notion de salve (§13).
- **Studio** : résout la cible (obs-websocket, lecture seule), stocke les réglages de rendu et les pousse à l'overlay avec un numéro de version.
- **Overlay** : tout le visuel et l'audio, déterministe par `interaction_id` (même graine → même rendu, testable).
- Le moteur legacy est découpé en modules dans `apps/studio/server/bonk-overlay/engine/` (cible, tailles, familles, presets, densité, audio) ; `overlay.js` ne fait que les câbler (règle des fichiers centraux).

## 4. Décision : Bonk individuel ou séquences

| Critère                   | A. Séquence Core-side (1 interaction = N tirs) | B. Individuels, cadence côté client / Studio   | **C. Recommandé : salve = N interactions liées, admises et claimées ensemble, cadencées par l'overlay**                                             |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fiabilité                 | ACK partiel ambigu (« 6 tirs sur 10 ? »)       | Bonne                                          | Bonne : chaque tir garde son cycle de vie                                                                                                           |
| Reprise après déconnexion | Tout ou rien, `execution_unknown` global       | Par tir                                        | Par tir (journal inchangé)                                                                                                                          |
| Wallet                    | 1 débit, remboursement partiel à inventer      | N requêtes, N débits, échec possible au milieu | N débits **dans 1 transaction** (tout ou rien à l'admission), remboursement par tir (existant)                                                      |
| Ordre                     | Garanti                                        | Entrelacé avec les autres viewers              | Séquences contiguës + ordre intra-salve                                                                                                             |
| ACK                       | 1 pour N : perte de précision                  | N, mais rythme cassé                           | N (par tir), éventuellement groupés en un appel                                                                                                     |
| Persistance               | 1 ligne                                        | N lignes                                       | N lignes + `volley_id`                                                                                                                              |
| Timing                    | Précis (overlay)                               | **Mauvais** (réseau + sérialisation)           | **Précis** : l'overlay planifie localement                                                                                                          |
| Modération                | Bloc / cooldown sur 1 action                   | Chaque tir revalidé (lourd)                    | Validée 1 fois pour la salve ; pause = pas de nouvelle salve (une salve dure ≤ ~3 s : cohérent avec « pas de stop »/« pas d'annulation » pour Bonk) |
| Réseau                    | 1 requête                                      | N requêtes viewer + N claims                   | 1 requête viewer + 1 claim + ACK                                                                                                                    |
| UX                        | Bonne                                          | Saccadée                                       | Bonne, cadence ressentie                                                                                                                            |

**Recommandation : C.** On garde l'invariant « 1 tir = 1 interaction » (paiement, remboursement, historique, modération, ACK : rien à réinventer) et on ajoute un regroupement (`volley`) que le Core admet atomiquement et que le claim délivre d'un bloc. La cadence est jouée par l'overlay, seul endroit où le timing peut être exact. Un tir unique est simplement une salve de 1 : même chemin, aucune double implémentation.

> **Remplacé par l'UX validée du Lot 5 (§ 0) :** deux modes seulement, Manuel (1 clic = 1 Bonk individuel) et Auto
> (1 clic = salve atomique des munitions restantes, 4 cadences). Le tableau ci-dessous est l'historique du plan.

Modes viewer (extension), tous sur ce même chemin :

| Mode               | Contenu                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coup unique        | 1 tir                                                                                                                                                       |
| Rafale courte      | 3 tirs, 110 ms                                                                                                                                              |
| Salve              | 5 tirs, 180 ms                                                                                                                                              |
| Mitraille          | 2–10 tirs (le chargeur « Munitions » existant), cadence réglable : lent 300 ms, normal 180 ms, rapide 110 ms                                                |
| Auto-fire maintenu | **à reporter** : tant que le bouton est tenu, envoi de salves successives de ≤ 10. Ça pose une question de dépense continue : à décider après la mitraille. |

Bornes Core : `shot_count` 1–10 et `cadence_ms` 90–600. Ces bornes, et le coût par tir, sont des réglages Core (cockpit), jamais fixés par le client.

## 5. Détection Auto OBS (sources + transforms, sans IA)

> **Implémenté (Lot 3, différences avec le plan ci-dessous) :** les transforms viennent des listes
> `GetSceneItemList` / `GetGroupSceneItemList` (pas de `GetSceneItemTransform` ni `GetInputSettings`) ; recalcul
> 150 ms après le dernier événement, resynchronisation toutes les 10 s, `SceneItemTransformChanged` demandé
> explicitement ; rotation → boîte englobante du polygone transformé (pas de rectangle orienté) ; coordonnées dans
> l'espace de l'overlay (via la source overlay si elle est trouvée, sinon mise à l'échelle du canvas) ; **l'échelle
> garde son signe** (un flip étend la boîte de l'autre côté du point d'ancrage — jamais de valeur absolue) ; repli
> réel : épinglée → meilleur candidat fiable → Manuel du profil (Manuel par scène reporté, le Plein écran n'est
> jamais un repli). Score et règles : § 0 « Lot 3 ».

**Requêtes obs-websocket v5, lecture seule** :

- `GetVideoSettings` (canvas de base) ;
- `GetCurrentProgramScene` ;
- `GetSceneItemList` / `GetGroupSceneItemList` ;
- `GetSceneItemTransform` ;
- `GetInputSettings` / `inputKind` ;
- `GetSourceScreenshot` (aperçu Manuel uniquement).

**Événements** : passer `eventSubscriptions` de 0 aux catégories Scenes, SceneItems, Inputs et Config. Événements utiles :

- `CurrentProgramSceneChanged` ;
- `SceneItemTransformChanged` ;
- `SceneItemEnableStateChanged` ;
- `SceneItemCreated` / `SceneItemRemoved` ;
- `InputNameChanged` ;
- `VideoSettingsChanged`.

Chaque événement déclenche un recalcul 150 ms après le dernier (un événement qui peut masquer une caméra efface la cible Auto immédiatement). Une relecture complète toutes les 10 s sert de filet.

**Algorithme** : parcours récursif de la scène programme.

- Pour chaque item **visible** (`sceneItemEnabled`), composer la matrice : position, rotation, échelle, alignement, bounds (type, taille, alignement), crop.
- Si l'item est une scène imbriquée ou un groupe, descendre avec la matrice parente. Un parent masqué masque tout son sous-arbre.
- Une caméra est un input de kind `dshow_input` (Windows), `av_capture_input(_v2)` (macOS) ou `v4l2_input` (Linux), **ou** une source épinglée par nom dans Studio (NDI, capture d'écran de téléphone, etc.).
- Le rectangle final se calcule dans le canvas après crop et échelle (**signée** : un flip étend la boîte de l'autre côté du point d'ancrage). En cas de rotation, c'est la boîte englobante du polygone transformé.
- Coordonnées **normalisées 0..1 du canvas** : ça règle le cas d'un canvas différent de 1080p.
- Il faut aussi lire la transform de la source overlay Bonk elle-même. Si elle ne couvre pas tout le canvas, convertir les coordonnées ou signaler « overlay non plein écran ».

**Sélection** quand plusieurs caméras sont visibles :

1. la source épinglée, si elle est visible ;
2. sinon la plus grande surface visible ;
3. à égalité, celle du dessus.

Une même source réutilisée dans plusieurs scènes est traitée par instance : seule la scène programme compte.

**Repli** si aucune caméra fiable n'est visible (ou en cas d'hésitation) : zone Manuel du profil (le Manuel par scène est reporté). Le statut Studio indique la cible effective (« Auto prêt » avec « Auto : source · chemin », ou « Aucun candidat fiable — Manuel », « Source épinglée absente — fallback », etc.).

## 6. Modèle de zone cible

La cible est un rectangle de l'espace overlay 1920 × 1080 (Manuel, ou boîte Auto). Le point d'impact est tiré par catégorie pondérée, avec une graine par `interaction_id`. **Table en vigueur (physique figée du 15/10/2026, `639fc0f`)** — tous les impacts ont un contact :

| Catégorie             | Poids | Point d'impact                                                        | Suite                                    |
| --------------------- | ----- | --------------------------------------------------------------------- | ---------------------------------------- |
| Bord                  | 45 %  | bande ±12 % autour du bord, côté d'où vient le projectile favorisé    | rebond vers l'extérieur                  |
| Intérieur hors centre | 22 %  | intérieur hors noyau central (30 %)                                   | choc sur la surface, rebond vers le haut |
| Ras du bord (graze)   | 30 %  | juste à l'extérieur du bord, à moins de 0,4 × la taille du projectile | rebond vers l'extérieur                  |
| Centre                | 3 %   | noyau                                                                 | choc sur la surface                      |

Intensité du rebond : fort 25 %, normal 50 %, faible 25 %. Les anciennes catégories « traversée », « décalé » (et « pass » en Plein écran) sont **supprimées** : aucun projectile ne traverse la cible ni ne passe à côté.

Anti-agglutinement : rejet si le point tombe à moins d'une demi-taille d'un des 6 derniers impacts (2 essais, puis on garde).

Fullscreen : la cible est le canvas moins une marge de 6 %, même anti-agglutinement, sans bord : toujours un choc sur l'écran (« glass ») et un rebond.

## 7. Modèle de trajectoires

Les familles sont pondérées et paramétrées. Le moteur physique actuel (pas de 16 ms, gravité, rebonds) reste le socle : une famille ne fait que choisir les entrées du simulateur.

| Famille       | Poids | Entrée                 | Caractère                                                |
| ------------- | ----- | ---------------------- | -------------------------------------------------------- |
| Chute         | 20 %  | haut → bas             | gravité normale, rotation lente                          |
| Diagonale     | 18 %  | coins hauts            | rapide                                                   |
| Lancer en arc | 18 %  | gauche ↔ droite        | apex au-dessus de la cible                               |
| Tir tendu     | 12 %  | côté, quasi horizontal | gravité ×0,4, impact direct                              |
| Remontée      | 10 %  | bas → haut             | balistique montante, retombe                             |
| Lourd         | 9 %   | haut                   | vitesse ×0,7, gravité ×1,3, peu de rotation, gros squash |
| Courbe        | 9 %   | côté                   | dérive latérale (force latérale décroissante)            |
| Abstrait      | 4 %   | angle inhabituel       | spin fort, rotation inversée à l'impact                  |

Rotation, définie par famille :

- spin lent 50 % ;
- spin rapide 30 % ;
- sans spin puis vrille à l'impact 20 %.

Anti-répétition : pas 3 fois de suite la même famille, ni 2 fois la même entrée.

## 8. Distribution de tailles

> **Implémenté (Lot 1) :** M = **140 px** (décision d'Antoni), fixe ; le réglage « variance » existe dans le moteur
> mais n'est pas exposé dans Studio. Les décalages du tableau s'appliquent tels quels autour de 140 px.

La taille moyenne `M` est réglable, 128 px par défaut à 1080 p (mise à l'échelle avec la hauteur du canvas). Le décalage se tire dans un mélange :

Révisé le 2026-10-14 après retour d'Antoni : la moyenne doit être largement dominante et les gros, rares.

| Part  | Décalage                                     | À M = 128             |
| ----- | -------------------------------------------- | --------------------- |
| 80 %  | gaussienne σ 5 px, bornée à ±10 px           | 118–138 px            |
| 14 %  | 10 à 20 px (60 % plus petit, 40 % plus gros) | 108–118 ou 138–148 px |
| 4 %   | −20 à −32 px                                 | 96–108 px             |
| 1,5 % | +20 à +26 px                                 | 148–154 px            |
| 0,5 % | −32 à −44 px (très petit)                    | 84–96 px              |

Résultat : 94 % des emotes dans ±20 px, 80 % dans ±10 px. Les plus grosses dépassent +20 px dans 1,5 % des cas seulement, sans aller au-delà de +26 px. Le rapport max/min est de 1,83 sur les extrêmes et de 1,37 dans la bande normale. Le réglage « variance » multiplie les décalages (Faible ×0,6, Normale ×1, Forte ×1,3), jamais la moyenne. `sampleBonkSize` (écart ×3,4) est remplacé.

## 9. Système FX / presets

Un preset est une **donnée**, pas du code :

```
{ id: 'double-bounce-cam', tier: 'variant', weight: 6, cost: 2,
  families: ['chute','lourd'],                    // compatibilité (optionnel)
  impact: [{ fx: 'squash', k: .18 }],
  after:  [{ fx: 'bounce', collider: 'target', count: 2, restitution: .45 }],
  exit:   'roll' | 'fall' | 'shrink' | 'slide',
  sound:  'impact' | 'heavy' | 'pop' | 'none' }
```

Le tirage se fait par tier (common 82 %, variant 14 %, rare 3,5 %, very_rare 0,5 %), puis par poids dans le tier. La graine est l'`interaction_id`.

| Tier      | Effets                                                                     | Coût moteur                                                                                  |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Commun    | impact simple, squash, rebond, glisse, chute                               | **simple** : déjà dans le simulateur (squash, rebond sol/bords, roulage, sortie fall/shrink) |
| Variant   | rotation après impact, petit dérapage (friction au sol), roule vers le bas | **simple**                                                                                   |
| Variant   | double rebond sur la cam                                                   | **moyen** : collisionneur rectangle de la cible dans le simulateur                           |
| Rare      | explosion en mini-copies (4–6 clones de l'emote, balistique courte)        | **moyen**                                                                                    |
| Rare      | se brise : 4–6 fragments en `clip-path` de la même image                   | **moyen**                                                                                    |
| Rare      | étoile ou « POW » cartoon (1 SVG sobre)                                    | **simple**                                                                                   |
| Très rare | l'emote reste collée 0,6 s au bord de la cam puis glisse et tombe          | **moyen**, réutilise le collisionneur                                                        |

Pas de système de particules générique : chaque FX est une petite fonction qui ajoute 1 à 6 éléments animés par WAAPI, comme aujourd'hui.

## 10. Audio adaptatif (overlay, un seul gouverneur)

**Intensité** : `I` = impacts par seconde, moyenne exponentielle (τ 1,5 s).

**Échantillonnage déterministe**, par compteur et non par hasard, pour éviter les grappes :

| Intensité   | Sons joués |
| ----------- | ---------- |
| I < 1,2     | tous       |
| 1,2 ≤ I < 3 | 1 sur 2    |
| 3 ≤ I < 6   | 1 sur 3    |
| I ≥ 6       | 1 sur 5    |

**Plafonds** : écart minimal 90 ms entre deux sons et seau de jetons à 5 sons/s.

**Enveloppe** :

- `gain = volume × (1 − 0,5 × min(1, durée_rafale / 8 s))`, plancher 45 % ;
- après 1,5 s de calme, retour progressif sur 2 s.

**Variété** : la pool existante (`punch-2…6`, `roblox-oof`, présents dans les assets), sans répéter deux fois le même fichier, avec `playbackRate` entre 0,94 et 1,06. La famille Lourd prend le son « heavy » (rate 0,85). Les FX rares passent par le même gouverneur.

**Implémentation** : un seul `AudioContext`, buffers décodés une fois, un `GainNode` maître. On n'utilise plus `new Audio()` par impact.

## 11. Densité / anti-spam visuel (overlay)

- **Seuil doux, 18 projectiles vivants (réglable)** : les nouveaux tirs n'utilisent que le tier commun, la pose au sol est divisée par 2 et la sortie se fait en shrink. On supprime l'anneau d'impact.
- **Au-delà du seuil doux** : les plus anciens sortent en accéléré (shrink 250 ms), priorité aux nouvelles interactions.
- **Seuil dur, 30** : un nouveau tir **attend** un slot, sans être supprimé. L'attente est bornée à 4 s, bien sous le bail claim de 30 s, et la cadence de la salve s'étire.
- **Jamais de tir payé jeté** : sous saturation, un tir est raccourci, jamais supprimé. `started` et `completed` restent vrais.
- **Performance** :
  - une seule boucle `requestAnimationFrame` pour tous les projectiles ;
  - cache de décodage par URL (spam de la même emote) ;
  - `will-change: transform` ;
  - trajectoires précalculées, comme aujourd'hui.

La file Core (≤ 50) et le local Studio (≤ 12) restent les premières barrières.

## 12. Config Studio

> **Implémenté (Lots 1–3) :** carte Bonk avec statut OBS, « Cible des Bonk » (Auto / Manuel / Plein écran, aperçu,
> source préférée, Copier vers Manuel) et Tester 1 / 5 / 10. **Non implémentés** : override par scène, réglages de
> rendu (taille, variance, dispersion, intensité FX), densité et son réglables — les valeurs validées du Lot 1 sont
> fixes. Stockage réel : `bonk-settings.json` v2 par profil (`mode`, `manual`, `auto.pinned`).

Organisation logique de la carte Bonk (Production et Lab, même composant) :

1. **Statut** : OBS, source overlay (trouvée et plein écran), renderer, cible effective.
2. **Cible** : `Auto | Manuel | Fullscreen`.
   - Auto : source détectée, scène, épingler une source.
   - Manuel : aperçu (capture de la scène programme) avec un rectangle déplaçable et redimensionnable.
   - « Utiliser pour cette scène seulement » : override par scène.
3. **Rendu** :
   - taille moyenne (px) ;
   - variance (Faible / Normale / Forte, qui choisit des tables de §8 resserrées ou élargies) ;
   - dispersion (largeur de couronne) ;
   - intensité FX (Sobre / Normal / Fun, qui règle les poids des tiers).
4. **Densité et son** : densité max (seuil doux, le dur valant ×1,6), volume, fréquence audio (Normal / Réduit).
5. **Tester** : un Bonk, une rafale de 5, une salve de 10.
   - C'est un **aperçu local** : Studio injecte des tirs marqués `preview` dans l'overlay, sans Core, sans paiement, sans ACK Core.
   - Avertissement : visible en direct si la source overlay est dans la scène diffusée.

**Stockage** :

| Réglages                                                                                    | Où                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Rendu et cible, globaux                                                                     | Studio, fichier JSON versionné du profil (Lab et Production séparés, comme le journal). Ils dépendent d'OBS local. |
| Par scène OBS                                                                               | Uniquement `{mode?, rect manuel?, source épinglée?}`, dans une map par nom de scène.                               |
| Économie et bornes (coût par tir, `shot_count` max, cadence min, modes ouverts aux viewers) | Core (cockpit / modération), car ce sont des règles économiques.                                                   |

Tout le reste est global : pas de config par scène sur les tailles, les FX ou le son.

## 13. Payloads à modifier

| Lien                                                    | Aujourd'hui              | VNext                                                                                                                                |
| ------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Extension → `/v1/ext`                                   | `payload.emotes: [1 id]` | `payload.emotes: [1..10 ids]` (le tableau existe déjà), `payload.cadence_ms?` ; une clé d'idempotence par salve                      |
| Ext facade → Core admit                                 | `emote`                  | `emotes[]` + `cadence_ms` ; la facade garde la validation `invalid_payload`                                                          |
| Interaction (schéma `packages/schemas/src/bonk-lab.ts`) | `quantity: literal(1)`   | `quantity` reste à 1 par tir ; ajout de `volley: {id, index, count, cadence_ms} \| null`                                             |
| Claim                                                   | `{interaction}`          | `{interaction, volley: Interaction[] \| null}` (les tirs suivants de la même salve, chacun avec sa delivery) ; ancien champ conservé |
| Studio → overlay `/next`                                | `{interaction}`          | `{shots: [...], target: {...}, settings_version}` ; `/config` sert les réglages de rendu et la cible versionnés                      |
| Overlay → Studio ACK                                    | 1 par appel              | idem ; le regroupement est possible plus tard                                                                                        |

**Visuel absent des payloads Core** : ni position, ni taille, ni preset. Tout est dérivé de la graine côté overlay.

## 14. Migrations éventuelles

Une seule, additive, au lot Salves :

```sql
alter table bonk_lab_interactions
  add column volley_id uuid, add column volley_index smallint,
  add column volley_count smallint, add column cadence_ms integer;
-- check : les 4 nulles ensemble, ou 0 <= index < count <= 10 et 90 <= cadence_ms <= 600
create index on bonk_lab_interactions (channel_id, volley_id) where volley_id is not null;
```

Les réglages Core (coût par tir, bornes) réutilisent le stockage de réglages module existant s'il convient (à vérifier au lot 5) ; sinon `BONK_LAB_RULES`.

Aucune migration pour la cible, le rendu, les FX ou le son : tout est local Studio.

## 15. Lots d'implémentation

> **Statut au 15/10/2026 :** Lots 0, 1, 2 et 3 **validés** (détail et commits : § 0) ; Lot 5 Salves, Lot 6 (FX historique + combo multi-viewer) et tutoriel / UX = **validés** (§ 0) ; Lot 4 FX rares reporté (non bloquant). Écarts avec le tableau : le Lot 0 n'a pas
> fait « source overlay retrouvée par URL » (toujours par son nom) ; le Lot 3 n'a pas fait l'override par scène
> (reporté) ; le Lot 4 ne doit plus introduire de traversée ni de passage à côté (physique figée).

Chaque lot fait l'objet d'un audit court, d'un patch minimal, de tests et d'une validation par Antoni dans le vrai Studio et le vrai OBS. Pas de staging sans accord.

| Lot                                                        | Périmètre                                                                                                                                                                                                                                                                    | Fichiers                                                                                                                         | Tests                                                                                                                                                                                             | Validation (vrai Studio + OBS)                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **0. Socle prod** (sans changement visuel)                 | Reconnexion OBS automatique + identifiants persistés (stockage chiffré Studio, à choisir) ; source overlay retrouvée par URL au lieu du nom imposé ; contrôle d'appartenance de chaîne au claim (`wrong_channel` explicite) ; `sweep` global périodique des `queued` expirés | `bonk-lab/obs.ts`, `runtime.ts`, `bonk-lab-service.ts`, `studio-transport-routes.ts`                                             | Unitaires obs (pair WS simulé), Core PGlite + PG réel (sweep, chaîne)                                                                                                                             | Redémarrer OBS puis Studio : Bonk revient seul ; renommer la source                         |
| **1. Moteur de rendu** (Bonk individuel, cible par défaut) | Découpage du moteur en modules : tailles (§8), familles (§7), presets communs (§9), gouverneurs densité (§11) et audio (§10), boucle rAF unique, cache d'images ; aperçu local « Tester »                                                                                    | `bonk-overlay/engine/*.js` (nouveaux), `overlay.js` (câblage), `runtime.ts` (route preview)                                      | Unitaires purs graine → distributions (statistiques sur 10 000 tirages), sélection presets, gouverneur audio (horloge simulée)                                                                    | Coups uniques, spam manuel ; écoute du son ; lisibilité                                     |
| **2. Cible Manuel + Fullscreen + réglages**                | Store de réglages du profil, carte Studio (§12), aperçu par capture OBS, zone (§6)                                                                                                                                                                                           | `bonk-lab/settings.ts` (nouveau), `studio/web/src/bonk-*.ts`, overlay `engine/target.js`                                         | Store (versions, valeurs invalides), géométrie de zone                                                                                                                                            | Dessiner une zone, la retrouver après redémarrage ; Fullscreen                              |
| **3. Auto OBS**                                            | Abonnement aux événements, graphe de scène, transforms, groupes, imbrication, crop, rotation, sélection et replis (§5), override par scène                                                                                                                                   | `bonk-lab/obs.ts`, `bonk-lab/obs-scene.ts` (nouveau)                                                                             | Fixtures JSON de réponses OBS réelles (groupes, scènes imbriquées, bounds, rotation, canvas 1440p) → rectangles attendus                                                                          | Changer de scène, déplacer et redimensionner la cam, la masquer, deux cams, scène imbriquée |
| **4. FX variants et rares**                                | Collisionneur de cible, double rebond, collé-glisse, mini-copies, brisé, POW                                                                                                                                                                                                 | `engine/fx/*.js`                                                                                                                 | Unitaires déterministes (graine → preset → keyframes bornées)                                                                                                                                     | Forcer chaque preset depuis « Tester », puis tirage naturel                                 |
| **5. Salves**                                              | Schéma, migration (§14), admission N tirs atomique, claim de salve, facade `emotes[1..10]`, UI extension (mitraille sur le chargeur Munitions), planification overlay                                                                                                        | `packages/schemas`, `bonk-lab-service.ts`, `ext-facade.ts`, `worker.ts`, `ui.js` (câblage) + nouveau module extension, migration | Core : atomicité (solde insuffisant → rien), idempotence de salve, ordre contigu, remboursement par tir, concurrence PG réel ; Studio : journal avec salve, reprise ; extension : modèle de salve | Salves de 3, 5 et 10, cadences lente et rapide ; coupure OBS au milieu d'une salve          |
| **6. Combos (option)**                                     | Rebrancher `createBonkComboController` / Giga legacy si tu le souhaites                                                                                                                                                                                                      | overlay                                                                                                                          | Unitaires existants du legacy                                                                                                                                                                     | À décider                                                                                   |

L'ordre proposé est 0 → 1 → 2 → 3 → 5 → 4 → 6. Les salves passent avant les FX rares, car elles touchent le contrat Core. Le lot 0 est indispensable pour la prod, quel que soit le visuel.

## 16. Risques

- Calculs de transforms OBS : types de bounds, alignements, rotation. Il faut des fixtures issues de ton vrai OBS.
- Heuristique multi-cam : prévoir l'épinglage manuel dès le lot 3.
- Performance CEF (navigateur OBS) sous spam : à mesurer au lot 1 sur ta machine.
- Audio dans la source navigateur OBS : `AudioContext` y démarre sans geste ; à confirmer sur ta version d'OBS.
- Salves et bail claim (30 s) : une salve de 10 à 600 ms plus une attente de densité de 4 s reste à 10 s environ, donc la marge est suffisante, mais à tester.
- Wallet réel : les salves multiplient le débit (10 × coût). Il faut l'atomicité tout-ou-rien et un affichage du coût total côté extension avant envoi.
- Aperçu « Tester » visible en direct si la source est dans la scène diffusée.
- Fichiers centraux : `ui.js` ne doit que câbler un nouveau module de salve.

## 17. Réutilisable tel quel

- Toute l'admission Core : idempotence (hash), pause, module, blocage, cooldown, validation d'emote (Twitch / 7TV / BTTV / FFZ / Twemoji), séquence, débit et remboursement idempotent, file bornée.
- Claim, ACK, baux, `sweep`, transitions qui ne régressent jamais.
- Journal Studio : `sent` écrit avant l'effet, jamais de rejeu, `execution_unknown`, ACK ordonnés.
- Overlay : allowlist des URL CDN, CSP, retry des seuls ACK, contrôle unique du renderer.
- Moteur legacy : RNG à graine, simulateur physique (gravité, rebonds, roulage, sorties), squash, combo et Giga (non branchés), pool de sons et `playbackRate`.
- Extension : chargeur « Munitions », états et emotes Twitch (B1 / B2), retours d'erreur.
- Client obs-websocket lecture seule (à étendre avec les événements).
