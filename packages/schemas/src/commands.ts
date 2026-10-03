import { z } from 'zod';
import { LabActor } from './lab-moderation.js';

// Commands V2 (Lab) — configuration model (phase A). Core is the only source of truth: it validates
// every invariant below, applies the team rights field by field and keeps the history. Shape-level
// rules live here (shared with Studio / extension later); cross-field rules (variables vs arguments,
// mention vs arguments…) are checked by Core (apps/core-api/src/commands/validate.ts).

/** A trigger word, without « ! », lower case. */
export const CmdWord = z
  .string()
  .regex(/^[a-z0-9_]{1,25}$/, 'a-z, 0-9 and _ only, 1 to 25 characters');
/** A Twitch login (pseudo), lower case. */
export const CmdLogin = z
  .string()
  .regex(/^[a-z0-9_]{1,25}$/, 'Twitch login (a-z, 0-9, _)');

/** Who can use a command. « everyone » is exclusive; the others add up. The streamer always can. */
export const CmdGroup = z.enum([
  'everyone',
  'followers',
  'subs',
  'vips',
  'mods',
  'supermods',
  'broadcaster',
]);
export type CmdGroup = z.infer<typeof CmdGroup>;

const unique = <T>(list: T[]) => new Set(list).size === list.length;

export const CmdAudience = z
  .strictObject({
    groups: z.array(CmdGroup).max(7),
    /** People allowed on top of the groups (or alone when no group is on). */
    allow: z.array(CmdLogin).max(50),
    /** People who can never use it — wins over the groups and over `allow`. */
    deny: z.array(CmdLogin).max(50),
  })
  .refine((a) => unique(a.groups), {
    message: 'duplicate group',
    path: ['groups'],
  })
  .refine((a) => !a.groups.includes('everyone') || a.groups.length === 1, {
    message: '« everyone » cannot be combined with another group',
    path: ['groups'],
  })
  .refine((a) => unique(a.allow) && unique(a.deny), {
    message: 'duplicate login',
  })
  .refine((a) => !a.allow.some((l) => a.deny.includes(l)), {
    message: 'a login cannot be both allowed and excluded',
    path: ['deny'],
  });
export type CmdAudience = z.infer<typeof CmdAudience>;

export const CmdScope = z.enum(['viewer', 'global']);

/** Cooldown: a minimum time between two uses. Kept (values) when switched off. */
export const CmdCooldown = z
  .strictObject({
    enabled: z.boolean(),
    seconds: z.number().int().min(1).max(86_400),
    /** Unit the streamer picked (display only); `seconds` is a whole number of it. */
    unit: z.enum(['s', 'min', 'h']),
    scope: CmdScope,
  })
  .refine((c) => c.seconds % { s: 1, min: 60, h: 3600 }[c.unit] === 0, {
    message: 'seconds must be a whole number of the unit',
    path: ['seconds'],
  });
export type CmdCooldown = z.infer<typeof CmdCooldown>;

/** Quota: a maximum number of uses over a window. Distinct from the cooldown; both can be on. */
export const CmdQuota = z.strictObject({
  enabled: z.boolean(),
  max: z.number().int().min(1).max(10_000),
  window: z.enum(['hour', 'live', 'day', 'total']),
  scope: CmdScope,
});
export type CmdQuota = z.infer<typeof CmdQuota>;

/** How the bot writes a message, and to whom (« @pseudo » at the start). */
export const CmdReplyMode = z.enum([
  'normal',
  'me',
  'announce',
  'reply',
  'silent',
]);
export const CmdAddressee = z.enum(['none', 'author', 'target', 'user']);

const messageShape = {
  mode: CmdReplyMode,
  text: z.string().max(500),
  to: CmdAddressee,
  /** Required when `to` = user. */
  to_login: CmdLogin.optional(),
};
const messageRules = <
  T extends { mode: string; text: string; to: string; to_login?: string },
>(
  s: z.ZodType<T>,
) =>
  s
    .refine((m) => m.mode === 'silent' || m.text.trim().length > 0, {
      message: 'the text is empty',
      path: ['text'],
    })
    .refine((m) => (m.to === 'user') === Boolean(m.to_login), {
      message: '`to_login` is required with to = user, and only then',
      path: ['to_login'],
    })
    .refine((m) => m.mode !== 'reply' || m.to === 'none', {
      message: 'a Twitch reply already addresses the author',
      path: ['to'],
    });

export const CmdReply = messageRules(z.strictObject(messageShape));
export type CmdReply = z.infer<typeof CmdReply>;

/** What the viewer writes after the command. A text argument takes the rest: it must be last. */
export const CmdArg = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
  type: z.enum(['mention', 'number', 'text']),
  required: z.boolean(),
});
export type CmdArg = z.infer<typeof CmdArg>;

/**
 * Ordered actions after (or before) the reply. Versioned (`v`) and typed; new types are added as new
 * members of this union in later phases (sound, wait, condition, OBS, wallet…). Phase A persists only
 * these two: an extra chat message, and the protected action of a module (system commands only).
 */
const ActionBase = {
  /** Stable id of the action (UI ordering, history). */
  id: z.uuid(),
  on_error: z.enum(['stop', 'continue']),
};
export const CmdAction = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('chat'),
    v: z.literal(1),
    ...ActionBase,
    ...messageShape,
  }),
  z.strictObject({
    type: z.literal('module'),
    v: z.literal(1),
    ...ActionBase,
    /** Owner module and its operation, e.g. raffle / join. Executed by the module, never edited. */
    module: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    operation: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  }),
]);
export type CmdAction = z.infer<typeof CmdAction>;

/** The editable configuration of a command (everything a mutation can change). */
export const CmdConfig = z.strictObject({
  name: CmdWord,
  aliases: z.array(CmdWord).max(10),
  description: z.string().trim().max(120),
  /** Organisation. */
  category: z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/),
  /** Appearance (the favourite is a Studio preference, not part of the command). */
  appearance: z.strictObject({
    icon: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    color: z.string().regex(/^#[0-9a-f]{6}$/),
  }),
  enabled: z.boolean(),
  /** Shown in the public list of the extension (with its aliases and description). */
  listed: z.boolean(),
  audience: CmdAudience,
  cooldown: CmdCooldown,
  quota: CmdQuota,
  reply: CmdReply,
  args: z.array(CmdArg).max(5),
  actions: z.array(CmdAction).max(10),
  /** The reply is sent before the actions (default: after). */
  reply_first: z.boolean(),
  /** When it can be used. */
  when: z.enum(['always', 'live', 'offline']),
  /** What the viewer sees when the command cannot be used. */
  refuse: z.strictObject({
    mode: z.enum(['silent', 'explain', 'custom']),
    text: z.string().max(300),
  }),
  /** Locked by the streamer: the team can read it, not change it. */
  team_lock: z.boolean(),
});
export type CmdConfig = z.infer<typeof CmdConfig>;

/**
 * Field keys used by the team rights, the locked fields and the history. `audience` is split: the
 * groups / allowed people and the exclusions are delegated separately.
 */
export const CmdField = z.enum([
  'name',
  'aliases',
  'description',
  'category',
  'appearance',
  'enabled',
  'listed',
  'audience.groups',
  'audience.allow',
  'audience.deny',
  'cooldown',
  'quota',
  'reply',
  'args',
  'actions',
  'reply_first',
  'when',
  'refuse',
  'team_lock',
]);
export type CmdField = z.infer<typeof CmdField>;

/** What a moderator / supermod may change from the extension, with its bounds (set in Studio). */
export const CmdTeamRights = z.strictObject({
  toggle: z.boolean(),
  reply: z.boolean(),
  aliases: z.boolean(),
  audience: z.boolean(),
  exclusions: z.boolean(),
  cooldown: z.strictObject({
    allowed: z.boolean(),
    /** The cooldown stays on and never goes below this (0 = no bound). */
    min_seconds: z.number().int().min(0).max(86_400),
  }),
  quota: z.boolean(),
  listed: z.boolean(),
  /** Exposed sound volume (sound actions come in a later phase), within these bounds. */
  volume: z
    .strictObject({
      allowed: z.boolean(),
      min: z.number().int().min(0).max(100),
      max: z.number().int().min(0).max(100),
    })
    .refine((v) => v.min <= v.max, { message: 'min > max', path: ['min'] }),
  create: z.boolean(),
  remove: z.boolean(),
});
export type CmdTeamRights = z.infer<typeof CmdTeamRights>;
export const CmdTeamRole = z.enum(['moderator', 'supermod']);
export type CmdTeamRole = z.infer<typeof CmdTeamRole>;

// --- requests -------------------------------------------------------------------------------------------

export const CmdCreateRequest = z.strictObject({
  actor: LabActor,
  /** Fields not given take their default. */
  config: CmdConfig.partial(),
});
export const CmdUpdateRequest = z.strictObject({
  actor: LabActor,
  expected_version: z.number().int().min(1),
  /** Only the top-level fields given are changed (`audience` is given whole). */
  changes: CmdConfig.partial(),
});
export const CmdVersionedRequest = z.strictObject({
  actor: LabActor,
  expected_version: z.number().int().min(1),
});
export const CmdRightsRequest = z.strictObject({
  actor: LabActor,
  role: CmdTeamRole,
  expected_version: z.number().int().min(0),
  rights: CmdTeamRights,
});
