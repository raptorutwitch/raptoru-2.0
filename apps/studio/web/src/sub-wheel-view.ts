// Roue du Sub — Studio section (pure part, tested). V2 (R4, docs/SUB_WHEEL_V2_PLAN.md): the tours waiting (manual
// requests, the automatic queue with the viewers' presence, the manual tours), the tours « À vérifier » with their
// proofs and the three decisions, the informative « Possible doublon », the history (the real results), the settings
// (switch, mode, tests). Studio only shows what Core decided and sends the actions: no economic rule here. Every
// name is escaped.

export type SwStatus =
  | 'ignored'
  | 'queued'
  | 'playing'
  | 'shown'
  | 'failed'
  | 'skipped'
  | 'owed'
  | 'requested'
  | 'merged';
export type SwMode = 'v1' | 'v2_acquire' | 'v2';
export type MonthSource =
  'twitch' | 'estimated' | 'estimated_no_history' | 'badge' | 'legacy' | null;

export interface SwSpinView {
  spin_id: string;
  source: 'twitch' | 'simulation' | 'test' | 'manual' | 'reconcile';
  type: 'sub' | 'resub';
  viewer: { id?: string | null; name: string };
  tier: number;
  months: number;
  status: SwStatus;
  reason: string | null;
  segment: number | null;
  amount: number | null;
  award: {
    status: 'none' | 'pending' | 'awarded' | 'manual' | 'cancelled' | 'test';
    ref: string | null;
    note: string | null;
  };
  created_at: string;
  right?: {
    queue: 'auto' | 'manual' | null;
    sub_month: number | null;
    month_source: MonthSource;
    acquired_at: string | null;
    drawn_at: string | null;
  };
}

export interface SwRightView extends SwSpinView {
  requested_by: string | null;
  blocked: boolean;
  presence: 'present' | 'absent' | 'unknown';
  sources: string[];
}

interface ProofView {
  source: string;
  occurred_at: string | null;
  months: number | null;
}
interface ReviewSide {
  spin_id: string;
  status: SwStatus;
  sub_month: number | null;
  month_source: MonthSource;
  award_status?: string;
  amount?: number | null;
  acquired_at: string | null;
  sources: ProofView[];
}
export interface SwReviewView {
  review_id: number | string;
  status: 'open' | 'unresolved';
  month: number;
  created_at: string;
  viewer_id: string;
  suspect: ReviewSide & { viewer_name?: string; tier?: number };
  other: ReviewSide;
}
export interface SwDuplicateView {
  viewer_id: string;
  viewer_name: string;
  days_apart: number;
  a: {
    spin_id: string;
    status: SwStatus;
    sub_month: number;
    month_source: MonthSource;
    at: string;
  };
  b: {
    spin_id: string;
    status: SwStatus;
    sub_month: number;
    month_source: MonthSource;
    at: string;
  };
}

export interface SwLabSim {
  readings: boolean;
  live: boolean;
  viewers: { viewer_id: string; display_name: string; present: boolean }[];
}

export interface SwState {
  settings: {
    enabled: boolean;
    mode?: SwMode;
    invitations_enabled?: boolean;
    /** Lab Core: the simulators exist, the gains pay the Lab test wallet. */
    lab?: boolean;
  };
  lab_sim?: SwLabSim | null;
  /** The connected Core has no Roue du Sub V2 yet (older Core): only the V1 section works. */
  v2_unavailable?: boolean;
  waiting: number;
  pending_awards: { count: number; total: number };
  recent: SwSpinView[];
  rights?: SwRightView[];
  /** R7: subscriptions active without any event heard — informative, never a tour. */
  subscription_detections?: {
    viewer_id: string;
    detected_at: string;
    tier: number;
  }[];
  reviews?: SwReviewView[];
  possible_duplicates?: SwDuplicateView[];
  animations_error?: string | null;
  effects: {
    connected: boolean;
    current: boolean;
    media: { id: string; label: string; available: boolean }[];
  } | null;
}

export type SwTab = 'waiting' | 'review' | 'history' | 'settings' | 'lab';
export interface SwUi {
  tab: SwTab;
  grantOpen: boolean;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const chip = (cls: 'on' | 'warn' | 'off', text: string) =>
  `<span class="cp-chip cp-chip--${cls}">${esc(text)}</span>`;
const n = (v: number) => v.toLocaleString('fr-FR');
const time = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export const STATUS: Record<SwStatus, string> = {
  ignored: 'Roue désactivée (rien tiré)',
  queued: 'Tirée, en attente d’affichage',
  playing: 'En cours',
  shown: 'Affichée',
  failed: 'Non affichée',
  skipped: 'Non affichée (trop tard)',
  owed: 'Tour en attente',
  requested: 'Tirage demandé',
  merged: 'Fusionnée (doublon)',
};
const AWARD: Record<SwSpinView['award']['status'], string> = {
  none: '',
  pending: 'Gain en attente d’attribution',
  awarded: 'Crédité',
  manual: 'Crédité à la main',
  cancelled: 'Annulé',
  test: 'Test : aucun gain',
};
const MODE: Record<SwMode, [string, string]> = {
  v1: [
    'V1',
    'La roue d’aujourd’hui : chaque avis de sub tire tout de suite. Les autres sources sont seulement notées.',
  ],
  v2_acquire: [
    'V2 — acquisition',
    'Les tours sont gardés (aucun n’est perdu) ; la V1 tire encore les avis de sub, la V2 ne tire rien.',
  ],
  v2: [
    'V2',
    'La roue tire les tours au moment de l’affichage : demandes d’abord, puis la file automatique (live, viewer présent).',
  ],
};
export const SOURCE: Record<string, string> = {
  chat_notification: 'avis de chat',
  subscribe: 'abonnement',
  message: 'message de resub',
  manual: 'accordé',
  reconcile: 'rattrapage Twitch',
  badge: 'badge',
};
const PRESENCE: Record<SwRightView['presence'], [string, string]> = {
  present: ['on', 'présent'],
  absent: ['off', 'absent'],
  unknown: ['warn', 'présence inconnue'],
};

/** « Mois 7 · confirmé », « Mois ~6 · estimé », or the wheel of a granted tour. */
export function monthLabel(
  r: { sub_month: number | null; month_source: MonthSource } | undefined,
  months?: number,
) {
  if (!r || r.month_source === null || r.sub_month === null)
    return months ? `roue ${months} mois` : '—';
  if (r.month_source === 'twitch')
    return `Mois ${r.sub_month} <span class="sw-ok">confirmé</span>`;
  if (r.month_source === 'estimated_no_history')
    return `Mois ~${r.sub_month} <span class="sw-est">estimé, sans historique</span>`;
  return `Mois ~${r.sub_month} <span class="sw-est">estimé</span>`;
}

const sourcesOf = (list: string[]) =>
  [...new Set(list)]
    .map((s) => `<span class="cp-tag">${esc(SOURCE[s] ?? s)}</span>`)
    .join(' ');

function rightRow(r: SwRightView, canDraw: boolean) {
  const [pc, pl] = PRESENCE[r.presence];
  const action = r.blocked
    ? '<span class="cp-tag cp-tag--warn">À vérifier</span>'
    : r.status === 'requested'
      ? `<small class="cp-muted">demandé${r.requested_by ? ` par ${esc(r.requested_by)}` : ''}</small>`
      : canDraw
        ? `<button type="button" class="cp-ghost" data-act="sw-draw" data-spin="${esc(r.spin_id)}" data-name="${esc(r.viewer.name)}">Tirer</button>`
        : '';
  return `<tr${r.blocked ? ' class="sw-blocked"' : ''}>
    <td><b>${esc(r.viewer.name)}</b><br><small>T${r.tier} · ${monthLabel(r.right, r.months)}</small></td>
    <td>${sourcesOf(r.sources ?? [])}</td>
    <td>${chip(pc as 'on', pl)}</td>
    <td><small>${esc(time(r.right?.acquired_at ?? r.created_at))}</small></td>
    <td class="sw-act">${action}</td></tr>`;
}

function rightsTable(
  title: string,
  hint: string,
  rows: SwRightView[],
  canDraw: boolean,
) {
  return `<div class="sw-block"><h3>${esc(title)} <span class="sw-count">${rows.length}</span></h3>
    ${
      rows.length
        ? `<table class="cp-history sw-rights"><thead><tr><th>Viewer</th><th>Provenance</th><th>Présence</th><th>Acquis</th><th></th></tr></thead><tbody>${rows.map((r) => rightRow(r, canDraw)).join('')}</tbody></table>`
        : `<p class="cp-muted">${esc(hint)}</p>`
    }</div>`;
}

function grantForm() {
  return `<form class="sw-grant" data-role="sw-grant">
    <label>Twitch ID <input data-f="g-id" inputmode="numeric" pattern="\\d{1,32}" required size="12"/></label>
    <label>Pseudo <input data-f="g-name" maxlength="64" required size="14"/></label>
    <label>Tier <select data-f="g-tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></label>
    <label>Roue (mois) <input data-f="g-months" type="number" min="1" max="200" value="1" style="width:4.5em"/></label>
    <label class="sw-grow">Motif <input data-f="g-note" maxlength="200" required placeholder="ex. tour perdu le 20/10"/></label>
    <button type="submit" class="cp-primary">Accorder</button>
    <button type="button" data-act="sw-grant-close">Annuler</button>
  </form>`;
}

const V2_UNAVAILABLE = `<p class="sw-banner">Le Core connecté ne gère pas encore la Roue du Sub V2 (Core à mettre à jour) :
  seule la V1 est disponible — historique, activation et tests.</p>`;

function waitingTab(s: SwState, ui: SwUi) {
  if (s.v2_unavailable) return V2_UNAVAILABLE;
  const rights = s.rights ?? [];
  const requested = rights.filter((r) => r.status === 'requested');
  const auto = rights.filter(
    (r) => r.status === 'owed' && r.right?.queue === 'auto',
  );
  const manual = rights.filter(
    (r) => r.status === 'owed' && r.right?.queue !== 'auto',
  );
  const mode = s.settings.mode ?? 'v1';
  const banner =
    mode === 'v2'
      ? s.settings.enabled
        ? ''
        : '<p class="sw-banner">Roue désactivée : les tirages sont en pause, aucun tour n’est perdu.</p>'
      : `<p class="sw-banner">Mode ${esc(MODE[mode][0])} : la V2 ne tire pas encore. Les tours et les demandes attendent le mode V2.</p>`;
  return `${banner}
    <div class="sw-toolbar">
      <button type="button" data-act="sw-grant-open"${ui.grantOpen ? ' disabled' : ''}>Accorder un tour…</button>
      <span class="cp-muted">« Tirer » place le tour avant la file automatique : il est tiré à la prochaine roue.</span>
    </div>
    ${ui.grantOpen ? grantForm() : ''}
    ${rightsTable('Demandes de tirage', 'Aucune demande.', requested, false)}
    ${rightsTable('File automatique', 'Aucun tour en file automatique (subs reçus en live).', auto, true)}
    ${rightsTable('Tours manuels', 'Aucun tour manuel (acquis hors live, accordés).', manual, true)}`;
}

function proofs(side: ReviewSide) {
  if (!side.sources.length)
    return '<small class="cp-muted">aucune preuve enregistrée (ligne V1)</small>';
  return `<ul class="sw-proofs">${side.sources
    .map(
      (p) =>
        `<li>${esc(SOURCE[p.source] ?? p.source)} · ${esc(time(p.occurred_at))}${p.months ? ` · ${p.months} mois cumulés` : ''}</li>`,
    )
    .join('')}</ul>`;
}

function reviewCard(r: SwReviewView) {
  const s = r.suspect;
  const mergeable =
    (s.status === 'owed' || s.status === 'requested') &&
    (s.award_status ?? 'none') === 'none';
  const id = esc(r.review_id);
  return `<article class="sw-review">
    <header><b>${esc(s.viewer_name ?? r.viewer_id)}</b> · même mois ${r.month} possible
      ${r.status === 'unresolved' ? '<span class="cp-tag cp-tag--warn">laissé en attente</span>' : '<span class="cp-tag cp-tag--warn">à vérifier</span>'}
      <small class="cp-muted">depuis ${esc(time(r.created_at))}</small></header>
    <div class="sw-pair">
      <div><h4>Tour bloqué</h4><p>${monthLabel(s)} · ${esc(STATUS[s.status] ?? s.status)}</p>${proofs(s)}</div>
      <div><h4>Tour du même mois</h4><p>${monthLabel(r.other)} · ${esc(STATUS[r.other.status] ?? r.other.status)}${r.other.amount != null ? ` · ${n(Number(r.other.amount))} jetons` : ''}</p>${proofs(r.other)}</div>
    </div>
    <div class="cp-buttons">
      <button type="button" data-act="sw-review" data-decision="distinct" data-review="${id}">Deux mois distincts</button>
      ${mergeable ? `<button type="button" data-act="sw-review" data-decision="merge" data-review="${id}">Fusionner (doublon)</button>` : ''}
      ${r.status === 'open' ? `<button type="button" class="cp-ghost" data-act="sw-review" data-decision="unresolved" data-review="${id}">Laisser en attente</button>` : ''}
    </div>
  </article>`;
}

function reviewTab(s: SwState) {
  if (s.v2_unavailable) return V2_UNAVAILABLE;
  const reviews = s.reviews ?? [];
  const dups = s.possible_duplicates ?? [];
  return `<p class="cp-muted">Deux tours du même viewer pourraient être le même mois sans preuve sûre : les deux sont
      gardés, le tour bloqué n’est tiré par aucun chemin tant qu’une décision n’est pas prise. Une fusion ne crédite
      rien et n’efface rien.</p>
    ${reviews.length ? reviews.map(reviewCard).join('') : '<p class="cp-muted">Aucun tour à vérifier.</p>'}
    <div class="sw-block"><h3>Possible doublon <span class="sw-count">${dups.length}</span></h3>
      <p class="cp-muted">Information seulement : rien n’est bloqué ni fusionné. Un mois estimé et un autre tour à moins de
        28 jours d’écart peuvent être le même renouvellement.</p>
      ${
        dups.length
          ? `<table class="cp-history"><thead><tr><th>Viewer</th><th>Premier tour</th><th>Second tour</th><th>Écart</th></tr></thead><tbody>${dups
              .map(
                (d) =>
                  `<tr><td><b>${esc(d.viewer_name)}</b></td><td>${monthLabel(d.a)}<br><small>${esc(STATUS[d.a.status] ?? d.a.status)} · ${esc(time(d.a.at))}</small></td><td>${monthLabel(d.b)}<br><small>${esc(STATUS[d.b.status] ?? d.b.status)} · ${esc(time(d.b.at))}</small></td><td>${String(d.days_apart).replace('.', ',')} j</td></tr>`,
              )
              .join('')}</tbody></table>`
          : ''
      }</div>
    ${detectionsBlock(s)}`;
}

function detectionsBlock(s: SwState) {
  const d = s.subscription_detections ?? [];
  if (!d.length) return '';
  return `<div class="sw-block"><h3>Abonnements sans événement reçu <span class="sw-count">${d.length}</span></h3>
      <p class="cp-muted">Information seulement : Twitch liste ces abonnés payants, mais aucun événement n’a été reçu
        (interruption du bot ?). Un abonnement actif ne prouve pas un nouveau mois : aucun tour n’est créé. Si un tour est
        dû, « Accorder un tour » dans « En attente ».</p>
      <table class="cp-history"><thead><tr><th>Twitch ID</th><th>Tier</th><th>Détecté</th></tr></thead><tbody>${d
        .map(
          (x) =>
            `<tr><td>${esc(x.viewer_id)}</td><td>T${Number(x.tier) || 1}</td><td>${esc(time(x.detected_at))}</td></tr>`,
        )
        .join('')}</tbody></table></div>`;
}

function historyTab(s: SwState) {
  const rows = s.recent
    .map((r) => {
      const result =
        r.amount === null
          ? '—'
          : `${n(r.amount)} jetons <small>(segment ${(r.segment ?? 0) + 1})</small>`;
      const award = AWARD[r.award.status];
      const actions =
        r.award.status === 'pending'
          ? ` <button type="button" class="cp-ghost" data-act="sw-manual" data-spin="${esc(r.spin_id)}">Crédité à la main…</button> <button type="button" class="cp-ghost" data-act="sw-cancel" data-spin="${esc(r.spin_id)}">Annuler…</button>`
          : '';
      const cls =
        r.status === 'shown'
          ? 'done'
          : r.status === 'failed' || r.status === 'skipped'
            ? 'failed'
            : r.status === 'merged' || r.status === 'ignored'
              ? 'ignored'
              : 'pending';
      return `<tr class="cp-row--${cls}">
        <td>${esc(time(r.created_at))}</td>
        <td>${r.source === 'twitch' ? '' : r.source === 'manual' ? '<i>Accordé</i> ' : '<i>Test</i> '}${esc(r.viewer.name)}<br><small>${r.type === 'sub' ? 'sub' : 'resub'} · T${r.tier} · ${r.right?.month_source ? monthLabel(r.right) : `${r.months} mois`}</small></td>
        <td><b>${STATUS[r.status] ?? esc(r.status)}</b><br><small>${result}</small>${r.reason && r.status !== 'ignored' ? `<br><small>${esc(r.reason)}</small>` : ''}</td>
        <td><small>${esc(award)}${r.award.note ? ` — ${esc(r.award.note)}` : ''}</small>${actions}</td></tr>`;
    })
    .join('');
  return rows
    ? `<table class="cp-history"><thead><tr><th>Date</th><th>Viewer</th><th>Roue</th><th>Gain</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="cp-muted">Aucune roue.</p>';
}

function settingsTab(s: SwState) {
  const mode = s.settings.mode ?? 'v1';
  return `<div class="sw-block"><h3>Roue</h3>
      <p class="cp-muted">Une roue par sub, resub ou Prime (tiers 1 à 3), jamais pour un sub offert ni un gift
        communautaire ; elle tourne après l’alerte de sub. Le segment et le gain sont décidés par le Core, une seule fois,
        avant l’animation. Désactivée : rien n’est tiré, aucun tour n’est perdu.</p>
      <button type="button" data-act="sw-switch" class="${s.settings.enabled ? '' : 'cp-primary'}">${s.settings.enabled ? 'Désactiver la roue' : 'Activer la roue'}</button></div>
    ${
      s.v2_unavailable
        ? V2_UNAVAILABLE
        : `<div class="sw-block"><h3>Mode <small class="cp-muted">diffuseur uniquement</small></h3>
      <div class="sw-modes">${(Object.keys(MODE) as SwMode[])
        .map(
          (m) =>
            `<label class="sw-mode${m === mode ? ' sw-mode--on' : ''}"><input type="radio" name="sw-mode" value="${m}" data-act="sw-mode"${m === mode ? ' checked' : ''}/>
              <b>${esc(MODE[m][0])}</b><span>${esc(MODE[m][1])}</span></label>`,
        )
        .join('')}</div></div>
    <div class="sw-block"><h3>Invitations naturelles <small class="cp-muted">diffuseur uniquement</small></h3>
      <p class="cp-muted">En V2, pendant le live, LeCroupier_ propose une fois par live à un viewer qui a des tours à
        lancer de les lancer (« oui » / « non », ou !roue oui / !roue non). Accepter demande le tirage ; rien n’est
        crédité à la réponse ; refuser ou ne pas répondre ne fait perdre aucun tour.</p>
      <button type="button" data-act="sw-invitations" class="${s.settings.invitations_enabled ? '' : 'cp-primary'}">${s.settings.invitations_enabled ? 'Désactiver les invitations' : 'Activer les invitations'}</button>
      ${s.settings.invitations_enabled ? chip('on', 'Invitations : actives') : chip('off', 'Invitations : désactivées')}</div>`
    }
    <div class="sw-block"><h3>Tests <small class="cp-muted">jamais de gain réel</small></h3>
      <div class="cp-buttons">
        <label class="cp-inline">Pseudo <input data-f="sw-name" size="12" maxlength="25" value="Test Studio"/></label>
        <label class="cp-inline">Tier <select data-f="sw-tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></label>
        <label class="cp-inline">Mois <input data-f="sw-months" type="number" min="1" max="200" value="1" style="width:4em"/></label>
        <button type="button" data-act="sw-test" title="Joue une roue dans OBS, aucun gain">Tester l’animation</button>
        <button type="button" data-act="sw-full" title="Alerte de sub simulée puis la roue, aucun gain">Test complet simulé</button>
      </div></div>`;
}

const SIMULATE: [string, string][] = [
  ['sub', 'Nouveau sub (avis + abonnement)'],
  ['resub', 'Resub partagé (avis + message, mois cumulés)'],
  ['prime', 'Prime (avis + abonnement)'],
  ['subscribe', 'Abonnement seul (reprise non partagée)'],
  ['message', 'Message de resub seul'],
];

/** Lab only: the explicit simulators — the live, the chatters readings, each viewer present / absent, the events. */
function labTab(s: SwState) {
  const sim = s.lab_sim;
  if (!s.settings.lab || !sim)
    return '<p class="cp-muted">Simulateurs disponibles dans le Lab uniquement.</p>';
  const viewers = sim.viewers
    .map(
      (
        v,
      ) => `<tr><td><b>${esc(v.display_name)}</b> <small class="cp-muted">${esc(v.viewer_id)}</small></td>
        <td>${chip(v.present ? 'on' : 'off', v.present ? 'présent' : 'absent')}</td>
        <td class="sw-act"><button type="button" class="cp-ghost" data-act="sw-sim-present" data-id="${esc(v.viewer_id)}" data-name="${esc(v.display_name)}" data-present="${v.present ? '0' : '1'}">${v.present ? 'Rendre absent' : 'Rendre présent'}</button></td></tr>`,
    )
    .join('');
  return `<p class="sw-banner">Lab : données de test uniquement. Les gains sont crédités sur le wallet de test Lab, jamais
      sur les Jetons de Production. Rien n’est envoyé à Twitch ni à OBS.</p>
    <div class="sw-block"><h3>Live</h3>
      ${sim.live ? chip('on', 'Live simulé en cours') : chip('off', 'Hors live')}
      <button type="button" data-act="sw-sim-live" data-on="${sim.live ? '0' : '1'}">${sim.live ? 'Terminer le live' : 'Démarrer un live'}</button></div>
    <div class="sw-block"><h3>Présence (relevés de chatters simulés)</h3>
      ${sim.readings ? chip('on', 'Relevés actifs') : chip('warn', 'Aucun relevé : présence inconnue')}
      <button type="button" data-act="sw-sim-readings" data-on="${sim.readings ? '0' : '1'}">${sim.readings ? 'Arrêter les relevés' : 'Démarrer les relevés'}</button>
      ${viewers ? `<table class="cp-history sw-rights"><tbody>${viewers}</tbody></table>` : '<p class="cp-muted">Aucun viewer simulé.</p>'}
      <form class="sw-grant" data-role="sw-sim-viewer">
        <label>Twitch ID <input data-f="sv-id" inputmode="numeric" required size="10"/></label>
        <label>Pseudo <input data-f="sv-name" maxlength="64" required size="12"/></label>
        <button type="submit">Ajouter présent</button>
      </form></div>
    <div class="sw-block"><h3>Événement Twitch simulé</h3>
      <form class="sw-grant" data-role="sw-sim-event">
        <label>Type <select data-f="se-kind">${SIMULATE.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
        <label>Twitch ID <input data-f="se-id" inputmode="numeric" required size="10"/></label>
        <label>Pseudo <input data-f="se-name" maxlength="64" required size="12"/></label>
        <label>Tier <select data-f="se-tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></label>
        <label>Mois cumulés <input data-f="se-months" type="number" min="1" max="200" value="2" style="width:4.5em"/></label>
        <button type="submit" class="cp-primary">Envoyer</button>
      </form></div>`;
}

export function subWheelView(
  s: SwState | null,
  error: string | null,
  ui: SwUi = { tab: 'waiting', grantOpen: false },
) {
  if (error) return `<p class="cp-error">${esc(error)}</p>`;
  if (!s) return '<p class="cp-muted">Chargement…</p>';
  const missing = (s.effects?.media ?? []).filter((m) => !m.available);
  const player = !s.effects
    ? chip('warn', 'Lecteur d’effets indisponible')
    : !s.effects.connected
      ? chip('warn', 'Lecteur d’effets : non ouvert')
      : !s.effects.current
        ? chip('warn', 'Lecteur d’effets : à recharger')
        : chip('on', 'Lecteur prêt');
  const mode = s.settings.mode ?? 'v1';
  const rights = s.rights ?? [];
  const blocked = (s.reviews ?? []).length;
  const dups = (s.possible_duplicates ?? []).length;
  const tabs: [SwTab, string][] = [
    ['waiting', `En attente${rights.length ? ` (${rights.length})` : ''}`],
    ['review', `À vérifier${blocked ? ` (${blocked})` : ''}`],
    ['history', 'Historique'],
    ['settings', 'Réglages'],
    ...(s.settings.lab
      ? ([['lab', 'Simulateur Lab']] as [SwTab, string][])
      : []),
  ];
  const body =
    ui.tab === 'review'
      ? reviewTab(s)
      : ui.tab === 'history'
        ? historyTab(s)
        : ui.tab === 'settings'
          ? settingsTab(s)
          : ui.tab === 'lab'
            ? labTab(s)
            : waitingTab(s, ui);
  return `<div class="cp-status">${s.settings.enabled ? chip('on', 'Roue : ACTIVE') : chip('warn', 'Roue : désactivée')}
      ${chip(mode === 'v2' ? 'on' : 'off', `Mode ${MODE[mode][0]}`)} ${player}
      ${s.waiting ? chip('warn', `${s.waiting} roue(s) à afficher`) : ''}
      ${blocked ? chip('warn', `${blocked} tour(s) à vérifier`) : ''}
      ${dups ? chip('off', `${dups} possible(s) doublon(s)`) : ''}
      ${s.pending_awards.count ? chip('warn', `${s.pending_awards.count} gain(s) à attribuer : ${n(s.pending_awards.total)} jetons`) : ''}
      ${s.animations_error ? chip('warn', 'Animations : Core injoignable') : ''}</div>
    ${missing.length ? `<p class="cp-error">Médias non importés : ${esc(missing.map((m) => m.label).join(', '))}</p>` : ''}
    <nav class="sw-tabs" role="tablist">${tabs
      .map(
        ([t, label]) =>
          `<button type="button" role="tab" data-act="sw-tab" data-tab="${t}" aria-selected="${t === ui.tab}" class="sw-tab${t === ui.tab ? ' sw-tab--on' : ''}">${esc(label)}</button>`,
      )
      .join('')}</nav>
    <div class="sw-body">${body}</div>`;
}
