# Extension Twitch : modules du socle, et refaire un onglet

> Vérifié contre le code de `feat/studio-ux` (HEAD `3099c10`) le 07/11/2026. Les numéros de ligne sont ceux de ce jour :
> ils bougent, les noms de fonctions restent.

## Le chemin d'une requête

- **Production** : extension → Core `/v1/ext/*` → `core-api/src/ext/ext-facade.ts`.
- **Lab par défaut** (Core principal, `CORE_ENVIRONMENT=lab`) : extension → Studio `/ext-lab/api/*` → relais
  `studio/server/src/extension-lab/core-frontier.ts` → **le même** `/v1/ext` du Core → `ext-facade.ts`. Le Lab teste donc la
  vraie façade de Production.
- **Ancien Lab** (`npm run studio:legacy`, `E2E_STACK=legacy`) : extension → EBS du Lab
  `studio/server/src/extension-lab/lab-ebs.ts`. Tant qu'il existe, une route qui n'est pas du socle s'y écrit une seconde fois.

## Une porte, deux serveurs (modules du socle)

`packages/schemas/src/module-facade.ts` est utilisée **telle quelle** par :
- la façade de Production (`core-api/src/ext/ext-facade.ts`) ;
- l'EBS de l'ancien Lab (`studio/server/src/extension-lab/lab-ebs.ts`).

Un module du socle n'est donc jamais écrit deux fois (friction E1). Elle reçoit l'identité vérifiée et la clé
d'idempotence du client ; elle ne décide rien.

| Requête | Effet |
|---|---|
| `GET /modules/v3` | modules à actions viewer : identité, interrupteur, actions (prix, règle de live), politique de modération |
| `GET /modules/v3/<id>/state` | état pour CE viewer : disponibilité et raison, prix du serveur, état propre, historique récent |
| `POST /modules/v3/<id>/<action>` | `identity_required` sans identité, `idempotency_key_required` sans clé |
| `GET /modules/v3/moderation` | équipe : modules dont la politique est visible, coupés compris |
| `GET /modules/v3/moderation/<id>/activity` | équipe : journal de ce module |
| `POST /modules/v3/moderation/refund { activity_id, reason }` | équipe ; le Core revérifie la permission, refuse `self_refund` et audite |

## Côté client — `twitch-extension/extension/shared/`

- `module-registry.js` : **le seul registre**, trois façons d'y entrer (voir plus bas). Pour un module du socle,
  `registerViewerModule(id, fabrique, { icon })` : le Hub le montre **seulement si le serveur le liste ET si cette version le
  connaît** (négociation, friction E4) :
  - Core ancien sans la route → aucun module ;
  - module inconnu de l'extension → pas affiché (jamais d'écran vide).

  La liste est relue au plus toutes les 30 s.
- `purchase.js` : `createPurchaseButton({ document, run, onResult })` gère l'achat :
  - deux touches (prix, puis confirmation) ;
  - jamais deux envois en parallèle ;
  - la **clé vit le temps de l'intention** : réutilisée après un délai dépassé ou une coupure réseau, renouvelée après
    un succès ou un refus définitif (friction E3) ;
  - `update({ label, price, available, reason })` redessine depuis l'état du serveur : un achat que le serveur ne peut
    pas honorer est désactivé, avec sa raison en mots.
- `module-moderation.js` : panneau générique ajouté par l'hôte sous tout module du socle dont la politique est visible,
  pour l'équipe seulement. Il affiche le journal et propose « Rembourser » avec un motif obligatoire.
- `api.js` : `moduleCatalog`, `moduleState`, `moduleAct` (envoie le prix confirmé), `moduleModerationList`,
  `moduleModerationActivity`, `moduleModerationRefund`.

## Écrire la vue d'un module du socle

Prendre `shared/coffre-mystere.js` comme modèle (68 lignes) :
- la fabrique reçoit `{ document, client, module }` et rend `{ node, start(), destroy() }` (`attached()` facultatif) ;
- son seul contenu propre : son texte et son affichage ;
- ajouter une ligne `import './<id-kebab>.js'` dans `ui.js` ;
- `ui.js` ne reçoit **aucune** branche, constante ou garde par module.

## Comment `ui.js` monte un onglet (cycle de vie réel)

Trois entrées dans `module-registry.js`, un seul emplacement dans `ui.js` (`hostView`, `hostViewId`, `hostVariant`) :

| Entrée | Pour quoi | Qui décide qu'il apparaît | Exemples |
|---|---|---|---|
| `registerViewerModule(id, fabrique)` | module du socle | le catalogue `/modules/v3` | Coffre mystère |
| `registerSessionModule({ id, card, available, view, … })` | onglet offert par la session, sans module historique | `available({ state, client })`, lu dans l'état de session | Commandes, Roue du Sub, Événements |
| `registerModuleVariant({ id, match, view, rendered?, onState?, … })` | **un autre écran pour un module que la session liste déjà** | `match({ module, state, client })` | TTS V2 / V1, Tombola V2 / V1, Soundboard, Bonk, modération V2 / V1 |

Ordre suivi par `ui.js` :
1. Hub : modules de la session, puis `sessionModules()` disponibles, puis `hostModules()` (`ui.js` ≈ 1323-1337).
2. Ouverture : `sessionModule(id)` sinon `moduleVariant(env)` (la **première** variante enregistrée dont `match` est vrai),
   sinon la vue du socle (`ui.js` ≈ 1511-1524). La vue est créée **une fois** tant que l'onglet reste ouvert, `start()` est
   appelé, puis `rendered(view, ctx)` à chaque dessin.
3. Nouvel état de session pendant que l'onglet est ouvert : `onState(view, next, prev, ctx)` ; `true` = la vue a absorbé
   l'état, l'hôte ne redessine pas (`ui.js` ≈ 516).
4. Sortie (`navigateTo`, ou module retiré du Hub) : `destroy()`, plus rien ne lit le serveur (`ui.js` ≈ 533-545, 1340).

`ctx.host` donne ce que `ui.js` passait à la main (`home`, `refresh`, `payment`, `walletMethods`, `restrictionChips`,
`memory`, `run`, `errorReason`, `notifyError`…) : voir `CONTRATS.md` § 10 à 13.

## Comment TTS V2 et Tombola V2 ont remplacé leur V1

| Commit | Ce qui a bougé |
|---|---|
| `bcfc7ee`, `0e90f13` | les écrans V2 arrivent (encore dessinés depuis `ui.js`) |
| `50e8601` (05/11) | TTS V2 et Tombola V2 sortent de `ui.js` : chacun devient une variante dans son fichier |
| `6e0e4ae` | TTS V1 devient une variante dans `tts-v1.js` ; E2E de parité V1 en mode démo (`e2e/v1-parity.e2e.ts`) |
| `2ad1bb1` | Tombola V1 devient une variante dans `tombola-v1.js` (`ui.js` −495 lignes) |
| `b27da6e`, `9443ac1` | modération V1 en variante ; le porte-monnaie d'en-tête lit la monnaie **déclarée** par la variante (`wallet`) |

Le mécanisme, identique pour les deux :
- le fichier V2 exporte son prédicat (`ttsV2Applies`, `tombolaV2Applies`) et s'enregistre avec `match: prédicat` ;
- le fichier V1 importe ce prédicat et s'enregistre **après**, avec `match: (env) => !prédicat(env)` : jamais deux écrans
  pour une même interaction, jamais aucun ;
- `ui.js` importe le V2 **avant** le V1 (`ui.js` lignes 29-30 et 40-42) ;
- le prédicat lit **un signal du serveur** et la capacité du client :
  - TTS : `module.tts_v2` non nul et `client.ttsBuy` présent. Le Core met `tts_v2` dès qu'il lit la configuration TTS
    (`ext-facade.ts` ≈ 468-478 et 504) : sans elle, l'extension retombe seule sur V1 ;
  - Tombola : `module.raffle_v2 === true` et `client.raffleState` présent. La façade du Core l'écrit **toujours**
    (`ext-facade.ts` ≈ 543) : sur le Core actuel, V1 n'est plus atteignable sans changer le Core (seul l'ancien Lab peut
    encore la servir).

## Recette : refaire un onglet sans tout reconstruire

Cas visé : un onglet existant (exemple : Soundboard) reçoit un nouvel écran ; l'ancien reste disponible pour revenir en
arrière. Même chemin que TTS V2 et Tombola V2.

**1. Fichiers à créer** (rien d'autre n'est à écrire dans l'extension)
- `shared/<onglet>-v2.js` : `create<Onglet>V2View({ document, client, … })` → `{ node, update(), destroy() }`,
  l'export `<onglet>V2Applies(env)`, et l'appel `registerModuleVariant({ id: '<id du module de session>', match, view,
  rendered, onState?, intro?, ownHeader?, bodyData?, wallet? })` ;
- `<onglet>-v2.css` si nécessaire (préfixe propre, pas d'ajout dans `base.css`) ;
- un test unitaire `twitch-extension/test/<onglet>-v2.test.js` (modèle : bloc « module variants » de
  `test/module-host.test.js`) et une spec `apps/studio/server/e2e/<onglet>-v2.e2e.ts`.

**2. Le point de raccordement unique** : une ligne `import './<onglet>-v2.js';` dans `shared/ui.js`, **avant** l'import
de l'ancien écran. Plus, s'il y a une feuille de style, une ligne `<link>` dans chacune des trois pages HTML (`mobile.html`,
`panel.html`, `video_component.html`) : à vérifier une par une, `panel.html` n'a déjà pas `commands-v2.css`.

**3. Garder l'ancien écran pour revenir en arrière**
- Si l'ancien écran est encore dessiné par `ui.js` : l'extraire d'abord, **sans changer son UX**, dans
  `shared/<onglet>-v1.js` avec `match: (env) => !<onglet>V2Applies(env)` (comme `6e0e4ae`, `2ad1bb1`), et prouver la parité
  par un E2E avant de commencer le V2. Soundboard et Bonk le sont déjà (`soundboard-view.js`, `bonk-view.js`).
- Le prédicat lit un signal **décidé par le Core** dans l'état de session (comme `tts_v2`), jamais un choix du client.
  Revenir en arrière = le Core cesse d'envoyer ce signal ; l'extension, sans nouvelle version, remontre l'ancien écran.
  Qui pilote ce signal (réglage Studio, variable du Core) est une décision d'Antoni : ne pas reprendre le cas Tombola, où le
  signal est figé à `true`.
- Ne supprimer l'ancien fichier qu'après validation d'Antoni en réel.

**4. Le contrat du Core à réutiliser**
- Lire les routes que l'ancien écran utilise déjà (`api.js` : `ttsState` / `ttsBuy`, `raffleState` / `joinRaffle`,
  `spendTokens` / `useRedemption`…) : un nouvel écran n'est pas une nouvelle règle métier.
- Afficher les valeurs du serveur (prix, disponibilité et raison, temps d'attente, droits) ; ne rien recalculer (voir
  « Règles recopiées » ci-dessous).
- Si une donnée manque vraiment : une méthode dans `api.js`, et côté Core un fichier `core-api/src/ext/<onglet>-ext.ts`
  appelé par **une** ligne dans `ext-facade.ts` (modèle : `sub-wheel-ext.ts`, une ligne
  `if (path.startsWith('/sub-wheel/'))`). Tant que l'ancien Lab existe, la même route dans `lab-ebs.ts`.
- Un achat envoie le prix confirmé quand la route l'accepte (`moduleAct`, `expected_price`) : `ttsBuy` ne l'envoie pas.

**5. Tester dans le Lab**
- Unitaires : `npx vitest run test/<onglet>-v2.test.js test/module-host.test.js` dans `apps/twitch-extension`
  (vérifier que les `match` V2 et V1 sont exactement complémentaires).
- Navigateur : spec E2E sur la pile `core-lab-stack.ts` (vraie façade du Core, données fictives), plus
  `e2e/lifecycle.e2e.ts` (un onglet fermé ne lit plus rien) et `e2e/v1-parity.e2e.ts` si l'ancien écran a été extrait.
- Réel : `npm run studio:lab`, Extension Lab, identités viewer et modérateur. **Validation par Antoni uniquement.**

## Obstacles honnêtes

- `ui.js` (1 642 lignes aujourd'hui, 6 206 à la décision ASTRA-P1-008) garde encore du code par module :
  styles du Hub `HUB_MODULE_STYLES` (≈ 116-124) ; en-tête Tombola et modération (`isRaffle`, `isModeration`, ≈ 1508-1583) ;
  état de la Tombola (≈ 528, 1187, 1413) ; libellé « TTS en pause » (≈ 1415) ; Soundboard dans `navigateTo` (≈ 550) ;
  Bonk (≈ 150, 329). Refaire l'en-tête de ces onglets oblige à toucher `ui.js` : extraire localement, à UX identique.
- Styles : `base.css` (16 477 lignes) est partagé par toutes les surfaces ; chaque nouvelle feuille demande trois `<link>`.
- `api.js` (735 lignes) est un client unique : une route = une méthode, plus une branche du mode démo (≈ 339-421) si
  l'écran doit tourner en mode démo.
- Hors socle, une route s'écrit dans `ext-facade.ts` (1 211 lignes) et, tant qu'il existe, dans `lab-ebs.ts` (2 469 lignes).
- L'état de session des onglets historiques est construit par la façade avec des constantes de présentation
  (`MODULE_PRESENTATION`, `ext-facade.ts` ≈ 105-143) : un nouvel écran qui veut une donnée en plus passe par là.

## Règles recopiées par l'extension (à ne pas reproduire)

Constat du 07/11 (aucun code modifié). Le Core revérifie toujours au moment de payer ; le risque est un écran qui
affiche autre chose que ce que le Core fera.

- `tts-v1.js` ≈ 60-74 : prix recalculé `base_price × price_multiplier` ; le Core vend au prix absolu du palier
  (`tts-lab/rules.ts`, `quote`) et ne publie pas `price_multiplier`. Aucun serveur n'envoie `tts_rules` : V1 affiche toujours
  la constante `token_cost: 7500` de la façade.
- `tts-v2.js` ≈ 118-133 : choix du palier et normalisation du texte recopiés du Core (`tierFor`, `normalizeMessage`) ; l'achat
  (`ttsBuy`) n'envoie pas le prix affiché, donc aucun refus `price_changed` si les deux copies divergent.
- `moderation-v2.js` ≈ 1320 : « remboursable » recalculé (pas en cours, pas la Tombola, pas déjà remboursé, débit non nul) ;
  même règle dans Studio (`studio/web/src/mod/mod.ts` ≈ 948). Le Core TTS publie son propre `refundable`, que ni l'une ni
  l'autre ne lit.
- `wallet-payment.js` ≈ 10-16 : le client décide que le TTS du Lab ne se paie pas en crédits.

## Modération (consolidation du 05/11)

- La console D4 (extension et Studio) a « Autres modules » : les mêmes panneaux qu'en dessous de chaque module du socle.
  Le motif se saisit dans un champ, pas une boîte `prompt`.
- Un module coupé n'est plus proposé aux viewers.
- L'achat envoie le prix confirmé (`expected_price`) : `price_changed` est refusé avant tout débit.
