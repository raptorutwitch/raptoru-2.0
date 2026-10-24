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
  trackLabel,
} from './spotify-ui.js';

// Spotify V2 — Studio « Musique (Spotify) » section (pure part, tested; docs/SPOTIFY_V2.md § 6). The main space,
// « File musicale », is the viewers' requests: the one playing, the queue with each requester's limits, what to settle,
// their moderation, the last decisions (folded). Spotify's own playback (progress, freshness) is in the diagnostics.
// Settings, viewers' exceptions, Raptoru's Twitch reward, the Spotify connection and the diagnostics have their own
// spaces (spotify-panels.ts). Every Twitch / Spotify text is escaped.

export type {
  SpIdentity,
  SpRequest,
  SpState,
  SpTab,
  SpUi,
} from './spotify-ui.js';

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
    ['live', 'File musicale', waiting ? String(waiting) : ''],
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

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
/** « encore 6 min », « encore 40 s ». */
const left = (ms: number) =>
  ms >= 60_000
    ? `encore ${Math.ceil(ms / 60_000)} min`
    : `encore ${Math.ceil(ms / 1000)} s`;

/** The request playing, with its requester; nothing for a track outside the requests (no progress bar). */
function playing(s: SpState, ui: SpUi) {
  const r = s.current;
  if (!r) return '';
  return `<section class="sp-playing"><span class="sp-playing__icon" aria-hidden="true">▶</span>
      <div class="sp-row__main"><b>${esc(trackLabel(r.track))}</b><small>@${esc(r.viewer.login)} · demandée ${esc(ago(ui.now - Date.parse(r.received_at)))}</small></div>
      <div class="sp-row__act"><button type="button" data-act="sp-skip" title="Passe le titre en cours sur Spotify">Passer</button></div></section>`;
}

/** One line: the queue, what needs a decision, today's requests (« — » while Core does not give them). */
function counters(s: SpState) {
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
  // Without a request playing, the skip stays at hand (a track of the playlist).
  const skip = s.current
    ? ''
    : '<button type="button" class="cp-ghost" data-act="sp-skip" title="Passe le titre en cours sur Spotify (même hors demandes)">Passer la musique</button>';
  return `<div class="sp-counts"><span><b>${s.queue.length} en file</b> · ${s.to_verify.length} à vérifier · ${esc(today)}</span>${skip}</div>`;
}

/** The requests not played yet: queue order, then those being searched and the uncertain ones outside the queue. */
function requests(s: SpState) {
  const usage = new Map((s.viewers ?? []).map((v) => [v.viewer_id, v]));
  const verify = new Set(s.to_verify.map((r) => r.request_id));
  const queued = new Set(s.queue.map((r) => r.request_id));
  const rows: [string, SpRequest][] = [
    ...s.queue.map((r, i): [string, SpRequest] => [String(i + 1), r]),
    ...[
      ...s.in_progress,
      ...s.to_verify.filter((r) => !queued.has(r.request_id)),
    ].map((r): [string, SpRequest] => ['·', r]),
  ];
  const id = (r: SpRequest) => `data-id="${esc(r.request_id)}"`;
  const row = ([pos, r]: [string, SpRequest]) => {
    const searching = r.state === 'RECEIVED' || r.state === 'SEARCHING';
    const toVerify = verify.has(r.request_id);
    const status = searching
      ? chip('off', 'recherche…')
      : toVerify
        ? chip('warn', 'à vérifier', 'Spotify n’a pas confirmé l’ajout')
        : r.state === 'UNKNOWN'
          ? chip(
              'warn',
              'ajout non confirmé',
              'Gardée : réclamation en attente sur Twitch',
            )
          : chip('on', 'en file');
    const u = usage.get(r.viewer.id);
    const quota = u
      ? `${u.pending}/${u.max_pending}${u.cooldown_left_ms > 0 ? ` · ${left(u.cooldown_left_ms)}` : ''}${u.override ? ' (exception)' : ''}`
      : '—';
    const acts = [
      queued.has(r.request_id)
        ? `<button type="button" data-act="sp-remove" ${id(r)} title="Retire la demande et rembourse le viewer ; si elle est déjà dans la file Spotify, elle sera passée automatiquement">Retirer</button>`
        : '',
      toVerify
        ? `<button type="button" data-act="sp-settle" data-decision="refund" ${id(r)} title="Rend les points (récompense de Raptoru)">Rembourser</button>
          <button type="button" data-act="sp-settle" data-decision="keep" ${id(r)} title="Rien n’est envoyé à Twitch : réclamation en attente">Garder</button>`
        : '',
    ].join('');
    return `<tr><td class="sp-pos">${pos}</td><td><b>${r.track ? esc(trackLabel(r.track)) : `« ${esc(r.input)} »`}</b></td>
      <td>@${esc(r.viewer.login)}</td><td>${status}</td><td><small>${esc(quota)}</small></td><td class="sp-row__act">${searching ? '' : acts}</td></tr>`;
  };
  const body = rows.length
    ? `<table class="cp-history sp-queue"><thead><tr><th>#</th><th>Titre</th><th>Demandeur</th><th>Statut</th><th>Quota · délai</th><th></th></tr></thead>
        <tbody>${rows.map(row).join('')}</tbody></table>`
    : '<p class="sp-empty">Aucune demande en attente. Les viewers demandent avec la récompense de demande de musique (espace Récompense Twitch).</p>';
  return `<section>${body}
    ${
      s.to_verify.length
        ? `<p class="cp-muted">« À vérifier » : Spotify n’a pas confirmé l’ajout. Regarde la file dans Spotify, puis
            « Rembourser » rend les points (récompense de Raptoru) ; « Garder » ne change rien sur Twitch (réclamation en
            attente, à valider ou rembourser depuis Twitch).</p>`
        : ''
    }
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

/** Folded: what became of the last requests (refusals and why, cancels, removals, refunds, Twitch status). */
function decisions(s: SpState, ui: SpUi) {
  if (!s.recent.length) return '';
  const row = (r: SpRequest) => {
    const x = resultOf(r);
    return `<tr class="cp-row--${x.tone}"><td>${esc(clock(r.received_at))}</td><td>${r.source === 'simulation' ? '<i>Lab</i> ' : ''}@${esc(r.viewer.login)}</td>
      <td><small>${esc(r.input)}</small></td><td><b>${esc(x.head)}</b><br><small>${esc(x.detail)}</small></td></tr>`;
  };
  return `<details class="sp-more" data-fold="decisions"${ui.open?.decisions ? ' open' : ''}><summary>Dernières décisions (${s.recent.length})</summary>
    <table class="cp-history"><thead><tr><th>Heure</th><th>Viewer</th><th>Demande</th><th>Résultat</th></tr></thead>
    <tbody>${s.recent.map(row).join('')}</tbody></table></details>`;
}

function livePanel(s: SpState, ui: SpUi) {
  return `${counters(s)}${playing(s, ui)}${requests(s)}${decisions(s, ui)}`;
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
