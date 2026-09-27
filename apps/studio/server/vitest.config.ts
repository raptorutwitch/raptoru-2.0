import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Importing src/index.ts in tests must not open the real Studio server.
    env: { STUDIO_SERVER_NO_LISTEN: '1' },
    // Bonk Lab tests boot a WASM Postgres (Core helpers): same budget as Core, since the cold start
    // exceeds the 5s default under the parallel load of `npm run check` on Windows.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
