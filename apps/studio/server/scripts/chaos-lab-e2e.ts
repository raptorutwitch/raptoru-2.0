// Parcours de la page Studio › Chaos (catalogue et fiches) dans un Chromium sans fenêtre, contre un Chaos Lab en marche
// (npm run chaos:lab -- --no-open). Deux parties :
//   A. sans rien afficher à l'écran (toujours) : catalogue lu dans le registre, fiche du retournement, écrans rangés de
//      gauche à droite, chaque réglage enregistré par le moteur puis relu après rechargement, ni sélecteur global ni
//      compte à rebours, méthode technique seulement dans « Diagnostic avancé » ; catalogue V2 (préréglages en un clic,
//      réglages avancés repliés, point visé choisi d'un clic, aperçu rendu par le moteur hors écran) ;
//   B. VISIBLE (garde de jeu) : « Tester » puis « Arrêter », « Activer » puis STOP ALL, sur l'écran choisi, état réel
//      du moteur dans la fiche et sur la carte.
// Les réglages du Lab sont relus au départ et remis à l'identique à la fin. Captures dans --out <dossier>.
// Usage : tsx apps/studio/server/scripts/chaos-lab-e2e.ts [--out <dossier>] [--port 4120] [--non-visible] [--autorise-pendant-un-jeu]
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
// Fiches du catalogue V2 touchées par le parcours : remises à l'identique à la fin.
const V2 = ['fog', 'tunnel', 'blink'];
const savedV2 = Object.fromEntries(
  V2.map((id) => [id, before.status.config.presets[id]?.default ?? {}]),
);
interface V2Preset {
  params?: Record<string, unknown>;
  duration_ms?: number;
}
const presetOf = async (id: string) =>
  ((await state()).status.config.presets[id]?.default ?? {}) as V2Preset;
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

  // ---------- A2. Catalogue V2, sans rien afficher ----------
  check(
    (await page.locator('.cx-fx:not(.is-diag)').count()) >= 13,
    'catalogue V2 : 13 effets (miroir, tremblement, zoom, ivre, tunnel, clignement, flash, brouillard, flou, pixelisation, couleur, VHS)',
    `${await page.locator('.cx-fx:not(.is-diag)').count()} carte(s)`,
  );
  await page.locator('[data-open="fog"]').click();
  await page.locator('.cx-sheet__id h2', { hasText: 'Brouillard' }).waitFor();
  const chips = await page.locator('[data-variant]').allInnerTexts();
  const levels = await page.locator('[data-level]').allInnerTexts();
  check(
    chips.includes('Nappes') &&
      chips.includes('Bancs mouvants') &&
      levels.join('|') === 'Brume légère|Marqué|Dense|Occultant|Personnalisé' &&
      (await page.locator('[data-level="marque"].on').count()) === 1 &&
      (await page.locator('details.cx-adv:not([open])').count()) === 1,
    'fiche du brouillard : style (préréglages) et intensité (Brume légère → Occultant, Personnalisé) en un clic, réglages avancés repliés ; fiche neuve = Marqué',
    `${chips.join(' | ')} — ${levels.join(' | ')}`,
  );
  const animLoaded = await until(
    async () =>
      (await page
        .locator('.cx-anim__img')
        .evaluate((el) => (el as HTMLElement).style.backgroundImage)) !== '',
    20_000,
  );
  check(
    animLoaded,
    'aperçu animé rendu par le moteur hors écran, avec les réglages de la fiche',
  );
  await page.waitForTimeout(1200);
  await page
    .locator('.cx-sheet')
    .screenshot({ path: join(OUT, '5-fiche-brouillard.png') });
  await page.locator('[data-level="extreme"]').click();
  check(
    await until(async () => {
      const p = await presetOf('fog');
      return (
        p.params?.density === 0.95 &&
        p.params?.thickness === 0.9 &&
        p.params?.masses === 0.9
      );
    }, 5000),
    'intensité « Occultant » : enregistrée par le moteur',
  );
  await page.locator('[data-level="extreme"].on').waitFor({ timeout: 4000 });
  check(true, 'le niveau choisi est montré comme actif');
  await page.locator('[data-variant="bancs"]').click();
  check(
    await until(async () => {
      const p = await presetOf('fog');
      return p.params?.mode === 'intermittent' && p.params?.thickness === 0.9;
    }, 5000),
    'changer de style garde l’intensité choisie (bancs mouvants, toujours occultant)',
  );
  await page.locator('[data-variant="bancs"].on').waitFor({ timeout: 4000 });
  await page.locator('[data-level="extreme"].on').waitFor({ timeout: 4000 });
  check(true, 'style et intensité montrés actifs ensemble');
  await page.locator('details.cx-adv > summary').click();
  check(
    (await page.locator('details.cx-adv[open] [data-param-num]').count()) >= 5,
    'réglages avancés dépliés : densité des nappes, vent, turbulence…',
  );
  await page.locator('[data-open="tunnel"]').click();
  await page
    .locator('.cx-sheet__id h2', { hasText: 'Vision tunnel' })
    .waitFor();
  const pick = page.locator('.cx-point');
  const box = await pick.boundingBox();
  if (box)
    await pick.click({
      position: { x: box.width * 0.25, y: box.height * 0.75 },
    });
  check(
    await until(async () => {
      const p = await presetOf('tunnel');
      return (
        Math.abs(Number(p.params?.focus_x) - 0.25) <= 0.02 &&
        Math.abs(Number(p.params?.focus_y) - 0.75) <= 0.02
      );
    }, 5000),
    'vision tunnel : point visé choisi d’un clic dans l’écran miniature (coordonnées relatives)',
  );
  await pick.focus();
  await page.keyboard.press('ArrowRight');
  check(
    await until(
      async () =>
        Math.abs(Number((await presetOf('tunnel')).params?.focus_x) - 0.3) <=
        0.02,
      5000,
    ),
    'point visé au clavier (flèches)',
  );
  await page.waitForTimeout(1500);
  await page
    .locator('.cx-sheet')
    .screenshot({ path: join(OUT, '6-fiche-tunnel.png') });
  await page.locator('[data-open="blink"]').click();
  await page.locator('.cx-sheet__id h2', { hasText: 'Clignement' }).waitFor();
  await page.waitForTimeout(2500);
  await page
    .locator('.cx-sheet')
    .screenshot({ path: join(OUT, '7-fiche-clignement.png') });
  const bad = (await (
    await post('/preview', {
      effect: 'zoom',
      preset: { params: { factor: 99 } },
    })
  ).json()) as { error?: string };
  check(
    bad.error === 'param_out_of_range',
    'aperçu : réglage hors bornes refusé comme le moteur le refuserait',
    bad.error ?? '',
  );
  await page.locator('[data-open="flip"]').click();

  // ---------- A3. Performance Lab (rien d'affiché : banc refusé pendant un jeu, sinon annulé aussitôt) ----------
  await page.locator('[data-perf-open]').click();
  await page
    .locator('.cx-perf:not([hidden]) h2', { hasText: 'Performance Lab' })
    .waitFor();
  check(
    await until(
      async () =>
        (await page.locator('.cx-perf__sys dd').count()) >= 5 &&
        !(
          await page.locator('.cx-perf__sys dd').first().innerText()
        ).startsWith('—'),
      20_000,
    ),
    'Performance Lab : matériel lu (carte graphique, processeur, mémoire, système, écrans)',
  );
  const perfText = await page.locator('.cx-perf').innerText();
  check(
    (await page.locator('[data-perf-screen]').count()) >= 1 &&
      (await page.locator('[data-perf-live-start]').count()) === 1 &&
      perfText.includes('Banc hors écran') &&
      perfText.includes('Validation en jeu') &&
      perfText.includes('ne sont pas mesurées'),
    'deux modes séparés : banc hors écran (écran de référence) et validation en jeu manuelle ; images/s du jeu dites non mesurées',
  );
  await page.locator('[data-perf-start]').click();
  // Lancé pour de bon = un cas en cours affiché (« n/N · effet ») ; sinon le refus du moteur, avec sa raison.
  const started = await until(
    async () =>
      (await page.locator('.cx-perf__run .d-faint', { hasText: '·' }).count()) >
        0 ||
      (await page.locator('.cx-perf .d-note', { hasText: 'jeu' }).count()) > 0,
    20_000,
  );
  const perfRefused =
    (await page.locator('.cx-perf .d-note', { hasText: 'jeu' }).count()) > 0;
  if (!perfRefused && (await page.locator('[data-perf-cancel]').count()))
    await page.locator('[data-perf-cancel]').click();
  check(
    started,
    perfRefused
      ? 'banc hors écran refusé pendant un jeu, raison affichée'
      : 'banc hors écran lancé (progression), puis annulé',
  );
  await page.waitForTimeout(800);
  await page
    .locator('.cx-perf')
    .screenshot({ path: join(OUT, '8-performance-lab.png') });
  await page.locator('[data-perf-close]').click();
  check(
    (await page.locator('.cx-perf[hidden]').count()) === 1,
    'Performance Lab refermé',
  );

  // ---------- A4. Diffusion OBS (mode C, rien d'affiché ; le Lab n'a pas d'OBS) ----------
  await page.locator('[data-obs-open]').click();
  await page
    .locator('.cx-obs:not([hidden]) h2', { hasText: 'Diffusion OBS' })
    .waitFor({ timeout: 10_000 });
  const modeOn = async () =>
    (
      await page
        .locator('.cx-obs [data-obs-mode][aria-pressed="true"]')
        .innerText()
    ).trim();
  const obsText = await page.locator('.cx-obs').innerText();
  check(
    (await modeOn()) === 'Écran + OBS',
    'Diffusion OBS : « Écran + OBS » par défaut',
    await modeOn(),
  );
  check(
    /OBS non connecté/.test(obsText) && /Écran \+ OBS incomplet/.test(obsText),
    'sans OBS : le mode C se dit incomplet, avec la raison (les effets partent sur l’écran seul)',
  );
  check(
    await page.locator('.cx-obs [data-obs-preview]').isDisabled(),
    '« Préparer les filtres OBS… » indisponible sans OBS (rien ne peut être créé)',
  );
  await page.locator('.cx-obs [data-obs-mode="screen"]').click();
  await page.waitForTimeout(600);
  const obsSaved = (await (
    await fetch(`${BASE}/api/chaos/obs`, { headers: H })
  ).json()) as { config: { mode: string } };
  check(
    obsSaved.config.mode === 'screen' && (await modeOn()) === 'Écran uniquement',
    'mode « Écran uniquement » enregistré',
  );
  await page.locator('.cx-obs [data-obs-mode="both"]').click();
  await page.waitForTimeout(600);
  check((await modeOn()) === 'Écran + OBS', 'mode « Écran + OBS » rétabli');
  await page
    .locator('.cx-obs')
    .screenshot({ path: join(OUT, '9-diffusion-obs.png') });
  await page.locator('[data-obs-open]').click();
  check(
    (await page.locator('.cx-obs[hidden]').count()) === 1,
    'Diffusion OBS refermé',
  );

  // ---------- B. Visible : Tester, Arrêter, Activer, STOP ALL ----------
  // --non-visible : jamais la partie B (lancement automatique par un agent : aucun test visible, garde libre ou non).
  const why = args.includes('--non-visible') ? 'option --non-visible' : guard();
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
  for (const id of V2)
    await post('/preset', {
      effect: id,
      name: 'default',
      value: savedV2[id],
    }).catch(() => null);
  await browser.close();
}
console.log(`Total : ${ok} ok, ${ko} KO · captures : ${OUT}`);
process.exit(ko ? 1 : 0);
