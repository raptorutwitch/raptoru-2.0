# Retrait de l'ancien Lab — préparé, en attente

**Aucune de ces suppressions n'est faite.** Elles attendent la recette d'Antoni dans Electron
([RECETTE_FOUNDATION.md](RECETTE_FOUNDATION.md)). Le retour arrière reste `npm run studio:legacy`.

## Ce qui est déjà basculé

- `npm run studio` et `npm run studio:lab` lancent le Lab sur le vrai Core.
- `npx playwright test` tourne sur le vrai Core. L'ancienne pile : `E2E_STACK=legacy`.
- L'aperçu `dev/apercu-refonte-studio.cmd` utilise le vrai Core.

## À décider d'abord : le profil Lab du Studio installé

`apps/studio/desktop/scripts/stage.mjs` embarque `apps/core-api/dist/bonk-lab/local-server.js`. Un Studio **installé** mis
en profil Lab démarre donc l'ancien Core Lab : `labCoreChoice` y reste sur `legacy`, car l'installeur ne contient ni
`apps/core-api/dist/index.js`, ni ses migrations.

| Option | Conséquence |
|---|---|
| A. Plus de profil Lab dans le Studio installé (recommandé) | Le Lab reste un outil de développement, lancé depuis le dépôt. Rien de plus à embarquer. |
| B. Embarquer le Core principal dans l'installeur | Le Lab reste possible partout, l'installeur grossit et transporte le Core complet. |

Tant que ce choix n'est pas fait, `local-server.js` et `lab-core.ts` ne peuvent pas partir.

## Retraits, dans l'ordre

| # | Quoi | Lignes | Condition |
|---|---|---|---|
| 1 | `studio/server/scripts/bonk-lab.mjs`, script `bonk:lab`, chemin `BONK_LAB_ONLY` de `index.ts` | ~230 | recette passée |
| 2 | `e2e/lab-stack.ts`, branche `E2E_STACK=legacy` de `playwright.config.ts` | ~550 | recette passée |
| 3 | `extension-lab/lab-ebs.ts`, `commands-facade.ts`, `event-shop-facade.ts`, `sub-wheel-facade.ts` | ~2 780 | tests du tableau ci-dessous portés |
| 4 | `core-api/src/bonk-lab/lab-core.ts`, `local-server.ts`, lancement historique de `local-runtime.ts`, `studio:legacy` | ~600 | option A ou B décidée |
| 5 | Migrations jumelles `_lab`, une par module, quand plus rien ne les lit | à mesurer | après 4 ; jamais sur une base réelle sans GO |

Total certain : environ 4 100 lignes, hors migrations et tests.

## Tests à porter

Ces fichiers démarrent `LabEbs` ou le Core Lab historique. Les parcours qu'ils couvrent passent déjà sur le vrai Core en E2E ;
il faut les faire pointer sur `core-lab-stack.ts` ou `createMainCore`, sans perdre leurs cas.

| Dossier | Fichiers |
|---|---|
| `studio/server/test` | `alerts-twitch-chain`, `bonk-lab`, `bonk-lab-twitch`, `brb`, `channel-points-studio`, `color-cam`, `creepy`, `effects-player`, `extension-commands`, `extension-lab`, `fx-cam`, `lot9-main-core`, `moderation-d4`, `modules-lab-chain`, `random-ban`, `sound-lab`, `sub-wheel`, `sub-wheel-v2-studio`, `test-lab`, `tts-lab` |
| `core-api/test` | `lab-core`, `progression-lab`, `sub-wheel-viewers`, `sub-wheel`, `migration-scopes` (listes `lab`) |
| `studio/server/e2e` | `alerts.e2e.ts`, `halloween.e2e.ts` (imports de la pile) |

## Ce qui reste, quoi qu'il arrive

- `CORE_ENVIRONMENT=lab`, ses gardes et `lab/fictional-twitch.ts`.
- Le Twitch fictif, les simulateurs, l'Extension Lab, la console de modération.
- `core-lab-panel.ts`, `core-frontier.ts`, `main-lab-core.ts`.
- Le staging VPS : il n'est pas concerné, son retrait est une décision à part.

## Vérifier après chaque retrait

`npx playwright test` · `E2E_BOOT=1` sur un vrai serveur · suites Core et Studio · `npm run studio` à la main.
