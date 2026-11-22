import { z } from 'zod';

// Chatbox Raptoru (docs/CHATBOX.md § 5.3, § 7, § 8, § 9.2): the three profiles, their scenes, every visual setting of a
// profile (in pixels of the 1920 × 1080 canvas, rendered at scale 1 by a full-frame OBS source), the built-in presets
// « Origine » (the StreamElements widgets of today, converted to screen pixels: presentation § 2) and « Modernisée »
// (the initial preset), and the editor's field list. No decision here: visibility is visibility.ts.

export const PROFILES = ['just-chatting', 'react', 'dessin'] as const;
export type ProfileId = (typeof PROFILES)[number];

export const PROFILE_LABELS: Record<ProfileId, string> = {
  'just-chatting': 'Just Chatting',
  react: 'React',
  dessin: 'Dessin',
};

/** One OBS source per scene; the placement is the scene's, the look is the profile's. */
export const SCENES = [
  { id: 'just-chatting', label: 'Just Chatting', profile: 'just-chatting' },
  { id: 'waiting', label: 'Waiting screen', profile: 'just-chatting' },
  { id: 'ps5', label: 'Scène PS5', profile: 'react' },
  { id: 'fullscreen', label: 'Scène Fullscreen', profile: 'react' },
  { id: 'dessin', label: 'Scène Dessin', profile: 'dessin' },
] as const satisfies readonly {
  id: string;
  label: string;
  profile: ProfileId;
}[];
export type SceneId = (typeof SCENES)[number]['id'];
export const SCENE_IDS = SCENES.map((s) => s.id) as SceneId[];

export const BUNDLED_FONTS = ['Figtree', 'Barlow Condensed'] as const;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Px = (min: number, max: number) => z.number().min(min).max(max);
const Unit = z.number().min(0).max(1);
const Family = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[\p{L}\p{N} _-]+$/u);
const Weight = z.number().int().min(100).max(900);

export const ProfileSettings = z.strictObject({
  name: z.strictObject({ family: Family, weight: Weight, size: Px(8, 96) }),
  text: z.strictObject({
    family: Family,
    weight: Weight,
    size: Px(8, 96),
    lineHeight: z.number().min(0.9).max(2.2),
    color: Hex,
  }),
  badge: z.strictObject({ size: Px(8, 64) }),
  emote: z.strictObject({
    /** An emote inside text. */
    size: Px(8, 160),
    /**
     * A message made of emotes only: the size for 1, 2, 3… emotes (the last value repeats). A zero-width stack counts
     * as one emote. One mechanism for the three historical rules (progressive, fixed, − 2.5 px per emote).
     */
    solo: z.array(Px(8, 240)).min(1).max(10),
  }),
  gif: z.strictObject({ maxWidth: Px(40, 800), maxHeight: Px(40, 600) }),
  card: z.strictObject({
    style: z.enum(['solid', 'gradient', 'none']),
    color: Hex,
    /** The background's opacity only: the text and the emotes are never made transparent by it. */
    opacity: Unit,
    border: Hex,
    borderOpacity: Unit,
    borderWidth: Px(0, 6),
    radius: Px(0, 48),
    padX: Px(0, 60),
    padY: Px(0, 40),
    gap: Px(0, 40),
    /** Margin between the box's edges and the messages. */
    edge: Px(0, 80),
    width: z.enum(['full', 'fit']),
    /** Drop shadow of the card (0: none). */
    shadow: Unit,
  }),
  /** Legibility of the text on any background (0: none). */
  textShadow: Unit,
  roles: z.strictObject({
    /** Width of the coloured bar on the left (0: no bar). */
    bar: Px(0, 12),
    broadcaster: Hex,
    moderator: Hex,
    vip: Hex,
  }),
  latest: z.strictObject({
    /** The newest message stands out: the others' background is dimmed to `others`. */
    enabled: z.boolean(),
    others: Unit,
    /** Historical React widget only: the older messages' TEXT was dimmed too (kept for « Origine »). */
    dimText: z.boolean(),
  }),
  enter: z.strictObject({
    style: z.enum(['slide', 'unfold', 'fade']),
    duration: z.number().int().min(0).max(3000),
    distance: Px(0, 120),
  }),
  presence: z.strictObject({
    mode: z.enum(['permanent', 'idle']),
    /** Idle: the whole chat fades out this long after the last message. */
    seconds: z.number().min(1).max(600),
    fade: z.number().int().min(0).max(3000),
    /** Height of the countdown bar (0: none). */
    progress: Px(0, 10),
  }),
  topFade: z.strictObject({
    mode: z.enum(['always', 'overflow', 'none']),
    size: Px(0, 400),
  }),
  maxMessages: z.number().int().min(3).max(150),
  /** Historical « Dessin » only (an OBS colour filter at 91 %): the whole chatbox. 1 everywhere else. */
  opacity: z.number().min(0.2).max(1),
  /** Very dark Twitch colours lifted just enough to be read (the hue stays the viewer's). */
  nameContrast: z.boolean(),
  /** Accent of a highlighted message (an announcement brings its own colour). */
  accent: Hex,
});
export type ProfileSettings = z.infer<typeof ProfileSettings>;

/** Where a scene's box sits on the 1920 × 1080 canvas; `zoom` keeps a second scene's historical proportions. */
export const Placement = z.strictObject({
  x: z.number().int().min(-1920).max(1920),
  y: z.number().int().min(-1080).max(1080),
  w: z.number().int().min(120).max(1920),
  h: z.number().int().min(120).max(1080),
  zoom: z.number().min(0.5).max(2),
});
export type Placement = z.infer<typeof Placement>;

const RED = '#ff5050';
const GREEN = '#00e79f';
const PINK = '#e587ff';
const round = (n: number) => Math.round(n * 10) / 10;
const ratio = (a: number, b: number) => Math.round((a / b) * 1000) / 1000;
/** Code pixels of a widget × its OBS scale = screen pixels (presentation § 2). */
const at = (scale: number) => (px: number) => round(px * scale);

// « Origine »: the three widgets as they look on stream today (code values × the OBS scale of their main scene).
const jc = at(0.77);
const re = at(0.607);
const de = at(1.058);

const ORIGINE: Record<ProfileId, ProfileSettings> = {
  'just-chatting': {
    name: { family: 'Figtree', weight: 800, size: jc(26) },
    text: {
      family: 'Figtree',
      weight: 500,
      size: jc(34),
      lineHeight: 1.17,
      color: '#ffffff',
    },
    badge: { size: jc(25) },
    emote: { size: jc(44), solo: [120, 104, 92, 82, 74, 68].map(jc) },
    gif: { maxWidth: jc(260), maxHeight: jc(180) },
    card: {
      style: 'solid',
      color: '#0f0f12',
      opacity: 0.85,
      border: '#ffffff',
      borderOpacity: 0.085,
      borderWidth: 1,
      radius: jc(14),
      padX: jc(20),
      padY: jc(15),
      gap: jc(12),
      edge: jc(24),
      width: 'full',
      shadow: 0.2,
    },
    textShadow: 0.15,
    roles: { bar: 0, broadcaster: RED, moderator: GREEN, vip: PINK },
    latest: { enabled: false, others: 1, dimText: false },
    enter: { style: 'slide', duration: 620, distance: jc(34) },
    presence: { mode: 'permanent', seconds: 10, fade: 800, progress: 0 },
    topFade: { mode: 'always', size: 48 },
    maxMessages: 50,
    opacity: 1,
    nameContrast: false,
    accent: '#f2c14e',
  },
  react: {
    name: { family: 'Barlow Condensed', weight: 800, size: re(32) },
    text: {
      family: 'Figtree',
      weight: 500,
      size: re(34),
      lineHeight: 1.35,
      color: '#ececec',
    },
    badge: { size: re(32) },
    emote: { size: re(60), solo: [re(60)] },
    gif: { maxWidth: re(360), maxHeight: re(250) },
    card: {
      style: 'solid',
      color: '#0a0a0e',
      opacity: 0.18,
      border: '#ffffff',
      borderOpacity: 0.08,
      borderWidth: 1.2,
      radius: re(16),
      padX: re(18),
      padY: re(11),
      gap: re(10),
      edge: re(36),
      width: 'full',
      shadow: 0,
    },
    textShadow: 0,
    roles: { bar: re(6), broadcaster: RED, moderator: GREEN, vip: PINK },
    latest: { enabled: true, others: 0.88, dimText: true },
    enter: { style: 'unfold', duration: 1300, distance: re(40) },
    presence: { mode: 'idle', seconds: 10, fade: 800, progress: re(4) },
    topFade: { mode: 'overflow', size: re(200) },
    maxMessages: 50,
    opacity: 1,
    nameContrast: false,
    accent: '#f2c14e',
  },
  dessin: {
    name: { family: 'Barlow Condensed', weight: 800, size: de(22) },
    text: {
      family: 'Figtree',
      weight: 600,
      size: de(23),
      lineHeight: 1.5,
      color: '#ffffff',
    },
    badge: { size: de(22) },
    emote: {
      size: de(46),
      solo: [58, 55.5, 53, 50.5, 48].map(de),
    },
    gif: { maxWidth: de(180), maxHeight: de(125) },
    card: {
      style: 'solid',
      color: '#000000',
      opacity: 0.65,
      border: '#ffffff',
      borderOpacity: 0.06,
      borderWidth: 1,
      radius: de(10),
      padX: de(11),
      padY: de(7.5),
      gap: de(6),
      edge: de(18),
      width: 'full',
      shadow: 0,
    },
    textShadow: 0,
    roles: { bar: de(4), broadcaster: RED, moderator: GREEN, vip: PINK },
    latest: { enabled: false, others: 1, dimText: false },
    enter: { style: 'unfold', duration: 1300, distance: de(20) },
    presence: { mode: 'idle', seconds: 15, fade: 800, progress: de(2) },
    topFade: { mode: 'overflow', size: de(50) },
    maxMessages: 65,
    opacity: 0.908,
    nameContrast: false,
    accent: '#f2c14e',
  },
};

// « Modernisée » (docs/CHATBOX.md § 8): the text carries its own legibility, the background only supports it; no
// grey veil, no fake blur; same identities (comfortable / light and temporary / compact and discreet).
const MODERNISEE: Record<ProfileId, ProfileSettings> = {
  'just-chatting': {
    name: { family: 'Figtree', weight: 800, size: 21 },
    text: {
      family: 'Figtree',
      weight: 500,
      size: 25,
      lineHeight: 1.32,
      color: '#f4f5f7',
    },
    badge: { size: 19 },
    emote: { size: 34, solo: [88, 76, 68, 60, 54, 50] },
    gif: { maxWidth: 220, maxHeight: 150 },
    card: {
      style: 'solid',
      color: '#0c0d11',
      opacity: 0.82,
      border: '#ffffff',
      borderOpacity: 0.06,
      borderWidth: 1,
      radius: 14,
      padX: 16,
      padY: 11,
      gap: 8,
      edge: 14,
      width: 'full',
      shadow: 0.35,
    },
    textShadow: 0.45,
    roles: { bar: 3, broadcaster: RED, moderator: GREEN, vip: PINK },
    latest: { enabled: false, others: 1, dimText: false },
    enter: { style: 'slide', duration: 420, distance: 18 },
    presence: { mode: 'permanent', seconds: 10, fade: 600, progress: 0 },
    topFade: { mode: 'always', size: 56 },
    maxMessages: 50,
    opacity: 1,
    nameContrast: true,
    accent: '#f2c14e',
  },
  react: {
    name: { family: 'Barlow Condensed', weight: 800, size: 23 },
    text: {
      family: 'Figtree',
      weight: 600,
      size: 23,
      lineHeight: 1.3,
      color: '#ffffff',
    },
    badge: { size: 19 },
    emote: { size: 36, solo: [44] },
    gif: { maxWidth: 230, maxHeight: 160 },
    card: {
      style: 'gradient',
      color: '#07080b',
      opacity: 0.74,
      border: '#ffffff',
      borderOpacity: 0,
      borderWidth: 0,
      radius: 12,
      padX: 14,
      padY: 8,
      gap: 6,
      edge: 16,
      width: 'fit',
      shadow: 0,
    },
    textShadow: 1,
    roles: { bar: 3, broadcaster: RED, moderator: GREEN, vip: PINK },
    latest: { enabled: true, others: 0.72, dimText: false },
    enter: { style: 'unfold', duration: 560, distance: 16 },
    presence: { mode: 'idle', seconds: 10, fade: 700, progress: 2 },
    topFade: { mode: 'overflow', size: 110 },
    maxMessages: 50,
    opacity: 1,
    nameContrast: true,
    accent: '#f2c14e',
  },
  dessin: {
    name: { family: 'Barlow Condensed', weight: 800, size: 20 },
    text: {
      family: 'Figtree',
      weight: 600,
      size: 21,
      lineHeight: 1.34,
      color: '#ffffff',
    },
    badge: { size: 18 },
    emote: { size: 38, solo: [52, 49.5, 47, 44.5, 42] },
    gif: { maxWidth: 180, maxHeight: 125 },
    card: {
      style: 'solid',
      color: '#08090c',
      opacity: 0.7,
      border: '#ffffff',
      borderOpacity: 0.05,
      borderWidth: 1,
      radius: 9,
      padX: 11,
      padY: 6,
      gap: 5,
      edge: 12,
      width: 'full',
      shadow: 0,
    },
    textShadow: 0.6,
    roles: { bar: 3, broadcaster: RED, moderator: GREEN, vip: PINK },
    latest: { enabled: false, others: 1, dimText: false },
    enter: { style: 'unfold', duration: 480, distance: 14 },
    presence: { mode: 'idle', seconds: 15, fade: 700, progress: 2 },
    topFade: { mode: 'overflow', size: 40 },
    maxMessages: 65,
    opacity: 1,
    nameContrast: true,
    accent: '#f2c14e',
  },
};

export const BUILTIN_PRESETS = [
  {
    id: 'modernisee',
    name: 'Modernisée',
    desc: 'Préset initial : identité gardée, lisibilité et animations modernisées.',
    settings: MODERNISEE,
  },
  {
    id: 'origine',
    name: 'Origine',
    desc: 'Le rendu des chatbox StreamElements d’aujourd’hui, en pixels d’écran.',
    settings: ORIGINE,
  },
] as const;
export type BuiltinPresetId = (typeof BUILTIN_PRESETS)[number]['id'];
export const INITIAL_PRESET: BuiltinPresetId = 'modernisee';

export const builtinSettings = (
  preset: BuiltinPresetId,
  profile: ProfileId,
): ProfileSettings =>
  structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === preset)!.settings[profile],
  );

/**
 * Start placements: the zones the StreamElements sources show today (presentation § 2), so the new sources land where
 * the old ones are. The second scene of a profile keeps its historical proportions with `zoom` (its OBS scale ÷ the
 * profile's main scene scale).
 */
export const DEFAULT_PLACEMENTS: Record<SceneId, Placement> = {
  'just-chatting': { x: 1264, y: 61, w: 577, h: 962, zoom: 1 },
  waiting: { x: 0, y: 0, w: 639, h: 1065, zoom: ratio(0.852, 0.77) },
  ps5: { x: 0, y: 346, w: 455, h: 492, zoom: 1 },
  fullscreen: { x: 9, y: 374, w: 484, h: 522, zoom: ratio(0.645, 0.607) },
  dessin: { x: 0, y: 315, w: 438, h: 688, zoom: 1 },
};

/** The editor's fields (Studio builds its controls from them: one list, no second copy of the settings). */
export type Field =
  | {
      path: string;
      label: string;
      kind: 'number';
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | { path: string; label: string; kind: 'color' | 'font' | 'toggle' }
  | {
      path: string;
      label: string;
      kind: 'choice';
      options: { value: string; label: string }[];
    }
  | { path: string; label: string; kind: 'list'; min: number; max: number };

export const FIELD_GROUPS: { id: string; label: string; fields: Field[] }[] = [
  {
    id: 'type',
    label: 'Typographie',
    fields: [
      { path: 'name.family', label: 'Police du pseudo', kind: 'font' },
      {
        path: 'name.size',
        label: 'Taille du pseudo',
        kind: 'number',
        min: 8,
        max: 96,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'name.weight',
        label: 'Graisse du pseudo',
        kind: 'number',
        min: 100,
        max: 900,
        step: 100,
      },
      { path: 'text.family', label: 'Police du message', kind: 'font' },
      {
        path: 'text.size',
        label: 'Taille du message',
        kind: 'number',
        min: 8,
        max: 96,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'text.weight',
        label: 'Graisse du message',
        kind: 'number',
        min: 100,
        max: 900,
        step: 100,
      },
      {
        path: 'text.lineHeight',
        label: 'Interligne',
        kind: 'number',
        min: 0.9,
        max: 2.2,
        step: 0.01,
      },
      { path: 'text.color', label: 'Couleur du message', kind: 'color' },
      {
        path: 'textShadow',
        label: 'Lisibilité sur fond clair',
        kind: 'number',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        path: 'nameContrast',
        label: 'Éclaircir les pseudos très sombres',
        kind: 'toggle',
      },
    ],
  },
  {
    id: 'card',
    label: 'Fond et cartes',
    fields: [
      {
        path: 'card.style',
        label: 'Style du fond',
        kind: 'choice',
        options: [
          { value: 'solid', label: 'Carte' },
          { value: 'gradient', label: 'Dégradé léger' },
          { value: 'none', label: 'Aucun' },
        ],
      },
      { path: 'card.color', label: 'Couleur du fond', kind: 'color' },
      {
        path: 'card.opacity',
        label: 'Opacité du fond (jamais le texte)',
        kind: 'number',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        path: 'card.width',
        label: 'Largeur des cartes',
        kind: 'choice',
        options: [
          { value: 'full', label: 'Pleine' },
          { value: 'fit', label: 'Ajustée au message' },
        ],
      },
      {
        path: 'card.radius',
        label: 'Arrondi',
        kind: 'number',
        min: 0,
        max: 48,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'card.borderWidth',
        label: 'Bord',
        kind: 'number',
        min: 0,
        max: 6,
        step: 0.1,
        unit: 'px',
      },
      { path: 'card.border', label: 'Couleur du bord', kind: 'color' },
      {
        path: 'card.borderOpacity',
        label: 'Opacité du bord',
        kind: 'number',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        path: 'card.shadow',
        label: 'Ombre de la carte',
        kind: 'number',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        path: 'card.padX',
        label: 'Marge intérieure (côtés)',
        kind: 'number',
        min: 0,
        max: 60,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'card.padY',
        label: 'Marge intérieure (haut, bas)',
        kind: 'number',
        min: 0,
        max: 40,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'card.gap',
        label: 'Écart entre messages',
        kind: 'number',
        min: 0,
        max: 40,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'card.edge',
        label: 'Marge autour du chat',
        kind: 'number',
        min: 0,
        max: 80,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'opacity',
        label: 'Opacité de toute la chatbox',
        kind: 'number',
        min: 0.2,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    id: 'emotes',
    label: 'Badges et emotes',
    fields: [
      {
        path: 'badge.size',
        label: 'Taille des badges',
        kind: 'number',
        min: 8,
        max: 64,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'emote.size',
        label: 'Emote dans le texte',
        kind: 'number',
        min: 8,
        max: 160,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'emote.solo',
        label: 'Emotes seules (1, 2, 3… emotes)',
        kind: 'list',
        min: 8,
        max: 240,
      },
      {
        path: 'gif.maxWidth',
        label: 'GIF : largeur maximum',
        kind: 'number',
        min: 40,
        max: 800,
        step: 1,
        unit: 'px',
      },
      {
        path: 'gif.maxHeight',
        label: 'GIF : hauteur maximum',
        kind: 'number',
        min: 40,
        max: 600,
        step: 1,
        unit: 'px',
      },
    ],
  },
  {
    id: 'roles',
    label: 'Rôles',
    fields: [
      {
        path: 'roles.bar',
        label: 'Barre de rôle (0 : aucune)',
        kind: 'number',
        min: 0,
        max: 12,
        step: 0.5,
        unit: 'px',
      },
      { path: 'roles.broadcaster', label: 'Streamer', kind: 'color' },
      { path: 'roles.moderator', label: 'Modération', kind: 'color' },
      { path: 'roles.vip', label: 'VIP', kind: 'color' },
      {
        path: 'accent',
        label: 'Accent des messages mis en avant',
        kind: 'color',
      },
    ],
  },
  {
    id: 'motion',
    label: 'Animations et présence',
    fields: [
      {
        path: 'enter.style',
        label: 'Apparition',
        kind: 'choice',
        options: [
          { value: 'slide', label: 'Glissement' },
          { value: 'unfold', label: 'Dépliage' },
          { value: 'fade', label: 'Fondu' },
        ],
      },
      {
        path: 'enter.duration',
        label: 'Durée de l’apparition',
        kind: 'number',
        min: 0,
        max: 3000,
        step: 10,
        unit: 'ms',
      },
      {
        path: 'enter.distance',
        label: 'Distance de l’apparition',
        kind: 'number',
        min: 0,
        max: 120,
        step: 1,
        unit: 'px',
      },
      {
        path: 'presence.mode',
        label: 'Présence',
        kind: 'choice',
        options: [
          { value: 'permanent', label: 'Permanente' },
          { value: 'idle', label: 'Disparaît après un temps calme' },
        ],
      },
      {
        path: 'presence.seconds',
        label: 'Disparaît après',
        kind: 'number',
        min: 1,
        max: 600,
        step: 1,
        unit: 's',
      },
      {
        path: 'presence.fade',
        label: 'Durée du fondu',
        kind: 'number',
        min: 0,
        max: 3000,
        step: 10,
        unit: 'ms',
      },
      {
        path: 'presence.progress',
        label: 'Barre de décompte (0 : aucune)',
        kind: 'number',
        min: 0,
        max: 10,
        step: 0.5,
        unit: 'px',
      },
      {
        path: 'latest.enabled',
        label: 'Dernier message en avant',
        kind: 'toggle',
      },
      {
        path: 'latest.others',
        label: 'Fond des messages précédents',
        kind: 'number',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        path: 'topFade.mode',
        label: 'Fondu du haut',
        kind: 'choice',
        options: [
          { value: 'always', label: 'Toujours' },
          { value: 'overflow', label: 'Quand le chat est plein' },
          { value: 'none', label: 'Aucun' },
        ],
      },
      {
        path: 'topFade.size',
        label: 'Hauteur du fondu',
        kind: 'number',
        min: 0,
        max: 400,
        step: 1,
        unit: 'px',
      },
      {
        path: 'maxMessages',
        label: 'Messages gardés au maximum',
        kind: 'number',
        min: 3,
        max: 150,
        step: 1,
      },
    ],
  },
];
