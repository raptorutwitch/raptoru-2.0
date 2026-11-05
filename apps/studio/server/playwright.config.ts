import { defineConfig } from '@playwright/test';

// Browser E2E (ASTRA-P1-018): a few critical chains only, on an isolated stack (e2e/lab-stack.ts:
// real Lab Core on an in-memory database + real Extension Lab EBS/Studio routes). No Twitch, no Docker,
// no real data. Run: `npm run e2e` (once: `npx playwright install chromium`).
const PORT = Number(process.env.E2E_PORT ?? 4399);
// The target Lab (decision of 05/11): the main Core in its Lab environment, Studio in front (e2e/core-lab-stack.ts).
const CORE_LAB_PORT = Number(process.env.E2E_CORE_LAB_PORT ?? 4389);

export default defineConfig({
  testDir: './e2e',
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
    launchOptions: {
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    },
  },
  projects: [
    // The historical Lab stack (Lab Core assembly + Lab EBS): every *.e2e.ts.
    { name: 'lab', testMatch: '*.e2e.ts' },
    // The main Core in its Lab environment (*.core-lab.ts): the Extension Lab on the Core's real /v1/ext.
    {
      name: 'core-lab',
      testMatch: '*.core-lab.ts',
      use: { baseURL: `http://127.0.0.1:${CORE_LAB_PORT}` },
    },
  ],
  webServer: [
    {
      command: 'npx tsx e2e/lab-stack.ts',
      url: `http://127.0.0.1:${PORT}/ext/mobile.html`,
      // Always a fresh stack (fresh in-memory database): a busy port is an explicit error.
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_PORT: String(PORT) },
      stdout: 'pipe',
      // The stack's own diagnostics ([e2e-stack] lines: fatal errors, exit) always reach the run log.
      stderr: 'pipe',
    },
    {
      command: 'npx tsx e2e/core-lab-stack.ts',
      url: `http://127.0.0.1:${CORE_LAB_PORT}/ext/mobile.html`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_CORE_LAB_PORT: String(CORE_LAB_PORT) },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
