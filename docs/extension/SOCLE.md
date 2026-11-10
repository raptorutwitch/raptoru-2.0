# Socle de l'extension (shell v2) — guide développeur

> L'équivalent, pour l'extension Twitch, du `DESIGN_SYSTEM.md` de Studio. Plan : [PLAN_REFONTE_EXTENSION_2026-11-08.md](PLAN_REFONTE_EXTENSION_2026-11-08.md).
> État du chantier : [EXTENSION_NEXT_EXECUTION_STATE.md](EXTENSION_NEXT_EXECUTION_STATE.md).

## 1. Deux shells, une seule extension

Chaque page (`video_component.html`, `panel.html`, `mobile.html`) charge le helper Twitch puis **`app/boot.js`**, qui choisit :

| Shell                                            | Quand                                                                                | Ce qui tourne                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `legacy` (défaut tant qu'Antoni n'a pas basculé) | toujours, sauf choix contraire                                                       | feuilles historiques `base/overlay/mobile.css` + `overlay.js` / `mobile.js` + `shared/ui.js`, **inchangés** (retour arrière) |
| `v2`                                             | `?shell=v2` (Lab, banc) ou `RUNTIME.shell = 'v2'` (`scripts/package.mjs --shell v2`) | `app/` + `modules/` ci-dessous                                                                                               |

Les **vues** (`shared/tts-v2.js`, `soundboard-view.js`, `bonk-view.js`, `tombola-v2.js`, `moderation-v2.js`…), le client du
Core (`shared/api.js`), l'achat par intention (`shared/purchase.js`) et les modèles sont **communs aux deux shells**. Le
shell v2 change la plomberie (entrée, mesure, chargement, feuilles), pas le comportement des vues.

## 2. Fichiers du shell v2

| Fichier                                | Rôle                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `app/boot.js`                          | choix du shell, feuilles initiales, entrée                                                                    |
| `app/v2.js`                            | démarre la mesure puis le viewer                                                                              |
| `app/main.js`                          | **une** entrée pour les 3 surfaces : helper Twitch, JWT, relevé de session, reprise, garde « écran gris »     |
| `app/store.js`                         | `createPoller()` (relevé suspendu page cachée) et `everySecond()` (horloge 1 s partagée)                      |
| `app/layout.js`                        | **la seule mesure** : `data-surface`, `data-profile`, `data-touch`, `data-mq`, `--kg`, `--kt`, `--vw`, `--vh` |
| `app/mq.js`, `app/mq-eval.js`          | requêtes de taille historiques, réévaluées sur la boîte de composition                                        |
| `app/panel.js`                         | panneau (Hub, chrome, hôte des modules) ; issu de `shared/ui.js`                                              |
| `app/lazy-views.js`                    | vues chargées à la demande (+ leurs feuilles), préchargement une fois le Hub affiché                          |
| `app/styles.js`                        | insertion des feuilles dans **un ordre canonique** (cascade identique au legacy)                              |
| `app/css/tokens.css`                   | échelles, planchers de texte, couleurs de l'identité                                                          |
| `app/css/tokens-fonts.css`             | `--fs-N` / `--fsm-N` : tailles de texte avec plancher                                                         |
| `app/css/shell-{base,video,panel}.css` | règles vivantes des feuilles historiques, mises à l'échelle                                                   |
| `modules/<id>/<id>.css`                | feuille d'un module (copie mise à l'échelle de sa feuille historique)                                         |
| `shared/box.js`                        | `boxWidth(node)` : largeur en pixels de composition, pour tout seuil JS                                       |

## 3. Responsive : la composition 651×434 et ses échelles

`app/layout.js` mesure la racine (un seul `ResizeObserver`) :

- **Profil** : `etroit` (portrait ou largeur < 360 : panel, mobile), sinon `r = min(L/651, H/434)` → `compact` (< 0,85),
  `normal` (0,85–1,15), `large` (> 1,15). Hystérésis de 8 px.
- **`--kg`** = clamp(0,85 ; r ; 1,15) : la géométrie. Les feuilles v2 écrivent `calc(14 * var(--g))` au lieu de `14px`
  (`--g` = `--kg` × 1 px). Les traits ≤ 2 px, bordures, ombres, transformations et fonds ne sont pas mis à l'échelle.
- **`--kt`** = clamp(0,95 ; r ; 1,10) : le texte. `font-size: var(--fs-13)` vaut `max(plancher, 13px × --kt)`.
- **Planchers** (décision du 08/11) : `--fl-strong` 13 px (V1 ≥ 14 : titres, prix, action principale), `--fl-body`
  12 px (texte courant, boutons ; 13 px en tactile), `--fl-small` 11 px (mentions), `--fl-micro` 10 px (compteurs,
  pastilles : sélecteurs `count|badge|chip|pill|tag|…`). Sous 8 px : glyphes décoratifs, inchangés.
- **`data-mq`** : les anciennes `@media (max-width…)` sont évaluées sur la **boîte de composition** L/kg × H/kg et
  écrites `:where(:root[data-mq~="m3"]) .x { … }` (aucune spécificité ajoutée). Ainsi une règle pensée pour le 651 suit
  l'échelle : à 565×376 (le réglage 65 %), la boîte vaut 652×434 → la composition 651 à 0,87.
- Les requêtes non liées à la taille (`hover`, `pointer`, `prefers-reduced-motion`) restent des `@media`.

Conséquences vérifiées par le banc : à l'échelle 1 et planchers à 0, les styles calculés v2 = legacy ; à 565×376 on voit
la composition 651 réduite (≈ 14 sons au lieu de 20, comme annoncé au plan § 3.3) ; aucun contrôle coupé sur 133 mesures.

**Règles pour écrire du CSS v2**

1. Une longueur de la composition s'écrit `calc(N * var(--g))` ; une taille de texte `var(--fs-N)` (ajouter le jeton
   dans `tokens-fonts.css` s'il manque) ou `max(var(--fl-…), calc(Npx * var(--kt)))`.
2. Jamais de `@media (max-width…)` : un profil (`:root[data-profile="compact"] .x`), une condition de boîte (`data-mq`)
   ou une `@container` locale. Jamais de mesure de fenêtre en JS : `boxWidth()` ou `data-profile`.
3. Le cadre d'une vue est une grille `auto / minmax(0, 1fr) / auto` : l'action principale est dans le pied, donc jamais
   coupée ; le corps défile. Un prix ou un bouton ne prend jamais d'ellipse.
4. Pas de `transform: scale()` global, pas de `zoom` (testé : coordonnées incohérentes dans Chromium entre
   `getBoundingClientRect` et `offsetLeft`, `100vh` réduit), pas d'attribut `popover`, pas d'ancrage CSS (iOS 16.4).
5. Cibles tactiles : ≥ 24 px partout (32 px en tactile), zone agrandie sans agrandir le dessin (`app/css/targets.css`). Une
   zone agrandie ne doit jamais mordre sur un autre contrôle : la matrice le vérifie (`hitOverlaps`) et échoue sinon.

## 4. Ajouter un module

### 4.1 Module de session (le cas courant) — modèle : `extension/lab-modules/demo/`

Le module fictif du Lab est le gabarit exécutable (vérifié par `node test/responsive/lab-module.mjs`). Trois fichiers à
lui, **aucune ligne** dans `app/lazy-views.js`, `app/styles.js` ou `app/panel.js` :

| Fichier              | Rôle                                                                               | Chargé                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `module.js` (entrée) | `registerSessionModule({ id, card, available, lazy: { load, styles }, onState? })` | au démarrage (le Hub a besoin de sa carte)                                        |
| `view.js`            | `export function view(ctx) → { node, start?, destroy?, attached?, onState? }`      | à la première ouverture (ou en arrière-plan après le Hub, sauf `prefetch: false`) |
| `<module>.css`       | classes préfixées, `calc(N * var(--g))`, `var(--fs-N)`                             | avec la vue, après les feuilles des modules (avant `targets.css`)                 |

L'entrée s'importe à une seule place : la liste des modules de session en tête de `app/panel.js` (l'ordre d'import est
l'ordre du Hub). Un module seulement pour le Lab va dans `extension/lab-modules/` : aucun paquet ne l'embarque
(`package.mjs` le retire, `verify-package.mjs` le refuse) et il ne se charge que si le runtime l'autorise (Lab, banc) **et**
que la page le demande (`?labModules=1`).

Cycle de vie garanti par l'hôte (`app/panel.js`) :

- **ouverture** : `view(ctx)` puis `start()` — une seule vue tant que le module est ouvert ;
- **rafraîchissements de l'hôte** : la même vue est rattachée (`attached()`), son état reste ;
- **nouvelle session pendant l'ouverture** : `onState(view, next, prev, ctx)` de l'entrée ; `true` = absorbé (pas de
  redessin) — seulement tant que le module est encore proposé ;
- **retour au Hub, ou module qui n'est plus proposé** (`available` → `false`) : `destroy()`, la vue sort du DOM, le Hub
  se redessine sans sa carte. Le banc vérifie qu'aucun `setInterval` ne reste après le retour, pour chaque module.
- `ctx` = `{ document, client, root, module, state, body, team, host: { home, refresh, payment, walletMethods,
restrictionChips } }`.

### 4.2 Module du module host (`/modules/v3`, achat via `purchase.js`) — modèle : **Coffre mystère**

Le modèle à suivre est **Coffre mystère** (`shared/coffre-mystere.js`, Lab ; son `setInterval` date d’avant le socle et passera sur `createPoller`) :

```js
// shared/mon-module.js
import { registerViewerModule } from './module-registry.js';
import { createPurchaseButton } from './purchase.js';

export function createMonModuleView({ document, client, module }) {
  const node = document.createElement('section');
  node.className = 'mm'; // préfixe de classes propre au module
  const buy = createPurchaseButton({
    document,
    run: (key, price) => client.moduleAct(module.id, 'jouer', null, key, price), // une clé par intention
    onResult: (r) => {
      /* afficher r.message, relire l'état */
    },
  });
  node.append(buy.node);
  return {
    node,
    start() {
      /* premier relevé */
    },
    destroy() {
      /* tout arrêter */
    },
  };
}
registerViewerModule('mon_module', createMonModuleView, { icon: '🎲' });
```

Ce que le socle fournit sans rien écrire : la session Twitch (JWT, rôles), le porte-monnaie dans l'en-tête, la
disponibilité (le module n'apparaît que si le Core le liste dans `/modules/v3`), la navigation Hub ↔ module, les erreurs
du Core en français (`errorLabel`), l'achat idempotent en deux temps (`purchase.js`, `expected_price` pour ces modules),
l'échelle et les planchers, le chargement à la demande.

Pour le brancher en v2 : une entrée dans `app/lazy-views.js` (`mon_module: { styles: ['modules/mon-module/mon-module.css'],
load: [() => import('../shared/mon-module.js')] }`) ; une feuille hors de `V2_ORDER` se place d'elle-même après les feuilles
des modules ; l'import statique dans `shared/ui.js` seulement s'il doit aussi exister dans le shell legacy.

**Interdits** : recalculer un prix, un solde, un cooldown ou un résultat (le Core décide, la vue affiche) ; un
`setInterval` à soi (utiliser `createPoller` / `everySecond` de `app/store.js` et tout arrêter dans `destroy`) ; une
classe sur `body` ; lire `window.innerWidth` ; une dépendance externe (tout est dans le zip, CSP Twitch).

Jeux futurs (Roulette, Slot) : le tirage se fait **dans le Core** ; la vue joue l'animation d'un résultat reçu. Le
multijoueur (Blackjack, spectateurs) demandera côté Core des sessions et une diffusion ; côté extension une source
« en direct » dans `app/store.js`, sans toucher aux vues existantes (plan § 14).

## 5. Tests et outils

| Commande (dans `apps/twitch-extension`)                                | Vérifie                                                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`                                                       | modèles, emballage, mise en page (`test/layout.test.js`)                                                                    |
| `node test/responsive/matrix.mjs [--shell v2] [--quick] [--shots]`     | contrôles coupés, polices, cibles, sur la matrice du plan                                                                   |
| `node test/responsive/compare.mjs <a> <b>`                             | écart de pixels entre deux jeux de captures                                                                                 |
| `node test/responsive/styles.mjs [--floors off]`                       | styles calculés legacy ↔ v2                                                                                                 |
| `npm run test:requests [-- --shell v2]`                                | 13 parcours d'achat et de modération contre un faux Core : requêtes identiques à la V1 figée (`reference/requests-v1.json`) |
| `npm run test:lab-module`                                              | module fictif : chargement à la demande, état, `destroy`, retrait ; aucun minuteur laissé par aucun module                  |
| `npm run lab:compare` (ou double-clic sur `Comparer legacy et v2.cmd`) | les deux shells côte à côte, données fictives locales, port 4480                                                            |
| `node test/responsive/grey-screen.mjs [--shell v2]`                    | garde « écran gris »                                                                                                        |
| `node test/responsive/payload.mjs`                                     | poids et temps jusqu'au Hub, par shell et surface                                                                           |
| `node scripts/dev/css-v2.mjs`                                          | générateur des feuilles v2 (**une fois** : il écrase les sorties éditées à la main)                                         |

## 6. Emballage

`node scripts/package.mjs --target production|staging|calibration [--shell legacy|v2] [--check]` — voir
`apps/twitch-extension/README.md`. La production refuse sans inventaire validé par Antoni. Aucun emballage n'est une
publication.
