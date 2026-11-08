# Raptoru Live — extension Twitch

`extension/` est la source de l'extension : HTML/CSS/modules ES statiques, sans bundler. Elle est
servie telle quelle : il n'y a **rien à construire** (`npm run build` ne fait qu'afficher les
commandes d'emballage, pour `turbo run build`).

Réglages de la console Twitch (hébergement des fichiers) : panneau `panel.html` (hauteur 496),
mobile `mobile.html`, composant vidéo `video_component.html` (**hauteur cible 65 %**, ratio 3:2,
autoscale désactivé, pixel scale 1024 ; référence de conception 651×434), configuration et
configuration en direct `config.html`.

## Commandes

```sh
npm test -w @raptoru/twitch-extension
npm run package:staging -w @raptoru/twitch-extension       # Hosted Test sur le Core de staging
npm run package:calibration -w @raptoru/twitch-extension   # Hosted Test de géométrie (fixtures locales)
npm run package:production -w @raptoru/twitch-extension    # version soumise à Twitch (après GO)
npm run verify:package -w @raptoru/twitch-extension -- release/<zip>
```

`scripts/package.mjs --target production|staging|calibration [--shell legacy|v2] [--check]` est le
seul emballage. Les cibles et leur `apiBase` sont figées dans `scripts/targets.mjs` ; `--shell`
inscrit le shell dans la configuration générée (`legacy` par défaut) ; `--check` fait toutes les
vérifications sans écrire de zip. Le zip (dans `release/`, ignoré par Git) embarque
`build-manifest.json` (cible, commit, `apiBase`, shell, date, version publiée, nombre de commits) et
est revérifié par `scripts/verify-package.mjs` avant d'être écrit. L'emballage refuse un arbre
modifié (`extension/`, `calibration/`, `scripts/`, `PUBLISHED`) : committer d'abord.

## Protections

- `extension/shared/runtime-config.js` source est **non configuré** : zippé à la main, le dossier
  donne une extension qui affiche « Version non configurée » et n'appelle aucun serveur.
- Garde à l'exécution (`shared/runtime-guard.js`, appliquée par `shared/api.js`) : seuls le Core de
  Production, le Core de staging et le Lab (`/ext-lab/api`) sont appelables ; toute autre `apiBase`
  échoue avec `unconfigured_build`.
- Production : `PUBLISHED` contient le commit présumé servi par Twitch (lignes `#` = commentaires).
  L'emballage liste les commits de `extension/` depuis ce commit et refuse sans
  `release-inventory/INVENTAIRE-<12 premiers caractères du dernier commit de extension/>.md` qui
  liste **exactement** ces commits (une ligne par commit commençant par son sha court : `- 8a2f113 …`)
  et contient la ligne exacte `Validé par Antoni : oui`. L'inventaire est embarqué
  (`build-inventory.txt`) ; le zip s'appelle
  `raptoru-live-PRODUCTION-<commit>-depuis-<publié>-<n>-commits.zip`. Après approbation par Twitch,
  mettre `PUBLISHED` à jour dans le même commit que la note de version.

## Test local : Raptoru Studio → Extension Lab

Le Studio sert `extension/` tel quel, avec deux substitutions faites **au service** (jamais dans
ces fichiers) : le script helper Twitch devient une simulation locale de `window.Twitch.ext`, et
`shared/runtime-config.js` pointe vers l'EBS local du Lab (`/ext-lab/api`, jetons fictifs). La CSP
des pages du Lab n'autorise que l'origine du Studio.

Ne pas modifier `extension/` pour le Lab : ce qui est testé en local est ce qui est emballé.
