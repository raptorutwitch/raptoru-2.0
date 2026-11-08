/* global URL */
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// ASTRA-P2-011: the extension sources are linted by the normal `npm run lint` — never ignored again.
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

describe('lint coverage of the extension', () => {
  it('the extension modules are linted (not ignored)', async () => {
    const eslint = new ESLint({ cwd: REPO });
    for (const file of [
      'apps/twitch-extension/extension/overlay.js',
      'apps/twitch-extension/extension/shared/ui.js',
      'apps/twitch-extension/extension/shared/commands-public.js',
    ])
      expect(await eslint.isPathIgnored(file), file).toBe(false);
    // Loading the ESLint config takes several seconds while turbo runs the other suites in parallel.
  }, 30_000);
});
