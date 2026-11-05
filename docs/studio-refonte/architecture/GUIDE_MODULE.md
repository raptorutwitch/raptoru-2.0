# Créer un module sur le socle

## En 5 étapes

1. **Squelette** : `npm run module:new -w @raptoru/core-api -- <id> [admin|paid]`.
   - Le script écrit `core-api/src/modules/<id>.ts` et `core-api/test/module-<id>.test.ts`.
   - Le module est **Lab uniquement et coupé**.
   - Le script n'écrase rien, ne touche à aucun fichier central et affiche les deux lignes restantes.
2. **Logique propre** : remplir `run`, `status`, `viewerState` (et `chat` / `tick` si besoin). Tout le reste vient de
   l'hôte :
   - paiement, idempotence ;
   - live, pause, blocages ;
   - journal, remboursement ;
   - routes, réglages, écran.
3. **Une ligne** dans `core-api/src/modules/index.ts`.
4. **Une page** dans `studio/web/src/shell/registry.ts` : `{ view: 'modules', anchor: '<id>', … }`. Un test vérifie
   que chaque module a sa page.
5. **Vue viewer** (seulement si `viewer`) :
   - un fichier `twitch-extension/extension/shared/<id>.js` qui appelle `registerViewerModule('<id>', fabrique)` ;
   - une ligne `import './<id>.js'` dans `shared/ui.js`.

   Voir `GUIDE_EXTENSION.md`.

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
3. Activer l'interrupteur depuis Studio.

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
3. `modules.add(xModule(service))` dans les deux Cores (`app.ts`, `lab-core.ts`).
4. Écrire la matrice de parité dans `MIGRATIONS.md`, puis les tests : défauts identiques, réglage appliqué, état.
