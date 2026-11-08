import { clock, esc, hhmm, ic, pp, stateChip } from '../ds/ds.js';

// Spotify, partie pure et testée (docs/SPOTIFY_V2.md § 6) : ce qui joue, la file, ses décisions, la frise du temps. Le Core décide,
// Studio est le seul à parler à Spotify, cette page montre et transmet. La file suit l'ordre réel de Spotify : ni le Core ni l'API
// Spotify ne permettent de la réordonner, elle n'a donc pas de poignée. Chaque texte venu de Twitch ou de Spotify est échappé.

export interface SpTrack {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  duration_ms: number;
}

export interface SpRequest {
  request_id: string;
  source: 'twitch' | 'simulation' | 'extension';
  viewer: { id: string; login: string; name: string };
  input: string | null;
  state: string;
  reason: string | null;
  track: SpTrack | null;
  confidence: string | null;
  confirmation: string | null;
  received_at: string;
  queued_at: string | null;
  playback_started_at: string | null;
  ended_at: string | null;
  canceled_by: string | null;
  removed_by: string | null;
  skipped_by: string | null;
  auto_skip: boolean;
  auto_skip_result: string | null;
  twitch_status: 'cancel_requested' | 'kept' | 'unmanaged' | 'none' | null;
  /** Music Hub (absent d'un Core plus ancien) : la récompense paie en points, l'extension en Jetons. */
  payment?: 'channel_points' | 'tokens';
  price_tokens?: number | null;
  refund_status?: 'refunded' | 'kept' | null;
}

export interface SpSettings {
  enabled: boolean;
  max_pending_per_viewer: number;
  viewer_cooldown_seconds: number;
  max_duration_seconds: number;
  cancel_grace_seconds: number;
  /** Music Hub (absent d'un Core plus ancien). */
  extension_enabled?: boolean;
  extension_price_tokens?: number;
  no_duplicates?: boolean;
  player_controls?: boolean;
}

export interface SpOverride {
  viewer_login: string;
  max_pending_per_viewer: number | null;
  viewer_cooldown_seconds: number | null;
  updated_at: string;
}

/** Un demandeur et ses limites, telles que l'admission les applique (absent d'un Core d'avant le 25/10). */
export interface SpViewerUsage {
  viewer_id: string;
  login: string;
  pending: number;
  max_pending: number;
  cooldown_left_ms: number;
  override: boolean;
}

/** Les demandes du jour, heure de Paris (absent d'un Core d'avant le 25/10). */
export interface SpToday {
  received: number;
  played: number;
  refused: number;
  canceled: number;
  removed: number;
  refunded: number;
}

export interface SpPlayback {
  observed_at: string;
  track: SpTrack | null;
  progress_ms: number | null;
  is_playing: boolean;
  volume_percent?: number | null;
}

export interface SpState {
  environment: 'lab' | 'production';
  settings: SpSettings;
  admission: string;
  studio: {
    fresh: boolean;
    playback: SpPlayback | null;
    status: { device: { name: string; type: string } | null };
  } | null;
  current: SpRequest | null;
  queue: SpRequest[];
  in_progress: SpRequest[];
  to_verify: SpRequest[];
  recent: SpRequest[];
  overrides?: SpOverride[];
  viewers?: SpViewerUsage[];
  today?: SpToday;
  twitch_actions: {
    kind: string;
    status: string;
    error: string | null;
    payload: {
      redemption_id?: string;
      status?: string;
      title?: string;
      cost?: number;
    };
    created_at: string;
  }[];
  managed_rewards: { reward_id: string; title: string; cost: number }[];
  connection: {
    auth: 'ok' | 'not_configured' | 'needs_reauth';
    client_id: string | null;
    account: { name: string; product: string | null } | null;
    redirect_uri: string;
    simulated: boolean;
  };
  api: {
    limited_until: string | null;
    quota_exceeded: boolean;
    calls_last_minute: number;
    rate_high: boolean;
    backoff_until: string | null;
    counters?: Record<string, number>;
  };
  local: {
    error: string | null;
    watching: boolean;
    fast_lane: boolean;
    next_poll_in_ms?: number | null;
    refresh_in_ms?: number;
    reservations?: unknown[];
  };
  sim: {
    device_active: boolean;
    queue_answer: number;
    limited: boolean;
    current: string | null;
    progress_ms: number | null;
    queue: string[];
    calls: number;
  } | null;
  /** Pochettes que Studio a vues passer, par titre (absent d'un Studio plus ancien). */
  covers?: Record<string, string>;
}

export interface SpIdentity {
  id: string;
  label: string;
  login?: string;
  role?: string;
}

/** L'état propre à la page : ce qui est en cours de saisie, les identités du Lab, l'heure (passée : la vue reste pure). */
export interface SpUi {
  fields: Record<string, string>;
  who: SpIdentity[];
  now: number;
  replies?: string[];
  simClosed?: boolean;
}

export const trackLabel = (t: SpTrack | null) =>
  t ? `${t.title} — ${t.artists.join(', ')}` : '—';
/** « il y a 12 s », « il y a 3 min », « il y a 2 h ». */
export const agoMs = (ms: number) =>
  ms < 60_000
    ? `il y a ${Math.max(0, Math.round(ms / 1000))} s`
    : ms < 3_600_000
      ? `il y a ${Math.round(ms / 60_000)} min`
      : `il y a ${Math.round(ms / 3_600_000)} h`;
export const minutes = (s: number) =>
  s % 60 === 0
    ? `${s / 60} min`
    : `${(s / 60).toFixed(1).replace('.', ',')} min`;
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
/** « encore 6 min », « encore 40 s ». */
const left = (ms: number) =>
  ms >= 60_000
    ? `encore ${Math.ceil(ms / 60_000)} min`
    : `encore ${Math.ceil(ms / 1000)} s`;

/** Pourquoi une demande n'est pas passée, dans les mots de la page. */
export const REASONS: Record<string, string> = {
  INVALID_INPUT: 'texte vide',
  INVALID_REFERENCE: 'lien non Spotify ou pas un titre',
  NOT_FOUND: 'aucun titre assez proche',
  AMBIGUOUS: 'plusieurs titres possibles',
  TOO_LONG: 'titre trop long',
  VIEWER_LIMIT: 'trop de demandes en attente',
  VIEWER_COOLDOWN: 'délai entre deux demandes',
  DUPLICATE_REDEEM: 'rédemption déjà reçue',
  NO_DEVICE: 'aucun appareil Spotify actif',
  AUTH_NOT_CONFIGURED: 'Spotify non connecté',
  AUTH_REQUIRED: 'reconnexion Spotify nécessaire',
  SPOTIFY_UNAVAILABLE: 'Spotify indisponible',
  RATE_LIMITED: 'Spotify limite les appels',
  TEMPORARY_ERROR: 'erreur temporaire de Spotify',
  QUEUE_RESULT_UNKNOWN: 'ajout non confirmé',
  MODULE_DISABLED: 'demandes fermées',
  STREAM_ENDED: 'annulée à la fin du live (non jouée)',
  STUDIO_UNAVAILABLE: 'Studio absent',
  STUDIO_LOST: 'Studio perdu pendant le traitement',
  LATE: 'rédemption trop ancienne',
  INTERRUPTED: 'interrompue par une autre demande',
  INTERRUPTED_EXTERNAL: 'interrompue par un autre titre',
  DUPLICATE_TRACK: 'titre déjà en file',
  NOT_PLAYABLE: 'titre non jouable',
  EXTENSION_DISABLED: 'demandes depuis l’extension fermées',
};

/** Ce qu'a coûté une demande : des points de la récompense, ou des Jetons depuis l'extension (Music Hub). */
export const paidWith = (r: SpRequest) =>
  r.payment === 'tokens'
    ? `<span class="d-tag" title="Demandée depuis l’extension">◆ ${r.price_tokens ?? '?'} Jetons</span>`
    : r.source === 'twitch'
      ? '<span class="d-tag off" title="Récompense de points de chaîne">points</span>'
      : '';

export const STATES: Record<string, string> = {
  RECEIVED: 'Reçue',
  SEARCHING: 'Recherche',
  QUEUED: 'En file',
  PLAYING: 'En cours',
  PLAYED: 'Jouée',
  SKIPPED: 'Passée',
  CANCELED: 'Annulée',
  REMOVED_BY_MOD: 'Retirée',
  FAILED: 'Refusée',
  AMBIGUOUS: 'Ambiguë',
  TOO_LONG: 'Trop longue',
  VIEWER_LIMIT: 'Limite',
  VIEWER_COOLDOWN: 'Délai',
  UNKNOWN: 'À vérifier',
};

export const TWITCH: Record<string, string> = {
  cancel_requested: 'points remboursés (demande envoyée à Twitch)',
  kept: 'gardée : réclamation en attente sur Twitch',
  unmanaged: 'non remboursable (récompense non créée par Raptoru)',
  none: '',
};

const cover = (s: SpState, t: SpTrack | null, cls = '') => {
  const url = t ? s.covers?.[t.id] : null;
  return url
    ? `<img class="spo-cov ${cls}" src="${esc(url)}" alt="" loading="lazy">`
    : `<span class="spo-cov spo-cov--none ${cls}" aria-hidden="true">${ic('music')}</span>`;
};

// --- En-tête -------------------------------------------------------------------------------------------------------------

export function stateView(s: SpState) {
  if (!s.settings.enabled) return stateChip('off', 'Demandes fermées');
  return s.admission === 'ready'
    ? stateChip('live', 'Demandes ouvertes')
    : stateChip('w', 'Demandes ouvertes mais refusées');
}

/** Une ligne seulement quand les demandes n'entrent pas, avec la raison et le geste qui suit. */
export function openingView(s: SpState) {
  if (s.settings.enabled && s.admission === 'ready') return '';
  const closed = !s.settings.enabled;
  const why = closed
    ? 'La récompense est refusée et remboursée (si elle est celle de Raptoru).'
    : `Raison : ${REASONS[s.admission] ?? s.admission}.`;
  return `<div class="spo-line ${closed ? '' : 'warn'}"><span>${esc(why)}</span>${
    closed
      ? '<button type="button" class="d-btn pri sm" data-act="sp-switch">Ouvrir les demandes</button>'
      : '<button type="button" class="d-btn sm" data-open="connexion">Voir la connexion</button>'
  }</div>`;
}

/** Ce qui mérite un regard ; chaque alerte mène au réglage qui l'explique. */
export function alertsView(s: SpState) {
  const out: string[] = [];
  const c = s.connection;
  if (!c.simulated && c.auth !== 'ok')
    out.push(
      c.auth === 'needs_reauth'
        ? 'Spotify : reconnexion nécessaire'
        : 'Spotify non connecté',
    );
  if (s.api.limited_until)
    out.push(
      `${s.api.quota_exceeded ? 'Quota Spotify dépassé' : 'Spotify limite les appels'} jusqu’à ${hhmm(s.api.limited_until)}`,
    );
  if (s.studio && !s.studio.fresh) out.push('Studio non vu par le serveur');
  if (s.local.error) out.push('Erreur côté Studio');
  return out
    .map(
      (a) =>
        `<button type="button" class="d-tag warn" data-open="connexion">${ic('warn')}${esc(a)}</button>`,
    )
    .join('');
}

// --- Ce qui joue ---------------------------------------------------------------------------------------------------------

/** La lecture relevée, tant qu'elle est assez récente pour avancer toute seule. */
function reading(s: SpState, now: number) {
  const p = s.studio?.playback;
  if (!p?.track) return null;
  const age = now - Date.parse(p.observed_at);
  return { p, track: p.track, age, stale: age > 30_000 };
}

/** Où en est le titre : la dernière lecture, avancée du temps écoulé. Null quand on ne le sait pas. */
export function position(s: SpState, now: number) {
  const r = reading(s, now);
  if (!r || r.p.progress_ms === null) return null;
  const ms =
    r.p.progress_ms + (r.p.is_playing && !r.stale ? Math.max(0, r.age) : 0);
  return {
    ms: Math.min(ms, r.track.duration_ms),
    total: r.track.duration_ms,
    live: r.p.is_playing && !r.stale,
  };
}

/** La demande qui joue et son demandeur ; un titre hors demandes n'a jamais de demandeur. */
export function nowView(s: SpState, ui: SpUi) {
  const r = s.current;
  const read = reading(s, ui.now);
  const track = r?.track ?? read?.track ?? null;
  const playing = !!read?.p.is_playing && !read.stale;
  const kicker = r
    ? 'Demande en cours'
    : !track
      ? 'Rien ne joue'
      : playing
        ? 'Hors demandes'
        : read?.stale
          ? 'Dernier titre relevé'
          : 'En pause';
  const by = r
    ? `<p class="spo-by">${pp(r.viewer.name || r.viewer.login, 22)}<span>@${esc(r.viewer.login)} · demandée ${esc(agoMs(ui.now - Date.parse(r.received_at)))}</span></p>`
    : '';
  const device = s.studio?.status.device;
  const limited = !!s.api.limited_until;
  const seen = read?.stale
    ? `<span>Lu ${esc(agoMs(read.age))}</span><button type="button" class="d-btn ghost sm" data-act="sp-refresh" ${limited || (s.local.refresh_in_ms ?? 0) > 0 ? 'disabled' : ''}>Actualiser</button>`
    : '';
  const vol = read?.p.volume_percent ?? null;
  const controls = s.settings.player_controls
    ? `<button type="button" class="d-btn" data-act="sp-play" data-play="${read?.p.is_playing ? 'pause' : 'resume'}">${read?.p.is_playing ? 'Pause' : 'Reprendre'}</button>
        <label class="spo-vol" title="Volume de l’appareil Spotify">${ic('vol')}<input type="range" min="0" max="100" step="5" data-vol value="${vol ?? 50}" aria-label="Volume"><b>${vol ?? '—'}</b></label>`
    : '';
  return `<div class="spo-art">${cover(s, track)}${playing ? '<span class="spo-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ''}</div>
    <div class="spo-meta">
      <span class="d-lb">${esc(kicker)}</span>
      <h2 class="spo-title">${track ? esc(track.title) : 'Aucune lecture relevée'}</h2>
      <p class="spo-artists">${track ? esc(track.artists.join(', ')) : 'Lance Spotify, ou actualise la lecture.'}</p>
      ${by}
      <div class="spo-trans"><span class="spo-t" data-t0></span><span class="d-prog"><i data-prog></i></span><span class="spo-t" data-t1></span></div>
      <div class="spo-sub">
        <button type="button" class="d-btn" data-act="sp-skip" title="Passe le titre en cours sur Spotify, même hors demandes">${ic('skip')}Passer la musique</button>
        ${controls}${device ? `<span>${controls ? '' : ic('vol')}${esc(device.name)}</span>` : ''}${seen || (!track ? `<button type="button" class="d-btn ghost sm" data-act="sp-refresh" ${limited || (s.local.refresh_in_ms ?? 0) > 0 ? 'disabled' : ''}>Actualiser</button>` : '')}
      </div>
    </div>`;
}

// --- La file ---------------------------------------------------------------------------------------------------------------

/** Le temps avant chaque titre de la file : ce qui reste du morceau, puis la durée de ceux d'avant. Null sans lecture connue. */
export function etas(s: SpState, now: number) {
  const pos = position(s, now);
  const out = new Map<string, number>();
  if (!pos) return { list: out, end: null as number | null };
  let at = pos.total - pos.ms;
  for (const r of s.queue) {
    if (!r.track) continue;
    out.set(r.request_id, at);
    at += r.track.duration_ms;
  }
  return { list: out, end: at };
}

/** Les demandes pas encore jouées : l'ordre de la file, puis celles en recherche et les incertaines hors file. */
export function queueRows(s: SpState, ui: SpUi) {
  const usage = new Map((s.viewers ?? []).map((v) => [v.viewer_id, v]));
  const verify = new Set(s.to_verify.map((r) => r.request_id));
  const queued = new Set(s.queue.map((r) => r.request_id));
  const when = etas(s, ui.now).list;
  const rows: [string, SpRequest][] = [
    ...s.queue.map((r, i): [string, SpRequest] => [String(i + 1), r]),
    ...[
      ...s.in_progress,
      ...s.to_verify.filter((r) => !queued.has(r.request_id)),
    ].map((r): [string, SpRequest] => ['·', r]),
  ];
  return rows.map(([pos, r]) => {
    const id = `data-id="${esc(r.request_id)}"`;
    const searching = r.state === 'RECEIVED' || r.state === 'SEARCHING';
    const toVerify = verify.has(r.request_id);
    const status = searching
      ? '<span class="d-tag off">recherche…</span>'
      : toVerify
        ? '<span class="d-tag warn" title="Spotify n’a pas confirmé l’ajout">à vérifier</span>'
        : r.state === 'UNKNOWN'
          ? '<span class="d-tag warn" title="Gardée : réclamation en attente sur Twitch">ajout non confirmé</span>'
          : '';
    const u = usage.get(r.viewer.id);
    const quota = u
      ? `${u.pending}/${u.max_pending}${u.cooldown_left_ms > 0 ? ` · ${left(u.cooldown_left_ms)}` : ''}${u.override ? ' (exception)' : ''}`
      : '—';
    const eta = when.get(r.request_id);
    const time = eta === undefined ? '' : `≈ ${clock(eta / 1000)}`;
    const acts = searching
      ? ''
      : [
          queued.has(r.request_id)
            ? `<button type="button" class="d-btn ghost sm" data-act="sp-remove" ${id} title="Le viewer est remboursé ; déjà dans la file Spotify, le titre sera passé automatiquement">Retirer et rembourser</button>`
            : '',
          queued.has(r.request_id) && r.payment === 'tokens'
            ? `<button type="button" class="d-btn ghost sm" data-act="sp-remove" data-keep="1" ${id} title="Les Jetons ne sont pas rendus (abus, contenu interdit)">Sans rembourser</button>`
            : '',
          toVerify
            ? `<button type="button" class="d-btn sm" data-act="sp-settle" data-decision="refund" ${id} title="Rend les points (récompense de Raptoru)">Rembourser</button>
               <button type="button" class="d-btn sm" data-act="sp-settle" data-decision="keep" ${id} title="Rien n’est envoyé à Twitch : la réclamation reste en attente">Garder</button>`
            : '',
        ].join('');
    return {
      key: r.request_id,
      html: `<div class="spo-r d-in ${toVerify ? 'watch' : ''}">
        <span class="spo-pos">${pos}</span>${cover(s, r.track, 'spo-cov--s')}
        <div class="spo-r__m"><b>${r.track ? esc(r.track.title) : `« ${esc(r.input)} »`}</b><small>${r.track ? esc(r.track.artists.join(', ')) : ''}</small></div>
        <span class="spo-t">${time}</span>
        <div class="spo-r__by">${pp(r.viewer.name || r.viewer.login, 18)}<span>@${esc(r.viewer.login)}</span><span class="spo-quota" title="Demandes en attente · délai restant">${esc(quota)}</span>${paidWith(r)}${status}</div>
        ${acts ? `<div class="spo-r__a">${acts}</div>` : ''}
      </div>`,
    };
  });
}

export const queueEmpty = (s: SpState) =>
  `<div class="d-empty">La file est vide.<br><small>Les viewers demandent une musique avec la récompense Twitch${s.settings.extension_enabled ? ' ou depuis l’extension' : ''}.</small>${s.sim ? '<br><button type="button" class="d-btn sm" data-open="simulateur" style="margin-top:8px">Simuler une demande</button>' : ''}</div>`;

/** La note qui explique la décision, seulement quand il y en a une à prendre. */
export const verifyNote = (s: SpState) =>
  s.to_verify.length
    ? '<p class="d-note">« À vérifier » : Spotify n’a pas confirmé l’ajout. Regarde la file dans Spotify, puis Rembourser rend les points (récompense de Raptoru) ; Garder ne change rien sur Twitch, la réclamation reste en attente.</p>'
    : '';

function resultOf(r: SpRequest) {
  const by = (x: string) => (x === 'studio' ? ' depuis Studio' : ` par @${x}`);
  const who = r.canceled_by
    ? ' par le viewer'
    : r.removed_by
      ? by(r.removed_by)
      : r.skipped_by
        ? by(r.skipped_by)
        : '';
  const ok = ['QUEUED', 'PLAYING', 'PLAYED', 'SKIPPED'].includes(r.state);
  const tone = ok
    ? 'ok'
    : r.state === 'UNKNOWN'
      ? 'warn'
      : r.state === 'RECEIVED' || r.state === 'SEARCHING'
        ? 'off'
        : 'bad';
  const why = r.reason && REASONS[r.reason] ? REASONS[r.reason] : '';
  const twitch =
    r.payment === 'tokens'
      ? r.refund_status === 'refunded'
        ? 'Jetons remboursés'
        : r.refund_status === 'kept'
          ? 'Jetons gardés'
          : ''
      : r.twitch_status
        ? TWITCH[r.twitch_status]
        : r.source === 'twitch' && !['RECEIVED', 'SEARCHING'].includes(r.state)
          ? 'réclamation en attente sur Twitch'
          : '';
  const skip = r.auto_skip
    ? `passée automatiquement : ${r.auto_skip_result === 'SKIPPED' ? 'oui' : (r.auto_skip_result ?? 'en attente')}`
    : '';
  return {
    tone,
    head: `${STATES[r.state] ?? r.state}${who}`,
    detail: [r.track ? trackLabel(r.track) : '', why, skip, twitch]
      .filter(Boolean)
      .join(' · '),
  };
}

/** Ce que sont devenues les dernières demandes : refus et raison, annulations, retraits, remboursements. */
export function historyRows(s: SpState) {
  return s.recent.map((r) => {
    const x = resultOf(r);
    return {
      key: r.request_id,
      html: `<div class="spo-h"><span class="spo-t">${esc(hhmm(r.received_at))}</span>
        <div class="spo-r__m"><b>${r.source === 'simulation' ? '<span class="d-tag off">Lab</span> ' : r.source === 'extension' ? '<span class="d-tag">Extension</span> ' : ''}@${esc(r.viewer.login)}</b><small>${esc(r.input)}</small></div>
        <span class="d-tag ${x.tone}">${esc(x.head)}</span>
        ${x.detail ? `<p>${esc(x.detail)}</p>` : ''}</div>`,
    };
  });
}

/** La frise du temps : les titres de la file posés sur une règle graduée, à partir de maintenant. */
export function timeView(s: SpState, ui: SpUi) {
  const { list, end } = etas(s, ui.now);
  const unknown = !position(s, ui.now);
  const blocks = s.queue.filter((r) => r.track);
  const total = end ?? blocks.reduce((n, r) => n + r.track!.duration_ms, 0);
  const span = Math.max(10 * 60_000, total);
  const step = span > 45 * 60_000 ? 15 : span > 20 * 60_000 ? 10 : 5;
  const pct = (ms: number) => (ms / span) * 100;
  let at = 0;
  const html = blocks
    .map((r, i) => {
      const from = list.get(r.request_id) ?? at;
      at = from + r.track!.duration_ms;
      return `<span class="spo-b ${i % 2 ? 'alt' : ''}" style="left:${pct(from).toFixed(2)}%;width:${pct(r.track!.duration_ms).toFixed(2)}%" title="${esc(`${trackLabel(r.track)} · @${r.viewer.login}`)}">${esc(r.track!.title)}</span>`;
    })
    .join('');
  let ticks = '';
  for (let m = 0; m * 60_000 <= span; m += step)
    ticks += `<i style="left:${pct(m * 60_000).toFixed(2)}%"><span>${m ? `${m} min` : 'maintenant'}</span></i>`;
  const summary = blocks.length
    ? `${plural(blocks.length, 'titre')} · fin ${unknown ? 'inconnue' : `dans ≈ ${clock(total / 1000)}`}`
    : 'Rien de prévu';
  return `<div class="spo-tl__h"><span class="d-lb">La file dans le temps</span><span class="spo-t">${summary}</span></div>
    <div class="spo-tl__r">${html}</div><div class="spo-tl__t">${ticks}</div>`;
}

/** Les demandeurs du moment et ce qu'il leur reste, tels que l'admission les applique (rien si le Core ne les donne pas). */
export function quotasView(s: SpState) {
  const list = s.viewers ?? [];
  if (!list.length) return '';
  return `<span class="d-lb">Quotas</span><div class="spo-who">${list
    .map((u) => {
      const dots = Array.from(
        { length: u.max_pending },
        (_, i) => `<i class="${i < u.pending ? 'on' : ''}"></i>`,
      ).join('');
      return `<span class="spo-u" title="${u.pending} sur ${u.max_pending} en attente${u.override ? ', exception' : ''}">${pp(u.login, 20)}<b>${esc(u.login)}</b><span class="spo-dots">${dots}</span>${u.cooldown_left_ms > 0 ? `<small>${esc(left(u.cooldown_left_ms))}</small>` : ''}${u.override ? '<small>exception</small>' : ''}</span>`;
    })
    .join('')}</div>`;
}

/** Une ligne : la file, ce qui attend une décision, les demandes du jour (« — » tant que le Core ne les donne pas). */
export function countsView(s: SpState) {
  const t = s.today;
  const detail = t
    ? [
        plural(t.played, 'jouée'),
        plural(t.refused, 'refusée'),
        plural(t.canceled, 'annulée'),
        plural(t.removed, 'retirée'),
        plural(t.refunded, 'remboursée'),
      ].filter((x) => !x.startsWith('0 '))
    : [];
  const today = t
    ? `${t.received} aujourd’hui${detail.length ? ` (${detail.join(', ')})` : ''}`
    : 'aujourd’hui : —';
  const g = s.settings;
  return `<span><b>${s.queue.length} en file</b> · ${s.to_verify.length} à vérifier · ${esc(today)}</span>
    <button type="button" class="spo-rules" data-open="quotas" title="Voir les quotas">${g.max_pending_per_viewer} en attente par viewer · ${minutes(g.viewer_cooldown_seconds)} entre deux · ${minutes(g.max_duration_seconds)} au plus</button>`;
}
