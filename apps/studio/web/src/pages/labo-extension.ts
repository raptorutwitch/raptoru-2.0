import { mountBonkLab } from '../bonk-lab.js';
import { ic, page, patch, seg, sw, type IcName } from '../ds/ds.js';
import { mountSoundLab } from '../sound-lab.js';
import { mountTtsLab } from '../tts-lab.js';
import { silhouette, SURFACES, type SurfaceId } from './labo-surfaces.js';

// Extension Lab: the production Twitch extension (served as is by the Studio server under /ext/) in realistic Twitch frames, with a
// simulated Twitch context and a local Lab EBS. Accepted actions are played on the local stage (sound, TTS voice, Bonk, raffle).
// Fictitious jetons only: the extension frames can only reach this Studio (CSP), never the production EBS. Au centre l'extension à sa
// vraie taille, au-dessus la surface et le contexte simulé, à droite la scène, l'état du Lab, le journal et les lecteurs.

type Role = 'viewer' | 'moderator' | 'broadcaster';
type VideoViewport = 'twitch' | 'reference75';

interface LabEvent {
  seq: number;
  at: string;
  kind: string;
  viewer: string;
  role: Role;
  currency: string;
  cost: number;
  detail: string;
  effect: { url?: string | null; text?: string; label?: string; mark?: string };
}

interface LabState {
  wallets: Record<Role, number>;
  modules: Record<string, boolean>;
  raffle: {
    open: boolean;
    endsInSeconds: number;
    participants: number;
    /** Tombola V2 in Core: closed, waiting for its draw. */
    waitingDraw?: boolean;
    core?: boolean;
  };
  tts: { mode: string; paused: boolean; pending: number };
  lastSeq: number;
  events: LabEvent[];
}

/** Twitch console settings of Raptoru Live (asset hosting). */
const TWITCH = {
  panelHeight: 496,
  panelWidth: 318,
  /** Icon column Twitch keeps next to a video component (decor only: not part of the viewport). */
  videoReservedColumn: 48,
};

/** Video Component viewports MEASURED on Twitch (CSS px of the extension iframe, HUD of the calibration
 *  build, docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md). The iframe gets exactly this logical size: no
 *  zoom, no formula. `share` = Height Target, used only to draw the Twitch decor (16:9 player). */
const VIDEO_VIEWPORTS: Record<
  VideoViewport,
  { label: string; width: number; height: number; share: number; note: string }
> = {
  twitch: {
    label: 'Twitch réel',
    width: 565,
    height: 376,
    share: 0.65,
    note: '65 % · 3:2 · dimensions automatiques OFF · mesuré le 14/10/2026',
  },
  reference75: {
    label: 'Comparaison 75 %',
    width: 651,
    height: 434,
    share: 0.75,
    note: 'ancienne référence visuelle, plus la cible',
  },
};

const PHONES = {
  small: { label: 'Petit (360×780)', width: 360, height: 780 },
  standard: { label: 'Standard (390×844)', width: 390, height: 844 },
  large: { label: 'Grand (430×932)', width: 430, height: 932 },
} as const;

const ROLES: Record<Role, string> = {
  viewer: 'Viewer',
  moderator: 'Modérateur',
  broadcaster: 'Broadcaster',
};

const MODULE_LABELS: Record<string, string> = {
  tts: 'TTS',
  soundboard: 'Soundboard',
  bonk: 'Bonk',
  raffle_join: 'Tombola',
};

const INS_KEY = 'raptoru-ext-lab-inspector';
const KIND_ICON: Record<string, IcName> = {
  soundboard: 'sound',
  tts: 'chat',
  tts_submitted: 'clock',
  bonk: 'sparkle',
  raffle_join: 'ticket',
  moderation: 'mod',
  refused: 'ban',
};

const api = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-raptoru-studio': '1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const stored = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export function mountExtensionLab(root: HTMLElement): {
  setVisible(v: boolean): void;
} {
  const ui = {
    surface: 'panel' as SurfaceId,
    role: 'viewer' as Role,
    identity: true,
    video: 'twitch' as VideoViewport,
    phone: 'standard' as keyof typeof PHONES,
    sound: false,
    volume: 0.6,
    inspector: stored(INS_KEY) !== '0',
  };
  // Deep link: ?tab=extension-lab&surface=video&role=moderator&identity=0
  const link = new URLSearchParams(location.search);
  if (link.get('surface') && link.get('surface')! in SURFACES)
    ui.surface = link.get('surface') as SurfaceId;
  if (link.get('role') && link.get('role')! in ROLES)
    ui.role = link.get('role') as Role;
  if (link.get('identity') === '0') ui.identity = false;
  if (link.get('video') && link.get('video')! in VIDEO_VIEWPORTS)
    ui.video = link.get('video') as VideoViewport;
  let lastSeq = -1;
  let visible = false;
  let polling: ReturnType<typeof setTimeout> | undefined;
  let state: LabState | null = null;

  const p = page(root, { title: 'Extension Lab', mod: 'rewards' });
  p.actions.innerHTML = `<span class="xl-acts"><span data-group="role"></span><label class="xl-id">${sw(ui.identity, 'data-id="identity"', 'Identité Twitch partagée')}Identité partagée</label><button type="button" class="d-btn sm" data-id="reload">${ic('repeat')}Recharger</button><a class="d-btn sm ghost" data-id="open" target="_blank" rel="noopener">${ic('external')}Ouvrir seule</a><button type="button" class="d-btn sm ${ui.inspector ? 'on' : 'ghost'}" data-id="ins">${ic('layers')}Coulisses</button></span>`;
  p.body.innerHTML = `<div class="xl${ui.inspector ? '' : ' no-ins'}">
    <div class="xl-bar"><div class="xl-surfaces" data-group="surface"></div><div data-id="surface-options"></div></div>
    <section class="xl-main">
      <div class="xl-stage" data-id="stage"></div>
      <footer class="xl-ctx" data-id="context"></footer>
      <div class="xl-toast" data-id="toast" hidden></div>
    </section>
    <aside class="xl-ins">
      <section>
        <header><h2 class="d-lb">Scène locale</h2><button type="button" data-id="sound" class="d-btn sm ghost">${ic('vol')}Son coupé</button></header>
        <div class="xl-screen" data-id="screen"><span class="xl-idle">Ce que le stream afficherait : sons, voix, Bonk, Tombola.</span></div>
      </section>
      <section data-id="controls"></section>
      <section class="xl-logbox">
        <header><h2 class="d-lb">Journal</h2><button type="button" data-id="reset" class="d-btn sm ghost">Réinitialiser le Lab</button></header>
        <ol class="xl-log" data-id="log"></ol>
      </section>
      <details class="d-acc xl-players" open><summary>Lecteurs du Lab</summary><div data-id="players"></div></details>
    </aside>
  </div>`;

  const players = root.querySelector<HTMLElement>('[data-id="players"]')!;
  const ttsLab = mountTtsLab(players);
  const bonkLab = mountBonkLab(players);
  const soundLab = mountSoundLab(players);

  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<T>(`[data-id="${id}"]`)!;

  // --- left: choices ------------------------------------------------------------------------------

  function renderChoices() {
    patch(
      root.querySelector<HTMLElement>('[data-group="surface"]'),
      (Object.keys(SURFACES) as SurfaceId[])
        .map(
          (id) =>
            `<button type="button" data-surface="${id}" class="${id === ui.surface ? 'on' : ''}" title="${esc(SURFACES[id].hint)}" aria-pressed="${id === ui.surface}"><span>${silhouette(id, 24, 26)}</span><b>${SURFACES[id].label}</b></button>`,
        )
        .join(''),
    );
    patch(
      root.querySelector<HTMLElement>('[data-group="role"]'),
      seg('data-role', Object.entries(ROLES), ui.role),
    );
    patch(
      $('surface-options'),
      ui.surface === 'video'
        ? seg(
            'data-video',
            (Object.keys(VIDEO_VIEWPORTS) as VideoViewport[]).map((v) => [
              v,
              `${VIDEO_VIEWPORTS[v].label} · ${VIDEO_VIEWPORTS[v].width}×${VIDEO_VIEWPORTS[v].height}`,
            ]),
            ui.video,
          )
        : ui.surface === 'mobile'
          ? seg(
              'data-phone',
              (Object.keys(PHONES) as (keyof typeof PHONES)[]).map((k) => [
                k,
                PHONES[k].label,
              ]),
              ui.phone,
            )
          : '',
    );
  }

  function frameUrl(): string {
    const surface = SURFACES[ui.surface];
    const params = new URLSearchParams({
      ...surface.params,
      state: 'released',
      language: 'fr',
      locale: 'fr-FR',
      popout: 'false',
      ...(surface.params.popout ? { popout: surface.params.popout } : {}),
      labRole: ui.role,
      labIdentity: ui.identity ? '1' : '0',
    });
    return `/ext/${surface.page}?${params}`;
  }

  // --- center: realistic frames ------------------------------------------------------------------

  function renderStage() {
    const url = frameUrl();
    const stage = $('stage');
    $<HTMLAnchorElement>('open').href = url;
    const iframe = (w: number, h: number, extra = '') =>
      `<iframe title="Extension Raptoru Live" src="${esc(url)}" style="width:${w}px;height:${h}px" ${extra}></iframe>`;
    let dims: string;

    if (ui.surface === 'panel') {
      dims = `${TWITCH.panelWidth} × ${TWITCH.panelHeight} px`;
      stage.innerHTML = `<div class="tw-channel">
        <div class="tw-player-mini">Player Twitch</div>
        <div class="tw-panels">
          <div class="tw-panel tw-panel--ghost">À propos</div>
          <div class="tw-panel-ext">${iframe(TWITCH.panelWidth, TWITCH.panelHeight)}</div>
          <div class="tw-panel tw-panel--ghost">Réseaux</div>
        </div></div>`;
    } else if (ui.surface === 'window') {
      dims = '1100 × 720 px';
      stage.innerHTML = `<div class="tw-window"><div class="tw-window-bar">Raptoru Live · pop-out (Moderator Window)</div>${iframe(1100, 720)}</div>`;
    } else if (ui.surface === 'mobile') {
      const phone = PHONES[ui.phone];
      const playerH = Math.round((phone.width * 9) / 16);
      const extH = phone.height - 28 - playerH - 40;
      dims = `${phone.width} × ${extH} px (sous un player ${phone.width} × ${playerH})`;
      stage.innerHTML = `<div class="tw-phone" style="width:${phone.width}px;height:${phone.height}px">
        <div class="tw-phone-status">20:42 ▪ ▪ ▪</div>
        <div class="tw-phone-player" style="height:${playerH}px">▶ Live</div>
        <div class="tw-phone-tabs"><span>Chat</span><span class="on">Raptoru Live</span></div>
        ${iframe(phone.width, extH)}
      </div>`;
    } else if (ui.surface === 'video') {
      // The iframe gets the measured logical size itself (real breakpoints, 1 CSS px = 1 px on
      // screen): never a transform. Around it, an approximate Twitch decor (16:9 player whose Height
      // Target gives this viewport), cropped on its video side when the stage is narrower.
      const vp = VIDEO_VIEWPORTS[ui.video];
      const playerH = Math.round(vp.height / vp.share);
      const playerW = Math.round((playerH * 16) / 9);
      const column = TWITCH.videoReservedColumn;
      dims = `Viewport logique : ${vp.width}×${vp.height}`;
      const frame = stage.querySelector<HTMLIFrameElement>(
        '.tw-component iframe',
      );
      const caption = `<b>Viewport logique : ${vp.width}×${vp.height}</b> · ${esc(vp.note)} · iframe à taille réelle, sans zoom.
        Décor Twitch approximatif autour (player ${playerW}×${playerH}, colonne d’icônes ${column} px), hors viewport.`;
      if (
        stage.dataset.surface === 'video' &&
        frame?.getAttribute('src') === url
      ) {
        // Same extension instance: only its logical size changes (real resize in the iframe).
        frame.style.width = `${vp.width}px`;
        frame.style.height = `${vp.height}px`;
        Object.assign(stage.querySelector<HTMLElement>('.tw-player')!.style, {
          width: `${playerW}px`,
          height: `${playerH}px`,
          minWidth: `${vp.width + column + 16}px`,
        });
        Object.assign(
          stage.querySelector<HTMLElement>('.tw-component')!.style,
          {
            width: `${vp.width}px`,
            height: `${vp.height}px`,
          },
        );
        stage.querySelector('.tw-viewport-tag')!.textContent =
          `Extension · ${vp.width}×${vp.height}`;
        stage.querySelector('.tw-player-video')!.textContent =
          `Décor Twitch · player ${playerW}×${playerH}`;
        stage.querySelector('.xl-video-caption')!.innerHTML = caption;
      } else {
        stage.innerHTML = `<div class="tw-player" style="width:${playerW}px;height:${playerH}px;min-width:${vp.width + column + 16}px">
          <div class="tw-player-video">Décor Twitch · player ${playerW}×${playerH}</div>
          <div class="tw-component" style="width:${vp.width}px;height:${vp.height}px;right:${column}px">
            <span class="tw-viewport-tag">Extension · ${vp.width}×${vp.height}</span>${iframe(vp.width, vp.height, 'allowtransparency="true"')}</div>
          <div class="tw-component-column" style="width:${column}px"><i>ϟ</i><i>★</i><i>⋯</i></div>
        </div>
        <p class="d-note xl-video-caption">${caption}</p>`;
      }
    } else if (ui.surface === 'config') {
      dims = '860 × 720 px';
      stage.innerHTML = `<div class="tw-window"><div class="tw-window-bar">Extensions › Raptoru Live › Configuration</div>${iframe(860, 720)}</div>`;
    } else {
      dims = '340 × 640 px';
      stage.innerHTML = `<div class="tw-dashboard"><div class="tw-dashboard-main">Gestionnaire de stream</div>
        <div class="tw-window"><div class="tw-window-bar">Raptoru Live · configuration en direct</div>${iframe(340, 640)}</div></div>`;
    }

    stage.dataset.surface = ui.surface;
    $('context').innerHTML = `
      <span class="d-tag ext">Lab local · Jetons fictifs · aucun appel réel</span>
      <span class="d-tag" title="Bonk, sons et TTS achetés ici passent par les lecteurs de Studio : s’ils sont ouverts dans OBS, ils s’affichent et s’entendent sur le vrai OBS (aucun Jeton réel).">Joue sur OBS si ses lecteurs y sont ouverts</span>
      <span class="d-tag">${dims}</span>
      <span class="d-tag">${ROLES[ui.role]}${ui.identity ? '' : ' · identité non partagée'}</span>
      <code title="${esc(url)}">${esc(url)}</code>`;
  }

  // --- right: lab state & stage -------------------------------------------------------------------

  function renderControls() {
    if (!state) return;
    const s = state;
    $('controls').innerHTML = `
      <header><h2 class="d-lb">État du Lab</h2></header>
      <div class="xl-wallets">${(Object.keys(ROLES) as Role[])
        .map(
          (r) =>
            `<label class="d-row"><span>${ROLES[r]}</span><span class="d-fld"><input type="number" min="0" step="500" value="${s.wallets[r]}" data-wallet="${r}"><span>J</span></span></label>`,
        )
        .join('')}</div>
      <div class="xl-mods">${Object.keys(MODULE_LABELS)
        .map(
          (m) =>
            `<label class="d-row"><span>${MODULE_LABELS[m]}</span>${sw(!!s.modules[m], `data-module="${m}"`, MODULE_LABELS[m]!)}</label>`,
        )
        .join('')}</div>
      <div class="xl-raffle">
        <p>Tombola${s.raffle.core ? '' : ' (locale)'} : <b>${s.raffle.open ? `ouverte (${s.raffle.endsInSeconds} s, ${s.raffle.participants} inscrit·s)` : s.raffle.waitingDraw ? 'fermée · à tirer' : 'fermée'}</b></p>
        <div class="xl-row">
          ${s.raffle.core ? '<label class="d-fld" title="Cagnotte"><input type="number" data-id="raffle-jackpot" value="5000" min="0" step="500" aria-label="Cagnotte"><span>J</span></label>' : ''}
          <button type="button" class="d-btn sm" data-control="raffle-open" ${s.raffle.open ? 'disabled' : ''}>Ouvrir 60 s</button>
          <button type="button" class="d-btn sm" data-control="raffle-draw" ${s.raffle.participants || s.raffle.waitingDraw ? '' : 'disabled'}>Tirer</button>
          <button type="button" class="d-btn sm ghost" data-control="raffle-close" ${s.raffle.open ? '' : 'disabled'}>Fermer</button>
        </div>
      </div>
      <p class="d-note">TTS : ${s.tts.mode === 'approval' ? 'validation avant lecture' : 'lecture instantanée'}${s.tts.paused ? ' · en pause' : ''}${s.tts.pending ? ` · ${s.tts.pending} en attente` : ''}</p>`;
  }

  function logEvent(e: LabEvent) {
    const li = document.createElement('li');
    const cost = e.cost
      ? ` · ${e.cost.toLocaleString('fr-FR')} ${e.currency === 'channelpoints' ? 'points' : 'jetons'}`
      : '';
    li.innerHTML = `${ic(KIND_ICON[e.kind] ?? 'pulse')}
      <span><b>${esc(e.viewer)}</b> ${esc(e.kind)}${cost}<small>${esc(e.detail)}</small></span>
      <time>${new Date(e.at).toLocaleTimeString('fr-FR')}</time>`;
    $('log').prepend(li);
    while ($('log').children.length > 60) $('log').lastElementChild!.remove();
  }

  function screenShow(html: string, className: string, ms = 3500) {
    const screen = $('screen');
    screen.querySelector('.xl-idle')?.remove();
    const node = document.createElement('div');
    node.className = `xl-fx ${className}`;
    node.innerHTML = html;
    screen.append(node);
    setTimeout(() => node.remove(), ms);
  }

  function play(url: string) {
    if (!ui.sound) return;
    const audio = new Audio(url);
    audio.volume = ui.volume;
    void audio.play().catch(() => {});
  }

  function perform(e: LabEvent) {
    logEvent(e);
    if (e.kind === 'soundboard') {
      if (e.effect.url) play(`/ext/${e.effect.url}`);
      screenShow(
        `${ic('sound')} ${esc(e.effect.label)}<small>${esc(e.viewer)}</small>`,
        'xl-fx--sound',
      );
    } else if (e.kind === 'tts') {
      screenShow(
        `${ic('chat')} ${esc(e.effect.text)}<small>${esc(e.viewer)}</small>`,
        'xl-fx--tts',
        6000,
      );
      if (ui.sound && 'speechSynthesis' in window && e.effect.text) {
        const utterance = new SpeechSynthesisUtterance(e.effect.text);
        utterance.lang = 'fr-FR';
        utterance.volume = ui.volume;
        speechSynthesis.speak(utterance);
      }
    } else if (e.kind === 'bonk') {
      play('/ext/assets/sounds/punch-2.mp3');
      screenShow(
        `<span class="xl-mark">${esc(e.effect.mark)}</span><small>${esc(e.effect.label)} · ${esc(e.viewer)}</small>`,
        'xl-fx--bonk',
        1800,
      );
    } else if (e.kind === 'raffle_join') {
      screenShow(
        `${ic('ticket')} ${esc(e.viewer)} rejoint la Tombola`,
        'xl-fx--raffle',
      );
    } else if (e.kind === 'tts_submitted') {
      screenShow(
        `${ic('clock')} TTS en attente de validation<small>${esc(e.viewer)}</small>`,
        'xl-fx--muted',
      );
    }
  }

  async function poll() {
    clearTimeout(polling);
    if (!visible) return;
    try {
      const next = await api<LabState>(
        `/api/ext-lab/state?since=${Math.max(0, lastSeq)}`,
      );
      // First read: history is shown in the log but not replayed on the stage.
      for (const e of next.events) (lastSeq < 0 ? logEvent : perform)(e);
      lastSeq = next.lastSeq;
      const changed =
        JSON.stringify({ ...next, events: [] }) !==
        JSON.stringify({ ...state, events: [] });
      state = next;
      if (changed && !root.querySelector('.xl-ins input:focus'))
        renderControls();
    } catch {
      $('controls').innerHTML =
        '<p class="d-note bad">Serveur Studio injoignable : relance Raptoru Studio.</p>';
    }
    polling = setTimeout(poll, 1000);
  }

  // « Recharger » : a new extension instance (the video stage keeps its instance otherwise).
  const reloadFrames = () => {
    delete $('stage').dataset.surface;
    renderStage();
  };
  const refreshFrames = () =>
    root.querySelectorAll('iframe').forEach((f) =>
      f.contentWindow?.postMessage(
        {
          source: 'raptoru-studio-lab',
          type: 'broadcast',
          message: { type: 'lab_refresh' },
        },
        location.origin,
      ),
    );

  // Soundboard settings saved in Studio: the viewer frames reload their state at once.
  window.addEventListener('raptoru:lab-refresh', refreshFrames);

  function toast(html: string, ms = 5000) {
    const t = $('toast');
    t.innerHTML = html;
    t.hidden = false;
    setTimeout(() => (t.hidden = true), ms);
  }

  // --- events -----------------------------------------------------------------------------------

  root.addEventListener('click', async (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>(
      'button, a, [data-control]',
    );
    if (!target) return;
    const d = target.dataset;
    if (d.surface) {
      ui.surface = d.surface as SurfaceId;
      renderChoices();
      renderStage();
    } else if (d.role) {
      ui.role = d.role as Role;
      renderChoices();
      renderStage();
    } else if (d.video) {
      ui.video = d.video as VideoViewport;
      renderChoices();
      renderStage();
    } else if (d.phone) {
      ui.phone = d.phone as keyof typeof PHONES;
      renderChoices();
      renderStage();
    } else if (d.control) {
      await api(
        `/api/ext-lab/control/${d.control}`,
        d.control === 'raffle-open'
          ? {
              seconds: 60,
              jackpot: Number(
                root.querySelector<HTMLInputElement>(
                  '[data-id="raffle-jackpot"]',
                )?.value ?? 5000,
              ),
            }
          : {},
      );
      refreshFrames();
      void poll();
    } else if (d.id === 'reload') reloadFrames();
    else if (d.id === 'ins') {
      ui.inspector = !ui.inspector;
      root.querySelector('.xl')!.classList.toggle('no-ins', !ui.inspector);
      target.classList.toggle('on', ui.inspector);
      target.classList.toggle('ghost', !ui.inspector);
      try {
        localStorage.setItem(INS_KEY, ui.inspector ? '1' : '0');
      } catch {
        /* private mode: not remembered */
      }
    } else if (d.id === 'sound') {
      ui.sound = !ui.sound;
      target.innerHTML = `${ic('vol')}${ui.sound ? 'Son actif' : 'Son coupé'}`;
      target.classList.toggle('on', ui.sound);
      target.classList.toggle('ghost', !ui.sound);
    } else if (d.id === 'reset') {
      await api('/api/ext-lab/control/reset', {});
      $('log').innerHTML = '';
      reloadFrames();
      void poll();
    } else if (d.id === 'accept-identity') {
      ui.identity = true;
      $<HTMLInputElement>('identity').checked = true;
      $('toast').hidden = true;
      renderStage();
    }
  });

  root.addEventListener('change', async (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.dataset.id === 'identity') {
      ui.identity = input.checked;
      renderStage();
    } else if (input.dataset.wallet) {
      await api('/api/ext-lab/control/wallet', {
        role: input.dataset.wallet,
        amount: Math.max(0, Math.round(Number(input.value) || 0)),
      });
      refreshFrames();
    } else if (input.dataset.module) {
      await api('/api/ext-lab/control/module', {
        id: input.dataset.module,
        enabled: input.checked,
      });
      refreshFrames();
    }
  });

  // Messages of the local Twitch helper inside the frames (same origin only).
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || ev.data?.source !== 'raptoru-ext-lab')
      return;
    if (ev.data.type === 'requestIdShare')
      toast(
        `L’extension demande le partage d’identité Twitch. <button type="button" data-id="accept-identity" class="d-btn pri sm">Accepter</button>`,
        10000,
      );
    else if (ev.data.type === 'minimize')
      toast('L’extension a demandé à se réduire (actions.minimize).');
  });

  renderChoices();
  // Production profile (ASTRA-P1-019 lot 2): the Extension Lab preview does not exist there (no Lab
  // façade); say so instead of showing an empty or outdated extension. Reversible (back to Lab).
  const blocked = document.createElement('p');
  blocked.className = 'd-empty';
  blocked.style.display = 'none';
  blocked.textContent =
    'Extension Lab : profil Lab uniquement. En Production, l’extension Twitch parle directement au serveur. Les réglages sont dans chaque module (TTS, Soundboard, Bonk, Tombola) et en Modération.';
  p.body.prepend(blocked);
  async function checkProfile() {
    try {
      const res = await fetch('/api/profile', {
        headers: { 'x-raptoru-studio': '1' },
      });
      const production =
        res.ok &&
        ((await res.json()) as { effective?: string }).effective ===
          'production';
      blocked.style.display = production ? '' : 'none';
      // A CSS display rule would override `hidden` on the layout: set it inline.
      root.querySelector<HTMLElement>('.xl')!.style.display = production
        ? 'none'
        : '';
    } catch {
      /* server restarting: keep the current view */
    }
  }

  return {
    setVisible(v: boolean) {
      if (v) void checkProfile();
      bonkLab.setVisible(v);
      soundLab.setVisible(v);
      ttsLab.setVisible(v);
      if (v === visible) return;
      visible = v;
      if (v) {
        if (!$('stage').innerHTML) renderStage();
        void poll();
      } else clearTimeout(polling);
    },
  };
}
