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
//
//   node apps/chaos-engine/tools/mesure-jeu.mjs [--out <dossier>] [--process Overwatch.exe] [--presentmon <exe>]
//   node apps/chaos-engine/tools/mesure-jeu.mjs --analyse <dossier>      (refait le rapport d'une mesure)
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
import { fileURLToPath } from 'node:url';

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

// ---------------------------------------------------------------- analyse
function jsonl(file) {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
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

export function analyse(dir) {
  const meta = existsSync(join(dir, 'meta.json'))
    ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
    : {};
  const game = (meta.game ?? 'Overwatch.exe').toLowerCase();
  // PresentMon : une ligne par image présentée par le jeu.
  const frames = [];
  if (existsSync(join(dir, 'presentmon.csv'))) {
    const lines = readFileSync(join(dir, 'presentmon.csv'), 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(Boolean);
    const head = lines[0].split(',');
    const c = (n) => head.indexOf(n);
    const [app, t, ft, mode, gb, cb, disp] = [
      'Application',
      'CPUStartQPCTimeInMs',
      'MsBetweenPresents',
      'PresentMode',
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
      frames.push({
        t: time,
        ft: frame,
        mode: v[mode],
        gpu: +v[gb],
        cpu: +v[cb],
        shown: v[disp] !== 'NA',
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

  // Périodes où le jeu n'est PAS au premier plan (Alt+Tab vers Studio) : exclues de toutes les mesures.
  const away = [];
  for (const m of mon) {
    const fg = (m.processes ?? []).find((p) => p.foreground);
    const ok = fg && String(fg.name ?? '').toLowerCase() + '.exe' === game;
    const last = away[away.length - 1];
    if (!ok) {
      if (last && last.open) last.b = m.qpc_ms + 600;
      else away.push({ a: m.qpc_ms - 600, b: m.qpc_ms + 600, open: true });
    } else if (last) last.open = false;
  }
  const inAway = (t) => away.some((w) => t >= w.a && t < w.b);

  // Segments : étapes marquées ; dans « effets », chaque effet (entrée, maintien, sortie) et le repos entre eux.
  const segs = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.step === 'fin') continue;
    const a = s.qpc_ms,
      b = steps[i + 1]?.qpc_ms ?? Infinity;
    if (!String(s.step).startsWith('effets')) {
      segs.push({ step: s.step, kind: 'etape', a, b });
      continue;
    }
    // Effets actifs pendant l'étape, d'après les relevés de Studio (changements d'état horodatés).
    const ev = chaos.filter((c) => c.qpc_ms >= a - 1000 && c.qpc_ms < b);
    const open = new Map();
    let quietFrom = a,
      busy = 0;
    const close = (id, t) => {
      const o = open.get(id);
      open.delete(id);
      const entryEnd = Math.min(o.exitAt ?? t, o.a + (o.in_ms ?? 0));
      if (o.in_ms > 0)
        segs.push({
          step: s.step,
          kind: 'effet',
          effect: o.effect,
          phase: 'entree',
          a: o.a,
          b: entryEnd,
        });
      segs.push({
        step: s.step,
        kind: 'effet',
        effect: o.effect,
        phase: 'maintien',
        a: entryEnd,
        b: o.exitAt ?? t,
      });
      if (o.exitAt)
        segs.push({
          step: s.step,
          kind: 'effet',
          effect: o.effect,
          phase: 'sortie',
          a: o.exitAt,
          b: t,
        });
    };
    for (const c of ev) {
      const ids = new Set(
        (c.active ?? [])
          .filter((x) => x.state !== 'queued')
          .map((x) => x.request_id),
      );
      for (const x of c.active ?? []) {
        if (x.state === 'queued') continue;
        if (!open.has(x.request_id)) {
          if (open.size === 0 && c.qpc_ms - quietFrom > 3000)
            segs.push({
              step: s.step,
              kind: 'repos',
              a: quietFrom + 2500,
              b: c.qpc_ms,
            });
          open.set(x.request_id, {
            effect: x.effect,
            a: c.qpc_ms,
            in_ms: x.in_ms,
          });
        }
        const o = open.get(x.request_id);
        if (x.state === 'exiting' && !o.exitAt) o.exitAt = c.qpc_ms;
      }
      for (const id of [...open.keys()])
        if (!ids.has(id)) {
          close(id, c.qpc_ms);
          if (open.size === 0) quietFrom = c.qpc_ms;
        }
      busy = open.size;
    }
    for (const id of [...open.keys()]) close(id, b);
    if (!busy && Number.isFinite(b) && b - quietFrom > 3000)
      segs.push({ step: s.step, kind: 'repos', a: quietFrom + 2500, b });
  }

  const stat = (sg) => {
    const f = frames.filter((x) => x.t >= sg.a && x.t < sg.b && !inAway(x.t));
    const secs = f.length
      ? (f[f.length - 1].t - f[0].t + f[f.length - 1].ft) / 1000
      : 0;
    const ft = f.map((x) => x.ft).sort((x, y) => x - y);
    const med = pct(ft, 50);
    const worst = (q) => {
      const n = Math.max(1, Math.floor(ft.length * q));
      return avg(ft.slice(-n));
    };
    const stutter = f.filter(
      (x) => med && x.ft > Math.max(2 * med, med + 8),
    ).length;
    const modes = {};
    for (const x of f) modes[x.mode] = (modes[x.mode] ?? 0) + 1;
    const m = mon.filter(
      (x) => x.qpc_ms >= sg.a && x.qpc_ms < sg.b && !inAway(x.qpc_ms),
    );
    const role = (r) => {
      // Écart entre le premier et le dernier relevé de la fenêtre : % du temps GPU et du processeur.
      if (m.length < 2) return null;
      const p0 = (m[0].processes ?? []).filter(
        (p) => p.role === r || (r === 'jeu' && p.foreground),
      );
      const p1 = (m[m.length - 1].processes ?? []).filter(
        (p) => p.role === r || (r === 'jeu' && p.foreground),
      );
      const sum = (ps, k) => ps.reduce((x, p) => x + (p[k] ?? 0), 0);
      const dt = m[m.length - 1].t_ms - m[0].t_ms;
      if (!p0.length || !p1.length || dt <= 0) return null;
      return {
        gpu_pct: r2(((sum(p1, 'gpu_ms') - sum(p0, 'gpu_ms')) / dt) * 100),
        cpu_pct: r2(
          ((sum(p1, 'cpu_ms') - sum(p0, 'cpu_ms')) / dt / cores) * 100,
        ),
        vram_mb: r2(sum(p1, 'vram_mb')),
      };
    };
    const g = gpu.filter((x) => x.qpc_ms >= sg.a && x.qpc_ms < sg.b);
    const o = obs.filter((x) => x.qpc_ms >= sg.a && x.qpc_ms < sg.b);
    const od = (k) =>
      o.length >= 2 ? o[o.length - 1].stats[k] - o[0].stats[k] : null;
    return {
      ...sg,
      secondes: r2(secs),
      images: f.length,
      fps_moyen: secs ? r2(f.length / secs) : null,
      fps_1pct_bas: worst(0.01) ? r2(1000 / worst(0.01)) : null,
      fps_01pct_bas: worst(0.001) ? r2(1000 / worst(0.001)) : null,
      image_ms_p50: r2(med),
      image_ms_p95: r2(pct(ft, 95)),
      image_ms_p99: r2(pct(ft, 99)),
      image_ms_max: r2(ft[ft.length - 1]),
      saccades: stutter,
      saccades_par_min: secs ? r2((stutter / secs) * 60) : null,
      gpu_jeu_ms_p50: r2(
        pct(
          f
            .map((x) => x.gpu)
            .filter(Number.isFinite)
            .sort((x, y) => x - y),
          50,
        ),
      ),
      cpu_jeu_ms_p50: r2(
        pct(
          f
            .map((x) => x.cpu)
            .filter(Number.isFinite)
            .sort((x, y) => x - y),
          50,
        ),
      ),
      modes_presentation: Object.fromEntries(
        Object.entries(modes).map(([k, v]) => [k, r2((v / f.length) * 100)]),
      ),
      processus: {
        jeu: role('jeu'),
        chaos: role('chaos'),
        dwm: role('dwm'),
        obs: role('obs'),
      },
      carte: g.length
        ? {
            charge_pct: r2(avg(g.map((x) => x.gpu_pct))),
            nvenc_pct: r2(avg(g.map((x) => x.nvenc_pct))),
            freq_mhz: r2(avg(g.map((x) => x.clock_mhz))),
            puissance_w: r2(avg(g.map((x) => x.power_w))),
            vram_mb: r2(Math.max(...g.map((x) => x.vram_mb))),
          }
        : null,
      obs:
        o.length >= 2
          ? {
              images_rendu: od('renderTotalFrames'),
              manquees_rendu: od('renderSkippedFrames'),
              images_sortie: od('outputTotalFrames'),
              sautees_encodage: od('outputSkippedFrames'),
              rendu_ms_moy: r2(
                avg(o.map((x) => x.stats.averageFrameRenderTime)),
              ),
              fps_obs: r2(avg(o.map((x) => x.stats.activeFps))),
              cpu_obs_pct: r2(avg(o.map((x) => x.stats.cpuUsage))),
            }
          : null,
    };
  };
  const segments = segs.filter((s) => s.b > s.a).map(stat);
  writeFileSync(
    join(dir, 'synthese.json'),
    JSON.stringify(
      {
        meta,
        exclusions_hors_premier_plan: away.map(({ a, b }) => ({ a, b })),
        segments,
      },
      null,
      1,
    ),
  );
  writeFileSync(join(dir, 'rapport.md'), report(meta, segments, frames.length));
  return { segments };
}

function report(meta, segments, nFrames) {
  const n = (x, d = 1) =>
    x == null ? '—' : Number(x).toFixed(d).replace('.', ',');
  const rows = [];
  rows.push(
    `# Mesure en jeu Chaos — ${meta.started ?? ''}`,
    '',
    `Jeu : ${meta.game ?? '?'} · ${nFrames} images relevées par PresentMon. Périodes hors premier plan (Alt+Tab) exclues.`,
    '',
  );
  rows.push(
    '| Segment | Durée (s) | FPS moy. | 1 % bas | 0,1 % bas | Image p95 (ms) | p99 (ms) | Saccades/min | Présentation | GPU jeu % | GPU Chaos % | GPU dwm % | GPU OBS % | Carte % | OBS manquées rendu | OBS sautées encodage | Rendu OBS (ms) |',
  );
  rows.push(
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const s of segments) {
    const name =
      s.kind === 'effet'
        ? `${s.effect} · ${s.phase}`
        : s.kind === 'repos'
          ? 'repos entre effets'
          : s.step;
    const pm =
      Object.entries(s.modes_presentation)
        .map(([k, v]) => `${k} ${n(v, 0)} %`)
        .join(', ') || '—';
    const p = s.processus;
    rows.push(
      `| ${name} | ${n(s.secondes)} | ${n(s.fps_moyen)} | ${n(s.fps_1pct_bas)} | ${n(s.fps_01pct_bas)} | ${n(s.image_ms_p95, 2)} | ${n(s.image_ms_p99, 2)} | ${n(s.saccades_par_min)} | ${pm} | ${n(p.jeu?.gpu_pct)} | ${n(p.chaos?.gpu_pct)} | ${n(p.dwm?.gpu_pct)} | ${n(p.obs?.gpu_pct)} | ${n(s.carte?.charge_pct, 0)} | ${s.obs ? `${s.obs.manquees_rendu}/${s.obs.images_rendu}` : '—'} | ${s.obs ? `${s.obs.sautees_encodage}/${s.obs.images_sortie}` : '—'} | ${n(s.obs?.rendu_ms_moy, 2)} |`,
    );
  }
  rows.push(
    '',
    'Saccade : image plus longue que 2 × la médiane du segment et que médiane + 8 ms. 1 % bas : 1000 / moyenne du 1 % des images les plus longues.',
    'GPU par processus : compteurs Windows « GPU Engine » (moteur 3D), en % du temps. Carte : nvidia-smi. OBS : compteurs d’OBS lus par Studio (GetStats).',
  );
  return rows.join('\n') + '\n';
}

/** --self-test : mesure de synthèse (60 i/s, un Miroir avec une saccade, un Alt+Tab à exclure) → analyse vérifiée. */
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
    'Application,PresentMode,CPUStartQPCTimeInMs,MsBetweenPresents,MsGPUBusy,MsCPUBusy,MsBetweenDisplayChange\n';
  for (let t = 0; t < 100000;) {
    const ft =
      t >= 62000 && t < 64000 ? 100 : Math.abs(t - 75000) < 8 ? 50 : 16.667;
    csv += `Overwatch.exe,${t >= 70000 && t < 82000 ? 'Composed: Flip' : 'Hardware: Independent Flip'},${T0 + t},${ft},8,4,${ft}\n`;
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
  L('chaos.jsonl', { qpc_ms: T0 + 60000, studio: true, active: [] });
  L('chaos.jsonl', {
    qpc_ms: T0 + 70000,
    studio: true,
    active: [
      { effect: 'mirror', state: 'active', request_id: 'r1', in_ms: 450 },
    ],
  });
  L('chaos.jsonl', {
    qpc_ms: T0 + 81500,
    studio: true,
    active: [
      { effect: 'mirror', state: 'exiting', request_id: 'r1', in_ms: 450 },
    ],
  });
  L('chaos.jsonl', { qpc_ms: T0 + 82000, studio: true, active: [] });
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
          gpu_ms: t * 0.8,
          cpu_ms: t * 2,
        },
        {
          role: 'chaos',
          name: 'ChaosEngine',
          gpu_ms: Math.min(Math.max(0, t - 70000), 12000) * 0.03,
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
        activeFps: 60,
        cpuUsage: 3,
      },
    });
  }
  const s = analyse(dir).segments;
  const g = (k) =>
    s.find(
      (x) =>
        (x.effect
          ? `${x.effect}·${x.phase}`
          : x.kind === 'repos'
            ? 'repos'
            : x.step) === k,
    );
  const checks = [
    [Math.abs(g('overwatch-seul').fps_moyen - 60) < 0.5, '60 i/s'],
    [g('mirror·maintien').saccades === 1, 'une saccade pendant le maintien'],
    [
      g('mirror·entree').secondes < 0.6 && g('mirror·sortie') != null,
      'entrée et sortie séparées',
    ],
    [
      s.filter((x) => x.kind === 'repos').every((x) => x.image_ms_max < 20),
      'Alt+Tab exclu',
    ],
    [
      g('mirror·maintien').modes_presentation['Composed: Flip'] === 100,
      'mode de présentation',
    ],
    [g('mirror·maintien').obs.manquees_rendu === 2, 'images manquées d’OBS'],
    [
      Math.abs(g('mirror·maintien').processus.chaos.gpu_pct - 3) < 0.2,
      'GPU de Chaos',
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
