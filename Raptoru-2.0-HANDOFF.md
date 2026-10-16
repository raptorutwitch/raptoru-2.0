# Raptoru 2.0 — HANDOFF (à lire en premier)

## État courant — 16/10/2026 : Roulette et Slot V1 MIGRÉS ET VALIDÉS EN CONDITIONS RÉELLES · onglet Simulation (lire en premier)

Vérifier `git status` / `git log`. Branche **`feat/compact-video-port`**, HEAD ≥ `42efc87` (+ commit docs du
checkpoint). Tout ce qui suit `c7f20de` reste **local, non poussé** ; `main` intact (`d2b61ef`). Statut global :
[`Raptoru-2.0-ETAT-PROJET.md`](Raptoru-2.0-ETAT-PROJET.md) § 0. **Référence unique du module :**
[`docs/ROULETTE_SLOT_PARITY.md`](docs/ROULETTE_SLOT_PARITY.md) (§ 0 = checkpoint).

- **Validation réelle : 16/10/2026** (par Antoni), vrai chat Twitch, ingestion Lab, sortie LeCroupier_, Wallet Lab :
  `!roulette 100` victoire +100, `!slots 20` trois symboles identiques +480, `!roulette all` solde doublé, emotes de
  chaîne affichées ; défaites validées au simulateur. RET-GAME-001 Roulette et RET-GAME-002 Slot **MIGRÉ**.
- **Commits** : `d4b6b0b` (Core Roulette / Slot) · `73f0235` (panneau rapide Simulation) · `42efc87` (onglet
  Simulation + chat simulé universel, validé par Antoni).
- **Règles V1 figées** : Roulette 50 %, net +1× / −1×, `all` = messages all-in ; Slot 3 rouleaux indépendants,
  5 symboles (🍒 🍊 🍇 🍉 🍈), 3 identiques (1/25), net +24× / −1× ; minimum 20 ; cooldowns 10 s / 2 s par viewer ;
  textes StreamElements de la chaîne mot pour mot (`/me` retiré) ; refus silencieux ; interrupteur Mini-jeux OFF par
  défaut.
- **Onglet Simulation** : chat Lab déplacé depuis Tombola (ingestion, simulateur, identités, rôles) ; mêmes contrôles
  que le panneau rapide ; conversation = messages reçus (gardés en mémoire par Core, 100 derniers, badge Simulé /
  Twitch) + vraies réponses `cmd_steps` de LeCroupier_ (« Simulé · non envoyé sur Twitch » quand la sortie est OFF).
- **Pièges Lab** : live simulé, ingestion Twitch, « Sortie chat réelle » et Mini-jeux se règlent dans l'onglet **Simulation** ou le
  panneau rapide « Simulation » de la barre du haut (confirmation avant toute écriture dans le vrai chat ; le live
  simulé reste aussi dans l'onglet Tombola) ; couper Roulette / Slot dans
  StreamElements (et le Jeu des mots dans SAMMI) avant un test en vrai chat avec la sortie ON. Au dernier relevé
  (16/10/2026) : sortie réelle OFF, ingestion ON, Mini-jeux ON.
- **Pas encore en production** : StreamElements reste la production. Activation au cutover économique (Wallet
  canonique P1-001 lot 2, chat / session de production P1-007).
- **Prochaine étape** : **Duel** (RET-GAME-003) en V1 de parité StreamElements — préparation faite (règles connues,
  inconnues, périmètre), **implémentation sur accord d'Antoni**.

## État — 16/10/2026 : Jeu des mots V1 MIGRÉ ET VALIDÉ EN CONDITIONS RÉELLES (historique, valable sauf mention ci-dessus)

Vérifier `git status` / `git log`. Branche **`feat/compact-video-port`**, HEAD ≥ `b82851f` (+ commit docs du
checkpoint). Tout ce qui suit `c7f20de` reste **local, non poussé** ; `main` intact (`d2b61ef`). Statut global :
[`Raptoru-2.0-ETAT-PROJET.md`](Raptoru-2.0-ETAT-PROJET.md) § 0. **Référence unique du module :**
[`docs/WORD_GAME_PARITY.md`](docs/WORD_GAME_PARITY.md) (§ 0 = checkpoint, § 2 = statuts RET-WORD).

- **Validation réelle : 16/10/2026** (par Antoni) — Studio Lab sur la vraie pile, vrai chat Twitch (SAMMI fermé),
  Wallet Lab, sortie chat LeCroupier_, son OBS par push SSE, panneau Studio. RET-WORD-001 à 004 **MIGRÉ**, RET-WORD-005
  **PARTIEL** (stats enregistrées ; affichage / progression plus tard).
- **Commits** : Lot 0 `b4a67aa` · Lot 1 `cf0e88b` · Lot 2 `ebb9f12` · Lot 3 `bde4c11` · Lot 4 `d260f09` · Lot 5
  `55bb8d1` · son push `3a89b9c` · « Voir la réponse » `b82851f`.
- **Décisions figées (V1 = parité legacy, pas de refonte)** : pas d'UI viewer Extension ; mots actifs remis à zéro
  entre deux sessions live, restaurés après un restart dans la même session ; jamais un mot déjà actif retiré une
  seconde fois (un mot terminé peut ressortir) ; casse ignorée, accents obligatoires ; mot doré ×4 en un seul message ;
  un seul crédit Wallet par message gagnant, échec Wallet = rollback complet ; LeCroupier_ = compte de sortie chat ;
  Studio ne montre la réponse que sur demande (« Voir la réponse »), localement.
- **Son** : plus de polling. Victoire commitée → `WordGameWinEvent` → SSE Core → Studio → source OBS (`EventSource`)
  → `ShuffleWordsSong.ogg` ; dédoublonnage par `message_id`, reconnexion sans rejeu. Ne pas retoucher sans décision.
- **Pièges Lab** : live simulé, ingestion Twitch, « Sortie chat réelle » et Mini-jeux se règlent dans l'onglet **Simulation** ou le
  panneau rapide « Simulation » de la barre du haut (confirmation avant toute écriture dans le vrai chat ; le live
  simulé reste aussi dans l'onglet Tombola) ; sortie ON = LeCroupier_ écrit
  dans le vrai chat de `raptoru_` (couper le Jeu des mots SAMMI pendant un test) ; la source OBS du son doit être
  ajoutée avec l'URL copiée dans le panneau ; Studio Lab exige Docker Desktop (conteneur `raptoru2-pg`). Suite Core :
  `npx vitest run --maxWorkers=4` (timeouts de charge en parallélisme complet).
- **Pas encore en production** : SAMMI reste la production. Activation et coupure du deck SAMMI « Jeu des mots »
  seulement au cutover économique (Wallet canonique P1-001 lot 2, chat / session de production P1-007).
- **Prochaine étape** (stratégie : finir la migration du legacy retenu avant les gros reworks) : **Roulette + Slot**
  (RET-GAME-001 / 002) en V1 de parité legacy rapide — refonte Extension plus tard (décision d'Antoni). Alternative
  du registre : alertes (PRIORITÉ 2, moteur complet). Choix à confirmer par Antoni.

## État — 15/10/2026 : Bonk VNext FONCTIONNELLEMENT TERMINÉ ET VALIDÉ EN LOCAL (historique, valable sauf mention ci-dessus)

Vérifier `git status` / `git log`. Branche de travail **`feat/compact-video-port`**, HEAD ≥ `65fea03` (checkpoints
docs au-dessus de `639fc0f`). **Statut de tous les modules et roadmap :**
[`Raptoru-2.0-ETAT-PROJET.md`](Raptoru-2.0-ETAT-PROJET.md) § 0. **`main` intact** (`d2b61ef` = `origin/main`). `origin/feat/compact-video-port` = `c7f20de` :
**tout ce qui suit `c7f20de` est local, non poussé.**

- **Bonk VNext — Lots 0, 1, 2 et 3 VALIDÉS manuellement par Antoni** (vrai Studio + vrai OBS, 14–15/10/2026) :
  fondation production (sweep périodique Bonk / Soundboard / TTS, `wrong_channel`, reconnexion OBS, mot de passe OBS
  via `safeStorage`), nouveau moteur de rendu, cible Manuel / Plein écran, cible **Auto OBS** (scène programme lue par
  obs-websocket, sans IA), physique « contact systématique » figée. Commits : `c410833`, `ba2dfc8`, `af5c78e`,
  `895e5dd`, `8267fda`, `e5dab8e`, `639fc0f`. **Référence unique, détail et règles :**
  [`docs/BONK_VNEXT_AUDIT_2026-10.md`](docs/BONK_VNEXT_AUDIT_2026-10.md) § 0.
- **Règles figées par Antoni :** tailles, trajectoires, sons et physique (contact systématique, rebond fort / normal /
  faible) ne se modifient plus sans décision explicite.
- **Rien de Bonk VNext n'est déployé** : ni staging, ni Hosted Test, ni Studio publié, ni `main`.
- **Staging Coolify** (`raptoru-core-staging`, déploiement manuel, branche Coolify `feat/compact-video-port`) : sur
  **`c7f20de`** (déployé le 14/10/2026) = emotes Twitch OAuth sur `/v1/ext` (B1 `6d7d381`, B2 `c7f20de`), chaîne
  `raptoru_` (83603689). Migration `20261017120000_bonk_lab_viewer_oauth.sql` appliquée sur le staging ; variables
  `EXT_TWITCH_REDIRECT_URI` et `EXT_TOKEN_KEY` posées (valeurs jamais dans le dépôt). Le SHA « non vérifié » du bloc
  du 14/10 ci-dessous est donc connu : `c7f20de`.
- **Hosted Test** : ZIP `raptoru-live-STAGING-hosted-test-c7f20de4430a.zip`. Test réel du 14/10/2026 sur LeCroupier_
  (bascule temporaire de chaîne, puis retour à `raptoru_`) : OAuth Twitch, callback HTTPS, vraies emotes, persistance
  après réouverture et Bonk Twitch accepté par le Core **validés par Antoni** ; affichage overlay **non validé**
  (Studio sur l'autre chaîne pendant la bascule, pas un bug Bonk).
- **Prochain déploiement coordonné** (uniquement avec l'accord d'Antoni) : **Core staging d'abord, puis Studio**
  (l'ancien Core refuse le nouveau champ `channel_id` du heartbeat), validation sur le staging (dont `wrong_channel` et
  le sweep réels), puis seulement décision de promotion.
- **Autres commits de la branche** (antérieurs à Bonk VNext) : restrictions viewer (`2ed1d94`, `3bc40cb`) et
  correctif d'autorisation des emotes (`5a218c1`) — statut de validation dans leurs messages de commit.
- **Bonk VNext est FONCTIONNELLEMENT TERMINÉ ET VALIDÉ EN LOCAL** (validation manuelle d'Antoni, 15/10/2026) :
  - **Lot 5 Salves / Chargeur — VALIDÉ** (Core `f32dab9`, Studio `7ebf478`, Extension `b64c3b9` + `6290b72`) :
    Manuel = 1 clic 1 Bonk, Auto = salve atomique des munitions restantes, 4 cadences, max par salve = règle Core
    canonique 10 ; prototype `prototypes/bonk-salves-ux/serie7/final.html` = spécification.
  - **Lot 6 FX historique + combo multi-viewer — VALIDÉ** (Studio `8d54b8f`) : FX Legacy (70 % sans cercle / 30 %
    avec), combo sur viewers distincts (fenêtre 5 s, ≥ 2 viewers) + finisher géant joué par le même moteur.
  - **Tutoriel et UX Bonk — VALIDÉS** (Extension `c4b82c9`) : tutoriel à bulles (carte fixe centrée, mise en avant douce,
    « Ne plus afficher ce tutoriel automatiquement », « ? » pour le rouvrir) ; catalogue (catégories repliables,
    scroll doux vers les catégories, distinction groupe / catégorie, Récents figés pendant l'ouverture) ; chargeur
    toujours visible même vide ; retrait d'emotes (clic gauche, clic droit, dernière unité, pile > 1) ; poubelle /
    Vider tout / Annuler ; feedbacks dans la bulle du chargeur.
  - **Lot 4 FX rares : reporté**, non bloquant (éventuel polish futur).
  - Détail : [`docs/BONK_VNEXT_AUDIT_2026-10.md`](docs/BONK_VNEXT_AUDIT_2026-10.md) § 0. **Staging, Hosted Test et
    cutover restent des étapes séparées** (accord d'Antoni ; le Lot 5 exige un nouveau ZIP Extension et une
    migration Lab sur le staging).
- **Toujours valable** : legacy (SAMMI, StreamElements, EBS `raptoru.fr/api`, Extension publiée) = production ;
  aucune release Studio depuis 0.1.5 ; aucun push, déploiement, migration distante, release ou changement Twitch sans
  feu vert explicite d'Antoni.

## État — 14/10/2026 : premier test live réel validé · calibration géométrique Twitch (historique, valable sauf mention ci-dessus)

Vérifier `git status` / `git log` (HEAD = `ac52bea` au début de cette phase, `origin/main` identique).

- **Premier test live réel VALIDÉ manuellement par Antoni** le **07/10/2026** (après `ac52bea`) : **Extension Hosted Test → Core staging (`core-staging.raptoru.fr`) → Studio Production · Staging →
  OBS**. Testés en conditions réelles : **Soundboard, TTS, STOP / remboursement, Bonk, Modération, Tombola**.
  Procédure : [`docs/TEST_REEL_STAGING_2026-10.md`](docs/TEST_REEL_STAGING_2026-10.md). Paiement toujours **simulé**
  (Wallet de test), aucun Point de chaîne, aucun StreamElements.
- **CSP Twitch corrigée côté console** (rien dans le dépôt) : `https://core-staging.raptoru.fr` ajouté à l'allowlist
  de l'Extension de test.
- **Migrations staging** : scope dédié `staging` dans le migrateur (`ac52bea`, `STAGING_EXTRA_LAB_MIGRATIONS` dans
  `apps/core-api/src/db/migration-scopes.ts`) = sélection `prod` + exactement deux fichiers Lab, **jamais Commands V2**.
  **Appliquées sur le staging** : `20261015120000_lab_moderation_idempotency.sql`,
  `20261016130000_lab_stream_session_twitch_id.sql`. Décision « deux migrations Lab au staging » ci-dessous : close.
- **SHA déployé sur le staging : non vérifié** (le Core n'expose pas son SHA — `/health` ne renvoie que
  `{"service":"core-api","status":"ok"}` — et l'agent n'a pas d'accès Coolify). Le `44c895c` noté plus bas est
  **périmé**. À relever dans Coolify › `raptoru-core-staging` › Deployments puis à reporter ici.
- **Legacy intact** (SAMMI, StreamElements, EBS `raptoru.fr/api`, Extension publiée = production). **Bot et
  Commands V2 hors cutover.** Aucune release Studio publiée (0.1.6 construit, non publié ; `package.json` = 0.1.5).
- **Calibration géométrique du Video Component** (audit Astra Max) : le Lab n'est **pas WYSIWYG** — preset normal
  fixe 1280 × 720, hauteur 60 %, largeur 3:2 − 48 px (viewport 600 × 432, plus 3:2), resize par
  `transform: scale(...)`, iframe recréée à certains resizes, contexte Twitch mocké incohérent. **Décision : ne pas
  toucher à 60 %, 3:2 ni à l'UI avant mesure réelle.** Détail : [`docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md`](docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md).
- **Prochaine action** : Extension **placeholder isolée** sur **LeCroupier_** (Video Component seul, aucun appel
  réseau) pour mesurer la géométrie réelle Twitch, puis calibration du Lab. La création / le Hosted Test de cette
  extension sont des actions Twitch d'Antoni : rien sans sa validation.

## État — 06/10/2026 : PRÉPARATION DU CUTOVER (historique, toujours valable sauf mention ci-dessus)

Vérifier `git status` / `git log` (HEAD ≥ `9ab0523` au début de cette phase).

- **Consolidation globale VALIDÉE manuellement par Antoni le 05/10/2026.** Smoke test final OK : Hub / navigation ;
  TTS réel (normal, STOP, second TTS — un player OBS / preview est requis : sans lui le TTS s'affiche « indisponible »,
  comportement normal) ; Soundboard (lecture, STOP) ; Bonk Unicode / local et Bonk Twitch en **rôle viewer lié**
  (broadcaster / modérateur Lab = identités fictives, emotes Twitch non sélectionnables depuis `9ab0523`) ; Tombola ;
  Modération ; Commands. L'ingestion Twitch réelle n'était pas un critère bloquant.
- **Commands V2 A0 → F** terminé et validé ([`docs/COMMANDS_V2_STATUS.md`](docs/COMMANDS_V2_STATUS.md)).
- **Audit Astra** ([`docs/ASTRA_GLOBAL_AUDIT_2026-10.md`](docs/ASTRA_GLOBAL_AUDIT_2026-10.md), registre canonique) :
  P0 = 0 · P1 = 14 fermés + **5 bloqués pour le cutover** (001 Wallet canonique, 006 EBS public / JWT Twitch, 007 session
  de stream canonique, 010 Channel Points réels, 019 transport Studio ↔ Core prod) · P2 = 26 fermés + 3 différés (015,
  021, 025) · P3 = 3 fermés / acceptés + 3 ouverts volontairement (001 signature Windows, 002 nommage BonkLab, 006 UX).
- **Phase actuelle = préparation du cutover.** Référence canonique : [`docs/CUTOVER_PLAN_2026-10.md`](docs/CUTOVER_PLAN_2026-10.md)
  (les 5 P1 revalidés sur `9ab0523`, dépendances, rollback, coexistence, décisions D1–D6).
- **Ordre recommandé** : socle staging Coolify → P1-019 transport → P1-001 port économique (parallélisable) → P1-006 EBS
  public → parcours vertical future-prod (Bonk Unicode payé en Jetons de test, plan § 7) → P1-007 session → P1-010
  Channel Points → cutover économique unique.
- **Rien n'est autorisé au-delà de la préparation** : aucune release (`studio:release`), aucun push, déploiement,
  migration distante, écriture en base de production, changement Twitch réel, SAMMI ou StreamElements, aucun cutover
  sans validation explicite d'Antoni. **SAMMI + StreamElements + EBS legacy (`raptoru.fr/api`, Coolify) + Extension
  publiée restent la production.** Cible d'hébergement : VPS Coolify (Vercel est historique).
- **Aucune release Studio depuis 0.1.5.** E2E navigateur versionnés : `npm run e2e`.
- **P1-019 — lot 1 terminé le 05/10/2026** (`fe7d524`, `b12bfec`, `9d8e305`, `48d5fa6`, `5b6fc49` + docs ; HEAD ≥ ces commits) :
  transport future-prod Studio → Core **local**, en HTTPS (certificat de test), identité d'installation Studio +
  identifiant révocable, version de protocole (426 `protocol_incompatible`), routes `/v1/studio/*` liées à
  l'installation, client Studio séparé des clients Lab, même journal / `execution_unknown` / aucun rejeu. **Lab
  inchangé.** Tests automatiques verts (Core `studio-transport` 7, Studio `prod-transport` 13 ; suites Core 386 / Studio
  server 162 / Bot 98 / Extension 38 / Desktop 20 ; lint, typecheck, build). En parallélisme complet sur cette machine
  chargée, la suite Core montre des timeouts PGlite **préexistants** (40 échecs aussi sur `86d314f`) : lancer
  `npx vitest run --maxWorkers=3` dans `apps/core-api`. **P1-019 n'est pas fermé** : profil production non câblé dans
  Studio (D6), Soundboard / TTS, cockpit, staging, appairage distant, rate limiting (plan § 4.5 « Lot 1 »).
- **Lot 1 validé manuellement par Antoni le 05/10/2026** : smoke de non-régression dans `npm run studio`, OBS / player ouvert — Bonk Unicode OK, Bonk Twitch en rôle viewer lié OK, Soundboard OK, STOP Soundboard OK, TTS OK, STOP TTS OK, second TTS OK ; aucun comportement Lab dégradé observé.
- **P1-019 — lot 2 implémenté le 05/10/2026** (`4b5c1cf`, `d2854ed`, `a75ba24`, `5551ef3`, `8c2ab6d` + revue / docs ; vérifier
  `git log`) : **D6** — une app Studio, profils **Lab (défaut)** / **Production**, choix persistant lu au démarrage ;
  changement et régénération d'identité uniquement via Electron main (dialogue natif, redémarrage supervisé). Production :
  ni Core Lab ni outils Lab ; Bonk, Soundboard, TTS sur le transport HTTPS (journaux et jetons de lecteurs séparés).
  URL du Core Production et CA de test **par l'environnement** (`RAPTORU_PRODUCTION_CORE_URL`,
  `RAPTORU_PRODUCTION_CA_FILE`), identité liée à ce Core. Carte « Profil Studio » dans l'onglet Studio. Outil de test :
  `npm run test:local-https-core -w @raptoru/core-api` (Core en mémoire, jamais la prod). Tests verts : Studio server
  194, Core 388 (`--maxWorkers=3`), Desktop 20, Bot 98, Extension 38 ; lint, typecheck, build.
- **Correctif `ea1f3f8`** (trouvé pendant la validation manuelle du lot 2) : en profil Production, plus d'Extension
  Lab (la façade non reliée servait une simulation périmée) — message explicite à la place ; Lab inchangé.
- **Correctifs `8d7416c` + `afa99c1`** (validation du lot 2) : en Production, les lecteurs se règlent dans l'onglet
  Studio (carte « Lecteurs Production » : overlay Bonk + connexion OBS, lecteur Soundboard, source OBS TTS) ; les
  ressources `/ext/` des lecteurs sont de nouveau servies (seules les pages de l'Extension sont refusées).
- **Lot 2 validé manuellement par Antoni le 05/10/2026** (profil Production local contre le Core de test HTTPS) : appairage OK ; Bonk, Soundboard + STOP, TTS + STOP + second TTS en Production OK ; Extension Lab indisponible en Production OK ; retour au Lab avec la preview actuelle complète OK ; `revoke <installation_id>` → Studio « Révoqué » OK. Le `overlay_not_ready` Bonk observé venait de la source OBS absente / inactive dans la scène, pas du transport. Correctifs trouvés pendant la validation, validés aussi : `ea1f3f8` (pas de fausse Extension Lab en Production), `8d7416c` (ressources statiques des lecteurs Production servies), `afa99c1` (carte « Lecteurs Production » dans Studio).
- **Staging distant réel validé le 06/10/2026** (pas une production) : **Core staging déployé sur Coolify** à
  **`https://core-staging.raptoru.fr`** (projet Coolify dédié « Raptoru 2.0 staging », distinct de « Leaderboard » ;
  SHA déployé `1bbc329` ; déploiement **manuel uniquement**, auto-deploy off) ; **PostgreSQL 17 staging dédié**
  (interne, aucune donnée réelle) ; **TLS public valide** (Let's Encrypt, sans CA de test) ; **18 migrations
  appliquées** (scope `prod`) ; **`/health` et `/ready` validés** ; **résilience à une coupure PostgreSQL validée**
  (`/ready` 503, process Core vivant, retour seul). Nuance : si PostgreSQL tombe assez longtemps (~40 s), le
  `HEALTHCHECK` Docker rend le conteneur _unhealthy_ et Coolify le **retire du routage public** même si le process Core
  reste vivant ; il récupère ensuite seul. **Premier démarrage d'une base vierge : les migrations doivent actuellement
  être appliquées avant le démarrage normal du Core** (le boot s'arrête sans tables). **Studio Production → Core
  distant validé** : pairing → **Connecté**, **heartbeats Bonk / Soundboard / TTS**, revoke → **Révoqué**, **retour Lab**
  — tous validés. **Legacy non modifié** (`raptoru.fr/api/health` 200). **Aucun paiement réel, Channel Point, Wallet
  production ni viewer réel encore testé** ; premier Bonk réel non lancé. Commandes opérateur (`pair` / `revoke` /
  `list`, migrations) : Terminal Coolify de l'app. Le runtime Studio réel d'Antoni est encore en Production avec une
  identité liée à l'ancien Core local de test : Lab puis régénération via Studio avant un appairage réel. Détail :
  plan § 4.5 « Staging distant réel ».
- **Premier test réel Hosted Test — préparé le 06/10/2026, non validé manuellement** (procédure, checklists, rollback :
  [`docs/TEST_REEL_STAGING_2026-10.md`](docs/TEST_REEL_STAGING_2026-10.md)). **P1-006 lot 1 minimal** (`482fc2e`) :
  `/v1/ext/*` sur le Core staging (JWT d'Extension vérifié par le Core, acteur du seul JWT, rate limit, CORS
  `*.ext-twitch.tv`), paiement **simulé** (Wallet de test Lab, aucun Point de chaîne, aucun SE), plus aucune route
  `/v1/lab/*` publique ; **Studio** (`e158afa`) : Core staging en **constante de build**, cockpit Production (Modération,
  Tombola, Wallet de test — STOP via l'onglet Modération), version + SHA visibles, routes opérateur d'appairage sans
  shell ; **Extension STAGING** (`6660291`, `1e6236a`) : ZIP Hosted Test `apps/twitch-extension/release/raptoru-live-STAGING-hosted-test-1e6236a7d735.zip`
  (SHA-256 `d4b3a37f…311e5c`), badge « STAGING · test », 0 URL legacy. Core staging déployé `44c895c` (secret
  d'Extension **de test** en attendant le vrai). **Studio 0.1.6** construit et vérifié (`studio:release --dry-run` vert,
  **non publié**) : `apps/studio/desktop/release/Raptoru Studio Setup 0.1.6.exe` (SHA-256 `cf513de6…84aa4f`, source
  `5de2444`). Vérifié sur le staging réel : appairage HTTPS, Connecté, Soundboard `completed`, TTS puis STOP, Bonk
  refusé `obs_offline` sans OBS, crédit de Jetons de test, noms Twitch réels. **Bloquants restants** : vrai secret
  d'Extension (fichier), Hosted Test dans la console (Antoni), installation de Studio 0.1.6 puis « Régénérer
  l'identité » + « Activer Production » + appairage, décision sur deux migrations Lab au staging (Tombola, actions de
  modération de l'Extension). Tests : `npm run test` = paquets un par un, workers bornés (`565cd86`, `249ab64`,
  `5de2444`) — les suites PGlite échouaient par timeouts / crash `0xC0000409` en parallèle complet sur cette machine.
- **Reste de P1-019 (non fermé)** : Bonk avec OBS depuis le staging ; coupures réseau réelles côté Studio ; rate limiting ; cockpit Production incomplet (wallet admin, staff, modération, configuration TTS / sons, Tombola, Commands encore sous `STUDIO_SECRET` / Lab) ; URL Production en constante de build ; seams des futurs paiements réels (lecteurs n'acceptant encore que `simulated`, lié à P1-001).
- **P1-001 — lot 1 fait le 05/10/2026** (`1e86d96`, `ad2be7f`, `a69dd19`) : débit économique et admission dans **une seule transaction**
  (`WalletService.spendIn` / `creditIn`, `EconomyPort` : `labEconomy` par défaut — Lab inchangé —, `coreWalletEconomy`
  pour le Wallet canonique, utilisé par les tests seulement). Preuves PGlite + PostgreSQL réel (concurrence). Aucune
  migration, aucun runtime branché sur le Wallet réel, aucune donnée StreamElements. **P1-001 non fermé** : D1 + import
  SE, D2 (crédits), schéma d'interactions de production, lecteurs pour paiement réel, branchement, cutover économique.
  Pas de surface manuelle à valider pour ce lot (rien d'observable en Studio).
- **P1-007 — lot 1 local terminé le 05/10/2026** (`0385223`, `59d153d`) : une session de stream = un vrai live Twitch
  (identité = id de stream) pour Tombola et Commands ; un seul lecteur et un verrou de session par chaîne
  (`stream/channel-sessions.ts`) ; migration additive Lab `lab_stream_sessions.twitch_stream_id` ; stream-day
  (Daily / Loyalty) inchangé. Prouvé sur PGlite et PostgreSQL réel (concurrence). **P1-007 non fermé** : en
  production, Tombola / Commands devront lire `stream_sessions` et le bot principal rester l'unique consommateur
  EventSub (raccordement avec le passage en production / staging). Smoke Lab conseillé : Tombola (simuler début / fin
  de stream, planificateur) et Commands (quota « pendant le live »).
- ~~Prochaine action : actions manuelles du test réel, puis premier test réel Hosted Test~~ — fait et validé (voir l'état du 14/10/2026 en tête).

---

## Statut des modules, validations, dettes, décisions et roadmap

**Source canonique : [`Raptoru-2.0-ETAT-PROJET.md`](Raptoru-2.0-ETAT-PROJET.md) § 0** (tableau de tous les modules avec
implémentation, validation Antoni, environnement atteint, bloquants et prochaine action ; roadmap ; bloquants prod ;
dettes ; décisions en attente). Les anciennes sections du checkpoint du 03/10/2026 (TL;DR, release, HEAD, modules,
matrice de validation, dettes, décisions, commits, checkpoint Tombola) y ont été fusionnées le 15/10/2026 et ne sont
plus tenues ici. Détails spécialisés : Bonk [`docs/BONK_VNEXT_AUDIT_2026-10.md`](docs/BONK_VNEXT_AUDIT_2026-10.md) ·
Commands [`docs/COMMANDS_V2_STATUS.md`](docs/COMMANDS_V2_STATUS.md) · Modération
[`docs/moderation-v2-d4-parity.md`](docs/moderation-v2-d4-parity.md) · Tombola
[`docs/tombola-v2-parity.md`](docs/tombola-v2-parity.md) · cutover
[`docs/CUTOVER_PLAN_2026-10.md`](docs/CUTOVER_PLAN_2026-10.md).

## 0. RÈGLES DE REPRISE (non négociables)

### Prototype = spécification

- Pour toute UX déjà validée, **le prototype est une spécification, pas une inspiration**.
- Toute migration commence par une **matrice de couverture** :
  `élément prototype | backend existe | porté | adaptation | bloqué`.
- **Aucun élément ne doit être supprimé, simplifié ou remplacé silencieusement.**
- Une limitation backend se complète dans le backend ; si elle est objectivement impossible (dépendance extérieure), elle se remonte **comme limitation**, jamais comme décision UX implicite.
- Précédent à ne pas répéter : la première console Modération de l’extension (`12ffdd0`) a été annoncée « D4 » alors qu’un audit strict a montré une migration **fortement simplifiée** (~50 % du prototype).

### Validation — toujours distinguer

1. code présent ;
2. tests unitaires / intégration ;
3. E2E (navigateur : `npm run e2e`, versionnés depuis le 04/10/2026 ; les anciens scripts de session restent hors dépôt) ;
4. **validation manuelle par Antoni** ;
5. package local ;
6. release publique.

**Ne jamais écrire « validé » pour quelque chose qu’Antoni n’a pas testé lui-même.**

### Architecture

- **Core = source de vérité** (métier, économie, états, permissions, audit).
- Twitch Bot = adaptateur fin Twitch → Core.
- Studio = cockpit / runtime local du streamer (pas de logique métier).
- Extension = interface viewer-first ; **aucune logique métier dupliquée**, aucun état local présenté comme vérité.
- **Aucune simulation présentée comme backend réel.**

### Git / release / prod

- Remote `origin` (`raptorutwitch/raptoru-2.0`, privé) : **aucun push sans accord explicite d’Antoni**, pas de tag, jamais de merge dans `main` sans accord.
- **Pas de `npm run studio:release` sans validation explicite d’Antoni** (« c’est bon », « validé », « go ») — voir `CLAUDE.md`.
- Ne jamais committer `.env`, tokens, secrets, fichiers runtime.
- `prototypes/` : local, non versionné (exclu via `.git/info/exclude`) — ne jamais le supprimer, l’ajouter à un commit ou le modifier.
- **SAMMI + StreamElements restent la production.** Aucun cutover, aucune migration prod, aucune publication d’extension Twitch (ni ZIP, ni Hosted Test) sans feu vert global.
- Workspace legacy `C:\Users\Antoni\Documents\Raptoru\CANONICAL_WORKSPACE` et dossier `…\Alertes Twitch Pour Claude\TTS Webm` : lecture seule.

---

## 1. Workspace / commandes / chemins

| Quoi                                   | Où                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace canonique                    | `C:\Users\Antoni\Documents\Raptoru 2.0` (branche de travail : voir l’état courant en tête ; `origin` privé)                                                 |
| Règles agent                           | `CLAUDE.md` (releases Studio) · ce fichier · `Raptoru-2.0-ETAT-PROJET.md` · `docs/moderation-v2-d4-parity.md` · `README.md`                                 |
| Studio source (dev)                    | `npm run studio` (Electron + serveur Studio 4100 + Core Lab 4301, base `raptoru_bonk_lab`)                                                                  |
| Dernier package local (ancien)         | `apps/studio/desktop/release/moderation-d4/win-unpacked/Raptoru Studio.exe` — état `5b66579`, **sans la Tombola V2** : tester le HEAD avec `npm run studio` |
| Packages obsolètes — **ne pas tester** | `release/mini-d4/` (état `a5b5d5e`), `release/win-unpacked/` (état `12ffdd0`), `release/win-unpacked.tmp` (build interrompu)                                |
| Studio installé                        | `%LOCALAPPDATA%\Programs\Raptoru Studio` (0.1.5) ; logs `%APPDATA%\Raptoru Studio\logs\studio-server.log`                                                   |
| Checks                                 | `npm run lint` · `npm run format:check` · `npm run typecheck` · `npm test`                                                                                  |
| Release (après validation seulement)   | `npm run studio:release` (dry-run : `-- --dry-run`)                                                                                                         |

Pièges connus :

- Studio installé, Studio source et packages locaux **partagent le même verrou d’instance** : fermer l’un avant de lancer l’autre.
- Le Studio installé sert une **copie figée** de l’extension : il ne montre jamais les changements locaux.
- **La migration Lab `20261007120000_moderation_d4.sql` est appliquée à la base Lab `raptoru_bonk_lab` au premier lancement du package** : elle remplace la table des cooldowns (données Lab uniquement). Après ça, ne plus lancer le package `mini-d4` (son code de cooldown n’est plus compatible). Studio 0.1.5 reste compatible (colonnes ajoutées avec valeurs par défaut).
- Vitest sous Windows peut crasher un fichier sous charge turbo (0xC0000409) : relancer ; supprimer les dossiers `apps/studio/server/.runtime-*-test-*` restants.
- Tests E2E : `npm run e2e` (versionnés depuis le 04/10/2026) ; les anciens E2E Electron du 01–03/10 (Studio 4111 / Core Lab 4311) étaient des scripts de session hors dépôt.
- Suites Core / Studio : lancées paquet par paquet avec workers bornés (`npm test`) ; les tests PostgreSQL réels du Core demandent `TEST_DATABASE_URL` vers une base locale dont le nom contient « test » (ex. `raptoru_test`).

## 2. Architecture canonique

`Extension (viewer) → EBS (prod) / façade LabEbs (Lab, dans le serveur Studio) → Core → workers Studio → lecteurs / OBS → ACK → Core`.

- Lab : tout est `test_mode=true`, `payment_mode=simulated`, `real_debited=0` ; wallet de test Lab en base Lab, jamais l’économie réelle.
- Routes Lab exposées **uniquement** par le Core Lab : `/v1/lab/moderation/*` (actions, whoami, overview, search, viewers, interactions, ledger, team, words, audit), `/v1/lab/raffle/*`, `/v1/lab/wallet/*`, `/v1/lab/tts/rules`.
- Les read models ne sont jamais servis à un viewer : la façade nomme le lecteur (`as`, `as_role`) et **Core refuse** un viewer.
- Chaîne Studio : Electron main → serveur Studio → Local Runtime Manager → Postgres Docker → Core Lab / workers / lecteurs.
- **Une seule console Modération** : `apps/twitch-extension/extension/shared/moderation-v2.js` (+ `moderation-v2.css`), montée par l’extension (façade LabEbs, acteur = identité Twitch de l’appelant) et par Studio (`/ext/…` servi par Studio, acteur = broadcaster via `/api/lab`).

## 3. What NOT to do

- Ne pas appeler « validé » une implémentation non testée par Antoni.
- Ne pas supprimer ni masquer un élément du prototype.
- Ne pas simuler un backend absent ; ne pas faire de l’ancienne simulation Tombola du Lab EBS une source de vérité (elle ne sert plus quand le Core Lab est connecté).
- Ne pas refaire Bonk V2 / VNext, Soundboard V2, TTS V2, le Hub, Studio autonome, la Modération V2 D4, Commands V2 ni la **Tombola V2 (checkpoint figé)** : ils sont validés. Ne pas toucher aux paramètres visuels / audio ni à la physique de Bonk VNext sans décision d’Antoni.
- Ne pas publier un Studio contenant le Lot 0 Bonk VNext avant que le Core staging compatible soit déployé (ordre Core → Studio).
- Ne pas release, pousser, taguer, publier l’extension (ZIP / Hosted Test) ni toucher SAMMI / OBS / StreamElements / prod sans feu vert explicite.
- Ne pas tester `release/mini-d4` ni `release/win-unpacked` (obsolètes).
- Ne pas refactorer au passage.
