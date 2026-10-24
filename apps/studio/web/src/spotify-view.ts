// Spotify V2 — Studio section « Musique (Spotify) » (pure part, tested; docs/SPOTIFY_V2.md § 6): connection, what plays,
// the logical queue with its moderation, the uncertain requests to settle, the settings, the reward Raptoru owns and
// its refunds, the history. Lab: the simulator's controls and a viewer's request without Twitch. Every Twitch / Spotify
// text is escaped.

export interface SpTrack {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  duration_ms: number;
}

export interface SpRequest {
  request_id: string;
  source: 'twitch' | 'simulation';
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
}

export interface SpState {
  environment: 'lab' | 'production';
  settings: {
    enabled: boolean;
    max_pending_per_viewer: number;
    viewer_cooldown_seconds: number;
    max_duration_seconds: number;
    cancel_grace_seconds: number;
  };
  admission: string;
  studio: {
    fresh: boolean;
    playback: {
      observed_at: string;
      track: SpTrack | null;
      progress_ms: number | null;
      is_playing: boolean;
    } | null;
    status: { device: { name: string; type: string } | null };
  } | null;
  current: SpRequest | null;
  queue: SpRequest[];
  in_progress: SpRequest[];
  to_verify: SpRequest[];
  recent: SpRequest[];
  twitch_actions: {
    kind: string;
    status: string;
    error: string | null;
    payload: { redemption_id?: string; status?: string };
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
  };
  local: { error: string | null; watching: boolean; fast_lane: boolean };
  sim: {
    device_active: boolean;
    queue_answer: number;
    limited: boolean;
    current: string | null;
    progress_ms: number | null;
    queue: string[];
    calls: number;
  } | null;
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const chip = (cls: string, text: string, title = '') =>
  `<span class="cp-chip cp-chip--${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('fr-FR') : '';
const mmss = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
export const trackLabel = (t: SpTrack | null) =>
  t ? `${t.title} — ${t.artists.join(', ')}` : '—';

/** Why a request did not go through (Core / Studio codes → the panel's words). */
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
  MODULE_DISABLED: 'module coupé',
  STUDIO_UNAVAILABLE: 'Studio absent',
  STUDIO_LOST: 'Studio perdu pendant le traitement',
  LATE: 'rédemption trop ancienne',
  INTERRUPTED: 'interrompue par une autre demande',
  INTERRUPTED_EXTERNAL: 'interrompue par un autre titre',
};

const STATES: Record<string, string> = {
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

const TWITCH: Record<string, string> = {
  cancel_requested: 'remboursement demandé',
  kept: 'gardée : réclamation en attente sur Twitch',
  unmanaged: 'remboursement impossible (récompense non créée par Raptoru)',
  none: '',
};

/** Connection, Spotify's state and Studio's watch: one line of chips. */
function statusLine(s: SpState) {
  const c = s.connection;
  const auth = c.simulated
    ? chip('on', 'Spotify : simulateur du Lab')
    : c.auth === 'ok'
      ? chip(
          'ok',
          `Spotify : ${c.account?.name ?? 'connecté'}${c.account?.product && c.account.product !== 'premium' ? ' (pas Premium !)' : ''}`,
        )
      : chip(
          'warn',
          c.auth === 'needs_reauth'
            ? 'Spotify : reconnexion nécessaire'
            : 'Spotify : non connecté',
        );
  const admission =
    s.admission === 'ready'
      ? chip('ok', 'Demandes : acceptées')
      : chip(
          s.admission === 'MODULE_DISABLED' ? 'off' : 'warn',
          `Demandes refusées : ${REASONS[s.admission] ?? s.admission}`,
        );
  const limited = s.api.limited_until
    ? chip(
        'warn',
        `${s.api.quota_exceeded ? 'Quota Spotify dépassé' : 'Spotify limité'} jusqu’à ${time(s.api.limited_until)}`,
      )
    : '';
  const device = s.studio?.status.device
    ? chip('ok', `Appareil : ${s.studio.status.device.name}`)
    : chip('off', 'Appareil : inconnu');
  const calls = chip(
    s.api.rate_high ? 'warn' : 'off',
    `${s.api.calls_last_minute} appels Spotify / min`,
  );
  const watch = s.local.fast_lane
    ? chip('on', 'Surveillance rapide (passage d’une demande annulée)')
    : chip(
        s.local.watching ? 'on' : 'off',
        s.local.watching
          ? 'Lecture surveillée'
          : 'Lecture non surveillée (rien à suivre)',
      );
  return `<div class="cp-status">${admission} ${auth} ${limited} ${device} ${calls} ${watch}${
    s.local.error ? ` ${chip('warn', 'Erreur Studio', s.local.error)}` : ''
  }</div>`;
}

function connectionBlock(s: SpState) {
  const c = s.connection;
  if (c.simulated)
    return `<p class="cp-muted">Lab : Spotify est simulé (jamais ton compte ni ta vraie file). Le vrai Spotify n’est utilisé
      que dans le profil Production.</p>`;
  return `<p class="cp-muted">Connexion sur ce PC uniquement (jeton chiffré par Windows). Dans le tableau de bord Spotify
      de l’application Raptoru, l’adresse de redirection doit être exactement <code>${esc(c.redirect_uri)}</code>.</p>
    <div class="cp-buttons">
      <label class="cp-inline">Client ID <input data-f="sp-client" size="34" value="${esc(c.client_id ?? '')}" placeholder="32 caractères"></label>
      <button type="button" data-act="sp-connect">${c.auth === 'not_configured' ? 'Connecter Spotify' : 'Reconnecter'}</button>
      ${c.auth === 'not_configured' ? '' : '<button type="button" data-act="sp-disconnect">Déconnecter</button>'}
    </div>`;
}

function nowPlaying(s: SpState) {
  const p = s.studio?.playback;
  if (!p?.track)
    return '<p class="cp-muted">Rien en cours (ou titre non lu : la lecture n’est lue que s’il y a une demande à suivre).</p>';
  const by = s.current
    ? ` · demandé par <b>@${esc(s.current.viewer.login)}</b>`
    : ' · hors demandes';
  return `<p><b>${esc(trackLabel(p.track))}</b> <small class="cp-muted">${p.progress_ms !== null ? mmss(p.progress_ms) : ''} / ${mmss(p.track.duration_ms)} (lu à ${time(p.observed_at)})${by}</small>
    <button type="button" data-act="sp-skip" title="Passe la musique en cours sur Spotify">Passer la musique</button></p>`;
}

function queueTable(s: SpState) {
  const rows = [...s.in_progress, ...s.queue];
  if (!rows.length) return '<p class="cp-muted">Aucune demande en attente.</p>';
  return `<table class="cp-history"><thead><tr><th>#</th><th>Titre</th><th>Viewer</th><th>État</th><th></th></tr></thead><tbody>${rows
    .map(
      (
        r,
        i,
      ) => `<tr><td>${i + 1}</td><td>${r.track ? esc(trackLabel(r.track)) : `<i>${esc(r.input)}</i>`}</td><td>@${esc(r.viewer.login)}</td>
        <td>${esc(STATES[r.state] ?? r.state)}${r.state === 'UNKNOWN' ? ' <small>(ajout non confirmé)</small>' : ''}</td>
        <td>${r.state === 'QUEUED' || r.state === 'UNKNOWN' ? `<button type="button" data-act="sp-remove" data-id="${esc(r.request_id)}" title="Retire la demande (remboursée si possible) ; si elle est déjà dans la file Spotify, elle sera passée automatiquement">Retirer</button>` : ''}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function toVerify(s: SpState) {
  if (!s.to_verify.length) return '';
  return `<h3>À vérifier</h3><p class="cp-muted">Spotify n’a pas confirmé l’ajout. Regarde la file Spotify puis décide :
      « Rembourser » (rendu si la récompense est celle de Raptoru) ou « Garder » (rien n’est envoyé à Twitch : la réclamation reste en attente, à valider ou rembourser depuis Twitch).</p>
    <table class="cp-history"><tbody>${s.to_verify
      .map(
        (
          r,
        ) => `<tr><td>${time(r.received_at)}</td><td>@${esc(r.viewer.login)}</td><td>${esc(trackLabel(r.track))}</td>
        <td><button type="button" data-act="sp-settle" data-decision="refund" data-id="${esc(r.request_id)}">Rembourser</button>
        <button type="button" data-act="sp-settle" data-decision="keep" data-id="${esc(r.request_id)}">Garder</button></td></tr>`,
      )
      .join('')}</tbody></table>`;
}

function settingsForm(s: SpState) {
  const v = s.settings;
  return `<div class="cp-buttons">
      <label class="cp-inline">Demandes en attente par viewer <input type="number" data-f="sp-pending" min="1" max="10" value="${v.max_pending_per_viewer}"></label>
      <label class="cp-inline">Délai entre deux demandes (min) <input type="number" data-f="sp-cooldown" min="0" max="60" value="${v.viewer_cooldown_seconds / 60}"></label>
      <label class="cp-inline">Durée max d’un titre (min) <input type="number" data-f="sp-duration" min="1" max="30" value="${v.max_duration_seconds / 60}"></label>
      <label class="cp-inline">Annulation de sa musique en cours (s) <input type="number" data-f="sp-grace" min="0" max="60" value="${v.cancel_grace_seconds}"></label>
      <button type="button" data-act="sp-save">Enregistrer</button>
    </div>`;
}

function rewardBlock(s: SpState) {
  const managed = s.managed_rewards.length
    ? `<p>Récompense gérée par Raptoru : ${s.managed_rewards.map((r) => `<b>${esc(r.title)}</b> (${r.cost} points)`).join(', ')} —
        les demandes refusées ou annulées sont remboursées sur Twitch.</p>`
    : `<p class="cp-muted">Aucune récompense créée par Raptoru : Twitch ne laisse rembourser que l’application qui a créé la
        récompense (l’ancienne vient de SAMMI). Sans elle, rien n’est remboursé automatiquement.</p>
      <div class="cp-buttons"><label class="cp-inline">Texte affiché au viewer <input data-f="sp-prompt" size="40" value="Titre + artiste, ou lien Spotify"></label>
      <button type="button" data-act="sp-reward" title="Crée sur Twitch « Choisi la prochaine musique ! » (1 000 points, texte obligatoire)">Créer la récompense Raptoru</button></div>`;
  const actions = s.twitch_actions.slice(0, 5);
  return `${managed}${
    actions.length
      ? `<small class="cp-muted">Dernières actions Twitch : ${actions
          .map(
            (a) =>
              `${time(a.created_at)} ${a.kind === 'reward_create' ? 'création' : (a.payload.status ?? '')} → ${a.status}${a.error ? ` (${a.error})` : ''}`,
          )
          .map(esc)
          .join(' · ')}</small>`
      : ''
  }`;
}

export interface SpIdentity {
  id: string;
  label: string;
  login?: string;
}

function simBlock(s: SpState, who: SpIdentity[]) {
  const m = s.sim;
  if (!m) return '';
  return `<h3>Simulateur (Lab)</h3>
    <p class="cp-muted">Joue : ${esc(m.current ?? 'rien')}${m.progress_ms !== null ? ` (${mmss(m.progress_ms)})` : ''} · file Spotify : ${esc(m.queue.join(', ') || 'vide')} ·
      ${m.calls} appels reçus${m.limited ? ' · <b>limité (429)</b>' : ''}${m.device_active ? '' : ' · <b>aucun appareil</b>'}${m.queue_answer !== 204 ? ` · prochain ajout : réponse ${m.queue_answer}` : ''}</p>
    <div class="cp-buttons">
      <label class="cp-inline">Viewer <select data-f="sp-sim-who">${who
        .map(
          (i) =>
            `<option value="${esc(i.id)}" data-login="${esc(i.login ?? '')}">${esc(i.label)}</option>`,
        )
        .join('')}</select></label>
      <label class="cp-inline">Demande <input data-f="sp-sim-text" size="30" value="numb linkin park"></label>
      <button type="button" data-act="sp-simulate">Simuler une demande</button>
    </div>
    <div class="cp-buttons">
      <button type="button" data-act="sp-sim" data-what="near-end">Fin du titre (3 s)</button>
      <button type="button" data-act="sp-sim" data-what="external">Titre hors demandes</button>
      <button type="button" data-act="sp-sim" data-what="${m.device_active ? 'no-device' : 'device'}">${m.device_active ? 'Couper l’appareil' : 'Rallumer l’appareil'}</button>
      <button type="button" data-act="sp-sim" data-what="rate-limit">Limite 429 (30 s)</button>
      <button type="button" data-act="sp-sim" data-what="answer-200">Prochain ajout : 200</button>
      <button type="button" data-act="sp-sim" data-what="answer-500">Prochain ajout : 500</button>
    </div>`;
}

function history(s: SpState) {
  if (!s.recent.length) return '<p class="cp-muted">Aucune demande.</p>';
  return `<table class="cp-history"><thead><tr><th>Heure</th><th>Viewer</th><th>Demande</th><th>Résultat</th></tr></thead><tbody>${s.recent
    .map((r) => {
      const ok = ['QUEUED', 'PLAYING', 'PLAYED', 'SKIPPED'].includes(r.state);
      const by = (x: string) =>
        x === 'studio' ? ' depuis Studio' : ` par @${x}`;
      const who = r.canceled_by
        ? ' par le viewer'
        : r.removed_by
          ? by(r.removed_by)
          : r.skipped_by
            ? by(r.skipped_by)
            : '';
      const skip = r.auto_skip
        ? ` · passage auto : ${r.auto_skip_result ?? 'en attente'}`
        : '';
      const twitch = r.twitch_status
        ? TWITCH[r.twitch_status]
        : r.source === 'twitch' &&
            r.state !== 'RECEIVED' &&
            r.state !== 'SEARCHING'
          ? 'réclamation en attente sur Twitch (à valider ou rembourser depuis Twitch)'
          : '';
      return `<tr class="cp-row--${ok ? 'done' : r.state === 'UNKNOWN' ? 'partial' : r.state === 'RECEIVED' || r.state === 'SEARCHING' ? 'pending' : 'failed'}">
        <td>${time(r.received_at)}</td><td>${r.source === 'simulation' ? '<i>Lab</i> ' : ''}@${esc(r.viewer.login)}</td>
        <td><small>${esc(r.input)}</small></td>
        <td><b>${esc(STATES[r.state] ?? r.state)}</b>${who ? esc(who) : ''}<br><small>${r.track ? esc(trackLabel(r.track)) : ''}${
          r.reason && REASONS[r.reason]
            ? ` ${r.track ? '· ' : ''}${esc(REASONS[r.reason])}`
            : ''
        }${esc(skip)}${twitch ? `<br>${esc(twitch)}` : ''}</small></td></tr>`;
    })
    .join('')}</tbody></table>`;
}

/** The whole section. */
export function spotifyView(
  s: SpState | null,
  error: string | null,
  who: SpIdentity[] = [],
) {
  if (error) return `<p class="cp-error">${esc(error)}</p>`;
  if (!s) return '<p class="cp-muted">Chargement…</p>';
  return `<div class="cp-buttons"><button type="button" data-act="sp-switch">${s.settings.enabled ? 'Couper les demandes' : 'Activer les demandes'}</button></div>
    ${statusLine(s)}
    ${connectionBlock(s)}
    <p class="cp-muted">Récompense « Choisi la prochaine musique ! » → règle avec l’interaction native « Demande de musique ».
      Commandes : !song, !songqueue, !mysong, !songcancel ; modérateurs : !songremove, !songskip (réponses par LeCroupier_).</p>
    <h3>En cours</h3>${nowPlaying(s)}
    <h3>File</h3>${queueTable(s)}
    ${toVerify(s)}
    <h3>Réglages</h3>${settingsForm(s)}
    <h3>Récompense et remboursements</h3>${rewardBlock(s)}
    ${simBlock(s, who)}
    <h3>Historique</h3>${history(s)}`;
}
