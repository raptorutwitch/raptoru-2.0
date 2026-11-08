# Refonte de Raptoru Studio — checkpoint

> **État au 08/11/2026 (consolidation).** La refonte est **fusionnée** (PR #56 → `1b25f30`, puis PR #57 → `13ed6e8`) et **en Production** depuis le 07/11 : Core et bot `1b25f30`, Studio 0.1.27 installé. Bascule et retour arrière : [OPERATION_COULISSES.md](OPERATION_COULISSES.md) § 12 et § 6. État global : [../PROJECT_STATUS.md](../PROJECT_STATUS.md). Ce point de reprise est **historique** : le point d'entrée est [../REPRISE.md](../REPRISE.md).

**Mis à jour : 07/11/2026 — Mission finale (finitions, socle modulaire, préparation de la migration) : [FINALISATION.md](FINALISATION.md), recette [RECETTE_FINALE.md](RECETTE_FINALE.md), livraison [LIVRAISON.md](LIVRAISON.md) § 9, données [MIGRATION_DONNEES.md](MIGRATION_DONNEES.md). Avant : consolidation ([CONSOLIDATION.md](CONSOLIDATION.md)). Direction D validée par Antoni ; migration et Production non validées. Règles : [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).**
Lire ensuite [CONTEXTE.md](CONTEXTE.md) (décisions, règles, architecture ; principes fonctionnels § 17), puis
[ROADMAP.md](ROADMAP.md) (état par lot, lots fonctionnels F1-F7), puis [AUDIT_FONCTIONNEL.md](AUDIT_FONCTIONNEL.md) si
le travail touche au comportement d'un module.

## Où

- Branche **`feat/studio-ux`**, locale et jamais poussée.
- Worktree : `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux`.
- Base : `docs/site-hub-delivered` (68420a0) → `main` 8a897a5.
- Production : Core 8a897a5, bot 4ba9243, site 74f7542, Studio **0.1.25 publiée** (sans la refonte ; installation sur
  le PC à confirmer). À revérifier soi-même : `docs/REPRISE.md` § 2.
- Vérifier d'abord `git -C "<worktree>" status --short` et `git log --oneline -8`. L'arbre doit être propre.
- Captures de référence : [captures/foundation/](captures/foundation/).

## STUDIO FOUNDATION COMPLETE (06/11) : UX/UI refusée à la recette, reprise dans [REDESIGN.md](REDESIGN.md)

Ligne d'arrivée et état de chaque critère : [FOUNDATION_COMPLETE.md](FOUNDATION_COMPLETE.md). Recette d'Antoni :
[RECETTE_FOUNDATION.md](RECETTE_FOUNDATION.md). Retrait de l'ancien Lab, préparé, non exécuté :
[RETRAIT_ANCIEN_LAB.md](RETRAIT_ANCIEN_LAB.md).

- Lancer le Lab : `npm run studio:lab` (Studio installé fermé, Docker démarré). Retour arrière : `npm run studio:legacy`.
- Vérifier : `cd apps/studio/server && npx playwright test` (vrai Core par défaut, `E2E_STACK=legacy` pour l'ancienne pile).
- Serveur réel isolé pour regarder l'interface : `RAPTORU_DATA_ROOT=<scratch> PORT=4398 DOCK_PORT=4408
RAPTORU_LAB_PG_CONTAINER=studio-ux-test-pg STUDIO_LAB_DATABASE_URL=postgres://postgres:uxtest@127.0.0.1:55499/x node
apps/studio/server/dist/index.js` (jamais les ports 4100 / 4110 du Studio installé).
- Base pour les suites d'intégration : `studio-ux-test-pg` (port 55499).

## Derniers commits (plus récent en haut)

Mise en œuvre du 05/11 (codé et testé automatiquement ; rien de validé par Antoni, rien de publié) :

- `3a06b78` **H9** complément de fidélité · `3d8f681` attentes Studio alignées (H3, H5, P0-2).
- `a53873a` **H10 / H12 / H14** réglages (migration `module_settings` préparée) · `061c5a8` **H6** Spotify en fin
  de live · `23b8434` suites PostgreSQL canoniques avec live.
- `c93dc4d` Jeu des mots dans « Prêt pour le live » · `f9e9724` **H1** achats liés au stream uniquement pendant le live
  canonique (refus avant débit ; Lab jamais bloqué) · `2d2e7c6` Extension Lab « joue sur OBS » · `ad5eeb4` **F5** micro
  et filtres rétablis à la fermeture de Studio · `0246e56` **P0-5** bot : événement de live rejoué tant que le Core ne
  l'a pas enregistré.
- `a0ed9a7` H8 Jeu des mots ON/OFF durable + intervalle (migration préparée) · `3e4e1db` / `38d8d43` F4 « Prêt pour le
  live » en tête du Centre de contrôle.
- `3311fb5` H16 état réel du moteur des Défis · `e944670` H15 option Level Up masquée (extension) · `2355f55` H13 mode
  V1/V2 de la roue en « avancé » · `53b9981` H5 StreamElements ACTIVE repris en Production · `d167ca4` H4 TTS 5 min.
- `ba1b669` H3 alertes 30 min + « Vider la file » · `04ccc3f` H2 travaux OBS des points expirés à 2 min + remboursement
  · `67b1d04` P0-4 garde Core du live simulé · `5b792f8` P0-3 frontière de la roue (migration `enabled_at`, préparée
  non appliquée) · `9e1e3fa` P0-2 une écriture Wallet par intention (Modération, Boutique) · `76de82e` F1 vérité des
  états (Régie, échec Production, « Exécuter maintenant (réel) », Spotify à blanc).
- Base PostgreSQL jetable pour les tests : conteneur Docker `studio-ux-test-pg`, port 55499,
  `TEST_DATABASE_URL=postgres://postgres:uxtest@127.0.0.1:55499/raptoru_ux_test` (à supprimer en fin de chantier).
- Commit de la documentation de l'audit.
- `a49178a` Boutique : une action à la fois.
- `cde6c4f` Test Lab : uniquement des arrêts en Production.
- `0675b9b` lecteur Soundboard chargé au lancement, live simulé refusé en Production, mini-jeux, Caution.
- `f1f1b03` consolidation documentaire.
- `377e726` kit de revue.
- `4282312` habillage des vues historiques.
- `f5c5b0d` Progression.
- `b1aab1f` / `1d8992a` Régie.
- `a08a249` lots 0-4.

## État

- **Refondu (code + tests automatiques)** :
  - shell et navigation ;
  - Défis, Boutique, Progression ;
  - Régie live (partielle) ;
  - Récompenses Twitch (partielle).
- **Seulement habillé** : Alertes, Soundboard, TTS, Bonk, Tombola, Commandes, Modération, Jeu des mots, Halloween,
  Simulation, Test Lab, Extension Lab, Système.
- **Audit fonctionnel livré** : [AUDIT_FONCTIONNEL.md](AUDIT_FONCTIONNEL.md).
  - Contenu : cartographie, grille d'états, analyse des modules, cycle du live, backlog P0-P3, arbitrages H1-H16, plan
    F1-F7.
  - Six correctifs sûrs, dans trois commits.
- **Rien n'est validé par Antoni ni publié.**
- Tests de l'audit :
  - unitaires `raffle-lab`, `caution-view`, `simulation-view`, `studio-shell`, `control-center`, `test-lab`,
    `extension-lab`, `twitch-connections-routing` ;
  - E2E `cosmetic-*` (3) ;
  - typecheck, lint, Prettier, build web.
- E2E `tombola-bonbons` en échec : il échoue aussi sans ces changements, sur `f1f1b03` (ROADMAP, instabilités).

## Règles à respecter (résumé, détail CONTEXTE § 7, 10-12, 17)

- Tout Studio peut être refondu, prototypes validés compris. Les capacités métier sont conservées. Aucun gestionnaire en
  double, pas de septième destination.
- Les catégories PRODUCTION / LAB / SIMULATION / APERÇU LOCAL suivent le comportement réel. Jamais d'état inconnu
  maquillé. Jamais de vert sur une intention seule.
- L'Extension Lab est essentiel. Une simulation inutile n'est retirée qu'après vérification de ses usages.
- Aucun nouvel automatisme métier avant les arbitrages H. Comportement actuel conservé.
- Aucune action en Production, push ou release sans GO d'Antoni. Données fictives uniquement. Pas de contenu métier
  inventé.

## Ouvert

- **Arbitrages H1-H16** (audit § H), à faire trancher par Antoni.
- Questions Défis (3), Storyboard introuvable, classement des simulations : CONTEXTE § 13.
- Vérifications que seul Antoni peut faire :
  - lecteur Soundboard dans le vrai Studio en profil Production ;
  - P0-9 : `BOT_INSTANCE_ID` dans Coolify, en lecture.

## Mission en cours : « Opération fondation totale » (05/11, GO Lab, autonomie maximale)

Phase 1 (consolidation du socle) :

| Commit    | Contenu                                                                                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0148b26` | porte chat des modules : `chatWords` réservés contre Commandes V2, `ctx.say` (origine `module:<id>`), interrupteur du socle pour les lecteurs du chat, échec isolé ; migration `20261121190000_cmd_steps_module_origin_lab.sql` préparée                                                 |
| `77e614d` | correctifs d'une revue indépendante (13 constats, détail dans DECISIONS) : falsification d'achat par le cockpit (P0 latent), auto-remboursement, prix confirmé, réservation des lecteurs OBS avec bail, catalogue et travaux périodiques isolés, modération de l'extension sans `prompt` |

Puis :

| Commit    | Contenu                                                           |
| --------- | ----------------------------------------------------------------- |
| `104acb7` | D4 › « Autres modules » (extension)                               |
| `d080506` | même D4 dans Studio, et la pile d'aperçu reçoit `/api/lab`        |
| `f354ead` | `createStudioServer` en options nommées (S1)                      |
| `c026907` | adaptateur Votekick                                               |
| `957bcc3` | adaptateur Caution                                                |
| `ec2f170` | adaptateurs d'état Random Ban, Jeu des mots, Boutique d'événement |

Stratégies et matrices de parité : `architecture/MIGRATIONS.md`.

Puis :

| Commit    | Contenu                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| `4c97661` | page « Modules du socle » en tuiles ; panneau de réglages compact avec un vrai interrupteur |
| `d46e912` | Prettier et documentation (CONTRATS § 9, FRICTIONS, DECISIONS D15-D20, guides, PREUVES)     |

Suites complètes avant `d46e912` :

| Suite                  | Résultat |
| ---------------------- | -------- |
| Core                   | 1 396    |
| Intégration PostgreSQL | 191      |
| Studio                 | 884      |
| Extension              | 78       |
| Bot                    | 287      |
| Lint, typecheck        | propres  |

Vu dans un navigateur, sur la pile isolée (port 4411) :

- achat dans l'Extension Lab ;
- remboursement depuis D4 › « Autres modules », dans l'extension et dans Studio ;
- tuiles du socle ;
- réglages, y compris en largeur mobile.

### Mission continue (05/11)

| Commit    | Contenu                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `66cab2b` | vérification ciblée du socle (10 questions, `PREUVES.md`) ; un module Lab ne laisse aucun réglage en Production |
| `8a2f113` | extension : Commandes, Roue du Sub et Événements sortis de `ui.js` (`registerSessionModule`)                    |
| `3e1785c` | `LIVRAISON.md` (8 migrations, coexistence des versions, ordre, retour arrière) ; Spotify H6 vérifié             |
| `9dddeec` | lecteur OBS fictif générique, en Lab seulement, par la vraie porte `claim` / `report`                           |
| `46b2c50` | « Prêt pour le live » en grille de cartes                                                                       |
| `4624658` | les 3 P2 d'une revue indépendante corrigés                                                                      |

Suites avant `4624658` :

| Suite       | Résultat |
| ----------- | -------- |
| Core        | 1 396    |
| Intégration | 191      |
| Studio      | 886      |
| Extension   | 80       |

En plus : les E2E Boutique, Commandes et modules de session.

Vu en navigateur (pile isolée, port 4411) :

- achat, prise par le lecteur fictif, échec, « remboursé » chez le viewer et dans Studio ;
- Centre de contrôle en 1440 et 420 px.

### Mission d'exécution (05/11) — extension

| Commit    | Contenu                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `b9ea6c4` | E2E de parité TTS V2 et Tombola V2, avant toute modification                                                             |
| `50e8601` | variantes de module (`onState`) : TTS V2 et Tombola V2 sortis de `ui.js`                                                 |
| `602401a` | la liste « Voir tous les modules » ne se referme plus toute seule                                                        |
| `3483612` | correction de lint d'un test                                                                                             |
| `2d9f7b2` | D4 sorti de `ui.js` ; P1 corrigé (écran vide en modérateur sur TTS V2 et Tombola V2) ; chemin rapide prouvé par mutation |

`ui.js` : 6 289 → 6 214 lignes. E2E de l'extension : 15 verts.

Prochaines étapes (ordre conseillé) :

1. Antoni valide dans le vrai Lab (`npm run studio`), en viewer **et** en modérateur :
   - le Hub de l'extension ;
   - TTS V2 (achat, retour) ;
   - Tombola V2 ;
   - D4 › Commandes.
2. Soundboard puis Bonk : E2E de parité d'abord, extraction ensuite (`architecture/MIGRATIONS.md`, § extension).
3. Adaptateurs Core et Studio, seulement là où ils apportent un vrai gain (Roue du Sub, Points de chaîne).
4. Le jour du GO : suivre `LIVRAISON.md`. L'extension ne change aucune route du Core : elle peut être livrée après le Core
   ou avec lui.

### Continuation (05/11) — Soundboard, Bonk, cycle de vie

| Commit                            | Contenu                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `a573bf4`                         | E2E de parité Soundboard (3 rôles) avant extraction                                                               |
| `480ee5c`                         | E2E TTS intermittent : vraie cause trouvée et corrigée (signal `data-recovered`, lecteurs fictifs qui acquittent) |
| `295e59c` / `b8a5f19` / `7cc951b` | aperçu et retour d'envoi Soundboard sortis de `ui.js`                                                             |
| `208791e`                         | vue Soundboard = une poignée de cycle de vie ; 2 défauts du volume corrigés                                       |
| `dbf64cb`                         | E2E de parité Bonk (fournisseurs 7TV/BTTV/FFZ fictifs, aucun réseau)                                              |
| `c960894` / `725df10`             | Bonk : ancien message au retour corrigé ; envoi sorti de `ui.js`                                                  |
| `dc209e2`                         | contrat de cycle de vie : 3 rôles, transitions, lectures arrêtées, coupure réseau                                 |
| `d3e564a`                         | corrections de la revue indépendante (message Bonk en vol, test du glisser, garde réseau du navigateur)           |

`ui.js` : 6 214 → 6 005 lignes. Détail et limites : `architecture/MIGRATIONS.md`, `architecture/PREUVES.md`.

Prochaines étapes (ordre conseillé) :

1. Antoni valide dans le vrai Lab (`npm run studio`) : Soundboard (aperçu, volume + Échap, glisser, envoi) et Bonk (tir,
   salve, favori, retour au Hub), en viewer puis modérateur.
2. Sortir `soundboardForm` dans son fichier (les E2E de parité sont prêts).
3. Bonk : simulateur Lab de l'autorisation Twitch des émotes, puis extraction du catalogue.

### Frontières Soundboard et Bonk (05/11)

| Commit    | Contenu                                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9c45e91` | Soundboard = variante dans son fichier ; 3 défauts à la souris corrigés (tri, volume, Échap)                                                                     |
| `d163944` | scénario Bonk déterministe (Twitch fictif, prix et délai Studio, écrans étroits) ; 3 défauts corrigés (prix Lab, libellé du délai, étoile sur cellules de 44 px) |
| `ae85b0c` | accès aux emotes Twitch = service de l'hôte (`emote-access.js`)                                                                                                  |
| `9a2c504` | Bonk = variante dans son fichier                                                                                                                                 |
| `59bb0fb` | la pile E2E écrit la cause de sa mort                                                                                                                            |
| `dccec77` | corrections de la revue indépendante                                                                                                                             |

`ui.js` : 6 005 → 3444 lignes. Soundboard et Bonk : écran, état, écouteurs, minuteries et règles dans leurs fichiers ;
`ui.js` ne garde que leur nom dans le Hub et le porte-monnaie d'en-tête de la Soundboard.

Prochaines étapes (ordre conseillé) :

1. Antoni valide dans le vrai Lab (`npm run studio`) : Soundboard (tri à la souris, volume, glisser, crédits) et Bonk
   (tir, salve, Twitch lié, panneau Twitch étroit), en viewer puis en modérateur.
2. TTS V1, Tombola V1 et modération V1 : encore dans `ui.js` ; à sortir quand on y retouche (même méthode).

### Derniers couplages de l'extension (05/11)

| Commit    | Contenu                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| `6e0e4ae` | harnais V1 en mode démo (`v1-parity.e2e.ts`) ; TTS V1 = variante (`tts-v1.js`)                  |
| `2ad1bb1` | Tombola V1 = variante (`tombola-v1.js`)                                                         |
| `b27da6e` | modération V1 = variante (`moderation-v1.js`) ; Échap sur l'historique d'un utilisateur corrigé |
| `9443ac1` | porte-monnaie d'en-tête déclaré par la variante (`wallet`)                                      |

`ui.js` : 3 444 → 1 642 lignes. Les V1 restent les écrans des sessions sans V2 (Lab sans Core, calibration, TTS de
Production en repli) : rien supprimé. Détail : architecture/MIGRATIONS.md, CONTRATS § 13.

Studio ensuite (05/11) :

| Commit    | Contenu                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `99c7478` | Alertes en quatre onglets (Créer et tester · File et OBS · Sources d’événements · Variantes) ; E2E `alerts-studio`                     |
| `f220e31` | Système : carte « Modules » retirée (doublon, liens Lab en Production), outils de développement en Lab seulement, profil illisible dit |
| `5080f9e` | Prêt pour le live : seul ce qui demande attention reste en cartes ; « Prêt (n) » replié                                                |

À voir par Antoni dans le vrai Lab : Alertes (les quatre onglets, l’aperçu, la file, les sources), Système, Centre de
contrôle.

À vérifier par Antoni (facultatif, ces écrans ne servent pas en Production) : un Studio Lab sans Lab Core
(`BONK_LAB_CORE_URL` absent) affiche TTS, Tombola et modération V1 comme avant.

### Lab cible : véritable Core en mode Lab (05/11, décision d'Antoni : Lab local + Production, pas de staging permanent)

| Commit    | Contenu                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `67de267` | Core : `CORE_ENVIRONMENT=lab` gardé (base locale, chaîne fictive, pas de Twitch réel) ; `npm run lab` / `lab:reset` |
| `356617d` | assemblage unique (`main-server.ts`) ; Extension Lab sur le vrai `/v1/ext` (Studio signe le JWT, relaie)            |
| `6fe32e9` | transport Production de Studio vers le Core Lab local ; boucle complète extension → Core → worker Studio → lecteur  |

| `f46e8fc` | 7TV / BTTV / FFZ publics : option du Core coupée par défaut (lecture seule) ; Twitch fictif dans le Lab |
| `2041804` | `STUDIO_LAB_CORE=main npm run studio` : le Lab sur le véritable Core (opt-in ; l'ancien Lab reste le défaut) |
| `ac0263a` | simulateur de chat sur la porte du bot, en Lab seulement |
| `3abcb38` | alertes, points de chaîne (simulateur Spotify), Random Ban, Roue, Dock, Halloween… en mode Lab sur ce Core |

| `7a907dd` | parité : table Lab derrière le cockpit, Twitch fictif, page Extension Lab, toutes les specs E2E sur le Core principal |
| `0748f3f` | verrous (OBS fictif, Test Lab, Twitch) ; recette sur un vrai serveur Studio ; build Studio réparé |

À essayer par Antoni : `npm run studio:lab` (Studio installé fermé). Parité, absences voulues et proposition de bascule :
architecture/MIGRATIONS.md § « Lab cible ».
Pour essayer le nouveau Lab : `apps/core-api/.env.lab` (voir l'en-tête de `src/scripts/lab-reset.ts`), puis
`npm run lab:reset -w @raptoru/core-api` et `npm run lab -w @raptoru/core-api`. Staging : intact.

## Prochaine action

**Mission « socle modulaire » (05/11, GO Lab) : codée et testée automatiquement.** Tout est dans
[architecture/](architecture/) : VISION, FRICTIONS (statuts), CONTRATS, GUIDE_MODULE / EXTENSION / MODERATION / LAB,
PREUVES (mesures des démos A, B, C et limites), DECISIONS (D11 **à arbitrer** : onglet « Modules » de la console D4).

- Commits :

  | Commit                | Contenu                                                                                                            |
  | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
  | `54b2b87`             | docs                                                                                                               |
  | `e780437`             | Core                                                                                                               |
  | `037a7db`             | Studio                                                                                                             |
  | `8a2d862`             | extension                                                                                                          |
  | `8ef2912`             | modération extension + **liste blanche Lab corrigée** (les réglages H10 / H12 / H14 étaient refusés en profil Lab) |
  | `e08d1a5`             | démo C mini-jeux                                                                                                   |
  | `5a418f1` / `90f1147` | générateur `module:new` + contrôle de navigation                                                                   |
  | `c4166e2`             | porte du lecteur OBS                                                                                               |

- À faire par Antoni : voir dans le Lab réel (`npm run studio`, profil Lab) :
  - Laboratoire › Modules du socle ;
  - la carte Roulette · Slots · Duels ;
  - le Coffre dans l'Extension Lab, avec une identité viewer puis modérateur.
- Ensuite, au choix d'Antoni : migrer un module historique quand il est retouché (modèle : démo C).

## Reprendre

```text
cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux"
git status --short ; git log --oneline -8
npm run build -w @raptoru/schemas
cd apps/studio/web && npx tsc -p tsconfig.json
cd ../server && npx tsc -p tsconfig.build.json --noEmit
npx vitest run test/studio-shell.test.ts test/raffle-lab.test.ts test/simulation-view.test.js
dev\apercu-refonte-studio.cmd    (aperçu navigateur, données fictives)
```

`npx tsc -p tsconfig.json` sur le serveur Studio est de nouveau propre (`8ef2912`).

Mettre à jour ce fichier et ROADMAP.md à chaque lot commité ; le détail daté va dans JOURNAL.md.
