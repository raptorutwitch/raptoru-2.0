import { esc, fld, grp, ic, pp, row, seg, stateChip, sw } from '../ds/ds.js';

// Roue du Sub, partie pure et testée (docs/SUB_WHEEL.md, V2 : SUB_WHEEL_V2_PLAN.md) : les tours en attente, les tours à vérifier et
// leurs preuves, l'historique et ses gains à attribuer, les réglages. La page montre ce que le Core a décidé et lui transmet les
// actions : aucune règle économique ici. Chaque nom est échappé.

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
  /** Une roue tirée mais non montrée : remontrée toute seule (retry), à la main (manual), à vérifier (check). */
  recovery?: 'retry' | 'manual' | 'check' | null;
  retries?: number;
  retry_at?: string | null;
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
    /** Secondes entre la fin de la roue et son annonce dans le chat (absent : un Core sans ce réglage). */
    announce_delay_s?: number;
    /** Core du Lab : les simulateurs existent, les gains vont au portefeuille de test. */
    lab?: boolean;
  };
  lab_sim?: SwLabSim | null;
  /** Le Core connecté n'a pas encore la V2 : seule la V1 fonctionne. */
  v2_unavailable?: boolean;
  waiting: number;
  pending_awards: { count: number; total: number };
  recent: SwSpinView[];
  rights?: SwRightView[];
  /** Abonnements actifs sans événement reçu : pour information, jamais un tour. */
  subscription_detections?: {
    viewer_id: string;
    viewer_name?: string | null;
    detected_at: string;
    tier: number;
  }[];
  reviews?: SwReviewView[];
  possible_duplicates?: SwDuplicateView[];
  /** Roues tirées mais non montrées (absent : un Core sans la reprise automatique). */
  recovery?: { retrying: number; to_replay: number; checks: SwSpinView[] };
  animations_error?: string | null;
  /** Pourquoi Studio ne demande pas de roue : rien n'est tiré entre-temps. */
  animations_waiting?: string | null;
  /** Simulateur du Lab : la prochaine roue sera prise par une page qui ne la démarre jamais. */
  lab_fail_next_start?: boolean;
  effects: {
    url?: string;
    connected: boolean;
    current: boolean;
    /** La page peut jouer le son (OBS : toujours ; un onglet : après un clic). */
    audio?: boolean;
    media: { id: string; label: string; available: boolean }[];
  } | null;
}

export type SwTab = 'waiting' | 'review' | 'rights' | 'history';
export interface SwUi {
  tab: SwTab;
  /** Le contenu de « Droits », dessiné par sub-wheel-rights-view.ts. */
  rights?: string;
  /** Historique : seulement les gains à attribuer. */
  pendingOnly?: boolean;
}

const n = (v: number) => v.toLocaleString('fr-FR');
export const time = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const tag = (cls: string, text: string) =>
  `<span class="d-tag ${cls}">${esc(text)}</span>`;

export const STATUS: Record<SwStatus, string> = {
  ignored: 'Roue fermée (rien tiré)',
  queued: 'Tirée, en attente d’affichage',
  playing: 'En cours',
  shown: 'Affichée',
  failed: 'Non affichée',
  skipped: 'Non affichée (trop tard)',
  owed: 'Tour en attente',
  requested: 'Tirage demandé',
  merged: 'Fusionnée (doublon)',
};
/** Une roue tirée mais non montrée : ce qui se passe ensuite (null : rien à dire). */
export function recoveryLabel(
  r: Pick<SwSpinView, 'status' | 'recovery' | 'retry_at'>,
) {
  if (r.status !== 'failed') return null;
  if (r.recovery === 'retry')
    return `Jamais affichée : nouvel essai automatique à partir de ${time(r.retry_at)}, dès que le lecteur est prêt`;
  if (r.recovery === 'manual')
    return 'Jamais affichée : plus d’essai automatique, « Rejouer l’animation » quand le lecteur est prêt';
  if (r.recovery === 'check')
    return 'Peut-être vue : à vérifier (rien n’est rejoué tout seul)';
  return null;
}

/** Pourquoi une roue à vérifier a peut-être été vue. */
const CHECK_WHY: Record<string, string> = {
  animation_not_confirmed:
    'Le lecteur a disparu pendant la roue (Studio fermé, OBS coupé…).',
  playback_not_confirmed: 'La roue a démarré, sa fin n’a jamais été confirmée.',
};

export const AWARD: Record<SwSpinView['award']['status'], string> = {
  none: '',
  pending: 'Gain en attente d’attribution',
  awarded: 'Crédité',
  manual: 'Crédité à la main',
  cancelled: 'Annulé',
  test: 'Test : aucun gain',
};
export const MODE: Record<SwMode, [string, string]> = {
  v1: [
    'V1',
    'La roue d’origine : chaque avis de sub tire tout de suite. Les autres sources sont seulement notées.',
  ],
  v2_acquire: [
    'V2, acquisition',
    'Les tours sont gardés (aucun n’est perdu) ; la V1 tire encore les avis de sub, la V2 ne tire rien.',
  ],
  v2: [
    'V2',
    'La roue tire les tours au moment de l’affichage : demandes d’abord, puis la file automatique (live, viewer présent).',
  ],
};
export const SOURCE: Record<string, string> = {
  twitch: 'Twitch',
  chat_notification: 'avis de chat',
  subscribe: 'abonnement',
  message: 'message de resub',
  manual: 'accordé',
  reconcile: 'rattrapage Twitch',
  badge: 'badge',
};
const PRESENCE: Record<SwRightView['presence'], [string, string]> = {
  present: ['ok', 'présent'],
  absent: ['off', 'absent'],
  unknown: ['warn', 'présence inconnue'],
};

/** « Mois 7 confirmé », « Mois ~6 estimé », ou la roue d'un tour accordé. */
export function monthLabel(
  r: { sub_month: number | null; month_source: MonthSource } | undefined,
  months?: number,
) {
  if (!r || r.month_source === null || r.sub_month === null)
    return months ? `roue ${months} mois` : '—';
  if (r.month_source === 'twitch')
    return `Mois ${r.sub_month} <span class="whl-ok">confirmé</span>`;
  if (r.month_source === 'estimated_no_history')
    return `Mois ~${r.sub_month} <span class="whl-est">estimé, sans historique</span>`;
  return `Mois ~${r.sub_month} <span class="whl-est">estimé</span>`;
}

const sourcesOf = (list: string[]) =>
  [...new Set(list)]
    .map((s) => `<span class="d-tag off">${esc(SOURCE[s] ?? s)}</span>`)
    .join('');

/** Le prochain tour : les demandes, puis la file automatique, puis les tours manuels. Jamais un tour bloqué. */
export function nextTour(s: SwState) {
  const r = (s.rights ?? []).filter((x) => !x.blocked);
  return (
    r.find((x) => x.status === 'requested') ??
    r.find((x) => x.status === 'owed' && x.right?.queue === 'auto') ??
    r.find((x) => x.status === 'owed') ??
    null
  );
}

// --- En-tête et alertes --------------------------------------------------------------------------------------------------

function playerText(s: SwState) {
  if (!s.effects) return 'Lecteur d’effets indisponible';
  if (!s.effects.connected) return 'Lecteur d’effets : non ouvert';
  if (s.effects.audio === false)
    return 'Lecteur ouvert, son bloqué : clique une fois dans sa page';
  if (!s.effects.current) return 'Lecteur d’effets : à recharger';
  return 'Lecteur prêt';
}
const player = (s: SwState) =>
  stateChip(playerReady(s) ? '' : 'w', playerText(s));

const playerReady = (s: SwState) =>
  !!s.effects?.connected && s.effects.audio !== false && s.effects.current;

export const stateView = (s: SwState) =>
  `${s.settings.enabled ? stateChip('live', `Roue ouverte · ${MODE[s.settings.mode ?? 'v1'][0]}`) : stateChip('off', 'Roue fermée')}${playerReady(s) ? player(s) : ''}`;

/** Tout ce qui attend un regard, chaque alerte mène à sa liste. */
export function alertsView(s: SwState) {
  const blocked = (s.reviews ?? []).length;
  const checks = s.recovery?.checks.length ?? 0;
  const dups = (s.possible_duplicates ?? []).length;
  const missing = (s.effects?.media ?? []).filter((m) => !m.available);
  const go = (cls: string, tab: string, text: string) =>
    `<button type="button" class="d-tag ${cls}" data-tab="${tab}">${esc(text)}</button>`;
  const pl = (k: number, one: string, many: string) =>
    `${n(k)} ${k > 1 ? many : one}`;
  const list = [
    playerReady(s)
      ? ''
      : `<button type="button" class="d-tag warn" data-open="lecteur">${esc(playerText(s))}</button>`,
    s.waiting
      ? tag('warn', pl(s.waiting, 'roue à afficher', 'roues à afficher'))
      : '',
    blocked
      ? go('warn', 'review', pl(blocked, 'tour à vérifier', 'tours à vérifier'))
      : '',
    s.recovery?.retrying
      ? go(
          'warn',
          'history',
          `${pl(s.recovery.retrying, 'roue jamais affichée', 'roues jamais affichées')} : nouvel essai automatique`,
        )
      : '',
    s.recovery?.to_replay
      ? go(
          'warn',
          'history',
          `${pl(s.recovery.to_replay, 'roue jamais affichée', 'roues jamais affichées')} : à rejouer`,
        )
      : '',
    checks
      ? go(
          'warn',
          'review',
          `${pl(checks, 'animation peut-être vue', 'animations peut-être vues')} : à vérifier`,
        )
      : '',
    dups
      ? go('off', 'review', pl(dups, 'possible doublon', 'possibles doublons'))
      : '',
    s.pending_awards.count
      ? `<button type="button" class="d-tag warn" data-tab="history" data-pending>${esc(`${pl(s.pending_awards.count, 'gain', 'gains')} à attribuer : ${n(s.pending_awards.total)} jetons`)}</button>`
      : '',
    s.animations_error ? tag('bad', 'Animations : serveur injoignable') : '',
    s.animations_waiting === 'effect_media_missing'
      ? tag(
          'warn',
          'Sons de la roue manquants : rien n’est tiré tant qu’ils ne sont pas importés',
        )
      : s.animations_waiting &&
          s.animations_waiting !== 'effects_player_offline' &&
          s.animations_waiting !== 'effects_player_unavailable'
        ? tag(
            'warn',
            'Roues en attente du lecteur : rien n’est tiré tant qu’il ne peut pas les jouer',
          )
        : '',
    missing.length
      ? tag(
          'bad',
          `Médias non importés : ${missing.map((m) => m.label).join(', ')}`,
        )
      : '',
  ].filter(Boolean);
  return list.length
    ? `<div class="whl-alerts d-tags">${list.join('')}</div>`
    : '';
}

// --- En attente ----------------------------------------------------------------------------------------------------------

const who = (v: { id?: string | null; name: string }, sub: string) => {
  const name = `${pp(v.name, 28)}<span class="whl-who__t"><b>${esc(v.name)}</b><small>${sub}</small></span>`;
  return v.id
    ? `<button type="button" class="whl-who" data-viewer="${esc(v.id)}" title="Voir ses droits">${name}</button>`
    : `<span class="whl-who">${name}</span>`;
};

function rightRow(r: SwRightView, canDraw: boolean) {
  const [pc, pl] = PRESENCE[r.presence];
  const action = r.blocked
    ? '<span class="d-tag warn">À vérifier</span>'
    : r.status === 'requested'
      ? `<small>demandé${r.requested_by ? ` par ${r.requested_by === 'studio:studio' ? 'Studio' : esc(r.requested_by)}` : ''}</small>`
      : canDraw
        ? `<button type="button" class="d-btn sm" data-act="sw-draw" data-spin="${esc(r.spin_id)}" data-name="${esc(r.viewer.name)}">Tirer</button>`
        : '';
  return `<div class="whl-r ${r.blocked ? 'watch' : ''}">
    ${who(r.viewer, `T${r.tier} · ${monthLabel(r.right, r.months)}`)}
    <span class="whl-r__a">${action}</span>
    <div class="whl-r__m d-tags">${tag(pc, pl)}${sourcesOf(r.sources ?? [])}<small>${esc(time(r.right?.acquired_at ?? r.created_at))}</small></div>
  </div>`;
}

const block = (
  title: string,
  hint: string,
  rows: SwRightView[],
  draw: boolean,
) =>
  `<section class="whl-b"><h3>${esc(title)} <span class="whl-n">${rows.length}</span></h3>${
    rows.length
      ? rows.map((r) => rightRow(r, draw)).join('')
      : `<p class="d-note">${esc(hint)}</p>`
  }</section>`;

const V2_UNAVAILABLE =
  '<p class="whl-line">Le serveur connecté ne gère pas encore la Roue du Sub V2 : seule la V1 est disponible (historique, activation et tests).</p>';

function waitingTab(s: SwState) {
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
      ? ''
      : `<p class="whl-line">Mode ${esc(MODE[mode][0])} : la V2 ne tire pas encore. Les tours et les demandes attendent le mode V2.</p>`;
  return `${banner}
    <div class="whl-tool"><small>« Tirer » place le tour avant la file automatique : il passe à la prochaine roue.</small>
      <button type="button" class="d-btn ghost sm" data-act="sw-tab" data-tab="rights">${ic('plus')}Accorder un tour</button></div>
    ${block('Demandes de tirage', 'Aucune demande.', requested, false)}
    ${block('File automatique', 'Aucun tour en file automatique (subs reçus en live).', auto, true)}
    ${block('Tours manuels', 'Aucun tour manuel (acquis hors live, accordés).', manual, true)}`;
}

// --- À vérifier ----------------------------------------------------------------------------------------------------------

function proofs(side: ReviewSide) {
  if (!side.sources.length)
    return '<small>aucune preuve enregistrée (ligne V1)</small>';
  return `<ul class="whl-proofs">${side.sources
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
  return `<article class="whl-rev">
    <header><b>${esc(s.viewer_name ?? r.viewer_id)}</b><span>même mois ${r.month} possible</span>
      ${r.status === 'unresolved' ? tag('warn', 'laissé en attente') : tag('warn', 'à vérifier')}
      <small>depuis ${esc(time(r.created_at))}</small></header>
    <div class="whl-pair">
      <div><h4>Tour bloqué</h4><p>${monthLabel(s)} · ${esc(STATUS[s.status] ?? s.status)}</p>${proofs(s)}</div>
      <div><h4>Tour du même mois</h4><p>${monthLabel(r.other)} · ${esc(STATUS[r.other.status] ?? r.other.status)}${r.other.amount != null ? ` · ${n(Number(r.other.amount))} jetons` : ''}</p>${proofs(r.other)}</div>
    </div>
    <div class="whl-acts">
      <button type="button" class="d-btn sm" data-act="sw-review" data-decision="distinct" data-review="${id}">Deux mois distincts</button>
      ${mergeable ? `<button type="button" class="d-btn sm" data-act="sw-review" data-decision="merge" data-review="${id}">Fusionner (doublon)</button>` : ''}
      ${r.status === 'open' ? `<button type="button" class="d-btn ghost sm" data-act="sw-review" data-decision="unresolved" data-review="${id}">Laisser en attente</button>` : ''}
    </div>
  </article>`;
}

/** Roues tirées et créditées, peut-être vues : jamais remontrées toutes seules, le diffuseur décide. */
function checksBlock(s: SwState) {
  const c = s.recovery?.checks ?? [];
  if (!c.length) return '';
  return `<section class="whl-b"><h3>Animations peut-être vues <span class="whl-n">${c.length}</span></h3>
    <p class="d-note">La roue a démarré sans que sa fin soit confirmée. Le gain est déjà décidé et crédité ; rien n’est rejoué tout seul. Vue : l’annonce part une fois. Pas vue : le même tirage est remontré, rien de re-crédité.</p>
    ${c
      .map(
        (r) => `<div class="whl-r">
          ${who(r.viewer, esc(time(r.created_at)))}
          <span class="whl-r__a"><b class="whl-amt">${r.amount === null ? '—' : `${n(r.amount)} jetons`}</b></span>
          <div class="whl-r__m"><small>${esc(CHECK_WHY[r.reason ?? ''] ?? `Erreur pendant la roue : ${r.reason ?? 'inconnue'}`)} ${esc(AWARD[r.award.status])}</small></div>
          <div class="whl-acts"><button type="button" class="d-btn sm" data-act="sw-confirm-shown" data-spin="${esc(r.spin_id)}" data-name="${esc(r.viewer.name)}">Elle a bien été vue</button>
            <button type="button" class="d-btn ghost sm" data-act="sw-replay" data-spin="${esc(r.spin_id)}" data-name="${esc(r.viewer.name)}" data-amount="${r.amount ?? 0}" data-award="${esc(r.award.status)}">Rejouer l’animation</button></div>
        </div>`,
      )
      .join('')}</section>`;
}

function detectionsBlock(s: SwState) {
  const d = s.subscription_detections ?? [];
  if (!d.length) return '';
  return `<section class="whl-b"><h3>Abonnements sans événement reçu <span class="whl-n">${d.length}</span></h3>
    <p class="d-note">Pour information : Twitch liste ces abonnés payants, mais aucun événement n’a été reçu (interruption du bot ?). Un abonnement actif ne prouve pas un nouveau mois : aucun tour n’est créé. Si un tour est dû, accorde-le dans Droits.</p>
    ${d
      .map(
        (x) =>
          `<div class="whl-h"><span>${x.viewer_name ? `<b>${esc(x.viewer_name)}</b>` : `<small>pseudo inconnu (Twitch ID ${esc(x.viewer_id)})</small>`}</span><small>T${Number(x.tier) || 1} · ${esc(time(x.detected_at))}</small></div>`,
      )
      .join('')}</section>`;
}

function reviewTab(s: SwState) {
  if (s.v2_unavailable) return V2_UNAVAILABLE;
  const reviews = s.reviews ?? [];
  const dups = s.possible_duplicates ?? [];
  return `<p class="d-note">Deux tours du même viewer pourraient être le même mois sans preuve sûre : les deux sont gardés, le tour bloqué n’est tiré par aucun chemin tant qu’une décision n’est pas prise. Une fusion ne crédite rien et n’efface rien.</p>
    ${reviews.length ? reviews.map(reviewCard).join('') : '<div class="d-empty">Aucun tour à vérifier.</div>'}
    ${checksBlock(s)}
    <section class="whl-b"><h3>Possible doublon <span class="whl-n">${dups.length}</span></h3>
      <p class="d-note">Pour information : rien n’est bloqué ni fusionné. Un mois estimé et un autre tour à moins de 28 jours d’écart peuvent être le même renouvellement.</p>
      ${dups
        .map(
          (
            d,
          ) => `<div class="whl-dup"><b>${esc(d.viewer_name)}</b><small>${String(d.days_apart).replace('.', ',')} j</small>
            <span>${monthLabel(d.a)}<small>${esc(STATUS[d.a.status] ?? d.a.status)} · ${esc(time(d.a.at))}</small></span>
            <span>${monthLabel(d.b)}<small>${esc(STATUS[d.b.status] ?? d.b.status)} · ${esc(time(d.b.at))}</small></span></div>`,
        )
        .join('')}</section>
    ${detectionsBlock(s)}`;
}

// --- Historique ----------------------------------------------------------------------------------------------------------

function historyRow(r: SwSpinView) {
  const result =
    r.amount === null
      ? '—'
      : `${n(r.amount)} jetons <small>(segment ${(r.segment ?? 0) + 1})</small>`;
  const canReplay =
    (r.status === 'failed' || r.status === 'skipped') &&
    r.amount !== null &&
    r.source !== 'test' &&
    r.source !== 'simulation';
  const pending = r.award.status === 'pending';
  const acts = [
    canReplay
      ? `<button type="button" class="d-btn ghost sm" data-act="sw-replay" data-spin="${esc(r.spin_id)}" data-name="${esc(r.viewer.name)}" data-amount="${r.amount}" data-award="${esc(r.award.status)}">Rejouer l’animation</button>`
      : '',
    pending
      ? `<button type="button" class="d-btn sm" data-act="sw-manual" data-spin="${esc(r.spin_id)}">Crédité à la main</button>
         <button type="button" class="d-btn bad sm" data-act="sw-cancel" data-spin="${esc(r.spin_id)}">Annuler le gain</button>`
      : '',
  ].join('');
  const tone =
    r.status === 'shown'
      ? 'ok'
      : r.status === 'failed' || r.status === 'skipped'
        ? 'bad'
        : r.status === 'merged' || r.status === 'ignored'
          ? 'off'
          : 'warn';
  const origin =
    r.source === 'twitch'
      ? ''
      : r.source === 'manual'
        ? '<i>Accordé</i> '
        : '<i>Test</i> ';
  const rec = recoveryLabel(r);
  const award = AWARD[r.award.status];
  return `<div class="whl-r hist">
    <span class="whl-who__t"><b>${origin}${esc(r.viewer.name)}</b><small>${r.type === 'sub' ? 'sub' : 'resub'} · T${r.tier} · ${r.right?.month_source ? monthLabel(r.right) : `${r.months} mois`}</small></span>
    <span class="whl-r__a"><b class="whl-amt">${result}</b><small>${esc(time(r.created_at))}</small></span>
    <div class="whl-r__m d-tags">${tag(tone, STATUS[r.status] ?? r.status)}${award ? `<small>${esc(award)}${r.award.note ? ` : ${esc(r.award.note)}` : ''}</small>` : ''}</div>
    ${rec ? `<p class="whl-rec">${esc(rec)}</p>` : ''}
    ${r.reason && r.status !== 'ignored' ? `<small>${esc(r.reason)}</small>` : ''}
    ${acts ? `<div class="whl-acts">${acts}</div>` : ''}
  </div>`;
}

function historyTab(s: SwState, ui: SwUi) {
  const list = ui.pendingOnly
    ? s.recent.filter((r) => r.award.status === 'pending')
    : s.recent;
  const filter = s.pending_awards.count
    ? `<div class="whl-tool">${seg(
        'data-hist',
        [
          ['all', 'Toutes les roues'],
          ['pending', `À attribuer ${s.pending_awards.count}`],
        ],
        ui.pendingOnly ? 'pending' : 'all',
      )}</div>`
    : '';
  return `${filter}${list.map(historyRow).join('') || '<div class="d-empty">Aucune roue.</div>'}`;
}

// --- La colonne ----------------------------------------------------------------------------------------------------------

/** Les alertes, le choix de la liste et son contenu. */
export function subWheelView(
  s: SwState | null,
  error: string | null,
  ui: SwUi = { tab: 'waiting' },
) {
  if (error) return `<div class="d-empty">${esc(error)}</div>`;
  if (!s) return '<div class="d-skel" style="height:220px"></div>';
  const rights = (s.rights ?? []).length;
  const todo = (s.reviews ?? []).length + (s.recovery?.checks.length ?? 0);
  const body =
    ui.tab === 'rights'
      ? (ui.rights ?? '')
      : ui.tab === 'review'
        ? reviewTab(s)
        : ui.tab === 'history'
          ? historyTab(s, ui)
          : waitingTab(s);
  return `${alertsView(s)}
    ${seg(
      'data-tab',
      [
        ['waiting', `En attente${rights ? ` (${rights})` : ''}`],
        ['review', `À vérifier${todo ? ` (${todo})` : ''}`],
        ['rights', 'Droits'],
        ['history', 'Historique'],
      ],
      ui.tab,
      'block whl-tabs',
    )}
    <div class="whl-body d-scroll">${body}</div>`;
}

// --- Réglages ------------------------------------------------------------------------------------------------------------

const say = (k: string, html: string) =>
  `<div class="d-row col" data-k="${esc(k)}">${html}</div>`;

export function settingsPanel(s: SwState) {
  const mode = s.settings.mode ?? 'v1';
  const fx = s.effects;
  const parts = [
    grp(
      'Lecteur d’effets',
      'eye',
      say(
        'lecteur effets source obs adresse',
        `${player(s)}${fx?.url ? '<button type="button" class="d-btn sm" data-copy>Copier l’adresse de la source OBS</button>' : ''}<small>La roue tourne après l’alerte de sub. Rien n’est tiré tant que le lecteur ne peut pas la jouer.</small>`,
      ),
      'source',
    ),
  ];
  if (s.v2_unavailable) parts.push(V2_UNAVAILABLE);
  else {
    parts.push(
      grp(
        'Invitations',
        'chat',
        `${row('Invitations naturelles', sw(!!s.settings.invitations_enabled, 'data-act="sw-invitations"', 'Invitations naturelles'), 'chat oui non')}
        ${say('invitations chat', '<small>En V2, pendant le live, LeCroupier_ propose une fois par live à un viewer qui a des tours de les lancer (« oui » / « non », ou !roue oui / !roue non). Accepter demande le tirage ; rien n’est crédité à la réponse ; refuser ne fait perdre aucun tour. Diffuseur uniquement.</small>')}`,
        'invitations',
      ),
    );
    if (typeof s.settings.announce_delay_s === 'number')
      parts.push(
        grp(
          'Annonce du gain',
          'bell',
          say(
            'annonce gain délai chat secondes',
            `<div class="whl-rule"><span data-scrub>Délai</span>${fld('data-f="sw-announce-delay" min="0" max="60" step="1" aria-label="Délai d’annonce en secondes"', s.settings.announce_delay_s, 's')}<button type="button" class="d-btn sm" data-act="sw-announce-delay">Enregistrer</button></div>
            <small>Actuel : ${s.settings.announce_delay_s} s. La roue arrêtée, LeCroupier_ écrit « 🎡 @Pseudo remporte 8 000 jetons à la Roue du Sub ! ». Les viewers voient le stream avec du retard : ce délai évite de dévoiler le gain avant eux. S’applique aux roues suivantes. Diffuseur uniquement.</small>`,
          ),
          'annonce',
        ),
      );
  }
  parts.push(
    grp(
      'Tests',
      'flask',
      say(
        'test animation essai obs complet alerte',
        `<label class="d-fld"><input type="text" data-f="sw-name" maxlength="25" value="Test Studio" aria-label="Pseudo du test"></label>
        <div class="whl-two"><label class="d-fld"><select data-f="sw-tier" aria-label="Tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></label>${fld('data-f="sw-months" min="1" max="200" aria-label="Mois"', 1, 'mois')}</div>
        <div class="whl-acts"><button type="button" class="d-btn sm" data-act="sw-test" title="Joue une roue dans OBS, aucun gain">Tester l’animation</button><button type="button" class="d-btn sm" data-act="sw-full" title="Alerte de sub simulée puis la roue, aucun gain">Test complet simulé</button></div>
        <small>Jamais de gain réel. Ces tests passent par le lecteur d’effets, donc par OBS s’il est ouvert.</small>`,
      ),
    ),
    grp(
      'Permissions',
      'lock',
      say(
        'permissions droits modérateur supermodérateur diffuseur',
        `<dl class="d-kv"><dt>Changer le mode</dt><dd>diffuseur seul</dd><dt>Invitations, annonce</dt><dd>diffuseur seul</dd><dt>Demander un tirage</dt><dd>diffuseur, supermodérateurs, modérateurs autorisés</dd><dt>Accorder un tour</dt><dd>diffuseur, supermodérateurs, modérateurs autorisés</dd></dl>
        <small>Studio agit comme diffuseur ; chaque décision est journalisée. Les modérateurs autorisés se règlent dans <a href="/?p=moderation" data-page="moderation">Modération</a>.</small>`,
      ),
    ),
  );
  if (!s.v2_unavailable)
    parts.push(
      grp(
        'Avancé',
        'sliders',
        say(
          'mode v1 v2 acquisition retour arrière avancé',
          `<details class="d-acc whl-adv"${mode === 'v2' ? '' : ' open'}><summary>Mode actuel : ${esc(MODE[mode][0])}. À changer seulement pour revenir à l’ancienne roue.</summary>
          <div class="whl-modes">${(Object.keys(MODE) as SwMode[])
            .map(
              (m) =>
                `<button type="button" class="whl-mode${m === mode ? ' on' : ''}" data-act="sw-mode" data-mode="${m}" aria-pressed="${m === mode}"><b>${esc(MODE[m][0])}</b><span>${esc(MODE[m][1])}</span></button>`,
            )
            .join('')}</div></details>`,
        ),
        'mode',
      ),
    );
  return parts.join('') + labPanel(s);
}

const SIMULATE: [string, string][] = [
  ['sub', 'Nouveau sub (avis + abonnement)'],
  ['resub', 'Resub partagé (avis + message, mois cumulés)'],
  ['prime', 'Prime (avis + abonnement)'],
  ['subscribe', 'Abonnement seul (reprise non partagée)'],
  ['message', 'Message de resub seul'],
];

/** Lab seulement : les simulateurs explicites : le live, les relevés de chatters, chaque viewer, les événements. */
export function labPanel(s: SwState) {
  const lab = s.lab_sim;
  if (!s.settings.lab || !lab) return '';
  const viewers = lab.viewers
    .map(
      (
        v,
      ) => `<div class="whl-h"><span><b>${esc(v.display_name)}</b> ${tag(v.present ? 'ok' : 'off', v.present ? 'présent' : 'absent')}</span>
        <button type="button" class="d-btn ghost sm" data-act="sw-sim-present" data-id="${esc(v.viewer_id)}" data-name="${esc(v.display_name)}" data-present="${v.present ? '0' : '1'}">${v.present ? 'Rendre absent' : 'Rendre présent'}</button></div>`,
    )
    .join('');
  return grp(
    'Simulateur',
    'flask',
    `${say('lab données test', '<small>Lab : données de test. Les gains vont au portefeuille de test, jamais aux Jetons de Production. Rien n’est envoyé à Twitch ni à OBS.</small>')}
    ${say(
      'live simulé',
      `<div class="whl-h"><span>${lab.live ? 'Live simulé en cours' : 'Hors live'}</span><button type="button" class="d-btn sm" data-act="sw-sim-live" data-on="${lab.live ? '0' : '1'}">${lab.live ? 'Terminer le live' : 'Démarrer un live'}</button></div>`,
    )}
    ${say(
      'présence relevés chatters viewer',
      `<div class="whl-h"><span>${lab.readings ? 'Relevés actifs' : 'Aucun relevé : présence inconnue'}</span><button type="button" class="d-btn sm" data-act="sw-sim-readings" data-on="${lab.readings ? '0' : '1'}">${lab.readings ? 'Arrêter les relevés' : 'Démarrer les relevés'}</button></div>
      ${viewers || '<small>Aucun viewer simulé.</small>'}
      <form class="whl-form" data-role="sw-sim-viewer"><label class="d-fld"><input type="text" data-f="sv-name" maxlength="64" required placeholder="Pseudo" aria-label="Pseudo"></label><button class="d-btn sm">Ajouter présent</button></form>`,
    )}
    ${say(
      'lecteur échec affichage',
      `<small>La prochaine roue est prise par un lecteur qui ne la démarre jamais : elle est tirée et créditée, puis remontrée toute seule (le même tirage, rien de re-crédité) après son délai.</small>
      ${s.lab_fail_next_start ? tag('warn', 'Prochain affichage : échec avant démarrage') : ''}
      <button type="button" class="d-btn sm" data-act="sw-sim-fail-start" data-on="${s.lab_fail_next_start ? '0' : '1'}">${s.lab_fail_next_start ? 'Annuler l’échec simulé' : 'Faire échouer le prochain affichage'}</button>`,
    )}
    ${say(
      'événement twitch simulé sub resub prime',
      `<form class="whl-form col" data-role="sw-sim-event">
        <label class="d-fld"><select data-f="se-kind" aria-label="Type">${SIMULATE.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
        <label class="d-fld"><input type="text" data-f="se-name" maxlength="64" required placeholder="Pseudo" aria-label="Pseudo"></label>
        <div class="whl-two"><label class="d-fld"><select data-f="se-tier" aria-label="Tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></label>${fld('data-f="se-months" min="1" max="200" aria-label="Mois cumulés"', 2, 'mois')}</div>
        <button class="d-btn pri sm">Envoyer l’événement</button>
      </form>`,
    )}`,
    'lab test',
  );
}
