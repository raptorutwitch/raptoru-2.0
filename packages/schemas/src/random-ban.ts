import { z } from 'zod';

// Random Ban V2 (M1.1, 18/10/2026, docs/RANDOM_BAN_V2.md) — the SAMMI « Ban aléatoire » reward (ID56) and `!rb` (ID74,
// 25 000 Jetons: same logic, wired with the economy later). Rules decided by Antoni: a random target among the
// chatters Twitch lists (lurkers included) who follow the channel, are not banned / timed out, not the broadcaster,
// not a moderator (VIPs eligible, the buyer too: « CSC »); timeout by LeCroupier_ — 3 min for a subscriber, 5 min
// otherwise, the legacy reasons; never a permanent ban. The animation only once Twitch confirmed the timeout. No
// eligible chatter: « flop » (sound + text), nothing refunded. Animations copied from Alerte_system.html (videos,
// mirrors, phrases, timings) — the media are copies of the originals (effects/import-cli.ts).

export const RANDOM_BAN = {
  /** Seconds. SAMMI init variables of ID56 / ID74. */
  durationSubS: 180,
  durationNonSubS: 300,
  reasonSub: 'Pas de chance fdp',
  reasonNonSub: 'Pas de chance gros fdp',
  /** A request not picked up by the Twitch executor within this delay fails (bot absent): never banned late. */
  pickupMs: 120_000,
  /** The search (Twitch reads) must end within this lease; Twitch's answer to the timeout within the next one. */
  searchLeaseMs: 60_000,
  timeoutLeaseMs: 30_000,
  /** Searches that never reported (executor lost before any timeout): offered again, at most this many times. */
  maxAttempts: 3,
  /** An animation not played within this delay after the result is dropped (never shown late). */
  animationMaxAgeMs: 120_000,
  animationLeaseMs: 60_000,
} as const;

/** The phrase pools of the legacy page (`banPhrases`), copied as they are. */
export const RANDOM_BAN_PHRASES = {
  classic: [
    "{banned} s'est fait découper par {trigger}",
    '{trigger} a découpé {banned}',
    '{trigger} a tranché {banned} en deux',
    '{banned} a été découpé en rondelles par {trigger}',
  ],
  nuage: [
    '{trigger} a foudroyé {banned}',
    "{banned} s'est fait foudroyer par {trigger}",
    "La foudre de {trigger} s'abat sur {banned}",
    '{trigger} a invoqué la foudre sur {banned}',
  ],
  water: [
    '{trigger} a arrosé {banned}',
    "{banned} s'est fait arroser par {trigger}",
    '{trigger} a noyé {banned}',
    '{banned} se noie sous la vague de {trigger}',
  ],
  rm: [
    '{trigger} a dégommé {banned}',
    "{banned} s'est fait dégommer par {trigger}",
    '{trigger} a ouvert un portail et a fumé {banned}',
    "{banned} s'est pris un laser de {trigger}",
  ],
  csc: ['{trigger} est une grosse merde'],
} as const;

/**
 * The legacy `alertes` entries `ban_*` (Alerte_system.html): video, horizontal mirror, phrase pool, text shown at /
 * hidden at (ms), duration (the page's watchdog: the animation ends at the video's end, or `duration` + 800 ms).
 * SAMMI ID63 drew one of the nine non-CSC ids with a plain random pick (its weight list is never read): uniform.
 */
export const RANDOM_BAN_ANIMATIONS = [
  {
    id: 'ban_classic',
    media: 'rb-classic',
    mirror: false,
    pool: 'classic',
    showAt: 100,
    hideAt: 4000,
    duration: 3000,
  },
  {
    id: 'ban_rm',
    media: 'rb-rm',
    mirror: false,
    pool: 'rm',
    showAt: 500,
    hideAt: 3500,
    duration: 4000,
  },
  {
    id: 'ban_rm_mirror',
    media: 'rb-rm',
    mirror: true,
    pool: 'rm',
    showAt: 500,
    hideAt: 3500,
    duration: 4000,
  },
  {
    id: 'ban_nuage_complet',
    media: 'rb-nuage-complet',
    mirror: false,
    pool: 'nuage',
    showAt: 500,
    hideAt: 4500,
    duration: 5000,
  },
  {
    id: 'ban_nuage_complet_mirror',
    media: 'rb-nuage-complet',
    mirror: true,
    pool: 'nuage',
    showAt: 500,
    hideAt: 4500,
    duration: 5000,
  },
  {
    id: 'ban_waterbending',
    media: 'rb-waterbending',
    mirror: false,
    pool: 'water',
    showAt: 500,
    hideAt: 5500,
    duration: 6000,
  },
  {
    id: 'ban_waterbending_mirror',
    media: 'rb-waterbending',
    mirror: true,
    pool: 'water',
    showAt: 500,
    hideAt: 5500,
    duration: 6000,
  },
  {
    id: 'ban_nuage2',
    media: 'rb-nuage2',
    mirror: false,
    pool: 'nuage',
    showAt: 500,
    hideAt: 7500,
    duration: 8000,
  },
  {
    id: 'ban_nuage2_mirror',
    media: 'rb-nuage2',
    mirror: true,
    pool: 'nuage',
    showAt: 500,
    hideAt: 7500,
    duration: 8000,
  },
  // The buyer banned himself (legacy `alerteBanResolue`: trigger == banned).
  {
    id: 'ban_csc',
    media: 'rb-csc',
    mirror: false,
    pool: 'csc',
    showAt: 500,
    hideAt: 8500,
    duration: 10000,
  },
] as const;

export type RandomBanAnimationId =
  (typeof RANDOM_BAN_ANIMATIONS)[number]['id'] | 'flop';
export const RANDOM_BAN_DRAW = RANDOM_BAN_ANIMATIONS.filter(
  (a) => a.id !== 'ban_csc',
).map((a) => a.id);

/**
 * The flop (no eligible chatter): SAMMI played « Fail Trumpet » at 0.5 and showed « {trigger} a flop cheh ! » in the
 * OBS text source « randomban » (fade in 500 ms, 2 s, fade out 500 ms). That source is gone from the active OBS
 * collection (only the sound was still heard); its look comes from the last collection holding it
 * (24_Halloween.json.bak): GDI+ text, OBS defaults (Arial 256 px, white), scale 0.2769 × 0.2765 at (647, 316).
 */
export const RANDOM_BAN_FLOP = {
  media: 'rb-flop',
  volume: 0.5,
  text: '{trigger} a flop cheh !',
  fadeMs: 500,
  visibleMs: 2000,
  left: 647,
  top: 316,
  scaleX: 0.27688172459602356,
  scaleY: 0.2765151560306549,
} as const;

/** Legacy page: VOLUME_GLOBAL 0.5 × the entry's volume (none: 1); the ban videos play their own sound. */
export const RANDOM_BAN_VIDEO_VOLUME = 0.5;

/** Media copied into Studio's effects storage (originals untouched): `from` = the folder of the original. */
export const RANDOM_BAN_MEDIA = [
  {
    id: 'rb-classic',
    label: 'Random Ban — classique',
    file: 'RandomBan Classic.webm',
    from: 'alerts',
  },
  {
    id: 'rb-rm',
    label: 'Random Ban — Rick & Morty',
    file: 'Alerte R&M RB 1.webm',
    from: 'alerts',
  },
  {
    id: 'rb-nuage-complet',
    label: 'Random Ban — nuage complet',
    file: 'Nuage Complet Bruité.webm',
    from: 'alerts',
  },
  {
    id: 'rb-waterbending',
    label: 'Random Ban — waterbending',
    file: 'Waterbending bruité v_2.webm',
    from: 'alerts',
  },
  {
    id: 'rb-nuage2',
    label: 'Random Ban — nuage 2',
    file: 'Nuage 2 bruité v2.webm',
    from: 'alerts',
  },
  {
    id: 'rb-csc',
    label: 'Random Ban — CSC',
    file: 'CSC bruité Fix.webm',
    from: 'alerts',
  },
  {
    id: 'rb-flop',
    label: 'Random Ban — flop (trompette)',
    file: 'Fail Trumpet Sound Effect [TubeRipper.cc].ogg',
    from: 'downloads',
  },
] as const;

export const RbStatus = z.enum([
  'queued',
  'searching',
  'timeout_requested',
  'confirmed',
  'flop',
  'failed',
  'uncertain',
  'simulated',
]);
export type RbStatus = z.infer<typeof RbStatus>;

/** real: a real timeout · dry_run: the real search (Twitch reads), no timeout · animation: no Twitch call at all. */
export const RbMode = z.enum(['real', 'dry_run', 'animation']);
export type RbMode = z.infer<typeof RbMode>;

const TwitchId = z.string().regex(/^\d{1,32}$/);
const Login = z.string().min(1).max(64);
const ExecutorId = z.string().min(1).max(64);

export const RbTwitchUser = z.strictObject({
  id: TwitchId,
  login: Login,
  name: z.string().min(1).max(64),
});
export type RbTwitchUser = z.infer<typeof RbTwitchUser>;

/** The Twitch executor (bot) and what its tokens allow, reported with each claim. */
export const RbClaimRequest = z.strictObject({
  executor_id: ExecutorId,
  login: Login,
  /** Search possible (chatters, followers, moderators, bans, subscriptions). */
  can_search: z.boolean(),
  /** Timeout possible (LeCroupier_'s moderator:manage:banned_users). */
  can_timeout: z.boolean(),
  missing: z.array(z.string().max(64)).max(10),
});

/** The search found a target: Core records it and answers whether to time it out (and how long). */
export const RbTargetReport = z.strictObject({
  executor_id: ExecutorId,
  attempt_id: z.uuid(),
  target: RbTwitchUser,
  is_sub: z.boolean(),
  /** Chatters listed / eligible after the bulk filters, follower checks made (history). */
  stats: z.strictObject({
    chatters: z.number().int().min(0),
    candidates: z.number().int().min(0),
    follow_checks: z.number().int().min(0),
  }),
});

/**
 * The outcome: flop (nobody eligible) and failed (nothing sent: a Twitch read failed, a scope is missing) end a search;
 * confirmed / refused (certain: nothing applied) / uncertain (no proof either way) end a timeout.
 */
export const RbResultReport = z.strictObject({
  executor_id: ExecutorId,
  attempt_id: z.uuid(),
  event: z.enum(['flop', 'failed', 'confirmed', 'refused', 'uncertain']),
  error: z.string().max(300).optional(),
  /** confirmed after an ambiguous answer, from Twitch's list of bans. */
  verified: z.boolean().optional(),
  stats: z
    .strictObject({
      chatters: z.number().int().min(0),
      candidates: z.number().int().min(0),
      follow_checks: z.number().int().min(0),
    })
    .optional(),
});

/** Studio « Tester »: never a real timeout. */
export const RbTestRequest = z.strictObject({
  mode: z.enum(['dry_run', 'animation']),
  /** animation: the outcome to show. */
  outcome: z.enum(['ban', 'csc', 'flop']).optional(),
  trigger: z.string().trim().min(1).max(25).optional(),
  banned: z.string().trim().min(1).max(25).optional(),
});

export const RbAnimationClaim = z.strictObject({
  consumer_id: z.string().min(1).max(64),
});
export const RbAnimationReport = z.strictObject({
  consumer_id: z.string().min(1).max(64),
  event: z.enum(['completed', 'failed', 'unknown']),
  error: z.string().max(200).optional(),
});

export type RbClaimRequest = z.infer<typeof RbClaimRequest>;
export type RbTargetReport = z.infer<typeof RbTargetReport>;
export type RbResultReport = z.infer<typeof RbResultReport>;
export type RbTestRequest = z.infer<typeof RbTestRequest>;
export type RbAnimationReport = z.infer<typeof RbAnimationReport>;
