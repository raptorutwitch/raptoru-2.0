import { defineConfig } from '@playwright/test';

// Browser E2E (ASTRA-P1-018): a few critical chains only, on an isolated stack (e2e/lab-stack.ts:
// real Lab Core on an in-memory database + real Extension Lab EBS/Studio routes). No Twitch, no Docker,
// no real data. Run: `npm run e2e` (once: `npx playwright install chromium`).
const PORT = Number(process.env.E2E_PORT ?? 4399);

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  // One stack per run, shared state (the chain mutates it): strictly sequential.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: '.e2e-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Functional invariants, no visual snapshots; a failure keeps its trace and screenshot.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Isolation: the browser resolves no host name at all (the stack is on 127.0.0.1). A spec that wants a remote image
    // (e.g. 7TV/BTTV/FFZ CDNs in bonk.e2e.ts) serves it locally with page.route; anything else simply fails.
    launchOptions: { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] },
  },
  webServer: {
    command: 'npx tsx e2e/lab-stack.ts',
    url: `http://127.0.0.1:${PORT}/ext/mobile.html`,
    // Always a fresh stack (fresh in-memory database): a busy port is an explicit error.
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(PORT) },
    stdout: 'pipe',
  },
});
