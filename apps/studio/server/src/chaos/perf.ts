import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// Chaos Performance Lab (docs/chaos/PERFORMANCE_LAB.md). Studio pilote les mesures natives du moteur, dans des
// processus courts et séparés ; aucun ne touche au jeu (ni injection, ni réglage), ni à OBS.
//   Mode A, hors écran : `ChaosEngine.exe --perf-offscreen` rend chaque effet sur une scène de synthèse, à la résolution
//     de l'écran choisi ; refusé (par le moteur) si un jeu ou une application plein écran est actif. Progression réelle,
//     annulation, échéance, arrêt si Studio disparaît (--parent).
//   Mode B, en jeu : `ChaosEngine.exe --perf-monitor` relève la télémétrie (GPU et processeur par processus) pendant
//     une référence sans effet, l'effet (déclenché par ce clic seulement, sur l'écran de sa fiche), puis un retour.
//     Les images/s du jeu ne sont pas mesurées (il faudrait PresentMon) : c'est écrit, jamais estimé.

export class PerfError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;
type EngineCall = (cmd: string, args?: Json) => Promise<unknown>;

export interface OffscreenState {
  status: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
  started_at?: string;
  ended_at?: string;
  options?: Json;
  start?: Json;
  progress?: { done: number; total: number; label?: string };
  results: Json[];
  summary?: Json;
  error?: { code: string; message: string };
}

interface Sample {
  t_ms: number;
  gpu_ms_all: number;
  game_active: string | null;
  processes: {
    role: string;
    pid: number;
    name: string | null;
    gpu_ms: number | null;
    cpu_ms: number | null;
    working_set_mb: number | null;
    vram_mb: number | null;
    foreground: boolean;
  }[];
}

export interface LiveState {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'failed';
  effect?: string;
  label?: string;
  phase?: 'reference' | 'effect' | 'after';
  phase_ends_at?: number;
  phases_s?: { reference: number; effect: number; after: number };
  samples: number;
  error?: { code: string; message: string };
}

const PHASES = ['reference', 'effect', 'after'] as const;
type Phase = (typeof PHASES)[number];

export class PerfLab {
  private offscreen: OffscreenState = { status: 'idle', results: [] };
  private offProc: ChildProcess | null = null;
  private live: LiveState = { status: 'idle', samples: 0 };
  private liveProc: ChildProcess | null = null;
  private liveTimers: NodeJS.Timeout[] = [];
  private liveSamples: (Sample & { phase: Phase })[] = [];
  private liveTelemetry: Json[] = [];
  private liveCores = 1;
  private liveSystem: Json | null = null;
  private liveResults: Json[] = [];
  private sys: Json | null = null;
  private readonly dir: string;

  constructor(
    private readonly exe: string,
    stateDir: string,
    private readonly call: EngineCall,
    /** Lancement de la télémétrie (tests : faux moteur) ; par défaut, le moteur lui-même. */
    private readonly spawnImpl?: (args: string[]) => ChildProcess,
  ) {
    this.dir = join(stateDir, 'perf');
    try {
      const last = join(this.dir, 'offscreen-last.json');
      if (existsSync(last))
        this.offscreen = JSON.parse(
          readFileSync(last, 'utf8'),
        ) as OffscreenState;
      const live = join(this.dir, 'live-results.json');
      if (existsSync(live))
        this.liveResults = JSON.parse(readFileSync(live, 'utf8')) as Json[];
    } catch {
      /* rapport précédent illisible : on repart de zéro */
    }
  }

  private save(name: string, value: unknown) {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, name), JSON.stringify(value, null, 2));
    } catch {
      /* l'écran garde les résultats ; l'export reste possible */
    }
  }

  /** Matériel (une fois par session de Studio : un processus court, sans fenêtre). */
  async sysinfo(): Promise<Json> {
    if (this.sys) return this.sys;
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn(this.exe, ['--sysinfo'], { windowsHide: true });
      let s = '';
      p.stdout.on('data', (d: Buffer) => (s += d.toString('utf8')));
      p.on('error', reject);
      const t = setTimeout(() => p.kill(), 15_000);
      p.on('exit', () => (clearTimeout(t), resolve(s)));
    });
    this.sys = JSON.parse(out) as Json;
    return this.sys;
  }

  state() {
    return {
      offscreen: this.offscreen,
      live: this.live,
      live_results: this.liveResults,
      /** Une mesure en jeu peut démarrer maintenant (rien en cours, aucune télémétrie ni banc hors écran en vie). */
      live_available:
        this.live.status !== 'running' && !this.liveProc && !this.offProc,
    };
  }

  // ---------- Mode A : hors écran ----------
  startOffscreen(o: {
    width: number;
    height: number;
    frames?: number;
    warmup?: number;
    profile?: string;
    screen?: string;
    /** Tests automatiques : très petite taille (160×90), permise même pendant un jeu (charge négligeable). */
    smoke?: boolean;
  }) {
    if (this.offProc)
      throw new PerfError('busy', 'un banc hors écran tourne déjà');
    if (this.liveProc)
      throw new PerfError('busy', 'une mesure en jeu est en cours');
    const w = Math.round(o.width),
      h = Math.round(o.height);
    if (!(w >= 64 && w <= 7680 && h >= 64 && h <= 4320))
      throw new PerfError('invalid_request', 'résolution hors bornes');
    const frames = Math.min(
      2000,
      Math.max(o.smoke ? 2 : 30, Math.round(o.frames ?? 240)),
    );
    const warmup = Math.min(500, Math.max(5, Math.round(o.warmup ?? 30)));
    const profile = ['qualite', 'equilibre', 'economie'].includes(
      o.profile ?? '',
    )
      ? o.profile!
      : 'qualite';
    const args = [
      '--perf-offscreen',
      '--w',
      String(w),
      '--h',
      String(h),
      '--frames',
      String(frames),
      '--warmup',
      String(warmup),
      '--profile',
      profile,
      '--parent',
      String(process.pid),
      '--deadline-ms',
      '900000',
      ...(o.smoke ? ['--smoke'] : []),
    ];
    const options = {
      width: w,
      height: h,
      frames,
      warmup,
      profile,
      screen: o.screen ?? null,
    };
    this.offscreen = {
      status: 'running',
      started_at: new Date().toISOString(),
      options,
      results: [],
      progress: { done: 0, total: 0 },
    };
    const p = spawn(this.exe, args, { windowsHide: true });
    this.offProc = p;
    const st = this.offscreen;
    createInterface({ input: p.stdout }).on('line', (line) => {
      let m: Json;
      try {
        m = JSON.parse(line) as Json;
      } catch {
        return;
      }
      if (this.offscreen !== st) return;
      if (m.type === 'start') st.start = m;
      else if (m.type === 'progress')
        st.progress = {
          done: Number(m.done),
          total: Number(m.total),
          label: m.label as string | undefined,
        };
      else if (m.type === 'result') st.results.push(m.result as Json);
      else if (m.type === 'end') {
        st.summary = m.summary as Json;
        st.status = 'done';
        st.ended_at = new Date().toISOString();
        this.save('offscreen-last.json', st);
      } else if (m.type === 'error') {
        // Refus ou arrêt du moteur (jeu ouvert, échéance…) : montré tout de suite, jamais remplacé par « annulé ».
        st.error = { code: String(m.code), message: String(m.message) };
        if (st.status === 'running') st.status = 'failed';
      }
    });
    p.on('error', (e) => {
      st.error = { code: 'spawn', message: e.message };
    });
    p.on('exit', (code) => {
      this.offProc = null;
      if (st.status === 'running') {
        st.status = 'failed';
        st.error ??= {
          code: 'exited',
          message: `le banc s’est arrêté (code ${code ?? '?'})`,
        };
      }
      if (st.status === 'done') return;
      st.ended_at = new Date().toISOString();
      if (st.status !== 'cancelled') this.save('offscreen-last.json', st);
    });
    return this.offscreen;
  }

  cancelOffscreen() {
    if (!this.offProc || this.offscreen.status !== 'running')
      return this.offscreen;
    this.offscreen.status = 'cancelled';
    this.offscreen.error = { code: 'cancelled', message: 'banc annulé' };
    this.offProc.kill();
    return this.offscreen;
  }

  // ---------- Mode B : en jeu, à la main ----------
  async startLive(o: {
    effect: string;
    label?: string;
    reference_s?: number;
    effect_s?: number;
    after_s?: number;
  }) {
    if (this.liveProc)
      throw new PerfError('busy', 'une mesure en jeu est déjà en cours');
    if (this.offProc) throw new PerfError('busy', 'un banc hors écran tourne');
    if (!/^[a-z][a-z0-9_.]{0,40}$/.test(o.effect))
      throw new PerfError('invalid_request', 'effet invalide');
    const clamp = (v: number | undefined, d: number) =>
      Math.min(60, Math.max(1, Math.round(v ?? d)));
    const phases = {
      reference: clamp(o.reference_s, 10),
      effect: clamp(o.effect_s, 10),
      after: clamp(o.after_s, 10),
    };
    this.liveSamples = [];
    this.liveTelemetry = [];
    this.live = {
      status: 'running',
      effect: o.effect,
      label: o.label ?? o.effect,
      phase: 'reference',
      phases_s: phases,
      phase_ends_at: Date.now() + phases.reference * 1000,
      samples: 0,
    };
    const st = this.live;
    const args = [
      '--perf-monitor',
      '--interval-ms',
      '500',
      '--parent',
      String(process.pid),
      '--deadline-ms',
      String((phases.reference + phases.effect + phases.after + 30) * 1000),
    ];
    const p = this.spawnImpl
      ? this.spawnImpl(args)
      : spawn(this.exe, args, { windowsHide: true });
    this.liveProc = p;
    // stdout toujours en tube (spawn par défaut ; les lanceurs de test le gardent aussi).
    createInterface({ input: p.stdout! }).on('line', (line) => {
      let m: Json;
      try {
        m = JSON.parse(line) as Json;
      } catch {
        return;
      }
      // Lignes d'une télémétrie déjà libérée (mesure finie, ou suivante commencée) : ignorées.
      if (this.live !== st || st.status !== 'running') return;
      if (m.type === 'start') {
        this.liveSystem = (m.system as Json) ?? null;
        const cpu = (this.liveSystem?.cpu as Json | undefined)?.logical_cores;
        this.liveCores = typeof cpu === 'number' && cpu > 0 ? cpu : 1;
      } else if (m.type === 'sample' && st.phase) {
        // Le chronomètre des phases part au premier relevé (la télémétrie met un moment à démarrer).
        if (!this.liveSamples.length) begin();
        this.liveSamples.push({ ...(m as unknown as Sample), phase: st.phase });
        st.samples = this.liveSamples.length;
      }
    });
    p.on('exit', () => {
      // La sortie (asynchrone) d'une ancienne télémétrie ne doit jamais libérer celle de la mesure suivante.
      if (this.liveProc === p) this.liveProc = null;
      if (st.status === 'running') {
        st.status = 'failed';
        st.error = {
          code: 'monitor_exited',
          message: 'la télémétrie s’est arrêtée',
        };
        this.clearTimers();
      }
    });
    const at = (ms: number, f: () => void) =>
      this.liveTimers.push(setTimeout(f, ms));
    // Aucun relevé en 15 s : la télémétrie ne marche pas sur ce PC, rien n'est déclenché.
    at(15_000, () => {
      if (
        this.live !== st ||
        st.status !== 'running' ||
        this.liveSamples.length
      )
        return;
      st.status = 'failed';
      st.error = {
        code: 'monitor_silent',
        message:
          'aucun relevé de télémétrie : mesure abandonnée, aucun effet déclenché',
      };
      this.endLive();
    });
    const begin = () => {
      st.phase_ends_at = Date.now() + phases.reference * 1000;
      // Référence → effet (déclenché ici, par le clic de l'utilisateur) → retour → résultats.
      at(phases.reference * 1000, () => {
        if (this.live !== st || st.status !== 'running') return;
        st.phase = 'effect';
        st.phase_ends_at = Date.now() + phases.effect * 1000;
        void this.call('effect.activate', {
          effect: o.effect,
          kind: 'manual',
          duration_ms: phases.effect * 1000,
          request_id: `studio-perf-${Date.now().toString(36)}`,
          source: { kind: 'studio', ref: 'Studio › Chaos › Performance Lab' },
        }).catch((e: Error) => {
          st.status = 'failed';
          st.error = { code: 'activate_failed', message: e.message };
          this.endLive();
        });
      });
      at((phases.reference + phases.effect) * 1000, () => {
        if (this.live !== st || st.status !== 'running') return;
        st.phase = 'after';
        st.phase_ends_at = Date.now() + phases.after * 1000;
        void this.call('effect.stop', { effect: o.effect }).catch(() => {});
      });
      at((phases.reference + phases.effect + phases.after) * 1000, () => {
        if (this.live !== st || st.status !== 'running') return;
        st.status = 'done';
        this.liveResults.unshift(this.liveReport());
        this.liveResults = this.liveResults.slice(0, 50);
        this.save('live-results.json', this.liveResults);
        this.endLive();
      });
    };
    return this.live;
  }

  /** Télémétrie interne du moteur (engine.telemetry), gardée pendant la phase « effet ». */
  onTelemetry(e: Json) {
    if (this.live.status === 'running' && this.live.phase === 'effect')
      this.liveTelemetry.push(e);
  }

  private clearTimers() {
    for (const t of this.liveTimers) clearTimeout(t);
    this.liveTimers = [];
  }

  /**
   * Fin de la télémétrie, libérée TOUT DE SUITE : « done » (ou « failed », « cancelled ») et Studio libre au même
   * instant. Avant le 25/11, la place n'était rendue qu'à la sortie du processus, signalée plus tard par Windows : une
   * mesure demandée juste après « done » était refusée (« une mesure en jeu est déjà en cours », A/B interrompu).
   */
  private endLive() {
    this.clearTimers();
    const p = this.liveProc;
    this.liveProc = null;
    p?.stdin?.end();
    p?.kill();
  }

  /** Arrêt immédiat : l'effet s'arrête, la télémétrie aussi ; la mesure partielle n'est pas gardée. */
  async stopLive() {
    if (this.live.status !== 'running') {
      this.endLive(); // une télémétrie restée en vie sans mesure en cours
      return this.live;
    }
    const effect = this.live.effect;
    this.live.status = 'cancelled';
    this.endLive();
    if (effect) await this.call('effect.stop', { effect }).catch(() => {});
    return this.live;
  }

  clearLive() {
    this.liveResults = [];
    this.save('live-results.json', this.liveResults);
  }

  stop() {
    this.offProc?.kill();
    this.endLive();
  }

  /** Moyennes par phase et par rôle (moteur Chaos, jeu au premier plan, compositeur, OBS), puis écarts à la référence. */
  private liveReport(): Json {
    const roles = ['chaos', 'foreground', 'dwm', 'obs'];
    const byPhase: Record<string, Json> = {};
    for (const ph of PHASES) {
      const s = this.liveSamples.filter((x) => x.phase === ph);
      const r: Json = { samples: s.length };
      const rate = (
        pick: (x: Sample) => number | null,
        scale: number,
      ): number | null => {
        const v: number[] = [];
        for (let i = 1; i < s.length; i++) {
          const a = pick(s[i - 1]!),
            b = pick(s[i]!),
            dt = s[i]!.t_ms - s[i - 1]!.t_ms;
          if (a !== null && b !== null && dt > 0 && b >= a)
            v.push(((b - a) / dt) * scale);
        }
        return v.length
          ? Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 10) / 10
          : null;
      };
      for (const role of roles) {
        const proc = (x: Sample) => x.processes.filter((p) => p.role === role);
        const sum = (x: Sample, k: 'gpu_ms' | 'cpu_ms') => {
          const ps = proc(x);
          if (!ps.length || ps.every((p) => p[k] === null)) return null;
          return ps.reduce((t, p) => t + (p[k] ?? 0), 0);
        };
        const mem = s
          .map((x) => proc(x).reduce((t, p) => t + (p.working_set_mb ?? 0), 0))
          .filter((x) => x > 0);
        const names = [
          ...new Set(s.flatMap((x) => proc(x).map((p) => p.name ?? '?'))),
        ];
        r[role] = {
          names,
          gpu_pct: rate((x) => sum(x, 'gpu_ms'), 100),
          cpu_pct: rate((x) => sum(x, 'cpu_ms'), 100 / this.liveCores),
          working_set_mb: mem.length
            ? Math.round(mem.reduce((x, y) => x + y, 0) / mem.length)
            : null,
        };
      }
      r.gpu_all_pct = rate((x) => x.gpu_ms_all, 100);
      byPhase[ph] = r;
    }
    const delta = (role: string, k: string): number | null => {
      const a = (byPhase.reference?.[role] as Json | undefined)?.[k],
        b = (byPhase.effect?.[role] as Json | undefined)?.[k];
      return typeof a === 'number' && typeof b === 'number'
        ? Math.round((b - a) * 10) / 10
        : null;
    };
    const tel = this.liveTelemetry
      .flatMap((e) => (e.surfaces as Json[] | undefined) ?? [])
      .filter(Boolean);
    const num = (k: string) =>
      tel.map((x) => x[k]).filter((v): v is number => typeof v === 'number');
    const max = (v: number[]) => (v.length ? Math.max(...v) : null);
    const mean = (v: number[]) =>
      v.length
        ? Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 100) / 100
        : null;
    const games = this.liveSamples
      .map((x) => x.game_active)
      .filter((g): g is string => !!g);
    return {
      at: new Date().toISOString(),
      effect: this.live.effect,
      label: this.live.label,
      phases_s: this.live.phases_s,
      game_active: games.length ? games[games.length - 1] : null,
      phases: byPhase,
      deltas: {
        game_gpu_pct: delta('foreground', 'gpu_pct'),
        game_cpu_pct: delta('foreground', 'cpu_pct'),
        chaos_gpu_pct: delta('chaos', 'gpu_pct'),
        chaos_cpu_pct: delta('chaos', 'cpu_pct'),
        dwm_gpu_pct: delta('dwm', 'gpu_pct'),
        obs_gpu_pct: delta('obs', 'gpu_pct'),
        gpu_all_pct: (() => {
          const a = byPhase.reference?.gpu_all_pct,
            b = byPhase.effect?.gpu_all_pct;
          return typeof a === 'number' && typeof b === 'number'
            ? Math.round((b - a) * 10) / 10
            : null;
        })(),
      },
      chaos: {
        processing_p95_ms_max: max(num('processing_p95_ms')),
        present_fps_mean: mean(num('present_fps')),
        capture_fps_mean: mean(num('capture_fps')),
        added_latency_p95_ms_max: max(num('added_latency_est_p95_ms')),
        dropped: num('dropped').reduce((x, y) => x + y, 0),
        telemetry_samples: tel.length,
      },
      game_fps: null,
      stutters: null,
      not_measured: [
        'images/s du jeu et à-coups : il faut PresentMon (traces de Windows, droits d’administrateur)',
        'temps GPU d’OBS par source : lire le dock « Statistiques » d’OBS pendant l’essai',
      ],
    };
  }
}

// ---------- Exports ----------
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function offscreenCsv(st: OffscreenState): string {
  const cols = [
    'id',
    'label',
    'kind',
    'level',
    'status',
    'resolution',
    'frames',
    'gpu_ms_p50',
    'gpu_ms_p95',
    'gpu_ms_p99',
    'gpu_ms_max',
    'gpu_ms_over_reference',
    'cpu_ms_p50',
    'cpu_ms_p95',
    'alloc_bytes_per_frame',
    'vram_delta_mb',
    'passes',
    'layers',
  ];
  return [
    cols.join(';'),
    ...st.results.map((r) => cols.map((c) => csvCell(r[c])).join(';')),
  ].join('\r\n');
}

export function liveCsv(results: Json[]): string {
  const cols = [
    'at',
    'effect',
    'label',
    'game_active',
    'game_gpu_pct',
    'game_cpu_pct',
    'chaos_gpu_pct',
    'chaos_cpu_pct',
    'dwm_gpu_pct',
    'obs_gpu_pct',
    'gpu_all_pct',
  ];
  return [
    cols.join(';'),
    ...results.map((r) =>
      cols
        .map((c) =>
          csvCell(c in r ? r[c] : (r.deltas as Json | undefined)?.[c]),
        )
        .join(';'),
    ),
  ].join('\r\n');
}

const esc = (s: unknown) =>
  String(s ?? '—').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

/** Rapport HTML autonome (ouvrable sans Studio). */
export function reportHtml(
  st: OffscreenState,
  live: Json[],
  sys: Json | null,
): string {
  const gpu = (sys?.gpu as Json | undefined) ?? {};
  const cpu = (sys?.cpu as Json | undefined) ?? {};
  const rows = st.results
    .map(
      (r) =>
        `<tr><td>${esc(r.label)}</td><td>${esc(r.level ?? '')}</td><td>${esc(r.status)}</td><td>${esc(r.gpu_ms_p50)}</td><td>${esc(r.gpu_ms_p95)}</td><td>${esc(r.gpu_ms_p99)}</td><td>${esc(r.gpu_ms_over_reference)}</td><td>${esc(r.cpu_ms_p50)}</td><td>${esc(r.alloc_bytes_per_frame)}</td><td>${esc(r.vram_delta_mb)}</td></tr>`,
    )
    .join('');
  const lrows = live
    .map((r) => {
      const d = (r.deltas as Json) ?? {};
      return `<tr><td>${esc(r.label)}</td><td>${esc(r.game_active ?? 'aucun')}</td><td>${esc(d.game_gpu_pct)}</td><td>${esc(d.chaos_gpu_pct)}</td><td>${esc(d.dwm_gpu_pct)}</td><td>${esc(d.obs_gpu_pct)}</td><td>${esc(d.gpu_all_pct)}</td><td>non mesurées</td></tr>`;
    })
    .join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chaos Performance Lab</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1b1d22;background:#fff}table{border-collapse:collapse;width:100%;margin:12px 0 28px}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#f4f5f7}p.n{color:#555}@media (prefers-color-scheme:dark){body{background:#16181d;color:#e8e9ec}th{background:#22252c}th,td{border-color:#333}p.n{color:#aaa}}</style></head><body>
<h1>Chaos Performance Lab</h1>
<p>${esc(gpu.name)} (${esc(gpu.dedicated_vram_mb)} Mo) · ${esc(cpu.name)} · ${esc(sys?.memory_mb)} Mo de mémoire</p>
<h2>Banc hors écran ${esc((st.options as Json | undefined)?.width)}×${esc((st.options as Json | undefined)?.height)} (${esc(st.status)})</h2>
<p class="n">Temps GPU du moteur Chaos seul, sur une scène de synthèse : un coût relatif entre effets, pas les images/s d’un jeu.</p>
<table><tr><th>Effet</th><th>Niveau</th><th>Statut</th><th>GPU médian (ms)</th><th>p95</th><th>p99</th><th>Surcoût / référence</th><th>CPU (ms)</th><th>Allocations (o/image)</th><th>Mémoire vidéo (Mo)</th></tr>${rows}</table>
<h2>Essais en jeu (écarts pendant l’effet, en points de % d’utilisation)</h2>
<table><tr><th>Effet</th><th>Jeu au premier plan</th><th>GPU du jeu</th><th>GPU de Chaos</th><th>GPU du compositeur</th><th>GPU d’OBS</th><th>GPU total</th><th>Images/s du jeu</th></tr>${lrows}</table>
</body></html>`;
}
