import { mountBonkLab } from './bonk-lab.js';
import { mountSoundLab } from './sound-lab.js';
import { mountTtsLab } from './tts-lab.js';
// Extension Lab: the production Twitch extension (served as is by the Studio server under /ext/)
// in realistic Twitch frames, with a simulated Twitch context and a local Lab EBS. Accepted actions
// are played on the local stage (sound, TTS voice, Bonk, raffle). Fictitious jetons only: the
// extension frames can only reach this Studio (CSP), never the production EBS.

type Role = 'viewer' | 'moderator' | 'broadcaster';
type SurfaceId =
  'panel' | 'window' | 'mobile' | 'video' | 'config' | 'live_config';
type VideoLayout = 'normal' | 'theatre' | 'fullscreen';

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
  videoTargetHeight: 0.6,
  videoRatio: 3 / 2,
  /** Icon column Twitch keeps next to a video component (measured on the live player). */
  videoReservedColumn: 48,
};

const SURFACES: Record<
  SurfaceId,
  {
    label: string;
    hint: string;
    page: string;
    params: Record<string, string>;
  }
> = {
  panel: {
    label: 'Panel viewer',
    hint: 'Sous le player, largeur 318 px, hauteur 496 px',
    page: 'panel.html',
    params: { anchor: 'panel', mode: 'viewer', platform: 'web' },
  },
  window: {
    label: 'Moderator Window',
    hint: 'Panel Twitch → Pop-out (fenêtre 1100 × 720) : console de modération D4',
    page: 'panel.html',
    params: {
      anchor: 'panel',
      mode: 'viewer',
      platform: 'web',
      popout: 'true',
    },
  },
  mobile: {
    label: 'Mobile viewer',
    hint: 'App Twitch mobile, onglet sous le player',
    page: 'mobile.html',
    params: { anchor: 'panel', mode: 'viewer', platform: 'mobile' },
  },
  video: {
    label: 'Video component',
    hint: '60 % de la hauteur du player, ratio 3:2',
    page: 'video_component.html',
    params: { anchor: 'component', mode: 'viewer', platform: 'web' },
  },
  config: {
    label: 'Config',
    hint: 'Gestionnaire d’extensions (broadcaster)',
    page: 'config.html',
    params: { mode: 'config', platform: 'web' },
  },
  live_config: {
    label: 'Live config',
    hint: 'Gestionnaire de stream, panneau latéral',
    page: 'config.html',
    params: { mode: 'dashboard', platform: 'web' },
  },
};

const PHONES = {
  small: { label: 'Petit (360×780)', width: 360, height: 780 },
  standard: { label: 'Standard (390×844)', width: 390, height: 844 },
  large: { label: 'Grand (430×932)', width: 430, height: 932 },
} as const;

/** Player sizes on a 1080p screen (CSS px), per Twitch layout. */
const PLAYERS: Record<
  VideoLayout,
  { label: string; width: number; height: number }
> = {
  normal: { label: 'Layout normal', width: 1280, height: 720 },
  theatre: { label: 'Mode théâtre', width: 1600, height: 900 },
  fullscreen: { label: 'Plein écran', width: 1920, height: 1080 },
};

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

export function mountExtensionLab(root: HTMLElement): {
  setVisible(v: boolean): void;
} {
  const ui = {
    surface: 'panel' as SurfaceId,
    role: 'viewer' as Role,
    identity: true,
    layout: 'normal' as VideoLayout,
    phone: 'standard' as keyof typeof PHONES,
    sound: false,
    volume: 0.6,
  };
  // Deep link: ?tab=extension-lab&surface=video&role=moderator&identity=0
  const link = new URLSearchParams(location.search);
  if (link.get('surface') && link.get('surface')! in SURFACES)
    ui.surface = link.get('surface') as SurfaceId;
  if (link.get('role') && link.get('role')! in ROLES)
    ui.role = link.get('role') as Role;
  if (link.get('identity') === '0') ui.identity = false;
  let lastSeq = -1;
  let visible = false;
  let polling: ReturnType<typeof setTimeout> | undefined;
  let state: LabState | null = null;

  root.innerHTML = `
    <div class="xlab">
      <aside class="xlab-side">
        <section>
          <h3>Surface Twitch</h3>
          <div class="xlab-surfaces" data-group="surface"></div>
        </section>
        <section>
          <h3>Contexte simulé</h3>
          <label class="xlab-label">Rôle</label>
          <div class="xlab-seg" data-group="role"></div>
          <label class="xlab-switch"><input type="checkbox" data-id="identity" ${ui.identity ? 'checked' : ''}> Identité Twitch partagée</label>
          <div data-id="surface-options"></div>
        </section>
        <section class="xlab-side-actions">
          <button type="button" class="primary" data-id="reload">↻ Recharger l’extension</button>
          <a class="xlab-link" data-id="open" target="_blank" rel="noopener">Ouvrir la page seule ↗</a>
        </section>
      </aside>

      <section class="xlab-main">
        <header class="xlab-context" data-id="context"></header>
        <div class="xlab-stage" data-id="stage"></div>
        <div class="xlab-toast" data-id="toast" hidden></div>
      </section>

      <aside class="xlab-scene">
        <section class="xlab-card">
          <div class="xlab-card-head">
            <h3>Scène locale</h3>
            <button type="button" data-id="sound" class="xlab-sound">🔇 Son coupé</button>
          </div>
          <p class="xlab-muted">Ce que le stream afficherait : sons, voix TTS, Bonk, tombola.</p>
          <div class="xlab-screen" data-id="screen"><span class="xlab-screen-idle">En attente d’une interaction…</span></div>
        </section>
        <section class="xlab-card" data-id="controls"></section>
        <section class="xlab-card xlab-log-card">
          <div class="xlab-card-head"><h3>Journal</h3><button type="button" data-id="reset" class="xlab-ghost">Réinitialiser le lab</button></div>
          <ol class="xlab-log" data-id="log"></ol>
        </section>
      </aside>
    </div>`;

  const soundLab = mountSoundLab(
    root.querySelector<HTMLElement>('.xlab-scene')!,
  );
  const bonkLab = mountBonkLab(root.querySelector<HTMLElement>('.xlab-scene')!);
  const ttsLab = mountTtsLab(root.querySelector<HTMLElement>('.xlab-scene')!);

  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<T>(`[data-id="${id}"]`)!;

  // --- left: choices ------------------------------------------------------------------------------

  function renderChoices() {
    root.querySelector('[data-group="surface"]')!.innerHTML = (
      Object.keys(SURFACES) as SurfaceId[]
    )
      .map(
        (
          id,
        ) => `<button type="button" data-surface="${id}" class="${id === ui.surface ? 'active' : ''}">
          <strong>${SURFACES[id].label}</strong><small>${SURFACES[id].hint}</small></button>`,
      )
      .join('');
    root.querySelector('[data-group="role"]')!.innerHTML = (
      Object.keys(ROLES) as Role[]
    )
      .map(
        (r) =>
          `<button type="button" data-role="${r}" class="${r === ui.role ? 'active' : ''}">${ROLES[r]}</button>`,
      )
      .join('');
    const options = $('surface-options');
    if (ui.surface === 'video') {
      options.innerHTML = `<label class="xlab-label">Taille du player</label><div class="xlab-seg">${(
        Object.keys(PLAYERS) as VideoLayout[]
      )
        .map(
          (l) =>
            `<button type="button" data-layout="${l}" class="${l === ui.layout ? 'active' : ''}">${PLAYERS[l].label}</button>`,
        )
        .join('')}</div>`;
    } else if (ui.surface === 'mobile') {
      options.innerHTML = `<label class="xlab-label">Téléphone</label><div class="xlab-seg xlab-seg--col">${(
        Object.keys(PHONES) as (keyof typeof PHONES)[]
      )
        .map(
          (p) =>
            `<button type="button" data-phone="${p}" class="${p === ui.phone ? 'active' : ''}">${PHONES[p].label}</button>`,
        )
        .join('')}</div>`;
    } else options.innerHTML = '';
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
      labLayout: ui.layout,
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
      const player = PLAYERS[ui.layout];
      const h = Math.round(player.height * TWITCH.videoTargetHeight);
      const w = Math.round(h * TWITCH.videoRatio - TWITCH.videoReservedColumn);
      dims = `${w} × ${h} px · 60 % de ${player.height} px · 3:2 moins ${TWITCH.videoReservedColumn} px de colonne Twitch`;
      const available = Math.max(320, stage.clientWidth - 24);
      const scale = Math.min(1, available / player.width);
      stage.innerHTML = `<div class="tw-player-scale" style="width:${player.width * scale}px;height:${player.height * scale}px">
        <div class="tw-player" style="width:${player.width}px;height:${player.height}px;transform:scale(${scale})">
          <div class="tw-player-video">Vidéo du live (${player.width} × ${player.height})</div>
          <div class="tw-component" style="width:${w}px;height:${h}px;right:${TWITCH.videoReservedColumn}px">${iframe(w, h, 'allowtransparency="true"')}</div>
          <div class="tw-component-column" style="width:${TWITCH.videoReservedColumn}px"><i>ϟ</i><i>★</i><i>⋯</i></div>
        </div></div>
        <p class="xlab-muted xlab-center">Aperçu réduit à ${Math.round(scale * 100)} % pour tenir à l’écran ; l’extension reçoit sa vraie taille en pixels.</p>`;
    } else if (ui.surface === 'config') {
      dims = '860 × 720 px';
      stage.innerHTML = `<div class="tw-window"><div class="tw-window-bar">Extensions › Raptoru Live › Configuration</div>${iframe(860, 720)}</div>`;
    } else {
      dims = '340 × 640 px';
      stage.innerHTML = `<div class="tw-dashboard"><div class="tw-dashboard-main">Gestionnaire de stream</div>
        <div class="tw-window"><div class="tw-window-bar">Raptoru Live · configuration en direct</div>${iframe(340, 640)}</div></div>`;
    }

    $('context').innerHTML = `
      <span class="xlab-pill xlab-pill--lab">LAB LOCAL · jetons fictifs · aucun appel prod</span>
      <span class="xlab-pill">${SURFACES[ui.surface].label}</span>
      <span class="xlab-pill">${dims}</span>
      <span class="xlab-pill">${ROLES[ui.role]}${ui.identity ? '' : ' · identité non partagée'}</span>
      <code class="xlab-url" title="${esc(url)}">${esc(url)}</code>`;
  }

  // --- right: lab state & stage -------------------------------------------------------------------

  function renderControls() {
    if (!state) return;
    const s = state;
    $('controls').innerHTML = `
      <div class="xlab-card-head"><h3>État du lab</h3><span class="xlab-muted">EBS local</span></div>
      <div class="xlab-wallets">${(Object.keys(ROLES) as Role[])
        .map(
          (r) =>
            `<label>${ROLES[r]}<span><input type="number" min="0" step="500" value="${s.wallets[r]}" data-wallet="${r}"> jetons</span></label>`,
        )
        .join('')}</div>
      <div class="xlab-modules">${Object.keys(MODULE_LABELS)
        .map(
          (m) =>
            `<label class="xlab-switch"><input type="checkbox" data-module="${m}" ${s.modules[m] ? 'checked' : ''}> ${MODULE_LABELS[m]}</label>`,
        )
        .join('')}</div>
      <div class="xlab-raffle">
        <span>Tombola${s.raffle.core ? ' (Core)' : ''} : <strong>${s.raffle.open ? `ouverte (${s.raffle.endsInSeconds} s, ${s.raffle.participants} inscrit·s)` : s.raffle.waitingDraw ? 'fermée · à tirer' : 'fermée'}</strong></span>
        <div class="xlab-row-btns">
          ${s.raffle.core ? '<label class="xlab-muted">Cagnotte <input type="number" data-id="raffle-jackpot" value="5000" min="0" step="500" style="width:6em"></label>' : ''}
          <button type="button" data-control="raffle-open" ${s.raffle.open ? 'disabled' : ''}>Ouvrir 60 s</button>
          <button type="button" data-control="raffle-draw" ${s.raffle.participants || s.raffle.waitingDraw ? '' : 'disabled'}>Tirer</button>
          <button type="button" data-control="raffle-close" ${s.raffle.open ? '' : 'disabled'}>Fermer</button>
        </div>
      </div>
      <p class="xlab-muted">TTS : ${s.tts.mode === 'approval' ? 'validation avant lecture' : 'lecture instantanée'}${s.tts.paused ? ' · en pause' : ''}${s.tts.pending ? ` · ${s.tts.pending} en attente` : ''}</p>`;
  }

  const KIND_ICON: Record<string, string> = {
    soundboard: '🔊',
    tts: '💬',
    tts_submitted: '⏳',
    bonk: '🔨',
    raffle_join: '🎟️',
    moderation: '🛡️',
    refused: '⛔',
  };

  function logEvent(e: LabEvent) {
    const li = document.createElement('li');
    const cost = e.cost
      ? ` · ${e.cost.toLocaleString('fr-FR')} ${e.currency === 'channelpoints' ? 'points' : 'jetons'}`
      : '';
    li.innerHTML = `<span class="xlab-log-icon">${KIND_ICON[e.kind] ?? '•'}</span>
      <span><strong>${esc(e.viewer)}</strong> ${esc(e.kind)}${cost}<br><small>${esc(e.detail)}</small></span>
      <time>${new Date(e.at).toLocaleTimeString('fr-FR')}</time>`;
    $('log').prepend(li);
    while ($('log').children.length > 60) $('log').lastElementChild!.remove();
  }

  function screenShow(html: string, className: string, ms = 3500) {
    const screen = $('screen');
    screen.querySelector('.xlab-screen-idle')?.remove();
    const node = document.createElement('div');
    node.className = `xlab-fx ${className}`;
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
        `🔊 ${esc(e.effect.label)}<small>${esc(e.viewer)}</small>`,
        'xlab-fx--sound',
      );
    } else if (e.kind === 'tts') {
      screenShow(
        `💬 ${esc(e.effect.text)}<small>${esc(e.viewer)}</small>`,
        'xlab-fx--tts',
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
        `<span class="xlab-bonk-mark">${esc(e.effect.mark)}</span><small>${esc(e.effect.label)} · ${esc(e.viewer)}</small>`,
        'xlab-fx--bonk',
        1800,
      );
    } else if (e.kind === 'raffle_join') {
      screenShow(`🎟️ ${esc(e.viewer)} rejoint la tombola`, 'xlab-fx--raffle');
    } else if (e.kind === 'tts_submitted') {
      screenShow(
        `⏳ TTS en attente de validation<small>${esc(e.viewer)}</small>`,
        'xlab-fx--muted',
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
      if (changed && !root.querySelector('.xlab-scene input:focus'))
        renderControls();
    } catch {
      $('controls').innerHTML =
        '<p class="xlab-error">Studio server injoignable : relance Raptoru Studio.</p>';
    }
    polling = setTimeout(poll, 1000);
  }

  const reloadFrames = () => renderStage();
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
      'button, [data-control]',
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
    } else if (d.layout) {
      ui.layout = d.layout as VideoLayout;
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
    else if (d.id === 'sound') {
      ui.sound = !ui.sound;
      target.textContent = ui.sound ? '🔊 Son actif' : '🔇 Son coupé';
      target.classList.toggle('on', ui.sound);
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
        `L’extension demande le partage d’identité Twitch. <button type="button" data-id="accept-identity" class="primary">Accepter</button>`,
        10000,
      );
    else if (ev.data.type === 'minimize')
      toast('L’extension a demandé à se réduire (actions.minimize).');
  });

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    if (!visible || ui.surface !== 'video') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderStage, 200);
  });

  renderChoices();
  return {
    setVisible(v: boolean) {
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
