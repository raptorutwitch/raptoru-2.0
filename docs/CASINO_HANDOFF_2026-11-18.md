# Casino : passation de session (18/11/2026)

Document autonome pour le prochain agent. Il complète [CASINO.md](CASINO.md) (règles, sécurité, Lab, Production) et
[REPRISE.md](REPRISE.md). Les règles de [`../CLAUDE.md`](../CLAUDE.md) priment. Vérifier soi-même l'état Git (§ 1) avant
de croire un SHA de ce document.

## 1. État du dépôt (vérifié le 18/11/2026)

- Espace de travail : `Documents\Raptoru 2.0 - Worktrees\agent` (worktree). Ne jamais travailler dans le checkout
  principal `Documents\Raptoru 2.0` (dossier de données du Studio installé : jamais `git clean`, `reset --hard`,
  `checkout .`).
- Branche **locale** `feat/casino`, partie de `origin/main` `7433e9cf`. **Rien n'est poussé, fusionné ni déployé.**
- HEAD de code : `850187ae` ; ce document est dans le commit de documentation qui le suit (voir `git log -1`).
- Fichiers suivis : aucun changement en attente après le commit de passation. Les dossiers non suivis
  `.runtime-*-test-*` sont des restes de tests Studio plantés : ne jamais les ajouter (`git add` par chemins explicites
  seulement).

| Commit     | Contenu                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `a8deef5f` | Core : machine à sous + Coffre, roulette européenne, payés sur le Wallet, migration `casino_rounds`    |
| `e79cd8eb` | Fixture de parité exclue de Prettier                                                                   |
| `91839307` | Extension (Mini-jeux, Shadow DOM), Studio › Casino, démo Lab et contrôle `casino:check`                |
| `22310e85` | Corrections de la revue de sécurité (partage, plafond de solde avant tirage, identifiants stricts)     |
| `2e122a28` | Docs : date du 17/11                                                                                   |
| `850187ae` | Spectateurs : on suit un joueur (journal Core `casino_feed`, long-poll, bandeau « parties en direct ») |

## 2. Ce qui est terminé

**Testé manuellement par Antoni et validé (18/11)** :

- le spectateur suit plusieurs parties successives ; les nouvelles parties s'affichent automatiquement ;
- les spins se reproduisent correctement ; le Coffre fonctionne ;
- le spectateur voit les mises de roulette ; quitter un jeu est signalé ;
- la nouvelle présentation du catalogue Mini-jeux (deux cartes + bandeau) convient.

**Mécanique définitivement validée, à ne pas rouvrir** : roulette, machine à sous, Coffre (règles, probabilités,
gains, RTP, limites, moteurs de tirage).

**Vérifié seulement par tests automatiques** (pas une validation au sens du projet) : idempotence et concurrence sur
PostgreSQL réel, refus avant paiement, plafond, partage, Studio › Casino sur la pile Lab, les 15 scénarios
spectateurs.

**Jamais vérifié** : le vrai Twitch (Hosted Test), la Production.

## 3. Problèmes signalés par Antoni le 18/11 — corrigés le 19/11 (`f9515627`), à valider par Antoni

Description d'origine conservée ci-dessous. Correctifs et mesures : CASINO.md § 6 (« Synchronisé, sans résultat en
avance », « Stabilité de l'affichage ») ; contrôle `casino:watch-check`. Cause des flashs confirmée : la piste 1 (redessin
du panneau, rechargement des feuilles `<link>`, animations rejouées), déclenchée aussi par la Tombola toutes les 5 s.

### 3.1 Retard des animations spectateur (priorité 1)

- Symptôme : Alice termine son animation avant que Bob ne commence la même. Environ 3 s pour la machine à sous,
  davantage pour la roulette (≈ 6 s et plus). Le Coffre a le même défaut, d'une relance.
- Cause connue (par conception) : `apps/core-api/src/casino/feed.ts` ne publie une étape qu'une fois que l'écran du
  joueur l'a montrée. Le joueur envoie `POST /casino/progress { stage: 'result' }` après l'arrêt de ses rouleaux
  (`slot.js`, fonction `reveal`, appelée dans `playRound` après `view.spin`) ou après la pose de sa bille
  (`roulette.js`, `reveal` après `play(r)`). Le spectateur ne reçoit qu'alors les données et rejoue toute l'animation.
  L'événement `start` (publié au tirage, dans la transaction) ne porte que la mise.
- Objectif d'Antoni : animations qui commencent quasiment en même temps chez Alice et Bob, **moins d'1 s de décalage**
  en local. Le spectateur ne doit plus attendre la fin de l'animation du joueur. Les résultats restent protégés :
  révélés au bon moment, jamais avant que le joueur les voie. Refonte du protocole de présentation autorisée ; tirages
  et économie intouchables.
- Pistes vérifiées dans le code (à étudier, rien n'est décidé) :
  - **Machine à sous :** `reels.js` (`spin(result)`) a besoin des arrêts dès le départ ; il n'existe pas de mode
    « tourner sans résultat puis atterrir ». Une piste : démarrer chez le spectateur un défilement à l'événement
    `start`, puis atterrir quand l'arrêt est publié, avec une chronologie commune (heure serveur `server_now`, début
    d'animation du joueur). Par exemple, le joueur publie rouleau par rouleau, ou le Core publie la grille au moment
    où le premier rouleau du joueur s'arrête. Il faut décider ce que « révélé » veut dire rouleau par rouleau.
  - **Roulette :** dans `ball.js`, la trajectoire physique dépend seulement de la graine (`simulate(seed)`). Le numéro
    tiré ne fixe que le décalage de peinture du cylindre (`plan(pocket, seed)` → `offset`), appliqué dès l'ouverture
    de la roue. La graine seule ne révèle donc pas le résultat ; la peinture, si. La difficulté : animer la même
    trajectoire en même temps sans connaître le numéro avant qu'il soit visible chez Alice.
  - **Coffre :** `coffre-view.js` en mode `follow` reçoit `{ step }` relance par relance (`o.follow(i)`). Même
    question : faire défiler les cases libres dès la relance d'Alice, puis atterrir.
  - Le délai de publication automatique, si le joueur ne confirme pas (`OVERDUE_MS` dans `feed.ts` : 9 s machine,
    14 s roulette, 7 s ouverture du Coffre), doit rester cohérent avec le nouveau protocole.

### 3.2 Flashs, déformations, zooms brefs (priorité 2)

- Symptôme (Antoni) : chez Alice ET chez Bob, l'affichage clignote, se déforme, grossit ou zoome brutalement, puis
  revient à la normale. C'est intermittent, parfois sans nouveau lancement, plutôt pendant des transitions ou des fins
  d'animation. Aucune capture : la cause doit être trouvée sans en dépendre (enregistrement vidéo Playwright,
  `MutationObserver` / `ResizeObserver` sur l'hôte, journal des redessins).
- Pistes non vérifiées, à confirmer ou écarter :
  1. **Redessin du panneau** (`apps/twitch-extension/extension/app/panel.js`, l. ≈ 527-545). À chaque lecture
     d'état qui change (solde, modules), `renderPreservingViewport()` redessine. Pour une vue de module occupée
     (`busy()`), le redessin attend `jdm:host-idle`, puis part en fin d'animation : cela correspond à « en fin
     d'animation ». Après chaque tour, `jdm:host-refresh` (`refreshWallet`) relance une lecture de session.
     **En spectateur, `busy()` renvoie toujours faux** (`casino.js`, `busy: () => screen !== 'follow' && …`) : le
     panneau peut redessiner en plein milieu d'une animation. Vérifier si ce redessin rattache le nœud
     `.cz-host` (shadow root) et provoque une nouvelle mise en page.
  2. **Unités et requêtes de conteneur.** `#body.cz` a `container: body / size` (`modules/casino/casino.css`) et les
     tailles du jeu en dépendent. Si l'hôte change brièvement de taille (redessin, barre, en-tête), tout se
     redimensionne d'un coup. Le catalogue utilise `--u: var(--g)`, une échelle calculée par le panneau.
  3. **`ResizeObserver`** de la machine (`slot.js` → `view.relayout()`) et le changement de feuilles par jeu
     (`useSheets` dans `casino.js`, qui retire et rajoute des `<link>`) lors d'un changement de jeu en spectateur.
  4. Les animations « pop » (`popPlate`, `.mega`, `.boom`, `cfin`), qui grossissent volontairement : à distinguer
     du bug.

## 4. Architecture

### 4.1 Casino (rappel)

- **Core = seule autorité :** vérifie la mise et le solde, tire (crypto), calcule, débite, crédite et enregistre dans
  une transaction. Verrou consultatif par viewer, clé d'idempotence unique par `(chaîne, viewer, clé)` et empreinte de
  la requête. Wallet de test en Lab, Wallet canonique en Production.
- **Live seulement :** en Lab, le live simulé (`lab_stream_sessions`) ; en Production, `stream_sessions`.
- **Interrupteur Production :** `CASINO_EXTENSION` (`off` | `testers:<ids>` | `on`), à `off`. S'y ajoutent le réglage
  `casino.open` (0 par défaut) et `labEnvironment` (= `CORE_ENVIRONMENT === 'lab'`).
- **Extension :** chaque écran vit dans un Shadow DOM (`.cz-host` → `#body.cz`), avec la feuille commune
  `casino.css` plus celle du jeu (`slot.css` ou `roulette.css`). Les modules de jeu se chargent à l'ouverture.
- **Studio › Casino :** lit seulement `casino/<chaîne>/admin/*` (cockpit).

### 4.2 Suivi spectateur (commit `850187ae`)

- **Journal `casino_feed`.** Une ligne par étape, avec `seq` (bigserial), `kind`, `pos` et `data` (uniquement ce que
  l'étape révèle), plus `fast`. Index unique `(round_id, pos)` : chaque étape une seule fois. La publication se fait
  sous verrou par partie, dans l'ordre.
  - Ordre des étapes (`POS`) : `start` 0 · `result` 1 · `coffre` 2 · `step` 10+i · `end` 900.
  - Lignes hors partie : `draft` (mises de roulette en préparation, jamais débitées, remplacées à chaque envoi) et
    `presence` (le jeu ouvert par le joueur, ou `null`). Un battement par minute tant qu'un jeu est ouvert.
- **Données par étape.** `start` : la mise (et les mises de roulette). `result` (machine) : `stops`, `grid`, `lines`,
  `scatter`, `line_win`, `coffre: { k }`. `result` (roulette) : `bets`, `pocket`, `number`, `color`, `wins`, `seed`,
  `payout`. `coffre` : `k`, `start`. `step` : la relance i. `end` : les totaux et le Coffre (`win`, `paid`, etc.).
- **Lecture.** `watch(player, after, wait)` en long-poll (20 s au plus). `after = -1` donne un instantané (la partie
  en cours du joueur, pour la rejoindre). Le processus qui écrit réveille ses lecteurs aussitôt ; un autre Core, en
  moins d'1 s (une lecture `max(seq)` par chaîne et par seconde, seulement si quelqu'un attend).
- **Tour d'un autre viewer** (`GET /casino/rounds/<id>`) : il n'est lisible en entier qu'une fois sa fin publiée.
- **Extension.** `follow.js` (suiveur : une requête à la fois, reprise sur `seq`, pause si l'onglet est caché).
  `casino.js` (chef d'orchestre) : il monte l'écran du jeu du joueur, appelle `apply(ev)` ou `snapshot(events)`,
  change de jeu avec le joueur, accélère si deux étapes ou plus attendent, et garde le joueur suivi dans
  `sessionStorage` (`casino:follow`). Il expose `data-stages`, `data-ends` et `data-seq` sur `.cz-host` pour les
  tests.
- **Commandes du spectateur :** toutes inactives, côté interface (garde `spect?.follow`) et côté Core (toute écriture
  vise le tour de son auteur).

## 5. Fichiers essentiels

- **Core** (`apps/core-api/`) :
  - `src/casino/` : `slot.ts`, `coffre.ts`, `roulette.ts`, `rng.ts`, `service.ts`, `feed.ts`, `errors.ts` ;
  - les portes : `src/ext/casino-ext.ts`, `src/http/casino-routes.ts`, `src/http/studio-cockpit-routes.ts`,
    `src/ext/ext-facade.ts`, `src/ext/public-frontier.ts` ;
  - `src/modules/casino.ts`, `src/db/migration-scopes.ts`.
- **Extension** (`apps/twitch-extension/extension/`) :
  - `shared/casino/` : `casino.js`, `follow.js`, `slot.js`, `roulette.js`, `coffre-view.js`, `reels.js`,
    `wheel.js`, `ball.js`, `frame.js`, `skin.js`, `symbols.js`, etc. ;
  - `shared/mini-games.js` (bandeau `band: true`), `shared/api.js` (`casino*`, option `timeoutMs`),
    `app/panel.js` (hooks de vue hôte) ;
  - feuilles : `modules/casino/{casino,slot,roulette}.css`, et `modules/arcade/arcade.css` (`.mg__band`).
- **Studio** : `apps/studio/web/src/pages/casino.ts` (+ `.css`), `apps/studio/server/src/casino/relay.ts`, et les
  listes de migrations Lab `server/src/runtime/local-runtime.ts` et `server/scripts/bonk-lab.mjs`.
- **Lab** : `apps/core-api/scripts/casino-demo.ts`, `casino-check.mjs`, `casino-watch-check.mjs`.

## 6. Routes et événements

L'extension appelle `/v1/ext/casino/…` ; l'identité vient toujours du jeton Twitch vérifié, jamais du corps. Le Core
répond en interne sur `/v1/lab/casino/<chaîne>/…`.

| Méthode, chemin                                             | Qui             | Rôle                                                             |
| ----------------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| GET `/casino/state`                                         | tous            | disponibilité, limites, tables, `players`, `live_cursor`, `me`   |
| POST `/casino/slot/spin`, `/casino/roulette/spin`           | identité + clé  | un tour (Idempotency-Key)                                        |
| POST `/casino/progress` `{ round_id, stage, step?, fast? }` | identité        | l'écran du joueur a montré une étape (result, coffre, step, end) |
| POST `/casino/draft` `{ bets }`                             | identité        | mises de roulette en préparation (150 ms min. entre deux)        |
| POST `/casino/presence` `{ game }`                          | identité        | jeu ouvert (`slot`, `roulette` ou `null`)                        |
| GET `/casino/watch?player=&after=&wait_ms=`                 | tous            | suivre un joueur (long-poll)                                     |
| GET `/casino/live?after=&wait_ms=`                          | tous            | qui joue maintenant (long-poll)                                  |
| GET `/casino/rounds/<id>`, `/casino/history`                | tous / identité | un tour (masqué pour les autres avant sa fin), son historique    |
| POST `/casino/share`                                        | identité        | partage par LeCroupier_                                          |
| Studio : `casino/<chaîne>/admin/state`, `admin/rounds/<id>` | cockpit         | lecture seule                                                    |

Événements DOM de l'extension :

- `jdm:host-idle` : fin d'animation, le panneau peut redessiner ;
- `jdm:host-redraw` : l'en-tête change ;
- `jdm:host-refresh` : relire le solde.

## 7. Migrations (additives, jamais appliquées hors Lab ou tests)

- `supabase/migrations/20261201130000_casino.sql` + jumelle Lab `20261201120000_casino_lab.sql` : `casino_rounds`.
- `supabase/migrations/20261202130000_casino_feed.sql` + jumelle Lab `20261202120000_casino_feed_lab.sql` :
  `casino_feed`. Le Lab local d'Antoni a pu appliquer la première : ne jamais modifier une migration existante, en
  ajouter une nouvelle.

## 8. Tests et commandes (depuis le worktree)

| Commande                                                                                                                         | Ce que cela vérifie                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/casino-feed.test.ts test/casino-service.test.ts test/casino-engine.test.ts` (dans `apps/core-api`)          | journal, service, moteurs (5 + 12 + 7, verts le 18/11)                                                                                                                                    |
| `TEST_DATABASE_URL=postgres://…@127.0.0.1:<port>/<nom contenant test> npx vitest run test/casino.integration.test.ts`            | PostgreSQL réel, deux Cores (5/5 le 18/11). Base jetable : `docker run -d --name casino-it-pg -e POSTGRES_PASSWORD=<local> -p 127.0.0.1:55491:5432 postgres:16-alpine`, puis la supprimer |
| `npx vitest run` (dans `apps/twitch-extension`)                                                                                  | extension (163/163 le 18/11)                                                                                                                                                              |
| `npm run casino:check -w @raptoru/core-api`                                                                                      | Casino entier en Chromium 565 × 376 (25/25 le 18/11)                                                                                                                                      |
| `npm run casino:watch-check -w @raptoru/core-api`                                                                                | 15 scénarios spectateurs, Alice / Bob / Carla (tous verts le 18/11) ; ne mesure PAS encore le décalage                                                                                    |
| `npx playwright test e2e/casino.e2e.ts --project lab` (dans `apps/studio/server`, après `npx vite build` dans `apps/studio/web`) | Studio › Casino sur la pile Lab (1/1)                                                                                                                                                     |
| `node scripts/package.mjs --target staging --shell v2 --check` (dans `apps/twitch-extension`, arbre propre exigé)                | vérification de l'archive, rien d'écrit                                                                                                                                                   |

Pas encore relancés depuis `850187ae` : la suite complète du Core (la dernière, avant ce commit, avait 3 échecs
connus sous charge, verts une fois relancés seuls) et la suite complète des tests Studio.

## 9. Démo Alice / Bob

1. `npm run casino:demo -w @raptoru/core-api`, puis http://127.0.0.1:4497 (`PORT=` pour changer de port).
2. Alice (à gauche) : Mini-jeux › Machine à sous. Bob (à droite) : Mini-jeux › bandeau › l'initiale « A ».
3. Boutons de la page : live, Casino ouvert, prochain tour d'Alice en Coffre (3 ou 5 BONUS, GRAND) ou roulette sur le
   17 (tirages choisis, démo seulement), Luna qui joue, gain maximum, solde. Un lien ouvre Carla, 2ᵉ spectateur.
4. Tout est en mémoire et fictif. Arrêter la démo après usage (vérifier qu'aucun processus `casino-demo.ts` ne reste).

## 10. Contraintes

- **Économie :** ne pas toucher aux probabilités, gains, RTP, limites, moteurs, ni au Coffre. Aucun gain calculé par
  le navigateur n'est fiable. Aucune économie parallèle. Plafond `casino.max_win` visible, jamais silencieux.
- **Sécurité :** aucun résultat transmis à un spectateur avant que le joueur l'ait vu (masquer dans le HTML ne suffit
  pas : c'est l'API qui compte). Un spectateur ne déclenche jamais de transaction. Identité toujours issue du jeton.
- **Production :** aucun push, merge, déploiement, migration distante, changement de variable, release Studio, ni
  modification OBS / Twitch / StreamElements / Wallet sans le GO explicite d'Antoni. Le dépôt est public : aucun
  secret dans les commits ou rapports.

## 11. Prochaine mission

1. **Synchroniser réellement le début des animations spectateur** : moins d'1 s de décalage en local, machine,
   roulette et Coffre. Les résultats restent révélés au bon moment, sans toucher aux tirages ni à l'économie.
2. **Trouver et corriger les flashs, déformations et zooms** (§ 3.2), chez le joueur comme chez le spectateur.
3. Vérifier que les deux jeux et le Coffre restent entièrement fonctionnels (`casino:check`).
4. Tester dans plusieurs navigateurs indépendants (`casino:watch-check`, étendu à la mesure du décalage).
5. Livrer une version Lab stable à faire valider manuellement par Antoni.
6. **Ensuite seulement**, et après la validation d'Antoni : la personnalisation de la machine avec ses émotes Twitch.
   Elle n'est PAS à commencer avant.

## 12. Critères d'acceptation vérifiables

- **Décalage :** dans `casino:watch-check`, l'écart entre le début de l'animation chez Alice et chez Bob est
  inférieur à 1 s, sur 10 spins de machine, 3 roulettes et 3 relances de Coffre, en local.
- **Aucune divulgation :** aucune réponse `watch` reçue par un spectateur ne contient une donnée de résultat
  (`stops`, `grid`, `pocket`, `number`, contenu d'une relance, gain) avant le moment défini par le nouveau protocole.
  Ce moment doit être écrit dans `CASINO.md`, et un test doit le chronométrer contre le client du joueur.
- **Flashs :** pendant au moins 3 minutes de jeu enchaîné (Auto, Coffre, roulette, changement de jeu), une sonde
  enregistre zéro changement de taille de `.cz-host` ou `#body` hors redimensionnement de la fenêtre, et zéro
  remplacement du nœud `.cz-host`. Une vidéo Playwright est examinée image par image aux fins d'animation.
- **Non-régression :** les 15 scénarios de `casino:watch-check`, les 25 points de `casino:check`, les tests Core du
  Casino et l'intégration PostgreSQL restent verts. Aucune erreur JavaScript. Tout tient dans 565 × 376.
- **Validation :** Antoni l'essaie lui-même dans la démo Alice / Bob. Seul cela compte comme validation.
