// Régie live : ce qui passe, ce qui attend une décision, les interventions. Ici les lectures, les actions et le rendu pur ; la
// page (pages/regie.ts) les compose. Le shell fait un seul relevé (`loadLive`) : il nourrit la Régie et les compteurs de la barre
// latérale, même page fermée. Chaque action passe par la route du module, avec sa propre confirmation. Pas d'« arrêter tout » :
// chaque arrêt est nommé et limité à son module.
import { clock, esc, fmt, ic, pp, type IcName } from '../ds/ds.js';
import { ApiError, STUDIO_HEADERS } from '../http.js';
import { modAct, modGet, type ModItem } from '../mod/mod.js';
import type { SupervisionSnapshot } from '../supervision-banner.js';

/** Refonte H3: « Vider la file » — what it does, said before (waiting alerts only, nothing paid). */
export const CLEAR_QUEUE_CONFIRM =
  'Vider la file d’attente des alertes ?\n\nLes alertes qui attendent ne seront pas jouées (elles restent dans l’historique). Celle déjà en lecture se termine normalement. Aucun Jeton, aucun événement Twitch : les gains (Roue du Sub, fidélité) ne dépendent pas de l’animation.';
export const clearedText = (cleared: number, inFlight: number) =>
  `${cleared} alerte(s) en attente retirée(s)${inFlight ? ` · ${inFlight} déjà prise(s) par le lecteur : elle(s) se termine(nt) normalement` : ''}.`;

export interface CpSummary {
  enabled: boolean;
  rules: number;
  /**
   * What Studio itself sees of the execution side (refonte F1 : jamais de vert sur une intention seule). undefined: not
   * read. A string: why the OBS / effects actions would wait or fail right now.
   */
  blocker?: string | null;
}

/** Why channel-point OBS actions cannot run right now, from Studio's own state (null: nothing blocks). */
export function cpBlocker(s: {
  obs?: { connected?: boolean };
  effects?: { connected?: boolean; audio?: boolean } | null;
  executor_error?: string | null;
}): string | null {
  if (!s.obs?.connected) return 'OBS non connecté à Studio';
  if (s.effects && !s.effects.connected) return 'lecteur d’effets absent';
  if (s.effects && !s.effects.audio) return 'lecteur d’effets sans son';
  if (s.executor_error) return `erreur de l’exécuteur (${s.executor_error})`;
  return null;
}

/** Named controls of each module, where they already live. `what` says exactly what can be done there. */
export const REGIE_CONTROLS: {
  page: string;
  title: string;
  icon: IcName;
  what: string;
}[] = [
  {
    page: 'moderation',
    title: 'Modération',
    icon: 'mod',
    what: 'Files D4, sanctions, remboursements, équipe.',
  },
  {
    page: 'tombola',
    title: 'Tombola',
    icon: 'dice',
    what: 'Tirage en direct : pause, reprise, annulation (avec confirmation).',
  },
  {
    page: 'alerts',
    title: 'Alertes',
    icon: 'bell',
    what: 'File : rejouer une alerte, arrêter celle en cours.',
  },
  {
    page: 'tts',
    title: 'TTS',
    icon: 'mic',
    what: 'Pause, reprise, stop de la lecture en cours, vider la file (remboursés).',
  },
  {
    page: 'spotify',
    title: 'Spotify',
    icon: 'music',
    what: 'Demandes de musique : ouvrir / fermer, retirer une demande (remboursée).',
  },
  {
    page: 'random-ban',
    title: 'Random Ban',
    icon: 'shield',
    what: 'Tirage à blanc, suivi des bans et du mute OBS.',
  },
  {
    page: 'sub-wheel',
    title: 'Roue du Sub',
    icon: 'wheel',
    what: 'File, droits, tirages à vérifier.',
  },
  {
    page: 'word-game',
    title: 'Jeu des mots',
    icon: 'puzzle',
    what: 'Manches et révélation locale.',
  },
  {
    page: 'halloween',
    title: 'Halloween',
    icon: 'pumpkin',
    what: 'Effets de l’événement : arrêt de l’effet en cours.',
  },
];

export async function loadChannelPoints(): Promise<CpSummary | null> {
  const s = await getJson<{
    settings?: { enabled?: boolean };
    rewards?: { rule?: { enabled?: boolean } | null }[];
    obs?: { connected?: boolean };
    effects?: { connected?: boolean; audio?: boolean } | null;
    executor_error?: string | null;
  }>('/api/channel-points/state');
  return (
    s && {
      enabled: !!s.settings?.enabled,
      rules: (s.rewards ?? []).filter((r) => r.rule?.enabled).length,
      blocker: cpBlocker(s),
    }
  );
}

export { CP_OFF_CONFIRM, CP_ON_CONFIRM } from '../pages/rewards-model.js';

export const setChannelPoints = (enabled: boolean) =>
  post('/api/channel-points/settings', { enabled });

/** What the supervision follows today (server/src/supervision): an empty list of incidents means only this. */
export const SUPERVISED = 'liaison Studio, bot, TTS, Soundboard, Bonk';
export const NOT_SUPERVISED =
  'lecteur d’effets, source Alertes, overlays Tombola et Votekick, Spotify';

// --- Lectures --------------------------------------------------------------------------------------------------------

export interface LiveTombola {
  raffle_id?: string;
  status: string;
  kind: string;
  participants: number;
  remaining_ms: number;
  duration_ms?: number;
  label: string;
  /** Fin du décompte, sur l'horloge de ce PC : le décompte tourne entre deux relevés sans réécrire la page. */
  ends_at?: number | null;
}
export interface LiveState {
  /** Le live en cours ; undefined : non lu. */
  stream?: { source: string; started_at: string } | null;
  /** La pause générale du Core. */
  paused?: boolean;
  tombola: LiveTombola | 'none' | null;
  alerts: {
    playing: number;
    queued: number;
    source: boolean | null;
    items?: { id: string; type: string; who: string; playing: boolean }[];
  } | null;
  tts:
    | {
        state: string;
        current: string | null;
        /** null: the queue could not be read. */
        waiting: number | null;
        /** The TTS player answers (Studio's worker); undefined: not read. */
        ready?: boolean;
        playing?: ModItem | null;
        queue?: ModItem[];
      }
    | 'off'
    | null;
  sounds?: { state: string; playing: ModItem[]; waiting: ModItem[] } | null;
  spotify: {
    /** The Core's own admission: « ready », « MODULE_DISABLED » or the refusal reason (Studio absent, auth…). */
    admission: string;
    current: string | null;
    queue: number;
    items?: { id: string; who: string; title: string }[];
    verify?: number;
  } | null;
  /** Tirages de la Roue à vérifier (relevé complet, Régie ouverte). */
  wheel?: { reviews: number; duplicates: number } | null;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: STUDIO_HEADERS });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: STUDIO_HEADERS,
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as {
    error?: string | { code?: string };
    cleared?: number;
    in_flight?: number;
  };
  if (!res.ok)
    throw new ApiError(
      res.status,
      typeof out.error === 'string'
        ? out.error
        : (out.error?.code ?? `HTTP ${res.status}`),
    );
  return out;
}

interface Overview {
  tts?: {
    module_state?: string;
    current?: ModItem | null;
    waiting?: ModItem[];
  };
  soundboard?: {
    module_state?: string;
    playing?: ModItem[];
    waiting?: ModItem[];
  };
  global?: { paused?: boolean };
}
const asSounds = (o: Overview | null): LiveState['sounds'] =>
  o?.soundboard
    ? {
        state: o.soundboard.module_state ?? 'active',
        playing: (o.soundboard.playing ?? []).map(soundItem),
        waiting: (o.soundboard.waiting ?? []).map(soundItem),
      }
    : null;
const soundItem = (i: ModItem): ModItem => ({ ...i, module: 'soundboard' });

const RUNNING = ['opening', 'open', 'paused'];

/**
 * Le relevé commun. `full` : la Régie est ouverte, on lit aussi le live et les tirages de la Roue. Une lecture manquante reste
 * null : la page dit « indisponible », jamais une valeur inventée.
 */
export async function loadLive(full = false): Promise<LiveState> {
  const [raffle, alerts, tts, sp, overview, status, wheel] = await Promise.all([
    getJson<{
      round: {
        raffle_id: string;
        status: string;
        kind: string;
        participants: number;
        remaining_ms: number;
        duration_ms: number;
        amount: number;
        prize: string | null;
        currency: { label: string } | null;
      } | null;
    }>('/api/raffle/snapshot'),
    getJson<{
      enabled?: false;
      in_flight: {
        alert_id: string;
        type: string;
        data?: { pseudo?: unknown };
      }[];
      queued: {
        alert_id: string;
        type: string;
        data?: { pseudo?: unknown };
      }[];
      source?: { seen: boolean };
    }>('/api/alerts/state'),
    getJson<{ enabled: boolean; ready?: boolean; module_state?: string }>(
      '/api/tts-lab/status',
    ),
    getJson<{
      admission: string;
      current: { title?: string; artists?: string } | null;
      queue: {
        request_id: string;
        viewer?: { name?: string };
        track?: { title?: string } | null;
        input?: string | null;
      }[];
      to_verify?: unknown[];
    }>('/api/spotify/state'),
    modGet<Overview>('overview').catch(() => null),
    full
      ? getJson<{ stream?: LiveState['stream'] }>('/api/raffle/status')
      : null,
    full
      ? getJson<{ reviews?: unknown[]; possible_duplicates?: unknown[] }>(
          '/api/sub-wheel/state',
        )
      : null,
  ]);
  const r = raffle?.round;
  const q = overview?.tts;
  return {
    stream: status && 'stream' in status ? (status.stream ?? null) : undefined,
    paused: overview?.global?.paused,
    tombola: !raffle
      ? null
      : !r
        ? 'none'
        : {
            raffle_id: r.raffle_id,
            status: r.status,
            kind: r.kind,
            participants: r.participants,
            remaining_ms: r.remaining_ms,
            duration_ms: r.duration_ms,
            ends_at:
              r.status === 'paused' || !RUNNING.includes(r.status)
                ? null
                : Date.now() + r.remaining_ms,
            label:
              r.kind === 'giveaway'
                ? (r.prize ?? 'Giveaway')
                : `${r.amount.toLocaleString('fr-FR')} ${r.currency?.label ?? ''}`.trim(),
          },
    alerts:
      !alerts || alerts.enabled === false
        ? null
        : {
            playing: alerts.in_flight.length,
            queued: alerts.queued.length,
            source: alerts.source ? alerts.source.seen : null,
            items: [
              ...alerts.in_flight.map((a) => alertItem(a, true)),
              ...alerts.queued.map((a) => alertItem(a, false)),
            ],
          },
    tts: !tts
      ? null
      : !tts.enabled
        ? 'off'
        : {
            state: q?.module_state ?? tts.module_state ?? 'active',
            current: q?.current?.viewer_display_name ?? null,
            waiting: q?.waiting ? q.waiting.length : null,
            ready: tts.ready,
            playing: q?.current ?? null,
            queue: q?.waiting ?? [],
          },
    sounds: asSounds(overview),
    spotify: !sp
      ? null
      : {
          admission: sp.admission,
          current: sp.current
            ? [sp.current.title, sp.current.artists]
                .filter(Boolean)
                .join(' · ') || 'en cours'
            : null,
          queue: sp.queue.length,
          items: sp.queue.map((x) => ({
            id: x.request_id,
            who: x.viewer?.name ?? '',
            title: x.track?.title ?? x.input ?? '',
          })),
          verify: sp.to_verify?.length ?? 0,
        },
    wheel: wheel && {
      reviews: wheel.reviews?.length ?? 0,
      duplicates: wheel.possible_duplicates?.length ?? 0,
    },
  };
}
const alertItem = (
  a: { alert_id: string; type: string; data?: { pseudo?: unknown } },
  playing: boolean,
) => ({
  id: a.alert_id,
  type: a.type,
  who: String(a.data?.pseudo ?? ''),
  playing,
});

/** Garde la même échéance d'un relevé à l'autre tant qu'elle ne dérive pas : la page n'est pas réécrite pour rien. Pur. */
export function steadyEnds(prev: LiveState | undefined, next: LiveState) {
  const a = prev?.tombola;
  const b = next.tombola;
  if (
    a &&
    b &&
    a !== 'none' &&
    b !== 'none' &&
    a.raffle_id === b.raffle_id &&
    a.ends_at &&
    b.ends_at &&
    Math.abs(a.ends_at - b.ends_at) < 1500
  )
    b.ends_at = a.ends_at;
  return next;
}

/** Les compteurs de la barre latérale. Pur ; `now` : pour le temps de la Tombola. */
export function liveCounts(l: LiveState | undefined, now: number) {
  const t = l?.tombola;
  const tt = l?.tts;
  const a = l?.alerts;
  const waiting = tt && tt !== 'off' ? (tt.waiting ?? 0) : 0;
  const n = a ? a.playing + a.queued : 0;
  return {
    tts: waiting ? String(waiting) : null,
    alerts: n ? String(n) : null,
    tombola:
      !t || t === 'none'
        ? null
        : t.status === 'paused'
          ? 'Pause'
          : RUNNING.includes(t.status)
            ? clock(((t.ends_at ?? now + t.remaining_ms) - now) / 1000)
            : t.status === 'drawing' || t.status === 'revealing'
              ? 'Tirage'
              : null,
  };
}

/** The Core's Spotify admission in the streamer's words (refonte F1: the real answer, never an assumed « open »). */
export function spotifyAdmission(a: string) {
  return a === 'ready'
    ? 'Demandes ouvertes'
    : a === 'MODULE_DISABLED'
      ? 'Demandes fermées'
      : `Demandes refusées : ${SPOTIFY_REFUSAL[a] ?? a}`;
}
const SPOTIFY_REFUSAL: Record<string, string> = {
  STUDIO_UNAVAILABLE: 'Studio non vu par le serveur',
  AUTH_NOT_CONFIGURED: 'Spotify non connecté à Studio',
  AUTH_REQUIRED: 'Spotify à reconnecter',
  RATE_LIMITED: 'Spotify limite les appels',
};

// --- Actions ---------------------------------------------------------------------------------------------------------

/** Named live actions, each through the module's own route, with its own confirmation wording. */
export const LIVE_ACTIONS: Record<
  string,
  {
    label: string;
    icon: IcName;
    confirm?: string;
    /** Ce qui s'est passé, dit après coup. */
    done: string | ((out: { cleared?: number; in_flight?: number }) => string);
    run: () => Promise<unknown>;
  }
> = {
  'tombola-pause': {
    label: 'Pause',
    icon: 'pause',
    done: 'Tombola en pause',
    run: () => post('/api/raffle/actions', { command: { action: 'pause' } }),
  },
  'tombola-resume': {
    label: 'Reprendre',
    icon: 'play',
    done: 'Tombola reprise',
    run: () => post('/api/raffle/actions', { command: { action: 'resume' } }),
  },
  'tombola-cancel': {
    label: 'Annuler la Tombola…',
    icon: 'x',
    confirm:
      'Annuler la Tombola en cours ?\n\nLes inscriptions sont fermées, personne n’est payé. L’overlay affiche « Tombola annulée » quelques secondes, puis disparaît.',
    done: 'Tombola annulée',
    run: () =>
      post('/api/raffle/actions', {
        command: { action: 'cancel', reason: 'annulée depuis Studio' },
      }),
  },
  'alerts-clear': {
    label: 'Vider la file d’attente…',
    icon: 'trash',
    confirm: CLEAR_QUEUE_CONFIRM,
    done: (o) => clearedText(o.cleared ?? 0, o.in_flight ?? 0),
    run: () => post('/api/alerts/clear', {}),
  },
  'tts-pause': {
    label: 'Pause',
    icon: 'pause',
    done: 'TTS en pause, la file est gardée',
    run: () =>
      modAct({
        action: 'module_state',
        module: 'tts',
        state: 'paused',
        waiting: 'keep',
      }),
  },
  'tts-resume': {
    label: 'Reprendre',
    icon: 'play',
    done: 'TTS repris',
    run: () =>
      modAct({
        action: 'module_state',
        module: 'tts',
        state: 'active',
        waiting: 'keep',
      }),
  },
  'tts-stop': {
    label: 'Arrêter le message…',
    icon: 'stop',
    confirm:
      'Arrêter le message TTS en cours ?\n\nIl est coupé et son auteur est remboursé. La file continue ensuite.',
    done: 'Message coupé et remboursé',
    run: () => modAct({ action: 'stop_current', module: 'tts', refund: true }),
  },
  'sound-pause': {
    label: 'Pause',
    icon: 'pause',
    done: 'Sons en pause, la file est gardée',
    run: () =>
      modAct({
        action: 'module_state',
        module: 'soundboard',
        state: 'paused',
        waiting: 'keep',
      }),
  },
  'sound-resume': {
    label: 'Reprendre',
    icon: 'play',
    done: 'Sons repris',
    run: () =>
      modAct({
        action: 'module_state',
        module: 'soundboard',
        state: 'active',
        waiting: 'keep',
      }),
  },
};

// --- Rendu pur ---------------------------------------------------------------------------------------------------------

const TOMBOLA_FR: Record<string, string> = {
  opening: 'Ouverture',
  open: 'Inscriptions ouvertes',
  paused: 'Pause',
  drawing: 'Tirage',
  revealing: 'Révélation',
  revealed: 'Terminée',
  finished: 'Terminée',
  cancelled: 'Annulée',
};
const ALERT_FR: Record<string, string> = {
  follow: 'Follow',
  sub: 'Sub',
  resub: 'Resub',
  subgift: 'Sub offert',
  bits: 'Bits',
  raid: 'Raid',
  donation: 'Don',
};
const n = (v: number, one: string, many = `${one}s`) =>
  `${fmt(v)} ${v > 1 ? many : one}`;

type Tone = 'ok' | 'warn' | 'bad' | 'off' | 'unknown';
const btn = (id: string, cls = 'ghost') => {
  const a = LIVE_ACTIONS[id]!;
  return `<button type="button" class="d-btn sm ${cls}" data-live="${id}">${ic(a.icon)}${esc(a.label)}</button>`;
};
const idle = (text: string) => `<p class="rg-idle">${text}</p>`;
const UNKNOWN = idle(
  'Indisponible sur ce profil (module absent ou serveur injoignable).',
);

function track(o: {
  id: string;
  mod: string;
  icon: IcName;
  title: string;
  href: string;
  page: string;
  tone: Tone;
  state: string;
  lane: string;
  acts?: string;
  busy?: boolean;
}) {
  return {
    key: o.id,
    html: `<section class="rg-t${o.busy ? ' on' : ''}" data-mod="${o.mod}" data-track="${o.id}">
      <a class="rg-t__l" href="${o.href}" data-page="${o.page}" title="Ouvrir ${esc(o.title)}"><span class="rg-t__ic">${ic(o.icon)}</span><b>${esc(o.title)}</b><small data-tone="${o.tone}"><i></i>${esc(o.state)}</small></a>
      <div class="rg-t__lane">${o.lane}</div>
      <div class="rg-t__a">${o.acts ?? ''}</div>
    </section>`,
  };
}

const clip = (i: ModItem, text: string, more = true) =>
  `<span class="rg-c"><button type="button" class="rg-c__m" data-item="${esc(i.interaction_id)}" title="${esc(text)}">${pp(i.viewer_display_name, 20)}<span>${esc(i.viewer_display_name)}</span></button>${more ? `<button type="button" class="d-ib rg-c__x" data-more="${esc(i.interaction_id)}" aria-label="Décider pour ${esc(i.viewer_display_name)}">${ic('more')}</button>` : ''}</span>`;
const small = (who: string, what: string) =>
  `<span class="rg-c rg-c--s" title="${esc(what)}">${who ? pp(who, 20) : ''}<span>${esc(who || what)}</span></span>`;

function ttsTrack(live: LiveState, lab: boolean, href: (p: string) => string) {
  const v = live.tts;
  const base = {
    id: 'tts',
    mod: 'tts',
    icon: 'mic' as IcName,
    title: 'Voix',
    page: 'tts',
    href: href('tts'),
  };
  if (v === null)
    return track({ ...base, tone: 'unknown', state: 'Inconnu', lane: UNKNOWN });
  if (v === 'off')
    return track({
      ...base,
      tone: 'off',
      state: 'Fermé',
      lane: idle('TTS fermé sur ce profil.'),
    });
  const tone: Tone =
    v.state !== 'active'
      ? 'off'
      : v.ready === true
        ? 'ok'
        : v.ready === false
          ? 'bad'
          : 'unknown';
  const state =
    v.state === 'paused'
      ? 'Pause'
      : v.state === 'disabled'
        ? 'Fermé'
        : v.ready === false
          ? 'Ouvert, lecteur absent'
          : v.ready === true
            ? 'Ouvert'
            : 'Ouvert, lecteur non vérifié';
  const i = v.playing;
  const now = i
    ? `<div class="rg-now" data-item="${esc(i.interaction_id)}">${pp(i.viewer_display_name, 28)}<div><b>${esc(i.viewer_display_name)}</b><p>${esc(i.message ?? i.detail ?? '')}</p><span class="d-prog"><i data-start="${esc(i.delivery?.started_at ?? '')}" data-dur="${i.estimated_duration_ms ?? 0}" style="width:0"></i></span></div></div>`
    : v.current
      ? `<div class="rg-now"><div><b>${esc(v.current)}</b><p>Lecture en cours</p></div></div>`
      : '';
  const q = v.queue ?? [];
  const lane = `${now}${q.map((x) => clip(x, x.message ?? '')).join('')}${
    !now && !q.length
      ? idle(
          v.waiting === null
            ? 'File non lisible ici.'
            : v.ready === false
              ? 'Le lecteur ne répond pas. Les messages attendent, rien n’est perdu.'
              : 'Personne ne parle.',
        )
      : ''
  }${v.waiting !== null && v.waiting > q.length ? `<span class="rg-more">+${v.waiting - q.length}</span>` : ''}`;
  const count = v.waiting ? ` · ${n(v.waiting, 'message')} en attente` : '';
  return track({
    ...base,
    tone,
    state: state + count,
    busy: !!now,
    lane,
    acts: `${v.state === 'paused' ? btn('tts-resume') : v.state === 'active' ? btn('tts-pause') : ''}${v.current ? btn('tts-stop', 'bad') : ''}`,
  });
}

function soundTrack(live: LiveState, href: (p: string) => string) {
  const s = live.sounds;
  const base = {
    id: 'sounds',
    mod: 'soundboard',
    icon: 'sound' as IcName,
    title: 'Sons',
    page: 'soundboard',
    href: href('soundboard'),
  };
  if (!s)
    return track({ ...base, tone: 'unknown', state: 'Inconnu', lane: UNKNOWN });
  const label = (i: ModItem) => `${i.sound_label ?? i.detail ?? 'Son'}`;
  const now = s.playing
    .map(
      (i) =>
        `<div class="rg-now rg-now--s">${pp(i.viewer_display_name, 28)}<div><b>${esc(label(i))}</b><p>${esc(i.viewer_display_name)}</p></div></div>`,
    )
    .join('');
  return track({
    ...base,
    tone: s.state === 'active' ? 'ok' : 'off',
    state:
      s.state === 'paused'
        ? 'Pause'
        : s.state === 'disabled'
          ? 'Fermé'
          : s.waiting.length
            ? `${n(s.waiting.length, 'son')} en attente`
            : 'Ouvert',
    busy: !!now,
    lane:
      `${now}${s.waiting.map((i) => clip(i, label(i))).join('')}` ||
      idle('Aucun son en cours.'),
    acts:
      s.state === 'paused'
        ? btn('sound-resume')
        : s.state === 'active'
          ? btn('sound-pause')
          : '',
  });
}

function alertTrack(live: LiveState, href: (p: string) => string) {
  const a = live.alerts;
  const base = {
    id: 'alerts',
    mod: 'alerts',
    icon: 'bell' as IcName,
    title: 'Alertes',
    page: 'alerts',
    href: href('alerts'),
  };
  if (a === null)
    return track({ ...base, tone: 'unknown', state: 'Inconnu', lane: UNKNOWN });
  const items = a.items ?? [];
  const now = items
    .filter((x) => x.playing)
    .map(
      (x) =>
        `<div class="rg-now rg-now--s">${x.who ? pp(x.who, 28) : ''}<div><b>${esc(ALERT_FR[x.type] ?? x.type)}</b><p>${esc(x.who)}</p></div></div>`,
    )
    .join('');
  const next = items
    .filter((x) => !x.playing)
    .map((x) => small(x.who, ALERT_FR[x.type] ?? x.type))
    .join('');
  const line = `${a.playing ? `${a.playing} en lecture` : 'Rien en lecture'} · ${a.queued} en attente${a.queued ? ' · Plus jouée après 30 min d’attente' : ''}`;
  return track({
    ...base,
    tone: a.source === null ? 'unknown' : a.source ? 'ok' : 'bad',
    state:
      a.source === null
        ? 'Source inconnue'
        : a.source
          ? 'Source vue'
          : 'Source absente',
    busy: !!now,
    lane: `${now}${next}${
      !now && !next
        ? idle(
            a.source === false
              ? 'Source OBS absente : les alertes attendent.'
              : a.source === null
                ? 'Source OBS inconnue.'
                : 'Aucune alerte en attente.',
          )
        : ''
    }${a.playing || a.queued ? `<span class="rg-note">${line}</span>` : ''}`,
    acts: a.queued ? btn('alerts-clear', 'bad') : '',
  });
}

function musicTrack(live: LiveState, href: (p: string) => string) {
  const s = live.spotify;
  const base = {
    id: 'music',
    mod: 'spotify',
    icon: 'music' as IcName,
    title: 'Musique',
    page: 'spotify',
    href: href('spotify'),
  };
  if (s === null)
    return track({ ...base, tone: 'unknown', state: 'Inconnu', lane: UNKNOWN });
  const items = s.items ?? [];
  const now = s.current
    ? `<div class="rg-now rg-now--s"><div><b>${esc(s.current)}</b><p>En cours</p></div></div>`
    : '';
  return track({
    ...base,
    tone:
      s.admission === 'ready'
        ? 'ok'
        : s.admission === 'MODULE_DISABLED'
          ? 'off'
          : 'bad',
    state:
      s.admission === 'ready'
        ? `Ouvert · ${s.queue} en file`
        : s.admission === 'MODULE_DISABLED'
          ? 'Fermé'
          : 'Refusé',
    busy: !!now,
    lane: `${now}${items.map((x) => small(x.who, x.title)).join('')}${
      !now && !items.length ? idle(esc(spotifyAdmission(s.admission))) : ''
    }`,
  });
}

function tombolaTrack(live: LiveState, href: (p: string) => string) {
  const t = live.tombola;
  const base = {
    id: 'tombola',
    mod: 'tombola',
    icon: 'dice' as IcName,
    title: 'Tombola',
    page: 'tombola',
    href: href('tombola'),
  };
  if (t === null)
    return track({ ...base, tone: 'unknown', state: 'Inconnu', lane: UNKNOWN });
  if (t === 'none')
    return track({
      ...base,
      tone: 'off',
      state: 'Fermé',
      lane: idle('Aucune Tombola en cours.'),
    });
  const running = RUNNING.includes(t.status);
  const left =
    t.ends_at != null
      ? `<b class="rg-time" data-ends="${t.ends_at}"></b>`
      : running
        ? `<b class="rg-time">${clock(t.remaining_ms / 1000)}</b>`
        : '';
  const pct =
    t.duration_ms && t.status === 'paused'
      ? Math.round((t.remaining_ms / t.duration_ms) * 100)
      : 0;
  return track({
    ...base,
    tone: t.status === 'paused' ? 'warn' : running ? 'ok' : 'off',
    state: TOMBOLA_FR[t.status] ?? t.status,
    busy: running,
    lane: `<div class="rg-now rg-now--t">${left}<div><b>${esc(t.label)}</b><p>${n(t.participants, 'participant')}${t.kind === 'super' ? ' · Super' : ''}</p>${
      t.duration_ms
        ? `<span class="d-prog"><i data-ends="${t.ends_at ?? ''}" data-total="${t.duration_ms}" style="width:${pct}%"></i></span>`
        : ''
    }</div></div>`,
    acts: running
      ? `${t.status === 'paused' ? btn('tombola-resume') : btn('tombola-pause')}${btn('tombola-cancel', 'bad')}`
      : '',
  });
}

/** Les pistes de la Régie, une par famille de ce qui passe à l'antenne. */
export function liveTracks(
  live: LiveState,
  profile: string,
  href: (page: string) => string,
) {
  return [
    ttsTrack(live, profile === 'lab', href),
    ...(live.sounds === undefined ? [] : [soundTrack(live, href)]),
    alertTrack(live, href),
    musicTrack(live, href),
    tombolaTrack(live, href),
  ];
}
export const liveHtml = (
  live: LiveState,
  profile: string,
  href: (page: string) => string,
) =>
  liveTracks(live, profile, href)
    .map((t) => t.html)
    .join('');

/** Les automatisations de points de chaîne : l'état réel, jamais l'intention seule, et l'action nommée. */
export function automationHtml(cp: CpSummary | null | undefined) {
  const rules = cp ? n(cp.rules, 'récompense') : '';
  const tone: Tone =
    cp === undefined || cp === null
      ? 'unknown'
      : !cp.enabled
        ? 'off'
        : cp.blocker === null
          ? 'ok'
          : cp.blocker === undefined
            ? 'unknown'
            : 'bad';
  const text =
    cp === undefined
      ? 'Lecture…'
      : cp === null
        ? 'État inconnu (serveur injoignable ou module absent).'
        : !cp.enabled
          ? `Automatisations coupées · ${rules} avec une règle active (sans effet tant que c’est coupé).`
          : cp.blocker === null
            ? `Automatisations actives et exécutables · ${rules} avec une règle active.`
            : cp.blocker === undefined
              ? `Automatisations activées · ${rules} avec une règle active · exécution non vérifiée.`
              : `Automatisations activées, mais ${esc(cp.blocker)} : les actions OBS et les sons attendent · ${rules} avec une règle active.`;
  return `<p class="rg-line" data-tone="${tone}"><i></i><span>${text}</span></p>${cp ? `<button type="button" class="d-btn sm ${cp.enabled ? 'bad' : ''}" data-regie="cp">${cp.enabled ? 'Couper les automatisations…' : 'Activer les automatisations…'}</button>` : ''}`;
}

/** Ce que la supervision sait : un « rien » ne vaut que pour ce qu'elle suit. */
export function healthHtml(
  sup: SupervisionSnapshot | null,
  supOk: boolean,
  href: (page: string) => string,
) {
  const active = sup?.incidents.filter((i) => !i.endedAt) ?? [];
  return `<p class="rg-line" data-tone="${!supOk ? 'unknown' : active.length ? 'bad' : 'ok'}"><i></i><span>${
    !supOk
      ? 'Supervision indisponible : état inconnu.'
      : active.length
        ? `${n(active.length, 'incident')} en cours : ${active.map((i) => esc(i.label)).join(', ')}.`
        : `Aucun incident sur les éléments suivis : ${SUPERVISED}.`
  }</span></p>
  ${supOk && !active.length ? `<p class="d-note">Non suivis ici : ${NOT_SUPERVISED}. Leur état est dans chaque module.</p>` : ''}
  <p class="d-note"><a href="${href('activite')}" data-page="activite">Historique des coupures</a> · <a href="${href('systeme')}" data-page="systeme">Connexions</a></p>`;
}

export const controlsHtml = (href: (page: string) => string) =>
  REGIE_CONTROLS.map(
    (c) =>
      `<a class="rg-go" href="${href(c.page)}" data-page="${c.page}" title="${esc(c.what)}">${ic(c.icon)}${esc(c.title)}</a>`,
  ).join('');

const SIGNAL_PAGE: Record<string, string> = {
  tts: 'tts',
  soundboard: 'soundboard',
  bonk: 'bonk',
  'core-link': 'systeme',
  bot: 'systeme',
};

/** Ce qui attend une décision du streamer, le plus urgent d'abord. Pur. */
export function decisions(
  live: LiveState | undefined,
  sup: SupervisionSnapshot | null,
  href: (page: string) => string,
) {
  const out: { key: string; html: string }[] = [];
  const link = (page: string, label: string) =>
    `<a class="d-btn sm" href="${href(page)}" data-page="${page}">${esc(label)}</a>`;
  const line = (
    key: string,
    tone: Tone,
    title: string,
    text: string,
    acts: string,
  ) =>
    out.push({
      key,
      html: `<div class="rg-d d-in" data-tone="${tone}"><i></i><div class="rg-d__t"><b>${title}</b>${text ? `<p>${text}</p>` : ''}${acts ? `<div class="rg-d__a">${acts}</div>` : ''}</div></div>`,
    });
  for (const i of sup?.incidents ?? []) {
    if (i.endedAt) continue;
    line(
      `inc:${i.id}`,
      'bad',
      esc(i.label),
      `${esc(i.value)} · ${i.action === 'manual' ? 'Action requise' : 'Récupération automatique'}${i.hint ? `<small>${esc(i.hint)}</small>` : ''}`,
      SIGNAL_PAGE[i.signal] ? link(SIGNAL_PAGE[i.signal]!, 'Ouvrir') : '',
    );
  }
  const tts = live?.tts;
  for (const i of tts && tts !== 'off' ? (tts.queue ?? []) : [])
    if (i.review_status === 'pending')
      line(
        `tts:${i.interaction_id}`,
        'warn',
        `Message de ${esc(i.viewer_display_name)} à vérifier`,
        esc(i.message ?? ''),
        `<button type="button" class="d-btn sm" data-allow="${esc(i.interaction_id)}">${ic('check')}Laisser passer</button><button type="button" class="d-btn sm bad" data-more="${esc(i.interaction_id)}">Retirer…</button>`,
      );
  const sp = live?.spotify;
  if (sp?.verify)
    line(
      'spotify',
      'warn',
      `${n(sp.verify, 'demande')} de musique à vérifier`,
      '',
      link('spotify', 'Voir'),
    );
  const w = live?.wheel;
  if (w && w.reviews + w.duplicates)
    line(
      'wheel',
      'warn',
      `${n(w.reviews + w.duplicates, 'tirage')} de la Roue à vérifier`,
      '',
      link('sub-wheel', 'Voir'),
    );
  for (const i of sup?.incidents ?? []) {
    if (!i.endedAt || i.acknowledged) continue;
    line(
      `up:${i.id}`,
      'ok',
      `${esc(i.label)} rétabli`,
      '',
      `<button type="button" class="d-btn sm" data-sup-ack="${esc(i.id)}">Vu</button>`,
    );
  }
  return out;
}
