// « Studio » tab: single entry point. Local runtime state (Postgres, base Lab, Core local, providers,
// OBS, players), module access and Dev/Lab tools. Talks only to the local Studio server; no secret.

import { mountControlCenter } from './control-center.js';
import { moduleFrame } from './module-frame.js';
import { mountStudioProfile } from './studio-profile.js';
import { mountTwitchConnections } from './twitch-connections.js';

type Service = {
  id: string;
  label: string;
  state: 'stopped' | 'starting' | 'ready' | 'degraded' | 'error';
  detail: string;
  since: string;
};
type RuntimeStatus = {
  enabled: boolean;
  packaged: boolean;
  dataRoot: string;
  services?: Service[];
  ports?: Record<string, number>;
  restartsInWindow?: number;
};
type BonkStatus = {
  enabled: boolean;
  obs?: boolean;
  sourceReady?: boolean;
  error?: string | null;
};
type SoundStatus = { enabled: boolean; ready?: boolean; error?: string | null };
type TtsStatus = {
  enabled: boolean;
  ready?: boolean;
  module_state?: string;
  error?: string | null;
  current?: {
    viewer_display_name: string;
    cast: { character_id: string };
  } | null;
  queue?: { waiting: unknown[]; wait_ms: number } | null;
};
type Prototypes = {
  available: boolean;
  items: { name: string; entry: string; updatedAt: string }[];
};
type LogLine = {
  seq: number;
  at: string;
  source: string;
  level: 'info' | 'error';
  text: string;
};

const HEADERS = { 'x-raptoru-studio': '1' };
/** Electron bridge (preload): restarts the Studio server even when its HTTP API is dead. */
const electronServer = (
  window as unknown as {
    raptoruStudio?: { server?: { restart(): Promise<unknown> } };
  }
).raptoruStudio?.server;
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
const BADGE: Record<Service['state'], [string, string]> = {
  ready: ['ok', 'Prêt'],
  starting: ['warn', 'Démarrage'],
  degraded: ['warn', 'Partiel'],
  error: ['ko', 'Erreur'],
  stopped: ['', 'Arrêté'],
};

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: HEADERS });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function mountStudioHome(root: HTMLElement) {
  const frame = moduleFrame(root, {
    id: 'systeme',
    title: 'Système',
    lead: 'Les services de Studio, ses connexions, son profil et son journal.',
    tabs: [
      ['services', 'Services'],
      ['links', 'Connexions'],
      ['profile', 'Profil'],
      ['log', 'Journal'],
      ['dev', 'Outils'],
    ],
  });
  frame.panel('services').innerHTML = `<div class="grid home-grid">
      <article class="card wide" data-slot="control"></article>
      <article class="card wide">
        <h2>Runtime local</h2>
        <div data-slot="services"><p class="muted">Chargement…</p></div>
        <div class="actions"><button type="button" data-act="restart">Réessayer / redémarrer le Core local</button><button type="button" data-act="restart-server" hidden>Redémarrer le serveur Studio</button></div>
      </article>
    </div>`;
  frame.panel('links').innerHTML = `<div class="grid home-grid">
      <article class="card wide">
        <h2>Connexions</h2>
        <div data-slot="links"></div>
        <div data-slot="twitch-connections"></div>
      </article>
    </div>`;
  frame.panel('profile').innerHTML =
    `<div class="grid home-grid"><article class="card wide" data-slot="profile"></article></div>`;
  frame.panel('log').innerHTML =
    `<div class="grid home-grid"><article class="card wide">
        <h2>Journal du runtime</h2>
        <pre class="home-log" data-slot="log">—</pre>
      </article></div>`;
  frame.panel('dev').innerHTML =
    `<div class="grid home-grid"><article class="card wide" data-slot="dev">
        <h2>Outils de développement <span class="badge">Lab</span></h2>
        <div class="home-links">
          <a href="/?tab=extension-lab&amp;surface=video">Extension Lab · Vidéo</a>
          <a href="/?tab=extension-lab&amp;surface=panel">Extension Lab · Panel</a>
          <a href="/?tab=extension-lab&amp;surface=mobile">Extension Lab · Mobile</a>
        </div>
        <h3>Prototypes</h3>
        <div data-slot="protos"><p class="muted">—</p></div>
      </article></div>`;
  frame.hideTab('dev');

  const slot = (name: string) =>
    root.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;
  mountStudioProfile(
    slot('profile'),
    document.querySelector<HTMLElement>('.topbar-safety'),
  );
  const twitchConnections = mountTwitchConnections(slot('twitch-connections'));
  const control = mountControlCenter(slot('control'));
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let logSeq = 0;
  const logLines: LogLine[] = [];

  root
    .querySelector('[data-act="restart"]')!
    .addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      await fetch('/api/runtime/restart', {
        method: 'POST',
        headers: HEADERS,
      }).catch(() => {});
      setTimeout(() => {
        btn.disabled = false;
      }, 1500);
      void refresh();
    });

  root
    .querySelector('[data-act="restart-server"]')!
    .addEventListener('click', () => void electronServer?.restart());

  async function loadPrototypes() {
    const p = await getJson<Prototypes>('/api/dev/prototypes');
    const box = slot('protos');
    if (!p || !p.available) {
      box.innerHTML =
        '<p class="muted">Disponibles quand Studio est lancé depuis le repo (jamais embarqués dans la release).</p>';
      return;
    }
    box.innerHTML = p.items.length
      ? `<div class="home-links">${p.items.map((i) => `<a href="${esc(i.entry)}" target="_blank" rel="noopener">${esc(i.name)}${i.entry.endsWith('calibrate.html') ? ' · calibration' : ''}</a>`).join('')}</div>`
      : '<p class="muted">Aucun prototype avec page d’entrée.</p>';
  }

  let production = false;
  async function refresh() {
    const profile = await getJson<{ effective?: string }>('/api/profile');
    production = profile?.effective === 'production';
    // The Lab's tools (Extension Lab, prototypes) only where they exist: a confirmed Lab profile.
    if (profile?.effective === 'lab') frame.showTab('dev');
    else frame.hideTab('dev');
    const [rt, bonk, sound, tts, logs] = await Promise.all([
      getJson<RuntimeStatus>('/api/runtime/status'),
      getJson<BonkStatus>('/api/bonk-lab/status'),
      getJson<SoundStatus>('/api/sound-lab/status'),
      getJson<TtsStatus>('/api/tts-lab/status'),
      getJson<LogLine[]>(`/api/test-lab/logs?since=${logSeq}`),
    ]);
    const services = slot('services');
    // Server unreachable: restarting the Core through it cannot work; Electron restarts the server.
    root.querySelector<HTMLButtonElement>('[data-act="restart"]')!.disabled =
      !rt;
    root.querySelector<HTMLButtonElement>(
      '[data-act="restart-server"]',
    )!.hidden = Boolean(rt) || !electronServer;
    if (!rt)
      services.innerHTML = '<p class="bad">Serveur Studio injoignable.</p>';
    else if (!rt.enabled)
      services.innerHTML =
        '<p class="muted">Runtime géré par <code>npm run bonk:lab</code> (mode Lab source).</p>';
    else
      services.innerHTML = (rt.services ?? [])
        .map((s) => {
          const [cls, txt] = BADGE[s.state];
          return `<div class="row home-row"><span>${esc(s.label)}</span><span><span class="badge ${cls}">${txt}</span></span></div><p class="home-detail">${esc(s.detail)}</p>`;
        })
        .join('');
    const obs = bonk?.enabled
      ? bonk.obs
        ? bonk.sourceReady
          ? ['ok', 'Connecté · source active']
          : ['warn', 'Connecté · source Bonk inactive']
        : ['', 'Non connecté']
      : ['', 'Indisponible'];
    const player = sound?.enabled
      ? sound.ready
        ? ['ok', 'Actif']
        : ['warn', 'En attente d’activation']
      : ['', 'Indisponible'];
    const ttsPlayer = tts?.enabled
      ? tts.ready
        ? ['ok', 'Actif']
        : ['warn', 'Absent (source OBS non chargée)']
      : ['', 'Indisponible'];
    const ttsState =
      { active: 'Actif', paused: 'En pause', disabled: 'Désactivé' }[
        tts?.module_state ?? ''
      ] ?? '—';
    const ttsQueue = tts?.queue
      ? `${tts.queue.waiting.length} en attente · ≈ ${Math.round(tts.queue.wait_ms / 1000)} s`
      : '—';
    slot('links').innerHTML = `
      <div class="row home-row"><span>OBS WebSocket</span><span><span class="badge ${obs[0]}">${obs[1]}</span></span></div>
      <p class="home-detail">${production ? 'Connexion depuis la carte « Bonk — overlay OBS (Production) » ci-dessous' : 'Connexion depuis la carte « Bonk OBS Lab » de l’Extension Lab'} (mot de passe jamais stocké).</p>
      <div class="row home-row"><span>Lecteur Soundboard</span><span><span class="badge ${player[0]}">${player[1]}</span></span></div>
      <p class="home-detail">Un clic d’activation par chargement (règle d’autoplay), ${production ? 'dans la carte « Soundboard — lecteur (Production) » ci-dessous' : 'dans l’onglet Soundboard config'}.</p>
      <div class="row home-row"><span>Lecteur TTS (OBS)</span><span><span class="badge ${ttsPlayer[0]}">${ttsPlayer[1]}</span></span></div>
      <p class="home-detail">${production ? 'URL de la source OBS : carte « TTS — source OBS (Production) » ci-dessous.' : `Module ${esc(ttsState)} · file ${esc(ttsQueue)}. URL de la source OBS, file et modération : Extension Lab (carte « TTS V2 Lab »).`}</p>
      <div class="row home-row"><span>Données locales</span><span>${rt ? (rt.packaged ? 'Application installée' : 'Repo (dev)') : '—'}</span></div>
      <p class="home-detail">${esc(rt?.dataRoot ?? '—')} · .env et jetons lus ici, jamais embarqués.</p>
      <div class="row home-row"><span>Économie</span><span>${production ? 'Core Production · Wallet canonique' : 'Core local · paiements simulés'}</span></div>
      <p class="home-detail">${production ? 'Jetons, achats, récompenses et remboursements sont réels : le Core Production en décide.' : 'Aucun Jeton réel ; les connexions Twitch peuvent tout de même lire de vrais événements et exécuter des actions réelles selon les automatismes activés.'}</p>`;
    if (Array.isArray(logs) && logs.length) {
      logSeq = logs[logs.length - 1]!.seq;
      logLines.push(
        ...logs.filter((l) =>
          ['runtime', 'labcore', 'postgres', 'studio'].includes(l.source),
        ),
      );
      logLines.splice(0, Math.max(0, logLines.length - 14));
      slot('log').textContent =
        logLines
          .map(
            (l) =>
              `${l.at.slice(11, 19)} ${l.source.padEnd(8)} ${l.level === 'error' ? '✗ ' : ''}${l.text}`,
          )
          .join('\n') || '—';
    }
  }

  const loop = async () => {
    if (!visible) return;
    await refresh();
    timer = setTimeout(() => void loop(), 2000);
  };
  void loadPrototypes();
  return {
    setVisible(v: boolean) {
      visible = v;
      clearTimeout(timer);
      twitchConnections.setVisible(v);
      control.setVisible(v);
      if (v) void loop();
    },
  };
}
