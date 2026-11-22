// Parcours complet de la page Studio › Chaos dans un Chromium sans fenêtre, contre un Chaos Lab en marche
// (npm run chaos:lab -- --no-open) : moteur prêt → choix de la mire → « Tester » → écran réellement retourné (pixels
// lus à l'écran) → STOP ALL → écran normal → réglage des coins enregistré dans le moteur. Captures dans --out <dossier>.
// Usage : tsx apps/studio/server/scripts/chaos-lab-e2e.ts [--out <dossier>] [--port 4120]
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const args = process.argv.slice(2);
const arg = (k: string, d: string) =>
  args.includes(k) ? args[args.indexOf(k) + 1]! : d;
const OUT = arg('--out', join(tmpdir(), 'chaos-lab-e2e'));
const BASE = `http://127.0.0.1:${arg('--port', '4120')}`;
const EXE = join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe');
mkdirSync(OUT, { recursive: true });

let ok = 0;
let ko = 0;
const check = (cond: boolean, what: string, detail = '') => {
  if (cond) ok++;
  else ko++;
  console.log(
    `${cond ? '  ok ' : '  KO '} ${what}${detail ? ` — ${detail}` : ''}`,
  );
};

/** Quatre pixels de la mire lus à l'écran (BitBlt CAPTUREBLT, comme les contrôles du moteur). */
function screen(hwnd: number): string {
  const ps = `
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class P {
 [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Ri, B; }
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out R r, int s);
 [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
 [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr d);
 [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, uint rop);
 public static string Read(long hwnd) {
  R r; DwmGetWindowAttribute(new IntPtr(hwnd), 9, out r, 16); int w = r.Ri - r.L, h = r.B - r.T;
  using (var b = new Bitmap(w, h)) { using (var g = Graphics.FromImage(b)) { IntPtr d = g.GetHdc(), s = GetDC(IntPtr.Zero); BitBlt(d, 0, 0, w, h, s, r.L, r.T, 0x40CC0020); ReleaseDC(IntPtr.Zero, s); g.ReleaseHdc(d); }
   Func<int,int,string> c = (x, y) => { var p = b.GetPixel(x, y); return (p.R > 128 ? "R" : "") + (p.G > 128 ? "G" : "") + (p.B > 128 ? "B" : ""); };
   return c(w / 5, h / 5) + "," + c(w * 4 / 5, h / 5) + "," + c(w / 5, h * 4 / 5) + "," + c(w * 4 / 5, h * 4 / 5); } } }
'@
[P]::Read(${hwnd})`;
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
  }).trim();
}
const ORIGINAL = 'R,G,B,RG';
const FLIPPED = 'RG,B,G,R';

const target = spawn(
  EXE,
  ['--test-target', '--x', '-600', '--y', '820', '--w', '400', '--h', '240'],
  { stdio: ['pipe', 'pipe', 'ignore'] },
);
const hwnd: number = await new Promise((resolve) =>
  target.stdout.once('data', (d: Buffer) =>
    resolve((JSON.parse(d.toString()) as { hwnd: number }).hwnd),
  ),
);
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1360, height: 980 },
  });
  await page.goto(BASE);
  await page.getByText('Moteur prêt').waitFor({ timeout: 15_000 });
  check(true, 'page Chaos ouverte, moteur prêt');
  check(
    (await page.locator('.cx-cat li').count()) >= 1,
    'catalogue lu dans le registre du moteur',
    `${await page.locator('.cx-cat li').count()} effet(s) public(s)`,
  );
  await page.screenshot({ path: join(OUT, '1-page.png'), fullPage: true });

  await page.locator('[data-refresh-targets]').click();
  await page.waitForTimeout(600);
  const listed = await page.locator('[data-target] option').count();
  check(
    listed > 1,
    'liste des fenêtres lue dans le moteur',
    `${listed - 1} fenêtre(s)`,
  );
  // La mire est une fenêtre outil (hors barre des tâches) : la liste l'écarte comme toute fenêtre outil. On l'ajoute au
  // sélecteur ; la demande suit ensuite le chemin réel (API Studio → moteur, qui valide la fenêtre).
  await page
    .locator('[data-target]')
    .evaluate((s: HTMLSelectElement, v: number) => {
      s.add(new Option('Mire de test', String(v)));
    }, hwnd);
  await page.locator('[data-target]').selectOption(String(hwnd));
  check(screen(hwnd) === ORIGINAL, 'mire visible avant l’essai', screen(hwnd));
  // La mire n'est jamais au premier plan : le réglage « seulement au premier plan » est coupé depuis le panneau.
  await page.locator('[data-panel]').first().click();
  await page.locator('.d-work.is-open').waitFor({ timeout: 3000 });
  const follow = page.getByRole('switch', {
    name: 'Seulement au premier plan',
  });
  if (await follow.isChecked()) await follow.click();
  await page.waitForTimeout(900);
  const cfgNow = (await (
    await page.request.get(`${BASE}/api/chaos/state`, {
      headers: { 'x-raptoru-studio': '1' },
    })
  ).json()) as {
    status: { config: { engine: { follow_foreground: boolean } } };
  };
  check(
    cfgNow.status.config.engine.follow_foreground === false,
    'réglage moteur changé depuis le panneau, enregistré par le moteur',
  );
  await page.locator('[data-pclose]').click();
  await page.locator('[data-test]').click();
  await page.locator('.cx-live .d-tag.ok').waitFor({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 900)); // fin de la rotation d'entrée (0,55 s)
  const during = screen(hwnd);
  check(
    during === FLIPPED,
    '« Tester » depuis la page : la fenêtre est réellement retournée à l’écran',
    during,
  );
  await page.screenshot({ path: join(OUT, '2-en-cours.png'), fullPage: true });

  await page.locator('[data-stopall]').click();
  await page.getByText('Aucun effet en cours.').waitFor({ timeout: 5000 });
  await new Promise((r) => setTimeout(r, 150));
  check(
    screen(hwnd) === ORIGINAL,
    'STOP ALL depuis la page : écran normal',
    screen(hwnd),
  );

  await page.locator('[data-fill="black"]').click();
  await page.waitForTimeout(800);
  const st = (await (
    await page.request.get(`${BASE}/api/chaos/state`, {
      headers: { 'x-raptoru-studio': '1' },
    })
  ).json()) as {
    status: {
      config: {
        presets: { flip?: { default?: { params?: { fill?: string } } } };
      };
    };
  };
  check(
    st.status.config.presets.flip?.default?.params?.fill === 'black',
    'réglage des coins enregistré par le moteur (préréglage « default »)',
  );
  await page.locator('[data-replay]').click();
  await page.waitForTimeout(450);
  await page
    .locator('.cx-stage')
    .screenshot({ path: join(OUT, '3-apercu-rotation.png') });
  await page.locator('[data-fill="mirror"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-panel]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, '4-reglages.png'), fullPage: true });
  await page.setViewportSize({ width: 760, height: 1100 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(OUT, '5-fenetre-etroite.png'),
    fullPage: true,
  });
} finally {
  await fetch(`${BASE}/api/chaos/config`, {
    method: 'POST',
    headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
    body: JSON.stringify({
      section: 'engine',
      values: { follow_foreground: true },
    }),
  }).catch(() => null);
  await browser.close();
  target.kill();
}
console.log(`Total : ${ok} ok, ${ko} KO · captures : ${OUT}`);
process.exit(ko ? 1 : 0);
