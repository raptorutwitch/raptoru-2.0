import { mountControlCenter } from '../control-center.js';
import {
  confirmBox,
  esc,
  ic,
  page,
  patch,
  poller,
  run,
  setStreamTestsConfirmed,
  stateChip,
  streamTestsConfirmed,
  sw,
  toast,
  type IcName,
} from '../ds/ds.js';
import { STUDIO_HEADERS, tryGetJson } from '../http.js';
import { mountStudioProfile } from '../studio-profile.js';
import { mountTwitchConnections } from '../twitch-connections.js';

// Système : où Studio est branché et ce qui le fait tourner. Le profil d'abord, Production signalée sans ambiguïté ; les connexions
// (comptes Twitch, OBS, lecteurs), les services, le journal, les outils du Lab. Aucune action réelle implicite : changer de profil
// passe par la confirmation de l'application, et ne se fait que depuis ici.

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
  fictional?: boolean;
  sourceReady?: boolean;
  error?: string | null;
};
type SoundStatus = { enabled: boolean; ready?: boolean; error?: string | null };
type TtsStatus = {
  enabled: boolean;
  ready?: boolean;
  module_state?: string;
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

/** Electron bridge (preload): restarts the Studio server even when its HTTP API is dead. */
const electronServer = (
  window as unknown as {
    raptoruStudio?: { server?: { restart(): Promise<unknown> } };
  }
).raptoruStudio?.server;
const SERVICE: Record<Service['state'], ['' | 'w' | 'r' | 'off', string]> = {
  ready: ['', 'Prêt'],
  starting: ['w', 'Démarrage'],
  degraded: ['w', 'Partiel'],
  error: ['r', 'Erreur'],
  stopped: ['off', 'Arrêté'],
};
const TABS: [string, string][] = [
  ['profile', 'Vue d’ensemble'],
  ['links', 'Comptes Twitch'],
  ['services', 'Services'],
  ['log', 'Journal'],
  ['dev', 'Outils'],
];
const TAB_KEY = 'raptoru-studio-tab-systeme';
const line = (icon: IcName, title: string, detail: string, state: string) =>
  `<div class="sy-r">${ic(icon)}<div><b>${esc(title)}</b><p>${detail}</p></div>${state}</div>`;

export function mountSysteme(root: HTMLElement) {
  const p = page(root, { title: 'Système' });
  let tab = 'profile';
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved && saved !== 'dev' && TABS.some(([id]) => id === saved))
      tab = saved;
  } catch {
    /* private mode: the first tab */
  }
  p.body.innerHTML = `<div class="sy">
    <div class="d-seg sy-tabs" role="tablist" aria-label="Système">${TABS.map(
      ([id, label]) =>
        `<button type="button" role="tab" id="sy-t-${id}" data-tab="${id}" aria-controls="sy-p-${id}" aria-selected="${id === tab}" tabindex="${id === tab ? 0 : -1}"${id === 'dev' ? ' hidden' : ''}>${label}</button>`,
    ).join('')}</div>
    <div class="sy-panels">
      <section role="tabpanel" id="sy-p-profile" aria-labelledby="sy-t-profile"><div data-slot="profile"></div><h2 class="d-lb">Branchements</h2><div data-slot="links"></div><h2 class="d-lb">Confirmations</h2><div data-slot="confirm"></div></section>
      <section role="tabpanel" id="sy-p-links" aria-labelledby="sy-t-links"><div data-slot="twitch-connections"></div></section>
      <section role="tabpanel" id="sy-p-services" aria-labelledby="sy-t-services">
        <div data-slot="control"></div>
        <h2 class="d-lb">Sur ce PC</h2>
        <div data-slot="services"><p class="d-note">Chargement…</p></div>
        <div class="sy-acts"><button type="button" class="d-btn sm" data-act="restart">Relancer le serveur local</button><button type="button" class="d-btn sm" data-act="restart-server" hidden>Redémarrer le serveur Studio</button></div>
      </section>
      <section role="tabpanel" id="sy-p-log" aria-labelledby="sy-t-log"><pre class="sy-log" data-slot="log">Rien pour l’instant.</pre></section>
      <section role="tabpanel" id="sy-p-dev" aria-labelledby="sy-t-dev">
        <h2 class="d-lb">Extension Lab</h2>
        <div class="sy-links"><a href="/?tab=extension-lab&amp;surface=video">Vidéo</a><a href="/?tab=extension-lab&amp;surface=panel">Panel</a><a href="/?tab=extension-lab&amp;surface=mobile">Mobile</a></div>
        <h2 class="d-lb">Prototypes</h2><div data-slot="protos"><p class="d-note">Lecture…</p></div>
      </section>
    </div>
  </div>`;
  const slot = (name: string) =>
    root.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;
  // Préférence locale de ce Studio (ds.ts, STREAM_TESTS_KEY) : seulement les tests joués sur le stream.
  const paintConfirm = () =>
    patch(
      slot('confirm'),
      line(
        'play',
        'Tests joués sur le stream',
        'Demander avant « Jouer sur le stream » (alertes), « Tester » une récompense ou un effet et « Rejouer l’animation » de la Roue. Les actions d’argent, de modération, les suppressions et les réglages demandent toujours.',
        sw(
          streamTestsConfirmed(),
          'data-stream-tests',
          'Demander avant un test joué sur le stream',
        ),
      ),
    );
  paintConfirm();
  slot('confirm').addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-stream-tests]')) return;
    setStreamTestsConfirmed(t.checked);
    toast(
      t.checked
        ? 'Les tests joués sur le stream demandent de nouveau une confirmation.'
        : 'Les tests joués sur le stream partent sans confirmation.',
    );
  });
  const tabs = () => [
    ...root.querySelectorAll<HTMLButtonElement>('.sy-tabs [role="tab"]'),
  ];
  // Le curseur du segment suit l'onglet choisi parmi ceux qui se voient (Outils n'existe qu'au Lab).
  function paintBar() {
    const shown = tabs().filter((b) => !b.hidden);
    const bar = root.querySelector<HTMLElement>('.sy-tabs')!;
    bar.style.setProperty('--n', String(shown.length));
    bar.style.setProperty(
      '--i',
      String(
        Math.max(
          0,
          shown.findIndex((b) => b.dataset.tab === tab),
        ),
      ),
    );
  }
  function select(id: string, focus = false) {
    tab = id;
    for (const b of tabs()) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('on', on);
      if (on && focus) b.focus();
    }
    paintBar();
    for (const [t] of TABS)
      root.querySelector<HTMLElement>(`#sy-p-${t}`)!.hidden = t !== id;
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* private mode: the tab is not remembered */
    }
  }
  select(tab);
  const bar = root.querySelector<HTMLElement>('.sy-tabs')!;
  bar.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')
      ?.dataset.tab;
    if (id) select(id);
  });
  bar.addEventListener('keydown', (e) => {
    const shown = tabs().filter((b) => !b.hidden);
    const at = shown.findIndex((b) => b.dataset.tab === tab);
    const to = ['ArrowDown', 'ArrowRight'].includes(e.key)
      ? shown[(at + 1) % shown.length]
      : ['ArrowUp', 'ArrowLeft'].includes(e.key)
        ? shown[(at - 1 + shown.length) % shown.length]
        : e.key === 'Home'
          ? shown[0]
          : e.key === 'End'
            ? shown.at(-1)
            : undefined;
    if (!to) return;
    e.preventDefault();
    select(to.dataset.tab!, true);
  });

  mountStudioProfile(
    slot('profile'),
    document.querySelector<HTMLElement>('.topbar-safety'),
    (head, chip) => {
      patch(p.actions, head);
      patch(p.state, chip);
    },
  );
  const twitchConnections = mountTwitchConnections(slot('twitch-connections'));
  const control = mountControlCenter(slot('control'));
  let logSeq = 0;
  const logLines: LogLine[] = [];
  let production = false;

  async function loadPrototypes() {
    const r = await tryGetJson<Prototypes>('/api/dev/prototypes');
    patch(
      slot('protos'),
      !r || !r.available
        ? '<p class="d-note">Disponibles quand Studio est lancé depuis le dépôt (jamais embarqués dans une version publiée).</p>'
        : r.items.length
          ? `<div class="sy-links">${r.items.map((i) => `<a href="${esc(i.entry)}" target="_blank" rel="noopener">${esc(i.name)}${i.entry.endsWith('calibrate.html') ? ' · calibration' : ''}</a>`).join('')}</div>`
          : '<p class="d-note">Aucun prototype avec page d’entrée.</p>',
    );
  }

  const read = poller(async () => {
    const profile = await tryGetJson<{ effective?: string }>('/api/profile');
    production = profile?.effective === 'production';
    // The Lab's tools (Extension Lab, prototypes) only where they exist: a confirmed Lab profile.
    const lab = profile?.effective === 'lab';
    root.querySelector<HTMLElement>('#sy-t-dev')!.hidden = !lab;
    paintBar();
    if (!lab && tab === 'dev') select('profile');
    const [rt, bonk, sound, tts, logs] = await Promise.all([
      tryGetJson<RuntimeStatus>('/api/runtime/status'),
      tryGetJson<BonkStatus>('/api/bonk-lab/status'),
      tryGetJson<SoundStatus>('/api/sound-lab/status'),
      tryGetJson<TtsStatus>('/api/tts-lab/status'),
      tryGetJson<LogLine[]>(`/api/test-lab/logs?since=${logSeq}`),
    ]);
    // Server unreachable: restarting through it cannot work; Electron restarts the server.
    root.querySelector<HTMLButtonElement>('[data-act="restart"]')!.disabled =
      !rt;
    root.querySelector<HTMLElement>('[data-act="restart-server"]')!.hidden =
      Boolean(rt) || !electronServer;
    patch(
      slot('services'),
      !rt
        ? '<p class="d-note bad">Serveur Studio injoignable.</p>'
        : !rt.enabled
          ? '<p class="d-note">Services gérés depuis le dépôt (mode Lab source).</p>'
          : (rt.services ?? [])
              .map((s) => {
                const [dot, txt] = SERVICE[s.state];
                return line(
                  'pulse',
                  s.label,
                  esc(s.detail),
                  stateChip(dot, txt),
                );
              })
              .join(''),
    );
    const obs: ['' | 'w' | 'off', string] = bonk?.enabled
      ? bonk.obs
        ? bonk.fictional
          ? ['', 'OBS fictif']
          : bonk.sourceReady
            ? ['', 'Connecté · source active']
            : ['w', 'Connecté · source Bonk inactive']
        : ['off', 'Non connecté']
      : ['off', 'Indisponible'];
    const player: ['' | 'w' | 'off', string] = sound?.enabled
      ? sound.ready
        ? ['', 'Actif']
        : ['w', 'En attente d’activation']
      : ['off', 'Indisponible'];
    const ttsPlayer: ['' | 'w' | 'off', string] = tts?.enabled
      ? tts.ready
        ? ['', 'Actif']
        : ['w', 'Absent (source OBS non chargée)']
      : ['off', 'Indisponible'];
    const ttsState =
      { active: 'ouvert', paused: 'pause', disabled: 'fermé' }[
        tts?.module_state ?? ''
      ] ?? 'inconnu';
    const ttsQueue = tts?.queue
      ? `${tts.queue.waiting.length} en attente · environ ${Math.round(tts.queue.wait_ms / 1000)} s`
      : 'non lue';
    patch(
      slot('links'),
      `${line('film', 'OBS WebSocket', bonk?.fictional ? 'Le Lab n’ouvre aucune connexion : le vrai OBS n’est pas touché.' : 'Connexion depuis la page Bonk (mot de passe jamais stocké en clair).', stateChip(...obs))}
      ${line('sound', 'Lecteur Soundboard', `Un clic d’activation par chargement (règle d’autoplay), ${production ? 'en haut de la page Soundboard' : 'dans l’Extension Lab'}.`, stateChip(...player))}
      ${line('mic', 'Lecteur TTS (OBS)', production ? 'Adresse de la source OBS : page TTS.' : `Module ${esc(ttsState)} · file ${esc(ttsQueue)}. Adresse de la source OBS : page TTS.`, stateChip(...ttsPlayer))}
      ${line('layers', 'Données locales', production ? `${esc(rt?.dataRoot ?? 'non lues')} · .env et jetons lus ici, jamais embarqués.` : `${esc(rt?.dataRoot ?? 'non lues')} · dossier propre au Lab, ni .env ni jeton réel.`, `<span class="d-tag">${rt ? (rt.packaged ? 'Application installée' : 'Dépôt (dev)') : '?'}</span>`)}
      ${line('coin', 'Économie', production ? 'Jetons, achats, récompenses et remboursements sont réels : le serveur de Production en décide.' : 'Aucun Jeton réel : le Core du Lab tourne sur ce PC, avec sa propre base et des comptes fictifs.', production ? '<span class="d-tag bad">Réelle</span>' : '<span class="d-tag ok">Simulée</span>')}`,
    );
    if (Array.isArray(logs) && logs.length) {
      logSeq = logs[logs.length - 1]!.seq;
      logLines.push(
        ...logs.filter((l) =>
          ['runtime', 'labcore', 'postgres', 'studio'].includes(l.source),
        ),
      );
      logLines.splice(0, Math.max(0, logLines.length - 40));
      if (logLines.length)
        slot('log').textContent = logLines
          .map(
            (l) =>
              `${l.at.slice(11, 19)} ${l.source.padEnd(8)} ${l.level === 'error' ? '✗ ' : ''}${l.text}`,
          )
          .join('\n');
    }
  }, 2000);

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-act]',
    );
    if (b?.dataset.act === 'restart')
      void (async () => {
        if (
          production &&
          !(await confirmBox({
            title: 'Relancer le serveur local ?',
            body: 'Tu es en Production : les lecteurs de ce PC s’interrompent le temps du redémarrage.',
            yes: 'Relancer',
          }))
        )
          return;
        await run(
          b,
          () =>
            fetch('/api/runtime/restart', {
              method: 'POST',
              headers: STUDIO_HEADERS,
            }),
          'Relance demandée',
        );
        read.now();
      })();
    if (b?.dataset.act === 'restart-server') void electronServer?.restart();
  });
  void loadPrototypes();
  return {
    setVisible(v: boolean) {
      twitchConnections.setVisible(v);
      control.setVisible(v);
      if (v) read.start();
      else read.stop();
    },
  };
}
