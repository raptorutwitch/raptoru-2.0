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

## En cours

Phase C — socle : `app/boot.js` (choix du shell, feuilles), `app/layout.js` (mesure unique, profils, `--kg`/`--kt`),
`app/v2.js`, feuilles `app/css/shell-{base,video,panel}.css` = règles vivantes des feuilles historiques
(`scripts/dev/css-alive.mjs`, règles mortes listées dans `scripts/dev/css-dead-*.txt`).
Contrôles : legacy via boot identique au lot 1 ; v2 identique au legacy (pixels + styles calculés `styles.mjs`).

## Prochaine action

Voir la section « En cours » ; puis tokens + planchers de texte, Hub v2, TTS pilote (plan § 9 lots 2–3).

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
