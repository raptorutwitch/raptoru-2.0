import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each file boots one WASM Postgres; slow Windows machines need more than the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
