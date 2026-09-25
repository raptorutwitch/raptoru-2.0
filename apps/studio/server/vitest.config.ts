import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Importing src/index.ts in tests must not open the real Studio server.
  test: { env: { STUDIO_SERVER_NO_LISTEN: '1' } },
});
