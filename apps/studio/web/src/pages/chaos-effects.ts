import { esc, ic, type IcName, row, seg, stateChip, sw } from '../ds/ds.js';

// Studio › Chaos : le catalogue des effets et la fiche de chaque effet (docs/chaos/GUIDE_STUDIO_CHAOS.md).
// Tout vient du registre partagé (packages/schemas/src/chaos-registry.json) et de la configuration du moteur : aucune
// définition d'effet n'est recopiée ici. Un futur effet obtient sa carte et sa fiche sans changer ce fichier :
//   - ses paramètres exposés deviennent des contrôles selon leur type (choix, nombre, couleur, texte) ;
//   - ses transitions, sa durée, son écran et sa disponibilité sont communs à tous les effets ;
//   - un aperçu animé propre à l'effet est facultatif (PREVIEWS, dans chaos.ts).
// Réglages enregistrés dans le moteur : paramètres, durée et transitions → presets.<effet>.default ; écran,
// disponibilité et curseur → effects.<effet>.

export interface Param {
  id: string;
  type: string;
  label?: string;
  help?: string;
  values?: string[];
  labels?: Record<string, string>;
  min?: number;
  max?: number;
  default: unknown;
  exposed?: boolean;
  unit?: string;
  max_length?: number;
}
export interface EffectDef {
  id: string;
  version: number;
  label: string;
  description: string;
  family: string;
  icon?: string;
  slot: string;
  internal: boolean;
  input?: string;
  cursor?: string;
  params: Param[];
  duration: { default_ms: number };
  transitions: Record<
    'in' | 'out',
    { kind: string; duration_ms?: number; kinds?: string[] }
  >;
  gpu: { primitive: string; cost: string; passes?: number };
}
export interface Registry {
  version: number;
  families: Record<string, { label: string }>;
  slots: Record<string, { label: string }>;
  effects: EffectDef[];
  engine_limits: {
    min_duration_ms: number;
    max_duration_ms: number;
    max_transition_ms?: number;
  };
}
export interface Side {
  kind?: string;
  duration_ms?: number;
}
export interface Preset {
  params?: Record<string, unknown>;
  duration_ms?: number;
  transition?: { in?: Side; out?: Side };
}
export interface FxSettings {
  enabled: boolean;
  screen: string;
  cursor: boolean;
}
export interface EffectView {
  request_id: string;
  effect: string;
  state: string;
  source: { kind: string; ref: string | null };
  target: {
    title?: string;
    process?: string | null;
    mode?: string;
    input?: string | null;
    screen?: string;
  };
  remaining_ms?: number;
  resolved: { duration_ms: number };
}
export interface Mon {
  device: string;
  key: string;
  label: string;
  order: number;
  primary: boolean;
  width: number;
  height: number;
  hz: number;
  orientation: number;
  foreground: boolean;
}

/** Ce que la page sait au moment de peindre. */
export interface FxCtx {
  reg: Registry;
  presets: Record<string, Record<string, Preset>>;
  settings: Record<string, FxSettings>;
  rows: EffectView[];
  monitors: Mon[];
  ready: boolean;
  maxDurationMs: number;
}

const NBSP = String.fromCharCode(160);
const ICONS = new Set<string>([
  'repeat',
  'filter',
  'layers',
  'sparkle',
  'warn',
  'eye',
  'wave',
  'film',
  'image',
  'bolt',
  'star',
  'grid',
  'pulse',
]);
const icon = (d: EffectDef): IcName =>
  (d.icon && ICONS.has(d.icon) ? d.icon : 'sparkle') as IcName;
const secs = (ms: number) => `${Math.ceil(ms / 1000)}${NBSP}s`;
/** Première phrase de la description : la ligne de la carte. */
const short = (s: string) => s.split(/(?<=[.!?])\s/)[0] ?? s;
export const DURATIONS: [string, string][] = [
  ['5000', '5 s'],
  ['10000', '10 s'],
  ['20000', '20 s'],
  ['30000', '30 s'],
];

export const preset = (c: FxCtx, id: string): Preset =>
  c.presets[id]?.default ?? {};
export const settings = (c: FxCtx, id: string): FxSettings =>
  c.settings[id] ?? { enabled: true, screen: 'primary', cursor: true };
export const durationOf = (c: FxCtx, d: EffectDef) =>
  preset(c, d.id).duration_ms ?? d.duration.default_ms;
export function side(c: FxCtx, d: EffectDef, k: 'in' | 'out') {
  const p = preset(c, d.id).transition?.[k];
  return {
    kind: p?.kind ?? d.transitions[k].kind,
    ms: p?.duration_ms ?? d.transitions[k].duration_ms ?? 550,
  };
}
export const paramValue = (c: FxCtx, d: EffectDef, p: Param) =>
  preset(c, d.id).params?.[p.id] ?? p.default;

/** État réel d'un effet dans le moteur : activations en cours ou en file, durée restante, écrans. */
export function fxState(c: FxCtx, id: string) {
  const rows = c.rows.filter((v) => v.effect === id);
  const running = rows.filter((v) => v.state !== 'queued');
  const remaining = Math.max(-1, ...running.map((v) => v.remaining_ms ?? -1));
  const where = [
    ...new Set(running.map((v) => v.target.screen ?? v.target.title ?? '')),
  ].filter(Boolean);
  return {
    rows,
    on: running.length > 0,
    queued: rows.length > running.length,
    exiting: running.length > 0 && running.every((v) => v.state === 'exiting'),
    remaining,
    where,
  };
}

/** Le choix d'écran enregistré, vu par le streamer : clé affichée (primary → l'écran principal) et validité. */
export function screenChoice(c: FxCtx, id: string) {
  const s = settings(c, id).screen;
  const primary = c.monitors.find((m) => m.primary) ?? c.monitors[0];
  const key = s === 'primary' ? (primary?.key ?? 'left') : s;
  const valid =
    key === 'all' ||
    key === 'left' ||
    key === 'right' ||
    c.monitors.some((m) => m.key === key);
  const chosen =
    key === 'all'
      ? c.monitors
      : c.monitors.filter((m) =>
          key === 'left'
            ? m.order === 0
            : key === 'right'
              ? m.order === c.monitors.length - 1
              : m.key === key,
        );
  return { key, valid, chosen };
}

const stateLine = (c: FxCtx, d: EffectDef) => {
  const s = fxState(c, d.id);
  if (s.exiting) return stateChip('w', 'Se termine');
  if (s.on)
    return stateChip(
      'live',
      `En cours${s.remaining >= 0 ? ` · reste ${secs(s.remaining)}` : ''}${s.where.length ? ` · ${s.where.join(', ')}` : ''}`,
    );
  if (s.queued) return stateChip('w', 'En file');
  return settings(c, d.id).enabled
    ? stateChip('', 'Prêt')
    : stateChip('off', 'Désactivé');
};

const runButton = (c: FxCtx, d: EffectDef, attr: string, sm = false) => {
  const s = fxState(c, d.id);
  const busy = s.on || s.queued;
  return busy
    ? `<button type="button" class="d-btn danger${sm ? ' sm' : ''}" ${attr}="${esc(d.id)}" data-stop ${c.ready ? '' : 'disabled'}>${ic('stop')}Arrêter</button>`
    : `<button type="button" class="d-btn pri${sm ? ' sm' : ''}" ${attr}="${esc(d.id)}" ${c.ready ? '' : 'disabled'}>${ic('play')}Activer</button>`;
};

// ---------- Catalogue ----------
export function catalogHtml(
  c: FxCtx,
  selected: string,
  showDiag: boolean,
  implemented: Set<string>,
) {
  const list = c.reg.effects.filter((e) => showDiag || !e.internal);
  if (!list.length)
    return '<p class="d-faint">Aucun effet dans le registre.</p>';
  return `<div class="cx-grid">${list
    .map((d) => {
      const s = fxState(c, d.id);
      const off = !settings(c, d.id).enabled;
      const ok = implemented.has(d.id);
      return `<article class="cx-fx${d.id === selected ? ' is-sel' : ''}${s.on ? ' is-on' : ''}${off ? ' is-off' : ''}${d.internal ? ' is-diag' : ''}" data-fx="${esc(d.id)}">
        <button type="button" class="cx-fx__open" data-open="${esc(d.id)}" aria-pressed="${d.id === selected}" aria-label="Régler ${esc(d.label)}">
          <span class="cx-fx__ic">${ic(icon(d))}</span>
          <span class="cx-fx__t"><b>${esc(d.label)}</b><small>${esc(short(d.description))}</small></span>
        </button>
        <div class="cx-fx__foot">${stateLine(c, d)}${d.internal ? '<span class="d-tag off">diagnostic</span>' : ''}${ok ? '' : '<span class="d-tag bad">non implémenté</span>'}<span class="d-sp"></span>${ok ? runButton(c, d, 'data-quick', true) : ''}</div>
      </article>`;
    })
    .join('')}</div>`;
}

// ---------- Fiche ----------
/** Barre d'actions de la fiche : état réel, Tester (essai court), Activer / Arrêter. Repeinte à chaque relevé. */
export function runBarHtml(c: FxCtx, d: EffectDef) {
  const s = fxState(c, d.id);
  const { valid } = screenChoice(c, d.id);
  const can = c.ready && valid;
  return `<div class="cx-run">${stateLine(c, d)}<span class="d-sp"></span>
    <button type="button" class="d-btn" data-act="test" ${can && !s.on && !s.queued ? '' : 'disabled'} title="Essai de 5 s au plus, sur l’écran choisi, sans Jetons ni viewers">${ic('play')}Tester</button>
    ${runButton(c, d, 'data-act-run')}
  </div>`;
}

const kindLabel = (d: EffectDef, k: string) =>
  k === 'cut'
    ? 'Instantanée'
    : d.gpu.primitive === 'transform'
      ? 'Rotation'
      : 'Fondu';

function transitionRow(c: FxCtx, d: EffectDef, k: 'in' | 'out', max: number) {
  const s = side(c, d, k);
  const kinds = d.transitions[k].kinds ?? [d.transitions[k].kind];
  // Rotation : 545 ms au moins (vitesse maximale du registre, 520°/s pour 180°).
  const min = d.gpu.primitive === 'transform' ? 545 : 100;
  return row(
    k === 'in' ? 'Entrée' : 'Sortie',
    `<span class="cx-ctl">${
      kinds.length > 1
        ? seg(
            `data-tr-${k}`,
            kinds.map((x) => [x, kindLabel(d, x)] as [string, string]),
            s.kind,
          )
        : `<span class="d-faint">${esc(kindLabel(d, s.kind))}</span>`
    }${
      s.kind !== 'cut'
        ? `<label class="d-fld cx-fld-s"><input type="number" data-tr-ms-${k} min="${min}" max="${max}" step="50" value="${s.ms}" aria-label="Durée de la transition ${k === 'in' ? 'd’entrée' : 'de sortie'}"><span>ms</span></label>`
        : ''
    }</span>`,
    'transition',
  );
}

function paramRow(c: FxCtx, d: EffectDef, p: Param) {
  const v = paramValue(c, d, p);
  const label = p.label ?? p.id;
  let ctl: string;
  if (p.type === 'enum' && p.values)
    ctl = seg(
      `data-pid="${esc(p.id)}" data-param`,
      p.values.map((x) => [x, esc(p.labels?.[x] ?? x)] as [string, string]),
      String(v),
    );
  else if (p.type === 'number') {
    const min = p.min ?? 0;
    const max = p.max ?? 1;
    const step =
      Number.isInteger(min) && Number.isInteger(max) && max - min >= 4
        ? 1
        : (max - min) / 100;
    ctl = `<span class="cx-range"><input type="range" data-param-num="${esc(p.id)}" min="${min}" max="${max}" step="${step}" value="${esc(v)}" aria-label="${esc(label)}"><output>${esc(v)}${p.unit ? NBSP + esc(p.unit) : ''}</output></span>`;
  } else if (p.type === 'color')
    ctl = `<input type="color" class="cx-color" data-param-color="${esc(p.id)}" value="${esc(v)}" aria-label="${esc(label)}">`;
  else if (p.type === 'string')
    ctl = `<label class="d-fld"><input type="text" data-param-str="${esc(p.id)}" value="${esc(v)}" maxlength="${p.max_length ?? 60}" aria-label="${esc(label)}"></label>`;
  else return '';
  return `${row(label, ctl, `${p.id} paramètre`)}${p.help ? `<p class="d-faint cx-help cx-help--row">${esc(p.help)}</p>` : ''}`;
}

/** Réglages de la fiche (repeints seulement quand la configuration ou les écrans changent). */
export function settingsHtml(c: FxCtx, d: EffectDef) {
  const st = settings(c, d.id);
  const sc = screenChoice(c, d.id);
  const screenOpts: [string, string][] = c.monitors.map((m) => [
    m.key,
    `${esc(m.label)}${m.primary ? ' <small>principal</small>' : ''}`,
  ]);
  if (c.monitors.length > 1) screenOpts.push(['all', 'Tous les écrans']);
  const detail = sc.chosen
    .map(
      (m) =>
        `${esc(m.device.replace(/^\\\\\.\\/, ''))} · ${m.width}×${m.height} · ${m.hz}${NBSP}Hz`,
    )
    .join(' — ');
  const dur = durationOf(c, d);
  const durKey = String(dur);
  const durOpts = DURATIONS.some(([k]) => k === durKey)
    ? DURATIONS
    : [...DURATIONS, [durKey, secs(dur)] as [string, string]];
  const maxTr = c.reg.engine_limits.max_transition_ms ?? 3000;
  const params = d.params.filter((p) => p.exposed !== false);
  return `${
    c.monitors.length
      ? row(
          'Écran',
          seg('data-screen', screenOpts, sc.valid ? sc.key : ''),
          'écran moniteur gauche droite tous',
        )
      : row(
          'Écran',
          '<span class="d-faint">Lecture des écrans…</span>',
          'écran',
        )
  }
    ${
      !sc.valid
        ? '<p class="d-note cx-help--row">L’écran enregistré n’existe plus (débranché ou disposition changée) : choisis un écran.</p>'
        : detail
          ? `<p class="d-faint cx-help cx-help--row">${detail}</p>`
          : ''
    }
    ${row(
      'Durée',
      `<span class="cx-ctl">${seg('data-dur', durOpts, durKey)}<label class="d-fld cx-fld-s"><input type="number" data-dur-s min="${Math.ceil(c.reg.engine_limits.min_duration_ms / 1000)}" max="${Math.floor(c.maxDurationMs / 1000)}" step="1" value="${Math.round(dur / 1000)}" aria-label="Durée en secondes"><span>s</span></label></span>`,
      'temps durée',
    )}
    ${transitionRow(c, d, 'in', maxTr)}
    ${transitionRow(c, d, 'out', maxTr)}
    ${params.map((p) => paramRow(c, d, p)).join('')}
    ${d.cursor === 'follow' ? row('Curseur retourné avec l’image', sw(st.cursor, 'data-fxcfg="cursor"', 'Curseur retourné avec l’image'), 'curseur souris clic miroir') : ''}
    ${d.cursor === 'follow' ? `<p class="d-faint cx-help cx-help--row">${st.cursor ? 'Un seul curseur visible : l’image du vrai curseur, retournée avec l’image. Le clic tombe dessous ; la souris et les clics de Windows ne changent pas.' : 'Curseur de Windows inchangé : le clic tombe au point symétrique de ce que l’on voit.'}</p>` : ''}`;
}

/** En-tête de la fiche : icône, nom, description, disponibilité. */
export function sheetHeadHtml(c: FxCtx, d: EffectDef, preview: boolean) {
  const st = settings(c, d.id);
  return `<header class="cx-sheet__h">
      <span class="cx-fx__ic cx-fx__ic--lg">${ic(icon(d))}</span>
      <div class="cx-sheet__id"><h2>${esc(d.label)}</h2><p>${esc(d.description)}</p></div>
      <span class="d-sp"></span>
      ${preview ? `<button type="button" class="d-ib" data-replay aria-label="Rejouer l’aperçu" title="Rejouer l’aperçu">${ic('repeat')}</button>` : ''}
      <label class="cx-inline" title="Les déclenchements des viewers (à venir) ne passent que si l’effet est disponible. Tester et Activer restent possibles ici.">${sw(st.enabled, 'data-fxcfg="enabled"', 'Disponible pour les viewers')}<span>Disponible</span></label>
    </header>`;
}

/** Une ligne d'explication technique, en bas de fiche (jamais un choix à faire en usage ordinaire). */
export function sheetNote(d: EffectDef) {
  const cost =
    d.gpu.cost === 'low' ? 'faible' : d.gpu.cost === 'high' ? 'élevé' : 'moyen';
  return d.gpu.primitive === 'transform'
    ? `Calque GPU sur la fenêtre qui occupe l’écran (visible dans la capture d’écran d’OBS), sans toucher à l’affichage de Windows · coût GPU ${cost}`
    : `Calque GPU · coût GPU ${cost}${d.gpu.passes ? ` · ${d.gpu.passes} passe(s) au plus` : ''}`;
}
