import {
  clock,
  esc,
  errText,
  fld,
  fmt,
  grp,
  ic,
  keyed,
  page,
  panelBtn,
  patch,
  poller,
  pop,
  pp,
  row,
  scrub,
  seg,
  viewersSeg,
  stateChip,
  sw,
  toast,
} from '../ds/ds.js';
import { getJson, postJson, statusError, tryGetJson } from '../http.js';
import {
  modGet,
  money,
  onModChange,
  openItem,
  purge,
  refreshOpenItem,
  removeMenu,
  setModuleState,
  statusText,
  stopAll,
  type ModItem,
} from '../mod/mod.js';
import { whenProfile } from '../module-frame.js';
import { setNavCount } from '../shell/shell.js';
import { wave, waveSvg } from './soundboard-wave.js';

// La Soundboard : une banque qu'on joue et qu'on règle à l'oreille. Le pupitre du haut montre le son choisi (forme d'onde réelle,
// volume, prix), la banque se parcourt dessous, la colonne de droite vit avec le stream : lecteur, sons en cours, file, décisions.
// Le Core décide de tout ce qui se paie ; chaque réglage lui est envoyé dès qu'il est posé, et il répond la valeur retenue.

type Mode = 'stack' | 'queue' | 'ignore_if_running';
type Protection = 'off' | 'light' | 'medium';
interface Sound {
  id: string;
  label: string;
  default_label: string;
  custom_label: string | null;
  enabled: boolean;
  token_cost: number;
  credit_cost: number;
  cooldown_ms: number;
  playback_mode: Mode;
  volume: number;
  duration_ms: number | null;
  preview_url: string | null;
  variants: number;
}
interface Config {
  sounds: Sound[];
  settings: { volume_protection: Protection };
}
interface Status {
  enabled: boolean;
  ready?: boolean;
  playerUrl?: string;
  error?: string | null;
}
type Item = ModItem & { sound_id?: string; duration_ms?: number };
interface Queue {
  module_state: 'active' | 'paused' | 'disabled';
  playing: Item[];
  waiting: Item[];
  recent: Item[];
}
type Field =
  | 'label'
  | 'enabled'
  | 'token_cost'
  | 'credit_cost'
  | 'cooldown_ms'
  | 'playback_mode'
  | 'volume';
type SortKey = 'bank' | 'name' | 'dur' | 'price' | 'delay' | 'vol';

const STATES = [
  ['active', 'Ouvert'],
  ['paused', 'Pause'],
  ['disabled', 'Fermé'],
] as const;
const MODES: Record<Mode, { label: string; hint: string }> = {
  stack: {
    label: 'Superposer',
    hint: 'Chaque achat joue tout de suite, même par-dessus lui-même.',
  },
  queue: {
    label: 'File',
    hint: 'Les achats de ce son jouent l’un après l’autre.',
  },
  ignore_if_running: {
    label: 'Ignorer',
    hint: 'Refusé tant que ce son est en attente ou en lecture.',
  },
};
const PROTECTIONS: Record<Protection, { label: string; hint: string }> = {
  off: {
    label: 'Coupée',
    hint: 'Chaque son garde son volume, même à plusieurs.',
  },
  light: {
    label: 'Légère',
    hint: 'Baisse douce quand plusieurs sons se superposent (plancher 68 %).',
  },
  medium: {
    label: 'Moyenne',
    hint: 'Baisse plus marquée en cas de rafale (plancher 55 %).',
  },
};
const COLS: [SortKey, string][] = [
  ['bank', 'Son'],
  ['dur', 'Durée'],
  ['price', 'Prix'],
  ['delay', 'Délai'],
  ['vol', 'Volume'],
];
const SORT: Record<SortKey, (a: Sound, b: Sound) => number> = {
  bank: () => 0,
  name: (a, b) => a.label.localeCompare(b.label, 'fr'),
  dur: (a, b) => (a.duration_ms ?? 0) - (b.duration_ms ?? 0),
  price: (a, b) => a.token_cost - b.token_cost,
  delay: (a, b) => a.cooldown_ms - b.cooldown_ms,
  vol: (a, b) => a.volume - b.volume,
};
const REFUS = {
  invalid_request: 'Valeur refusée : hors des limites.',
  sound_not_found: 'Ce son n’existe plus.',
};
const secs = (ms: number) =>
  `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;
const fileOf = (s: Sound) => s.preview_url?.split('/').pop() ?? '';
/** Graduation de la règle du temps : assez serrée pour lire un son court. */
const tickOf = (s: number) => (s <= 2 ? 0.25 : s <= 6 ? 0.5 : 1);

export function mountSoundboardPage(root: HTMLElement) {
  const p = page(root, { title: 'Soundboard', mod: 'soundboard', panel: true });
  p.body.innerHTML = `<div class="sb">
    <section class="sb-deck" data-z="deck" aria-label="Son choisi"><div class="d-skel" style="height:190px"></div></section>
    <section class="sb-bank" aria-label="Banque de sons">
      <div class="sb-tools">
        <label class="d-fld sb-find">${ic('search')}<input type="search" data-find placeholder="Chercher un son" aria-label="Chercher un son" autocomplete="off"></label>
        <span data-z="view"></span>
        <span class="d-sp"></span>
        <span class="sb-count" data-z="count"></span>
        <button type="button" class="d-btn ghost sm" data-media="add">${ic('plus')}Ajouter un son</button>
      </div>
      <div class="sb-cats" data-z="cats"></div>
      <div class="sb-cols" data-z="cols"></div>
      <div class="sb-list d-scroll" data-z="list" role="list"></div>
    </section>
    <aside class="sb-live" aria-label="Sons en cours et file">
      <div class="sb-pl" data-z="pl"></div>
      <div class="sb-frame" data-z="frame" hidden></div>
      <div class="sb-lhead" data-z="lhead"></div>
      <div class="sb-llist d-scroll" data-z="llist"></div>
      <div class="sb-lfoot" data-z="lfoot"></div>
    </aside>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const find = p.body.querySelector<HTMLInputElement>('[data-find]')!;

  let cfg: Config | null = null;
  let cfgError = '';
  let q: Queue | null = null;
  let qError = '';
  let status: Status | null = null;
  let globalPaused = false;
  let production = false;
  /** Null : ce serveur ne connaît pas encore les catégories. */
  let library: Record<string, string> | null = null;
  let tab: 'file' | 'past' = 'file';
  let past: Item[] | null = null;
  let view: 'all' | 'on' | 'off' = 'all';
  let cat: string | null = null;
  let sort: { key: SortKey; dir: 1 | -1 } = { key: 'bank', dir: 1 };
  let picked: string | null = null;
  let frame: HTMLIFrameElement | null = null;
  let frameOpen = false;
  let audio: HTMLAudioElement | null = null;
  let audioId: string | null = null;
  let raf = 0;
  let waveQueued = false;
  const peaks = new Map<string, number[] | null>();
  const rowWaves = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** La valeur retenue par le Core avant la saisie en cours : pour « Annuler » ou un refus. */
  const before = new Map<string, unknown>();

  const sound = (id: string | null) => cfg?.sounds.find((s) => s.id === id);
  const refreshExtension = () =>
    window.dispatchEvent(new CustomEvent('raptoru:lab-refresh'));
  const cats = () =>
    [...new Set(Object.values(library ?? {}))].sort((a, b) =>
      a.localeCompare(b, 'fr'),
    );
  const visible = () => {
    const s = find.value.trim().toLowerCase();
    const list = (cfg?.sounds ?? []).filter(
      (x) =>
        (!s || x.label.toLowerCase().includes(s) || x.id.includes(s)) &&
        (view === 'all' || (view === 'on') === x.enabled) &&
        (cat === null ||
          (cat === '' ? !library?.[x.id] : library?.[x.id] === cat)),
    );
    return sort.key === 'bank'
      ? list
      : [...list].sort((a, b) => SORT[sort.key](a, b) * sort.dir);
  };

  // --- Écoute -----------------------------------------------------------------------------------------------------------
  function stopAudio() {
    const was = audioId;
    audio?.pause();
    audio = null;
    audioId = null;
    cancelAnimationFrame(raf);
    z('deck')
      .querySelector<HTMLElement>('.sb-wave')
      ?.style.setProperty('--p', '0%');
    if (was) paintPlaying();
  }
  function follow() {
    const w = z('deck').querySelector<HTMLElement>('.sb-wave');
    if (audio && audioId === picked && w && audio.duration)
      w.style.setProperty(
        '--p',
        `${(audio.currentTime / audio.duration) * 100}%`,
      );
    if (audio) raf = requestAnimationFrame(follow);
  }
  /** Une seule écoute à la fois, au volume réglé, sur la sortie de ce PC : les viewers n'entendent rien. */
  function listen(id: string, from = 0) {
    const s = sound(id);
    const again = audioId === id && !from;
    stopAudio();
    if (!s?.preview_url || again) return;
    const a = new Audio(`/ext/${s.preview_url}`);
    a.volume = s.volume / 100;
    if (from)
      a.addEventListener(
        'loadedmetadata',
        () => (a.currentTime = from * a.duration),
        { once: true },
      );
    a.addEventListener('ended', () => audio === a && stopAudio(), {
      once: true,
    });
    audio = a;
    audioId = id;
    void a.play().catch(() => {
      if (audio === a) stopAudio();
      toast('Écoute impossible : fichier illisible', { bad: true });
    });
    paintPlaying();
    raf = requestAnimationFrame(follow);
  }
  /** L'état des boutons de lecture, sans redessiner le pupitre. */
  function paintPlaying() {
    const b = z('deck').querySelector<HTMLElement>('[data-dplay]');
    if (b) {
      const on = !!picked && audioId === picked;
      b.innerHTML = ic(on ? 'stop' : 'play');
      b.setAttribute('aria-label', on ? 'Arrêter l’écoute' : 'Écouter');
      z('deck').querySelector('.sb-wave')?.classList.toggle('is-playing', on);
    }
    paintList();
  }

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  function loadWaves() {
    for (const s of cfg?.sounds ?? [])
      if (s.preview_url && !peaks.has(s.id))
        void wave(`/ext/${s.preview_url}`).then((w) => {
          peaks.set(s.id, w);
          rowWaves.delete(s.id);
          if (s.id === picked) {
            const box = z('deck').querySelector<HTMLElement>('.sb-wave');
            if (box) box.innerHTML = deckWave(s);
          }
          if (waveQueued) return;
          waveQueued = true;
          requestAnimationFrame(() => {
            waveQueued = false;
            paintList();
          });
        });
  }
  async function readConfig() {
    try {
      cfg = await getJson<Config>('/api/sound-lab/config');
      cfgError = '';
      if (!sound(picked)) picked = cfg.sounds[0]?.id ?? null;
      loadWaves();
    } catch (e) {
      cfgError = errText(e);
    }
    library =
      (
        await tryGetJson<{ categories: Record<string, string> }>(
          '/api/sound-lab/library',
        )
      )?.categories ?? null;
    paint();
    paintDeck();
  }
  async function readLive() {
    try {
      const o = await modGet<{
        soundboard: Queue;
        global?: { paused?: boolean };
      }>('overview');
      q = o.soundboard;
      qError = '';
      globalPaused = !!o.global?.paused;
    } catch (e) {
      qError = errText(e);
    }
    status = await tryGetJson<Status>('/api/sound-lab/status');
    if (!cfg) await readConfig();
    setNavCount(
      'soundboard',
      q?.waiting.length ? String(q.waiting.length) : null,
    );
    if (tab === 'past') void readPast();
    refreshOpenItem();
    paint();
  }
  async function readPast() {
    const r = await modGet<{ items: Item[] }>(
      'interactions?module=soundboard&period=stream&limit=60',
    ).catch(() => null);
    past = r?.items ?? past ?? q?.recent ?? [];
    paintLive();
  }
  const tick = poller(readLive, 1500);
  onModChange(() => tick.now());

  // --- Lecteur ----------------------------------------------------------------------------------------------------------
  /** Chargé une seule fois : le recharger perdrait l'autorisation du son et ce qui joue. */
  function startPlayer(url: string) {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.title = 'Lecteur Soundboard';
    frame.src = url;
    z('frame').append(frame);
    frameOpen = true;
    paintPlayer();
  }
  // Production : le Core refuse un achat sans lecteur. Il se charge au lancement, pas à la première visite de cette page.
  void whenProfile().then((profile) => {
    production = profile === 'production';
    if (!production) return;
    const prime = async () => {
      const s = await tryGetJson<Status>('/api/sound-lab/status');
      if (s?.enabled && s.playerUrl) startPlayer(s.playerUrl);
      else setTimeout(() => void prime(), 5000);
    };
    void prime();
  });
  function paintPlayer() {
    const ready = !!status?.ready;
    z('frame').hidden = !frame || (ready && !frameOpen);
    const state = !status
      ? stateChip('w', 'Lecteur illisible')
      : !status.enabled
        ? stateChip('off', 'Lecteur non lancé')
        : ready
          ? stateChip('', 'Lecteur prêt')
          : stateChip('r', frame ? 'Son à activer' : 'Lecteur absent');
    const action =
      !frame && status?.enabled && !ready && !production
        ? `<button type="button" class="d-btn sm" data-start>${ic('play')}Démarrer ici</button>`
        : frame && ready
          ? `<button type="button" class="d-btn ghost sm" data-frame aria-expanded="${frameOpen}">${frameOpen ? 'Replier' : 'Lecteur'}</button>`
          : '';
    patch(
      z('pl'),
      `<div class="sb-plrow">${state}${action}</div>${
        status?.enabled && !ready
          ? `<p class="sb-plwhy">${production ? 'Tant que le lecteur n’est pas prêt, les achats de sons sont refusés.' : frame ? 'Clique sur « Activer le son » pour que les sons achetés soient joués.' : 'Sans lecteur, les achats de sons sont refusés.'}</p>`
          : ''
      }`,
    );
  }

  // --- Dessin -----------------------------------------------------------------------------------------------------------
  function paintHead() {
    const st = q?.module_state ?? 'active';
    const n = q?.playing.length ?? 0;
    const err = status?.error ? statusError(status.error) : '';
    const chip = !q
      ? stateChip('w', qError || 'Lecture…')
      : globalPaused
        ? stateChip('w', 'Pause globale')
        : err
          ? stateChip('w', err)
          : !status?.enabled
            ? stateChip('off', 'Lecteur non lancé')
            : !status.ready
              ? stateChip('r', 'Achats refusés : pas de lecteur')
              : st === 'paused'
                ? stateChip('w', 'Pause')
                : st === 'disabled'
                  ? stateChip('off', 'Fermé aux viewers')
                  : n
                    ? stateChip(
                        'live',
                        n > 1 ? `${n} sons en cours` : 'Un son en cours',
                      )
                    : stateChip('', 'Prêt');
    patch(p.state, chip);
    patch(
      p.actions,
      `${viewersSeg('data-state', STATES, st)}${panelBtn(p.panel.isOpen())}`,
    );
  }
  function paintTools() {
    const all = cfg?.sounds ?? [];
    const on = all.filter((s) => s.enabled).length;
    patch(
      z('view'),
      seg(
        'data-view',
        [
          ['all', 'Tous'],
          ['on', 'Proposés'],
          ['off', 'Coupés'],
        ],
        view,
      ),
    );
    patch(z('count'), cfg ? `<b>${on}</b> proposés sur ${all.length}` : '');
    const names = cats();
    const none = all.filter((s) => !library?.[s.id]).length;
    patch(
      z('cats'),
      names.length
        ? [
            `<button type="button" class="d-tag ${cat === null ? 'ok' : 'off'}" data-chip="*">Toutes</button>`,
            ...names.map(
              (n) =>
                `<button type="button" class="d-tag ${cat === n ? 'ok' : 'off'}" data-chip="${esc(n)}">${esc(n)} <span class="d-faint">${all.filter((s) => library?.[s.id] === n).length}</span></button>`,
            ),
            none
              ? `<button type="button" class="d-tag ${cat === '' ? 'ok' : 'off'}" data-chip="">Sans catégorie <span class="d-faint">${none}</span></button>`
              : '',
          ].join('')
        : '',
    );
    patch(
      z('cols'),
      COLS.map(
        ([k, l]) =>
          `<button type="button" class="sb-col is-${k} ${sort.key === k ? 'on' : ''}" data-sort="${k}" aria-label="Trier par ${l.toLowerCase()}">${l}${sort.key === k && k !== 'bank' ? ic(sort.dir > 0 ? 'down' : 'back', sort.dir > 0 ? '' : 'sb-up') : ''}</button>`,
      ).join('') +
        `<button type="button" class="sb-col is-name ${sort.key === 'name' ? 'on' : ''}" data-sort="name" aria-label="Trier par nom">A-Z</button>`,
    );
  }
  function rowWave(s: Sound) {
    const have = rowWaves.get(s.id);
    if (have) return have;
    const w = peaks.get(s.id);
    if (!s.preview_url)
      return `<span class="sb-none">${ic('dice')}Au hasard</span>`;
    if (w === null) return '<span class="d-tag bad">Fichier illisible</span>';
    if (!w) return '';
    const small: number[] = [];
    for (let i = 0; i < w.length; i += 4)
      small.push(Math.max(...w.slice(i, i + 4)));
    const html = waveSvg(small);
    rowWaves.set(s.id, html);
    return html;
  }
  function soundRow(s: Sound, top: number, live: Set<string | undefined>) {
    const on = audioId === s.id;
    const w = s.duration_ms ? Math.sqrt(s.duration_ms / top) * 100 : 100;
    return {
      key: s.id,
      html: `<div class="sb-row ${s.enabled ? '' : 'off'} ${picked === s.id ? 'sel d-vf' : ''} ${on ? 'is-on' : ''}" data-row="${esc(s.id)}" role="listitem">
        <button type="button" class="sb-pad" data-play="${esc(s.id)}" ${s.preview_url ? '' : 'disabled'} aria-label="${on ? 'Arrêter' : 'Écouter'} ${esc(s.label)}">${ic(s.preview_url ? (on ? 'stop' : 'play') : 'dice')}</button>
        <button type="button" class="sb-n" data-pick="${esc(s.id)}"><b>${esc(s.label)}</b>${live.has(s.id) ? '<i class="sb-eq" title="En cours sur le stream"><u></u><u></u><u></u></i>' : ''}<small>${esc(library?.[s.id] ?? '')}${s.variants > 1 ? `${library?.[s.id] ? ' · ' : ''}${s.variants} variantes` : ''}</small></button>
        <span class="sb-rw" style="--w:${w.toFixed(1)}%">${rowWave(s)}</span>
        <span class="sb-v is-dur">${s.duration_ms ? clock(s.duration_ms / 1000) : '—'}</span>
        <span class="sb-v is-price"><b>${fmt(s.token_cost)}</b> J<em>${fmt(s.credit_cost)} cr</em></span>
        <span class="sb-v is-delay">${s.cooldown_ms ? secs(s.cooldown_ms) : '<i>aucun</i>'}</span>
        <span class="sb-v is-vol"><input type="range" class="d-range" min="0" max="100" step="5" value="${s.volume}" data-rvol="${esc(s.id)}" aria-label="Volume de ${esc(s.label)}"></span>
        ${sw(s.enabled, `data-on="${esc(s.id)}"`, `${s.label} proposé aux viewers`)}
      </div>`,
    };
  }
  function paintList() {
    const list = z('list');
    // Un curseur tenu à la souris ne se fait jamais remplacer sous le pointeur.
    if (list.querySelector('input:active')) return;
    if (!cfg) {
      patch(
        list,
        `<div class="d-empty">${cfgError ? esc(cfgError) : 'Lecture de la banque…'}</div>`,
      );
      return;
    }
    const top = Math.max(1, ...cfg.sounds.map((s) => s.duration_ms ?? 0));
    const live = new Set(q?.playing.map((i) => i.sound_id));
    keyed(
      list,
      visible().map((s) => soundRow(s, top, live)),
      '<div class="d-empty">Aucun son ne correspond.</div>',
    );
  }
  const ruler = (ms: number) => {
    const s = ms / 1000;
    const step = tickOf(s);
    const every = Math.round(1 / step);
    let html = '';
    for (let n = 0; n * step <= s; n += 1) {
      const big = n % every === 0;
      html += `<i class="${big ? 'big' : ''}" style="left:${((n * step) / s) * 100}%">${big ? `<b>${n / every}</b>` : ''}</i>`;
    }
    return html;
  };
  function deckWave(s: Sound) {
    if (!s.preview_url)
      return `<div class="sb-nowave">${ic('dice')}<span>Tire un son au hasard dans la banque : rien à écouter ici.</span></div>`;
    const w = peaks.get(s.id);
    if (w === null)
      return '<div class="sb-nowave"><span>Fichier illisible : ce son ne peut pas être écouté.</span></div>';
    if (!w) return '<div class="d-skel sb-waveskel"></div>';
    return `${waveSvg(w, 'sb-w0')}${waveSvg(w, 'sb-w1')}<i class="sb-head"></i>`;
  }
  /** Redessiné pour un autre son ; sinon seules les valeurs suivent, sans toucher à une saisie. */
  function paintDeck() {
    const deck = z('deck');
    const s = sound(picked);
    if (!s) {
      if (cfg || cfgError)
        patch(
          deck,
          `<div class="d-empty">${cfgError ? esc(cfgError) : 'Aucun son dans la banque.'}</div>`,
        );
      return;
    }
    if (deck.dataset.id !== s.id) {
      deck.dataset.id = s.id;
      delete deck.dataset.sig;
      deck.innerHTML = `<div class="sb-dtop">
          <button type="button" class="d-play go" data-dplay ${s.preview_url ? '' : 'disabled'} aria-label="Écouter">${ic('play')}</button>
          <label class="sb-name"><input type="text" data-f="label" maxlength="40" aria-label="Nom affiché aux viewers" placeholder="${esc(s.default_label)}"></label>
          <span data-z="dname"></span>
          <span class="d-sp"></span>
          <span class="sb-saved" data-z="saved" role="status"></span>
          <button type="button" class="d-btn ghost sm" data-catpick hidden>${ic('layers')}<span data-z="dcat"></span>${ic('down')}</button>
          <button type="button" class="d-btn ghost sm" data-media="replace">${ic('upload')}Remplacer</button>
          <span class="sb-dsw" data-z="dsw"></span>
        </div>
        <div class="sb-wave" data-seek style="--p:0%;--v:1">${deckWave(s)}</div>
        <div class="sb-ruler">${s.duration_ms ? ruler(s.duration_ms) : ''}</div>
        <div class="sb-ctl">
          <label class="sb-vol"><span class="d-lb">Volume</span><input type="range" class="d-range" min="0" max="100" step="5" data-f="volume" aria-label="Volume"><b data-z="dvol"></b></label>
          <div class="sb-num" data-scrubbable><span class="d-lb" data-scrub>Jetons</span>${fld('data-f="token_cost" step="50" min="0" max="1000000" aria-label="Prix en Jetons"', '', 'J')}</div>
          <div class="sb-num" data-scrubbable><span class="d-lb" data-scrub>Crédits</span>${fld('data-f="credit_cost" min="0" max="100" aria-label="Prix en crédits"', '', 'cr')}</div>
          <div class="sb-num" data-scrubbable><span class="d-lb" data-scrub>Délai</span>${fld('data-f="cooldown_ms" min="0" max="3600" aria-label="Délai entre deux achats de ce son"', '', 's')}</div>
        </div>
        <div class="sb-mode"><span data-z="dmode"></span><p class="sb-hint" data-z="dhint"></p></div>`;
      paintPlaying();
    }
    for (const i of deck.querySelectorAll<HTMLInputElement>('[data-f]')) {
      if (i === document.activeElement && i.type !== 'range') continue;
      const f = i.dataset.f as Field;
      i.value =
        f === 'cooldown_ms' ? String(s.cooldown_ms / 1000) : String(s[f]);
    }
    const dz = (k: string) =>
      deck.querySelector<HTMLElement>(`[data-z="${k}"]`);
    deck
      .querySelector<HTMLElement>('.sb-wave')
      ?.style.setProperty('--v', String(Math.max(0.03, s.volume / 100)));
    const vol = dz('dvol');
    if (vol) vol.textContent = `${s.volume} %`;
    deck.querySelector<HTMLElement>('[data-catpick]')!.hidden = !library;
    dz('dcat')!.textContent = library?.[s.id] ?? 'Sans catégorie';
    patch(
      dz('dname'),
      s.custom_label !== null
        ? `<button type="button" class="d-btn ghost sm" data-resetname title="Nom d’origine : ${esc(s.default_label)}">${ic('hist')}Nom d’origine</button>`
        : '',
    );
    patch(
      dz('dsw'),
      `${sw(s.enabled, `data-on="${esc(s.id)}"`, `${s.label} proposé aux viewers`)}<span>${s.enabled ? 'Proposé' : 'Coupé'}</span>`,
    );
    patch(
      dz('dmode'),
      seg(
        'data-mode',
        Object.entries(MODES).map(([k, v]) => [k, v.label] as const),
        s.playback_mode,
      ),
    );
    patch(
      dz('dhint'),
      [
        fileOf(s),
        s.duration_ms ? secs(s.duration_ms) : '',
        s.variants > 1
          ? `${s.variants} variantes, une tirée à chaque achat (l’écoute joue la première)`
          : '',
        MODES[s.playback_mode].hint,
      ]
        .filter(Boolean)
        .map(esc)
        .join(' · '),
    );
  }
  const liveRow = (i: Item, kind: 'play' | 'wait' | 'past') => ({
    key: i.interaction_id,
    html: `<div class="sb-r d-in ${kind}"><button type="button" class="sb-r__m" data-item="${esc(i.interaction_id)}">${pp(i.viewer_display_name, 28)}<b>${esc(i.sound_label ?? i.detail ?? '')}</b><small>${kind === 'play' ? '<i class="sb-eq"><u></u><u></u><u></u></i>' : kind === 'past' ? esc(statusText(i)) : i.duration_ms ? clock(i.duration_ms / 1000) : ''}</small><p>${esc(i.viewer_display_name)} · ${esc(money(i))}</p></button>${kind === 'past' ? '' : `<button type="button" class="d-ib sb-r__x" data-more="${esc(i.interaction_id)}" aria-label="Décider pour ${esc(i.sound_label ?? i.viewer_display_name)}">${ic('more')}</button>`}</div>`,
  });
  function paintLive() {
    const on = q?.playing ?? [];
    const w = q?.waiting ?? [];
    patch(
      z('lhead'),
      seg(
        'data-list',
        [
          ['file', `En cours ${on.length} · File ${w.length}`],
          ['past', 'Déjà joués'],
        ],
        tab,
      ),
    );
    if (tab === 'file')
      keyed(
        z('llist'),
        [
          ...on.map((i) => liveRow(i, 'play')),
          ...(on.length && w.length
            ? [
                {
                  key: 'sep',
                  html: '<div class="d-lb sb-sep">En attente</div>',
                },
              ]
            : []),
          ...w.map((i) => liveRow(i, 'wait')),
        ],
        `<div class="d-empty">${qError ? esc(qError) : 'Aucun son pour l’instant.'}</div>`,
      );
    else
      keyed(
        z('llist'),
        (past ?? q?.recent ?? []).map((i) => liveRow(i, 'past')),
        '<div class="d-empty">Aucun son pendant ce stream.</div>',
      );
    patch(
      z('lfoot'),
      tab === 'file'
        ? `${on.length ? `<button type="button" class="d-btn bad sm" data-stopall>${ic('stop')}Couper tous les sons…</button>` : ''}${w.length ? `<button type="button" class="d-btn bad sm" data-purge>${ic('trash')}Vider la file…</button>` : ''}`
        : '',
    );
  }
  function paintPanel() {
    const prot = cfg?.settings.volume_protection ?? 'light';
    p.panel.set(`${grp(
      'Protection du volume',
      'vol',
      `<div class="d-row col" data-k="protection volume superposition baisse rafale mix">${seg(
        'data-protect',
        Object.entries(PROTECTIONS).map(([k, v]) => [k, v.label] as const),
        prot,
        'block',
      )}<small>${esc(PROTECTIONS[prot].hint)}</small></div>`,
      'mix',
    )}
    ${grp(
      'Lecteur',
      'sound',
      `${row('État', stateChip(status?.ready ? '' : 'w', status?.ready ? 'Prêt' : status?.enabled ? 'Absent' : 'Non lancé'), 'lecteur player')}
       <div class="d-row col" data-k="lecteur son sortie audio"><small>Les sons achetés sont joués sur la sortie audio par défaut de ce PC. ${production ? 'Le lecteur se charge au lancement de Studio.' : 'Dans le Lab, un seul lecteur à la fois : un second ne jouerait rien.'}</small></div>`,
      'source',
    )}
    ${grp(
      'Médias',
      'upload',
      `<div class="d-row col" data-k="ajouter remplacer média fichier mp3"><small>La liste des sons et leurs fichiers sont livrés avec Raptoru et l’extension Twitch. Ajouter ou remplacer un fichier depuis Studio n’est pas encore possible.</small></div>`,
    )}`);
  }
  function paint() {
    paintHead();
    paintPlayer();
    paintTools();
    paintList();
    paintDeck();
    paintLive();
    paintPanel();
  }

  // --- Enregistrer ------------------------------------------------------------------------------------------------------
  function replace(s: Sound) {
    const i = cfg!.sounds.findIndex((x) => x.id === s.id);
    if (i >= 0) cfg!.sounds[i] = s;
  }
  const said = (s: Sound, f: Field) =>
    f === 'token_cost'
      ? `${s.label} : ${fmt(s.token_cost)} Jetons`
      : f === 'credit_cost'
        ? `${s.label} : ${fmt(s.credit_cost)} crédits`
        : f === 'cooldown_ms'
          ? `${s.label} : délai de ${secs(s.cooldown_ms)}`
          : '';
  async function send(id: string, f: Field, value: unknown) {
    return postJson<Sound>(`/api/sound-lab/sounds/${encodeURIComponent(id)}`, {
      [f]: value,
    });
  }
  function flash(text: string) {
    const el = z('deck').querySelector<HTMLElement>('[data-z="saved"]');
    if (el) el.textContent = text;
  }
  async function commit(id: string, f: Field, value: unknown) {
    const key = `${id}:${f}`;
    const old = before.get(key);
    before.delete(key);
    if (value === old) return;
    const s = sound(id)!;
    flash('Enregistrement…');
    try {
      const fresh = await send(id, f, value);
      replace(fresh);
      flash('Enregistré');
      setTimeout(() => flash(''), 1800);
      refreshExtension();
      const text = said(fresh, f);
      if (text)
        toast(`${text}, appliqué aux prochains achats`, {
          undo: () =>
            void send(id, f, old).then(
              (back) => {
                replace(back);
                refreshExtension();
                paintList();
                paintDeck();
              },
              (e) => toast(errText(e, REFUS), { bad: true }),
            ),
        });
    } catch (e) {
      (s as unknown as Record<string, unknown>)[f] = old;
      flash('');
      toast(errText(e, REFUS), { bad: true });
    }
    paintList();
    paintDeck();
    paintTools();
  }
  /** Le champ suit la main tout de suite ; la valeur part une fois posée. */
  function edit(id: string, f: Field, value: unknown, wait = 500) {
    const s = sound(id);
    if (!s) return;
    const key = `${id}:${f}`;
    if (!before.has(key)) before.set(key, s[f]);
    (s as unknown as Record<string, unknown>)[f] = value;
    clearTimeout(timers.get(key));
    if (wait)
      timers.set(
        key,
        setTimeout(() => void commit(id, f, value), wait),
      );
    else void commit(id, f, value);
  }
  function setVolume(id: string, v: number) {
    edit(id, 'volume', v);
    if (audio && audioId === id) audio.volume = v / 100;
    paintDeck();
  }
  async function setCategory(id: string, name: string | null) {
    try {
      const r = await postJson<{ categories: Record<string, string> }>(
        '/api/sound-lab/library',
        { sound_id: id, category: name },
      );
      library = r.categories;
      if (cat && !cats().includes(cat)) cat = null;
      paint();
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  }
  function pickCategory(b: HTMLElement, s: Sound) {
    const names = cats();
    const el = pop(
      b,
      `<h3>Catégorie de ${esc(s.label)}</h3>
      ${names.length ? `<div class="d-tags">${names.map((n) => `<button type="button" class="d-tag ${library?.[s.id] === n ? 'ok' : ''}" data-c="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <form data-newcat><label class="d-fld"><input type="text" maxlength="24" placeholder="Nouvelle catégorie" aria-label="Nouvelle catégorie"></label></form>
      ${library?.[s.id] ? '<button type="button" class="d-btn ghost sm" data-none>Retirer de sa catégorie</button>' : ''}
      <p class="d-note">Pour ranger la banque dans Studio : les viewers ne voient pas les catégories.</p>`,
      undefined,
      { cls: 'd-form' },
    );
    const done = (name: string | null) => {
      el.hidePopover();
      void setCategory(s.id, name);
    };
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (t?.dataset.c) done(t.dataset.c);
      if (t?.matches('[data-none]')) done(null);
    });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = el.querySelector('input')!.value.trim();
      if (v) done(v);
    });
  }
  function mediaInfo(b: HTMLElement, add: boolean) {
    pop(
      b,
      `<h3>${add ? 'Ajouter un son' : 'Remplacer le fichier'}</h3>
      <p class="d-note">Pas encore disponible. La liste des sons et leurs fichiers sont livrés avec Raptoru et l’extension Twitch : un fichier déposé ici n’existerait ni à l’achat, ni dans l’aperçu des viewers.</p>`,
      undefined,
      { cls: 'd-form' },
    );
  }
  const findItem = (id: string) =>
    [
      ...(q?.playing ?? []),
      ...(q?.waiting ?? []),
      ...(past ?? []),
      ...(q?.recent ?? []),
    ].find((i) => i.interaction_id === id);
  /** Rend au détail ce que `isPlaying` regarde pour ce module. */
  const asSound = (i: Item) => ({ ...i, module: 'soundboard' as const });

  // --- Interaction ------------------------------------------------------------------------------------------------------
  function pick(id: string) {
    picked = id;
    paintList();
    paintDeck();
  }
  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    const st = b?.dataset.state as 'active' | 'paused' | 'disabled' | undefined;
    if (st) return void setModuleState(b!, 'soundboard', st, q?.waiting ?? []);
    const list = b?.dataset.list as 'file' | 'past' | undefined;
    if (list) {
      tab = list;
      if (list === 'past') void readPast();
      return paintLive();
    }
    const item = b?.dataset.item;
    if (item) {
      const i = findItem(item);
      if (i) openItem(asSound(i), 'soundboard');
      return;
    }
    const more = b?.dataset.more;
    if (more) {
      const i = findItem(more);
      if (i) removeMenu(b!, asSound(i), 'soundboard');
      return;
    }
    if (b?.matches('[data-purge]'))
      return void purge(b, 'soundboard', q?.waiting ?? []);
    if (b?.matches('[data-stopall]')) return void stopAll(b, q?.playing ?? []);
    if (b?.matches('[data-start]') && status?.playerUrl)
      return startPlayer(status.playerUrl);
    if (b?.matches('[data-frame]')) {
      frameOpen = !frameOpen;
      return paintPlayer();
    }
    const prot = b?.dataset.protect as Protection | undefined;
    if (prot) {
      void postJson<Config['settings']>('/api/sound-lab/settings', {
        volume_protection: prot,
      }).then(
        (settings) => {
          cfg!.settings = settings;
          paintPanel();
        },
        (err) => toast(errText(err, REFUS), { bad: true }),
      );
      return;
    }
    const v = b?.dataset.view as typeof view | undefined;
    if (v) {
      view = v;
      paintTools();
      return paintList();
    }
    const chip = b?.dataset.chip;
    if (chip !== undefined) {
      cat = chip === '*' ? null : chip;
      paintTools();
      return paintList();
    }
    const sk = b?.dataset.sort as SortKey | undefined;
    if (sk) {
      sort =
        sort.key === sk && sk !== 'bank'
          ? { key: sk, dir: sort.dir > 0 ? -1 : 1 }
          : { key: sk, dir: 1 };
      paintTools();
      return paintList();
    }
    if (b?.dataset.media) return mediaInfo(b, b.dataset.media === 'add');
    const s = sound(picked);
    if (b?.matches('[data-catpick]') && s) return pickCategory(b, s);
    if (b?.matches('[data-resetname]') && s) {
      before.set(`${s.id}:label`, s.label);
      void commit(s.id, 'label', null);
      return;
    }
    if (b?.matches('[data-dplay]') && picked) return listen(picked);
    const mode = b?.dataset.mode as Mode | undefined;
    if (mode && s) {
      edit(s.id, 'playback_mode', mode, 0);
      return paintDeck();
    }
    const play = b?.dataset.play;
    if (play) {
      listen(play);
      return pick(play);
    }
    const seek = t.closest<HTMLElement>('[data-seek]');
    if (seek && picked) {
      const r = seek.getBoundingClientRect();
      return listen(picked, Math.max(0.0001, (e.clientX - r.left) / r.width));
    }
    const line = t.closest<HTMLElement>('[data-row]');
    if (line && !t.closest('input,.d-sw')) pick(line.dataset.row!);
  });
  p.root.addEventListener('change', (e) => {
    const i = e.target as HTMLInputElement;
    if (i.dataset.on) {
      edit(i.dataset.on, 'enabled', i.checked, 0);
      paintList();
      paintDeck();
      paintTools();
    }
  });
  p.root.addEventListener('input', (e) => {
    const i = e.target as HTMLInputElement;
    if (i === find) return paintList();
    if (i.dataset.rvol) return setVolume(i.dataset.rvol, Number(i.value));
    const f = i.dataset.f as Field | undefined;
    if (!f || !picked) return;
    if (f === 'volume') return setVolume(picked, Number(i.value));
    if (f === 'label') return edit(picked, f, i.value);
    if (i.value.trim() === '') return;
    edit(
      picked,
      f,
      Math.round(Number(i.value) * (f === 'cooldown_ms' ? 1000 : 1)),
    );
  });
  // Dans la banque : flèches pour parcourir, Espace pour écouter.
  z('list').addEventListener('keydown', (e) => {
    const line = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (!line || (e.target as HTMLElement).matches('input')) return;
    if (e.key === ' ') {
      e.preventDefault();
      return listen(line.dataset.row!);
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = (
      e.key === 'ArrowDown'
        ? line.nextElementSibling
        : line.previousElementSibling
    ) as HTMLElement | null;
    if (!next?.dataset.row) return;
    pick(next.dataset.row);
    z('list')
      .querySelector<HTMLElement>(
        `[data-pick="${CSS.escape(next.dataset.row)}"]`,
      )
      ?.focus();
  });
  scrub(p.root, (i) => i.dispatchEvent(new Event('input', { bubbles: true })));

  return {
    setVisible(v: boolean) {
      if (v) {
        void readConfig();
        tick.start();
      } else {
        tick.stop();
        stopAudio();
      }
    },
  };
}
