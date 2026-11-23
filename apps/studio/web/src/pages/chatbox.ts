// Chatbox Raptoru — Studio's screen (docs/CHATBOX.md § 9). Simple first: the presets up front, the preview in the
// middle (the real OBS page on the simulator's feed), six essential settings beside it; the placement and every
// advanced setting folded, nothing removed. « Ce qui s'affiche »: the command catalogue (every command the project
// knows, per module, the viewer's message and LeCroupier_'s answer set apart), LeCroupier_'s messages, the special
// messages, the accounts. A saved setting reaches the OBS sources at once; nothing here touches OBS or Twitch.

import { esc, fld, page, row, sw, toast } from '../ds/ds.js';
import { getJson, postJson } from '../http.js';

type Mode = 'hide' | 'normal' | 'highlight';
type Settings = Record<string, unknown>;
interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  zoom: number;
}
type Field =
  | {
      path: string;
      label: string;
      kind: 'number';
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | { path: string; label: string; kind: 'color' | 'font' | 'toggle' }
  | {
      path: string;
      label: string;
      kind: 'choice';
      options: { value: string; label: string }[];
    }
  | { path: string; label: string; kind: 'list'; min: number; max: number };
interface Rules {
  accounts: { id: string | null; login: string; mode: Mode }[];
  commands: {
    raptoru: 'hide' | 'normal';
    external: string[];
    unknown: 'hide' | 'normal';
    rules: Record<string, { message?: 'hide' | 'normal'; reply?: Mode }>;
  };
  croupier: {
    fallback: Mode;
    categories: Record<string, Mode>;
    families: Record<string, Mode>;
  };
  special: Record<
    'announcement' | 'highlighted' | 'first' | 'sub' | 'raid',
    Mode
  >;
}
interface Command {
  key: string;
  label: string;
  module: string;
  words: string[];
  source: 'commands_v2' | 'module' | 'discovered';
  enabled: boolean;
}
interface State {
  profiles: { id: string; label: string; base: string; settings: Settings }[];
  builtins: {
    id: string;
    name: string;
    desc: string;
    settings: Record<string, Settings>;
  }[];
  presets: Record<string, { id: string; name: string; settings: Settings }[]>;
  scenes: {
    id: string;
    label: string;
    profile: string;
    placement: Placement;
    url: string;
  }[];
  defaults: Record<string, Placement>;
  rules: Rules;
  categories: { id: string; label: string }[];
  catalogue: { id: string; label: string; category: string; last: number }[];
  accounts: {
    id: string;
    login: string;
    name: string;
    feed: 'live' | 'demo';
  }[];
  fields: { id: string; label: string; help: string; fields: Field[] }[];
  fonts: string[];
  demo: {
    url: string;
    token: string;
    playing: string | null;
    scenarios: { id: string; label: string }[];
  };
  emotes: { count: number };
  repaired: string[];
  live: {
    linked: boolean;
    connected: boolean;
    lastEventAt: number | null;
    catalogError: string | null;
    pages: number;
  };
  commands: Command[];
}

const MODES: [Mode, string][] = [
  ['hide', 'Masquer'],
  ['normal', 'Afficher'],
  ['highlight', 'Mettre en avant'],
];
const SHOW: [string, string][] = [
  ['hide', 'Masquer'],
  ['normal', 'Afficher'],
];
const SPECIALS: [keyof Rules['special'], string][] = [
  ['announcement', 'Annonces Twitch (/announce)'],
  ['highlighted', 'Messages mis en avant (points de chaîne)'],
  ['first', 'Premier message d’un viewer'],
  ['sub', 'Abonnements'],
  ['raid', 'Raids'],
];
const PRESET_HINT: Record<string, string> = {
  modernisee: 'Recommandé : lisible sur tous les fonds',
  origine: 'Comme StreamElements aujourd’hui',
};

const get = (o: Settings, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (v, k) => (v as Record<string, unknown> | undefined)?.[k],
      o,
    );
function set(o: Settings, path: string, value: unknown) {
  const keys = path.split('.');
  let cur = o as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys.at(-1)!] = value;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => structuredClone(v);

/** A segmented choice: the holder says what it sets (`data-seg` + its own data), each button its value (`data-v`). */
const pick = (
  holder: string,
  opts: readonly (readonly [string, string])[],
  cur: string,
  cls = '',
) => {
  const i = Math.max(
    0,
    opts.findIndex(([k]) => k === cur),
  );
  return `<span class="d-seg ${cls}" style="--n:${opts.length};--i:${i}" role="group" ${holder}>${opts
    .map(
      ([k, l]) =>
        `<button type="button" data-v="${esc(k)}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${esc(l)}</button>`,
    )
    .join('')}</span>`;
};

export function mountChatboxPage(root: HTMLElement) {
  const pg = page(root, { title: 'Chatbox', mod: 'chatbox' });
  let st: State | null = null;
  let profile = 'just-chatting';
  let tab: 'look' | 'visibility' | 'demo' = 'look';
  let bg = 'busy';
  let explain = true;
  let search = '';
  const drafts: Record<string, Settings | undefined> = {};
  const places: Record<string, Placement | undefined> = {};
  const sceneOf: Record<string, string> = {};

  const prof = () => st!.profiles.find((p) => p.id === profile)!;
  const scenes = () => st!.scenes.filter((s) => s.profile === profile);
  const scene = () =>
    scenes().find((s) => s.id === sceneOf[profile]) ?? scenes()[0]!;
  const settings = () => drafts[profile] ?? prof().settings;
  const placement = () => places[scene().id] ?? scene().placement;
  const dirty = () => !!drafts[profile] || scenes().some((s) => !!places[s.id]);
  const frame = () =>
    pg.body.querySelector<HTMLIFrameElement>('[data-cbx-preview]');
  const post = (msg: unknown) =>
    frame()?.contentWindow?.postMessage(msg, location.origin);
  const field = (path: string) =>
    st!.fields.flatMap((g) => g.fields).find((x) => x.path === path);

  async function load() {
    try {
      st = await getJson<State>('/api/chatbox');
      paint();
    } catch {
      pg.body.innerHTML =
        '<p class="cbx-empty">Chatbox indisponible : Studio ne répond pas.</p>';
    }
  }

  async function call(path: string, body: unknown, done?: string) {
    try {
      st = await postJson<State>(`/api/chatbox${path}`, body);
      if (done) toast(done);
      return true;
    } catch (e) {
      toast(`Refusé : ${(e as Error).message}`, { bad: true });
      return false;
    }
  }

  // --- Header ----------------------------------------------------------------------------------------------------------
  function liveChip() {
    const l = st!.live;
    if (!l.linked)
      return '<span class="cbx-chip">Démonstration seulement (pas de Core)</span>';
    if (l.connected) return '<span class="cbx-chip ok">Chat réel relié</span>';
    return `<span class="cbx-chip">${l.pages ? 'Chat réel : connexion…' : 'Chat réel : prêt (aucune source OBS ouverte)'}</span>`;
  }
  function paintHead() {
    pg.state.innerHTML = `${liveChip()}<span class="cbx-chip">${st!.emotes.count} emotes 7TV · BTTV · FFZ</span>${
      st!.repaired.length
        ? `<span class="cbx-chip warn">Réparé : ${esc(st!.repaired.join(', '))}</span>`
        : ''
    }`;
    pg.actions.innerHTML = pick(
      'data-seg="tab"',
      [
        ['look', 'Apparence'],
        ['visibility', 'Ce qui s’affiche'],
        ['demo', 'Démonstration'],
      ],
      tab,
    );
  }

  // --- Appearance ------------------------------------------------------------------------------------------------------
  function presets() {
    const p = prof();
    const card = (id: string, name: string, hint: string, own = false) =>
      `<div class="cbx-pcard${p.base === id ? ' on' : ''}"><button type="button" data-preset="${esc(id)}"><strong>${esc(name)}</strong><small>${esc(hint)}</small></button>${
        own
          ? `<span class="cbx-pact"><button type="button" data-rename="${esc(id)}">Renommer</button><button type="button" data-del="${esc(id)}">Supprimer</button></span>`
          : ''
      }</div>`;
    return `<div class="cbx-presets">${st!.builtins.map((b) => card(b.id, b.name, PRESET_HINT[b.id] ?? b.desc)).join('')}${(
      st!.presets[profile] ?? []
    )
      .map((c) => card(c.id, c.name, 'Préset personnel', true))
      .join(
        '',
      )}<button type="button" class="cbx-pnew" data-save-preset>＋ Garder ces réglages comme préset</button></div>`;
  }

  function previewUrl() {
    const params = new URLSearchParams({
      profile,
      scene: scene().id,
      feed: 'demo',
      fit: '1',
    });
    if (explain) params.set('explain', '1');
    return `/chatbox/player.html?${params}#${st!.demo.token}`;
  }

  const num = (
    path: string,
    label: string,
    hint: string,
    min: number,
    max: number,
    step: number,
    unit: string,
  ) =>
    `<div class="cbx-ess"><div class="cbx-ess-h"><span>${esc(label)}</span><output data-out="${esc(path)}" data-unit="${esc(unit)}">${esc(get(settings(), path))} ${esc(unit)}</output></div><input type="range" data-f="${esc(path)}" min="${min}" max="${max}" step="${step}" value="${esc(get(settings(), path))}">${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;

  function essentials() {
    const s = settings() as {
      presence: { mode: string; seconds: number };
      roles: { bar: number };
    };
    return `<section class="cbx-card"><h3>Réglages essentiels</h3>
      ${num('text.size', 'Taille des messages', 'En pixels à l’écran.', 12, 48, 0.5, 'px')}
      ${num('name.size', 'Taille des pseudos', '', 10, 44, 0.5, 'px')}
      ${num('card.opacity', 'Fond des messages', 'Plus bas : plus discret. Le texte reste net.', 0, 1, 0.01, '')}
      <div class="cbx-ess"><div class="cbx-ess-h"><span>Présence du chat</span></div>${pick(
        'data-seg="presence"',
        [
          ['permanent', 'Toujours visible'],
          ['idle', 'Disparaît au calme'],
        ],
        s.presence.mode,
      )}${
        s.presence.mode === 'idle'
          ? `<div class="cbx-inline"><span>après</span>${fld('data-f="presence.seconds"', s.presence.seconds, 's', 'min="1" max="600" step="1"')}</div>`
          : ''
      }</div>
      ${num('enter.duration', 'Vitesse d’arrivée des messages', 'Plus bas : plus vif.', 0, 1500, 10, 'ms')}
      <div class="cbx-ess cbx-ess-row"><span>Barre de couleur des rôles</span>${sw(s.roles.bar > 0, 'data-rolebar', 'Barre de couleur des rôles')}</div>
    </section>`;
  }

  function advanced() {
    const s = settings();
    return `<details class="cbx-card cbx-fold"><summary>Réglages avancés <small>toutes les options du profil</small></summary>
      <datalist id="cbx-fonts">${st!.fonts.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
      ${st!.fields
        .map(
          (g) =>
            `<details class="cbx-sub"><summary>${esc(g.label)}</summary><p class="cbx-hint">${esc(g.help)}</p>${g.fields
              .map((f) => row(f.label, control(f, get(s, f.path))))
              .join('')}</details>`,
        )
        .join('')}
    </details>`;
  }

  function placementCard() {
    const pl = placement();
    return `<details class="cbx-card cbx-fold" data-fold="place"><summary>Emplacement dans « ${esc(scene().label)} » <small>${pl.w} × ${pl.h} px</small></summary>
      <p class="cbx-hint">Fais glisser le cadre, ou son coin pour le redimensionner.</p>
      <div class="cbx-map" data-map><div class="cbx-rect" data-rect><span class="cbx-handle" data-handle></span></div></div>
      <div class="cbx-place">
        ${(['x', 'y', 'w', 'h'] as const)
          .map(
            (k) =>
              `<div class="cbx-pl"><span>${{ x: 'Gauche', y: 'Haut', w: 'Largeur', h: 'Hauteur' }[k]}</span>${fld(`data-pl="${k}"`, pl[k], 'px', 'step="1"')}</div>`,
          )
          .join('')}
        <div class="cbx-pl"><span>Agrandissement dans cette scène</span>${fld('data-pl="zoom"', pl.zoom, '×', 'step="0.01" min="0.5" max="2"')}</div>
      </div>
      <button type="button" class="d-btn sm ghost" data-place-reset>Revenir à la place d’origine</button>
      <h4>Adresse de la source OBS</h4>
      <p class="cbx-hint">Source navigateur 1920 × 1080, échelle 1, verrouillée, ajoutée <strong>masquée</strong> à côté de l’ancienne. Elle ne change jamais : les réglages enregistrés s’y appliquent seuls.</p>
      <div class="cbx-url"><code>${esc(scene().url.replace(/#.*/, '#…'))}</code><button type="button" class="d-btn sm" data-copy>Copier</button></div>
    </details>`;
  }

  function paintLook() {
    return `<div class="cbx-look">
      <div class="cbx-top">${pick(
        'data-seg="profile"',
        st!.profiles.map((p) => [p.id, p.label] as [string, string]),
        profile,
        'cbx-profiles',
      )}${presets()}</div>
      <div class="cbx-savebar" ${dirty() ? '' : 'hidden'}><span>Modifications non enregistrées</span><button type="button" class="d-btn ghost" data-cancel>Annuler</button><button type="button" class="d-btn pri" data-save>Enregistrer et appliquer dans OBS</button></div>
      <div class="cbx-grid">
        <section class="cbx-stage-wrap">
          <div class="cbx-tools">
            ${
              scenes().length > 1
                ? pick(
                    'data-seg="scene"',
                    scenes().map((s) => [s.id, s.label] as [string, string]),
                    scene().id,
                  )
                : ''
            }
            ${pick(
              'data-seg="bg"',
              [
                ['dark', 'Fond sombre'],
                ['light', 'Lumineux'],
                ['busy', 'Chargé'],
              ],
              bg,
            )}
            <label class="cbx-check">${sw(explain, 'data-explain', 'Voir les messages masqués')} Voir les messages masqués</label>
            <span class="cbx-sp"></span>
            <label class="cbx-check">Tester avec <select data-scenario>${st!.demo.scenarios
              .map(
                (s) =>
                  `<option value="${s.id}"${st!.demo.playing === s.id ? ' selected' : ''}>${esc(s.label)}</option>`,
              )
              .join('')}</select></label>
            <button type="button" class="d-btn sm" data-play>Lancer</button><button type="button" class="d-btn sm ghost" data-play-clear>Vider</button>
          </div>
          <div class="cbx-stage bg-${bg}" data-stage><div class="cbx-frame" data-frame><iframe data-cbx-preview title="Prévisualisation" src="${esc(previewUrl())}"></iframe></div></div>
          <p class="cbx-hint">Taille réelle à l’écran : ${placement().w} × ${placement().h} px. Messages fictifs du simulateur, jamais le vrai chat.</p>
        </section>
        <aside class="cbx-side">${essentials()}${placementCard()}${advanced()}</aside>
      </div>
    </div>`;
  }

  function fitFrame() {
    const stage = pg.body.querySelector<HTMLElement>('[data-stage]');
    const wrap = pg.body.querySelector<HTMLElement>('[data-frame]');
    const f = frame();
    if (!stage || !wrap || !f) return;
    const pl = placement();
    const k = Math.min(1, (stage.clientWidth - 32) / pl.w, 760 / pl.h);
    f.style.width = `${pl.w}px`;
    f.style.height = `${pl.h}px`;
    f.style.transform = k < 1 ? `scale(${k})` : '';
    wrap.style.width = `${pl.w * k}px`;
    wrap.style.height = `${pl.h * k}px`;
  }

  function paintMap() {
    const map = pg.body.querySelector<HTMLElement>('[data-map]');
    const rect = pg.body.querySelector<HTMLElement>('[data-rect]');
    if (!map || !rect || !map.clientWidth) return;
    const k = map.clientWidth / 1920;
    const pl = placement();
    Object.assign(rect.style, {
      left: `${pl.x * k}px`,
      top: `${pl.y * k}px`,
      width: `${pl.w * k}px`,
      height: `${pl.h * k}px`,
    });
    for (const k2 of ['x', 'y', 'w', 'h', 'zoom'] as const) {
      const i = pg.body.querySelector<HTMLInputElement>(`[data-pl="${k2}"]`);
      if (i && document.activeElement !== i) i.value = String(pl[k2]);
    }
  }

  function setPlacement(p: Placement) {
    const clean = {
      x: Math.round(Math.max(-1920, Math.min(1920, p.x))),
      y: Math.round(Math.max(-1080, Math.min(1080, p.y))),
      w: Math.round(Math.max(120, Math.min(1920, p.w))),
      h: Math.round(Math.max(120, Math.min(1080, p.h))),
      zoom: Math.max(0.5, Math.min(2, Number(p.zoom) || 1)),
    };
    places[scene().id] = same(clean, scene().placement) ? undefined : clean;
    post({ type: 'chatbox:draft', placement: clean });
    paintMap();
    fitFrame();
    paintDirty();
  }

  function paintDirty() {
    pg.body
      .querySelector<HTMLElement>('.cbx-savebar')
      ?.toggleAttribute('hidden', !dirty());
  }

  function control(f: Field, v: unknown) {
    const a = `data-f="${esc(f.path)}"`;
    if (f.kind === 'number')
      return `<span class="cbx-num"><input type="range" ${a} min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v)}"><input type="number" ${a} min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v)}">${f.unit ? `<small>${esc(f.unit)}</small>` : ''}</span>`;
    if (f.kind === 'color')
      return `<input type="color" ${a} value="${esc(v)}">`;
    if (f.kind === 'toggle') return sw(v === true, a, f.label);
    if (f.kind === 'font')
      return `<input class="cbx-input" list="cbx-fonts" ${a} value="${esc(v)}">`;
    if (f.kind === 'list')
      return `<input class="cbx-input" ${a} value="${esc((v as number[]).join(', '))}" title="Taille pour 1, 2, 3… emotes seules">`;
    if (f.kind !== 'choice') return '';
    return pick(
      `data-seg="field" data-path="${esc(f.path)}"`,
      f.options.map((o) => [o.value, o.label] as [string, string]),
      String(v),
    );
  }

  /** One setting changed (essential or advanced): previewed at once, saved with « Enregistrer ». */
  function change(path: string, raw: unknown) {
    const f = field(path);
    if (!f) return;
    let v: unknown = raw;
    if (f.kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      v = Math.max(f.min, Math.min(f.max, n));
    } else if (f.kind === 'list') {
      const list = String(raw)
        .split(/[,; ]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= f.min && n <= f.max)
        .slice(0, 10);
      if (!list.length) return;
      v = list;
    } else if (f.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(String(raw)))
      return;
    else if (
      f.kind === 'font' &&
      !/^[\p{L}\p{N} _-]{1,60}$/u.test(String(raw).trim())
    )
      return;
    const d = clone(settings());
    set(d, path, f.kind === 'font' ? String(v).trim() : v);
    drafts[profile] = same(d, prof().settings) ? undefined : d;
    post({ type: 'chatbox:draft', settings: d });
    for (const i of pg.body.querySelectorAll<HTMLInputElement>(
      `input[data-f="${CSS.escape(path)}"]`,
    ))
      if (
        document.activeElement !== i &&
        (f.kind === 'number' || f.kind === 'color')
      )
        i.value = String(v);
    for (const o of pg.body.querySelectorAll<HTMLOutputElement>(
      `output[data-out="${CSS.escape(path)}"]`,
    ))
      o.value = `${String(v)} ${o.dataset.unit ?? ''}`.trim();
    paintDirty();
  }

  // --- What is shown ---------------------------------------------------------------------------------------------------
  const modeSeg = (
    holder: string,
    cur: string,
    opts: readonly (readonly [string, string])[] = MODES,
  ) => pick(holder, opts, cur);

  function commandList() {
    const r = st!.rules;
    const l = st!.live;
    const q = search.trim().toLowerCase().replace(/^!/, '');
    const list = st!.commands.filter(
      (c) =>
        !q ||
        c.label.toLowerCase().includes(q) ||
        c.module.toLowerCase().includes(q) ||
        c.words.some((w) => w.includes(q)),
    );
    const modules = [...new Set(list.map((c) => c.module))].sort((a, b) =>
      a.localeCompare(b, 'fr'),
    );
    if (!l.linked)
      return '<p class="cbx-note">Catalogue indisponible : cette démonstration n’est pas reliée au Core. Dans Studio, la liste vient du Core et se met à jour seule.</p>';
    if (l.catalogError && !st!.commands.length)
      return `<p class="cbx-note">Catalogue indisponible pour l’instant (${esc(l.catalogError)}). Il se recharge chaque minute.</p>`;
    return (
      modules
        .map(
          (m) =>
            `<details class="cbx-sub" ${q ? 'open' : ''}><summary>${esc(m)} <small>${list.filter((c) => c.module === m).length}</small></summary>${list
              .filter((c) => c.module === m)
              .map((c) => {
                const own = r.commands.rules[c.key] ?? {};
                return `<div class="cbx-cmd"><div class="cbx-cmd-h"><strong>${esc(c.label)}</strong>${c.enabled ? '' : ' <small>(désactivée)</small>'}${c.source === 'discovered' ? ' <small>(découverte dans le chat)</small>' : ''}<span class="cbx-words">${c.words.map((w) => `!${esc(w)}`).join(' · ')}</span></div>
                  <div class="cbx-cmd-c"><span>Message du viewer</span>${modeSeg(`data-seg="cmd-msg" data-key="${esc(c.key)}"`, own.message ?? r.commands.raptoru, SHOW)}</div>
                  <div class="cbx-cmd-c"><span>Réponse de LeCroupier_</span>${modeSeg(`data-seg="cmd-reply" data-key="${esc(c.key)}"`, own.reply ?? 'inherit', [['inherit', 'Comme sa catégorie'], ...MODES])}</div></div>`;
              })
              .join('')}</details>`,
        )
        .join('') || '<p class="cbx-hint">Aucune commande ne correspond.</p>'
    );
  }

  function paintVisibility() {
    const r = st!.rules;
    const fams = st!.catalogue;
    const recent = st!.accounts.filter(
      (a) => !r.accounts.some((x) => x.login === a.login),
    );
    return `<div class="cbx-vis">
      <p class="cbx-note">Ces réglages valent pour les trois chatbox et s’appliquent tout de suite. Masquer un message ici le retire seulement de la chatbox : <strong>rien n’est fait sur Twitch</strong> (ni ban, ni timeout, ni suppression).</p>
      <section class="cbx-card cbx-wide"><h3>Commandes</h3>
        <p class="cbx-hint">Toutes les commandes connues du projet, par module. Les alias d’une commande suivent son réglage. <code>!!!!!</code> ou <code>!?!?</code> ne sont jamais des commandes.</p>
        <div class="cbx-line"><input class="cbx-input cbx-search" type="search" data-search placeholder="Chercher une commande (ex. tts, daily, rb)" value="${esc(search)}"></div>
        ${row('Commande reconnue, sans réglage propre', modeSeg('data-seg="cmd-raptoru"', r.commands.raptoru, SHOW))}
        ${row('Commande que personne ne reconnaît', modeSeg('data-seg="cmd-unknown"', r.commands.unknown, SHOW))}
        <div data-cmd-list>${commandList()}</div>
        <details class="cbx-sub"><summary>Commandes d’autres bots <small>${r.commands.external.length}</small></summary>
          <div class="cbx-tags">${r.commands.external.map((c) => `<span class="cbx-tag">!${esc(c)}<button type="button" data-ext-del="${esc(c)}" aria-label="Retirer">×</button></span>`).join('') || '<small>Aucune.</small>'}</div>
          <div class="cbx-line"><input class="cbx-input" data-ext-new placeholder="uptime, followage…"><button type="button" class="d-btn sm" data-ext-add>Masquer ces commandes</button></div>
        </details>
      </section>
      <section class="cbx-card"><h3>Messages de LeCroupier_</h3>
        <p class="cbx-hint">Rangés d’après le module qui les envoie, jamais d’après leur texte. Une réponse à une commande suit d’abord le réglage de cette commande.</p>
        ${st!.categories
          .map((c) => {
            const own = fams.filter((f) => f.category === c.id);
            return `<div class="cbx-cat">${row(c.label, modeSeg(`data-seg="cat" data-id="${c.id}"`, r.croupier.categories[c.id] ?? 'hide'))}${own
              .map((f) =>
                row(
                  `↳ ${f.label}`,
                  modeSeg(
                    `data-seg="fam" data-id="${esc(f.id)}"`,
                    r.croupier.families[f.id] ?? 'inherit',
                    [['inherit', 'Comme la catégorie'], ...MODES],
                  ),
                ),
              )
              .join('')}</div>`;
          })
          .join('')}
        ${row('Message qu’aucun module n’explique', modeSeg('data-seg="fallback"', r.croupier.fallback))}
      </section>
      <section class="cbx-card"><h3>Messages spéciaux</h3>
        <p class="cbx-hint">Les abonnements et les raids sont déjà montrés par les alertes : masqués par défaut pour éviter un doublon.</p>
        ${SPECIALS.map(([k, label]) => row(label, modeSeg(`data-seg="special" data-id="${k}"`, r.special[k]))).join('')}
      </section>
      <section class="cbx-card"><h3>Comptes</h3>
        <p class="cbx-hint">Reconnus par leur identifiant Twitch. « Afficher » est une exception : toujours affiché, même une commande.</p>
        ${r.accounts
          .map(
            (a, i) =>
              `<div class="cbx-line"><span><strong>${esc(a.login)}</strong> <small>${a.id ? `id ${esc(a.id)}` : 'identifiant au premier message'}</small></span>${modeSeg(`data-seg="acc" data-i="${i}"`, a.mode)}<button type="button" class="d-btn sm ghost" data-acc-del="${i}">Retirer</button></div>`,
          )
          .join('')}
        <div class="cbx-line"><input class="cbx-input" data-acc-new placeholder="pseudo Twitch"><button type="button" class="d-btn sm" data-acc-add="hide">Masquer ce compte</button><button type="button" class="d-btn sm ghost" data-acc-add="highlight">Mettre en avant</button></div>
        ${
          recent.length
            ? `<details class="cbx-sub"><summary>Vus récemment <small>${recent.length}</small></summary>${recent
                .slice(0, 20)
                .map(
                  (a) =>
                    `<div class="cbx-line"><span>${esc(a.name)} ${a.feed === 'demo' ? '<small>(démonstration)</small>' : ''}</span><button type="button" class="d-btn sm ghost" data-seen-hide="${esc(a.login)}">Masquer</button><button type="button" class="d-btn sm ghost" data-seen-hl="${esc(a.login)}">Mettre en avant</button></div>`,
                )
                .join('')}</details>`
            : ''
        }
      </section>
    </div>`;
  }

  async function saveRules(r: Rules, done = 'Appliqué aux trois chatbox.') {
    const open = [
      ...pg.body.querySelectorAll<HTMLDetailsElement>('details'),
    ].map((d) => d.open);
    if (await call('/rules', { rules: r }, done)) {
      paint();
      // What the streamer had unfolded stays unfolded.
      pg.body
        .querySelectorAll<HTMLDetailsElement>('details')
        .forEach((d, i) => (d.open = open[i] ?? d.open));
    }
  }

  function repick(holder: HTMLElement, on: HTMLElement) {
    const buttons = [...holder.querySelectorAll<HTMLElement>('button')];
    holder.style.setProperty('--i', String(buttons.indexOf(on)));
    for (const x of buttons) {
      x.classList.toggle('on', x === on);
      x.setAttribute('aria-pressed', String(x === on));
    }
  }

  // --- Paint -----------------------------------------------------------------------------------------------------------
  function paint() {
    if (!st) return;
    paintHead();
    if (tab === 'look') {
      pg.body.innerHTML = paintLook();
      requestAnimationFrame(() => {
        fitFrame();
        paintMap();
      });
      frame()?.addEventListener('load', () => {
        if (drafts[profile])
          post({ type: 'chatbox:draft', settings: drafts[profile] });
        if (places[scene().id])
          post({ type: 'chatbox:draft', placement: places[scene().id] });
      });
    } else if (tab === 'visibility') pg.body.innerHTML = paintVisibility();
    else
      pg.body.innerHTML = `<p class="cbx-hint">Les trois chatbox côte à côte, mêmes messages fictifs, Origine ou Modernisée. Simulateur seulement : rien n’est envoyé à OBS ni à Twitch.</p><iframe class="cbx-demo" title="Démonstration" src="${esc(st.demo.url.replace(/^https?:\/\/[^/]+/, ''))}"></iframe>`;
  }

  // --- Events ----------------------------------------------------------------------------------------------------------
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b || !st) return;
    const r = clone(st.rules);
    const d = b.dataset;
    const holder = b.closest<HTMLElement>('[data-seg]');
    if (holder && d.v !== undefined) {
      const v = d.v;
      const h = holder.dataset;
      switch (h.seg) {
        case 'tab':
          tab = v as typeof tab;
          return paint();
        case 'profile':
          profile = v;
          return paint();
        case 'scene':
          sceneOf[profile] = v;
          return paint();
        case 'bg':
          bg = v;
          pg.body.querySelector('[data-stage]')!.className =
            `cbx-stage bg-${bg}`;
          return repick(holder, b);
        case 'field':
          change(h.path!, v);
          return repick(holder, b);
        case 'presence':
          change('presence.mode', v);
          return paint();
        case 'acc':
          r.accounts[Number(h.i)]!.mode = v as Mode;
          break;
        case 'cmd-raptoru':
          r.commands.raptoru = v as 'hide' | 'normal';
          break;
        case 'cmd-unknown':
          r.commands.unknown = v as 'hide' | 'normal';
          break;
        case 'cmd-msg':
        case 'cmd-reply': {
          const own = { ...(r.commands.rules[h.key!] ?? {}) };
          if (h.seg === 'cmd-msg') own.message = v as 'hide' | 'normal';
          else if (v === 'inherit') delete own.reply;
          else own.reply = v as Mode;
          if (own.message === undefined && own.reply === undefined)
            delete r.commands.rules[h.key!];
          else r.commands.rules[h.key!] = own;
          break;
        }
        case 'cat':
          r.croupier.categories[h.id!] = v as Mode;
          break;
        case 'fam':
          if (v === 'inherit') delete r.croupier.families[h.id!];
          else r.croupier.families[h.id!] = v as Mode;
          break;
        case 'fallback':
          r.croupier.fallback = v as Mode;
          break;
        case 'special':
          r.special[h.id as keyof Rules['special']] = v as Mode;
          break;
        default:
          return;
      }
      return saveRules(r);
    }
    if (d.play !== undefined) {
      const sc =
        pg.body.querySelector<HTMLSelectElement>('[data-scenario]')!.value;
      await call('/demo', { scenario: sc });
    } else if (d.playClear !== undefined) await call('/demo', { clear: true });
    else if (d.preset !== undefined) {
      if (
        dirty() &&
        !confirm('Remplacer les réglages non enregistrés par ce préset ?')
      )
        return;
      drafts[profile] = undefined;
      if (
        await call(
          '/preset/apply',
          { profile, preset: d.preset },
          'Préset appliqué dans OBS.',
        )
      )
        paint();
    } else if (d.savePreset !== undefined) {
      const name = prompt('Nom du préset ?')?.trim();
      if (!name) return;
      if (
        await call(
          '/preset/save',
          { profile, name, settings: settings() },
          'Préset enregistré et appliqué.',
        )
      ) {
        drafts[profile] = undefined;
        paint();
      }
    } else if (d.rename) {
      const name = prompt('Nouveau nom ?')?.trim();
      if (
        name &&
        (await call('/preset/rename', { profile, id: d.rename, name }))
      )
        paint();
    } else if (d.del) {
      if (
        confirm(
          'Supprimer ce préset ? Les réglages du profil restent tels quels.',
        ) &&
        (await call(
          '/preset/delete',
          { profile, id: d.del },
          'Préset supprimé.',
        ))
      )
        paint();
    } else if (d.save !== undefined) {
      let ok = true;
      if (drafts[profile])
        ok = await call('/profile', { profile, settings: drafts[profile] });
      for (const s of scenes())
        if (ok && places[s.id])
          ok = await call('/placement', {
            scene: s.id,
            placement: places[s.id],
          });
      if (ok) {
        drafts[profile] = undefined;
        for (const s of scenes()) places[s.id] = undefined;
        toast('Enregistré : appliqué dans OBS.');
        paint();
      }
    } else if (d.cancel !== undefined) {
      drafts[profile] = undefined;
      for (const s of scenes()) places[s.id] = undefined;
      paint();
    } else if (d.placeReset !== undefined)
      setPlacement(clone(st.defaults[scene().id]!));
    else if (d.copy !== undefined) {
      await navigator.clipboard.writeText(scene().url).catch(() => {});
      toast(
        'Adresse copiée (elle contient la clé de la page : ne la partage pas).',
      );
    } else if (d.accDel) {
      r.accounts.splice(Number(d.accDel), 1);
      await saveRules(r, 'Règle retirée.');
    } else if (d.accAdd) {
      const login = pg.body
        .querySelector<HTMLInputElement>('[data-acc-new]')!
        .value.trim()
        .toLowerCase()
        .replace(/^@/, '');
      if (!/^[a-z0-9_]{1,25}$/.test(login))
        return toast('Pseudo Twitch invalide.', { bad: true });
      const seen = st.accounts.find(
        (a) => a.login === login && a.feed === 'live',
      );
      r.accounts.push({ id: seen?.id ?? null, login, mode: d.accAdd as Mode });
      await saveRules(r, 'Règle ajoutée.');
    } else if (d.seenHide || d.seenHl) {
      const a = st.accounts.find((x) => x.login === (d.seenHide ?? d.seenHl))!;
      // A demo viewer's id is fictional: the rule waits for the real account's first message.
      r.accounts.push({
        id: a.feed === 'live' ? a.id : null,
        login: a.login,
        mode: d.seenHide ? 'hide' : 'highlight',
      });
      await saveRules(r, 'Règle ajoutée.');
    } else if (d.extDel) {
      r.commands.external = r.commands.external.filter((c) => c !== d.extDel);
      await saveRules(r);
    } else if (d.extAdd !== undefined) {
      const names = pg.body
        .querySelector<HTMLInputElement>('[data-ext-new]')!
        .value.toLowerCase()
        .split(/[\s,;]+/)
        .map((x) => x.replace(/^!/, ''))
        .filter((x) => /^[\p{Ll}\p{N}_]{1,40}$/u.test(x));
      r.commands.external = [...new Set([...r.commands.external, ...names])];
      await saveRules(r);
    }
  });

  root.addEventListener('input', (e) => {
    const i = e.target as HTMLInputElement;
    if (i.dataset.search !== undefined) {
      search = i.value;
      const list = pg.body.querySelector<HTMLElement>('[data-cmd-list]');
      if (list) list.innerHTML = commandList();
      return;
    }
    if (i.dataset.f && (i.type === 'range' || i.type === 'color'))
      change(i.dataset.f, i.type === 'range' ? Number(i.value) : i.value);
    if (i.dataset.pl) {
      const n = Number(i.value);
      if (Number.isFinite(n))
        setPlacement({ ...placement(), [i.dataset.pl]: n });
    }
  });
  root.addEventListener('change', (e) => {
    const i = e.target as HTMLInputElement;
    if (i.dataset.explain !== undefined) {
      explain = i.checked;
      paint();
    } else if (i.dataset.rolebar !== undefined) {
      const base = st!.builtins.find((b) => b.id === prof().base)?.settings[
        profile
      ] as { roles?: { bar?: number } } | undefined;
      change('roles.bar', i.checked ? Math.max(3, base?.roles?.bar ?? 3) : 0);
    } else if (i.dataset.f) {
      const f = field(i.dataset.f);
      change(
        i.dataset.f,
        f?.kind === 'toggle'
          ? i.checked
          : i.type === 'number'
            ? Number(i.value)
            : i.value,
      );
    }
  });

  // Direct manipulation on the 1920 × 1080 map: drag the box, pull its corner to resize.
  root.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const rect = t.closest<HTMLElement>('[data-rect]');
    const map = t.closest<HTMLElement>('[data-map]');
    if (!rect || !map || !st) return;
    e.preventDefault();
    const k = map.clientWidth / 1920;
    const start = { ...placement() };
    const resize = !!t.closest('[data-handle]');
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / k;
      const dy = (ev.clientY - y0) / k;
      setPlacement(
        resize
          ? { ...start, w: start.w + dx, h: start.h + dy }
          : { ...start, x: start.x + dx, y: start.y + dy },
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // The map needs its size: drawn when the placement panel unfolds.
  root.addEventListener(
    'toggle',
    (e) => {
      if ((e.target as HTMLElement).matches?.('[data-fold="place"]'))
        requestAnimationFrame(paintMap);
    },
    true,
  );
  window.addEventListener('resize', () => {
    fitFrame();
    paintMap();
  });

  return {
    setVisible(v: boolean) {
      if (v) void load();
    },
  };
}
