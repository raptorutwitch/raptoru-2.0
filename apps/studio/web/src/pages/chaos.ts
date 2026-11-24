import {
  esc,
  fld,
  grp,
  ic,
  morph,
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
import {
  activeLevel,
  catalogHtml,
  type EffectDef,
  type EffectView,
  type FxCtx,
  type FxSettings,
  type Mon,
  paramValue,
  type Preset,
  type Registry,
  runBarHtml,
  settings,
  settingsHtml,
  sheetHeadHtml,
  sheetNote,
  side,
  viewerNote,
} from './chaos-effects.js';

/** Aperçu rendu par le moteur (POST /api/chaos/preview) : grille d'images JPEG, deux séquences (début, fin). */
interface Anim {
  image: string;
  frames: number;
  cols: number;
  fps: number;
  head_ms: number;
  tail_from_ms: number;
}

// Studio › Chaos (docs/chaos/GUIDE_STUDIO_CHAOS.md) : le catalogue des effets d'écran et la fiche de chaque effet.
// On ouvre un effet, on le règle une fois (écran, durée, transitions, paramètres propres, curseur), puis on le teste ou
// on l'active tout de suite ; l'état affiché est celui du moteur. Tout vient du registre partagé et de la
// configuration du moteur ; la page ne décide rien et ne fait tourner aucun rendu (ni capture ni GPU) au repos.
// Déclenchements locaux : source « studio », aucun Jeton, aucun point de chaîne. STOP ALL ici, Ctrl+Maj+F11 partout.
// La rotation native de Windows reste une option expérimentale du panneau « Diagnostic avancé », jamais pour les viewers.

interface Config {
  engine: {
    follow_foreground: boolean;
    default_mode?: string;
    input_effects?: boolean;
    cursor_follow?: boolean;
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
  effects?: Record<string, FxSettings>;
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
  cursor_follow?: boolean;
  cursor_over?: boolean;
  cursor_latency_est_p50_ms?: number;
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
  cursor?: {
    enabled: boolean;
    hidden: boolean;
    hides: number;
    failures: number;
    last_error: string | null;
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
    /** Commandes de la page que le moteur en marche ne sert pas (moteur plus ancien que Studio). */
    missing_commands?: string[];
    available: boolean;
  };
  registry: { registry: Registry; implemented: string[] } | null;
  status: Status | null;
  telemetry: Telemetry | null;
  events: Ev[];
}
interface Win {
  hwnd: number;
  title: string;
  process: string;
  width: number;
  height: number;
  minimized: boolean;
}

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
  stopped: 'arrêté depuis Studio',
  screen_missing: 'écran introuvable',
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
const SOURCE: Record<string, string> = {
  studio: 'Studio',
  test: 'essai',
  core: 'viewers',
  extension: 'extension',
  channel_points: 'points de chaîne',
};

export function mountChaosPage(root: HTMLElement) {
  const p = page(root, {
    title: 'Chaos · effets d’écran',
    mod: 'chaos',
    panel: true,
    folded: ['Réinitialiser', 'Diagnostic avancé'],
  });
  p.body.innerHTML = `<div class="cx">
    <div class="cx__main">
      <section class="cx-card cx-catcard" aria-label="Catalogue des effets">
        <header><h2>Effets</h2><span class="d-faint" data-z="catsub"></span><span class="d-sp"></span><label class="cx-inline">${sw(false, 'data-diag', 'Afficher les effets de diagnostic')}<span class="d-faint">Diagnostic</span></label></header>
        <div data-z="catalog"></div>
      </section>
      <section class="cx-card cx-sheet" aria-label="Fiche de l’effet">
        <div data-z="sheet-head"></div>
        <div data-z="sheet-run"></div>
        <div class="cx-sheet__body">
          <div class="cx-sheet__pv" data-z="sheet-pv"></div>
          <div class="cx-sheet__cfg" data-z="sheet-cfg"></div>
        </div>
        <p class="d-faint cx-help" data-z="sheet-note"></p>
      </section>
    </div>
    <aside class="cx__side">
      <section class="cx-card"><header><h2>En cours</h2></header><div data-z="live"></div></section>
      <section class="cx-card"><header><h2>Moteur</h2><span class="d-sp"></span><button type="button" class="d-btn ghost sm" data-restart>${ic('refund')}Relancer</button></header><div data-z="engine"></div></section>
      <section class="cx-card"><header><h2>Journal</h2></header><ol class="cx-log" data-z="events"></ol></section>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;

  let st: State | null = null;
  let readError = '';
  let monitors: Mon[] = [];
  let windows: Win[] = [];
  let diagWin = '';
  let showDiag = false;
  const SEL_KEY = 'rs-chaos-effet';
  let selected = '';
  try {
    selected = localStorage.getItem(SEL_KEY) ?? '';
  } catch {
    /* préférence d'affichage seulement */
  }

  const reg = () => st?.registry?.registry ?? null;
  const def = (id: string) => reg()?.effects.find((e) => e.id === id) ?? null;
  const cfg = () => st?.status?.config ?? null;
  const viaWindows = () => cfg()?.engine.input_effects === true;
  const ctx = (): FxCtx | null => {
    const r = reg();
    const c = cfg();
    if (!r || !c) return null;
    return {
      reg: r,
      presets: Object.keys(pending).length
        ? {
            ...c.presets,
            ...Object.fromEntries(
              Object.entries(pending).map(([k, v]) => [
                k,
                { ...c.presets[k], default: v },
              ]),
            ),
          }
        : c.presets,
      settings: c.effects ?? {},
      rows: [...(st?.status?.active ?? []), ...(st?.status?.queued ?? [])],
      monitors,
      ready:
        st?.engine.status === 'ready' && !st.engine.missing_commands?.length,
      maxDurationMs: Math.min(
        c.safety.max_duration_ms,
        r.engine_limits.max_duration_ms,
      ),
    };
  };
  /** L'effet de la fiche : le dernier ouvert s'il est encore au catalogue, sinon le premier. */
  const current = (): EffectDef | null => {
    const r = reg();
    if (!r) return null;
    const visible = r.effects.filter((e) => showDiag || !e.internal);
    return (
      visible.find((e) => e.id === selected) ??
      visible[0] ??
      r.effects[0] ??
      null
    );
  };

  // ---------- En-tête ----------
  function paintHead() {
    const e = st?.engine;
    const n = st?.status?.active.length ?? 0;
    const chip = !st
      ? stateChip(readError ? 'r' : 'w', readError || 'Lecture…')
      : e?.status === 'ready'
        ? e.missing_commands?.length
          ? stateChip('r', 'Moteur trop ancien')
          : stateChip('live', n ? `${n} effet(s) en cours` : 'Moteur prêt')
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
      `<button type="button" class="d-btn danger" data-stopall ${e?.status === 'ready' ? '' : 'disabled'} title="Arrête tous les effets tout de suite (raccourci partout : Ctrl+Maj+F11)">${ic('stop')}STOP ALL</button><button type="button" class="d-btn ghost" data-panel>${ic('sliders')}Réglages</button>`,
    );
  }

  // ---------- Catalogue ----------
  function paintCatalog() {
    const c = ctx();
    const d = current();
    if (!c || !d)
      return patch(
        z('catalog'),
        `<p class="d-faint">${st?.engine.status === 'absent' ? 'Moteur introuvable : construire apps/chaos-engine/build.cmd.' : 'Lecture du registre des effets…'}</p>`,
      );
    const n = c.reg.effects.filter((e) => !e.internal).length;
    patch(z('catsub'), `${n} effet${n > 1 ? 's' : ''}`);
    morph(
      z('catalog'),
      catalogHtml(c, d.id, showDiag, new Set(st?.registry?.implemented ?? [])),
    );
  }

  // ---------- Fiche de l'effet ----------
  let pvFor = '';
  function paintSheet() {
    const c = ctx();
    const d = current();
    if (!c || !d) {
      for (const k of ['sheet-head', 'sheet-run', 'sheet-cfg', 'sheet-note'])
        patch(z(k), '');
      return;
    }
    const pv = PREVIEWS[d.id];
    const engineAnim = !pv && !d.internal;
    morph(z('sheet-head'), sheetHeadHtml(c, d, !!pv || engineAnim));
    morph(z('sheet-run'), runBarHtml(c, d));
    const missing = st?.engine.missing_commands ?? [];
    patch(
      z('sheet-note'),
      missing.length
        ? `<span class="d-note bad">Le moteur en marche est plus ancien que Studio (il ne connaît pas : ${esc(missing.join(', '))}). « Relancer » dans le panneau Moteur ; s’il reste ancien, reconstruire le moteur (apps/chaos-engine/build.cmd) ou mettre Studio à jour.</span>`
        : `${esc(sheetNote(d))}${viewerNote(d) ? `<br>${esc(viewerNote(d))}` : ''}`,
    );
    const box = z('sheet-pv');
    box.hidden = !pv && !engineAnim;
    if (engineAnim && pvFor !== d.id) {
      pvFor = d.id;
      animKey = '';
      patch(
        box,
        `<div class="cx-anim" data-z="anim" role="img" aria-label="Aperçu de l’effet avec ces réglages"><div class="cx-anim__img"></div><span class="cx-anim__t" data-z="anim-t">Aperçu…</span></div><p class="d-faint cx-help">Rendu par le moteur, hors écran, avec ces réglages, sur une scène de démonstration : rien ne s’affiche sur tes écrans.</p>`,
      );
    }
    if (engineAnim) previewEngine(c, d);
    if (pv && pvFor !== d.id) {
      pvFor = d.id;
      patch(
        box,
        `<div class="cx-screen" data-z="screen" aria-label="Aperçu de l’effet"><div class="cx-screen__bg"></div><div class="cx-screen__fg"><b>▲</b><span>HAUT</span><i class="cx-screen__cursor" title="Le curseur, retourné avec l’image"></i></div></div>`,
      );
      preview();
    }
    // Un champ en cours de saisie n'est jamais réécrit par le relevé.
    const cfgEl = z('sheet-cfg');
    const a = document.activeElement;
    if (
      cfgEl.contains(a) &&
      a instanceof HTMLInputElement &&
      a.type !== 'checkbox'
    )
      return;
    morph(cfgEl, settingsHtml(c, d, advOpen.has(d.id)));
  }

  // ---------- Aperçu rendu par le moteur ----------
  // Demandé seulement quand la fiche s'ouvre ou qu'un réglage change (après 400 ms de calme), mis en cache par le
  // serveur ; ensuite ce n'est qu'une image animée (aucun rendu permanent).
  const advOpen = new Set<string>();
  let animKey = '';
  let animWait = 0;
  let animTick = 0;
  let animReq = 0;
  function previewEngine(c: FxCtx, d: EffectDef, force = false) {
    const pr = pending[d.id] ?? c.presets[d.id]?.default ?? {};
    const key = `${d.id}|${JSON.stringify(pr)}`;
    if (key === animKey && !force) return;
    animKey = key;
    clearTimeout(animWait);
    const label = z('anim-t');
    animWait = window.setTimeout(async () => {
      const id = ++animReq;
      if (label) label.textContent = 'Aperçu…';
      try {
        const r = await postJson<Anim>('/api/chaos/preview', {
          effect: d.id,
          preset: pr,
        });
        if (id === animReq) playAnim(r);
      } catch (e) {
        if (id === animReq && label)
          label.textContent = `Aperçu indisponible : ${(e as Error).message}`;
      }
    }, 400);
  }
  function playAnim(r: Anim) {
    const box = p.body.querySelector<HTMLElement>('[data-z="anim"]');
    const img = box?.querySelector<HTMLElement>('.cx-anim__img');
    const label = z('anim-t');
    if (!box || !img) return;
    clearInterval(animTick);
    const rows = Math.ceil(r.frames / r.cols);
    img.style.backgroundImage = `url("${r.image}")`;
    img.style.backgroundSize = `${r.cols * 100}% ${rows * 100}%`;
    const step = 1000 / r.fps;
    const head = Math.ceil(r.head_ms / step);
    const show = (f: number) => {
      const col = f % r.cols;
      const row = Math.floor(f / r.cols);
      img.style.backgroundPosition = `${r.cols > 1 ? (col / (r.cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`;
      if (label)
        label.textContent =
          f < head
            ? `${((f * step) / 1000).toFixed(1)} s`
            : `fin · ${((r.tail_from_ms + (f - head) * step) / 1000).toFixed(1)} s`;
    };
    if (!motionOk())
      return show(Math.min(r.frames - 1, Math.round(1000 / step)));
    // Début, courte pause, dernière seconde (sortie), pause, et on recommence.
    let f = 0;
    let hold = 0;
    animTick = window.setInterval(() => {
      if (!box.isConnected) return clearInterval(animTick);
      if (hold > 0) return void hold--;
      show(f);
      f++;
      if (f === head && head < r.frames) hold = 6;
      if (f >= r.frames) {
        f = 0;
        hold = 14;
      }
    }, step);
  }

  // Aperçus animés propres à un effet (facultatifs) : un futur effet en ajoute un ici, sinon sa fiche n'en a pas.
  const PREVIEWS: Record<
    string,
    (el: HTMLElement, c: FxCtx, d: EffectDef) => void
  > = {
    flip: previewFlip,
  };
  let anim = 0;
  function preview() {
    const c = ctx();
    const d = current();
    const el = p.body.querySelector<HTMLElement>('[data-z="screen"]');
    if (c && d && !PREVIEWS[d.id] && !d.internal) return previewEngine(c, d);
    if (!c || !d || !el || !PREVIEWS[d.id]) return;
    PREVIEWS[d.id]!(el, c, d);
  }
  function previewFlip(screen: HTMLElement, c: FxCtx, d: EffectDef) {
    const fg = screen.querySelector<HTMLElement>('.cx-screen__fg')!;
    const bg = screen.querySelector<HTMLElement>('.cx-screen__bg')!;
    cancelAnimationFrame(anim);
    const fillParam = d.params.find((x) => x.id === 'fill');
    const fill = String(fillParam ? paramValue(c, d, fillParam) : 'mirror');
    screen.dataset.fill = fill;
    screen.dataset.cursor = String(settings(c, d.id).cursor);
    const inS = side(c, d, 'in');
    const outS = side(c, d, 'out');
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

  // ---------- Actions ----------
  const ERRORS: Record<string, string> = {
    unknown_effect: 'Effet inconnu du moteur.',
    screen_missing:
      'L’écran enregistré n’existe plus : choisis un écran dans la fiche.',
    too_costly: 'Effet trop coûteux pour le profil de performances choisi.',
    exclusive_fullscreen:
      'Un jeu est en plein écran exclusif : passe-le en fenêtré sans bordure.',
    no_window: 'Aucune fenêtre à retourner sur cet écran.',
    target_minimized: 'La fenêtre visée est réduite.',
    capture_denied: 'Windows refuse de capturer cette fenêtre.',
    engine_absent: 'Moteur introuvable.',
    engine_not_ready: 'Le moteur démarre encore.',
  };
  async function activate(
    btn: HTMLElement | null,
    effect: string,
    kind: 'test' | 'manual',
  ) {
    await run(
      btn,
      async () => {
        await postJson('/api/chaos/activate', { effect, kind });
        await refresh();
      },
      undefined,
      ERRORS,
    );
  }
  async function stopEffect(btn: HTMLElement | null, effect: string) {
    await run(btn, async () => {
      await postJson('/api/chaos/stop', { effect });
      await refresh();
    });
  }
  /** Paramètres, durée, transitions : préréglage « default » de l'effet, validé par le moteur. */
  // Réglages tapés coup sur coup : chacun part du précédent (jamais d'un relevé en retard), la fiche les montre tout
  // de suite, et les enregistrements partent dans l'ordre, un à la fois.
  const pending: Record<string, Preset> = {};
  let saving: Promise<unknown> = Promise.resolve();
  function savePreset(effect: string, change: (x: Preset) => void) {
    const c = ctx();
    if (!c) return;
    const next = JSON.parse(
      JSON.stringify(pending[effect] ?? c.presets[effect]?.default ?? {}),
    ) as Preset;
    change(next);
    pending[effect] = next;
    paintSheet();
    preview();
    const value = JSON.parse(JSON.stringify(next)) as Preset;
    saving = saving.then(async () => {
      const ok = await run(
        null,
        () => postJson('/api/chaos/preset', { effect, name: 'default', value }),
        undefined,
        ERRORS,
      );
      // Dernier enregistrement de la file pour cet effet (ou échec) : le moteur redevient la seule source.
      if (!ok || pending[effect] === next) {
        delete pending[effect];
        await refresh();
      }
    });
  }
  /** Écran, disponibilité, curseur : section effects du moteur. */
  async function setFx(effect: string, values: Partial<FxSettings>) {
    const ok = await run(
      null,
      async () => {
        await postJson('/api/chaos/config', {
          section: 'effects',
          values: { [effect]: values },
        });
        await refresh();
      },
      undefined,
      ERRORS,
    );
    if (ok) preview();
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
                <span class="d-faint cx-live__t">${esc(v.target.screen ?? (v.target.mode === 'C' ? (v.target.title ?? 'écran entier') : `fenêtre · ${v.target.process ?? ''}`))}${v.target.input ? ' · souris inversée' : ''}${v.remaining_ms !== undefined ? ` · reste ${secs(v.remaining_ms)}` : ''}</span>
                <span class="d-tag off">${esc(SOURCE[v.source.kind] ?? v.source.kind)}</span>
                <button type="button" class="d-btn ghost sm" data-cancel="${esc(v.request_id)}">${ic('stop')}Arrêter</button></li>`;
            })
            .join('')}</ul>`,
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
          ${t?.cursor && t.cursor.enabled ? `<dt>Curseur</dt><dd>${t.cursor.hidden ? 'retourné (curseur de Windows masqué au-dessus de la cible)' : surf.cursor_follow ? 'retourné dès qu’il passe sur la cible' : 'inchangé'}${surf.cursor_latency_est_p50_ms !== undefined && surf.cursor_latency_est_p50_ms >= 0 ? ` · retard ≈${NBSP}${ms(surf.cursor_latency_est_p50_ms)}` : ''}${t.cursor.failures ? ` <span class="d-tag warn">${esc(t.cursor.last_error ?? 'échec')}</span>` : ''}</dd>` : ''}
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
    const d = current();
    // Le relevé de chaque seconde ne réécrit le panneau que si ce qu'il montre a changé (un clic en cours reste).
    const key = JSON.stringify([
      c?.engine,
      c?.safety,
      c?.performance,
      reg()?.version,
      windows.map((w) => w.hwnd),
      diagWin,
      d?.id,
    ]);
    if (key === panelKey) return;
    panelKey = key;
    if (!c)
      return p.panel.set(
        '<p class="d-faint">Réglages illisibles : le moteur n’est pas prêt.</p>',
      );
    const max = reg()?.engine_limits.max_duration_ms ?? 60000;
    p.panel.set(
      `${grp(
        'Performances',
        'gear',
        `${row('Profil', seg('data-perf', PROFILES, c.performance?.profile ?? 'equilibre'), 'profil performance qualité économie cadence')}
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
       ${grp(
         'Diagnostic avancé',
         'flask',
         `${row(
           'Méthode du retournement',
           seg(
             'data-method',
             [
               ['overlay', 'Calque GPU'],
               ['windows', 'Windows (expérimental)'],
             ],
             viaWindows() ? 'windows' : 'overlay',
           ),
           'méthode calque windows orientation souris',
         )}
        <p class="d-faint cx-help">${viaWindows() ? '<b>Expérimental, jamais en direct ni pour les viewers.</b> Windows retourne tout l’écran, mais chaque bascule reconfigure l’affichage de tout le PC (22/11 : Overwatch à 17 images/s sur l’autre écran).' : 'Calque GPU : la référence. Windows (expérimental) n’est jamais utilisé pour un déclenchement des viewers.'}</p>
        ${row('Curseur retourné (tous les effets)', sw(c.engine.cursor_follow !== false, 'data-cfg="engine.cursor_follow"', 'Curseur retourné, interrupteur général'), 'curseur souris secours')}
        ${row('Fenêtre précise : seulement au premier plan', sw(c.engine.follow_foreground, 'data-cfg="engine.follow_foreground"', 'Fenêtre précise : seulement au premier plan'), 'focus alt tab fenêtre')}
        <div class="cx-diagtest">
          <select data-diag-win aria-label="Fenêtre précise">${windows.length ? windows.map((w) => `<option value="${w.hwnd}" ${String(w.hwnd) === diagWin ? 'selected' : ''} ${w.minimized ? 'disabled' : ''}>${esc(w.title.slice(0, 60))} — ${esc(w.process)}</option>`).join('') : '<option value="">(liste non lue)</option>'}</select>
          <button type="button" class="d-btn ghost sm" data-diag-list>${ic('repeat')}Lister</button>
          <button type="button" class="d-btn sm" data-diag-test ${windows.length && d ? '' : 'disabled'}>${ic('play')}Tester ${esc(d?.label ?? '')} sur cette fenêtre</button>
        </div>`,
         'diagnostic avancé méthode fenêtre',
       )}
       ${grp('Réinitialiser', 'repeat', `<div class="cx-reset"><button type="button" class="d-btn ghost sm" data-reset="effets">Réglages des effets</button><button type="button" class="d-btn ghost sm" data-reset="performance">Performances</button><button type="button" class="d-btn ghost sm" data-reset="engine">Moteur</button><button type="button" class="d-btn ghost sm" data-reset="safety">Sécurité</button></div>`)}`,
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

  // ---------- Relevés ----------
  function paint() {
    paintHead();
    paintCatalog();
    paintSheet();
    paintLive();
    paintEngine();
    paintEvents();
    paintPanel();
  }

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
  }
  /** Les écrans (branchés, débranchés, déplacés) : relus toutes les 5 s, sans parcourir les fenêtres. */
  async function loadScreens() {
    if (st?.engine.status !== 'ready') return;
    try {
      const t = await getJson<{ monitors?: Mon[] }>('/api/chaos/screens');
      const next = t.monitors ?? [];
      if (JSON.stringify(next) !== JSON.stringify(monitors)) {
        monitors = next;
        paintSheet();
        paintCatalog();
      }
    } catch {
      /* le relevé suivant réessaie */
    }
  }
  async function loadWindows() {
    try {
      windows = (await getJson<{ windows: Win[] }>('/api/chaos/targets'))
        .windows;
      if (!windows.some((w) => String(w.hwnd) === diagWin))
        diagWin = String(windows.find((w) => !w.minimized)?.hwnd ?? '');
    } catch {
      windows = [];
    }
    panelKey = '';
    paintPanel();
  }
  const poll = poller(refresh, 1000);
  const pollScreens = poller(loadScreens, 5000);

  // ---------- Interactions ----------
  const sheetEffect = () => current()?.id ?? '';
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
    else if (b.dataset.open) {
      selected = b.dataset.open;
      try {
        localStorage.setItem(SEL_KEY, selected);
      } catch {
        /* préférence d'affichage seulement */
      }
      paintCatalog();
      paintSheet();
      paintPanel();
    } else if (b.dataset.quick)
      void (b.hasAttribute('data-stop')
        ? stopEffect(b, b.dataset.quick)
        : activate(b, b.dataset.quick, 'manual'));
    else if (b.dataset.actRun)
      void (b.hasAttribute('data-stop')
        ? stopEffect(b, b.dataset.actRun)
        : activate(b, b.dataset.actRun, 'manual'));
    else if (b.dataset.act === 'test') void activate(b, sheetEffect(), 'test');
    else if (b.matches('[data-replay]')) {
      const c = ctx();
      const d = current();
      if (c && d && !PREVIEWS[d.id]) previewEngine(c, d, true);
      else preview();
    } else if (b.hasAttribute('data-level')) {
      const d = current();
      const id = b.getAttribute('data-level');
      if (d && id === 'custom') {
        // Personnalisé : les réglages avancés s'ouvrent (rien ne change tant qu'un réglage n'est pas modifié).
        const adv =
          document.querySelector<HTMLDetailsElement>('details[data-adv]');
        if (adv) {
          adv.open = true;
          adv.scrollIntoView({ block: 'nearest' });
        }
      } else {
        const l = d?.levels?.find((x) => x.id === id);
        if (d && l)
          savePreset(d.id, (x) => {
            x.params = { ...(x.params ?? {}), ...l.params };
          });
      }
    } else if (b.hasAttribute('data-variant')) {
      const c = ctx();
      const d = current();
      const v = d?.variants?.find(
        (x) => x.id === b.getAttribute('data-variant'),
      );
      // Le style change, la force reste : le niveau choisi est gardé pour les réglages que la variante ne fixe pas.
      const lv = d && v ? activeLevel(c!, d) : null;
      if (d && v)
        savePreset(d.id, (x) => {
          x.params = { ...(lv?.params ?? {}), ...v.params };
          if (v.duration_ms) x.duration_ms = v.duration_ms;
          if (v.transition)
            x.transition = JSON.parse(
              JSON.stringify(v.transition),
            ) as Preset['transition'];
          else delete x.transition;
        });
    } else if (b.dataset.point && b.dataset.pair) {
      // Clic dans l'écran miniature : le point focal (coordonnées relatives, valables à toutes les résolutions).
      const ev = e as MouseEvent;
      if (ev.detail === 0) return; // clavier : flèches (keydown)
      const r = b.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const fy = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      setPoint(b.dataset.point, b.dataset.pair, fx, fy);
    } else if (b.dataset.cancel)
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
          for (const section of b.dataset.reset === 'effets'
            ? ['presets', 'effects']
            : [b.dataset.reset!])
            await postJson('/api/chaos/config/reset', { section });
          await refresh();
          preview();
        },
        'Réinitialisé',
      );
    else if (b.hasAttribute('data-screen'))
      void setFx(sheetEffect(), { screen: b.getAttribute('data-screen')! });
    else if (b.hasAttribute('data-dur'))
      savePreset(
        sheetEffect(),
        (x) => (x.duration_ms = Number(b.getAttribute('data-dur'))),
      );
    else if (b.hasAttribute('data-tr-in'))
      savePreset(
        sheetEffect(),
        (x) =>
          (((x.transition ??= {}).in ??= {}).kind =
            b.getAttribute('data-tr-in')!),
      );
    else if (b.hasAttribute('data-tr-out'))
      savePreset(
        sheetEffect(),
        (x) =>
          (((x.transition ??= {}).out ??= {}).kind =
            b.getAttribute('data-tr-out')!),
      );
    else if (b.hasAttribute('data-param') && b.dataset.pid)
      savePreset(
        sheetEffect(),
        (x) =>
          ((x.params ??= {})[b.dataset.pid!] = b.getAttribute('data-param')),
      );
    else if (b.matches('[data-diag-list]')) void loadWindows();
    else if (b.matches('[data-diag-test]'))
      void run(
        b,
        async () => {
          await postJson('/api/chaos/test', {
            effect: sheetEffect(),
            target: { kind: 'window', hwnd: Number(diagWin) },
          });
          await refresh();
        },
        undefined,
        ERRORS,
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
        },
        on ? 'Méthode Windows (expérimentale) activée' : 'Calque GPU',
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
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const fx = sheetEffect();
    if (t.matches('[data-diag]')) {
      showDiag = (t as HTMLInputElement).checked;
      paintCatalog();
      paintSheet();
    } else if (t.matches('[data-diag-win]')) diagWin = t.value;
    else if (t.dataset.fxcfg)
      void setFx(fx, { [t.dataset.fxcfg]: (t as HTMLInputElement).checked });
    else if (t.matches('[data-dur-s]'))
      savePreset(
        fx,
        (x) => (x.duration_ms = Math.round(Number(t.value)) * 1000),
      );
    else if (t.matches('[data-tr-ms-in]'))
      savePreset(
        fx,
        (x) =>
          (((x.transition ??= {}).in ??= {}).duration_ms = Number(t.value)),
      );
    else if (t.matches('[data-tr-ms-out]'))
      savePreset(
        fx,
        (x) =>
          (((x.transition ??= {}).out ??= {}).duration_ms = Number(t.value)),
      );
    else if (t.dataset.paramNum)
      savePreset(
        fx,
        (x) => ((x.params ??= {})[t.dataset.paramNum!] = Number(t.value)),
      );
    else if (t.dataset.paramColor)
      savePreset(
        fx,
        (x) => ((x.params ??= {})[t.dataset.paramColor!] = t.value),
      );
    else if (t.dataset.paramStr)
      savePreset(fx, (x) => ((x.params ??= {})[t.dataset.paramStr!] = t.value));
    else if (t.hasAttribute('data-reduce'))
      void setCfg(
        'performance.on_overload',
        (t as HTMLInputElement).checked ? 'reduire' : 'signaler',
      );
    else if (t.dataset.cfg)
      void setCfg(t.dataset.cfg, (t as HTMLInputElement).checked);
    else if (t.dataset.cfgNum) void setCfg(t.dataset.cfgNum, Number(t.value));
  });
  function setPoint(px: string, py: string, fx: number, fy: number) {
    const r2 = (v: number) =>
      Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    savePreset(sheetEffect(), (x) => {
      x.params ??= {};
      x.params[px] = r2(fx);
      x.params[py] = r2(fy);
    });
  }
  // Point focal au clavier : flèches (pas de 5 %).
  root.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-point]');
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-0.05, 0],
      ArrowRight: [0.05, 0],
      ArrowUp: [0, -0.05],
      ArrowDown: [0, 0.05],
    };
    const k = keys[e.key];
    const c = ctx();
    const d = current();
    if (!b || !k || !c || !d) return;
    e.preventDefault();
    const p = d.params.find((q) => q.id === b.dataset.point);
    const q = d.params.find((q2) => q2.id === b.dataset.pair);
    if (p && q)
      setPoint(
        p.id,
        q.id,
        Number(paramValue(c, d, p)) + k[0],
        Number(paramValue(c, d, q)) + k[1],
      );
  });
  // Réglages avancés : ouverts ou repliés, gardés pendant la session (la fiche est repeinte à chaque relevé).
  root.addEventListener(
    'toggle',
    (e) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLDetailsElement) || !el.dataset.adv) return;
      if (el.open) advOpen.add(el.dataset.adv);
      else advOpen.delete(el.dataset.adv);
    },
    true,
  );
  // Curseur d'un nombre : la valeur suit la main, l'enregistrement se fait au lâcher (change).
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.paramNum) {
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = t.value;
    }
  });

  paint();
  return {
    setVisible(on: boolean) {
      if (on) {
        poll.start();
        pollScreens.start();
        void refresh().then(loadScreens);
      } else {
        poll.stop();
        pollScreens.stop();
        clearInterval(animTick);
        animKey = '';
      }
    },
  };
}
