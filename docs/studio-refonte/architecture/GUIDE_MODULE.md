# Créer un module sur le socle

> Vérifié contre le code de `feat/studio-ux` (HEAD `3099c10`) le 07/11/2026. Preuve rejouée : § « Preuve rejouable ».

## En 5 étapes

`<id>` s'écrit en `snake_case` (`^[a-z][a-z0-9_]{1,40}$`) ; les **fichiers** et la **page Studio** prennent sa forme
`kebab-case` (`minuteur_de_scene` → `minuteur-de-scene.ts`, `?p=minuteur-de-scene`).

1. **Squelette** : depuis la racine `npm run module:new -w @raptoru/core-api -- <id> [admin|paid]` (depuis
   `apps/core-api` : `npm run module:new -- <id> [admin|paid]`).
   - Le script (`core-api/scripts/new-module.mjs`) écrit `core-api/src/modules/<id-kebab>.ts` et
     `core-api/test/module-<id-kebab>.test.ts`.
   - Profil `admin` : un réglage, une action Studio, un état. Profil `paid` : un prix, une action viewer payante, une
     politique de modération.
   - Le module est **Lab uniquement** (`labOnly: true`) **et coupé** (interrupteur du socle à 0 par défaut).
   - Le script refuse un identifiant mal formé, n'écrase aucun fichier existant, ne touche à aucun fichier central et
     affiche la ligne restante.
2. **Logique propre** : remplir `run`, `status`, `viewerState` (et `chat` / `tick` si besoin), remplacer les `TODO`.
   Tout le reste vient de l'hôte :
   - paiement, idempotence ;
   - live, pause, blocages ;
   - journal, remboursement ;
   - routes, réglages, écran.
3. **Une ligne** dans le tableau `MODULES` de `core-api/src/modules/index.ts` (plus son `import`). Les deux Cores
   construisent leur hôte depuis ce tableau ; `checkModule` refuse le démarrage si la déclaration ment.
4. **Studio suit seul** (aucune ligne à écrire). Au chargement, Studio lit `/api/modules` (relais vers le catalogue du
   Core) et `addHostModulePages` (`studio/web/src/shell/registry.ts`) crée la page. Le module obtient alors :
   - sa page générique `?p=<id-kebab>` (`studio/web/src/module-host.ts` : état, réglages, actions, activité, remboursement) ;
   - sa tuile dans **Modules**, groupe « Nouveaux modules », avec son état réel (`pages/catalog.ts` + `pageStates` de
     `module-states.ts` : coupé = « Fermé », `ready` = « Prêt », `waiting` = « En attente », sinon « Inconnu ») ;
   - sa place dans la palette Ctrl+K (`searchPages`) et les favoris ;
   - sa ligne dans **Système › Services**, carte « Modules du socle » (`studio/server/src/control-center/modules.ts`), et
     dans « À surveiller » de la Régie s'il demande un regard.

   Il n'apparaît **pas** dans les portes du Laboratoire (`pages/lab-doors.ts`, liste fixe) : on l'atteint par la porte
   « Modules du socle ». Une entrée dans `shell/registry.ts` n'est utile que pour lui donner un autre groupe, une teinte
   ou son propre écran.

5. **Vue viewer** (seulement si `viewer`) :
   - un fichier `twitch-extension/extension/shared/<id-kebab>.js` qui appelle `registerViewerModule('<id>', fabrique)` ;
   - une ligne `import './<id-kebab>.js'` dans `shared/ui.js` ;
   - aucune feuille de style si la vue réutilise les classes `rp-*` (cas du Coffre mystère) ; sinon un fichier CSS et une
     ligne `<link>` dans **chacune** des trois pages `mobile.html`, `panel.html`, `video_component.html`.

   Voir `GUIDE_EXTENSION.md`.

## Preuve rejouable (07/11/2026)

Tests ciblés, tous verts à HEAD :

| Commande (depuis le dossier du paquet)                                                                                                                                                                                                 | Résultat                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `apps/core-api` : `npx vitest run test/modules-host.test.ts test/modules-chat.test.ts test/modules-robustness.test.ts test/module-settings.test.ts test/caution-module.test.ts test/votekick-module.test.ts test/module-stats.test.ts` | 7 fichiers, 28 tests                  |
| `apps/core-api` : `TEST_DATABASE_URL=postgres://postgres:uxtest@127.0.0.1:55499/raptoru_ux_test npx vitest run test/modules-host.integration.test.ts`                                                                                  | 2 tests (PostgreSQL réel, deux Cores) |
| `apps/studio/server` : `npx vitest run test/module-states.test.ts test/modules-socle.test.ts test/modules-lab-chain.test.ts test/prod-modules.test.ts test/control-center.test.ts`                                                     | 5 fichiers, 49 tests                  |
| `apps/twitch-extension` : `npx vitest run test/module-host.test.js`                                                                                                                                                                    | 10 tests                              |

Exercice du générateur, **dans une copie hors dépôt** (rien n'a été écrit dans le dépôt) : `new-module.mjs` copié dans
un dossier temporaire, `minuteur_de_scene admin` et `essai_payant paid` générés, puis un script `tsx` a branché les deux
squelettes **non modifiés** sur le vrai `ModuleHost` (`[...MODULES, nouveau]`, l'équivalent exact de la ligne d'`index.ts`)
et sur les vraies fonctions de Studio :

1. `checkModule` : aucune erreur pour les deux squelettes ;
2. catalogue du Core : le module est listé, état `unknown` (jamais « prêt » par défaut), réglage `minuteur_de_scene.valeur` ;
3. action Studio `faire` : exécutée et journalisée ;
4. action payante : 1 000 → 900 Jetons, la même clé rejouée rend `replayed: true` sans second débit ;
5. Studio : page `/?p=minuteur-de-scene`, groupe « Nouveaux modules », trouvée par Ctrl+K ;
6. état du catalogue Studio : « Inconnu » ;
7. carte « Modules du socle » : une ligne par nouveau module.

Le second lancement du générateur sur le même identifiant refuse d'écrire ; un identifiant `Bad-Id` est refusé.

**Parcours navigateur** (non rejoué ici, il démarre une pile) : `e2e/modularity.e2e.ts`. Lancement :
`npm run build -w @raptoru/studio-web` (la pile sert `apps/studio/web/dist`), puis dans `apps/studio/server`
`npx playwright test e2e/modularity.e2e.ts` (une fois : `npx playwright install chromium`). Il démarre deux piles
`e2e/core-lab-stack.ts` (Core principal en environnement Lab, base en mémoire) sur les ports 4399 et 4389, qui doivent être
libres. Aucun Twitch, aucun Docker, aucune donnée réelle.

Rien de tout cela n'est une validation : c'est Antoni qui valide dans le vrai Lab (`npm run studio:lab`).

## Ce que le module ne doit jamais faire

- Débiter, rembourser ou créditer lui-même : `ctx.settle` et l'hôte s'en chargent (débit d'origine, une fois).
- Lire l'identité du viewer dans un corps de requête.
- Déclarer une capacité qu'il n'implémente pas : `checkModule` refuse le démarrage.
- Répondre « prêt » sur le seul interrupteur : dire ce qui marche vraiment (dépendances, live, file).
- Régler des chances ou des tables de gains depuis Studio (décision H10).

## Questions à trancher avant d'écrire

Ce sont les questions de modération et les questions métier (`GUIDE_MODERATION.md`) :

- Qui voit le journal ? Peut-on rembourser ?
- Hors live, que se passe-t-il ?
- Que montre le lecteur OBS, et que se passe-t-il s'il échoue ?

Une question métier non tranchée bloque le passage en Production, pas le Lab.

## Passage en Production

1. Retirer `labOnly` (décision d'Antoni).
2. Appliquer `20261121180000_module_activity.sql` si le module a un journal.
3. Si le module répond dans le chat (`chat`) : `20261121190000_cmd_steps_module_origin_lab.sql` n'existe qu'en Lab ; il faut
   d'abord écrire et appliquer son jumeau de Production (origine `module:<id>` des réponses).
4. Activer l'interrupteur depuis Studio.

Aucune de ces étapes ne se fait sans GO.

## Module historique (démonstration C)

On ne le réécrit pas :

- une définition `modules/<id>.ts` déclare ses réglages et son état, et lit **son** interrupteur (`enabled`) ;
- son service reçoit une fonction de lecture des réglages, dont les défauts sont les valeurs d'avant.

Voir `core-api/src/modules/mini-games.ts`.

## Une commande dans le chat

Déclarer `chat(ctx)` et `chatWords: ['mot']`, avec la capacité `chat`. Le socle se charge du reste :

- il réserve ces mots (Commandes V2 les refuse) ;
- il coupe la lecture quand le module est coupé ;
- il isole une erreur du module.

Répondre avec ``ctx.say(q, ch, { key: `msg:${msg.message_id}`, text })`` : réponse idempotente, origine `module:<id>`, sans
migration. Modèle : `modules/objectif-soiree.ts` (« !objectif »).

## Un lecteur OBS

Le module rend `{ status: 'queued' }`. Son exécuteur dans Studio fait la suite :

1. il réserve `POST /v1/lab/modules/<ch>/<id>/claim { player }` (bail de 30 s) ;
2. il joue ;
3. il rend compte avec `POST …/<id>/report { activity_id, status }`.

Un échec ou une expiration rembourse le débit d'origine, une fois. Il reste à écrire, par module : la page d'overlay et
l'exécuteur Studio.

## Brancher un module historique (adaptateur)

Modèles : `modules/votekick.ts`, `caution.ts`, `mini-games.ts`, `status-adapters.ts`.

1. Une fonction `xModule(service, { … })` déclare :
   - les réglages, avec les valeurs d'aujourd'hui en défaut ;
   - `enabled()`, qui lit **son** interrupteur ;
   - `status()`, qui lit ce qui marche vraiment.
2. Le service reçoit une fonction de lecture des réglages (champ public, valeurs historiques par défaut). Il la lit dans
   **sa** transaction.
3. `modules.add(xModule(service))` dans `app.ts` (et `lab-core.ts` tant que l'ancien Lab existe).
4. Écrire la matrice de parité dans `MIGRATIONS.md`, puis les tests : défauts identiques, réglage appliqué, état.
