import {
  rewardPanel,
  settingsPanel,
  simPanel,
  techPanel,
  viewersPanel,
} from './spotify-panels.js';
import {
  type SpRequest,
  type SpState,
  type SpTab,
  type SpUi,
  REASONS,
  STATES,
  TWITCH,
  ago,
  chip,
  clock,
  esc,
  mmss,
  trackLabel,
} from './spotify-ui.js';

// Spotify V2 — Studio « Musique (Spotify) » section (pure part, tested; docs/SPOTIFY_V2.md § 6). The main space is the
// stream's: what plays and who asked for it, the queue and its moderation, the requests to settle, the last requests.
// Settings, viewers' exceptions, Raptoru's Twitch reward, the Spotify connection and the diagnostics have their own
// spaces (spotify-panels.ts). Every Twitch / Spotify text is escaped.

export type {
  SpIdentity,
  SpRequest,
  SpState,
  SpTab,
  SpUi,
} from './spotify-ui.js';

/** While Studio follows the playback it reads every 1–2.5 s on a request, every 30 s on a track outside the requests:
 *  a reading older than this is « non suivie ». */
export const LIVE_MS = 35_000;

/** One line telling whether requests come in, and why not. */
function opening(s: SpState) {
  const on = s.settings.enabled;
  const ready = s.admission === 'ready';
  const [cls, title, sub] = !on
    ? [
        'off',
        'Demandes fermées',
        'La récompense est refusée et remboursée (si elle est celle de Raptoru).',
      ]
    : ready
      ? [
          'on',
          'Demandes ouvertes',
          'Les rédemptions sont cherchées puis ajoutées à la file Spotify.',
        ]
      : [
          'warn',
          'Demandes ouvertes mais refusées',
          `Raison : ${REASONS[s.admission] ?? s.admission}. Voir Connexion et diagnostic.`,
        ];
  return `<div class="sp-head">
      <div class="sp-open sp-open--${cls}"><span class="sp-dot"></span><div><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>
      <button type="button" class="${on ? '' : 'primary'}" data-act="sp-switch">${on ? 'Fermer les demandes' : 'Ouvrir les demandes'}</button>
    </div>`;
}

/** Problems worth an eye, each leading to the space that explains it. */
function alerts(s: SpState) {
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
      `${s.api.quota_exceeded ? 'Quota Spotify dépassé' : 'Spotify limite les appels'} jusqu’à ${clock(s.api.limited_until)}`,
    );
  if (s.studio && !s.studio.fresh) out.push('Studio non vu par le Core');
  if (s.local.error) out.push('Erreur côté Studio');
  if (!out.length) return '';
  return `<div class="sp-alerts">${out
    .map(
      (a) =>
        `<button type="button" class="sp-alert" data-tab="tech">⚠ ${esc(a)}</button>`,
    )
    .join('')}</div>`;
}

function tabs(s: SpState, ui: SpUi) {
  const waiting = s.queue.length + s.in_progress.length;
  const list: [SpTab, string, string][] = [
    ['live', 'Lecture', waiting ? String(waiting) : ''],
    [
      'viewers',
      'Viewers',
      s.overrides?.length ? String(s.overrides.length) : '',
    ],
    ['settings', 'Réglages', ''],
    ['reward', 'Récompense Twitch', s.managed_rewards.length ? '' : '!'],
    ['tech', 'Connexion et diagnostic', ''],
    ...(s.sim
      ? ([['sim', 'Simulateur (Lab)', '']] as [SpTab, string, string][])
      : []),
  ];
  return `<nav class="sp-tabs" role="tablist">${list
    .map(
      ([id, label, n]) =>
        `<button type="button" role="tab" aria-selected="${ui.tab === id}" class="${ui.tab === id ? 'on' : ''}" data-tab="${id}">${esc(label)}${n ? `<em>${esc(n)}</em>` : ''}</button>`,
    )
    .join('')}</nav>`;
}

/** What plays, who asked for it, how fresh that is. Never extrapolated from an old reading. */
function nowPlaying(s: SpState, ui: SpUi) {
  const p = s.studio?.playback ?? null;
  const age = p ? ui.now - Date.parse(p.observed_at) : Infinity;
  const live = s.local.watching && age <= LIVE_MS;
  const refreshDisabled =
    Boolean(s.api.limited_until) || (s.local.refresh_in_ms ?? 0) > 0;
  const refresh = `<button type="button" class="cp-ghost" data-act="sp-refresh" ${refreshDisabled ? 'disabled' : ''} title="Une lecture de Spotify maintenant (au plus toutes les 5 s)">Actualiser</button>`;
  const freshness = !p
    ? `<p class="sp-fresh sp-fresh--stale">Aucune lecture connue : Studio ne lit Spotify que lorsqu’une demande est en file
        ou en cours (pour économiser les appels). ${refresh}</p>`
    : live
      ? `<p class="sp-fresh"><span class="sp-live">● Suivi en direct</span> · lu ${esc(ago(age))}</p>`
      : `<p class="sp-fresh sp-fresh--stale"><b>Lecture non suivie</b> · dernière lecture à ${esc(clock(p.observed_at))}
          (${esc(ago(age))}). ${
            s.local.watching
              ? 'Spotify ne répond pas pour l’instant.'
              : 'Rien à suivre (aucune demande en file ou en cours) : ce titre a pu changer depuis.'
          } ${refresh}</p>`;
  if (!p?.track)
    return `<section class="sp-now sp-now--empty"><div class="sp-now__label">En cours</div>
        <div class="sp-now__title">${p ? 'Rien ne joue sur Spotify' : 'Lecture inconnue'}</div>${freshness}</section>`;
  const t = p.track;
  const mine = s.current && s.current.track?.uri === t.uri ? s.current : null;
  const progress =
    p.progress_ms === null
      ? null
      : Math.min(
          t.duration_ms,
          p.progress_ms + (live && p.is_playing ? age : 0),
        );
  const pct = progress === null ? 0 : (progress / t.duration_ms) * 100;
  return `<section class="sp-now${live ? '' : ' sp-now--stale'}">
      <div class="sp-now__label">${live ? (p.is_playing ? 'En cours' : 'En pause') : 'Dernier titre lu'}</div>
      <div class="sp-now__main">
        <div class="sp-now__text">
          <div class="sp-now__title">${esc(t.title)}</div>
          <div class="sp-now__artist">${esc(t.artists.join(', '))}</div>
          <div class="sp-now__by">${
            mine
              ? `Demandé par <b>@${esc(mine.viewer.login)}</b>`
              : '<span class="cp-muted">Hors demandes (playlist ou lecture manuelle)</span>'
          }</div>
        </div>
        <div class="sp-now__actions"><button type="button" data-act="sp-skip" title="Passe le titre en cours sur Spotify">Passer la musique</button></div>
      </div>
      ${
        progress === null
          ? ''
          : `<div class="sp-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
        <div class="sp-times"><span>${mmss(progress)}</span><span>${mmss(t.duration_ms)}</span></div>`
      }
      ${freshness}
    </section>`;
}

function toVerify(s: SpState) {
  if (!s.to_verify.length) return '';
  return `<section class="sp-verify"><h3>À vérifier (${s.to_verify.length})</h3>
    <p class="cp-muted">Spotify n’a pas confirmé l’ajout. Regarde la file dans Spotify, puis : « Rembourser » rend les
      points (récompense de Raptoru) ; « Garder » ne change rien sur Twitch (réclamation en attente, à valider ou
      rembourser depuis Twitch).</p>
    ${s.to_verify
      .map(
        (
          r,
        ) => `<div class="sp-row"><div class="sp-row__main"><b>${esc(trackLabel(r.track))}</b><small>@${esc(r.viewer.login)} · ${esc(clock(r.received_at))}</small></div>
        <div class="sp-row__act"><button type="button" data-act="sp-settle" data-decision="refund" data-id="${esc(r.request_id)}">Rembourser</button>
        <button type="button" data-act="sp-settle" data-decision="keep" data-id="${esc(r.request_id)}">Garder</button></div></div>`,
      )
      .join('')}</section>`;
}

function queue(s: SpState) {
  const rows = [...s.queue, ...s.in_progress];
  const body = rows.length
    ? rows
        .map((r, i) => {
          const searching = r.state === 'RECEIVED' || r.state === 'SEARCHING';
          const tag = searching
            ? chip('off', 'recherche…')
            : r.state === 'UNKNOWN'
              ? chip('warn', 'ajout non confirmé')
              : '';
          return `<div class="sp-row"><span class="sp-pos">${i + 1}</span>
            <div class="sp-row__main"><b>${r.track ? esc(trackLabel(r.track)) : `« ${esc(r.input)} »`}</b><small>@${esc(r.viewer.login)} · ${esc(clock(r.queued_at ?? r.received_at))} ${tag}</small></div>
            <div class="sp-row__act">${
              searching
                ? ''
                : `<button type="button" data-act="sp-remove" data-id="${esc(r.request_id)}" title="Retire la demande et rembourse le viewer ; si elle est déjà dans la file Spotify, elle sera passée automatiquement">Retirer</button>`
            }</div></div>`;
        })
        .join('')
    : '<p class="sp-empty">Aucune demande en attente. Les viewers demandent avec la récompense « Choisi la prochaine musique ! ».</p>';
  return `<section><h3>File d’attente${rows.length ? ` (${rows.length})` : ''}</h3>${body}
    <p class="cp-muted">Retirer rembourse la demande (récompense de Raptoru) et la passe automatiquement quand Spotify
      l’atteint. Commandes : <code>!song</code>, <code>!songqueue</code>, <code>!mysong</code>, <code>!songcancel</code> ;
      modérateurs : <code>!songremove</code>, <code>!songskip</code>.</p></section>`;
}

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
    ? 'done'
    : r.state === 'UNKNOWN'
      ? 'partial'
      : r.state === 'RECEIVED' || r.state === 'SEARCHING'
        ? 'pending'
        : 'failed';
  const why = r.reason && REASONS[r.reason] ? REASONS[r.reason] : '';
  const twitch = r.twitch_status
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

function recent(s: SpState) {
  if (!s.recent.length) return '';
  const row = (r: SpRequest) => {
    const x = resultOf(r);
    return `<tr class="cp-row--${x.tone}"><td>${esc(clock(r.received_at))}</td><td>${r.source === 'simulation' ? '<i>Lab</i> ' : ''}@${esc(r.viewer.login)}</td>
      <td><small>${esc(r.input)}</small></td><td><b>${esc(x.head)}</b><br><small>${esc(x.detail)}</small></td></tr>`;
  };
  const head =
    '<thead><tr><th>Heure</th><th>Viewer</th><th>Demande</th><th>Résultat</th></tr></thead>';
  return `<section><h3>Dernières demandes</h3>
    <table class="cp-history">${head}<tbody>${s.recent.slice(0, 6).map(row).join('')}</tbody></table>
    ${
      s.recent.length > 6
        ? `<details class="sp-more"><summary>Historique complet (${s.recent.length})</summary><table class="cp-history">${head}<tbody>${s.recent.slice(6).map(row).join('')}</tbody></table></details>`
        : ''
    }</section>`;
}

function livePanel(s: SpState, ui: SpUi) {
  return `${nowPlaying(s, ui)}${toVerify(s)}${queue(s)}${recent(s)}`;
}

/** The whole section. */
export function spotifyView(s: SpState | null, error: string | null, ui: SpUi) {
  if (error) return `<p class="cp-error">${esc(error)}</p>`;
  if (!s) return '<p class="cp-muted">Chargement…</p>';
  const tab = ui.tab === 'sim' && !s.sim ? 'live' : ui.tab;
  const body =
    tab === 'viewers'
      ? viewersPanel(s, ui)
      : tab === 'settings'
        ? settingsPanel(s, ui)
        : tab === 'reward'
          ? rewardPanel(s, ui)
          : tab === 'tech'
            ? techPanel(s, ui)
            : tab === 'sim'
              ? simPanel(s, ui)
              : livePanel(s, ui);
  return `<div class="sp">${opening(s)}${alerts(s)}${tabs(s, { ...ui, tab })}<div class="sp-body">${body}</div></div>`;
}
