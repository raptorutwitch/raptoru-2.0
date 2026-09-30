import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/.turbo/**',
      'apps/studio/desktop/stage/**',
      'apps/studio/desktop/release/**',
      // Production extension imported as is (see apps/twitch-extension/README.md).
      'apps/twitch-extension/extension/**',
      'apps/studio/server/bonk-overlay/bonk-v3-core.js',
      // Local UX prototypes (untracked, never versioned).
      'prototypes/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
);
