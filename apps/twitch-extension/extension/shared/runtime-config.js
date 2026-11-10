// Source NON configurée : ce fichier n'est jamais servi tel quel.
// - scripts/package.mjs le remplace dans chaque paquet (production, staging, calibration) ;
// - le Lab de Studio le remplace à la volée (apps/studio/server/src/extension-lab/serve.ts).
// Zippé à la main, ce dossier donne une extension qui affiche « Version non configurée »
// (shared/runtime-guard.js) et n'appelle aucun serveur.
export const RUNTIME = Object.freeze({
  mode: 'unconfigured',
  apiBase: '',
  siteUrl: '',
  buildId: 'source-unconfigured',
});
