# Méthode de travail d'un agent sur Raptoru 2.0

Référence opérationnelle pour Claude Code (ou tout agent), décidée le 15/11/2026. `CLAUDE.md` la résume en quelques
lignes et y renvoie. L'état du projet est dans [`REPRISE.md`](REPRISE.md) ; ce guide décrit **comment** travailler.
En cas de conflit, `CLAUDE.md` et les protections de Production (§ 10) priment.

## 0. Démarrage express (moins d'une minute)

1. Lire `docs/REPRISE.md` § 0, puis `git status` / `git log -3 origin/main`. Ne pas relire l'historique.
2. **Classer la demande** (A, B, C ou D, § 3). La classe fixe le budget d'exploration, les tests et la livraison.
3. Travailler dans le worktree réutilisable `Documents\Raptoru 2.0 - Worktrees\agent` : `git fetch` puis
   `git switch -c <branche> origin/main`. Jamais dans le checkout principal (c'est le dossier de données de Studio).
4. **Mesurer ou reproduire avant de coder** (§ 4). Une poignée de fichiers suffit pour A et B.
5. Tests locaux **ciblés** seulement. Les suites complètes, c'est la CI de `main`.
6. Avant le push : Prettier et ESLint sur les fichiers modifiés, typecheck des paquets touchés (§ 7.2).
7. Livrer selon le mandat (§ 11) : **un seul cycle de CI** pour A, B et C ; la doc dans la même PR.
8. Attendre une CI ou une publication **en arrière-plan avec notification** ; avancer sur autre chose entre-temps.
9. Le compte rendu est court et suit le format demandé.

## 1. Philosophie

- Le temps perdu vient surtout des attentes (CI, suites) et des vérifications répétées, pas de la réflexion.
  On garde la rigueur là où est le risque, pas partout.
- On fait le changement minimal à l'endroit de la cause mesurée. Les améliorations annexes vont dans `docs/ROADMAP.md`.
- On réutilise ce qui existe (services, scripts de déploiement, workflows, piles de test) avant d'écrire quoi que ce soit.

## 2. Priorités, dans l'ordre

1. Protections de Production et sécurité (`CLAUDE.md`, § 10).
2. Le périmètre du mandat : une enquête reste une enquête ; une correction n'est pas une livraison, sauf si c'est dit.
3. Une livraison correcte et vérifiée sur ce qui a changé.
4. La vitesse : moins d'attentes, de relances et d'exploration.
5. La documentation minimale utile (REPRISE, doc du module).

## 3. Classes de demandes

| Classe         | Exemples                                                                        | Exploration                            | Tests locaux                                                                                            | CI avant fusion                   | Livraison                                                                        |
| -------------- | ------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| **A** triviale | texte, réglage, condition, CSS isolé                                            | aller au fichier (Grep), ≤ 5 min       | le test du fichier s'il existe ; Prettier, ESLint, typecheck du paquet                                  | non                               | PR fusionnée tout de suite → CI `main` → déploiement si mandat                   |
| **B** ciblée   | latence, déclencheur, route, petite option                                      | reproduire ou mesurer, cause, ≤ 15 min | tests des fichiers touchés + un e2e du parcours concerné                                                | non                               | comme A                                                                          |
| **C** fonction | action de commande, écran Studio, comportement d'extension                      | délimiter les composants, réutiliser   | tests unitaires et d'intégration nouveaux, e2e du parcours complet, captures si UI                      | non (oui si la PR est très large) | comme A ; Studio et extension selon le mandat                                    |
| **D** sensible | migration, Wallet / économie, droits, auth, récompenses Twitch, données réelles | audit sérieux une fois, plan, rollback | + concurrence, idempotence, droits ; vrai PostgreSQL si verrous ; suite Core complète si module partagé | **oui**                           | sauvegarde, `plan`, déploiement contrôlé, vérification Production, rollback prêt |

- Une migration, même additive, place la livraison en **D pour l'étape de déploiement** (sauvegarde et
  `--migrations-approved`), pas forcément pour tout le développement.
- Toucher aux Jetons, aux droits ou aux accès implique toujours les tests de concurrence et de droits (`CLAUDE.md`).
- Changer de classe en cours de route : le dire en une ligne dans le compte rendu.

## 4. Diagnostic rapide

- **Un « bug » signalé : vérifier d'abord les données réelles, en lecture seule.** Exemple du 15/11 : le « bug
  Streamer » était un délai de 5 min par personne, visible dans le journal des invocations de Production.
  - Lectures possibles : le cockpit Studio (`/v1/studio/cockpit/<module>/<chaîne>/…`, avec le jeton
    d'installation de Studio, voir `apps/studio/server/src/prod-transport/core-client.ts`) et `GET https://core.raptoru.fr/health|ready`.
  - Pas d'écriture en Production pour diagnostiquer.
- **Une lenteur : chronométrer chaque étape avant de choisir une solution.**
  - Utiliser une page du Lab dans un vrai navigateur, avec des horodatages (modèle : `e2e/commands-sound-latency.e2e.ts`).
  - Mesurer avec les **paramètres de Production** : la pile e2e a ses propres intervalles (ex. `E2E_CLAIM_MS`).
- Une cause, une correction : si l'interrogation coûte, corriger l'interrogation, pas le transport entier.
- Avant de créer un mécanisme, chercher le modèle existant en une recherche, pas un audit.
  - Attente longue : `dock/service.ts` `changes()`.
  - Flux Core → Studio : `word-game-routes.ts`.
  - Files durables : `commands/steps.ts`.

## 5. Recherche dans le dépôt

- Outils dédiés d'abord : `Grep` (motif, `-n`, `glob`), `Glob`, `Read` avec `offset`/`limit`. `sed -n a,bp` pour une plage connue.
- Points d'entrée par composant :
  - Core : `apps/core-api/src/<module>/` (service, routes dans `http/*-routes.ts`) ; assemblage dans
    `app.ts`, `main-server.ts`, `lab-chat/games.ts`.
  - Frontière de l'extension : `ext/ext-facade.ts` (+ `ext/*-ext.ts`). Cockpit Studio : `http/studio-cockpit-routes.ts`.
  - Studio serveur : `apps/studio/server/src/<module>/` ; câblage dans `src/index.ts`. Studio web :
    `apps/studio/web/src/pages/<module>*.ts`.
  - Extension : `apps/twitch-extension/extension/shared/<module>.js`. Shell v2 (celui de Production) :
    `app/panel.js`, feuilles `modules/<module>/*.css` (les feuilles legacy sont à la racine de `extension/`).
  - Schémas partagés : `packages/schemas/src/<module>.ts`. À recompiler (`npm run build -w @raptoru/schemas`)
    avant le typecheck du Core.
  - Migrations : `supabase/migrations/`, classées dans `apps/core-api/src/db/migration-scopes.ts`.
- Lancer l'agent `Explore` seulement pour un balayage multi-modules de plus de 3 recherches. Jamais pour un fichier connu.

## 6. Outils réellement disponibles

| Outil                                                                                                                                                           | Usage                                                                                                                                               | Ne pas l'utiliser pour                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Bash` `run_in_background` + notification                                                                                                                       | suites longues, `npm ci`, `gh run watch <id> --exit-status`, workflow Studio : **un** processus par attente, on est notifié à la fin                | des boucles `sleep`/`until` de 10 min, plusieurs surveillants de la même CI |
| `Monitor` (outil différé, à charger avec `ToolSearch`)                                                                                                          | attendre une condition ou une ligne de log                                                                                                          | ce qu'une notification de tâche donne déjà                                  |
| `TaskStop`                                                                                                                                                      | arrêter un surveillant ou une suite devenus inutiles                                                                                                |                                                                             |
| Agent `Explore` (modèle `sonnet` ou `haiku`)                                                                                                                    | balayage large, en parallèle d'un travail local                                                                                                     | 1 à 3 recherches ciblées                                                    |
| Agents `agent-skills:code-reviewer`, `security-auditor`, skills `/code-review`, `/security-review`                                                              | relecture indépendante d'un diff de classe D (droits, auth, économie) avant fusion                                                                  | A et B                                                                      |
| Skill `/simplify`                                                                                                                                               | après un gros diff C, si du code dupliqué est apparu                                                                                                | par principe                                                                |
| Ponytail `lite` (hook SessionStart)                                                                                                                             | déjà actif : solution minimale                                                                                                                      | n'est pas un mandat pour couper validation ou sécurité                      |
| Graphify                                                                                                                                                        | seulement un impact transversal réel (`CLAUDE.md`)                                                                                                  | une modification locale                                                     |
| `gh`                                                                                                                                                            | PR, `gh run watch`, `gh run rerun <id> --failed`, `gh workflow run studio-release.yml`, logs de jobs (`gh api …/jobs/<id>/logs`)                    |                                                                             |
| `scripts/coolify-deploy.mjs` (`COOLIFY_URL=https://dashboard.raptoru.fr`)                                                                                       | `plan` (lecture seule), `deploy core <sha> [--migrations-approved] --go`, `--rollback` ; vérifie la CI de `main`, le live, la santé                 | un déploiement hors mandat                                                  |
| Workflow « Studio — construire / publier »                                                                                                                      | `gh workflow run studio-release.yml --ref main -f publish=public -f confirm="PUBLISH studio <sha7>"` (≈ 7–9 min, construit sous Windows sur GitHub) | une publication non demandée                                                |
| `npm run package:production -- --shell v2 --check` (extension)                                                                                                  | vérifie tout le paquet sans écrire de ZIP                                                                                                           | écrire la ligne « Validé par Antoni : oui » (jamais)                        |
| Pile e2e (`apps/studio/server`) : `npx playwright test e2e/<spec>.e2e.ts --project lab`                                                                         | le Core principal en mode Lab, Studio et l'extension dans de vrais navigateurs, aucune donnée réelle                                                | la suite e2e complète en local (la CI la fait)                              |
| Postgres jetable : `docker run --name <tmp> -p 127.0.0.1:<port>:5432 postgres:16-alpine` puis `TEST_DATABASE_URL=… npx vitest run test/<x>.integration.test.ts` | verrous, concurrence, migrations (classe D) ; supprimer le conteneur après                                                                          | ne jamais réutiliser les conteneurs existants des autres chantiers          |
| Mémoire `~/.claude/projects/…/memory/`                                                                                                                          | faits durables et retours d'Antoni (index `MEMORY.md` chargé à chaque session)                                                                      | ce que le dépôt ou REPRISE contiennent déjà                                 |
| Skill `update-config` (hooks)                                                                                                                                   | seulement si Antoni valide une automatisation (§ 15)                                                                                                |                                                                             |

Les autres connecteurs MCP présents (Figma, Gmail, Notion, Drive…) ne servent pas au développement de Raptoru.

## 7. Tests et CI

### 7.1 Local : ciblé

- Lancer les fichiers de test du module touché (`npx vitest run test/<fichier>`) et un e2e du parcours modifié.
- Les « suites globales pertinentes » que `CLAUDE.md` exige avant livraison sont celles de la CI de `main` : elle
  précède tout déploiement (§ 7.3). Les relancer en local est un doublon, sauf raison précise.
- **Ne jamais lancer la suite complète Studio serveur sous Windows** : sous la charge, elle produit des dizaines
  de dépassements de temps qui ne sont pas des régressions (2 × 57 faux échecs le 15/11). Elle tourne en CI, sous Linux.
- Suite Core complète en local seulement pour la classe D, ou si l'on touche un module partagé (schémas, migrations,
  `lab-chat`).
  - `--no-file-parallelism` en cas de doute de charge.
  - Échecs connus sous charge (relancer le fichier seul) : crash de worker Windows `0xC0000409`, Studio `brb`,
    `alerts-twitch-chain`, `creepy`, flux du Jeu des mots.
- Tests d'intégration sur vrai Postgres (`TEST_DATABASE_URL`) : verrous, concurrence, migrations. Une nouvelle
  migration modifie le compte attendu dans **quatre** tests :
  - `migration-scopes.test.ts` ;
  - `migration-main-core.integration.test.ts` (deux endroits) ;
  - `sub-wheel-v2.integration.test.ts`.
- Ne jamais affaiblir ni désactiver un test pour passer au vert.
- Une instabilité d'environnement se relance seule, une fois. Si elle persiste, on la signale.

### 7.2 Avant chaque push (2 minutes, évite un cycle de CI de 15 minutes)

```bash
# depuis la racine du worktree (Prettier ne lit .prettierignore que depuis la racine)
git diff --name-only origin/main...HEAD; git diff --name-only   # fichiers modifiés
npx prettier --check <fichiers modifiés hors apps/twitch-extension/extension>
npx eslint <fichiers modifiés .ts/.js>
npx tsc --noEmit -p apps/<paquet>      # paquets touchés ; schémas recompilés d'abord
```

- Jamais de `prettier --write` sur un dossier ou un glob : il touche des fichiers non modifiés (fins de ligne) et
  reformate `apps/twitch-extension/extension/` (exclu volontairement).
- `prettier --check` sous Windows signale des fichiers non touchés à cause des CRLF : ne lire que la liste des fichiers modifiés.

### 7.3 CI : une seule barrière

- `scripts/delivery/ci-gate.mjs` n'accepte que la CI du **push du SHA exact sur `main`**. La CI de la PR ne compte jamais pour déployer.
- Classes A, B, C : **pas d'attente de la CI de la PR**. Préparer la branche (§ 7.2), ouvrir la PR pour la trace,
  la fusionner, puis attendre la seule CI de `main` (≈ 15–19 min, dont l'e2e ≈ 15 min).
  - Si `main` est rouge par ma faute : correction immédiate par un nouveau commit, jamais de déploiement.
- Classe D : attendre la CI de la PR avant de fusionner (`main` reste sûr pour les autres sessions).
- Un job en échec sans lien avec le changement (ex. e2e Music Hub) : lire le log, puis `gh run rerun <id> --failed`
  une fois, et le signaler dans le compte rendu.
- Une PR de documentation seule n'exécute que `quality` (≈ 2 min). Le déploiement accepte un commit de doc après un commit vert.

## 8. Parallélisme et attentes

- **En parallèle** :
  - lectures et recherches indépendantes, dans le même message ;
  - rédaction de la doc pendant la CI ;
  - workflow Studio et déploiement du Core, si la compatibilité le permet (§ 10).
- **Jamais en parallèle sur ce PC** : deux suites lourdes (Postgres/PGlite, Playwright, vitest complet), ni une suite et une pile e2e.
- **Une attente = une commande en arrière-plan.**
  - `gh run watch <id> --exit-status > /dev/null; gh run view <id> --json conclusion,jobs`
  - On est notifié à la fin, sans relancer de surveillant entre-temps.
- **Pendant la CI** : rédiger REPRISE et la doc du module, préparer le compte rendu, l'inventaire ou les vérifications de Production.
- Ne pas attendre ce dont l'action suivante n'a pas besoin.
- Nouveau worktree = `npm ci` (≈ 3 min) : réutiliser le worktree `agent`.
  - Ne relancer `npm ci` que si `package-lock.json` a changé.
  - Recompiler les schémas si `packages/schemas` a changé.

## 9. Décider seul

- **L'agent décide seul** :
  - fichiers à lire, outils, conception technique, tests ciblés ;
  - corrections locales mineures, découpage des commits, PR, contenu de la doc ;
  - choisir la classe et l'annoncer.
- **Selon le mandat**, et seulement les étapes qu'il nomme : fusion, déploiement du Core et du bot, publication de
  Studio, préparation de l'extension. La portée d'un GO est celle de `CLAUDE.md` (« explicit GO for that step »).
  En cas de doute sur une étape de Production, demander.
- **Toujours demander** :
  - décision métier non définie, action irréversible non couverte, risque majeur ;
  - écriture réelle sur Twitch, le Wallet, OBS, les variables ou les flags ;
  - installer Studio (c'est Antoni) ;
  - la ligne de validation d'un inventaire d'extension.
- Le périmètre ne s'élargit pas. Une idée annexe tient en une ligne dans le compte rendu ou dans la ROADMAP, jamais en code.

## 10. Protections de Production (incompressibles)

- **Déployer le Core** : `plan`, puis `deploy … --go`. Le script vérifie seul la CI de `main`, l'absence de live, la santé et le commit déployé.
- **Migration** : sauvegarde de moins de 60 min (Coolify « Backup now », voir `docs/BACKUPS.md`), puis `--migrations-approved`.
  - Migration additive et rejouable, avec une jumelle Lab et le rollback écrit en tête de fichier.
  - Une table absente du périmètre Production seul se protège (`to_regclass`).
- **Bot** : jamais redéployé avec le Core sans raison. Un champ de schéma ajouté qu'il ne lit pas n'est pas une raison.
- **Ordre Core → Studio** si Studio envoie un champ que l'ancien Core refuse (schémas stricts). Sinon, en parallèle.
  - Préférer un protocole tolérant : un champ nouveau optionnel côté Core.
- **Vérifier après le déploiement** en lecture seule : santé, données intactes, nouvelle route. Pas d'écriture de test en Production.
- **Interdits** : `git clean`, `reset --hard` ou `checkout .` dans le checkout principal ; aucun secret dans le dépôt
  (public) ni dans un compte rendu ; jamais SAMMI.

## 11. Livraison et compte rendu

**Séquence type (A, B, C)** :

1. Branche depuis `origin/main` dans le worktree `agent`.
2. Mesure ou reproduction, correction, tests ciblés.
3. Doc dans le même commit : doc du module et `REPRISE.md` (versions prévisibles : Studio = patch suivant ; Core = fusion de la PR #N).
4. § 7.2, puis commit et push. PR, fusion immédiate (classe D : après la CI de la PR).
5. CI de `main` en arrière-plan. Pendant ce temps : mémoire, compte rendu, inventaire.
6. Au vert : sauvegarde si migration ; déploiement du Core, et workflow Studio en parallèle si compatible.
7. Vérification Production en lecture seule.

**Compte rendu** :

- Le format demandé par Antoni prime. Sinon :
  - ce qui marche, ce qui reste ;
  - les tests (vraie interface, automatisés, non vérifiable ici) ;
  - les versions livrées et les gestes d'Antoni.
- Pas d'historique de commandes. Les SHA exacts suffisent.

## 12. Continuité entre sessions

| Où                                           | Quoi                                                     | Mise à jour                         |
| -------------------------------------------- | -------------------------------------------------------- | ----------------------------------- |
| `CLAUDE.md` (chargé à chaque session)        | règles permanentes, résumé de cette méthode              | rare, sur décision                  |
| `docs/AGENT_WORKFLOW.md` (ce guide)          | comment travailler, outils, pièges                       | à chaque leçon nouvelle (§ 15)      |
| `docs/REPRISE.md`                            | état, versions, gestes en attente, prochain chantier     | à chaque livraison, dans la même PR |
| `docs/<MODULE>.md`, `COMMANDS_V2_STATUS.md`… | règles et état d'un module                               | avec le code du module              |
| Mémoire `MEMORY.md` + fichiers               | faits durables non dérivables du dépôt, retours d'Antoni | quand un fait change                |

- Le `CLAUDE.md` chargé est la **copie de travail du checkout principal** (`Documents\Raptoru 2.0`).
  - Ce checkout est en retard sur `main` et ne se met pas à jour par Git (données de Studio).
  - Constat du 15/11 : la copie chargée n'a ni la règle « dépôt public » ni celle du 08/11.
  - L'agent ne réécrit pas lui-même ses instructions chargées : il le signale. La resynchronisation est un geste
    d'Antoni (§ 15).
- Ne pas refaire une analyse que REPRISE ou la doc d'un module consigne, sauf si le code a changé depuis.
- Les scripts du dossier `scratchpad` d'une session sont perdus à la session suivante. Une procédure utile va dans la doc, ou dans `scripts/` sur décision.

## 13. Erreurs déjà payées (ne pas refaire)

| Erreur                                                                                                          | Coût observé                                                        | Règle                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Attendre la CI de la PR **puis** celle de `main`                                                                | + 19 min (latence), + 30 min (V2.1)                                 | § 7.3 : un seul cycle pour A, B et C                                                           |
| Suite complète Studio sous Windows                                                                              | 2 × 57 faux échecs, ≈ 15 min                                        | § 7.1 : jamais en local                                                                        |
| Commit sans Prettier → `quality` rouge en CI                                                                    | + 1 cycle de CI (V2.1)                                              | § 7.2 avant chaque push                                                                        |
| `prettier --write` lancé depuis un sous-dossier ou sur un glob                                                  | fichier d'extension validé reformaté, fichiers sans rapport touchés | § 7.2 : racine, liste exacte                                                                   |
| Scripts Python inline dans un heredoc Bash (antislashes)                                                        | regex corrompues, « unexpected EOF »                                | `Edit` pour un remplacement exact ; script écrit avec `Write` dans le scratchpad, puis exécuté |
| Plusieurs surveillants de la même CI, boucles `sleep` plafonnées à 10 min                                       | bruit, tours perdus                                                 | § 8 : une commande `gh run watch` en arrière-plan                                              |
| e2e qui suppose l'état laissé par un autre spec (`!e2etest` désactivé avant)                                    | 2 relances                                                          | un spec crée ses propres données et ne suppose rien d'autre                                    |
| e2e : appel direct au mauvais Core (le JSON de la pile pointe un shim Lab ; le Core principal est sur port + 3) | 1 relance                                                           | lire `e2e/core-lab-stack.ts` avant d'appeler une API directe                                   |
| Port aléatoire du shim refusé par `fetch` (« bad port »)                                                        | 1 relance                                                           | relancer une fois ; amélioration proposée § 15                                                 |
| Mesurer avec l'intervalle de la pile de test (500 ms) au lieu de celui de Production (2 s)                      | mesure trompeuse                                                    | § 4 : paramètres de Production                                                                 |
| Coder avant de lire les données du « bug »                                                                      | évité de justesse (Streamer)                                        | § 4 : données réelles d'abord                                                                  |
| Migration : comptes attendus oubliés dans les tests d'intégration                                               | 1 tour Postgres de plus                                             | § 7.1 : les quatre tests à mettre à jour                                                       |
| Nouveau worktree à chaque chantier                                                                              | `npm ci` ≈ 3 min + schémas à compiler                               | § 8 : worktree `agent`                                                                         |
| Livraison Studio séquentielle derrière le Core alors que compatible                                             | ≈ 7 min                                                             | § 10 : en parallèle si le protocole le permet                                                  |
| PR de doc séparée après la livraison                                                                            | 1 cycle `quality` + fusion                                          | § 11 : la doc dans la même PR                                                                  |

## 14. Checklist

- [ ] Classe annoncée (A, B, C, D) et périmètre du mandat relu (enquête, correction ou livraison).
- [ ] Cause mesurée ou reproduite, avec les données réelles en lecture seule si c'est un « bug ».
- [ ] Changement minimal ; tests ciblés verts ; e2e du parcours si l'interface ou la chaîne change.
- [ ] Prettier, ESLint et typecheck sur les fichiers modifiés ; schémas recompilés si touchés.
- [ ] Doc du module et REPRISE dans la même PR.
- [ ] Une seule attente de CI (`main`), en arrière-plan ; doc et compte rendu pendant ce temps.
- [ ] Déploiement selon le mandat (plan → go ; sauvegarde si migration) ; Studio en parallèle si compatible.
- [ ] Vérification Production en lecture seule ; mémoire mise à jour si un fait durable change.
- [ ] Compte rendu au format demandé ; ligne de suivi ajoutée (§ 15).

## 15. Amélioration continue

**Suivi léger.** Ajouter une ligne par livraison, avec les durées lues sur l'horodatage de la session :
1re correction fonctionnelle, livraison, nombre de cycles de CI, relances, suites complètes locales, ajouts hors périmètre.

| Date  | Demande                                                     | Classe | 1re correction      | Livraison | Cycles CI                         | Relances            | Suites complètes locales   | Hors périmètre                 |
| ----- | ----------------------------------------------------------- | ------ | ------------------- | --------- | --------------------------------- | ------------------- | -------------------------- | ------------------------------ |
| 15/11 | Latence des sons de commandes (référence)                   | B      | 0 h 07              | 1 h 33    | 3 (PR, `main`, relance e2e)       | 2                   | 3 (Core ciblé, Studio × 2) | 0                              |
| 15/11 | Commandes V2.1 : rôles, expressions, délégation (référence) | C      | ≈ 0 h 53 (e2e vert) | 2 h 16    | 3 (PR, PR après Prettier, `main`) | 5 (e2e, migrations) | 2 (Core, Studio) + e2e     | 1 mineur (blocage « partout ») |

- **Objectif mesurable** : sur les cinq prochaines livraisons de classe A ou B, au plus un cycle de CI hors
  instabilité, et aucune suite complète locale.
  - Pour la latence, la séquence du § 11 aurait donné environ 35 à 50 min au lieu de 1 h 33 :
    1 h 33 − 19 min (CI de la PR) − 15 min (suites locales) − 3 min (PR de doc) − 7 min (Studio en série).
  - Ne pas viser un chiffre fixe ; comparer à ces deux lignes.
- **Leçon nouvelle** : ajouter une ligne au § 13, dans la même PR que la livraison.

**Mises à jour de règles proposées (à décider par Antoni ; l'agent ne modifie pas ses propres règles) :**

1. **`CLAUDE.md` chargé en retard sur `main`.** Le resynchroniser, avec une commande qui n'écrit qu'un seul fichier,
   sans aucun checkout :
   `git -C "C:\Users\Antoni\Documents\Raptoru 2.0" show origin/main:CLAUDE.md > "C:\Users\Antoni\Documents\Raptoru 2.0\CLAUDE.md"`
   (dans Claude Code : préfixer de `!`).
2. **`CLAUDE.md` « Before delivery: relevant global suites ».** Préciser que ce sont les suites de la CI de `main`,
   qui précède tout déploiement, et que la suite complète Studio n'est pas fiable sous Windows.
   Le guide l'applique déjà ainsi (§ 7) : aucune vérification n'est supprimée, elle tourne une fois, en CI.
3. **`CLAUDE.md` « Raptoru Studio releases ».** Mentionner le workflow GitHub « Studio — construire / publier »,
   utilisé en pratique, à côté de `npm run studio:release`.
4. **Portée d'un GO.** Si Antoni le souhaite, écrire dans `CLAUDE.md` qu'un mandat « livrer selon la procédure
   habituelle » couvre la fusion, le déploiement du Core (migration annoncée, après sauvegarde) et la publication de Studio.
5. **Effort des sous-agents.** S'il le souhaite, l'autoriser dans `CLAUDE.md` : `Explore` en effort bas.

**Améliorations proposées, non appliquées, à décider par Antoni :**

- Corriger l'instabilité de l'e2e Music Hub en CI (un relancement de 15 min le 15/11).
- Corriger le « bad port » du shim de `e2e/core-lab-stack.ts`.
- Versionner dans `scripts/ops/` deux scripts restés dans le scratchpad (sans secret, ils lisent les jetons sur le disque) :
  - la sauvegarde Coolify immédiate ;
  - la lecture du cockpit de Production avec l'installation de Studio.
- Hook optionnel `PostToolUse` lançant Prettier sur le fichier modifié (skill `update-config`), si le § 7.2 ne suffit pas.

## 16. Modèle et effort de réflexion

- **Constat.** Sur les deux chantiers mesurés, le développement utile a pris environ 10 % (latence) à 35 % (V2.1) du temps.
  Le reste est de l'attente : CI, suites, publication. Baisser l'effort de réflexion fait gagner moins que le § 7.3,
  mais allège chaque tour sur les étapes mécaniques.
- **Recommandation** (réglée par Antoni ; l'agent ne change pas son propre modèle) :
  - A et B : effort moyen. Le mode rapide (`/fast`) convient à la classe A.
  - C : effort élevé pour la conception, la même session suffit pour l'exécution.
  - D : effort élevé ; maximal seulement sur demande, ou pour un problème de concurrence ou de migration difficile.
  - Le nom exact du réglage d'effort dans Claude Code est à vérifier par Antoni (`/model`, `/config`) : je ne peux pas le contrôler d'ici.
- **Sous-agents.**
  - `Explore` en `model: haiku` ou `sonnet` pour les balayages.
  - Relecture indépendante (classe D) en `sonnet`.
  - Jamais de sous-agent pour moins de 5 appels d'outils.
  - Leur niveau d'effort ne se règle que si Antoni le demande (dans `CLAUDE.md` ou la demande) : proposition au § 15.
