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
  /** No rendering defined yet (raid): queued and observable, configured later. */
  pending?: boolean;
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
    // Anonymous gifter: « Un généreux anonyme » (legacy).
    text: '{pseudo} offre un abonnement à {recipient} !',
    priority: 30,
    ...GIFT,
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
    text: '{pseudo} a envoyé {amount} bits !',
    showAt: 800,
    fadeOutAt: 3800,
    hideAt: 4150,
    duration: 3850,
    zone: { x: 761, y: 156, w: 400, h: 80 },
    priority: 20,
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
  },
  // Raid: kept (decision 16/10/2026) but no custom media exists in the legacy (Streamlabs only): queued and observable,
  // its rendering is chosen later. No invented animation or sound.
  raid_default: {
    id: 'raid_default',
    type: 'raid',
    video: null,
    audio: null,
    volume: LEGACY_VOLUME,
    style: 'default',
    textStyle: 'pseudo-classic',
    priority: 30,
    pending: true,
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
