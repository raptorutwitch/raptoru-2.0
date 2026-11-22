// Parcours complet de la page Studio › Chaos dans un Chromium sans fenêtre, contre un Chaos Lab en marche
// (npm run chaos:lab -- --no-open) : moteur prêt → écran secondaire choisi → « Tester » → Windows retourne réellement
// l'écran (orientation relue) → STOP ALL → écran rétabli ; puis, en diagnostic, la mire en fenêtre seule (pixels lus à
// l'écran) → réglage des coins enregistré dans le moteur. Captures dans --out <dossier>.
// Usage : tsx apps/studio/server/scripts/chaos-lab-e2e.ts [--out <dossier>] [--port 4120] [--autorise-pendant-un-jeu]
// Garde : refuse de tourner si un jeu ou une application plein écran est actif (essais visibles), sauf accord d'Antoni.
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
const EXE =
  process.env.CHAOS_ENGINE_EXE ??
  join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe');
mkdirSync(OUT, { recursive: true });

// Incident du 22/11 : des rotations d'essai ont fait tomber Overwatch à 17 images/s. Aucun essai visible pendant un jeu.
try {
  execFileSync(EXE, ['--game-check'], { encoding: 'utf8' });
} catch (e) {
  const why = String((e as { stdout?: string }).stdout ?? '').trim();
  if (!args.includes('--autorise-pendant-un-jeu')) {
    console.log(
      `Parcours NON lancé : ${why || 'jeu détecté'} (accord d’Antoni : --autorise-pendant-un-jeu).`,
    );
    process.exit(2);
  }
}

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
/** Orientation d'un écran (0 normale, 2 = 180°), relue dans Windows (une capture GDI le montre toujours à l'endroit). */
function orientation(device: string): number {
  const ps = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class O {
 [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct DM { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string n; public short a, b, size, extra; public int fields, x, y, orient, fixedOut; public short c1, c2, c3, c4, c5; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string form; public short lp; public int bpp, w, h, fl, hz, i1, i2, i3, i4, r1, r2, pw, ph; }
 [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettingsExW(string d, int m, ref DM dm, uint f);
 public static int Get(string d) { var dm = new DM(); dm.size = (short)Marshal.SizeOf(dm); return EnumDisplaySettingsExW(d, -1, ref dm, 0) ? dm.orient : -1; } }
'@
[O]::Get('${device}')`;
  return Number(
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
    }).trim(),
  );
}
async function waitOrientation(device: string, want: number, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (orientation(device) === want) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 50));
  }
  return -1;
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
let screenDevice = '';
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
  const first = await page.locator('[data-target] option').first().innerText();
  const screens = await page
    .locator('[data-target] option[value^="mon:"]')
    .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  check(
    first.startsWith('Écran du jeu au premier plan') && screens.length >= 1,
    'cible par défaut : l’écran du jeu ; écrans lus dans le moteur',
    `${screens.length} écran(s)`,
  );

  // Écran entier (comportement voulu) : sur l'écran secondaire seulement, jamais sur l'écran principal.
  const targets = (await (
    await page.request.get(`${BASE}/api/chaos/targets`, {
      headers: { 'x-raptoru-studio': '1' },
    })
  ).json()) as { monitors: { device: string; primary: boolean }[] };
  screenDevice = targets.monitors.find((m) => !m.primary)?.device ?? '';
  if (screenDevice && orientation(screenDevice) === 0) {
    await page.locator('[data-target]').selectOption(`mon:${screenDevice}`);
    await page.locator('[data-test]').click();
    const flipped = await waitOrientation(screenDevice, 2, 5000);
    await page.locator('.cx-live .d-tag.ok').waitFor({ timeout: 5000 });
    const live = await page.locator('.cx-live').innerText();
    check(
      flipped >= 0 && live.includes('souris inversée'),
      '« Tester » sur l’écran secondaire : Windows retourne l’écran, la page dit « souris inversée »',
      'orientation relue dans Windows (temps précis : chaos-checks)',
    );
    await page.screenshot({
      path: join(OUT, '2-ecran-retourne.png'),
      fullPage: true,
    });
    await page.locator('[data-stopall]').click();
    const back = await waitOrientation(screenDevice, 0, 3000);
    await page.getByText('Aucun effet en cours.').waitFor({ timeout: 5000 });
    check(
      back >= 0,
      'STOP ALL depuis la page : écran rétabli',
      'orientation relue dans Windows',
    );
  } else
    console.log(
      '  ··  un seul écran (ou déjà tourné) : essai écran entier non fait',
    );

  // Diagnostic : la fenêtre seule (visuel uniquement) sur la mire, lue aux pixels.
  await page.getByRole('switch', { name: 'Afficher le diagnostic' }).click();
  await page.waitForTimeout(300);
  const listed = await page.locator('[data-target] optgroup option').count();
  check(
    listed >= 1,
    'diagnostic : fenêtres lues dans le moteur (fenêtre seule)',
    `${listed} fenêtre(s)`,
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
    name: 'Fenêtre seule : seulement au premier plan',
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
    '« Tester » (fenêtre seule) : la mire est réellement retournée à l’écran',
    during,
  );
  await page.screenshot({
    path: join(OUT, '3-fenetre-seule.png'),
    fullPage: true,
  });

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
    .screenshot({ path: join(OUT, '4-apercu-rotation.png') });
  await page.locator('[data-fill="mirror"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-panel]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, '5-reglages.png'), fullPage: true });
  await page.setViewportSize({ width: 760, height: 1100 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(OUT, '6-fenetre-etroite.png'),
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
  if (screenDevice && orientation(screenDevice) !== 0) {
    execFileSync(EXE, ['--restore-display']);
    check(false, 'écran secondaire rétabli par le parcours lui-même (secours)');
  }
}
console.log(`Total : ${ok} ok, ${ko} KO · captures : ${OUT}`);
process.exit(ko ? 1 : 0);
