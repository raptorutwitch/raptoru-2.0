// Régie live (refonte lot 7, étape 1) — ce qui compte pendant le stream, au même endroit, sans copie de module :
// - les incidents en cours (supervision) ;
// - les automatisations des points de chaîne : état réel du Core et action nommée (même route et même confirmation
//   que la page Récompenses Twitch) ;
// - les contrôles nommés de chaque module : un lien vers l'écran qui les porte déjà (aucun bouton recopié).
// Pas d'« arrêter tout » : chaque arrêt est nommé et limité à son module.
import type { SupervisionSnapshot } from '../supervision-banner.js';

const HEADERS = { 'content-type': 'application/json', 'x-raptoru-studio': '1' };
const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

interface CpSummary {
  enabled: boolean;
  rules: number;
}

/** Named controls of each module, where they already live. `what` says exactly what can be done there. */
export const REGIE_CONTROLS: { page: string; title: string; what: string }[] = [
  {
    page: 'moderation',
    title: 'Modération',
    what: 'Files D4, sanctions, remboursements ; en Production, pause, stop et file TTS.',
  },
  {
    page: 'tombola',
    title: 'Tombola',
    what: 'Tirage en direct : pause, reprise, annulation (avec confirmation).',
  },
  {
    page: 'alerts',
    title: 'Alertes',
    what: 'File : rejouer une alerte, arrêter celle en cours.',
  },
  {
    page: 'tts',
    title: 'TTS (Lab)',
    what: 'Pause, reprise, stop de la lecture en cours, vider la file (remboursés).',
  },
  {
    page: 'spotify',
    title: 'Spotify',
    what: 'Demandes de musique : ouvrir / fermer, retirer une demande (remboursée).',
  },
  {
    page: 'random-ban',
    title: 'Random Ban',
    what: 'Tirage à blanc, suivi des bans et du mute OBS.',
  },
  {
    page: 'sub-wheel',
    title: 'Roue du Sub',
    what: 'File, droits, tirages à vérifier.',
  },
  {
    page: 'word-game',
    title: 'Jeu des mots',
    what: 'Manches et révélation locale.',
  },
  {
    page: 'halloween',
    title: 'Halloween',
    what: 'Effets de l’événement : arrêt de l’effet en cours.',
  },
];

export async function loadChannelPoints(): Promise<CpSummary | null> {
  try {
    const res = await fetch('/api/channel-points/state', { headers: HEADERS });
    if (!res.ok) return null;
    const s = (await res.json()) as {
      settings?: { enabled?: boolean };
      rewards?: { rule?: { enabled?: boolean } | null }[];
    };
    return {
      enabled: !!s.settings?.enabled,
      rules: (s.rewards ?? []).filter((r) => r.rule?.enabled).length,
    };
  } catch {
    return null;
  }
}

export { CP_OFF_CONFIRM, CP_ON_CONFIRM } from '../channel-points-view.js';

export async function setChannelPoints(enabled: boolean) {
  const res = await fetch('/api/channel-points/settings', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ enabled }),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
}

export function regieHtml(opts: {
  sup: SupervisionSnapshot | null;
  supOk: boolean;
  cp: CpSummary | null | undefined;
  message: string;
  href: (page: string) => string;
  live?: LiveState;
  profile?: string;
  liveMessage?: string;
}) {
  const active = opts.sup?.incidents.filter((i) => !i.endedAt) ?? [];
  const cp = opts.cp;
  return `<div class="rs-cols">
    <section class="rs-panel"><h2>En ce moment</h2>
      <p class="rs-state ${!opts.supOk ? 'is-unknown' : active.length ? 'is-down' : 'is-ok'}">${
        !opts.supOk
          ? 'Supervision indisponible : état inconnu.'
          : active.length
            ? `${active.length} incident(s) en cours : ${active.map((i) => esc(i.label)).join(', ')}.`
            : 'Aucun incident confirmé en cours.'
      }</p>
      <p class="rs-muted"><a href="${opts.href('activite')}">Historique des coupures</a> · <a href="${opts.href('systeme')}">Connexions (Système)</a></p>
    </section>
    <section class="rs-panel" data-role="regie-cp"><h2>Points de chaîne</h2>
      <p class="rs-state ${cp === undefined ? '' : cp === null ? 'is-unknown' : cp.enabled ? 'is-ok' : ''}">${
        cp === undefined
          ? 'Lecture…'
          : cp === null
            ? 'État inconnu (Core du profil injoignable ou module absent).'
            : cp.enabled
              ? `Automatisations actives · ${cp.rules} récompense(s) avec une règle active.`
              : `Automatisations coupées · ${cp.rules} récompense(s) avec une règle active (sans effet tant que c’est coupé).`
      }</p>
      ${cp ? `<button type="button" class="rs-btn ${cp.enabled ? 'danger' : ''}" data-regie="cp">${cp.enabled ? 'Couper les automatisations…' : 'Activer les automatisations…'}</button>` : ''}
      <p class="rs-muted">${opts.message ? `${esc(opts.message)} · ` : ''}Règles et historique : <a href="${opts.href('channel-points')}">Récompenses Twitch</a>.</p>
    </section>
  </div>
  ${liveHtml(opts.live, opts.profile ?? 'unknown', opts.href, opts.liveMessage)}
  <section class="rs-panel"><h2>Contrôles par module</h2>
    <p class="rs-muted">Chaque arrêt est nommé et limité à son module ; il n’existe pas d’« arrêter tout ».</p>
    <div class="rs-rows">${REGIE_CONTROLS.map((c) => `<a class="rs-row rs-row-2" href="${opts.href(c.page)}"><b>${esc(c.title)}</b><small>${esc(c.what)}</small></a>`).join('')}</div>
  </section>`;
}

// --- Files en direct (étape 2) : les routes de lecture et d'action que les modules utilisent déjà ---------------------

export interface LiveState {
  tombola:
    | {
        status: string;
        kind: string;
        participants: number;
        remaining_ms: number;
        label: string;
      }
    | 'none'
    | null;
  alerts: { playing: number; queued: number; source: boolean | null } | null;
  tts:
    { state: string; current: string | null; waiting: number } | 'off' | null;
  spotify: { admission: string; current: string | null; queue: number } | null;
}

const getJson = async <T>(path: string): Promise<T | null> => {
  try {
    const res = await fetch(path, { headers: HEADERS });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

export async function loadLive(): Promise<LiveState> {
  const [raffle, alerts, tts, sp] = await Promise.all([
    getJson<{
      round: {
        status: string;
        kind: string;
        participants: number;
        remaining_ms: number;
        amount: number;
        prize: string | null;
        currency: { label: string } | null;
      } | null;
    }>('/api/raffle/snapshot'),
    getJson<{
      enabled?: false;
      in_flight: unknown[];
      queued: unknown[];
      source?: { seen: boolean };
    }>('/api/alerts/state'),
    getJson<{
      enabled: boolean;
      module_state?: string;
      queue?: {
        current: { viewer_display_name: string } | null;
        waiting: unknown[];
      } | null;
    }>('/api/tts-lab/status'),
    getJson<{
      admission: string;
      current: { title?: string; artists?: string } | null;
      queue: unknown[];
    }>('/api/spotify/state'),
  ]);
  const r = raffle?.round;
  return {
    tombola: !raffle
      ? null
      : !r
        ? 'none'
        : {
            status: r.status,
            kind: r.kind,
            participants: r.participants,
            remaining_ms: r.remaining_ms,
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
          },
    tts: !tts
      ? null
      : !tts.enabled
        ? 'off'
        : {
            state: tts.module_state ?? 'active',
            current: tts.queue?.current?.viewer_display_name ?? null,
            waiting: tts.queue?.waiting.length ?? 0,
          },
    spotify: !sp
      ? null
      : {
          admission: sp.admission,
          current: sp.current
            ? [sp.current.title, sp.current.artists]
                .filter(Boolean)
                .join(' — ') || 'en cours'
            : null,
          queue: sp.queue.length,
        },
  };
}

/** Named live actions, each through the module's own route, with its own confirmation wording. */
export const LIVE_ACTIONS: Record<
  string,
  { label: string; confirm?: string; run: () => Promise<void> }
> = {
  'tombola-pause': {
    label: 'Pause',
    run: () => post('/api/raffle/actions', { command: { action: 'pause' } }),
  },
  'tombola-resume': {
    label: 'Reprendre',
    run: () => post('/api/raffle/actions', { command: { action: 'resume' } }),
  },
  'tombola-cancel': {
    label: 'Annuler la Tombola…',
    confirm:
      'Annuler la Tombola en cours ?\n\nLes inscriptions sont fermées, personne n’est payé. L’overlay affiche « Tombola annulée » quelques secondes, puis disparaît.',
    run: () =>
      post('/api/raffle/actions', {
        command: { action: 'cancel', reason: 'annulée depuis Studio' },
      }),
  },
  'tts-pause': {
    label: 'Pause TTS',
    run: () =>
      post('/api/tts-lab/moderation', { actor: 'studio', action: 'pause' }),
  },
  'tts-resume': {
    label: 'Reprendre TTS',
    run: () =>
      post('/api/tts-lab/moderation', { actor: 'studio', action: 'resume' }),
  },
  'tts-stop': {
    label: 'Arrêter le message en cours…',
    confirm:
      'Arrêter le message TTS en cours ?\n\nIl est coupé et son auteur est remboursé. La file continue ensuite.',
    run: () =>
      post('/api/tts-lab/moderation', {
        actor: 'studio',
        action: 'stop_current',
        refund: true,
      }),
  },
};

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as {
    error?: string | { code?: string };
  };
  if (!res.ok)
    throw new Error(
      typeof out.error === 'string'
        ? out.error
        : (out.error?.code ?? `HTTP ${res.status}`),
    );
}

const TOMBOLA_FR: Record<string, string> = {
  opening: 'ouverture',
  open: 'inscriptions ouvertes',
  paused: 'en pause',
  drawing: 'tirage',
  revealing: 'révélation',
  revealed: 'terminée',
  finished: 'terminée',
  cancelled: 'annulée',
};
const btn = (id: string, cls = '') =>
  `<button type="button" class="rs-btn sm ${cls}" data-live="${id}">${esc(LIVE_ACTIONS[id]!.label)}</button>`;
const unknown =
  '<p class="rs-state is-unknown">Indisponible sur ce profil (module absent ou Core injoignable).</p>';

export function liveHtml(
  live: LiveState | undefined,
  profile: string,
  href: (page: string) => string,
  message = '',
) {
  if (!live)
    return '<section class="rs-panel"><h2>Files en direct</h2><p class="rs-muted">Lecture…</p></section>';
  const lab = profile === 'lab';
  const t = live.tombola;
  const a = live.alerts;
  const v = live.tts;
  const s = live.spotify;
  const card = (title: string, page: string, body: string) =>
    `<section class="rs-live-card"><header><h3>${title}</h3><a href="${href(page)}">Ouvrir</a></header>${body}</section>`;
  return `<section class="rs-panel"><h2>Files en direct</h2>${message ? `<p class="rs-flash${message.startsWith('Refusé') ? ' is-bad' : ''}" role="status">${esc(message)}</p>` : ''}<div class="rs-live">
    ${card(
      'Tombola',
      'tombola',
      t === null
        ? unknown
        : t === 'none'
          ? '<p class="rs-state">Aucune Tombola en cours.</p>'
          : `<p class="rs-state ${['open', 'opening'].includes(t.status) ? 'is-ok' : t.status === 'paused' ? 'is-unknown' : ''}">${esc(TOMBOLA_FR[t.status] ?? t.status)} · ${esc(t.label)}</p>
             <p class="rs-muted">${t.participants} participant(s)${['open', 'opening', 'paused'].includes(t.status) ? ` · ${Math.ceil(t.remaining_ms / 1000)} s restantes` : ''}</p>
             ${['open', 'opening', 'paused'].includes(t.status) ? `<div class="rs-live-acts">${t.status === 'paused' ? btn('tombola-resume') : btn('tombola-pause')}${btn('tombola-cancel', 'danger')}</div>` : ''}`,
    )}
    ${card(
      'Alertes',
      'alerts',
      a === null
        ? unknown
        : `<p class="rs-state ${a.source === false ? 'is-unknown' : 'is-ok'}">${a.playing ? `${a.playing} en lecture` : 'Rien en lecture'} · ${a.queued} en attente</p>
           <p class="rs-muted">Source OBS : ${a.source === null ? 'inconnue' : a.source ? 'vue' : 'absente (les alertes attendent)'}.</p>`,
    )}
    ${card(
      'TTS',
      lab ? 'tts' : 'moderation',
      v === null
        ? unknown
        : v === 'off'
          ? '<p class="rs-state">Module TTS coupé sur ce profil.</p>'
          : `<p class="rs-state ${v.state === 'paused' ? 'is-unknown' : 'is-ok'}">${v.state === 'paused' ? 'En pause' : v.state === 'disabled' ? 'Désactivé' : 'Actif'} · ${v.current ? `lit le message de ${esc(v.current)}` : 'aucun message en cours'}</p>
             <p class="rs-muted">${v.waiting} message(s) en attente.${lab ? '' : ' En Production, pause, stop et file se pilotent dans Modération.'}</p>
             ${lab ? `<div class="rs-live-acts">${v.state === 'paused' ? btn('tts-resume') : btn('tts-pause')}${v.current ? btn('tts-stop', 'danger') : ''}</div>` : ''}`,
    )}
    ${card(
      'Spotify',
      'spotify',
      s === null
        ? unknown
        : `<p class="rs-state ${s.admission === 'open' ? 'is-ok' : ''}">Demandes ${s.admission === 'open' ? 'ouvertes' : s.admission === 'closed' ? 'fermées' : esc(s.admission)} · ${s.queue} en file</p>
           <p class="rs-muted">${s.current ? `En cours : ${esc(s.current)}` : 'Aucune demande en cours.'}</p>`,
    )}
  </div></section>`;
}
