// Les seules API que l'extension a le droit d'appeler (ASTRA lot 0, défense en profondeur) :
// Core de Production, Core de staging, EBS local du Lab de Studio (apps/studio/server/src/extension-lab/serve.ts).
// scripts/targets.mjs importe cette liste : une seule source. Toute autre valeur de RUNTIME.apiBase
// (dont l'ancien serveur du site, ou une source non emballée) fait échouer chaque requête
// avec `unconfigured_build`.
export const ALLOWED_API_BASES = Object.freeze([
  'https://core.raptoru.fr/v1/ext',
  'https://core-staging.raptoru.fr/v1/ext',
  '/ext-lab/api',
]);

export const isAllowedApiBase = (apiBase) => ALLOWED_API_BASES.includes(apiBase);
