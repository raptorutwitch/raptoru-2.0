# Refonte de Raptoru Studio — checkpoint

**Mis à jour : 05/11/2026 — « Opération fondation totale » : phase de consolidation et premières migrations livrées en code (`d46e912`, arbre propre). Lab uniquement, rien de validé ni publié.**
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

| Commit | Contenu |
|---|---|
| `0148b26` | porte chat des modules : `chatWords` réservés contre Commandes V2, `ctx.say` (origine `module:<id>`), interrupteur du socle pour les lecteurs du chat, échec isolé ; migration `20261121190000_cmd_steps_module_origin_lab.sql` préparée |
| `77e614d` | correctifs d'une revue indépendante (13 constats, détail dans DECISIONS) : falsification d'achat par le cockpit (P0 latent), auto-remboursement, prix confirmé, réservation des lecteurs OBS avec bail, catalogue et travaux périodiques isolés, modération de l'extension sans `prompt` |

Puis :

| Commit | Contenu |
|---|---|
| `104acb7` | D4 › « Autres modules » (extension) |
| `d080506` | même D4 dans Studio, et la pile d'aperçu reçoit `/api/lab` |
| `f354ead` | `createStudioServer` en options nommées (S1) |
| `c026907` | adaptateur Votekick |
| `957bcc3` | adaptateur Caution |
| `ec2f170` | adaptateurs d'état Random Ban, Jeu des mots, Boutique d'événement |

Stratégies et matrices de parité : `architecture/MIGRATIONS.md`.

Puis :

| Commit | Contenu |
|---|---|
| `4c97661` | page « Modules du socle » en tuiles ; panneau de réglages compact avec un vrai interrupteur |
| `d46e912` | Prettier et documentation (CONTRATS § 9, FRICTIONS, DECISIONS D15-D20, guides, PREUVES) |

Suites complètes avant `d46e912` :

| Suite | Résultat |
|---|---|
| Core | 1 396 |
| Intégration PostgreSQL | 191 |
| Studio | 884 |
| Extension | 78 |
| Bot | 287 |
| Lint, typecheck | propres |

Vu dans un navigateur, sur la pile isolée (port 4411) :
- achat dans l'Extension Lab ;
- remboursement depuis D4 › « Autres modules », dans l'extension et dans Studio ;
- tuiles du socle ;
- réglages, y compris en largeur mobile.

Prochaines étapes (ordre conseillé) :
1. Antoni valide dans le vrai Lab (`npm run studio`) :
   - Modules du socle ;
   - Points de chaîne › Votekick et Caution (nouveaux panneaux) ;
   - D4 › Autres modules ;
   - le coffre dans l'Extension Lab.
2. Adaptateurs d'état pour Roue du Sub, Spotify et Points de chaîne (modèle : `status-adapters.ts`).
3. Exécuteur OBS générique côté Studio (`claim` / `report`) et page d'overlay par module.
4. Extraction progressive de `ui.js` (historique), module par module, avec tests de parité.
5. Le jour du GO de déploiement :
   - migrations `20261121170000` / `180000` / `190000`, dans l'ordre (voir ROADMAP) ;
   - supprimer le conteneur de test `studio-ux-test-pg`.

## Prochaine action

**Mission « socle modulaire » (05/11, GO Lab) : codée et testée automatiquement.** Tout est dans
[architecture/](architecture/) : VISION, FRICTIONS (statuts), CONTRATS, GUIDE_MODULE / EXTENSION / MODERATION / LAB,
PREUVES (mesures des démos A, B, C et limites), DECISIONS (D11 **à arbitrer** : onglet « Modules » de la console D4).

- Commits :

  | Commit | Contenu |
  |---|---|
  | `54b2b87` | docs |
  | `e780437` | Core |
  | `037a7db` | Studio |
  | `8a2d862` | extension |
  | `8ef2912` | modération extension + **liste blanche Lab corrigée** (les réglages H10 / H12 / H14 étaient refusés en profil Lab) |
  | `e08d1a5` | démo C mini-jeux |
  | `5a418f1` / `90f1147` | générateur `module:new` + contrôle de navigation |
  | `c4166e2` | porte du lecteur OBS |

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
