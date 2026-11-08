# Extension Next — journal de reprise

> À lire en premier pour reprendre la refonte sans refaire l'audit. Mis à jour à chaque jalon.
> Cahier des charges : [PLAN_REFONTE_EXTENSION_2026-11-08.md](PLAN_REFONTE_EXTENSION_2026-11-08.md) ·
> audit : [EXTENSION_RESPONSIVE_ARCHITECTURE_AUDIT_2026-11-07.md](EXTENSION_RESPONSIVE_ARCHITECTURE_AUDIT_2026-11-07.md).

| | |
|---|---|
| Mise à jour | 08/11/2026 |
| Mandat | GO global d'Antoni (08/11) : développement **local** complet, lots 0 → 6. **Aucune** publication Twitch, aucun Hosted Test, aucun déploiement, aucun push/merge sans nouvel accord. |
| Worktree | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\extension-next` |
| Branche | `feat/extension-next` (locale, non poussée) |
| Départ | `3834d6b` = `origin/main` `13ed6e8` + 4 commits de docs d'audit |
| Sous-branche fusionnée | `feat/extension-next-packaging` (worktree `extension-next-packaging`, fusionné en `d021b47`) |

## Précautions Production (permanentes)

- Jamais le checkout principal `C:\Users\Antoni\Documents\Raptoru 2.0` (données du Studio installé) : pas de `clean`,
  `reset --hard`, `checkout .`. Ses modifications non commitées sont sauvegardées (patch + statut) dans
  `Documents\Sauvegarde Raptoru 2.0\extension-next-2026-11-08\`, avec le bundle de `backup/roue-v2-wip-2026-10-25` (`99157a3`).
- Ports interdits : 4100, 4110, 3789. Le banc utilise 4471–4482.
- Le banc n'appelle aucun service : fixtures de calibration, faux Core `core.bench.invalid` intercepté par Playwright.
- `npm run package:production` refuse sans inventaire validé par Antoni (`release-inventory/INVENTAIRE-<sha>.md`, ligne
  `Validé par Antoni : oui`). Ne jamais écrire cette ligne à sa place.

## Fait

| Phase | Commit | Contenu | Preuve |
|---|---|---|---|
| A — sauvegardes | — | bundle `99157a3` vérifié, patch du checkout principal | fichiers dans `Sauvegarde Raptoru 2.0\extension-next-2026-11-08\` |
| A — banc | `2ecba82`, `d5c0839` | `test/responsive/` : matrice, captures, comparaison pixel, écran gris, requêtes de référence ; références V1 versionnées | `npm run test:responsive`, `test:requests`, `test:grey-screen` |
| A — emballage | `dac6f74`, `21b36cd`, `80bbaee` | `scripts/package.mjs` (production/staging/calibration, `--shell`, `--check`), `targets.mjs`, `verify-package.mjs`, source `runtime-config` non configurée, garde `runtime-guard.js`, `PUBLISHED` (= `0bf7907` présumé), inventaire obligatoire, CI adaptée | vitest 112/112 ; 3 emballages réels |
| B — écran gris | `2f80968` | seuls les 2 blocs `overlay.js`/`mobile.js` de `99157a3` | message en 0,1–1,7 s sur les 3 surfaces ; V1 : rien |
| B — lot 1 | `c322de0` | TTS (paiement), Hub (barre du bas), Tombola (521 px), mobile TTS, filet de sécurité | 0 contrôle coupé / 133 (V1 : 7) ; identique à la V1 à 651×434 et 565×376 |

| C — socle étape 1 | `7da34a6` | `app/boot.js` (choix du shell), `app/layout.js` (mesure unique), feuilles v2 = règles vivantes | v2 = legacy : 133 captures ≤ 0,03 %, styles calculés identiques |
| C — socle étape 2 | `a3158d5` | `app/main.js` (entrée unique), `app/store.js`, `app/panel.js` (vues lourdes à la demande), feuilles v2 générées (`--g`, `--fs-N`, `data-mq`), jetons et planchers | échelle 1 + planchers à 0 : styles = legacy ; 0 contrôle coupé ; requêtes = V1 ; Hub 857 Ko (dont 126 Ko de fixtures du banc) au lieu de 2 158–2 266 Ko |
| C — étape 3 | `44f86c2` | seuils JS sur la boîte (`shared/box.js`), carrousel à l'échelle, zones de clic ≥ 24/32 px, Lab `RAPTORU_EXT_SHELL=v2`, `SOCLE.md` | vitest 124/124 |

| Recette automatique | `5b9e2d4` + ce commit | E2E Studio (14 fichiers touchant l'extension) | legacy 64/64 (3 tests d'écrans Studio relancés après construction de `apps/studio/web`) ; v2 (`RAPTORU_EXT_SHELL=v2`) 64/64 — `v1-parity` impose sa propre config, donc legacy |
| Matrices finales | — | 133 mesures × 2 shells | 0 contrôle coupé (V1 : 7) ; police min 10 px en v2 (legacy 8) ; cibles < 24 px : 200 (legacy 260) ; legacy après changements partagés = lot 1 (≤ 0,05 %) |
| Poids | — | `payload.mjs` | Hub v2 855–861 Ko (dont 126 Ko de fixtures du banc ⇒ ≈ 730 Ko réels) au lieu de 2 159–2 267 Ko ; Hub en 139–166 ms au lieu de 175–209 ms |

## En cours

Rien. Candidat local prêt pour la recette d'Antoni (Lab : ajouter `&shell=v2` à l'URL d'une page de l'extension, ou
lancer le Studio de développement avec `RAPTORU_EXT_SHELL=v2`).

## Prochaine action

1. Recette d'Antoni en Lab (legacy puis v2), puis décisions du plan § 13 (dont 13-1 publication, 13-3 interrupteur).
2. Améliorations restantes, non bloquantes : Hub à < 0,6 (377×251) défile de ≈ 15 px ; TTS mobile paysage reste
   empilée (deux colonnes possibles) ; 200 petites cibles restantes (champs de saisie, rangées D4) ; Coffre sur
   `createPoller` ; vues encore dans `shared/` ; nettoyage du lot 6 (legacy) seulement sur accord.
3. Avant toute publication : prouver la version servie (`PUBLISHED`), inventaire validé par Antoni, Hosted Test
   (`EXTENSION_NEXT_PUBLICATION.md`).

## Écarts au plan (justifiés)

- **Échelle géométrique** : générée dans les feuilles v2 (`calc(N * var(--g))`) au lieu de réécrire chaque règle à la
  main ; les anciennes media queries de taille deviennent des conditions sur la boîte de composition (`data-mq`) au lieu
  d'être converties une par une en profils. Même résultat (composition 651 à l'échelle), vérifiable mécaniquement.
  `zoom` CSS testé puis écarté (coordonnées incohérentes dans Chromium, `100vh` réduit).
- **Vues** : non déplacées dans `modules/<id>/view.js` ; elles restent dans `shared/` et servent les deux shells (moins
  de duplication pendant la transition). Seules leurs feuilles v2 sont dans `modules/<id>/`.
- **`npm run build`** n'échoue pas : il affiche les commandes d'emballage (turbo l'appelle pour tout le dépôt).
- **Inventaire de Production** dans `release-inventory/` (et non `release/`, ignoré par Git).

## Questions réellement bloquantes (Antoni)

- Version servie par Twitch : `PUBLISHED` contient `0bf7907` **présumé**. Preuve : twitch.tv/raptoru_ › F12 › Sources ›
  `<client-id>.ext-twitch.tv` › `shared/runtime-config.js` › `buildId`.
- Décisions § 13 du plan (publication du lot 1, interrupteur de retour arrière, retraits du lot 6, `expected_price`…).

## Commandes de reprise

```sh
cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\extension-next\apps\twitch-extension"
npx vitest run                                   # unitaires
node test/responsive/matrix.mjs --quick          # matrice rapide (legacy) ; --shell v2 pour le socle
node test/responsive/compare.mjs <tagA> <tagB>   # comparaison pixel de deux jeux de captures (--shots)
node test/responsive/styles.mjs                  # styles calculés legacy ↔ v2
node test/responsive/requests.mjs [--shell v2]   # requêtes de référence (comparer à reference/requests-v1.json)
node scripts/package.mjs --target staging        # emballage de test (jamais téléversé sans GO)
```
