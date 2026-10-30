import type { AlertType } from '@raptoru/schemas';

// Twitch alerts V1 — the legacy variant catalogue, values copied EXACTLY from
// `C:\Users\Antoni\Videos\Alertes Twitch Pour Claude\Version webm\Twitch_Alerts.html` (17/09/2026) and the SAMMI deck
// (docs/TWITCH_ALERTS_PARITY_2026-10.md § 1). Data only: the handlers never hold rendering values. A queued alert
// keeps a frozen copy of its variant (a later catalogue change never alters it). The media are referenced by their
// legacy file name; A2 copies them into Studio's storage (originals untouched).

/** Legacy page default volume (`VOLUME_GLOBAL`). */
export const LEGACY_VOLUME = 0.5;

export interface AlertVariant {
  id: string;
  type: AlertType;
  /** Legacy file names (folder « Version webm »); null = no media yet (raid: to be chosen). */
  video: string | null;
  audio: string | null;
  /** The sound plays on after the video ends (Eren sub voice line). */
  keepAudio?: boolean;
  loop?: boolean;
  volume: number;
  style: string;
  /** Text layer of the legacy page (the media carry no text). */
  textStyle: string;
  /** Text template; variables: {pseudo}, {amount}, {count}, {recipient}, {message}. */
  text?: string;
  subtitles?: { text: string; showAt: number; hideAt: number }[];
  /** Milliseconds from the start of the alert. */
  showAt?: number;
  fadeOutAt?: number;
  hideAt?: number;
  /** Imposed duration of the alert (otherwise: end of the media). */
  duration?: number;
  /** Text zone in the 1920×1080 frame. */
  zone?: { x: number; y: number; w: number; h: number };
  /** Dofus banners: vertical position of the name and its maximum size. */
  textTop?: string;
  maxFontSize?: number;
  /** Donation layer (legacy CSS variables). */
  textBox?: {
    left: string;
    top: string;
    width: string;
    height: string;
    padding: string;
    enterDuration: number;
    exitDuration: number;
    messageDelay: number;
    messageLines: number;
  };
  videoFade?: { in: number; out: number; outAt: number };
  /** Donation: spoken by the browser TTS (« {pseudo} a donné {amount}. Message du don : {message} »). */
  tts?: { template: string; templateNoMessage: string; lang: string };
  /** Legacy queue priority (higher first). */
  priority: number;
  /** Measured media length (ms), when known: used for the playing lease only. */
  mediaMs?: number;
  /** Measured video frame rate: the Studio preview timeline steps image by image. */
  fps?: number;
  /** No rendering defined yet: queued and observable, configured later. */
  pending?: boolean;
  /** Text, position and timings are placeholders awaiting Antoni's visual validation (raid). */
  provisional?: boolean;
  /** Halloween profile: the usual variant, played instead when Studio lacks this one's media (frozen with it). */
  fallback?: AlertVariant;
}

const GIFT = {
  style: 'default',
  textStyle: 'pseudo-subgift',
  showAt: 2279,
  fadeOutAt: 5745,
  hideAt: 6093,
  volume: 0.15,
  zone: { x: 820, y: 261, w: 319, h: 48 },
  audio: null,
  mediaMs: 6341,
  fps: 24,
} as const;

export const ALERT_VARIANTS: Record<string, AlertVariant> = {
  follow_discord: {
    id: 'follow_discord',
    type: 'follow',
    video: 'Alerte follow Discord monsieur.webm',
    audio: 'son_follow_discord.mp3',
    volume: LEGACY_VOLUME,
    style: 'default',
    textStyle: 'pseudo-classic',
    text: '{pseudo} vient de follow !',
    showAt: 800,
    hideAt: 4500,
    priority: 10,
    mediaMs: 6299,
    fps: 24,
  },
  follow_eren: {
    id: 'follow_eren',
    type: 'follow',
    video: 'Alerte follow Eren.webm',
    audio: 'son_follow_eren.mp3',
    volume: LEGACY_VOLUME,
    style: 'default',
    textStyle: 'pseudo-classic',
    text: '{pseudo} vient de follow !',
    showAt: 800,
    hideAt: 4500,
    priority: 10,
    mediaMs: 6292,
    fps: 24,
  },
  follow_dofus_ebene: {
    id: 'follow_dofus_ebene',
    type: 'follow',
    video: 'Dofus Ebène Son.webm',
    audio: null,
    volume: LEGACY_VOLUME,
    style: 'dofus-banner',
    textStyle: 'pseudo-dofus',
    text: '{pseudo}',
    showAt: 1500,
    hideAt: 3500,
    textTop: '31%',
    maxFontSize: 38,
    priority: 10,
    mediaMs: 4674,
    fps: 24,
  },
  follow_dofus_eliatrope: {
    id: 'follow_dofus_eliatrope',
    type: 'follow',
    video: 'Dofus Eliatrope Son.webm',
    audio: null,
    volume: LEGACY_VOLUME,
    style: 'dofus-banner',
    textStyle: 'pseudo-dofus',
    text: '{pseudo}',
    showAt: 1600,
    hideAt: 3700,
    textTop: '29%',
    maxFontSize: 44,
    priority: 10,
    mediaMs: 4716,
    fps: 24,
  },
  follow_dofus_emeraude: {
    id: 'follow_dofus_emeraude',
    type: 'follow',
    video: 'Dofus Emeraude Son.webm',
    audio: null,
    volume: LEGACY_VOLUME,
    style: 'dofus-banner',
    textStyle: 'pseudo-dofus',
    text: '{pseudo}',
    showAt: 2000,
    hideAt: 3300,
    textTop: '29.8%',
    maxFontSize: 35,
    priority: 10,
    mediaMs: 4299,
    fps: 24,
  },
  eren_sub: {
    id: 'eren_sub',
    type: 'sub',
    video: 'Eren Sub Glitch.webm',
    audio: 'Eren Voiceline Sub.mp3',
    keepAudio: true,
    volume: LEGACY_VOLUME,
    style: 'default',
    textStyle: 'eren-subs',
    subtitles: [
      { text: "Qu'est-ce que tu fous ?!", showAt: 300, hideAt: 1400 },
      {
        text: 'Remercie {pseudo} pour son abonnement !',
        showAt: 1500,
        hideAt: 4300,
      },
    ],
    priority: 30,
    mediaMs: 4417,
    fps: 24,
  },
  subgift_1: {
    id: 'subgift_1',
    type: 'gift_community',
    video: 'Alerte Sub 1.webm',
    text: '{pseudo} × {count}',
    priority: 30,
    ...GIFT,
  },
  subgift_5: {
    id: 'subgift_5',
    type: 'gift_community',
    video: 'Alerte Sub 5.webm',
    text: '{pseudo} × {count}',
    priority: 35,
    ...GIFT,
  },
  subgift_10: {
    id: 'subgift_10',
    type: 'gift_community',
    video: 'Alerte Sub 10.webm',
    text: '{pseudo} × {count}',
    priority: 40,
    ...GIFT,
  },
  subgift_20: {
    id: 'subgift_20',
    type: 'gift_community',
    video: 'Alerte Sub 20.webm',
    text: '{pseudo} × {count}',
    priority: 50,
    ...GIFT,
  },
  subgift_targeted: {
    id: 'subgift_targeted',
    type: 'gift_targeted',
    video: 'Alerte Sub 1.webm',
    // Shows the RECIPIENT only, on one line shrinking to fit (decision 17/10/2026); the gifter (anonymous:
    // « Un généreux anonyme ») stays in the event data. Zone = the real bar (~390×88), wider than the gifts' 319×48.
    text: '{recipient}',
    priority: 30,
    ...GIFT,
    zone: { x: 805, y: 244, w: 370, h: 80 },
  },
  bits_default: {
    id: 'bits_default',
    type: 'bits',
    video: 'Alerte Bits.webm',
    audio: null,
    loop: true,
    volume: 0.5,
    style: 'bits-video',
    textStyle: 'pseudo-bits',
    // « [gem] × {amount} » above the animation, « {pseudo} me permet de manger ! » below (17/10/2026).
    text: '× {amount} / {pseudo} me permet de manger !',
    showAt: 800,
    fadeOutAt: 3800,
    hideAt: 4150,
    duration: 3850,
    zone: { x: 460, y: 262, w: 1000, h: 690 },
    maxFontSize: 44,
    priority: 20,
    fps: 12,
  },
  don_moneytest: {
    id: 'don_moneytest',
    type: 'donation',
    video: 'MoneyTest.webm',
    audio: 'Son Alerte Don.mp3',
    volume: LEGACY_VOLUME,
    style: 'default',
    textStyle: 'pseudo-don',
    showAt: 2660,
    hideAt: 6800,
    duration: 7600,
    videoFade: { in: 800, out: 300, outAt: 6800 },
    textBox: {
      left: '925px',
      top: '597px',
      width: '408px',
      height: '168px',
      padding: '14px 20px 16px',
      enterDuration: 340,
      exitDuration: 300,
      messageDelay: 520,
      messageLines: 3,
    },
    tts: {
      template: '{pseudo} a donné {amount}. Message du don : {message}',
      templateNoMessage: '{pseudo} a donné {amount}.',
      lang: 'fr-FR',
    },
    priority: 40,
    fps: 15,
  },
  // Raid: kept (decision 16/10/2026). Media found by Antoni in `Documents\Twitch\Alertes\Raid` (A2): « Titan Avi 4.avi »
  // (raw BGRA, real alpha) converted to VP9 + alpha WebM, 19 916 ms, 1920×1080, 12 fps; its separate sound plays on
  // after the video (21.7 s). Text chosen by Antoni (17/10/2026); POSITION, TIMINGS and PRIORITY stay PROVISIONAL (no
  // legacy reference): to be calibrated. Variables: {pseudo}, {viewers}.
  raid_default: {
    id: 'raid_default',
    type: 'raid',
    video: 'Raid Titan.webm',
    audio: 'Raptoru_Alerte_Raid_Sound.mp3',
    keepAudio: true,
    volume: LEGACY_VOLUME,
    style: 'default',
    textStyle: 'pseudo-zone',
    text: '{pseudo} débarque avec {viewers} titans !',
    showAt: 1500,
    fadeOutAt: 7650,
    hideAt: 8000,
    zone: { x: 460, y: 60, w: 1000, h: 90 },
    priority: 30,
    mediaMs: 19916,
    fps: 12,
    provisional: true,
  },
};

/** Follow variants and their SAMMI weights (`20,20,20,20,1`: Discord is rare). */
export const FOLLOW_WEIGHTS: [string, number][] = [
  ['follow_dofus_ebene', 20],
  ['follow_dofus_eliatrope', 20],
  ['follow_dofus_emeraude', 20],
  ['follow_eren', 20],
  ['follow_discord', 1],
];

/** Community gift thresholds (legacy `jouerSubgift`: ≥ 20, ≥ 10, ≥ 5, else 1). */
export const GIFT_THRESHOLDS: [number, string][] = [
  [20, 'subgift_20'],
  [10, 'subgift_10'],
  [5, 'subgift_5'],
  [1, 'subgift_1'],
];

/** SAMMI bits trigger minimum. */
export const BITS_MINIMUM = 10;

// --- Halloween profile (30/10, docs/HALLOWEEN.md § 14) -----------------------------------------------------------
// Used only while the channel's Halloween alert profile is on (event shop rules `halloween_alerts`); the usual variants
// above are never changed. Media: `Stream PROJET\Halloween` converted by Studio's halloween-alerts-import (originals
// only read). Text positions and timings are PROVISIONAL (calibrated in Studio): the media carry no text reference.

/** Miss Minute (follow): her video with « Hello… » muxed in (her own track was silent). */
const HW_FOLLOW: AlertVariant = {
  id: 'hw_follow_miss_minute',
  type: 'follow',
  video: 'Halloween Follow Miss Minute.webm',
  audio: null,
  volume: LEGACY_VOLUME,
  style: 'default',
  textStyle: 'pseudo-classic',
  text: '{pseudo} vient de follow !',
  showAt: 300,
  hideAt: 2400,
  priority: 10,
  mediaMs: 2470,
  fps: 24,
  provisional: true,
};

/** The Ballon: 4 bursts (1 candies, 2 pumpkins, 3 candy corn, 4 spiders), all with « Le Ballon V2 ». */
const BALLON_TEXT = {
  sub: "{pseudo} vient de s'abonner !",
  prime: "{pseudo} s'abonne avec Prime !",
  resub: '{pseudo} se réabonne : {months} mois !',
} as const;
export type BallonKind = keyof typeof BALLON_TEXT;

export function ballonVariant(kind: BallonKind, n: number): AlertVariant {
  return {
    id: `hw_ballon_${kind}_${n}`,
    type: kind === 'resub' ? 'resub' : 'sub',
    video: `Halloween Ballon ${n}.webm`,
    audio: 'Halloween Ballon V2.mp3',
    volume: LEGACY_VOLUME,
    style: 'default',
    textStyle: 'pseudo-zone',
    text: BALLON_TEXT[kind],
    showAt: 400,
    fadeOutAt: 3000,
    hideAt: 3300,
    zone: { x: 460, y: 470, w: 1000, h: 140 },
    priority: 30,
    mediaMs: 3480,
    fps: 24,
    provisional: true,
  };
}

/** Jerry (gifts): the four animations named by their threshold (1, 5, 10, 20), music « My Ordinary Life » (slowed). */
const JERRY = {
  audio: 'Halloween Jerry Musique.mp3',
  volume: LEGACY_VOLUME,
  style: 'default',
  textStyle: 'pseudo-subgift',
  showAt: 2100,
  fadeOutAt: 6400,
  hideAt: 6750,
  zone: { x: 835, y: 244, w: 340, h: 78 },
  mediaMs: 7000,
  fps: 24,
  provisional: true,
} as const;

export const JERRY_THRESHOLDS: [number, AlertVariant][] = (
  [
    [20, 50],
    [10, 40],
    [5, 35],
    [1, 30],
  ] as const
).map(([min, priority]) => [
  min,
  {
    id: `hw_gift_${min}`,
    type: 'gift_community',
    video: `Halloween Jerry ${min}.webm`,
    text: '{pseudo} × {count}',
    priority,
    ...JERRY,
  },
]);

export const HW_GIFT_TARGETED: AlertVariant = {
  id: 'hw_gift_targeted',
  type: 'gift_targeted',
  video: 'Halloween Jerry 1.webm',
  text: '{recipient}',
  priority: 30,
  ...JERRY,
};

export { HW_FOLLOW };

/** Every Halloween variant (Studio: media check, preview, calibration). */
export const HALLOWEEN_VARIANTS: AlertVariant[] = [
  HW_FOLLOW,
  ...(['sub', 'prime', 'resub'] as const).flatMap((k) =>
    [1, 2, 3, 4].map((n) => ballonVariant(k, n)),
  ),
  ...JERRY_THRESHOLDS.map(([, v]) => v),
  HW_GIFT_TARGETED,
];
