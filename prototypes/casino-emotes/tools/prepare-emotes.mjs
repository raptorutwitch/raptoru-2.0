// Copie les émotes du manifeste depuis ton dossier (LECTURE SEULE : rien n'y est écrit, renommé ni supprimé) vers
// assets/emotes/ : une image fixe 256 × 256 (PNG) par symbole, et pour une image animée, la copie exacte du fichier
// d'origine (son animation native). Chromium (déjà installé avec le dépôt) redimensionne et lit l'image fixe d'un GIF.
//   node tools/prepare-emotes.mjs        (refait seulement ce qui a changé ; --force pour tout refaire)
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCE_DIR, SYMBOLS } from '../src/manifest.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'assets/emotes');
const INDEX = join(OUT, 'prepared.json');
const SIZE = 256;
mkdirSync(OUT, { recursive: true });

/** Animé ? GIF : plus d'une image ; PNG : un bloc acTL (APNG) ; WebP : un bloc ANIM. */
function animated(buf, ext) {
  if (ext === '.gif') {
    let frames = 0;
    for (let i = 0; i < buf.length - 1; i++) if (buf[i] === 0x21 && buf[i + 1] === 0xf9) frames++;
    return frames > 1;
  }
  if (ext === '.png') return buf.includes(Buffer.from('acTL'));
  if (ext === '.webp') return buf.includes(Buffer.from('ANIM'));
  return false;
}

export async function prepare({ force = false } = {}) {
  const before = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
  const out = {};
  const todo = [];
  for (const s of SYMBOLS) {
    if (!s.file) {
      out[s.id] = { missing: true, provisional: !!s.provisional };
      continue;
    }
    const src = join(SOURCE_DIR, s.file);
    if (!existsSync(src)) {
      out[s.id] = { missing: true, file: s.file, provisional: !!s.provisional };
      console.log(`  manquant : ${s.file} (${s.id}) — visuel provisoire`);
      continue;
    }
    const st = statSync(src);
    const ext = extname(s.file).toLowerCase();
    const sig = `${s.file}|${st.size}|${st.mtimeMs}|${s.poster ?? 0}|${s.shape ?? ''}|${s.zoom ?? 1}|${s.focusY ?? 0.5}`;
    const anim = animated(readFileSync(src), ext);
    const rec = { file: s.file, sig, animated: anim, still: `assets/emotes/${s.id}.png`, anim: anim ? `assets/emotes/${s.id}${ext}` : null };
    out[s.id] = rec;
    if (!force && before[s.id]?.sig === sig && existsSync(join(ROOT, rec.still))) continue;
    if (anim) copyFileSync(src, join(ROOT, rec.anim)); // l'animation d'origine, octet pour octet
    todo.push({ id: s.id, src, poster: s.poster ?? 0, circle: s.shape === 'circle', zoom: s.zoom ?? 1, focusY: s.focusY ?? 0.5 });
  }
  if (todo.length) {
    const { chromium } = createRequire(join(ROOT, '../../apps/studio/server/package.json'))('@playwright/test');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    for (const t of todo) {
      await page.goto(pathToFileURL(t.src).href);
      const data = await page.evaluate(
        async ({ size, poster, circle, zoom, focusY }) => {
          const img = document.querySelector('img');
          await img.decode().catch(() => {});
          if (poster) await new Promise((ok) => setTimeout(ok, poster));
          const c = document.createElement('canvas');
          c.width = c.height = size;
          const g = c.getContext('2d');
          g.imageSmoothingQuality = 'high';
          if (circle) {
            // un cercle comme une photo de profil : l'image remplit le cercle (recadrée au centre)
            g.beginPath();
            g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            g.clip();
          }
          const k = (circle ? Math.max : Math.min)(size / img.naturalWidth, size / img.naturalHeight) * zoom;
          const w = img.naturalWidth * k, h = img.naturalHeight * k;
          // le centre du cadrage : au milieu en largeur, à focusY en hauteur (gardé dans l'image)
          const y = Math.min(0, Math.max(size - h, size / 2 - h * focusY));
          g.drawImage(img, (size - w) / 2, y, w, h);
          return c.toDataURL('image/png');
        },
        { size: SIZE, poster: t.poster, circle: t.circle, zoom: t.zoom, focusY: t.focusY },
      );
      writeFileSync(join(OUT, `${t.id}.png`), Buffer.from(data.split(',')[1], 'base64'));
      console.log(`  ${t.id} ← ${t.src.split(/[\\/]/).pop()}`);
    }
    await browser.close();
  }
  writeFileSync(INDEX, JSON.stringify(out, null, 1));
  writeFileSync(join(OUT, 'prepared.js'), `// généré par tools/prepare-emotes.mjs\nexport const PREPARED = ${JSON.stringify(out, null, 1)};\n`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await prepare({ force: process.argv.includes('--force') });
