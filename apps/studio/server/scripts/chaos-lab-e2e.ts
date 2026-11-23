// Parcours de la page Studio › Chaos (catalogue et fiches) dans un Chromium sans fenêtre, contre un Chaos Lab en marche
// (npm run chaos:lab -- --no-open). Deux parties :
//   A. sans rien afficher à l'écran (toujours) : catalogue lu dans le registre, fiche du retournement, écrans rangés de
//      gauche à droite, chaque réglage enregistré par le moteur puis relu après rechargement, ni sélecteur global ni
//      compte à rebours, méthode technique seulement dans « Diagnostic avancé » ;
//   B. VISIBLE (garde de jeu) : « Tester » puis « Arrêter », « Activer » puis STOP ALL, sur l'écran choisi, état réel
//      du moteur dans la fiche et sur la carte.
// Les réglages du Lab sont relus au départ et remis à l'identique à la fin. Captures dans --out <dossier>.
// Usage : tsx apps/studio/server/scripts/chaos-lab-e2e.ts [--out <dossier>] [--port 4120] [--autorise-pendant-un-jeu]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

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
const H = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
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

interface Fx {
  enabled: boolean;
  screen: string;
  cursor: boolean;
}
interface FlipPreset {
  duration_ms?: number;
  params?: { fill?: string };
  transition?: { in?: { duration_ms?: number }; out?: { kind?: string } };
}
interface St {
  status: {
    active: { effect: string; state: string; target: { screen?: string } }[];
    config: {
      effects: Record<string, Fx>;
      presets: Record<string, { default?: FlipPreset }>;
    };
  };
}
const state = async () =>
  (await (await fetch(`${BASE}/api/chaos/state`, { headers: H })).json()) as St;
const post = (path: string, body: unknown) =>
  fetch(`${BASE}/api/chaos${path}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
  });
const until = async (f: () => Promise<boolean>, ms: number) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await f()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

/** Aucun essai visible pendant un jeu (incident du 22/11) : la partie B ne tourne que si la garde le permet. */
function guard(): string | null {
  try {
    execFileSync(EXE, ['--game-check'], { encoding: 'utf8' });
    return null;
  } catch (e) {
    return (
      String((e as { stdout?: string }).stdout ?? '').trim() || 'jeu détecté'
    );
  }
}

const before = await state();
const savedFx = before.status.config.effects.flip;
const savedPreset = before.status.config.presets.flip?.default ?? {};
const browser = await chromium.launch();
const sheetSays = (page: Page) => page.locator('.cx-run').innerText();
const diagSwitch = (page: Page) =>
  page.getByRole('switch', { name: 'Afficher les effets de diagnostic' });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 },
  });
  await page.goto(BASE);
  await page.getByText('Moteur prêt').waitFor({ timeout: 15_000 });
  check(true, 'page Chaos ouverte, moteur prêt');

  // ---------- A. Sans rien afficher ----------
  const cards = page.locator('.cx-fx');
  await cards.first().waitFor({ timeout: 5000 });
  check(
    (await page.locator('.cx-fx', { hasText: 'Écran retourné' }).count()) === 1,
    'catalogue lu dans le registre : une carte « Écran retourné »',
    `${await cards.count()} carte(s)`,
  );
  check(
    (await page.locator('[data-effect], [data-target]').count()) === 0 &&
      !(await page.content()).includes('Dans 3 s'),
    'ni liste déroulante globale d’effets ou de cibles, ni compte à rebours',
  );
  await page.locator('[data-open="flip"]').click();
  await page
    .locator('.cx-sheet__id h2', { hasText: 'Écran retourné' })
    .waitFor();
  check(true, 'clic sur la carte : fiche du retournement ouverte');
  await page.locator('[data-screen]').first().waitFor({ timeout: 8000 });
  const screens = (await (
    await fetch(`${BASE}/api/chaos/screens`, { headers: H })
  ).json()) as { monitors: { key: string; label: string; x: number }[] };
  const shown = await page.locator('[data-screen]').allInnerTexts();
  const byX = [...screens.monitors].sort((a, b) => a.x - b.x);
  check(
    byX.every((m, i) => shown[i]?.startsWith(m.label)) &&
      (screens.monitors.length < 2 ||
        shown[shown.length - 1] === 'Tous les écrans'),
    'écrans de la fiche rangés de gauche à droite, nommés pour le streamer',
    shown.join(' | '),
  );
  check(
    (await page.locator('.cx__main [data-method]').count()) === 0,
    'aucun choix de méthode technique dans l’usage ordinaire',
  );
  await page.screenshot({ path: join(OUT, '1-catalogue-fiche.png') });

  // Chaque réglage, enregistré par le moteur.
  const left = 'left';
  await page.locator(`[data-screen="${left}"]`).click();
  await page.locator('[data-dur="20000"]').click();
  await page.locator('[data-tr-out="cut"]').click();
  await page.locator('[data-pid="fill"][data-param="black"]').click();
  const inMs = page.locator('[data-tr-ms-in]');
  await inMs.fill('800');
  await inMs.blur();
  await page.locator('[data-fxcfg="cursor"]').click();
  const saved = await until(async () => {
    const c = (await state()).status.config;
    const p = c.presets.flip?.default;
    return (
      c.effects.flip?.screen === left &&
      c.effects.flip?.cursor === !(savedFx?.cursor ?? true) &&
      p?.duration_ms === 20000 &&
      p?.params?.fill === 'black' &&
      p?.transition?.out?.kind === 'cut' &&
      p?.transition?.in?.duration_ms === 800
    );
  }, 5000);
  check(
    saved,
    'écran, durée, entrée, sortie, coins et curseur enregistrés par le moteur',
  );
  await page.reload();
  await page.locator('[data-screen]').first().waitFor({ timeout: 8000 });
  check(
    (await page.locator(`[data-screen="${left}"].on`).count()) === 1 &&
      (await page.locator('[data-dur="20000"].on').count()) === 1 &&
      (await page
        .locator('[data-pid="fill"][data-param="black"].on')
        .count()) === 1 &&
      (await page.locator('[data-tr-out="cut"].on').count()) === 1 &&
      (await page.locator('[data-tr-ms-in]').inputValue()) === '800',
    'après rechargement : la fiche retrouve exactement ces réglages',
  );
  await page.locator('[data-fxcfg="enabled"]').click();
  check(
    await until(
      async () => (await state()).status.config.effects.flip?.enabled === false,
      4000,
    ),
    'disponibilité coupée : enregistrée',
  );
  await page
    .locator('.cx-fx', { hasText: 'Désactivé' })
    .first()
    .waitFor({ timeout: 4000 });
  check(true, 'la carte dit « Désactivé »');
  await page.locator('[data-fxcfg="enabled"]').click();
  await diagSwitch(page).click();
  check(
    (await page.locator('.cx-fx.is-diag').count()) >= 1,
    'diagnostic : effets internes montrés à part',
  );
  await diagSwitch(page).click();
  await page.locator('[data-panel]').first().click();
  await page.locator('.d-work.is-open').waitFor({ timeout: 3000 });
  check(
    (await page.locator('.d-panel [data-method]').count()) === 2,
    'méthode Windows (expérimentale) seulement dans « Diagnostic avancé »',
  );
  await page.screenshot({ path: join(OUT, '2-reglages.png') });
  await page.locator('[data-pclose]').click();

  // Les commandes des boutons jusqu'au vrai moteur, sans rien afficher (incident « commande inconnue :
  // effect.activate » du 23/11) : écran enregistré débranché → le moteur refuse « Tester » comme tel et rien ne
  // démarre ; « Arrêter » d'un effet arrêté et STOP ALL (bouton de la page) sont acceptés.
  await post('/config', {
    section: 'effects',
    values: { flip: { ...savedFx, screen: 's:9' } },
  });
  const refused = (await (
    await post('/activate', { effect: 'flip', kind: 'test' })
  ).json()) as { error?: string };
  check(
    refused.error === 'screen_missing' &&
      (await state()).status.active.length === 0,
    '« Tester » jusqu’au moteur : écran débranché refusé comme tel, rien ne démarre',
    refused.error ?? '',
  );
  await post('/config', { section: 'effects', values: { flip: savedFx } });
  const stopped = (await (await post('/stop', { effect: 'flip' })).json()) as {
    stopped?: number;
  };
  check(
    stopped.stopped === 0,
    '« Arrêter » jusqu’au moteur : accepté (rien en cours)',
  );
  await page.locator('[data-stopall]').click();
  await page.waitForTimeout(800);
  check(
    (await page.locator('.d-toast.bad').count()) === 0,
    'STOP ALL depuis la page : accepté par le moteur, aucune erreur',
  );

  // ---------- B. Visible : Tester, Arrêter, Activer, STOP ALL ----------
  const why = guard();
  if (why && !args.includes('--autorise-pendant-un-jeu'))
    console.log(
      `  ··  partie visible NON lancée : ${why} (accord d’Antoni : --autorise-pendant-un-jeu)`,
    );
  else {
    await page.locator('[data-act="test"]').click();
    await until(async () => (await sheetSays(page)).includes('En cours'), 6000);
    const row = (await state()).status.active.find((a) => a.effect === 'flip');
    check(
      !!row && (await sheetSays(page)).includes('En cours'),
      '« Tester » : tout de suite, sur l’écran choisi, état du moteur dans la fiche',
      row?.target.screen ?? '',
    );
    await page.screenshot({ path: join(OUT, '3-en-cours.png') });
    await page.locator('[data-act-run][data-stop]').click();
    check(
      await until(async () => (await state()).status.active.length === 0, 5000),
      '« Arrêter » : l’effet s’arrête',
    );
    await page.locator('[data-act-run]:not([data-stop])').click();
    await until(async () => (await sheetSays(page)).includes('reste'), 6000);
    check(
      (await sheetSays(page)).includes('reste') &&
        (await page.locator('.cx-fx.is-on').count()) === 1,
      '« Activer » : durée restante dans la fiche, carte « en cours »',
    );
    await page.locator('[data-stopall]').click();
    check(
      await until(async () => (await state()).status.active.length === 0, 3000),
      'STOP ALL : tout s’arrête',
    );
  }
  await page.setViewportSize({ width: 760, height: 1200 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(OUT, '4-fenetre-etroite.png'),
    fullPage: true,
  });
} finally {
  // Les réglages du Lab reviennent à l'identique.
  await post('/stop-all', {}).catch(() => null);
  if (savedFx)
    await post('/config', {
      section: 'effects',
      values: { flip: savedFx },
    }).catch(() => null);
  await post('/preset', {
    effect: 'flip',
    name: 'default',
    value: savedPreset,
  }).catch(() => null);
  await browser.close();
}
console.log(`Total : ${ok} ok, ${ko} KO · captures : ${OUT}`);
process.exit(ko ? 1 : 0);
