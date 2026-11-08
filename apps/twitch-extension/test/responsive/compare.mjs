// Pixel comparison of two capture sets of matrix.mjs (--shots): out/shots/<a>/ vs out/shots/<b>/.
//   node test/responsive/compare.mjs <tagA> <tagB> [--filter 651x434] [--max 0.02]
// Compares in Chromium (canvas, no image library). A pixel differs when a channel moves by > 24/255.
// Animated zones (carousel, sprites, timers) produce noise: read the ratio, then look at out/diff/<a>-<b>/.
// Writes out/diff/<a>-<b>/<name>.png (differences in magenta over a dimmed B) and <a>-<b>.md.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, '../../../../package.json'))('@playwright/test');
const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const filter = opt('filter', '');
const max = Number(opt('max', '1'));
const dirA = join(HERE, 'out', 'shots', a);
const dirB = join(HERE, 'out', 'shots', b);
const outDir = join(HERE, 'out', 'diff', `${a}-${b}`);
mkdirSync(outDir, { recursive: true });

const names = readdirSync(dirA).filter((n) => n.endsWith('.png') && n.includes(filter) && existsSync(join(dirB, n)));
const browser = await chromium.launch();
const page = await browser.newPage();
const rows = [];
for (const name of names) {
  const res = await page.evaluate(async ([pa, pb]) => {
    const load = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b64}`; });
    const [ia, ib] = await Promise.all([load(pa), load(pb)]);
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
    const ctx = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x; };
    const da = ctx(ia).getImageData(0, 0, w, h).data;
    const xb = ctx(ib);
    const db = xb.getImageData(0, 0, w, h);
    let diff = 0;
    for (let p = 0; p < da.length; p += 4) {
      const d = Math.max(Math.abs(da[p] - db.data[p]), Math.abs(da[p + 1] - db.data[p + 1]), Math.abs(da[p + 2] - db.data[p + 2]));
      if (d > 24) { diff += 1; db.data[p] = 255; db.data[p + 1] = 0; db.data[p + 2] = 255; } else { db.data[p] >>= 2; db.data[p + 1] >>= 2; db.data[p + 2] >>= 2; }
    }
    xb.putImageData(db, 0, 0);
    return { ratio: diff / (w * h), png: xb.canvas.toDataURL('image/png').split(',')[1], size: `${ia.width}x${ia.height} / ${ib.width}x${ib.height}` };
  }, [readFileSync(join(dirA, name)).toString('base64'), readFileSync(join(dirB, name)).toString('base64')]);
  if (res.ratio > 0) writeFileSync(join(outDir, name), Buffer.from(res.png, 'base64'));
  rows.push([name, res.ratio, res.size]);
}
await browser.close();
rows.sort((x, y) => y[1] - x[1]);
const md = `# ${a} → ${b}\n\n| capture | pixels différents |\n|---|---|\n${rows.map(([n, r]) => `| ${n} | ${(r * 100).toFixed(2)} % |`).join('\n')}\n`;
writeFileSync(join(HERE, 'out', `diff-${a}-${b}.md`), md);
const over = rows.filter(([, r]) => r > max);
console.log(`${rows.length} captures comparées ; ${over.length} au-dessus de ${(max * 100).toFixed(1)} %`);
for (const [n, r] of rows.slice(0, 12)) console.log(`  ${(r * 100).toFixed(2).padStart(6)} %  ${n}`);
process.exitCode = over.length ? 1 : 0;
