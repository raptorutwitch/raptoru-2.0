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

/**
 * Who can use a command. « everyone » is exclusive; the others add up. No implicit exemption: the
 * streamer uses a command only through « broadcaster », « everyone » or `allow` (configuring is separate).
 */
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

/** A viewer allowed by their STABLE Twitch id (a rename keeps the right); `name` is only the label shown. */
export const CmdAllowedId = z.strictObject({
  id: z.string().regex(/^[0-9]{1,32}$/),
  name: z.string().trim().min(1).max(40),
});
export type CmdAllowedId = z.infer<typeof CmdAllowedId>;

export const CmdAudience = z
  .strictObject({
    groups: z.array(CmdGroup).max(7),
    /** People allowed on top of the groups (or alone when no group is on). */
    allow: z.array(CmdLogin).max(50),
    /** People allowed by their Twitch id (same role as `allow`, rename-proof). Absent before 15/11/2026: none. */
    allow_ids: z.array(CmdAllowedId).max(50).optional(),
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
  })
  .refine((a) => unique((a.allow_ids ?? []).map((x) => x.id)), {
    message: 'duplicate Twitch id',
    path: ['allow_ids'],
  });
export type CmdAudience = z.infer<typeof CmdAudience>;

/** One expression of a « message contenant » trigger: literal text (never a pattern), one line. */
export const CmdKeyword = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((k) => !/\p{Cc}/u.test(k), 'one line, no control character');
/** Two expressions are the same one whatever their case and spacing. */
export const keywordKey = (k: string) =>
  k.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * How a command is launched. « command » (default, and what a command saved before 15/11/2026 without `trigger` does):
 * « !name » or an alias. « keywords »: a chat message that contains one of the expressions, without « ! » — once per
 * message, whatever the number of expressions in it; `match` = word (the expression stands as whole words: « ao » in
 * « franchement ao », never in « chaos ») or anywhere (also inside a word). The keywords are kept when switched back.
 */
export const CmdTrigger = z
  .strictObject({
    mode: z.enum(['command', 'keywords']),
    keywords: z.array(CmdKeyword).max(20),
    match: z.enum(['word', 'anywhere']),
  })
  .refine((t) => t.mode !== 'keywords' || t.keywords.length > 0, {
    message: 'at least one expression',
    path: ['keywords'],
  })
  .refine((t) => unique(t.keywords.map(keywordKey)), {
    message: 'duplicate expression',
    path: ['keywords'],
  });
export type CmdTrigger = z.infer<typeof CmdTrigger>;

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The matcher of a « keywords » trigger: the first expression found in a message (as typed in the command, spaces
 * normalised), or null. Literal and case-insensitive — an expression is never a pattern. « word »: an expression's edge
 * that is a letter, a digit or « _ » must not touch another one (« ao » in « ao ! », not in « chaos » nor « aouh »).
 * Built once per configuration (Core caches it; Studio's preview uses the same one).
 */
export function keywordMatcher(t: Pick<CmdTrigger, 'keywords' | 'match'>) {
  const rules = t.keywords.map((k) => {
    const norm = k.trim().replace(/\s+/g, ' ');
    const chars = [...norm];
    let src = norm.split(' ').map(escapeRe).join('\\s+');
    if (t.match === 'word') {
      if (WORD_CHAR.test(chars[0] ?? '')) src = `(?<![\\p{L}\\p{N}_])${src}`;
      if (WORD_CHAR.test(chars.at(-1) ?? '')) src = `${src}(?![\\p{L}\\p{N}_])`;
    }
    return { k: norm, re: new RegExp(src, 'iu') };
  });
  return (text: string): string | null =>
    rules.find((r) => r.re.test(text))?.k ?? null;
}

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

/** A sound imported in Studio (its id there): Studio's invisible OBS sound source plays it. */
export const CmdSoundId = z.string().regex(/^[a-f0-9]{16}$/);

/**
 * Ordered actions after (or before) the reply. Versioned (`v`) and typed; new types are added as new
 * members of this union (wait, condition, OBS, wallet… later). Today: an extra chat message, a sound on stream, and
 * the protected action of a module (system commands only).
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
    /** A sound played on stream (Studio's invisible OBS sound source), once per accepted use. */
    type: z.literal('sound'),
    v: z.literal(1),
    ...ActionBase,
    sound: CmdSoundId,
    /** The sound's name in Studio, shown in the command (display only). */
    label: z.string().trim().min(1).max(60),
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
  /** Organisation: a category of the channel (cmd_categories), or null = « Sans catégorie ». */
  category: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,23}$/)
    .nullable(),
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
  /** How it is launched (absent = « !name », as before 15/11/2026). */
  trigger: CmdTrigger.optional(),
  /**
   * Viewers who may change, from the extension, only whether it is on and its expressions (CmdDelegateRequest) — by their
   * stable Twitch id. Independent from who may USE it; never a team right. Set by the streamer only. Absent = nobody.
   */
  editors: z
    .array(CmdAllowedId)
    .max(10)
    .refine((l) => unique(l.map((x) => x.id)), 'duplicate Twitch id')
    .optional(),
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
  'trigger',
  'editors',
]);
export type CmdField = z.infer<typeof CmdField>;

/** What a moderator / supermod may change from the extension, with its bounds (set in Studio). */
export const CmdTeamRights = z.strictObject({
  toggle: z.boolean(),
  reply: z.boolean(),
  /**
   * Rename a command (its name = canonical trigger; the aliases have their own right). Added after
   * phase E: rights saved before it read as true (the default), their other settings unchanged.
   */
  rename: z.boolean().default(true),
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

/**
 * A delegated editor's change from the extension (`config.editors`): ONLY these fields, nothing else is accepted (a
 * strict object: an extra field is refused). `keywords` replaces the expressions of a « keywords » command.
 */
export const CmdDelegateRequest = z.strictObject({
  actor: LabActor,
  expected_version: z.number().int().min(1),
  enabled: z.boolean().optional(),
  keywords: z.array(CmdKeyword).max(20).optional(),
});

/** The viewer a test / diagnostic is run for (as the chat would present them). */
export const CmdTestViewer = z.strictObject({
  id: z.string().regex(/^\d{1,32}$/),
  login: CmdLogin,
  display_name: z.string().min(1).max(64),
  role: z.enum(['broadcaster', 'moderator', 'viewer']),
  badges: z
    .array(z.string().regex(/^[a-z0-9_-]{1,32}$/))
    .max(20)
    .default([]),
  /** Follower answer to use (otherwise the follower provider decides). */
  follower: z.boolean().optional(),
});
export type CmdTestViewer = z.infer<typeof CmdTestViewer>;

/** « Tester la commande »: the same decision as a real message, nothing written, nothing sent. */
export const CmdTestRequest = z.strictObject({
  actor: LabActor,
  /** The command tested (its editor): a « keywords » command is tested on any message, against its expressions. */
  command_id: z.uuid().optional(),
  /** The full chat message, e.g. « !hug @PixelMamie ». */
  message: z.string().min(1).max(500),
  viewer: CmdTestViewer,
});

// --- phase C: durable steps executed by the Lab Twitch adapter ------------------------------------------

const ExecutorId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** The executor asks for the next step of the channel (one in flight per channel, FIFO). */
export const CmdStepClaimRequest = z.strictObject({ executor_id: ExecutorId });

/** Outcome of the current attempt; an ACK of another attempt never changes the step. */
export const CmdStepAckRequest = z.strictObject({
  executor_id: ExecutorId,
  attempt_id: z.uuid(),
  /** running = about to call Twitch (sent only after Core confirmed it). */
  event: z.enum(['running', 'succeeded', 'failed', 'unknown']),
  /** Send Chat Message `message_id` (proof of the send), when Twitch gave one. */
  twitch_message_id: z.string().min(1).max(128).optional(),
  error: z
    .strictObject({
      code: z.string().regex(/^[a-z0-9_]{1,64}$/),
      message: z.string().max(300),
      /** Certainly not sent: Core may queue it again (bounded attempts, backoff, before expiry). */
      retryable: z.boolean(),
      retry_after_ms: z.number().int().min(0).max(600_000).optional(),
    })
    .optional(),
});
export type CmdStepAckRequest = z.infer<typeof CmdStepAckRequest>;

/** « Sortie chat réelle » (streamer only). OFF by default. */
export const CmdOutputRequest = z.strictObject({
  actor: LabActor,
  enabled: z.boolean(),
});

// --- phase D: categories (the streamer's, stored in Core) ----------------------------------------------

export const CmdCategoryId = z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/);
const CategoryFields = {
  name: z.string().trim().min(1).max(24),
  icon: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
};
export const CmdCategoryCreateRequest = z.strictObject({
  actor: LabActor,
  ...CategoryFields,
});
export const CmdCategoryUpdateRequest = z.strictObject({
  actor: LabActor,
  name: CategoryFields.name.optional(),
  icon: CategoryFields.icon.optional(),
  color: CategoryFields.color.optional(),
});
export const CmdCategoryDeleteRequest = z.strictObject({ actor: LabActor });
/** The complete new order (every category id once). */
export const CmdCategoryOrderRequest = z.strictObject({
  actor: LabActor,
  order: z.array(CmdCategoryId).max(100),
});
