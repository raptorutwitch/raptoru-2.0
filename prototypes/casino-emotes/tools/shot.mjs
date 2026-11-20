// Captures rapides pendant le développement : node tools/shot.mjs <dossier> [scénario: base|bonus|big]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(join(ROOT, '../../apps/studio/server/package.json'))('@playwright/test');
const OUT = process.argv[2] ?? join(ROOT, 'captures');
const MODE = process.argv[3] ?? 'base';
mkdirSync(OUT, { recursive: true });
const PORT = 4521;
const srv = spawn(process.execPath, ['start.mjs', '--no-open'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; ; i++) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/`);
    break;
  } catch {
    if (i > 60) throw new Error('serveur');
    await sleep(300);
  }
}
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.waitForFunction(() => window.__book);
const frame = p.locator('#frame');
await sleep(500);
await frame.screenshot({ path: join(OUT, '01-repos.png') });
const cz = (s) => p.locator('.cz-host').locator(s);
if (MODE === 'base') {
  await cz('#spin').click();
  await sleep(700);
  await frame.screenshot({ path: join(OUT, '02-spin.png') });
  await sleep(3000);
  await frame.screenshot({ path: join(OUT, '03-fin.png') });
} else {
  await p.evaluate((m) => window.__book.arm(m === 'big' ? { bonus: 3, symbol: 'p1', big: true } : { bonus: 3, symbol: 'c2', expand: 4, retrigger: true }), MODE);
  await cz('#spin').click();
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    await frame.screenshot({ path: join(OUT, `b${String(i).padStart(2, '0')}.png`) });
    if (!(await p.evaluate(() => window.__book.busy))) break;
  }
}
console.log('erreurs :', errors.length ? errors : 'aucune');
await b.close();
srv.kill();
process.exit(0);
