import {
  esc,
  fld,
  grp,
  ic,
  motionOk,
  numrow,
  page,
  patch,
  poller,
  row,
  run,
  seg,
  stateChip,
  sw,
} from '../ds/ds.js';
import { getJson, postJson } from '../http.js';

// Studio › Chaos (docs/chaos/ARCHITECTURE_MOTEUR.md) : le moteur natif d'effets d'écran. La page lit tout du moteur
// (registre, état, mesures) et ne décide rien : elle règle le retournement (préréglage « default »), lance des essais
// locaux (source « studio », aucun Jeton), arrête tout, et montre ce que le moteur mesure. Arrêt d'urgence hors Studio :
// Ctrl+Maj+F11 (gardien du moteur). Deux méthodes de retournement : le calque sur la fenêtre du jeu (défaut, aucun
// changement d'affichage) et Windows (EXPÉRIMENTAL : écran entier, souris inversée, mais chaque bascule reconfigure
// l'affichage de tout le PC ; incident du 22/11, docs/chaos/ETUDE_PERFORMANCES_RETOURNEMENT.md).

interface Param {
  id: string;
  type: string;
  label?: string;
  help?: string;
  values?: string[];
  min?: number;
  max?: number;
  default: unknown;
  exposed?: boolean;
  animatable?: boolean;
  unit?: string;
}
interface EffectDef {
  id: string;
  version: number;
  label: string;
  description: string;
  family: string;
  slot: string;
  internal: boolean;
  input?: string;
  params: Param[];
  duration: { default_ms: number };
  transitions: Record<
    'in' | 'out',
    { kind: string; duration_ms?: number; kinds?: string[] }
  >;
  gpu: { primitive: string; cost: string };
}
interface Registry {
  version: number;
  families: Record<string, { label: string }>;
  slots: Record<string, { label: string }>;
  effects: EffectDef[];
  engine_limits: { min_duration_ms: number; max_duration_ms: number };
}
interface EffectView {
  request_id: string;
  effect: string;
  state: string;
  source: { kind: string; ref: string | null };
  target: {
    title?: string;
    process?: string | null;
    mode?: string;
    input?: string | null;
  };
  remaining_ms?: number;
  resolved: { duration_ms: number };
}
interface Side {
  kind?: string;
  duration_ms?: number;
}
interface Preset {
  params?: Record<string, unknown>;
  duration_ms?: number;
  transition?: { in?: Side; out?: Side };
}
interface Config {
  engine: {
    follow_foreground: boolean;
    default_mode?: string;
    input_effects?: boolean;
    capture_linger_ms: number;
  };
  safety: {
    max_duration_ms: number;
    max_active_effects: number;
    safe_mode: boolean;
  };
  performance?: {
    profile: string;
    max_fps: number;
    max_passes: number;
    render_scale: number;
    gpu_budget_ms: number;
    on_overload: string;
    zero_copy: boolean;
  };
  presets: Record<string, Record<string, Preset>>;
}
interface Status {
  active: EffectView[];
  queued: EffectView[];
  surfaces: { key: string; mode: string; visible: boolean; size: string }[];
  captures_open: number;
  degraded: boolean;
  guardian: { pid: number; hotkey: string };
  input?: {
    active: { device: string; owner: string; since_ms: number }[];
    last_apply_ms: number;
    last_revert_ms: number;
  };
  config: Config;
}
interface Surf {
  key: string;
  size: string;
  visible: boolean;
  capture_fps: number;
  present_fps: number;
  dropped: number;
  processing_p50_ms: number;
  processing_p95_ms: number;
  black: boolean;
  rate_hz?: number;
  refresh_hz?: number;
  pacer?: string | null;
  frame_gpu_est_ms?: number;
  added_latency_est_p50_ms?: number;
  skipped_static?: number;
  capture?: { zero_copy?: boolean } | null;
}
interface Telemetry {
  surfaces: Surf[];
  passes: Record<string, { p50_ms: number; max_ms: number }>;
  process: { cpu_pct: number; private_mb: number };
  vram_mb: number;
  degraded: boolean;
  degraded_reason: string | null;
  performance?: {
    profile: string;
    level: number;
    over_budget: boolean;
    gpu_budget_ms: number;
  };
}
interface Ev {
  event: string;
  t_ms: number;
  request_id?: string;
  effect?: string;
  reason?: string;
  detail?: string;
  state?: string;
  call_ms?: number;
}
interface State {
  engine: {
    status: 'absent' | 'stopped' | 'starting' | 'ready' | 'restarting';
    pid: number | null;
    hello: Record<string, unknown> | null;
    restarts: number;
    lastExit: { reason: string | null; code: number | null; at: string } | null;
    lastError: string | null;
    available: boolean;
  };
  registry: { registry: Registry; implemented: string[] } | null;
  status: Status | null;
  telemetry: Telemetry | null;
  events: Ev[];
}
interface Mon {
  device: string;
  label: string;
  primary: boolean;
  orientation: number;
  foreground: boolean;
}
interface Win {
  hwnd: number;
  title: string;
  process: string;
  width: number;
  height: number;
  minimized: boolean;
}

const FILL: [string, string][] = [
  ['mirror', 'Miroir flou'],
  ['black', 'Noir'],
  ['cover', 'Zoom'],
];
const DURATIONS: [string, string][] = [
  ['5000', '5 s'],
  ['10000', '10 s'],
  ['20000', '20 s'],
  ['30000', '30 s'],
];
const REASON: Record<string, string> = {
  duration: 'durée écoulée',
  canceled: 'arrêté',
  stop_all: 'STOP ALL',
  studio_stop_all: 'STOP ALL',
  emergency_hotkey: 'arrêt d’urgence (Ctrl+Maj+F11)',
  target_lost: 'fenêtre fermée',
  display_changed: 'écran rétabli hors de Chaos (Paramètres de Windows ?)',
  input_unavailable: 'Windows refuse de retourner cet écran',
  input_busy: 'écran déjà retourné par un autre effet',
  capture_lost: 'capture perdue',
  never_visible: 'la fenêtre n’est jamais passée au premier plan',
  no_frame: 'aucune image capturée (fenêtre protégée ?)',
  effect_error: 'erreur de l’effet',
  replaced: 'remplacé',
  queue_ttl: 'attente trop longue',
  queue_full: 'file pleine',
  same_effect_active: 'déjà en cours sur cette cible',
  slot_busy: 'emplacement occupé',
  capacity: 'trop d’effets en même temps',
  start_timeout: 'démarrage trop long',
  shutdown: 'moteur arrêté',
};
const EVENT: Record<string, string> = {
  'effect.accepted': 'accepté',
  'effect.queued': 'en file',
  'effect.started': 'démarré',
  'effect.extended': 'prolongé',
  'effect.ended': 'terminé',
  'effect.failed': 'échec',
  'effect.canceled': 'annulé',
  'effect.expired': 'expiré',
  'effect.rejected': 'refusé',
  'engine.emergency_stop': 'Arrêt d’urgence',
  'engine.degraded': 'Moteur ralenti : qualité réduite',
  'engine.over_budget': 'Moteur au-delà de son budget (signalé)',
  'engine.recovered': 'Moteur revenu à la normale',
  'engine.error': 'Erreur du moteur',
  'engine.input': 'Affichage',
};
const STATE: Record<string, string> = {
  queued: 'en file',
  starting: 'démarre',
  active: 'en cours',
  exiting: 'se termine',
};

const NBSP = String.fromCharCode(160);
// Profils du moteur (docs/chaos/PERFORMANCES_MOTEUR.md) ; « personnalise » s'affiche seulement s'il est en cours.
const PROFILES: [string, string][] = [
  ['qualite', 'Qualité'],
  ['equilibre', 'Équilibré'],
  ['economie', 'Économie'],
];
function perfSummary(p: NonNullable<Config['performance']>): string {
  return [
    p.profile === 'personnalise' ? 'Réglages personnalisés' : null,
    p.max_fps > 0 ? `${p.max_fps} images/s au plus` : 'cadence de l’écran',
    `${p.max_passes} passes GPU au plus`,
    p.render_scale < 1
      ? `passes intermédiaires à ${Math.round(p.render_scale * 100)} %`
      : null,
    `budget GPU ${p.gpu_budget_ms} ms par image`,
  ]
    .filter(Boolean)
    .join(' · ');
}
const nb = (v: number, digits = 1) =>
  v.toLocaleString('fr-FR', { maximumFractionDigits: digits });
const ms = (v: number | undefined) =>
  v === undefined || v < 0 ? '—' : `${nb(v, v < 10 ? 2 : 0)}${NBSP}ms`;
const secs = (v: number) => `${Math.ceil(v / 1000)} s`;

export function mountChaosPage(root: HTMLElement) {
  const p = page(root, {
    title: 'Chaos · effets d’écran',
    mod: 'chaos',
    panel: true,
    folded: ['Réinitialiser'],
  });
  p.body.innerHTML = `<div class="cx">
    <div class="cx__main">
      <section class="cx-card cx-stage">
        <header><h2>Écran retourné</h2><span class="d-faint" data-z="method-sub"></span><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-replay>${ic('repeat')}Rejouer l’aperçu</button></header>
        <div class="cx-stage__row">
          <div class="cx-screen" data-z="screen" aria-label="Aperçu du retournement"><div class="cx-screen__bg"></div><div class="cx-screen__fg"><b>▲</b><span>HAUT</span><i class="cx-screen__cursor" title="Le vrai curseur, retourné avec l’écran"></i></div></div>
          <div class="cx-stage__cfg" data-z="flipcfg"></div>
        </div>
      </section>
      <section class="cx-card"><header><h2>Tester sur ce PC</h2><span class="d-faint">Sans Jetons, sans viewers</span></header><div data-z="test"></div></section>
      <section class="cx-card"><header><h2>En cours</h2></header><div data-z="live"></div></section>
    </div>
    <aside class="cx__side">
      <section class="cx-card"><header><h2>Catalogue</h2><span class="d-sp"></span><label class="cx-inline">${sw(false, 'data-diag', 'Afficher le diagnostic')}<span class="d-faint">Diagnostic</span></label></header><div data-z="catalog"></div></section>
      <section class="cx-card"><header><h2>Moteur</h2><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-restart>${ic('refund')}Relancer</button></header><div data-z="engine"></div></section>
      <section class="cx-card"><header><h2>Journal</h2></header><ol class="cx-log" data-z="events"></ol></section>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let st: State | null = null;
  let readError = '';
  let windows: Win[] = [];
  let monitors: Mon[] = [];
  let targetSel = 'foreground';
  let effectSel = 'flip';
  let showDiag = false;
  let countdown = 0;

  const reg = () => st?.registry?.registry ?? null;
  const def = (id: string) => reg()?.effects.find((e) => e.id === id) ?? null;
  const cfg = () => st?.status?.config ?? null;
  const flipPreset = (): Preset => cfg()?.presets.flip?.default ?? {};
  const flipFill = () =>
    String(
      flipPreset().params?.fill ??
        def('flip')?.params.find((x) => x.id === 'fill')?.default ??
        'mirror',
    );
  const viaWindows = () => cfg()?.engine.input_effects === true;
  const flipDuration = () =>
    flipPreset().duration_ms ?? def('flip')?.duration.default_ms ?? 10000;
  const side = (k: 'in' | 'out') => ({
    kind:
      flipPreset().transition?.[k]?.kind ??
      def('flip')?.transitions[k].kind ??
      'ramp',
    ms:
      flipPreset().transition?.[k]?.duration_ms ??
      def('flip')?.transitions[k].duration_ms ??
      550,
  });

  // ---------- En-tête ----------
  function paintHead() {
    const e = st?.engine;
    const chip = !st
      ? stateChip(readError ? 'r' : 'w', readError || 'Lecture…')
      : e?.status === 'ready'
        ? stateChip(
            'live',
            st.status?.active.length
              ? `${st.status.active.length} effet(s) en cours`
              : 'Moteur prêt',
          )
        : e?.status === 'absent'
          ? stateChip('r', 'Moteur absent')
          : e?.status === 'restarting'
            ? stateChip('w', 'Relance du moteur…')
            : e?.status === 'starting'
              ? stateChip('w', 'Démarrage du moteur…')
              : stateChip('off', 'Moteur arrêté');
    patch(p.state, chip);
    patch(
      p.actions,
      `<button type="button" class="d-btn danger" data-stopall ${e?.status === 'ready' ? '' : 'disabled'}>${ic('stop')}STOP ALL</button><button type="button" class="d-btn ghost" data-panel>${ic('sliders')}Réglages</button>`,
    );
  }

  // ---------- Aperçu et réglage du retournement ----------
  let anim = 0;
  function preview() {
    const screen = z('screen');
    const fg = screen.querySelector<HTMLElement>('.cx-screen__fg')!;
    const bg = screen.querySelector<HTMLElement>('.cx-screen__bg')!;
    cancelAnimationFrame(anim);
    const fill = flipFill();
    screen.dataset.fill = fill;
    const inS = side('in');
    const outS = side('out');
    const ease = (t: number) =>
      (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2;
    const cover = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return Math.abs(Math.cos(r)) + (16 / 9) * Math.abs(Math.sin(r));
    };
    const put = (deg: number) => {
      const s = fill === 'cover' ? cover(deg) : 1;
      fg.style.transform = `rotate(${deg}deg) scale(${s})`;
      bg.style.transform = `rotate(${deg}deg) scale(-1.9, 1.9)`;
    };
    if (!motionOk()) return put(180);
    const tIn = inS.kind === 'cut' ? 0 : inS.ms;
    const tOut = outS.kind === 'cut' ? 0 : outS.ms;
    const hold = 1100;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = now - t0;
      if (t < tIn) put(180 * ease(t / tIn));
      else if (t < tIn + hold) put(180);
      else if (t < tIn + hold + tOut)
        put(180 + 180 * ease((t - tIn - hold) / tOut));
      else return put(0);
      anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function paintFlipCfg() {
    const el = z('flipcfg');
    patch(
      z('method-sub'),
      viaWindows()
        ? 'Windows · écran entier · souris inversée (expérimental)'
        : 'Calque · fenêtre du jeu',
    );
    if (
      el.contains(document.activeElement) &&
      document.activeElement instanceof HTMLInputElement
    )
      return;
    if (!def('flip'))
      return patch(
        el,
        '<p class="d-faint">Le registre du moteur n’est pas encore lu.</p>',
      );
    const i = side('in');
    const o = side('out');
    const durKey = String(flipDuration());
    patch(
      el,
      `${row(
        'Méthode',
        seg(
          'data-method',
          [
            ['overlay', 'Calque'],
            ['windows', 'Windows (expérimental)'],
          ],
          viaWindows() ? 'windows' : 'overlay',
        ),
        'méthode calque windows orientation souris',
      )}
       ${
         viaWindows()
           ? '<p class="d-note cx-facts"><b>Expérimental, jamais en direct.</b> Windows retourne tout l’écran : vrai curseur, souris inversée, clic sous le curseur. Mais chaque bascule reconfigure l’affichage de tout le PC : le 22/11, Overwatch est tombé à 17 images/s pendant des bascules d’essai sur l’autre écran.</p>'
           : '<p class="cx-facts">Le calque retourne l’image du jeu (fenêtre au premier plan) sans toucher à l’affichage de Windows. Le vrai curseur, lui, n’est pas retourné : le clic tombe au point symétrique de ce que l’on voit.</p>'
       }
       ${row('Coins pendant la rotation', seg('data-fill', FILL, flipFill()), 'miroir noir zoom remplissage')}
       <p class="d-faint cx-help">${flipFill() === 'mirror' ? 'Le prolongement flou et sombre de l’image déjà tournée : l’ancien écran n’apparaît jamais.' : flipFill() === 'black' ? 'Les coins découverts sont noirs.' : 'L’image grossit juste assez pour qu’aucun coin ne soit découvert.'} ${viaWindows() ? ' Seulement pendant les rotations : écran retourné, Windows affiche l’image entière.' : ''}</p>
       ${row('Durée', seg('data-dur', DURATIONS.some(([k]) => k === durKey) ? DURATIONS : [...DURATIONS, [durKey, secs(Number(durKey))]], durKey), 'temps')}
       ${row(
         'Entrée',
         `${seg(
           'data-in',
           [
             ['ramp', 'Rotation'],
             ['cut', 'Instantanée'],
           ],
           i.kind,
         )}${i.kind === 'ramp' ? fld('data-in-ms min="545" max="3000" step="50" aria-label="Durée de la rotation d’entrée"', i.ms, 'ms') : ''}`,
         'transition bascule',
       )}
       ${row(
         'Sortie',
         `${seg(
           'data-out',
           [
             ['ramp', 'Rotation'],
             ['cut', 'Instantanée'],
           ],
           o.kind,
         )}${o.kind === 'ramp' ? fld('data-out-ms min="545" max="3000" step="50" aria-label="Durée de la rotation de sortie"', o.ms, 'ms') : ''}`,
         'transition',
       )}`,
    );
  }

  async function savePreset(change: (p: Preset) => void) {
    const next: Preset = JSON.parse(JSON.stringify(flipPreset())) as Preset;
    change(next);
    const ok = await run(null, async () => {
      await postJson('/api/chaos/preset', {
        effect: 'flip',
        name: 'default',
        value: next,
      });
      await refresh();
    });
    if (ok) {
      paintFlipCfg();
      preview();
    }
  }

  // ---------- Essai ----------
  function paintTest() {
    const el = z('test');
    if (
      el.contains(document.activeElement) &&
      document.activeElement instanceof HTMLSelectElement
    )
      return;
    const effects = (reg()?.effects ?? []).filter(
      (e) => showDiag || !e.internal,
    );
    const ready = st?.engine.status === 'ready';
    const opt = (value: string, label: string, disabled = false) =>
      `<option value="${esc(value)}" ${value === targetSel ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`;
    const win = viaWindows();
    const screenOpts = monitors.map((m) =>
      opt(
        `mon:${m.device}`,
        `${m.label}${m.orientation ? ` · déjà tourné de ${m.orientation}°` : ''}`,
      ),
    );
    const windowOpts = windows.map((w) =>
      opt(
        String(w.hwnd),
        `${w.title.slice(0, 70)} — ${w.process} (${w.width}×${w.height})${w.minimized ? ' · réduite' : ''}`,
        w.minimized,
      ),
    );
    // Calque : la fenêtre du jeu (vue par la capture d'écran d'OBS) ; Windows : l'écran entier. L'autre cible reste
    // accessible en Diagnostic.
    const group = (label: string, items: string[]) =>
      showDiag && items.length
        ? `<optgroup label="${esc(label)}">${items.join('')}</optgroup>`
        : '';
    const opts = [
      opt(
        'foreground',
        win
          ? 'Écran du jeu au premier plan, dans 3 s (passe dans le jeu)'
          : 'Fenêtre du jeu au premier plan, dans 3 s (passe dans le jeu)',
      ),
      ...(win ? screenOpts : windowOpts),
      win
        ? group('Diagnostic : fenêtre seule (calque, sans bascule)', windowOpts)
        : group(
            'Diagnostic : écran entier en calque (invisible dans OBS)',
            screenOpts,
          ),
    ].join('');
    patch(
      el,
      `<div class="cx-test">
        <label class="cx-test__f"><span class="d-lb">Effet</span><select data-effect>${effects.map((e) => `<option value="${esc(e.id)}" ${e.id === effectSel ? 'selected' : ''}>${esc(e.label)}${e.internal ? ' (diagnostic)' : ''}</option>`).join('')}</select></label>
        <label class="cx-test__f cx-test__t"><span class="d-lb">Cible</span><select data-target>${opts}</select></label>
        <button type="button" class="d-ib" data-refresh-targets aria-label="Actualiser la liste des écrans" title="Actualiser">${ic('repeat')}</button>
        <button type="button" class="d-btn pri" data-test ${ready && !countdown ? '' : 'disabled'}>${countdown ? `Dans ${countdown} s…` : `${ic('play')}Tester`}</button>
      </div>
      <p class="d-faint cx-help">Le jeu doit être en <b>fenêtré sans bordure</b> (le plein écran exclusif est refusé). Arrêt d’urgence partout : <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>F11</kbd>${win ? ' ; si le moteur s’arrête pour n’importe quelle raison, Windows remet l’écran à l’endroit' : ''}.</p>`,
    );
  }

  async function loadTargets() {
    try {
      const t = await getJson<{ windows: Win[]; monitors?: Mon[] }>(
        '/api/chaos/targets',
      );
      windows = t.windows;
      monitors = t.monitors ?? [];
    } catch {
      windows = [];
      monitors = [];
    }
    if (targetSel !== 'foreground' && !targetValid()) targetSel = 'foreground';
    paintTest();
  }

  function targetValid() {
    const screen = targetSel.startsWith('mon:');
    const listed = screen
      ? monitors.some((m) => `mon:${m.device}` === targetSel)
      : windows.some((w) => String(w.hwnd) === targetSel);
    // La cible de l'autre méthode n'est proposée qu'en Diagnostic.
    return listed && (showDiag || screen === viaWindows());
  }

  async function test(btn: HTMLElement | null) {
    // « Premier plan » : le moteur vise l'écran du jeu (default_mode = monitor).
    const target =
      targetSel === 'foreground'
        ? { kind: 'foreground' }
        : targetSel.startsWith('mon:')
          ? { kind: 'monitor', device: targetSel.slice(4) }
          : { kind: 'window', hwnd: Number(targetSel) };
    const send = () =>
      run(
        btn,
        async () => {
          await postJson('/api/chaos/test', { effect: effectSel, target });
          await refresh();
        },
        undefined,
        { unknown_effect: 'Effet inconnu du moteur.' },
      );
    if (targetSel !== 'foreground') return void send();
    countdown = 3;
    paintTest();
    const tick = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) {
        clearInterval(tick);
        countdown = 0;
        paintTest();
        void send();
      } else paintTest();
    }, 1000);
  }

  // ---------- En cours ----------
  function paintLive() {
    const s = st?.status;
    const rows = [...(s?.active ?? []), ...(s?.queued ?? [])];
    patch(
      z('live'),
      !rows.length
        ? '<p class="d-faint">Aucun effet en cours.</p>'
        : `<ul class="cx-live">${rows
            .map((v) => {
              const d = def(v.effect);
              return `<li><b>${esc(d?.label ?? v.effect)}</b>
                <span class="d-tag ${v.state === 'active' ? 'ok' : v.state === 'queued' ? 'off' : 'warn'}">${esc(STATE[v.state] ?? v.state)}</span>
                <span class="d-faint cx-live__t">${esc(v.target.mode === 'C' ? (v.target.title ?? 'écran entier') : `fenêtre seule · ${v.target.process ?? ''}`)}${v.target.input ? ' · souris inversée' : ''}${v.remaining_ms !== undefined ? ` · reste ${secs(v.remaining_ms)}` : ''}</span>
                <span class="d-tag off">${esc(v.source.kind)}</span>
                <button type="button" class="d-btn ghost sm" data-cancel="${esc(v.request_id)}">${ic('stop')}Arrêter</button></li>`;
            })
            .join('')}</ul>`,
    );
  }

  // ---------- Catalogue ----------
  function paintCatalog() {
    const r = reg();
    const impl = new Set(st?.registry?.implemented ?? []);
    patch(
      z('catalog'),
      !r
        ? '<p class="d-faint">Registre illisible : le moteur n’est pas prêt.</p>'
        : `<ul class="cx-cat">${r.effects
            .filter((e) => showDiag || !e.internal)
            .map(
              (
                e,
              ) => `<li class="${e.internal ? 'is-diag' : ''}"><div class="cx-cat__h"><b>${esc(e.label)}</b><span class="d-tag">${esc(r.families[e.family]?.label ?? e.family)}</span>${e.input ? '<span class="d-tag" title="Couche Entrées : écran entier">souris inversée</span>' : ''}${impl.has(e.id) ? '' : '<span class="d-tag bad">non implémenté</span>'}</div>
                <p>${esc(e.description)}</p>
                <p class="d-faint">${esc(r.slots[e.slot]?.label ?? e.slot)} · ${e.params.filter((x) => x.exposed !== false).length} réglage(s) · ${esc(e.gpu.primitive)} · v${e.version}</p></li>`,
            )
            .join(
              '',
            )}</ul><p class="d-faint cx-help">Registre v${r.version} : un seul fichier partagé par le moteur, Studio et le futur Core.</p>`,
    );
  }

  // ---------- Moteur et mesures ----------
  function paintEngine() {
    const e = st?.engine;
    if (!e) return patch(z('engine'), '');
    const h = e.hello ?? {};
    const t = st?.telemetry;
    const g = st?.status?.guardian;
    const hot =
      g?.hotkey === 'active'
        ? '<span class="d-tag ok">actif</span>'
        : g?.hotkey === 'unavailable'
          ? '<span class="d-tag warn">indisponible</span>'
          : '<span class="d-tag off">démarrage</span>';
    const surf = t?.surfaces?.[0];
    const passes = Object.entries(t?.passes ?? {});
    const inp = st?.status?.input;
    const held = inp?.active ?? [];
    patch(
      z('engine'),
      e.status === 'absent'
        ? `<p class="d-note bad">Moteur introuvable. Construire <code>apps/chaos-engine/build.cmd</code> (développement) ; un Studio installé ne l’embarque pas encore.</p>`
        : `<dl class="d-kv cx-kv">
          <dt>Version</dt><dd>${esc(String(h.version ?? '—'))} · protocole ${esc(String(h.protocol ?? '—'))}</dd>
          <dt>Carte graphique</dt><dd>${esc(String(h.adapter ?? '—'))}</dd>
          <dt>Prêt en</dt><dd>${esc(ms(Number(h.ready_ms ?? -1)))}</dd>
          <dt>Arrêt d’urgence</dt><dd>Ctrl+Maj+F11 ${hot}</dd>
          <dt>Relances</dt><dd>${e.restarts}${e.lastExit ? ` · dernier arrêt : ${esc(REASON[e.lastExit.reason ?? ''] ?? e.lastExit.reason ?? `code ${e.lastExit.code}`)}` : ''}</dd>
          <dt>Captures ouvertes</dt><dd>${st?.status?.captures_open ?? 0}</dd>
          ${viaWindows() || held.length ? `<dt>Écran retourné</dt><dd>${held.length ? `${held.map((x) => esc(monitors.find((m) => m.device === x.device)?.label ?? x.device)).join(', ')} <span class="d-tag warn">par Windows</span>` : 'aucun'}${inp && inp.last_apply_ms >= 0 ? ` · bascule ${ms(inp.last_apply_ms)}${inp.last_revert_ms >= 0 ? `, retour ${ms(inp.last_revert_ms)}` : ''}` : ''}</dd>` : ''}
          ${
            surf && !surf.visible && held.length
              ? '<dt>Calque</dt><dd>retiré : Windows tient l’écran, aucune capture</dd>'
              : surf
                ? `<dt>Capture / affichage</dt><dd>${nb(surf.capture_fps)} / ${nb(surf.present_fps)}${NBSP}images/s${surf.dropped ? ` · ${surf.dropped}${NBSP}perdue(s)` : ''}</dd>
          <dt>Traitement</dt><dd>${ms(surf.processing_p50_ms)} (p95 ${ms(surf.processing_p95_ms)})${surf.black ? ' · <span class="d-tag warn">image noire</span>' : ''}</dd>
          <dt>Cadence</dt><dd>${surf.rate_hz !== undefined ? `${nb(surf.rate_hz, 0)}${NBSP}images/s au plus (écran ${nb(surf.refresh_hz ?? 0, 0)}${NBSP}Hz)` : '—'}${surf.pacer ? ` · rythme ${surf.pacer === 'vblank' ? 'de l’écran' : 'minuteur'}` : ''}${surf.capture?.zero_copy ? ' · sans copie' : ''}</dd>
          ${surf.frame_gpu_est_ms !== undefined && surf.frame_gpu_est_ms >= 0 ? `<dt>GPU par image</dt><dd>${ms(surf.frame_gpu_est_ms)}${t?.performance ? ` (budget ${ms(t.performance.gpu_budget_ms)})` : ''}${surf.added_latency_est_p50_ms !== undefined && surf.added_latency_est_p50_ms >= 0 ? ` · latence ajoutée ≈${NBSP}${ms(surf.added_latency_est_p50_ms)}` : ''}</dd>` : ''}`
                : ''
          }
          ${passes.length ? `<dt>GPU par passe</dt><dd>${passes.map(([k, v]) => `${esc(k)} ${ms(v.p50_ms)}`).join(' · ')}</dd>` : ''}
          ${t ? `<dt>Processus</dt><dd>CPU ${nb(t.process.cpu_pct, 2)}${NBSP}% · ${nb(t.process.private_mb, 0)}${NBSP}Mo · vidéo ${nb(t.vram_mb, 0)}${NBSP}Mo</dd>` : ''}
        </dl>
        ${g?.hotkey === 'unavailable' ? '<p class="d-note">Ctrl+Maj+F11 est déjà pris par une autre application (par exemple l’ancien panneau du lot 1) : la fermer active l’arrêt d’urgence. STOP ALL reste disponible ici.</p>' : ''}
        ${t?.degraded ? `<p class="d-note">Qualité réduite (palier ${t.performance?.level ?? 1}) : ${esc(t.degraded_reason ?? '')}</p>` : ''}
        ${t?.performance?.over_budget ? '<p class="d-note">Le moteur dépasse son budget (signalé, qualité inchangée).</p>' : ''}
        ${e.lastError ? `<p class="d-note bad">${esc(e.lastError)}</p>` : ''}
        <p class="d-faint cx-help">Mesures internes du moteur : la latence ressentie en jeu se mesure avec PresentMon.</p>`,
    );
  }

  function paintEvents() {
    const evs = (st?.events ?? [])
      .filter((e) => EVENT[e.event])
      .slice(-14)
      .reverse();
    patch(
      z('events'),
      evs.length
        ? evs
            .map((e) => {
              const d = e.effect ? def(e.effect) : null;
              const why =
                e.event === 'engine.input'
                  ? ` ${e.state === 'applied' ? 'retourné par Windows' : e.state === 'restored' ? 'rétabli par Windows' : 'rétabli hors de Chaos'}${e.call_ms !== undefined && e.call_ms >= 0 ? ` (${e.call_ms} ms)` : ''}`
                  : e.reason
                    ? ` — ${REASON[e.reason] ?? e.reason}`
                    : '';
              return `<li class="${e.event === 'effect.failed' || e.event === 'engine.error' ? 'is-bad' : ''}"><span>${esc(EVENT[e.event] ?? e.event)}</span> ${esc(d?.label ?? e.effect ?? '')}${esc(why)}${e.detail ? `<small>${esc(e.detail)}</small>` : ''}</li>`;
            })
            .join('')
        : '<li class="d-faint">Rien pour l’instant.</li>',
    );
  }

  // ---------- Réglages (panneau) ----------
  let panelKey = '';
  function paintPanel() {
    const c = cfg();
    // Le relevé de chaque seconde ne réécrit le panneau que si la configuration a changé (un clic en cours reste).
    const key = JSON.stringify([c?.engine, c?.safety, reg()?.version]);
    if (key === panelKey) return;
    panelKey = key;
    if (!c)
      return p.panel.set(
        '<p class="d-faint">Réglages illisibles : le moteur n’est pas prêt.</p>',
      );
    const max = reg()?.engine_limits.max_duration_ms ?? 60000;
    p.panel.set(
      `${grp(
        'Moteur',
        'gear',
        `${row('Fenêtre seule (diagnostic) : seulement au premier plan', sw(c.engine.follow_foreground, 'data-cfg="engine.follow_foreground"', 'Fenêtre seule : seulement au premier plan'), 'focus alt tab fenêtre')}
        ${row('Performances', seg('data-perf', PROFILES, c.performance?.profile ?? 'equilibre'), 'profil performance qualité économie cadence')}
        ${c.performance ? `<p class="d-faint cx-help">${esc(perfSummary(c.performance))}</p>` : ''}
        ${row('Réduire la qualité si le moteur dépasse son budget', sw(c.performance?.on_overload !== 'signaler', 'data-reduce', 'Réduire la qualité si le moteur dépasse son budget'), 'repli performance qualité auto budget')}
        ${numrow('Garder la capture après un effet', fld('data-cfg-num="engine.capture_linger_ms" min="0" max="30000" step="500"', c.engine.capture_linger_ms, 'ms'), 'capture délai')}`,
      )}
       ${grp(
         'Sécurité',
         'shield',
         `${row('Mode sûr (pas de rotation animée)', sw(c.safety.safe_mode, 'data-cfg="safety.safe_mode"', 'Mode sûr'), 'nausée flash')}
        ${numrow('Durée maximale d’un effet', fld(`data-cfg-num="safety.max_duration_ms" min="1000" max="${max}" step="1000"`, c.safety.max_duration_ms, 'ms'), 'limite')}
        ${numrow('Effets simultanés au plus', fld('data-cfg-num="safety.max_active_effects" min="1" max="8" step="1"', c.safety.max_active_effects), 'cumul')}`,
       )}
       ${grp('Réinitialiser', 'repeat', `<div class="cx-reset"><button type="button" class="d-btn ghost sm" data-reset="presets">Réglage du retournement</button><button type="button" class="d-btn ghost sm" data-reset="engine">Moteur</button><button type="button" class="d-btn ghost sm" data-reset="safety">Sécurité</button></div>`)}`,
    );
  }

  async function setCfg(path: string, value: unknown) {
    const [section, key] = path.split('.') as [string, string];
    await run(
      null,
      async () => {
        await postJson('/api/chaos/config', {
          section,
          values: { [key]: value },
        });
        await refresh();
      },
      'Enregistré',
    );
  }

  // ---------- Relevé ----------
  function paint() {
    paintHead();
    paintFlipCfg();
    paintTest();
    paintLive();
    paintCatalog();
    paintEngine();
    paintEvents();
    paintPanel();
  }

  let first = true;
  async function refresh() {
    try {
      st = await getJson<State>('/api/chaos/state');
      readError = '';
    } catch (e) {
      readError =
        (e as Error).message === 'engine_absent'
          ? 'Moteur absent'
          : 'Studio injoignable';
    }
    paint();
    if (first && st?.engine.status === 'ready') {
      first = false;
      preview();
      void loadTargets();
    }
  }
  const poll = poller(refresh, 1000);

  // ---------- Interactions ----------
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    if (!b) return;
    if (b.matches('[data-stopall]'))
      void run(
        b,
        async () => {
          await postJson('/api/chaos/stop-all', {});
          await refresh();
        },
        'Tout est arrêté',
      );
    else if (b.matches('[data-replay]')) preview();
    else if (b.matches('[data-test]')) void test(b);
    else if (b.matches('[data-refresh-targets]')) void loadTargets();
    else if (b.dataset.cancel)
      void run(b, async () => {
        await postJson('/api/chaos/cancel', { request_id: b.dataset.cancel });
        await refresh();
      });
    else if (b.matches('[data-restart]'))
      void run(
        b,
        async () => {
          await postJson('/api/chaos/engine/restart', {});
          await refresh();
        },
        'Moteur relancé',
      );
    else if (b.dataset.reset)
      void run(
        b,
        async () => {
          await postJson('/api/chaos/config/reset', {
            section: b.dataset.reset,
          });
          await refresh();
          preview();
        },
        'Réinitialisé',
      );
    else if (b.hasAttribute('data-method')) {
      const on = b.getAttribute('data-method') === 'windows';
      void run(
        null,
        async () => {
          await postJson('/api/chaos/config', {
            section: 'engine',
            values: {
              input_effects: on,
              default_mode: on ? 'monitor' : 'window',
            },
          });
          await refresh();
          if (!targetValid()) targetSel = 'foreground';
          paintFlipCfg();
          paintTest();
        },
        on ? 'Méthode Windows (expérimentale) activée' : 'Méthode calque',
      );
    } else if (b.hasAttribute('data-perf'))
      void run(
        null,
        async () => {
          await postJson('/api/chaos/config', {
            section: 'performance',
            values: { profile: b.getAttribute('data-perf') },
          });
          await refresh();
        },
        'Profil de performances enregistré',
      );
    else if (b.closest('[data-fill]') && b.hasAttribute('data-fill'))
      void savePreset(
        (x) => ((x.params ??= {}).fill = b.getAttribute('data-fill')),
      );
    else if (b.hasAttribute('data-dur'))
      void savePreset(
        (x) => (x.duration_ms = Number(b.getAttribute('data-dur'))),
      );
    else if (b.hasAttribute('data-in'))
      void savePreset(
        (x) =>
          (((x.transition ??= {}).in ??= {}).kind = b.getAttribute('data-in')!),
      );
    else if (b.hasAttribute('data-out'))
      void savePreset(
        (x) =>
          (((x.transition ??= {}).out ??= {}).kind =
            b.getAttribute('data-out')!),
      );
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('[data-target]')) targetSel = t.value;
    else if (t.matches('[data-effect]')) effectSel = t.value;
    else if (t.matches('[data-diag]')) {
      showDiag = (t as HTMLInputElement).checked;
      if (!showDiag && !targetValid() && targetSel !== 'foreground')
        targetSel = 'foreground';
      paintCatalog();
      paintTest();
    } else if (t.matches('[data-in-ms]'))
      void savePreset(
        (x) =>
          (((x.transition ??= {}).in ??= {}).duration_ms = Number(t.value)),
      );
    else if (t.matches('[data-out-ms]'))
      void savePreset(
        (x) =>
          (((x.transition ??= {}).out ??= {}).duration_ms = Number(t.value)),
      );
    else if (t.hasAttribute('data-reduce'))
      void setCfg(
        'performance.on_overload',
        (t as HTMLInputElement).checked ? 'reduire' : 'signaler',
      );
    else if (t.dataset.cfg)
      void setCfg(t.dataset.cfg, (t as HTMLInputElement).checked);
    else if (t.dataset.cfgNum) void setCfg(t.dataset.cfgNum, Number(t.value));
  });

  paint();
  return {
    setVisible(on: boolean) {
      if (on) poll.start();
      else poll.stop();
    },
  };
}
