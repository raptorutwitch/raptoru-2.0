// Twitch alerts V1 (A2) — the pure part of the alert engine (no DOM): when each text step happens, when an alert ends,
// the texts and the legacy sizing / formatting rules. Ported from the legacy page `Twitch_Alerts.html` (17/09/2026).
// Shared by the OBS player and the Studio preview through engine.js; tested on its own. Every timing comes from the
// variant (a later calibration only changes the variant, never this code).

/** Legacy `formatAmount`: « 5€ », « $5 », « £5 », else « 5 CAD ». */
export function formatAmount(amount, currency = 'EUR') {
  const raw = String(amount ?? '').trim();
  const code = String(currency || 'EUR').toUpperCase();
  if (!raw) return '';
  if (/[€$£]|eur|usd|cad|chf|gbp/i.test(raw)) return raw;
  if (code === 'EUR') return raw + '€';
  if (code === 'USD') return '$' + raw;
  if (code === 'GBP') return '£' + raw;
  return raw + ' ' + code;
}

/** Fills a text template. Values are plain strings: the engine always inserts them as text, never as HTML. */
export function fill(template, data) {
  return String(template ?? '').replace(
    /\{(pseudo|amount|count|recipient|message|viewers)\}/g,
    (_, k) => String(data?.[k] ?? ''),
  );
}

/** Viewer-name colours (17/10/2026): readable light tones of the alerts' family, no yellow (amounts / counters). */
export const NAME_COLORS = [
  '#6ee7ff',
  '#ff91d7',
  '#ffb38a',
  '#7ef0b4',
  '#c3a6ff',
  '#8fc4ff',
];

/**
 * One colour per alert, never the previous one nor one in use by an alert playing beside it (`avoid`: a colour or a
 * list); the name keeps it for the whole alert.
 */
export function pickNameColor(avoid, random = Math.random) {
  const skip = new Set([avoid].flat());
  const choices = NAME_COLORS.filter((c) => !skip.has(c));
  return choices[Math.floor(random() * choices.length)] ?? NAME_COLORS[0];
}

/**
 * Alert families (same as @raptoru/schemas ALERT_FAMILIES, checked by a test): one alert per family at a time, the
 * families side by side. Their order is the stacking order in the OBS source, bottom to top (visual only).
 */
export const FAMILY_ORDER = [
  'follow',
  'subscription',
  'bits',
  'donation',
  'raid',
];

/** The family of an event type (never of a variant or a video). */
export function familyOf(type) {
  if (type === 'follow') return 'follow';
  if (
    [
      'sub',
      'resub',
      'gift_targeted',
      'gift_community',
      'gift_recipient',
    ].includes(type)
  )
    return 'subscription';
  return FAMILY_ORDER.includes(type) ? type : 'follow';
}

/** z-index of a family's layer in the source (1 = bottom). */
export const familyLayer = (family) =>
  Math.max(0, FAMILY_ORDER.indexOf(family)) + 1;

/** A template split around its variables: [class, text] parts, each variable named in `classes` in its own class. */
export function templateParts(template, data, classes) {
  return String(template ?? '')
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((p) => {
      const k = p.slice(1, -1);
      return p[0] === '{' && classes[k]
        ? [classes[k], String(data?.[k] ?? '')]
        : ['', fill(p, data)];
    });
}

/** Legacy Dofus banner: names over 14 characters shrink proportionally. */
export function dofusFontSize(length, base = 44) {
  return length > 14 ? Math.round(base * (14 / length) * 10) / 10 : base;
}

/** Legacy donation text sizes. */
export function donationSizes(pseudo, title, message) {
  return {
    name: pseudo.length > 18 ? 34 : pseudo.length > 12 ? 39 : 46,
    amount: title.length > 9 ? 34 : 42,
    message:
      message.length > 190
        ? 17
        : message.length > 130
          ? 20
          : message.length > 80
            ? 23
            : 26,
  };
}

/** Legacy gift counter: 0 → N in min(1 500, 650 + 18 × N) ms (ease-out cubic). */
export const giftCounterDuration = (count) => Math.min(1500, 650 + count * 18);

/** Default fade before hideAt when a zone variant has no fadeOutAt (legacy: gifts 220 ms, bits 350 ms). */
const FADE_BEFORE_HIDE = {
  'pseudo-subgift': 220,
  'pseudo-bits': 350,
  'pseudo-zone': 350,
};

/**
 * The text steps of a variant, sorted by time (ms from the start of the alert):
 * text-show / text-fade / text-clear / text-hide, subtitle-show / subtitle-tremble / subtitle-out, video-fade-out.
 */
export function schedule(v) {
  const steps = [];
  const add = (at, action, extra = {}) => {
    if (Number.isFinite(at)) steps.push({ at, action, ...extra });
  };
  switch (v.textStyle) {
    case 'pseudo-classic':
    case 'pseudo-dofus':
      if (v.text) {
        add(v.showAt, 'text-show');
        add(v.hideAt, 'text-hide');
      }
      break;
    case 'eren-subs':
      (v.subtitles ?? []).forEach((s, index) => {
        add(s.showAt, 'subtitle-show', { index });
        add(Math.max(s.showAt, s.hideAt - 350), 'subtitle-tremble', { index });
        add(s.hideAt, 'subtitle-out', { index });
      });
      break;
    case 'pseudo-subgift':
    case 'pseudo-bits':
    case 'pseudo-zone':
      add(v.showAt, 'text-show');
      add(v.fadeOutAt ?? v.hideAt - FADE_BEFORE_HIDE[v.textStyle], 'text-fade');
      add(v.hideAt, 'text-clear');
      break;
    case 'pseudo-don':
      add(v.showAt, 'text-show');
      add(v.hideAt, 'text-hide');
      if (v.videoFade) add(v.videoFade.outAt, 'video-fade-out');
      break;
  }
  return steps.sort((a, b) => a.at - b.at);
}

/**
 * When an alert is over. The legacy SAMMI fixed waits are NOT reproduced (they cut some videos): an imposed duration
 * ends it (legacy: duration + 300 ms); otherwise the end of the video, and a sound that plays on (keepAudio) delays
 * the end until it finishes. A safety timeout (media / timings + 10 s, inside Core's 15 s lease margin) reports a
 * stalled player as a failure instead of hanging.
 */
export function endPlan(v) {
  const base = Math.max(
    v.duration ?? 0,
    v.mediaMs ?? 0,
    v.hideAt ?? 0,
    ...(v.subtitles ?? []).map((s) => s.hideAt),
  );
  return {
    imposedMs: v.duration ? v.duration + 300 : null,
    waitVideoEnd: !v.duration,
    keepAudio: Boolean(v.keepAudio && v.audio),
    safetyMs: (base || 10_000) + 10_000,
  };
}

/** The pieces of a zone / donation text (each one is inserted with textContent). */
export function textParts(v, data) {
  const pseudo = String(data?.pseudo ?? '').trim();
  switch (v.textStyle) {
    case 'pseudo-subgift':
      // Targeted gift: the recipient only, one line (decision 17/10/2026); the gifter stays in the event data.
      return data?.recipient && v.type === 'gift_targeted'
        ? [['gift-recipient', String(data.recipient)]]
        : [
            ['gift-name', pseudo],
            ['gift-x', '×'],
            ['gift-count', '0'],
          ];
    case 'pseudo-bits':
      // « [gem] × N » above the animation, « {pseudo} me permet de manger ! » below it (17/10/2026).
      return [
        ['bits-logo', ''],
        [
          'bits-amount',
          '× ' + Math.max(1, Math.round(Number(data?.amount) || 10)),
        ],
        ['bits-break', ''],
        ['bits-name', pseudo],
        ['', 'me permet de manger !'],
      ];
    case 'pseudo-zone':
      // Raid template « {pseudo} … {viewers} … » split around its variables (wording from the variant).
      return templateParts(
        v.text ?? '{pseudo}',
        { ...data, pseudo, viewers: data?.viewers ?? 0 },
        { pseudo: 'zone-name', viewers: 'zone-number' },
      )
        .map(([cls, t]) => [cls, t.trim()])
        .filter(([, t]) => t !== '');
    case 'pseudo-classic':
      return templateParts(v.text, data, { pseudo: 'alert-name' });
    default:
      return [['', fill(v.text, data)]];
  }
}

/**
 * Length of the Studio preview timeline (visual part of the alert): the imposed duration (+ 300 ms), the video unless
 * it loops, the last text step. A sound that plays on after the video (keepAudio) is not drawn: the image is empty.
 */
export function visualLengthMs(v, videoMs = 0) {
  return Math.max(
    v.duration ? v.duration + 300 : 0,
    v.loop ? 0 : videoMs,
    ...schedule(v).map((s) => s.at),
  );
}
