// Chatbox Raptoru — Studio's screen (docs/CHATBOX.md § 9): the three profiles, their presets, a faithful preview (the
// real OBS page on the simulator's feed, filtered messages shown struck with their rule), every setting, each scene's
// placement moved by hand, the visibility manager and the demonstration. A saved setting reaches the OBS sources at
// once; nothing here touches OBS, StreamElements or Twitch.

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
  fields: { id: string; label: string; fields: Field[] }[];
  fonts: string[];
  demo: {
    url: string;
    token: string;
    playing: string | null;
    scenarios: { id: string; label: string }[];
  };
  emotes: { count: number };
  repaired: string[];
}

const MODES: [Mode, string][] = [
  ['hide', 'Masquer'],
  ['normal', 'Normal'],
  ['highlight', 'Mettre en avant'],
];
const SPECIALS: [keyof Rules['special'], string, string][] = [
  [
    'announcement',
    'Annonces Twitch',
    '/announce, avec la couleur choisie dans Twitch',
  ],
  ['highlighted', 'Messages mis en avant', 'achetés avec les points de chaîne'],
  ['first', 'Premier message d’un viewer', ''],
  ['sub', 'Abonnements', 'phase suivante ; déjà montrés par les alertes'],
  ['raid', 'Raids', 'phase suivante ; déjà montrés par les alertes'],
];

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
  const pg = page(root, { title: 'Chatbox', mod: 'chatbox', panel: true });
  let st: State | null = null;
  let profile = 'just-chatting';
  let tab: 'look' | 'visibility' | 'demo' = 'look';
  let bg = 'busy';
  let explain = true;
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
  function paintHead() {
    pg.state.innerHTML = `<span class="cbx-chip">${st!.emotes.count} emotes 7TV · BTTV · FFZ</span>${
      st!.repaired.length
        ? `<span class="cbx-chip warn">Réparé : ${esc(st!.repaired.join(', '))}</span>`
        : ''
    }`;
    pg.actions.innerHTML = `${pick(
      'data-seg="tab"',
      [
        ['look', 'Apparence'],
        ['visibility', 'Visibilité'],
        ['demo', 'Démonstration'],
      ],
      tab,
    )}
      <button type="button" class="d-btn ${pg.panel.isOpen() ? 'on' : 'ghost'}" data-panel>Réglages du profil</button>`;
  }

  // --- Appearance ------------------------------------------------------------------------------------------------------
  function presetBar() {
    const p = prof();
    const custom = st!.presets[profile] ?? [];
    const chip = (id: string, name: string, own = false) =>
      `<span class="cbx-preset${p.base === id ? ' on' : ''}"><button type="button" data-preset="${esc(id)}" title="${esc(
        st!.builtins.find((b) => b.id === id)?.desc ?? 'Préset personnel',
      )}">${esc(name)}</button>${
        own
          ? `<button type="button" class="cbx-x" data-rename="${esc(id)}" aria-label="Renommer">✎</button><button type="button" class="cbx-x" data-del="${esc(id)}" aria-label="Supprimer">×</button>`
          : ''
      }</span>`;
    return `<div class="cbx-presets"><span class="d-lb">Présets</span>${st!.builtins
      .map((b) => chip(b.id, b.name))
      .join('')}${custom.map((c) => chip(c.id, c.name, true)).join('')}
      <button type="button" class="d-btn sm ghost" data-save-preset>Enregistrer comme préset…</button></div>`;
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

  function paintLook() {
    const pl = placement();
    return `<div class="cbx-look">
      <div class="cbx-top">
        ${pick(
          'data-seg="profile"',
          st!.profiles.map((p) => [p.id, p.label] as [string, string]),
          profile,
          'cbx-profiles',
        )}
        ${presetBar()}
        <span class="cbx-sp"></span>
        <span class="cbx-dirty" ${dirty() ? '' : 'hidden'}>Modifications non enregistrées</span>
        <button type="button" class="d-btn ghost" data-cancel ${dirty() ? '' : 'disabled'}>Annuler</button>
        <button type="button" class="d-btn pri" data-save ${dirty() ? '' : 'disabled'}>Enregistrer et appliquer dans OBS</button>
      </div>
      <div class="cbx-grid">
        <section class="cbx-stage-wrap">
          <div class="cbx-tools">
            ${pick(
              'data-seg="scene"',
              scenes().map((s) => [s.id, s.label] as [string, string]),
              scene().id,
            )}
            ${pick(
              'data-seg="bg"',
              [
                ['dark', 'Sombre'],
                ['light', 'Lumineux'],
                ['busy', 'Chargé'],
              ],
              bg,
            )}
            <label class="cbx-check">${sw(explain, 'data-explain', 'Montrer les messages filtrés')} Messages filtrés</label>
          </div>
          <div class="cbx-tools">${st!.demo.scenarios
            .map(
              (s) =>
                `<button type="button" class="d-btn sm${st!.demo.playing === s.id ? ' on' : ' ghost'}" data-play="${s.id}">${esc(s.label)}</button>`,
            )
            .join(
              '',
            )}<button type="button" class="d-btn sm ghost" data-play="stop">Arrêter</button><button type="button" class="d-btn sm ghost" data-play="clear">Vider</button></div>
          <div class="cbx-stage bg-${bg}" data-stage><div class="cbx-frame" data-frame><iframe data-cbx-preview title="Prévisualisation" src="${esc(previewUrl())}"></iframe></div></div>
          <p class="cbx-hint">Taille réelle à l’écran : ${pl.w} × ${pl.h} px${pl.zoom !== 1 ? `, proportions × ${pl.zoom}` : ''}. Les messages viennent du simulateur, jamais du vrai chat.</p>
        </section>
        <aside class="cbx-side">
          <h3>Emplacement dans « ${esc(scene().label)} »</h3>
          <div class="cbx-map" data-map><div class="cbx-rect" data-rect><span class="cbx-handle" data-handle></span></div></div>
          <div class="cbx-place">
            ${(['x', 'y', 'w', 'h'] as const).map((k) => `<div class="cbx-pl"><span>${{ x: 'Gauche', y: 'Haut', w: 'Largeur', h: 'Hauteur' }[k]}</span>${fld(`data-pl="${k}"`, pl[k], 'px', 'step="1"')}</div>`).join('')}
            <div class="cbx-pl"><span>Proportions</span>${fld('data-pl="zoom"', pl.zoom, '×', 'step="0.01" min="0.5" max="2"')}</div>
          </div>
          <button type="button" class="d-btn sm ghost" data-place-reset>Revenir à la place d’origine</button>
          <h3>Source OBS de cette scène</h3>
          <p class="cbx-hint">Source navigateur 1920 × 1080, échelle 1, verrouillée. L’adresse ne change jamais : les réglages enregistrés s’y appliquent tout seuls. Installation sur ton autorisation seulement.</p>
          <div class="cbx-url"><code>${esc(scene().url.replace(/#.*/, '#…'))}</code><button type="button" class="d-btn sm" data-copy>Copier l’adresse</button></div>
        </aside>
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
    if (!map || !rect) return;
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
    const d = dirty();
    pg.body
      .querySelector<HTMLElement>('.cbx-dirty')
      ?.toggleAttribute('hidden', !d);
    for (const b of pg.body.querySelectorAll<HTMLButtonElement>(
      '[data-save],[data-cancel]',
    ))
      b.disabled = !d;
  }

  // --- Settings panel (generated from the server's field list) --------------------------------------------------------
  function control(f: Field, v: unknown) {
    const a = `data-f="${esc(f.path)}"`;
    if (f.kind === 'number')
      return `<span class="cbx-num"><input type="range" ${a} min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v)}"><input type="number" ${a} min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v)}">${f.unit ? `<small>${esc(f.unit)}</small>` : ''}</span>`;
    if (f.kind === 'color')
      return `<input type="color" ${a} value="${esc(v)}">`;
    if (f.kind === 'toggle') return sw(v === true, a, f.label);
    if (f.kind === 'font')
      return `<input class="cbx-font" list="cbx-fonts" ${a} value="${esc(v)}">`;
    if (f.kind === 'list')
      return `<input class="cbx-font" ${a} value="${esc((v as number[]).join(', '))}" title="Taille pour 1, 2, 3… emotes seules">`;
    if (f.kind !== 'choice') return '';
    return pick(
      `data-seg="field" data-path="${esc(f.path)}"`,
      f.options.map((o) => [o.value, o.label] as [string, string]),
      String(v),
    );
  }

  function paintPanel() {
    const s = settings();
    pg.panel.set(
      `<datalist id="cbx-fonts">${st!.fonts.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
      <p class="cbx-hint">Profil ${esc(prof().label)} : ces réglages ne touchent jamais les deux autres. Aperçu immédiat ; appliqué dans OBS à l’enregistrement.</p>` +
        st!.fields
          .map(
            (g) =>
              `<section class="d-grp" data-g="${esc(g.label.toLowerCase())}"><h3>${esc(g.label)}</h3>${g.fields
                .map((f) => row(f.label, control(f, get(s, f.path))))
                .join('')}</section>`,
          )
          .join(''),
    );
  }

  function change(path: string, raw: unknown) {
    const f = st!.fields.flatMap((g) => g.fields).find((x) => x.path === path);
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
    for (const i of pg.panel.body.querySelectorAll<HTMLInputElement>(
      `input[data-f="${CSS.escape(path)}"]`,
    ))
      if (document.activeElement !== i && f.kind === 'number')
        i.value = String(v);
    paintDirty();
  }

  // --- Visibility ------------------------------------------------------------------------------------------------------
  const modeSeg = (
    holder: string,
    cur: string,
    opts: readonly (readonly [string, string])[] = MODES,
  ) => pick(holder, opts, cur);

  function paintVisibility() {
    const r = st!.rules;
    const fams = st!.catalogue;
    const accounts = st!.accounts.filter(
      (a) => !r.accounts.some((x) => x.login === a.login),
    );
    return `<div class="cbx-vis">
      <p class="cbx-note">Masquer un message ici le retire seulement de la chatbox : <strong>rien n’est fait sur Twitch</strong> (ni ban, ni timeout, ni suppression). Chaque changement s’applique tout de suite aux trois chatbox.</p>
      <section class="cbx-card"><h3>Comptes</h3>
        <p class="cbx-hint">Reconnus par leur identifiant Twitch (un pseudo ajouté est lié à son identifiant au premier message vu). « Normal » est une exception : toujours affiché.</p>
        ${r.accounts
          .map(
            (a, i) =>
              `<div class="cbx-line"><span><strong>${esc(a.login)}</strong> <small>${a.id ? `id ${esc(a.id)}` : 'identifiant au premier message'}</small></span>${modeSeg(`data-seg="acc" data-i="${i}"`, a.mode)}<button type="button" class="d-btn sm ghost" data-acc-del="${i}">Retirer</button></div>`,
          )
          .join('')}
        <div class="cbx-line"><input class="cbx-font" data-acc-new placeholder="pseudo Twitch"><button type="button" class="d-btn sm" data-acc-add="hide">Masquer ce compte</button><button type="button" class="d-btn sm ghost" data-acc-add="highlight">Mettre en avant</button></div>
        ${
          accounts.length
            ? `<h4>Vus récemment</h4>${accounts
                .slice(0, 12)
                .map(
                  (a) =>
                    `<div class="cbx-line"><span>${esc(a.name)} ${a.feed === 'demo' ? '<small>(démonstration)</small>' : ''}</span><button type="button" class="d-btn sm ghost" data-seen-hide="${esc(a.login)}">Masquer</button><button type="button" class="d-btn sm ghost" data-seen-hl="${esc(a.login)}">Mettre en avant</button></div>`,
                )
                .join('')}`
            : ''
        }
      </section>
      <section class="cbx-card"><h3>Commandes</h3>
        <p class="cbx-hint">Une commande, c’est « ! » suivi d’une lettre : <code>!!!!!</code> ou <code>!?!?</code> restent toujours visibles.</p>
        ${row(
          'Commandes Raptoru reconnues (registre et alias)',
          modeSeg('data-seg="cmd-raptoru"', r.commands.raptoru, [
            ['hide', 'Masquer'],
            ['normal', 'Afficher'],
          ]),
        )}
        ${row(
          'Commande que personne ne reconnaît',
          modeSeg('data-seg="cmd-unknown"', r.commands.unknown, [
            ['hide', 'Masquer'],
            ['normal', 'Afficher'],
          ]),
        )}
        <h4>Commandes d’autres bots, masquées</h4>
        <div class="cbx-tags">${r.commands.external.map((c) => `<span class="cbx-tag">!${esc(c)}<button type="button" data-ext-del="${esc(c)}" aria-label="Retirer">×</button></span>`).join('') || '<small>Aucune.</small>'}</div>
        <div class="cbx-line"><input class="cbx-font" data-ext-new placeholder="uptime, followage…"><button type="button" class="d-btn sm" data-ext-add>Ajouter</button></div>
      </section>
      <section class="cbx-card"><h3>Messages de LeCroupier_</h3>
        <p class="cbx-hint">Rangés par famille d’après le module qui les envoie (jamais d’après leur texte). Une famille réglée l’emporte sur sa catégorie.</p>
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
        ${row('Message non catégorisé (envoyé à la main, bot direct)', modeSeg('data-seg="fallback"', r.croupier.fallback))}
        <p class="cbx-hint">Les familles apparaissent ici dès que LeCroupier_ les emploie dans le vrai chat (jalon 2 : branchement au Core).</p>
      </section>
      <section class="cbx-card"><h3>Messages spéciaux</h3>
        ${SPECIALS.map(([k, label, hint]) => row(`${label}${hint ? ` · ${hint}` : ''}`, modeSeg(`data-seg="special" data-id="${k}"`, r.special[k]))).join('')}
      </section>
    </div>`;
  }

  async function saveRules(r: Rules, done = 'Appliqué aux trois chatbox.') {
    if (await call('/rules', { rules: r }, done)) paint();
  }

  /** A segmented choice that does not repaint the page: only its own buttons move. */
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
      paintPanel();
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
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
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
        case 'acc':
          r.accounts[Number(h.i)]!.mode = v as Mode;
          break;
        case 'cmd-raptoru':
          r.commands.raptoru = v as 'hide' | 'normal';
          break;
        case 'cmd-unknown':
          r.commands.unknown = v as 'hide' | 'normal';
          break;
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
    if (d.play) {
      await call(
        '/demo',
        d.play === 'stop'
          ? { stop: true }
          : d.play === 'clear'
            ? { clear: true }
            : { scenario: d.play },
      );
      for (const x of pg.body.querySelectorAll<HTMLElement>('[data-play]')) {
        x.classList.toggle('on', x.dataset.play === st.demo.playing);
        x.classList.toggle('ghost', x.dataset.play !== st.demo.playing);
      }
    } else if (d.preset !== undefined) {
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
    } else if (i.dataset.f) {
      const f = st?.fields
        .flatMap((g) => g.fields)
        .find((x) => x.path === i.dataset.f);
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
