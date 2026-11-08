# État du projet Raptoru 2.0

**Photographie du 08/11/2026.** Production relevée en lecture seule ce jour-là. Le reste vient du dépôt, des commits et
des comptes rendus cités. Avant de vous fier à une version écrite ici, revérifiez-la vous-même (commandes :
[REPRISE.md](REPRISE.md) § 4).

Documents liés :

- reprise de travail pour un agent : [REPRISE.md](REPRISE.md) ;
- roadmap : [ROADMAP.md](ROADMAP.md) ;
- index de la documentation : [README.md](README.md) ;
- architecture : [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. En une minute

Raptoru 2.0 est la plateforme de stream auto-hébergée du streamer Twitch `raptoru_` (identifiant 83603689), gérée par Antoni.

| Composant                        | Rôle                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| **Core**                         | décide de tout : données, économie des Jetons, règles des modules, file des effets         |
| **Bot** `LeCroupier_`            | seul lien avec Twitch (EventSub, chat) ; exécute ce que le Core décide                     |
| **Raptoru Studio « Coulisses »** | application Electron du PC du streamer : console, pilotage d'OBS, lecteurs d'overlays, Lab |
| **Extension Twitch**             | interface des viewers pendant le live                                                      |
| **raptoru.fr**                   | site communautaire, dans un dépôt séparé                                                   |

SAMMI est abandonné depuis le 20/10. Le dépôt est **public** depuis le 28/10 ([../SECURITY.md](../SECURITY.md)).

**Où on en est :**

- La Production tourne sur le Core et le bot `1b25f30` et sur Studio 0.1.27.
- La refonte du Studio, Opération Coulisses, est déployée depuis le 07/11.
- La reconstruction de l'extension, **Extension Next**, est sur la branche `feat/extension-next`, sauvegardée sur GitHub
  (`2f45ac1`) le 08/11, ni fusionnée ni publiée. Recette visuelle d'Antoni en Lab : **approuvée sur le principe et le ressenti général** (Antoni, 08/11) ;
  Hosted Test, vrais appareils et décision de publication restent à faire.
- **Prochaine étape logique** : rendre l'extension publiable (ROADMAP § 2.1), puis enrichir l'expérience viewer et les modules.

## 2. Statuts : ne jamais les confondre

| Statut                  | Ce qu'il signifie                             | Comment le vérifier                                                           |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| Commité                 | sur une branche, éventuellement locale        | `git log <branche>`                                                           |
| Fusionné                | dans `origin/main`                            | `git branch -r --contains <sha>`                                              |
| Déployé                 | le Core ou le bot tourne sur ce commit        | `coolify-deploy.mjs status core\|bot`                                         |
| Installé                | Studio du PC sur cette version                | `%LOCALAPPDATA%\Programs\Raptoru Studio\resources\app\build-info.json`        |
| Servi par Twitch        | version active de l'extension                 | console Twitch, ou F12 › `shared/runtime-config.js` › `buildId` sur la chaîne |
| Test automatique réussi | vitest, Playwright, matrices                  | ne vaut **jamais** validation                                                 |
| **Validé**              | **testé à la main par Antoni**                | une trace écrite (document, message)                                          |
| Actif en Production     | déployé **et** interrupteur ou drapeau allumé | état du module dans Studio et Système, `/v1/ops/status`                       |

## 3. Environnements et versions (relevé du 08/11/2026)

| Élément                            | Version                                                                                                                                                                                                                                                                                                                                                                   | Source du relevé                                                                     | Retour arrière                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Core `raptoru-core` (Coolify, VPS) | **`1b25f30`**, déployé le 07/11 18:58 UTC, sain (`/health`, `/ready`) ; 67 migrations                                                                                                                                                                                                                                                                                     | `coolify-deploy.mjs status core` le 08/11 ; Core `/v1/ops/status`                    | `8a897a5` **après** le SQL de [studio-refonte/OPERATION_COULISSES.md](studio-refonte/OPERATION_COULISSES.md) § 6 |
| Bot `raptoru-bot` (Coolify, VPS)   | **`1b25f30`**, déployé le 07/11 19:02 UTC ; bail actif vu par le Core                                                                                                                                                                                                                                                                                                     | idem                                                                                 | `4ba9243`                                                                                                        |
| Base PostgreSQL 17                 | sauvegarde Coolify quotidienne ; dernière réussie le 08/11 à 04:00 UTC                                                                                                                                                                                                                                                                                                    | `status core`                                                                        | [BACKUPS.md](BACKUPS.md)                                                                                         |
| Studio installé (PC)               | **0.1.27**, construit depuis `13ed6e8` le 07/11 22:19 UTC                                                                                                                                                                                                                                                                                                                 | `build-info.json` de l'installation                                                  | installateurs 0.1.25 et 0.1.26 gardés dans `Sauvegarde Raptoru 2.0`                                              |
| `origin/main`                      | **`13ed6e8`** = PR #57 (Studio 0.1.27) au-dessus de PR #56 `1b25f30` (Coulisses)                                                                                                                                                                                                                                                                                          | `git fetch` le 08/11                                                                 | —                                                                                                                |
| Site raptoru.fr                    | `74f7542`                                                                                                                                                                                                                                                                                                                                                                 | `https://raptoru.fr/api/status`                                                      | Coolify › redéployer `542b1f2`                                                                                   |
| Extension Twitch servie            | **non prouvée**. Revérifié le 08/11 : hors live, la page publique de la chaîne ne charge pas Raptoru Live, qui n'est pas installée en panel ; le composant vidéo n'apparaît qu'en live et pour les viewers autorisés. Candidats : `0bf7907` (zip du 22/10, noté « publié sur Twitch » dans le journal du 22–24/10), ou une version Halloween « à soumettre » (non tracée) | procédure : [REPRISE.md](REPRISE.md) § 4                                             | console Twitch                                                                                                   |
| Coolify                            | 4.6.0 (07/11) ; l'API répond sur `https://dashboard.raptoru.fr`, l'ancien `coolify.raptoru.fr` renvoie 502                                                                                                                                                                                                                                                                | [OPERATION_COULISSES.md](studio-refonte/OPERATION_COULISSES.md) § 1                  | —                                                                                                                |
| Staging `raptoru-core-staging`     | `core-staging.raptoru.fr` ; branche et version non revérifiées ce jour                                                                                                                                                                                                                                                                                                    | —                                                                                    | —                                                                                                                |
| Lab                                | Core local réel avec sa propre base Docker et son dossier `%APPDATA%\Raptoru Studio Lab` ; jamais la Production                                                                                                                                                                                                                                                           | [studio-refonte/architecture/GUIDE_LAB.md](studio-refonte/architecture/GUIDE_LAB.md) | —                                                                                                                |

Le checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` sert de **dossier de données au Studio installé**. Il est
sur `main` local, **429 commits derrière** `origin/main`, avec du travail non commité. Pour la conduite à tenir, voir
[REPRISE.md](REPRISE.md) § 3.

## 4. Composants et communication

Détail : [ARCHITECTURE.md](ARCHITECTURE.md). Spécification d'origine (vision) : [../Raptoru Studio — Infrastructure Spec.md](../Raptoru%20Studio%20—%20Infrastructure%20Spec.md).

- **Chat ou événement Twitch** → bot (EventSub, chat) → Core : règle, débit idempotent, file.
  - Réponse dans le chat : file `cmd_steps` → bot.
  - Effet visible : file du Core → Studio réclame la tâche → OBS ou lecteur d'overlay.
- **Viewer** → extension → Core `/v1/ext` (jeton Twitch) → même file → Studio → OBS.
- **Studio** ↔ Core `/v1/studio/*` (identité d'installation appairée), Dock OBS servi par Studio.
- **Site** ↔ Core `/v1/site/*`.
- **Supervision** : `/v1/ops/status` (jeton d'exploitation).
- **Modules** : socle modulaire du Core (`apps/core-api/src/modules/`, un fichier par module + une ligne dans
  `modules/index.ts`) ; Studio, l'extension et le chat découvrent le module tout seuls
  ([studio-refonte/architecture/GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md)).

| Code                               | Contenu                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/core-api`                    | Core (Fastify, PostgreSQL)                                                                   |
| `apps/twitch-bot`                  | bot                                                                                          |
| `apps/studio/{desktop,server,web}` | Studio                                                                                       |
| `apps/twitch-extension`            | extension                                                                                    |
| `packages/schemas`                 | contrats Zod                                                                                 |
| `supabase/migrations`              | schéma SQL                                                                                   |
| `apps/viewer-web`                  | squelette jamais commencé ; le site public vit dans `raptorutwitch/Leaderboard-Jeu-des-mots` |

## 5. Fonctionnalités

État module par module, avec la distinction **livré / développé / à valider / à développer** : [ROADMAP.md](ROADMAP.md) § 1.

| Catégorie                            | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **En Production et utilisées**       | économie canonique (Wallet, Jetons, crédits TTS et Soundboard, Daily, fidélité, présence) · Commands V2 · modération D4 · Tombola · Jeu des mots · Roulette, Slot, Duel (chat) · Soundboard · TTS · Bonk · alertes Twitch V2 · points de chaîne et effets · Random Ban V3 · Roue du Sub V2 · Caution · Votekick V2 · Spotify V2 · Dock OBS · progression et classements (site) · boutique cosmétique · statistiques de modules (privées) · Studio Coulisses |
| **Déployées mais éteintes ou vides** | moteur de défis (`CHALLENGES_ENGINE` off, aucun défi créé) · catalogue cosmétique sans contenu définitif · profil d'alertes Halloween (événement fermé le 02/11)                                                                                                                                                                                                                                                                                            |
| **Lab uniquement**                   | Coffre mystère et Objectif de soirée (`labOnly`) · simulateurs du Lab (viewers fictifs, achats simulés, Spotify, récompenses fictives) · module fictif de démonstration de l'extension (`extension/lab-modules/demo`, sur `feat/extension-next`)                                                                                                                                                                                                            |
| **Branches non fusionnées**          | Extension Next (`feat/extension-next`) · Level Up V2 (PR #43, brouillon) · Chaudron des subs (PR #47, brouillon) · titres équipés depuis Studio (PR #54) · détails : [ROADMAP.md](ROADMAP.md) § 2                                                                                                                                                                                                                                                           |

## 6. Travaux récents (20/10 → 08/11)

| Date        | Événement                                                                                                                                                                                                                                                                                                                 | Preuve                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 20–21/10    | Bascule en Production : Core et bot sur le VPS, Wallet canonique (import StreamElements), SAMMI débranché                                                                                                                                                                                                                 | [CUTOVER_PLAN_2026-10.md](CUTOVER_PLAN_2026-10.md), [ECONOMY_MIGRATION.md](ECONOMY_MIGRATION.md)             |
| 21–29/10    | Bot unique (bail Core), Centre de contrôle, Caution, Votekick V2, Random Ban V3, Roue du Sub V2, Spotify V2, Dock OBS, Halloween, progression                                                                                                                                                                             | [archive/](archive/README.md), documents de module                                                           |
| 30/10–04/11 | Boutique cosmétique, raptoru.fr V2 (cadres, bannières, défis, statistiques) ; Core `8a897a5`                                                                                                                                                                                                                              | [RELEASE_SITE_HUB.md](RELEASE_SITE_HUB.md)                                                                   |
| 04–07/11    | **Refonte du Studio, « Coulisses »** : audit fonctionnel, décisions H1–H16, socle modulaire, direction artistique D, parité, Lab sur le vrai Core                                                                                                                                                                         | [studio-refonte/](studio-refonte/CONTEXTE.md)                                                                |
| 07/11       | **Opération Coulisses** : sauvegardes vérifiées, PR #56 → `1b25f30`, 5 migrations, Core et bot déployés, Studio 0.1.26 installé, vérifications après installation                                                                                                                                                         | [OPERATION_COULISSES.md](studio-refonte/OPERATION_COULISSES.md) § 12                                         |
| 07/11       | PR #57 → `13ed6e8`, **Studio 0.1.27** : le Dock ne présente plus les tests de Studio comme de vrais événements ; « Ne plus demander » pour les tests joués sur le stream, réversible dans Système. Code Studio seulement : le Core et le bot restent en `1b25f30`                                                         | commits `6350501`, `b1564dd`                                                                                 |
| 07–08/11    | **Extension Next** : audit responsive, plan, emballage verrouillé, socle v2, deuxième passe (cibles, module fictif, contrats, outil de comparaison)                                                                                                                                                                       | [extension/](extension/EXTENSION_RESPONSIVE_ARCHITECTURE_AUDIT_2026-11-07.md) ; journal sur la branche (§ 8) |
| 08/11       | **Opération « Final Freeze »** : analyse de secrets (gitleaks et inspection ciblée, rien trouvé) ; `feat/extension-next` poussée sur GitHub (`2f45ac1`) ; documentation consolidée fusionnée dans `main` par une PR documentaire ; version Twitch toujours non prouvée ; PR ouvertes triées ; aucune action de Production | [WORKSPACES.md](WORKSPACES.md), [CLEANUP_LATER.md](CLEANUP_LATER.md)                                         |

## 7. Tests réalisés (dates et origine ; aucun relancé pour cette consolidation)

### Studio Coulisses

**Tests automatiques**

| Date  | Sur                                   | Résultat                                                                                                                            | Source                   |
| ----- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 07/11 | `ffca7be`, une exécution séquentielle | Core 1 615/1 615 · Studio 959 · bot 287 · extension 97 · desktop 36 · outils de livraison 53 · E2E 111/111                          | OPERATION_COULISSES § 9  |
| 07/11 | PR #56                                | CI 11/11                                                                                                                            | OPERATION_COULISSES § 12 |
| 07/11 | 0.1.26                                | workflow de release : tests Windows, test de mise à jour depuis 0.1.25                                                              | OPERATION_COULISSES § 12 |
| —     | PR #57                                | ajoute des tests (`dock.e2e.ts`, `dock-view.test.js`, `lab-simulators.e2e.ts`) ; leurs résultats ne sont écrits dans aucun document | —                        |

**Vérifications techniques sur le Studio installé (07/11, après installation de 0.1.26)**

- 199 fichiers locaux identiques à la sauvegarde ; soldes de 4 viewers identiques au dump.
- 40 récompenses ; OBS reconnecté ; TTS, Soundboard et Bonk prêts ; 18/18 médias d'alertes ; StreamElements connecté.
- Source : OPERATION_COULISSES § 12, qui conclut « déployé et vérifié techniquement ; validation d'Antoni (recette d'usage) en attente ».

**Recettes d'Antoni (Lab)**

- Direction artistique D validée (06–07/11).
- Recette de la mission finale positive, sauf Récompenses Twitch, reprises ensuite (07/11).
- [studio-refonte/FINALISATION.md](studio-refonte/FINALISATION.md), [RECETTE_FINALE.md](studio-refonte/RECETTE_FINALE.md).

**Non écrit dans le dépôt :** aucune recette d'usage d'Antoni sur 0.1.26 ou 0.1.27 en Production. Antoni annonce le chantier « terminé » le 08/11 : à confirmer par écrit si une validation formelle est nécessaire.

### Extension Next (branche `feat/extension-next`, 08/11)

| Vérification                                                  | Résultat                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitaires                                                     | 127/127 ; lint OK                                                                                                                                                                            |
| E2E Studio (13 fichiers qui chargent l'extension, 44 tests)   | legacy 44/44, v2 44/44 après le correctif `2e0777a`. Deux passages précédents avaient été interrompus par un arrêt de la pile E2E de Studio (environnement)                                  |
| Matrice responsive (133 mesures, 18 tailles × vues, Chromium) | contrôles coupés : 0 sur les deux shells (V1 : 7) · plus petite police : 10 px en v2 (legacy 8) · cibles sous 24 px : v2 21, legacy 241 · 0 zone de clic qui chevauche, 0 contrôle recouvert |
| Correctif « Effacer »                                         | la zone de clic agrandie du champ de recherche du Soundboard prenait le clic du bouton « Effacer » ; trouvé par l'E2E, corrigé en `2e0777a`                                                  |
| Requêtes économiques et de modération (faux Core isolé)       | 13 parcours **identiques** entre V1 figée (`3834d6b`), legacy et v2 : méthode, chemin, corps, clés d'idempotence                                                                             |
| Module fictif du Lab                                          | 23 vérifications : chargement à la demande, état, nettoyage, retrait ; aucun minuteur laissé par les 5 modules du Hub                                                                        |
| Poids au premier affichage du Hub                             | v2 ≈ 0,73 Mo contre 2,16–2,27 Mo ; Hub en 139–166 ms contre 175–209 ms                                                                                                                       |
| Écran gris (bloqueur)                                         | message et « Réessayer » en 0,1–1,7 s sur les 3 surfaces ; la V1 n'affichait rien                                                                                                            |
| Emballage                                                     | 3 cibles figées ; la Production refuse sans inventaire validé par Antoni ; vrai paquet staging v2 vérifié                                                                                    |
| **Non vérifié**                                               | Twitch réel, Hosted Test, iPhone, Android, zoom navigateur réel (simulé seulement), WebKit et Firefox, écrans des viewers, performance en live                                               |

## 8. Bugs importants corrigés récemment

**Extension (sur `feat/extension-next`, non publiés)**

- 7 contrôles coupés : paiement TTS, bas du Hub, participants de la Tombola, personnages TTS sur mobile, défilement de secours.
- Écran gris derrière un bloqueur de publicités ou les boucliers Brave.
- `npm run build` emballait l'ancien serveur `raptoru.fr/api`.
- L'emballage de calibration était cassé depuis `7a907dd`.
- La zone de clic du champ de recherche du Soundboard prenait le clic du bouton « Effacer ».

**Studio et Core (Coulisses, en Production)**

- Liste dans [studio-refonte/FINALISATION.md](studio-refonte/FINALISATION.md) et [CONSOLIDATION.md](studio-refonte/CONSOLIDATION.md).
- Dock : les tests de Studio passaient pour de vrais événements (`6350501`).
- Rôle `lead_moderator` ignoré par le bot (en Production depuis le bot `1b25f30`).

## 9. Problèmes ouverts

| Domaine        | Problème                                                                                                                                                                                                                                                                                | Référence                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Extension      | version servie par Twitch non prouvée ; 44 commits non publiés sur `main`, plus Extension Next                                                                                                                                                                                          | [extension/PLAN_REFONTE_EXTENSION_2026-11-08.md](extension/PLAN_REFONTE_EXTENSION_2026-11-08.md) § 12  |
| Extension Next | vrais appareils et Hosted Test à faire. Restes non bloquants : Hub à 377×251 défile d'environ 15 px ; TTS en mobile paysage empilée ; bande « Vider » du Bonk à 15 px ; Coffre hors `createPoller` ; vues encore dans `shared/`                                                         | journal de la branche                                                                                  |
| Studio         | code mort `moderation.ts`, `tts-config.ts` (contiennent `confirm()`) ; ajout ou remplacement d'un son du Soundboard bloqué ; Supermod réservé aux membres déjà vus ; Modération à 1024 px défile un peu ; médias Halloween absents du Lab ; Tombola V1 inaccessible (`raffle_v2` forcé) | [FINALISATION.md](studio-refonte/FINALISATION.md), [PARITE.md](studio-refonte/PARITE.md)               |
| Studio         | ancien Lab encore dans le code (`studio:legacy`), retrait préparé, choix A ou B à faire                                                                                                                                                                                                 | [RETRAIT_ANCIEN_LAB.md](studio-refonte/RETRAIT_ANCIEN_LAB.md)                                          |
| Studio         | lots F3, F4, F5 et F7 restants ; H10 partiel (les documents divergent sur les mini-jeux et le Duel)                                                                                                                                                                                     | [studio-refonte/ROADMAP.md](studio-refonte/ROADMAP.md), [CONTEXTE.md](studio-refonte/CONTEXTE.md) § 18 |
| Tests          | E2E instables connus : `tombola-bonbons`, `effects-player`, `alerts` « families », `progression-studio`, arrêt intermittent de la pile E2E ; `alerts-se` sous Windows pendant les releases                                                                                              | [studio-refonte/ROADMAP.md](studio-refonte/ROADMAP.md)                                                 |
| Exploitation   | secret GitHub `COOLIFY_URL` encore sur l'ancienne adresse (non vérifiable d'ici) ; les scripts ont `coolify.raptoru.fr` par défaut : exporter `COOLIFY_URL=https://dashboard.raptoru.fr`                                                                                                | [CICD.md](CICD.md)                                                                                     |
| Exploitation   | faux « ÉCHEC » connu du bot dans `coolify-deploy.mjs` (lecture unique de l'état) : toujours vérifier avec `status bot`                                                                                                                                                                  | [CICD.md](CICD.md) § 2                                                                                 |
| Données        | copies de la base hors VPS seulement manuelles ; données de Studio sauvegardées seulement avant chaque opération                                                                                                                                                                        | [BACKUPS.md](BACKUPS.md)                                                                               |
| Héritage       | lots du plan post-live 5, 7, 8, 10, 11, 13 et A7 notés « non faits » au 26/10 (certains peut-être couverts par Coulisses, comme « Prêt pour le live » : à revérifier) ; fonctions SAMMI jamais reprises                                                                                 | [ROADMAP.md](ROADMAP.md) § 3                                                                           |

## 10. Décisions durables

### Extension Twitch

- **Référence artistique : la composition 651 × 434 px**, aérée. Le réglage Twitch du composant vidéo **reste à 65 %**.
- But : retrouver l'identité de l'extension quelle que soit la fenêtre, avec une adaptation intelligente, un défilement
  maîtrisé et toutes les fonctions accessibles. « On reconstruit la mécanique, pas l'identité. »
- Les règles d'adaptation :
  - la composition est mise à l'échelle par jetons CSS ; jamais de zoom global, `zoom` CSS testé puis écarté ;
  - les layouts s'adaptent par profils de boîte ;
  - planchers de texte : 12/12/13/13/14/11/10 px, 13 px sur mobile ;
  - un prix ne prend jamais de « … », et aucun bouton d'achat ne disparaît ;
  - modules chargés à la demande ;
  - pas de framework ni de bundler.
- Le **Core reste l'autorité économique** : aucun changement de contrat. `expected_price` est seulement documenté.
- Les Jetons n'ont aucune valeur monétaire, ne s'achètent pas avec des Bits et ne s'échangent pas contre de l'argent
  (exigence Twitch).
- Le shell legacy reste dans chaque paquet comme repli jusqu'au nettoyage du lot 6, sur accord.
- Détail : [extension/PLAN_REFONTE_EXTENSION_2026-11-08.md](extension/PLAN_REFONTE_EXTENSION_2026-11-08.md), et sur la
  branche `docs/extension/SOCLE.md`.

### Studio Coulisses

- **Direction artistique D**, validée par Antoni le 06/11.
  - Jetons `d-`. Couleur porteuse de sens : teal = action, rose = extension, or = grands gains, ambre = attention.
  - Polices : Bahnschrift pour les chiffres, Inter pour le texte.
- **Navigation** : six destinations plus le Laboratoire, palette Ctrl+K qui n'exécute jamais d'action.
- **Socle modulaire** : un module = un fichier.
- **Vocabulaire d'état unique.**
- **Confirmations** maison (`confirmBox`, `choiceBox`), jamais natives. « Ne plus demander » existe seulement pour les
  tests joués sur le stream.
- **Classement des actions** : PRODUCTION, LAB, SIMULATION, APERÇU LOCAL.
- Détail : [studio-refonte/DESIGN_SYSTEM.md](studio-refonte/DESIGN_SYSTEM.md), [CONTEXTE.md](studio-refonte/CONTEXTE.md),
  [architecture/DECISIONS.md](studio-refonte/architecture/DECISIONS.md).

### Méthode de travail (décidée par Antoni, 08/11)

- Auditer sérieusement **une fois** quand c'est nécessaire, décider la direction, puis donner une **large autonomie** à
  l'agent pour des lots fonctionnels substantiels.
- Ce que l'agent livre : tests automatiques, corrections autonomes, commits cohérents, journal de reprise, livrables testables.
- Ce qu'on ne fait plus : GO pour chaque correction CSS, audits répétitifs, revues entre chaque petit lot.
- Le déroulé en 9 étapes d'une mission, du besoin à la recette, avec la mise en Production séparée :
  [ROADMAP.md](ROADMAP.md) § 4.4.
- L'autonomie ne couvre **jamais** une opération de Production ou destructrice : voir [REPRISE.md](REPRISE.md) § 2.

### Autres décisions

Décisions de module encore en vigueur (SAMMI jamais réactivé, Votekick, Caution, Roue V2, tarifs…) : [ROADMAP.md](ROADMAP.md) § 5.

## 11. Sauvegardes et retour arrière

**Base Production**

- Sauvegarde Coolify quotidienne à 04:00 UTC ; dernière réussie le 08/11.
- Dumps vérifiés par restauration le 20/10, le 04/11 et le 07/11 (`prod-db-2026-11-07-avant-coulisses`).

**Données de Studio**

- `studio-data-2026-11-07-avant-coulisses` : 204 fichiers, restauration d'essai 204/204.
- Installateurs `studio-installer-0.1.25` et `-0.1.26`.

**Extension Next**

- `extension-next-2026-11-08` : bundle de `backup/roue-v2-wip-2026-10-25`, patch du travail non commité du checkout principal.

Tout est dans `C:\Users\Antoni\Documents\Sauvegarde Raptoru 2.0\`, à accès restreint. Ne jamais déplacer ni supprimer ces fichiers.

**Retour arrière**

- Core et bot : [OPERATION_COULISSES.md](studio-refonte/OPERATION_COULISSES.md) § 6. Le SQL de sauvegarde des poids
  d'alertes passe **avant** un retour au Core `8a897a5`.
- Une migration n'est jamais annulée automatiquement.
- Ne jamais restaurer un dump sur la Production sans décision : cela effacerait les achats postérieurs.
- Extension : le shell legacy reste le défaut ; procédure préparée sur la branche (`docs/extension/EXTENSION_NEXT_PUBLICATION.md` § 5).
- Inventaire complet : [BACKUPS.md](BACKUPS.md) ; carte des sauvegardes et des worktrees : [WORKSPACES.md](WORKSPACES.md).

## 12. Ce qui demande encore Antoni

1. **Extension**
   - Prouver la version servie par Twitch.
   - Trancher les décisions § 13 du plan (publication du lot 1, interrupteur de retour arrière, retraits du lot 6).
   - Hosted Test (zip staging v2), vrais appareils.
   - Écrire l'inventaire « Validé par Antoni : oui » avant une publication.
   - Soumettre l'extension.
2. **Git**

- Pousser le commit local `5d24614` de la PR #54 (titres), et trancher les PR ouvertes : [CLEANUP_LATER.md](CLEANUP_LATER.md) § 2.

3. **Exploitation**
   - Corriger le secret GitHub `COOLIFY_URL`.
   - Supprimer le conteneur de répétition `coulisses-rehearsal-pg` et le worktree `rollback-8a897a5`.
   - Mettre à jour le checkout principal en préservant les données de Studio.
4. **Studio**
   - Confirmer par écrit la recette d'usage de 0.1.26 et 0.1.27.
   - Choisir A ou B pour le retrait de l'ancien Lab.
   - Décider du sort du code mort.
   - Dire si le badge « Lead Moderator » est attendu.
5. **Contenu métier**
   - Défis, cosmétiques et récompenses définitifs.
   - Interrupteur « Monnaie Bonbons ».
   - Profil d'alertes Halloween, toujours actif le 02/11 : relevé non refait depuis.
   - Achat Halloween d'un viewer en attente de décision : détail hors du dépôt public.

## 13. Prochaine priorité

Deux missions distinctes, à ne pas mélanger :

1. **Mission « modules »**, la prochaine proposée : passe expérience sur 2 ou 3 modules existants, en Lab
   ([ROADMAP.md](ROADMAP.md) § 4.3), puis la Roulette visuelle, puis le Slot.
2. **Mission « publication d'Extension Next »**, sur GO dédié : preuve de la version servie, inventaire, Hosted Test sur
   vrais appareils, soumission avec le legacy en repli ([ROADMAP.md](ROADMAP.md) § 2.1).
