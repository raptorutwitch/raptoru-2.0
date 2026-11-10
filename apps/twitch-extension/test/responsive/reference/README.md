# Références V1 (commit `3834d6b`, avant toute modification de la refonte)

- `requests-v1.json` : requêtes émises par la V1 pour chaque intention scriptée (`requests.mjs`). Toute vue
  migrée doit produire les mêmes (`npm run test:requests`, puis comparer les champs `writes`).
- `v1/*.png` : captures de la V1 à 651×434 (référence artistique), 565×376 (réglage 65 %) et panel 318×496,
  données de calibration, Chromium.

Régénérer toutes les références (mobile compris) depuis la V1 figée :

```sh
git archive 3834d6b apps/twitch-extension/extension apps/twitch-extension/calibration | tar -x -C <dossier>
BENCH_ROOT=<dossier>/apps/twitch-extension node test/responsive/matrix.mjs --tag v1-baseline --shots
node test/responsive/compare.mjs v1-baseline <tag>
```
