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

Deuxième passe (demande d'Antoni du 08/11, 5 points avant sa recette visuelle) :

| Point | Commit | Contenu | Preuve |
|---|---|---|---|
| 2 — cibles | `5e8a1dc` (+ `2e0777a`) | l'audit mesure la vraie zone (pseudo-élément coupé par `overflow` exclu, champ compté avec son `<label>`) et détecte les zones agrandies qui mordent sur un autre contrôle ; zones ≥ 24 px (32 en tactile, 24 entre voisins serrés) sur Hub, Soundboard, Bonk, Tombola, Modération | 133 mesures : cibles < 24 px 200 → **21** (19 = la bande « Vider » du chargeur Bonk, gardée discrète : action destructive ; 2 = recherche du Soundboard au zoom 125–150 %, 23,x px), **0** chevauchement, 0 contrôle coupé ; pixels = v2 précédente (seules horloges et barres de progression bougent) |
| 1 + 3 — ajout d'un module | `1536c8b` | module de session `lazy` (entrée = carte + disponibilité, vue et feuille à l'ouverture) ; feuille hors liste placée seule ; hooks `onState`/`rendered` pour les modules de session ; un module qui n'est plus proposé est fermé ; module fictif `extension/lab-modules/demo` (Lab seulement, jamais emballé) | `npm run test:lab-module` : 23 vérifications ✓ (chargement à la demande, état, `destroy`, retrait sans effet, aucun minuteur laissé par les 5 modules du Hub) ; vitest 127/127 (dont 3 tests d'emballage du module Lab) ; vrai emballage staging v2 `--check` : vérification OK |
| 4 — contrats | `fb3dada` | 13 parcours contre le faux Core : TTS Jetons / crédits / double clic / réponse perdue, Tombola, Soundboard Jetons / crédits, salve Bonk, Modération (retirer + rembourser, stop sans rembourser, créditer, débiter double clic, bloquer) | référence régénérée sur une V1 figée (`3834d6b`) ; legacy et v2 **identiques** (`--compare`) ; double clic = 1 requête ; réponse perdue = même clé renvoyée |
| 2 — régression corrigée | `2e0777a` | la zone agrandie du champ de recherche du Soundboard prenait le clic du bouton « Effacer » (trouvé par l'E2E `soundboard.e2e.ts:50`) : zone retirée ; l'audit signale désormais un contrôle dont le centre est pris par un parent | matrice v2 (133) : 0 coupé, 0 chevauchement, 0 recouvert, 21 cibles < 24 px (legacy, même audit : 241) |
| Recette automatique | — | E2E Studio, 13 fichiers qui chargent l'extension (44 tests) | legacy **44/44**, v2 **44/44**. Deux passages précédents interrompus par un arrêt silencieux de la pile E2E de Studio (port 4399 refusé, à un test différent à chaque fois, dans les deux shells) : environnement, relancé |
| 5 — comparaison | `e97ca86` | `Comparer legacy et v2.cmd` / `npm run lab:compare` : les deux shells côte à côte, 18 tailles, 8 écrans, données fictives, politique du Lab | page vérifiée : 0 hôte externe contacté, 0 erreur ; port occupé = message clair |

## En cours

**Développement arrêté** (demande d'Antoni du 08/11) : il juge lui-même l'apparence, le responsive, le défilement et
l'ergonomie avant d'autoriser la suite. Outil : double-clic sur `apps/twitch-extension/Comparer legacy et v2.cmd`
(page sur `http://127.0.0.1:4480/`, legacy à gauche, v2 à droite).

## Prochaine action

1. Attendre le verdict de la recette visuelle d'Antoni ; corriger ce qu'il relève ; puis décisions du plan § 13 (dont
   13-1 publication, 13-3 interrupteur).
2. Améliorations restantes, non bloquantes : Hub à < 0,6 (377×251) défile de ≈ 15 px ; TTS mobile paysage reste
   empilée (deux colonnes possibles) ; bande « Vider » du Bonk (15 px, à agrandir seulement si Antoni le veut) ; Coffre
   sur `createPoller` (son minuteur est bien arrêté au départ) ; vues encore dans `shared/` ; nettoyage du lot 6 (legacy)
   seulement sur accord.
3. Avant toute publication : prouver la version servie (`PUBLISHED`), inventaire validé par Antoni, Hosted Test
   (`EXTENSION_NEXT_PUBLICATION.md`).

## Écarts au plan (justifiés)

- **Échelle géométrique** : générée dans les feuilles v2 (`calc(N * var(--g))`) au lieu de réécrire chaque règle à la
  main ; les anciennes media queries de taille deviennent des conditions sur la boîte de composition (`data-mq`) au lieu
  d'être converties une par une en profils. Même résultat (composition 651 à l'échelle), vérifiable mécaniquement.
  `zoom` CSS testé puis écarté (coordonnées incohérentes dans Chromium, `100vh` réduit).
- **Vues** : non déplacées dans `modules/<id>/view.js` ; elles restent dans `shared/` et servent les deux shells (moins
  de duplication pendant la transition). Seules leurs feuilles v2 sont dans `modules/<id>/`. Revu le 08/11 : ce n'est
  pas ce qui gênait l'ajout d'un module (un nouveau module a son propre dossier, cf. `lab-modules/demo`).
- **Composants partagés** : pas de composant « cadre » commun ; l'hôte dessine pour tous l'en-tête (retour, titre,
  porte-monnaie, puces de restriction) et fournit `ctx.host` (paiement, moyens de paiement, rafraîchissement) ;
  `ui-primitives.js`, `purchase.js`, `app/store.js`, `shared/box.js` sont partagés. Chaque vue garde son propre cadre :
  c'est l'identité V1 (« on reconstruit la mécanique, pas l'identité »).
- **Revue du 08/11 (point 3)**, corrigé ce qui gênait vraiment un futur module : il fallait toucher 3 fichiers centraux
  (`lazy-views.js`, `styles.js`, `panel.js`) → une ligne d'import ; un module de session ne recevait pas les nouvelles
  sessions (seules les variantes) → hooks communs ; une variante qui disparaissait pendant l'ouverture continuait
  d'absorber les mises à jour → fermée. Comportements propres conservés (TTS absorbe ses états, icône du Soundboard,
  « ? » du Bonk, en-têtes de la Tombola et de la Modération) : E2E et requêtes identiques.
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
npm run test:requests [-- --shell v2]            # 13 parcours économiques/modération = référence V1 (faux Core)
npm run test:lab-module                          # module fictif + aucun minuteur laissé par les modules
npm run lab:compare                              # legacy ↔ v2 côte à côte (127.0.0.1:4480)
node scripts/package.mjs --target staging        # emballage de test (jamais téléversé sans GO)
```
