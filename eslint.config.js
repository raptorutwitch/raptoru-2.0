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
      'apps/studio/server/bonk-overlay/bonk-v3-core.js',
      // Local UX prototypes (untracked, never versioned).
      'prototypes/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Twitch extension (ASTRA-P2-011): plain browser ES modules, linted like the rest of the repo.
    // calibration/: browser modules of the calibration build (Video Component geometry).
    files: [
      'apps/twitch-extension/extension/**/*.js',
      'apps/twitch-extension/calibration/**/*.js',
      // Dock OBS V1 page (OBS custom browser dock).
      'apps/studio/server/dock-page/**/*.js',
      'apps/studio/server/halloween-overlay/**/*.js',
    ],
    languageOptions: {
      sourceType: 'module',
      globals: Object.fromEntries(
        [
          'window',
          'document',
          'location',
          'console',
          'localStorage',
          'performance',
          'crypto',
          'fetch',
          'URL',
          'URLSearchParams',
          'AbortController',
          'Audio',
          'CSS',
          'ResizeObserver',
          'getComputedStyle',
          'structuredClone',
          'queueMicrotask',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'TextDecoder',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: {
      // `({ dropped, ...rest })` is how these modules omit a field.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
);
