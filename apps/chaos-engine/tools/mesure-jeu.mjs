// Banc en jeu des effets Chaos (docs/chaos/BENCH_EFFETS.md, phase C). AUCUN contrôle : ni du jeu, ni des entrées, ni
// d'OBS, ni des effets. Antoni joue et déclenche les effets lui-même (Studio › Chaos › Performance Lab › Validation en
// jeu) ; cet outil ENREGISTRE seulement, pendant ce temps :
//   - PresentMon (traces Windows) : chaque image du jeu (durée, mode de présentation, GPU et CPU du jeu) ;
//   - ChaosEngine.exe --perf-monitor : GPU et processeur par processus (jeu, Chaos, compositeur dwm, OBS), 2 fois/s ;
//   - nvidia-smi : charge et fréquences de la carte graphique, 2 fois/s ;
//   - Studio (lecture seule, 127.0.0.1) : effets actifs (4 fois/s) et compteurs d'OBS par la connexion de Studio (1 fois/s).
// Les étapes (Overwatch seul, + OBS, + Chaos au repos, effets) se marquent avec Entrée dans cette console. Tout est
// horodaté sur la même horloge (compteur de performances de Windows, en ms). À la fin (« q » puis Entrée) : rapport.md
// et synthese.json dans le dossier de la mesure.
// --ab : test A/B minimal (calque neutre, Miroir, Brouillard) enchaîné par le Performance Lab de Studio, sans Alt+Tab.
//
//   node apps/chaos-engine/tools/mesure-jeu.mjs [--ab] [--out <dossier>] [--process Overwatch.exe] [--presentmon <exe>]
//   node apps/chaos-engine/tools/mesure-jeu.mjs --analyse <dossier>      (refait le rapport d'une mesure)
//   node apps/chaos-engine/tools/mesure-jeu.mjs --self-test              (vérifie l'analyse sur une mesure de synthèse)
//
// PresentMon demande un terminal administrateur (ou le groupe « Utilisateurs du journal de performances »).
/* global process, console, fetch, AbortSignal, setInterval, clearInterval, setTimeout */
import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { AB_PHASES, AB_PLAN, abRun } from './ab-run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const now = () => Number(process.hrtime.bigint()) / 1e6; // QPC en ms (libuv), comme CPUStartQPCTimeInMs de PresentMon

export const STEPS = [
  ['overwatch-seul', 'Overwatch seul (OBS et Studio fermés)'],
  ['obs-sans-chaos', 'Overwatch + OBS (Studio fermé)'],
  ['chaos-repos', 'Overwatch + OBS + Studio ouvert, aucun effet'],
  [
    'effets',
    'Overwatch + OBS + Studio : un effet à la fois (Performance Lab › Validation en jeu)',
  ],
];

// ---------------------------------------------------------------- enregistrement
async function record() {
  const game = arg('--process', 'Overwatch.exe');
  const studio = arg('--studio', 'http://127.0.0.1:4100');
  const pmExe = arg(
    '--presentmon',
    join(ROOT, '.tools', 'presentmon', 'PresentMon-2.6.0-x64.exe'),
  );
  const installed = join(
    process.env.LOCALAPPDATA ?? '',
    'Programs',
    'Raptoru Studio',
    'resources',
    'app',
    'apps',
    'chaos-engine',
    'bin',
    'ChaosEngine.exe',
  );
  const engine = arg(
    '--engine',
    existsSync(installed)
      ? installed
      : join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe'),
  );
  const d = new Date(),
    p2 = (x) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}h${p2(d.getMinutes())}`;
  const dir = resolve(
    arg('--out', join(ROOT, 'docs', 'chaos', 'bench', `jeu-${stamp}`)),
  );
  if (spawnSync('net', ['session'], { stdio: 'ignore' }).status !== 0) {
    console.error(
      'PresentMon a besoin d’un terminal ADMINISTRATEUR : clic droit sur le Terminal › Exécuter en tant qu’administrateur, puis relancer.',
    );
    process.exit(2);
  }
  for (const [what, f] of [
    ['PresentMon', pmExe],
    ['ChaosEngine.exe', engine],
  ])
    if (!existsSync(f)) {
      console.error(`${what} introuvable : ${f}`);
      process.exit(2);
    }
  mkdirSync(dir, { recursive: true });
  const files = {};
  const out = (name) =>
    (files[name] ??= createWriteStream(join(dir, name), { flags: 'a' }));
  const log = (name, o) =>
    out(name).write(
      JSON.stringify({ qpc_ms: Math.round(now() * 10) / 10, ...o }) + '\n',
    );
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify(
      {
        game,
        studio,
        engine,
        presentmon: pmExe,
        started: new Date().toISOString(),
        qpc_ms: now(),
      },
      null,
      1,
    ),
  );

  const session = 'RaptoruMesureJeu';
  const pm = spawn(
    pmExe,
    [
      '--process_name',
      game,
      '--output_file',
      join(dir, 'presentmon.csv'),
      '--qpc_time_ms',
      '--no_console_stats',
      '--session_name',
      session,
      '--stop_existing_session',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  const mon = spawn(
    engine,
    [
      '--perf-monitor',
      '--interval-ms',
      '500',
      '--parent',
      String(process.pid),
      '--deadline-ms',
      '10800000',
    ],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
  );
  createInterface({ input: mon.stdout }).on('line', (l) => {
    try {
      log('monitor.jsonl', JSON.parse(l));
    } catch {
      /* ligne incomplète */
    }
  });
  const smi = spawn(
    'nvidia-smi',
    [
      '--query-gpu=utilization.gpu,utilization.encoder,clocks.gr,clocks.mem,power.draw,memory.used,temperature.gpu,pstate',
      '--format=csv,noheader,nounits',
      '-lms',
      '500',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  );
  smi.on('error', () => {});
  createInterface({ input: smi.stdout }).on('line', (l) => {
    const [gpu, enc, clk, mclk, w, mem, temp, ps] = l
      .split(',')
      .map((x) => x.trim());
    log('gpu.jsonl', {
      gpu_pct: +gpu,
      nvenc_pct: +enc,
      clock_mhz: +clk,
      mem_clock_mhz: +mclk,
      power_w: +w,
      vram_mb: +mem,
      temp_c: +temp,
      pstate: ps,
    });
  });

  const get = async (path) => {
    const r = await fetch(studio + path, {
      headers: { 'x-raptoru-studio': '1' },
      signal: AbortSignal.timeout(800),
    });
    return { status: r.status, body: r.status === 200 ? await r.json() : null };
  };
  let lastChaos = '',
    obsStats = true,
    seen = new Set(),
    step = null;
  const chaosTimer = setInterval(async () => {
    let s;
    try {
      const st = await get('/api/chaos/state');
      const act = (st.body?.status?.active ?? []).map((a) => ({
        effect: a.effect,
        state: a.state,
        request_id: a.request_id,
        in_ms: a.resolved?.transition?.in?.duration_ms ?? 0,
        duration_ms: a.resolved?.duration_ms ?? null,
        running_ms: a.running_ms ?? null,
        variant: a.variant ?? null,
        level: a.resolved?.level ?? null,
      }));
      for (const a of act) seen.add(a.effect);
      s = JSON.stringify({
        studio: true,
        // running_ms change à chaque relevé : hors de la comparaison.
        active: act.map((x) => ({ ...x, running_ms: undefined })),
      });
      if (s !== lastChaos) log('chaos.jsonl', { studio: true, active: act });
    } catch {
      s = JSON.stringify({ studio: false });
      if (s !== lastChaos) log('chaos.jsonl', { studio: false, active: [] });
    }
    lastChaos = s;
  }, 250);
  const obsTimer = setInterval(async () => {
    if (!obsStats) return;
    try {
      const r = await get('/api/chaos/obs/stats');
      if (r.status === 404) {
        obsStats = false;
        log('obs.jsonl', {
          unavailable:
            'Studio sans /obs/stats (avant chaos.9) : lire le dock Statistiques d’OBS',
        });
      } else
        log(
          'obs.jsonl',
          r.status === 200 ? { stats: r.body } : { offline: true },
        );
    } catch {
      /* Studio fermé */
    }
  }, 1000);

  console.log(
    `\nMesure en cours → ${dir}\nJeu suivi : ${game}. Rien n'est contrôlé : tu joues et tu déclenches les effets toi-même.\n`,
  );
  console.log(
    'Étapes : Entrée = étape suivante (ou tape un nom puis Entrée) ; « q » puis Entrée = fin et rapport.',
  );
  STEPS.forEach(([id, label], i) =>
    console.log(`  ${i + 1}. ${id.padEnd(15)} ${label}`),
  );
  let next = 0;
  const mark = (id) => {
    step = id;
    log('steps.jsonl', { step: id });
    console.log(
      `\n▶ ${new Date().toLocaleTimeString('fr-FR')} étape « ${id} »`,
    );
  };
  const beat = setInterval(
    () =>
      step &&
      console.log(
        `  … ${step} · effets vus : ${[...seen].join(', ') || 'aucun'}`,
      ),
    30000,
  );
  const post = async (path, body) => {
    const r = await fetch(studio + path, {
      method: 'POST',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  if (args.includes('--ab')) await abFromConsole(mark, get, post, log);
  else
    await new Promise((done) => {
      const rl = createInterface({ input: process.stdin });
      rl.on('line', (l) => {
        const t = l.trim();
        if (t === 'q') {
          rl.close();
          return done();
        }
        mark(t || (STEPS[next] ?? [`etape-${next + 1}`])[0]);
        next++;
      });
      process.on('SIGINT', () => {
        rl.close();
        done();
      });
    });
  log('steps.jsonl', { step: 'fin' });
  clearInterval(chaosTimer);
  clearInterval(obsTimer);
  clearInterval(beat);
  mon.stdin.end();
  mon.kill();
  smi.kill();
  pm.kill();
  spawnSync(
    pmExe,
    ['--terminate_existing_session', '--session_name', session],
    { stdio: 'ignore', windowsHide: true },
  );
  await new Promise((r) => setTimeout(r, 1500));
  await Promise.all(
    Object.values(files).map((f) => new Promise((r) => f.end(r))),
  );
  const r = analyse(dir);
  console.log(
    `\nRapport : ${join(dir, 'rapport.md')} (${r.segments.length} segments)`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------- A/B (--ab)
// docs/chaos/BENCH_EFFETS.md § 8.5 : isoler le coût fixe du calque et de la composition, indépendamment des shaders.
// Le déroulé (plan, phases, cycle de vie vérifié côté serveur, nettoyage) est dans ab-run.mjs, testé avec le vrai
// runtime de Studio (apps/studio/server/test/chaos-perf-chain.test.ts). Ici : la console seulement.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function abFromConsole(mark, get, post, log) {
  const min = Math.round(
    (AB_PLAN.length *
      (AB_PHASES.reference_s + AB_PHASES.effect_s + AB_PHASES.after_s + 2)) /
      60,
  );
  console.log(
    `\nA/B : ${AB_PLAN.join(', ')}. Chacun : ${AB_PHASES.reference_s} s sans effet, ${AB_PHASES.effect_s} s d'effet, ${AB_PHASES.after_s} s sans effet (≈ ${min} min).`,
  );
  console.log(
    "Studio réduit ; Overwatch au premier plan, Champ d'entraînement, toujours au même endroit et de la même façon.",
  );
  console.log(
    'Entrée = départ (10 s pour revenir dans le jeu, puis ne quitte plus le jeu) ; « q » puis Entrée = arrêt propre.',
  );
  const rl = createInterface({ input: process.stdin });
  let stop = false;
  await new Promise((r) =>
    rl.once('line', (l) => {
      if (l.trim() === 'q') stop = true;
      r();
    }),
  );
  rl.on('line', (l) => {
    if (l.trim() === 'q') stop = true;
  });
  process.on('SIGINT', () => {
    stop = true;
  });
  if (!stop) {
    mark('ab-preparation');
    // Le temps de revenir dans le jeu (geste d'Antoni), pas une attente de Studio : Studio est vérifié par abRun.
    for (let k = 0; k < 40 && !stop; k++) await sleep(250);
  }
  const r = stop
    ? { done: 0, failed: { reason: 'arrêt demandé' }, clean: true }
    : await abRun(
        { get, post },
        {
          mark,
          note: (o) => log('steps.jsonl', o),
          say: (t) => console.log(t),
          shouldStop: () => stop,
        },
      );
  console.log(
    r.failed
      ? `\nA/B interrompu (${r.done}/${AB_PLAN.length} essais) : ${r.failed.reason}. État de Studio : ${r.clean ? 'propre, aucun effet actif' : 'À VÉRIFIER — fais STOP ALL'}.`
      : `\nA/B terminé : ${r.done}/${AB_PLAN.length} essais.`,
  );
  rl.close();
}

// ---------------------------------------------------------------- analyse
// Corrigée le 25/11 après la première mesure réelle (docs/chaos/BENCH_EFFETS.md § 8) :
// - FPS = images retenues / somme de LEURS durées (les trous laissés par les Alt+Tab ne comptent plus) ;
// - segments = états du calque (aucun effet, un effet, une combinaison) : les effets lancés à la main se chevauchent ;
//   entrée, maintien et sortie seulement quand un effet est seul ;
// - marges : 0,3 s après chaque changement d'état (relevés de Studio toutes les 250 ms) ; jeu hors du premier plan exclu
//   de 1,5 s avant la perte du focus à 1 s après son retour ;
// - GPU du jeu lu dans PresentMon (MsGPUBusy) : le compteur Windows « 3D » ne voit pas Overwatch ;
// - nouvelles mesures : images de 2 rafraîchissements ou plus, affichage hors de la grille du rafraîchissement (et sur
//   celle de l'autre écran), SyncInterval, mode de présentation ; contrôle d'horloge à chaque apparition/disparition du
//   calque (le jeu change de mode de présentation à cet instant).
const MARGIN_MS = 300;
const SETTLE_FOCUS_MS = 1000;
// Le jeu perd l'Independent Flip et saccade jusqu'à 1,3 s AVANT que le relevé du premier plan (2 fois/s) ne voie la perte
// du focus (mesure du 25/11) : exclusion dès 1,5 s avant le dernier relevé où il l'avait encore.
const PRE_FOCUS_MS = 1500;
/** Texte d'un fichier de mesure, ou de sa version compressée (<fichier>.gz, données brutes gardées dans le dépôt). */
function readText(file) {
  if (existsSync(file)) return readFileSync(file, 'utf8');
  if (existsSync(file + '.gz'))
    return gunzipSync(readFileSync(file + '.gz')).toString('utf8');
  return null;
}
function jsonl(file) {
  const text = readText(file);
  return text != null
    ? text
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
}
const pct = (s, p) =>
  s.length
    ? s[
        Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))
      ]
    : null;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r2 = (x) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;
const label = (set) => (set.length ? set.join('+') : 'aucun effet');

export function analyse(dir) {
  const meta = existsSync(join(dir, 'meta.json'))
    ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
    : {};
  const game = (meta.game ?? 'Overwatch.exe').toLowerCase();
  // Rafraîchissement de l'écran du jeu (XB273U : 59,94 Hz) et de l'autre écran (144 Hz).
  const period = 1000 / (meta.refresh_hz ?? 59.94);
  const period2 = 1000 / (meta.other_hz ?? 144);

  // PresentMon : une ligne par image présentée par le jeu.
  const frames = [];
  const pmText = readText(join(dir, 'presentmon.csv'));
  if (pmText != null) {
    const lines = pmText
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(Boolean);
    const head = lines[0].split(',');
    const c = (n) => head.indexOf(n);
    const [app, t, ft, mode, si, gb, cb, disp] = [
      'Application',
      'CPUStartQPCTimeInMs',
      'MsBetweenPresents',
      'PresentMode',
      'SyncInterval',
      'MsGPUBusy',
      'MsCPUBusy',
      'MsBetweenDisplayChange',
    ].map(c);
    for (const l of lines.slice(1)) {
      const v = l.split(',');
      if (v[app]?.toLowerCase() !== game) continue;
      const time = +v[t],
        frame = +v[ft];
      if (!Number.isFinite(time) || !Number.isFinite(frame)) continue;
      const d = disp >= 0 && v[disp] !== 'NA' ? +v[disp] : null;
      frames.push({
        t: time,
        ft: frame,
        mode: v[mode] ?? '',
        si: si >= 0 ? +v[si] : null,
        gpu: +v[gb],
        cpu: +v[cb],
        disp: Number.isFinite(d) ? d : null,
      });
    }
  }
  const monAll = jsonl(join(dir, 'monitor.jsonl'));
  const mon = monAll.filter((m) => m.type === 'sample');
  const gpu = jsonl(join(dir, 'gpu.jsonl'));
  const obs = jsonl(join(dir, 'obs.jsonl')).filter((o) => o.stats);
  const chaos = jsonl(join(dir, 'chaos.jsonl'));
  const steps = jsonl(join(dir, 'steps.jsonl'));
  const cores =
    monAll.find((m) => m.type === 'start')?.system?.cpu?.logical_cores ?? 1;

  // Jeu hors du premier plan : du dernier relevé où il l'avait jusqu'au retour + 1 s (le jeu se stabilise).
  const away = [];
  let okAt = null,
    lost = null;
  for (const m of mon) {
    const fg = (m.processes ?? []).find((p) => p.foreground);
    const ok = !!fg && String(fg.name ?? '').toLowerCase() + '.exe' === game;
    if (!ok && lost == null) lost = (okAt ?? m.qpc_ms - 500) - PRE_FOCUS_MS;
    if (ok) {
      if (lost != null) away.push({ a: lost, b: m.qpc_ms + SETTLE_FOCUS_MS });
      lost = null;
      okAt = m.qpc_ms;
    }
  }
  if (lost != null) away.push({ a: lost, b: Infinity });
  const inAway = (t) => away.some((w) => t >= w.a && t < w.b);

  // États du calque d'après Studio : effets affichés (actifs ou en sortie ; ni en attente ni au démarrage).
  const showing = (c) =>
    (c.active ?? []).filter(
      (x) => x.state === 'active' || x.state === 'exiting',
    );
  const marks = [
    ...steps.map((s) => ({ t: s.qpc_ms, step: s.step })),
    ...chaos.map((c) => ({ t: c.qpc_ms, chaos: c })),
  ].sort((x, y) => x.t - y.t);
  const req = new Map(); // request_id → { effect, start, in_ms, exitAt }
  const raw = [];
  let cur = null,
    st = null,
    set = [],
    ids = [];
  for (const m of marks) {
    let nst = st,
      nset = set,
      nids = ids;
    if (m.step !== undefined) nst = m.step;
    if (m.chaos) {
      for (const x of showing(m.chaos)) {
        const r = req.get(x.request_id) ?? {
          effect: x.effect,
          start: m.t,
          in_ms: x.in_ms ?? 0,
          exitAt: null,
        };
        if (x.state === 'exiting' && r.exitAt == null) r.exitAt = m.t;
        req.set(x.request_id, r);
      }
      nset = [...new Set(showing(m.chaos).map((x) => x.effect))].sort();
      nids = showing(m.chaos).map((x) => x.request_id);
    }
    if (nst !== st || label(nset) !== label(set)) {
      if (cur && m.t > cur.a) raw.push({ ...cur, b: m.t });
      cur = { a: m.t, step: nst, set: nset, ids: nids };
    } else if (cur) cur.ids = nids;
    st = nst;
    set = nset;
    ids = nids;
  }
  const kept = raw.filter((s) => s.step && s.step !== 'fin');

  // Un effet seul : entrée, maintien, sortie. Plusieurs effets : une combinaison, sans phase.
  const parts = [];
  for (const s of kept) {
    const r = s.set.length === 1 ? req.get(s.ids[0]) : null;
    if (!r) {
      parts.push({ ...s, rawA: s.a, phase: null });
      continue;
    }
    const inEnd = r.start + (r.in_ms || 0);
    for (const [phase, x, y] of [
      ['entree', r.start, inEnd],
      ['maintien', inEnd, r.exitAt ?? Infinity],
      ['sortie', r.exitAt ?? Infinity, Infinity],
    ]) {
      const a = Math.max(s.a, x),
        b = Math.min(s.b, y);
      if (b > a) parts.push({ ...s, rawA: s.a, a, b, phase });
    }
  }
  const usable = (p) => {
    const from = p.a === p.rawA ? p.a + MARGIN_MS : p.a;
    return frames.filter((x) => x.t >= from && x.t < p.b && !inAway(x.t));
  };

  const stats = (f) => {
    if (!f.length) return { images: 0, secondes: 0 };
    const sum = f.reduce((x, y) => x + y.ft, 0);
    const ft = f.map((x) => x.ft).sort((x, y) => x - y);
    const med = pct(ft, 50);
    const worst = (q) => avg(ft.slice(-Math.max(1, Math.floor(ft.length * q))));
    const long = f.filter((x) => x.ft > 1.5 * period).length;
    const disp = f.map((x) => x.disp).filter((x) => x != null);
    const off = (x, p, tol) => Math.abs(x / p - Math.round(x / p)) * p > tol;
    const offGrid = disp.filter((x) => off(x, period, 1)).length;
    const onOther = disp.filter(
      (x) => off(x, period, 1) && !off(x, period2, 0.6),
    ).length;
    const gb = f.map((x) => x.gpu).filter(Number.isFinite);
    return {
      secondes: r2(sum / 1000),
      images: f.length,
      fps: r2((f.length * 1000) / sum),
      fps_1pct_bas: r2(1000 / worst(0.01)),
      fps_01pct_bas: r2(1000 / worst(0.001)),
      image_ms_p50: r2(med),
      image_ms_p95: r2(pct(ft, 95)),
      image_ms_p99: r2(pct(ft, 99)),
      image_ms_max: r2(ft[ft.length - 1]),
      images_2_rafraichissements: long,
      images_2_rafraichissements_pct: r2((long / f.length) * 100),
      saccades: f.filter((x) => med && x.ft > Math.max(2 * med, med + 8))
        .length,
      affichage_hors_grille_pct: disp.length
        ? r2((offGrid / disp.length) * 100)
        : null,
      affichage_grille_autre_ecran_pct: disp.length
        ? r2((onOther / disp.length) * 100)
        : null,
      composed_pct: r2(
        (f.filter((x) => x.mode.startsWith('Composed')).length / f.length) *
          100,
      ),
      independent_pct: r2(
        (f.filter((x) => x.mode.includes('Independent')).length / f.length) *
          100,
      ),
      sync1_pct: r2((f.filter((x) => x.si === 1).length / f.length) * 100),
      gpu_jeu_ms_p50: r2(
        pct(
          gb.sort((x, y) => x - y),
          50,
        ),
      ),
      gpu_jeu_pct: r2((gb.reduce((x, y) => x + y, 0) / sum) * 100),
    };
  };
  const context = (p) => {
    const m = mon.filter(
      (x) => x.qpc_ms >= p.a && x.qpc_ms < p.b && !inAway(x.qpc_ms),
    );
    const role = (r) => {
      // Écart entre le premier et le dernier relevé : % du temps GPU (moteur 3D) et du processeur.
      if (m.length < 2) return null;
      const pick = (s) => (s.processes ?? []).filter((x) => x.role === r);
      const p0 = pick(m[0]),
        p1 = pick(m[m.length - 1]);
      const sum = (ps, k) => ps.reduce((x, q) => x + (q[k] ?? 0), 0);
      const dt = m[m.length - 1].t_ms - m[0].t_ms;
      if (!p0.length || !p1.length || dt <= 0) return null;
      return {
        gpu_pct: r2(((sum(p1, 'gpu_ms') - sum(p0, 'gpu_ms')) / dt) * 100),
        cpu_pct: r2(
          ((sum(p1, 'cpu_ms') - sum(p0, 'cpu_ms')) / dt / cores) * 100,
        ),
      };
    };
    const g = gpu.filter((x) => x.qpc_ms >= p.a && x.qpc_ms < p.b);
    const o = obs.filter((x) => x.qpc_ms >= p.a && x.qpc_ms < p.b);
    const od = (k) =>
      o.length >= 2 ? o[o.length - 1].stats[k] - o[0].stats[k] : null;
    return {
      processus: { chaos: role('chaos'), dwm: role('dwm'), obs: role('obs') },
      carte: g.length
        ? {
            charge_pct: r2(avg(g.map((x) => x.gpu_pct))),
            freq_mhz: r2(avg(g.map((x) => x.clock_mhz))),
          }
        : null,
      obs:
        o.length >= 2
          ? {
              manquees_rendu: od('renderSkippedFrames'),
              images_rendu: od('renderTotalFrames'),
              sautees_encodage: od('outputSkippedFrames'),
              images_sortie: od('outputTotalFrames'),
              rendu_ms_moy: r2(
                avg(o.map((x) => x.stats.averageFrameRenderTime)),
              ),
            }
          : null,
    };
  };
  const segments = parts.map((p) => ({
    etape: p.step,
    calque: label(p.set),
    phase: p.phase,
    debut_ms: r2(p.a),
    fin_ms: Number.isFinite(p.b) ? r2(p.b) : null,
    ...stats(usable(p)),
    ...context(p),
  }));

  // Par condition : toutes les images retenues d'un même état du calque (A/B : toutes étapes confondues).
  const byCond = new Map();
  for (const p of parts) {
    const k = String(p.step).startsWith('ab')
      ? `A/B · ${label(p.set)}`
      : `${p.step} · ${label(p.set)}`;
    (byCond.get(k) ?? byCond.set(k, []).get(k)).push(...usable(p));
  }
  const sans = [],
    avec = [];
  for (const p of parts)
    (p.set.length ? avec : sans).push(
      ...usable(p).filter(
        (x) => p.set.length || x.mode.includes('Independent'),
      ),
    );
  const conditions = [
    ...[...byCond].map(([k, f]) => ({ condition: k, ...stats(f) })),
    {
      condition: 'Ensemble · sans calque, jeu au premier plan',
      ...stats(sans),
    },
    { condition: 'Ensemble · avec calque', ...stats(avec) },
  ];

  // Contrôle d'horloge : apparition/disparition du calque (Studio) ↔ changement de mode de présentation du jeu.
  const horloge = [];
  for (let i = 1; i < chaos.length; i++) {
    const was = showing(chaos[i - 1]).length > 0,
      is = showing(chaos[i]).length > 0;
    if (was === is || inAway(chaos[i].qpc_ms)) continue;
    const want = is ? 'Composed' : 'Independent';
    const k = frames.findIndex(
      (x, j) =>
        j > 0 &&
        x.t > chaos[i].qpc_ms - 1000 &&
        x.mode.includes(want) &&
        !frames[j - 1].mode.includes(want),
    );
    if (k >= 0 && frames[k].t < chaos[i].qpc_ms + 2000)
      horloge.push({
        calque: is ? 'apparu' : 'disparu',
        studio_ms: r2(chaos[i].qpc_ms),
        ecart_ms: r2(frames[k].t - chaos[i].qpc_ms),
      });
  }
  const qualite = {
    images_presentmon: frames.length,
    images_retenues: parts.reduce((x, p) => x + usable(p).length, 0),
    hors_premier_plan: away.map(({ a, b }) => ({
      debut_ms: r2(a),
      fin_ms: Number.isFinite(b) ? r2(b) : null,
    })),
    hors_premier_plan_s: r2(
      away.reduce(
        (x, w) =>
          x +
          (Math.min(w.b, frames.at(-1)?.t ?? w.a) -
            Math.max(w.a, frames[0]?.t ?? w.a)) /
            1000,
        0,
      ),
    ),
    horloge,
    rafraichissement_ms: r2(period),
  };
  writeFileSync(
    join(dir, 'synthese.json'),
    JSON.stringify({ meta, qualite, conditions, segments }, null, 1),
  );
  writeFileSync(
    join(dir, 'rapport.md'),
    report(meta, qualite, conditions, segments),
  );
  return { segments, conditions, qualite };
}

function report(meta, q, conditions, segments) {
  const n = (x, d = 1) =>
    x == null ? '—' : Number(x).toFixed(d).replace('.', ',');
  const rows = [
    `# Mesure en jeu Chaos — ${meta.started ?? ''}`,
    '',
    `Jeu : ${meta.game ?? '?'}. Analyse corrigée (apps/chaos-engine/tools/mesure-jeu.mjs, docs/chaos/BENCH_EFFETS.md § 8).`,
    '',
    '## Qualité des données',
    '',
    `- Images PresentMon : ${q.images_presentmon} ; retenues : ${q.images_retenues}.`,
    `- Jeu hors du premier plan (exclu de 1,5 s avant la perte du focus à 1 s après son retour) : ${q.hors_premier_plan.length} période(s), ${n(q.hors_premier_plan_s)} s.`,
    `- Marge après chaque changement d'état du calque : ${MARGIN_MS} ms (relevés de Studio toutes les 250 ms).`,
    `- Horloges : apparition/disparition du calque ↔ changement de mode du jeu : ${q.horloge.length ? q.horloge.map((h) => `${h.calque} ${n(h.ecart_ms, 0)} ms`).join(', ') : 'aucun changement observable'}.`,
    `- Rafraîchissement retenu : ${n(q.rafraichissement_ms, 2)} ms. GPU du jeu : PresentMon (MsGPUBusy).`,
    '',
    '## Par condition',
    '',
    '| Condition | Durée utile (s) | FPS | 1 % bas | Image p50 / p95 / p99 (ms) | ≥ 2 rafraîch. | Affichage hors grille (dont grille autre écran) | Composed | SyncInterval 1 | GPU jeu (ms/img) |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of conditions)
    rows.push(
      `| ${c.condition} | ${n(c.secondes)} | ${n(c.fps)} | ${n(c.fps_1pct_bas)} | ${n(c.image_ms_p50)} / ${n(c.image_ms_p95)} / ${n(c.image_ms_p99)} | ${c.images_2_rafraichissements ?? 0} (${n(c.images_2_rafraichissements_pct)} %) | ${n(c.affichage_hors_grille_pct, 0)} % (${n(c.affichage_grille_autre_ecran_pct, 0)} %) | ${n(c.composed_pct, 0)} % | ${n(c.sync1_pct, 0)} % | ${n(c.gpu_jeu_ms_p50)} |`,
    );
  rows.push(
    '',
    '## Par segment',
    '',
    '| Étape | Calque | Phase | Durée utile (s) | FPS | 1 % bas | p99 (ms) | ≥ 2 rafraîch. | Hors grille | Composed | GPU Chaos % | GPU dwm % | GPU OBS % | Carte % | OBS manquées (rendu) | OBS sautées (encodage) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const s of segments) {
    const short = s.secondes < 3 ? ' (court)' : '';
    const p = s.processus;
    rows.push(
      `| ${s.etape} | ${s.calque} | ${s.phase ?? '—'} | ${n(s.secondes)}${short} | ${n(s.fps)} | ${n(s.fps_1pct_bas)} | ${n(s.image_ms_p99)} | ${s.images_2_rafraichissements ?? 0} | ${n(s.affichage_hors_grille_pct, 0)} % | ${n(s.composed_pct, 0)} % | ${n(p.chaos?.gpu_pct)} | ${n(p.dwm?.gpu_pct)} | ${n(p.obs?.gpu_pct)} | ${n(s.carte?.charge_pct, 0)} | ${s.obs ? `${s.obs.manquees_rendu}/${s.obs.images_rendu}` : '—'} | ${s.obs ? `${s.obs.sautees_encodage}/${s.obs.images_sortie}` : '—'} |`,
    );
  }
  rows.push(
    '',
    'FPS : images retenues / somme de leurs durées. 1 % bas : 1000 / moyenne du 1 % des images les plus longues.',
    '« ≥ 2 rafraîch. » : images de plus de 1,5 période de rafraîchissement (≈ 25 ms à 60 Hz). « Hors grille » : intervalles',
    'd’affichage à plus de 1 ms d’un multiple de la période ; entre parenthèses, ceux qui tombent sur la grille de l’autre écran.',
    'GPU par processus : compteurs Windows « GPU Engine » (moteur 3D). Carte : nvidia-smi. OBS : GetStats par Studio.',
  );
  return rows.join('\n') + '\n';
}

/** --self-test : mesure de synthèse (60 i/s ; Miroir seul puis Miroir + Brouillard puis Brouillard seul ; une image de
 *  50 ms pendant le Miroir ; un Alt+Tab à exclure) → analyse vérifiée. */
function selfTest() {
  const dir = join(
    process.env.TEMP ?? '.',
    `mesure-jeu-self-test-${process.pid}`,
  );
  mkdirSync(dir, { recursive: true });
  const T0 = 1e6,
    L = (f, o) =>
      writeFileSync(join(dir, f), JSON.stringify(o) + '\n', { flag: 'a' });
  let csv =
    'Application,PresentMode,SyncInterval,CPUStartQPCTimeInMs,MsBetweenPresents,MsGPUBusy,MsCPUBusy,MsBetweenDisplayChange\n';
  for (let t = 0; t < 100000;) {
    const ft =
      t >= 62000 && t < 64000 ? 100 : Math.abs(t - 75000) < 8 ? 50 : 16.683;
    const comp = t >= 70000 && t < 90000;
    csv += `Overwatch.exe,${comp ? 'Composed: Flip' : 'Hardware: Independent Flip'},${comp ? 1 : 0},${T0 + t},${ft},8,4,${ft}\n`;
    t += ft;
  }
  writeFileSync(join(dir, 'presentmon.csv'), csv);
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({ game: 'Overwatch.exe', started: 'self-test' }),
  );
  for (const [s, t] of [
    ['overwatch-seul', 0],
    ['obs-sans-chaos', 20000],
    ['chaos-repos', 40000],
    ['effets', 60000],
    ['fin', 100000],
  ])
    L('steps.jsonl', { qpc_ms: T0 + t, step: s });
  const M = (state) => ({
    effect: 'mirror',
    state,
    request_id: 'r1',
    in_ms: 450,
  });
  const F = (state) => ({
    effect: 'fog',
    state,
    request_id: 'r2',
    in_ms: 2500,
  });
  for (const [t, active] of [
    [60000, []],
    [70000, [M('active')]],
    [78000, [M('active'), F('active')]],
    [81500, [M('exiting'), F('active')]],
    [82000, [F('active')]],
    [87000, [F('exiting')]],
    [90000, []],
  ])
    L('chaos.jsonl', { qpc_ms: T0 + t, studio: true, active });
  L('monitor.jsonl', {
    qpc_ms: T0,
    type: 'start',
    system: { cpu: { logical_cores: 20 } },
  });
  for (let t = 0; t <= 100000; t += 500) {
    L('monitor.jsonl', {
      qpc_ms: T0 + t,
      type: 'sample',
      t_ms: t,
      processes: [
        {
          role: 'foreground',
          name: t >= 62000 && t < 64000 ? 'Raptoru Studio' : 'Overwatch',
          foreground: true,
          gpu_ms: 0,
          cpu_ms: t * 2,
        },
        {
          role: 'chaos',
          name: 'ChaosEngine',
          gpu_ms: Math.min(Math.max(0, t - 70000), 20000) * 0.03,
          cpu_ms: 0,
        },
      ],
    });
    L('obs.jsonl', {
      qpc_ms: T0 + t,
      stats: {
        renderTotalFrames: t * 0.06,
        renderSkippedFrames: t >= 75000 ? 2 : 0,
        outputTotalFrames: t * 0.06,
        outputSkippedFrames: 0,
        averageFrameRenderTime: 1.5,
      },
    });
  }
  const { segments: s, conditions: c, qualite: q } = analyse(dir);
  const seg = (calque, phase) =>
    s.find((x) => x.calque === calque && x.phase === phase);
  const cond = (k) => c.find((x) => x.condition === k);
  const checks = [
    [
      Math.abs(cond('overwatch-seul · aucun effet').fps - 59.94) < 0.3,
      '60 i/s',
    ],
    [
      s.every((x) => !x.images || x.fps >= x.fps_1pct_bas),
      'FPS moyen jamais sous le 1 % bas',
    ],
    [
      seg('mirror', 'maintien').images_2_rafraichissements === 1,
      'une image de 2 rafraîchissements pendant le maintien du Miroir',
    ],
    [
      seg('mirror', 'entree') != null &&
        seg('fog+mirror', null) != null &&
        seg('fog', 'sortie') != null,
      'Miroir seul, combinaison, Brouillard seul séparés',
    ],
    [
      cond('effets · aucun effet').image_ms_max < 20,
      'Alt+Tab exclu (images de 100 ms hors premier plan)',
    ],
    [
      seg('mirror', 'maintien').composed_pct === 100 &&
        seg('mirror', 'maintien').sync1_pct === 100,
      'mode de présentation et SyncInterval',
    ],
    [
      seg('mirror', 'maintien').obs.manquees_rendu === 2,
      'images manquées d’OBS',
    ],
    [
      Math.abs(seg('mirror', 'maintien').processus.chaos.gpu_pct - 3) < 0.2,
      'GPU de Chaos',
    ],
    [
      q.horloge.length === 2 &&
        q.horloge.every((h) => Math.abs(h.ecart_ms) < 20),
      'contrôle d’horloge (calque apparu, disparu)',
    ],
  ];
  for (const [ok, what] of checks)
    console.log(`${ok ? 'ok    ' : 'ÉCHEC '} ${what}`);
  process.exit(checks.every(([ok]) => ok) ? 0 : 1);
}

// Après toutes les déclarations (constantes d'aide comprises).
if (args.includes('--self-test')) selfTest();
else if (args.includes('--analyse')) {
  const dir = resolve(arg('--analyse'));
  const r = analyse(dir);
  console.log(
    `Rapport : ${join(dir, 'rapport.md')} (${r.segments.length} segments)`,
  );
} else await record();
