# Frictions d'intégration — constats mesurés (05/11/2026)

Méthode : quatre investigations en lecture seule (Core, Studio, extension, historique documentaire), recoupées par des
vérifications directes dans le code. Chaque constat a sa preuve `fichier:ligne` dans le dépôt
(chemins relatifs à `apps/`). Statut : **ouvert**, **traité (commit)**, **atténué** (le nouveau socle l'évite pour les
nouveaux modules, l'existant n'est pas réécrit).

## Coût actuel d'un module « complet » (avant le socle)

| Surface | Fichiers touchés | Endroits modifiés | Dont logique métier |
|---|---|---|---|
| Core (prod + Lab) | 19-20 | ~30 | service, routes, schémas, migration |
| Studio | ~9 (page simple) à ~14 (Centre, Régie, préparation) | ~20 | la vue |
| Extension | 14-16 | ~15 | la vue viewer |
| Total pour une fonctionnalité transversale | **~45 fichiers** | **~65 endroits** | ~6 fichiers |

## Core

| # | Friction | Preuve | Statut |
|---|---|---|---|
| C1 | Deux assemblages du Core écrits à la main (`createCore` et le Core Lab), plus deux boucles de minuteries et deux répartiteurs HTTP ; **ils ont déjà divergé** (le Lab ne passe pas l'action Twitch aux points de chaîne ; Caution / Votekick / Spotify montés sans drapeau en Lab) | `core-api/src/app.ts:122-238`, `bonk-lab/lab-core.ts:120-276`, `ext/public-frontier.ts:155-253`, `bonk-lab/local-server.ts:44-89` | atténué (e780437) : l'hôte de modules est construit depuis une seule liste dans les deux Cores ; les modules historiques gardent leur double assemblage |
| C2 | Le même parcours payant recopié dans chaque module (pause globale, live, ligne, débit, message « Il te faut… », comptage des refus, boucle de remboursement) — au moins 6 copies | `chat-interactions/random-ban-chat.ts:65-160`, `fx-cam-chat.ts:88-180`, `caution/service.ts:427-850`, tts / sound / bonk services | atténué (e780437) : un seul parcours payant pour les modules du socle (`ModuleHost.viewer`) ; les 6 copies historiques restent |
| C3 | 51 classes d'erreur, dont 16 de même forme `(status, code)`, et 19 enveloppes `mapped()` quasi identiques, une par fichier de routes | `http/*-routes.ts`, `http/lab-moderation-routes.ts:44-86` | atténué : une erreur (`ModuleError`) et un `mapped()` pour tous les modules du socle ; l'existant reste |
| C4 | Identifiants de modules répétés dans ~12 endroits, dont des contraintes SQL qu'il faut élargir par migration (origines des réponses chat réécrites 4 fois ; états, blocages et cooldowns de modération limités à 3-4 modules ; types de mouvements du portefeuille Lab) | `lab-moderation/store.ts:7-15`, schémas `lab-moderation.ts:11-144`, migrations `20261005120000:39,49,62`, `20261007120000:55`, `cmd_steps_origin_check` ×4 | atténué : les modules du socle n'ont aucune énumération SQL ; réponses chat `module:<id>` autorisées une fois pour toutes (`0148b26`) ; les CHECK historiques restent |
| C5 | Modération câblée en dur sur TTS, Soundboard, Bonk, Tombola : chaîne de `if`, `USE_TABLE`, union SQL `INTERACTIONS`, énumérations. Les modules récents (Caution, Votekick, Spotify, Random Ban) n'y sont pas raccordés | `lab-moderation/service.ts:60-103, 579-588`, `store.ts:416` | atténué : modération générique des modules du socle, dans l'extension (sous le module et D4 › « Autres modules ») et dans la console D4 de Studio, une seule implémentation (`104acb7`, `d080506`) ; D4 garde ses 4 modules historiques |
| C6 | Chaque migration de production a un jumeau `_lab` et 5 listes / compteurs à tenir à jour (scopes, runtime local, script Lab, deux tests) | `db/migration-scopes.ts`, `studio/server/src/runtime/local-runtime.ts:32-90`, `studio/server/scripts/bonk-lab.mjs:53-114` | atténué : un test échoue si une liste oublie une migration (`migration-scopes.test.ts`) ; le socle n'ajoute qu'une paire de migrations pour tous les modules |
| C7 | L'idiome `production ? '/v1/studio/x' : '/v1/lab/x'` recopié dans 9 fichiers de routes | `http/caution-routes.ts:29` etc. | atténué : une seule route Lab par module du socle, servie au cockpit par `internalLabCall` |

## Studio

| # | Friction | Preuve | Statut |
|---|---|---|---|
| S1 | `createStudioServer` : 24 paramètres positionnels pouvant être nuls et une chaîne d'environ 30 `if` dont l'ordre compte ; les tests remplissent avec des `null` et un index magique | `studio/server/src/index.ts:391-650`, `test/twitch-connections-routing.test.ts:24` | traité (`f354ead`) : `createStudioServer(options)` nommées ; deux trous silencieux trouvés en navigateur (relais et `/api/lab` absents de la pile d'aperçu) corrigés |
| S2 | Relais recopiés (6 relais, 609 lignes) ; gestion d'erreurs, limites de corps et contrôle d'hôte divergents ; **trois relais (Progression, Boutique, Défis) ne contrôlent pas l'hôte** | `studio/server/src/*/relay.ts`, `index.ts:514-571` | traité (037a7db) : un relais pour tous les modules du socle ; **contrôle d'hôte ajouté** sur Progression, Boutique, Défis |
| S3 | Pas de module HTTP / échappement partagé côté web : 39 `esc`, 37 en-têtes, ~11 fonctions de requête | `studio/web/src/*` | atténué (037a7db) : `studio/web/src/http.ts` partagé ; les 39 copies historiques restent |
| S4 | ~17 listes de modules écrites à la main (registre ×4, `main.ts` ×2, shell ×5, Régie ×3, préparation ×2, signaux, fournisseurs, expressions régulières du Core) ; l'identifiant de vue déclaré 3 fois | `studio/web/src/shell/registry.ts:8-453` | atténué : un module du socle = une entrée de registre (vérifiée par test) ; listes historiques inchangées |
| S5 | Le Centre de contrôle n'est pas raccordable : 2 fournisseurs seulement ; « Prêt pour le live » et la Régie lisent les routes des modules à la main | `studio/server/src/control-center/model.ts`, `studio/web/src/readiness.ts` | traité pour les modules du socle (037a7db) : un fournisseur générique ; « Prêt pour le live » et la Régie lisent encore les modules historiques à la main |

## Extension Twitch

| # | Friction | Preuve | Statut |
|---|---|---|---|
| E1 | Deux implémentations du même contrat serveur : la façade de Production et l'EBS du Lab (2 431 lignes) avec des fichiers jumeaux ; aucun test ne vérifie qu'elles restent alignées | `core-api/src/ext/ext-facade.ts`, `studio/server/src/extension-lab/lab-ebs.ts`, `*-facade.ts` | traité pour les modules du socle (8a2d862) : `moduleFacade` partagée, testée sur les deux serveurs ; les modules historiques restent en double |
| E2 | `ui.js` (6 331 lignes) : chaîne de `if` de rendu, table `FORMS`, drapeaux par identifiant dispersés dans ~10 endroits ; pas de registre de modules | `twitch-extension/extension/shared/ui.js:5927-6272` | atténué : registre pour les modules du socle, les modules de session (`8a2f113`) et les **variantes avec mise à jour en direct** (`50e8601`, `2d9f7b2` : TTS V2, Tombola V2, D4) ; `ui.js` 6 361 → 6 214 lignes ; restent Soundboard, Bonk, TTS V1, Tombola V1, modération V1 |
| E3 | Aucun composant d'achat partagé : confirmation, clé et erreurs réimplémentées 4 fois ; la clé par défaut est **par clic**, pas par intention | `shared/api.js:492-556`, `events-shop.js:307`, `sub-wheel-ext.js:43` | traité pour les modules du socle (`purchase.js`, clé par intention) ; les 4 achats historiques gardent la clé par clic |
| E4 | Aucune négociation de capacités : disponibilité = drapeaux de session codés en dur, tests `typeof client.x`, `false` dans la façade ; un module inconnu affiche un écran vide | `ext-facade.ts:520-523`, `ui.js:1455-1466` | traité pour les modules du socle (liste du serveur ∩ modules connus) |
| E5 | Identifiants de modules répétés dans 5+ listes ; cartes d'erreurs réparties dans 6 fichiers, certaines sans repli | `ext-facade.ts:139`, `lab-ebs.ts:122`, `wallet-payment.js:6` | atténué : les codes d'erreur du socle ajoutés à `ERROR_LABELS` |

## Coût après le socle (mesuré, voir PREUVES.md)

Un module transversal (Studio + extension + Core + Jetons + modération + lecteur) = **2 fichiers propres + 3 lignes de
raccordement + ses tests** (démonstration B), contre ~45 fichiers / ~65 endroits avant.

## Ce qui est déjà bon et doit être réutilisé (ne pas réécrire)

- `EconomyPort` (`core-api/src/economy/economy.ts:100-228`) : débit, remboursement, mouvement, transfert, dans la
  transaction de l'appelant, avec clés idempotentes, sur le Wallet canonique et le portefeuille Lab.
- `liveForPaid` (règle H1), `ModuleSettings` (H10), `assertNotGloballyPaused`, `activeBlock`, `audit`, `access`.
- `LabChatModule` / `createChatGames` : une seule interface pour les modules du chat, assemblée une fois pour les deux Cores.
- `internalLabCall` et le relais cockpit : une route Lab est servie au Studio de Production sans duplication.
- Côté Studio, le registre de navigation (`PAGES`), `StatusProvider`, `mountSettingsPanel`.
- Côté extension, `call()`, `errorLabel`, `ui-primitives.js`, le modèle « vue autonome » (`events-shop.js`).
- Le classement des migrations en mode fail-closed (`selectMigrations`).
