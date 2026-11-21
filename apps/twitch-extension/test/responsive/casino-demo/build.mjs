// Bundles the casino demo's local Core (local-core.js + the Core's own game engines, apps/core-api/src/casino/*.ts)
// for the browser, into test/responsive/out/casino-demo-core.js (ignored by git). Run by casino-bench.mjs and
// casino-matrix.mjs at start; takes well under a second. The engines' only Node import (rng.ts: node:crypto's
// randomInt, the Core's real generator) is replaced by a browser stand-in — the demo draws with Math.random anyway.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEMO_CORE = join(HERE, '..', 'out', 'casino-demo-core.js');

export async function buildDemoCore() {
  const esbuild = createRequire(join(HERE, '../../../../../package.json'))('esbuild');
  await esbuild.build({
    entryPoints: [join(HERE, 'local-core.js')],
    outfile: DEMO_CORE,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'warning',
    plugins: [
      {
        name: 'node-crypto-stand-in',
        setup(b) {
          b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'node-crypto', namespace: 'stand-in' }));
          b.onLoad({ filter: /.*/, namespace: 'stand-in' }, () => ({
            contents: 'export const randomInt = (a, b) => a + Math.floor(Math.random() * (b - a));',
            loader: 'js',
          }));
        },
      },
    ],
  });
  return DEMO_CORE;
}
