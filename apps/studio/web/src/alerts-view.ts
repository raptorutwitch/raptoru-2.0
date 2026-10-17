// Twitch alerts V1 (A2) — Studio tab, pure part (docs/TWITCH_ALERTS_PARITY_2026-10.md § 14): fake data presets,
// the test event / preview data built from the form, and the HTML of the dynamic blocks. No DOM, no fetch.

export interface AlertVariantInfo {
  id: string;
  type: string;
  video?: string;
  audio?: string;
  textStyle?: string;
  provisional?: boolean;
  /** Measured frame rate (timeline image by image). */
  fps?: number;
  /** Media names absent from Studio's storage (relayed catalogue). */
  missing: string[];
  [k: string]: unknown;
}

export interface AlertItem {
  alert_id: string;
  type: string;
  variant_id: string;
  data: Record<string, unknown>;
  status: string;
  attempts: number;
  created_at: string | null;
  failure: { code?: string; message?: string | null } | null;
}

export interface AlertsState {
  /** Which Core holds the queue (§ 22). */
  environment?: 'lab' | 'production';
  /** OBS source seen by Studio (it asks every second). */
  source?: { seen: boolean; ago_ms: number | null; current: boolean | null };
  in_flight: AlertItem[];
  queued: AlertItem[];
  recent: AlertItem[];
  media: { name: string; available: boolean; bytes?: number }[];
  player_url: string;
  preview_url: string;
}

/** The form: a subset of the normalized event (Core validates the test event). */
export interface FakeData {
  pseudo: string;
  anonymous: boolean;
  recipient: string;
  count: number;
  bits: number;
  viewers: number;
  amount: string;
  currency: string;
  message: string;
}

export const CATEGORIES: Record<string, string> = {
  follow: 'Follow',
  sub: 'Abonnement',
  gift_community: 'Sub gift (communauté)',
  gift_targeted: 'Sub gift (ciblé)',
  bits: 'Bits',
  donation: 'Don',
  raid: 'Raid',
};

/**
 * Alert families (same as @raptoru/schemas `alertFamilyOf`, checked by a test): the overlap test plays one variant
 * of each OTHER family beside the edited one, like the OBS source does.
 */
export const familyOfType = (type: string) =>
  ['sub', 'resub', 'gift_targeted', 'gift_community'].includes(type)
    ? 'subscription'
    : type;
const FAMILY_SAMPLES = ['follow', 'sub', 'bits', 'donation', 'raid'];

/** The categories to play beside `category` in the overlap test (one per other family). */
export const overlapCategories = (category: string) =>
  FAMILY_SAMPLES.filter((c) => familyOfType(c) !== familyOfType(category));

const BASE: FakeData = {
  pseudo: 'Raptoru_Fan',
  anonymous: false,
  recipient: 'Viewer_Chanceux',
  count: 5,
  bits: 100,
  viewers: 42,
  amount: '5',
  currency: 'EUR',
  message: 'Merci pour le stream !',
};

export const PRESETS: Record<string, { label: string; data: FakeData }> = {
  normal: { label: 'Normal', data: BASE },
  long: {
    label: 'Pseudo long',
    data: {
      ...BASE,
      pseudo: 'UnPseudoVraimentTresTresLong_25',
      recipient: 'DestinataireAuPseudoInterminable',
      message:
        'Un message de don très long pour vérifier que le texte tient dans son cadre sans déborder, même quand le viewer écrit beaucoup, vraiment beaucoup, jusqu’à la limite.',
      count: 100,
      viewers: 12345,
      amount: '1234.56',
    },
  },
  hostile: {
    label: 'HTML hostile',
    data: {
      ...BASE,
      pseudo: '<img src=x onerror=alert(1)>',
      recipient: '"><script>alert(2)</script>',
      message: '<b>gras</b> & <script>alert(3)</script>',
    },
  },
  anonymous: {
    label: 'Anonyme',
    data: { ...BASE, anonymous: true, pseudo: '' },
  },
};

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** Which fake data fields a category uses. */
export function fieldsOf(type: string): (keyof FakeData)[] {
  switch (type) {
    case 'gift_community':
      return ['pseudo', 'anonymous', 'count'];
    case 'gift_targeted':
      return ['pseudo', 'anonymous', 'recipient'];
    case 'bits':
      return ['pseudo', 'bits'];
    case 'donation':
      return ['pseudo', 'anonymous', 'amount', 'currency', 'message'];
    case 'raid':
      return ['pseudo', 'viewers'];
    default:
      return ['pseudo'];
  }
}

const person = (name: string) =>
  name.trim() ? { display_name: name.trim().slice(0, 64) } : undefined;

/** The test event sent to Core's queue (source simulation, through Studio). */
export function testEvent(type: string, f: FakeData) {
  const has = new Set(fieldsOf(type));
  const anonymous = has.has('anonymous') && f.anonymous;
  const ev: Record<string, unknown> = { type };
  const actor = anonymous ? undefined : person(f.pseudo);
  if (actor) ev.actor = actor;
  if (anonymous) ev.anonymous = true;
  if (has.has('recipient')) ev.recipient = person(f.recipient);
  if (has.has('count')) ev.count = f.count;
  if (has.has('bits')) ev.bits = f.bits;
  if (has.has('viewers')) ev.viewers = f.viewers;
  if (has.has('amount')) {
    const [int, dec = ''] = f.amount.replace(',', '.').split('.');
    const decimals = Math.min(2, dec.length);
    ev.amount = {
      value:
        Number(int || 0) * 10 ** decimals + Number(dec.slice(0, decimals) || 0),
      decimal_place: decimals,
      currency: f.currency.toUpperCase(),
    };
    if (f.message.trim()) ev.message = f.message.slice(0, 500);
  }
  return ev;
}

/**
 * The preview's data for a test event: the same fields Core's `alertData` gives the OBS source
 * (apps/core-api/src/alerts/rules.ts — kept in step by hand, small and stable).
 */
export function previewData(ev: Record<string, unknown>) {
  const type = String(ev.type);
  const actor = ev.actor as { display_name: string } | undefined;
  const anonymousGifter =
    (type === 'gift_targeted' || type === 'gift_community') &&
    (ev.anonymous === true || !actor);
  const amount = ev.amount as
    { value: number; decimal_place: number; currency: string } | undefined;
  return {
    pseudo: anonymousGifter
      ? 'Un généreux anonyme'
      : (actor?.display_name ?? 'Anonyme'),
    ...(ev.recipient
      ? { recipient: (ev.recipient as { display_name: string }).display_name }
      : {}),
    ...(ev.count !== undefined ? { count: ev.count } : {}),
    ...(ev.bits !== undefined ? { amount: String(ev.bits) } : {}),
    ...(amount
      ? {
          amount: (amount.value / 10 ** amount.decimal_place).toFixed(
            amount.decimal_place,
          ),
          currency: amount.currency,
        }
      : {}),
    ...(ev.viewers !== undefined ? { viewers: ev.viewers } : {}),
    ...(ev.message ? { message: ev.message } : {}),
    anonymous: anonymousGifter || ev.anonymous === true,
  };
}

const LABELS: Record<keyof FakeData, string> = {
  pseudo: 'Pseudo',
  anonymous: 'Anonyme',
  recipient: 'Destinataire',
  count: 'Nombre de subs',
  bits: 'Bits',
  viewers: 'Viewers',
  amount: 'Montant',
  currency: 'Devise',
  message: 'Message',
};

/** The fake data inputs of a category (values escaped: the presets include hostile HTML on purpose). */
export function formView(type: string, f: FakeData) {
  return fieldsOf(type)
    .map((k) => {
      const label = `<span>${LABELS[k]}</span>`;
      if (k === 'anonymous')
        return `<label class="al-check"><input type="checkbox" data-field="anonymous" ${f.anonymous ? 'checked' : ''}/> ${LABELS[k]}</label>`;
      if (k === 'message')
        return `<label class="al-field al-wide">${label}<textarea data-field="message" rows="2" maxlength="500">${esc(f.message)}</textarea></label>`;
      if (k === 'currency')
        return `<label class="al-field">${label}<select data-field="currency">${[
          'EUR',
          'USD',
          'GBP',
          'CAD',
          'CHF',
        ]
          .map(
            (c) =>
              `<option ${c === f.currency ? 'selected' : ''}>${c}</option>`,
          )
          .join('')}</select></label>`;
      const numeric = k === 'count' || k === 'bits' || k === 'viewers';
      return `<label class="al-field">${label}<input data-field="${k}" ${numeric ? 'type="number" min="1"' : 'type="text" maxlength="64"'} value="${esc(f[k])}"/></label>`;
    })
    .join('');
}

const time = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '';

const STATUS: Record<string, string> = {
  queued: 'en attente',
  claimed: 'réservée',
  playing: 'en cours',
  completed: 'terminée',
  failed: 'échec',
  expired: 'expirée',
};

const row = (a: AlertItem) =>
  `<li class="al-item al-item--${esc(a.status)}"><span class="al-time">${time(a.created_at)}</span>
    <b>${esc(CATEGORIES[a.type] ?? a.type)}</b> · ${esc(a.data.pseudo)} <code>${esc(a.variant_id)}</code>
    <span class="al-status">${esc(STATUS[a.status] ?? a.status)}${a.attempts > 1 ? ` (essai ${a.attempts})` : ''}</span>
    ${a.failure ? `<span class="al-failure">${esc(a.failure.message ?? a.failure.code)}</span>` : ''}</li>`;

const list = (items: AlertItem[], empty: string) =>
  items.length
    ? `<ul class="al-list">${items.map(row).join('')}</ul>`
    : `<p class="al-empty">${empty}</p>`;

/** The queue as Core sees it (relayed by Studio). */
export function queueView(s: AlertsState | null, error: string | null) {
  if (error) return `<p class="al-error">${esc(error)}</p>`;
  if (!s) return '<p class="al-empty">Chargement…</p>';
  return `<h3>En cours</h3>${list(s.in_flight, 'Aucune alerte en cours.')}
    <h3>En attente (${s.queued.length})</h3>${list(s.queued, 'File vide.')}
    <h3>Récentes</h3>${list(s.recent, 'Aucune alerte jouée.')}`;
}

/** The OBS source line (pure, tested). */
export function sourceView(s: AlertsState | null) {
  const src = s?.source;
  if (!src) return '';
  if (!src.seen)
    return src.ago_ms === null
      ? '<p class="al-error">Aucune source OBS connectée depuis le démarrage de Studio.</p>'
      : `<p class="al-error">Source OBS silencieuse depuis ${Math.round(src.ago_ms / 1000)} s (OBS fermé, source masquée avec « Arrêter la source quand elle n’est pas visible », ou URL différente).</p>`;
  return src.current
    ? '<p class="al-ok">Source OBS connectée, à jour.</p>'
    : '<p class="al-hint">Source OBS connectée, ancienne version : elle se rechargera seule dès qu’aucune alerte ne joue.</p>';
}

export function mediaView(s: AlertsState | null) {
  if (!s) return '';
  const missing = s.media.filter((m) => !m.available);
  return `<p class="${missing.length ? 'al-error' : 'al-ok'}">${s.media.length - missing.length} / ${s.media.length} médias importés.</p>
    ${missing.length ? `<ul class="al-missing">${missing.map((m) => `<li>${esc(m.name)}</li>`).join('')}</ul>` : ''}`;
}

/** One variant's media availability in the selector. */
export const variantLabel = (v: AlertVariantInfo) =>
  `${v.id}${v.provisional ? ' (provisoire)' : ''}${v.missing.length ? ' — média manquant' : ''}`;

const REASONS: Record<string, string> = {
  'video-ended': 'fin de la vidéo',
  'audio-ended': 'fin du son (prolongé)',
  duration: 'durée imposée',
  stopped: 'arrêtée',
  replaced: 'remplacée',
  'video-error': 'erreur du lecteur vidéo',
  'video-play-error': 'lecture refusée',
  'no-media': 'aucun média',
  timeout: 'délai de sécurité dépassé',
};

/** The preview's last state line. */
export function previewStatus(
  m: { state: string; reason?: string; ms?: number } | null,
) {
  if (!m) return 'Prêt.';
  if (m.state === 'loading') return 'Chargement…';
  if (m.state === 'playing') return 'Lecture en cours…';
  return `Terminée : ${REASONS[m.reason ?? ''] ?? m.reason} (${((m.ms ?? 0) / 1000).toFixed(1)} s).`;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(3).replace('.', ',')} s`;

/** The timeline instant: « 1,500 s · image 37 » (image numbers start at 1, as in an editor). */
export function scrubLabel(ms: number, fps = 24) {
  return `${seconds(ms)} · image ${Math.floor((ms * fps) / 1000 + 1e-6) + 1}`;
}

const MARKS: Record<string, string> = {
  'text-show': 'texte',
  'text-fade': 'fondu texte',
  'text-hide': 'sortie texte',
  'text-clear': 'fin texte',
  'subtitle-show': 'sous-titre',
  'subtitle-tremble': 'tremblement',
  'subtitle-out': 'fin sous-titre',
  'video-fade-out': 'fondu vidéo',
};

/** The variant's text steps under the timeline (calibration reference). */
export function scrubMarks(marks: { at: number; action: string }[]) {
  return marks.length
    ? `Repères : ${marks.map((m) => `${MARKS[m.action] ?? m.action} ${seconds(m.at)}`).join(' · ')}`
    : 'Aucun texte sur cette alerte.';
}
