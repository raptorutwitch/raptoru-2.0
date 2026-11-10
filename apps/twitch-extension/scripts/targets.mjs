// Packaging targets of the Twitch extension, frozen (docs/extension/PLAN_REFONTE_EXTENSION_2026-11-08.md
// § 9 lot 0). Any other target or apiBase is refused by scripts/package.mjs and scripts/verify-package.mjs.
// The allowed apiBase list lives in the extension itself (shared/runtime-guard.js, the runtime guard of
// shared/api.js): one source for the packager and the browser.
import { ALLOWED_API_BASES } from '../extension/shared/runtime-guard.js';

export { ALLOWED_API_BASES };

export const TARGETS = Object.freeze({
  // The version submitted to Twitch review: production Core, no environment (no badge).
  production: Object.freeze({
    name: 'production',
    label: 'PRODUCTION',
    mode: 'connected',
    apiBase: 'https://core.raptoru.fr/v1/ext',
    environment: null,
  }),
  // Hosted Test against the staging Core (« STAGING · test » badge). Never the production upload.
  staging: Object.freeze({
    name: 'staging',
    label: 'STAGING',
    mode: 'connected',
    apiBase: 'https://core-staging.raptoru.fr/v1/ext',
    environment: 'staging',
  }),
  // Video Component geometry calibration: local fixtures (calibration/adapter.js), no apiBase at all.
  calibration: Object.freeze({
    name: 'calibration',
    label: 'CALIBRATION',
    mode: 'demo',
    apiBase: '',
    environment: 'calibration',
  }),
});

export const SHELLS = Object.freeze(['legacy', 'v2']);

for (const target of Object.values(TARGETS))
  if (target.apiBase && !ALLOWED_API_BASES.includes(target.apiBase))
    throw new Error(
      `targets.mjs: ${target.name} apiBase is not in shared/runtime-guard.js`,
    );
