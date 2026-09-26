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
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
);
