import {
  CmdConfig,
  type CmdField,
  type CmdTeamRights,
  type CmdTeamRole,
} from '@raptoru/schemas';

// Commands V2 — defaults, cross-field validation and field-level diff (pure functions).

export class CommandsError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** A new command: everyone, 30 s per viewer, a normal message, visible, enabled. */
export function defaultConfig(name: string): CmdConfig {
  return {
    name,
    aliases: [],
    description: '',
    category: null,
    appearance: { icon: 'chat', color: '#8b5cf6' },
    enabled: true,
    listed: true,
    audience: { groups: ['everyone'], allow: [], deny: [] },
    cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'viewer' },
    quota: { enabled: false, max: 4, window: 'hour', scope: 'global' },
    reply: { mode: 'normal', text: '', to: 'none' },
    args: [],
    actions: [],
    reply_first: false,
    when: 'always',
    refuse: { mode: 'silent', text: '' },
    team_lock: false,
  };
}

/** Rights without a stored row (decision of the validated V6.1 prototype). */
export const DEFAULT_TEAM_RIGHTS: Record<CmdTeamRole, CmdTeamRights> = {
  moderator: {
    toggle: true,
    reply: true,
    rename: true,
    aliases: false,
    audience: false,
    exclusions: false,
    cooldown: { allowed: true, min_seconds: 10 },
    quota: false,
    listed: false,
    volume: { allowed: true, min: 20, max: 90 },
    create: false,
    remove: false,
  },
  supermod: {
    toggle: true,
    reply: true,
    rename: true,
    aliases: true,
    audience: true,
    exclusions: true,
    cooldown: { allowed: true, min_seconds: 0 },
    quota: true,
    listed: true,
    volume: { allowed: true, min: 0, max: 100 },
    create: true,
    remove: true,
  },
};

/** Variables a message may contain; some need an argument of a given type. */
export const VARIABLES: Record<string, { needs?: 'mention' | 'number' }> = {
  user: {},
  display_name: {},
  target: { needs: 'mention' },
  args: {},
  amount: { needs: 'number' },
  count: {},
};

type Message = { mode: string; text: string; to: string; to_login?: string };

/** Cross-field rules the shape schema cannot express. Returns human-readable issues. */
export function configIssues(c: CmdConfig): string[] {
  const issues: string[] = [];
  const has = (t: 'mention' | 'number') => c.args.some((a) => a.type === t);
  if (new Set(c.aliases).size !== c.aliases.length)
    issues.push('duplicate alias');
  if (c.aliases.includes(c.name)) issues.push('an alias repeats the name');
  if (new Set(c.args.map((a) => a.name)).size !== c.args.length)
    issues.push('duplicate argument name');
  const text = c.args.findIndex((a) => a.type === 'text');
  if (text !== -1 && text !== c.args.length - 1)
    issues.push('a text argument must be the last one');
  const message = (m: Message, where: string) => {
    if (m.mode !== 'silent' && !m.text.trim())
      issues.push(`${where}: empty text`);
    if ((m.to === 'user') !== Boolean(m.to_login))
      issues.push(`${where}: to_login goes with to = user`);
    if (m.mode === 'reply' && m.to !== 'none')
      issues.push(`${where}: a Twitch reply already addresses the author`);
    if (m.to === 'target' && !has('mention'))
      issues.push(`${where}: addressed to the target, but no @pseudo argument`);
    for (const [, name] of m.text.matchAll(/\{([^{}]*)\}/g)) {
      const v = VARIABLES[name!];
      if (!v) issues.push(`${where}: unknown variable {${name}}`);
      else if (v.needs && !has(v.needs))
        issues.push(
          `${where}: {${name}} needs a ${v.needs === 'mention' ? '@pseudo' : 'number'} argument`,
        );
    }
  };
  message(c.reply, 'reply');
  c.actions.forEach((a, i) => {
    if (a.type === 'chat') message(a, `action ${i + 1}`);
  });
  if (new Set(c.actions.map((a) => a.id)).size !== c.actions.length)
    issues.push('duplicate action id');
  if (c.refuse.mode === 'custom' && !c.refuse.text.trim())
    issues.push('refuse: custom message is empty');
  return issues;
}

/** Parses and checks a whole configuration (422 with the issues). */
export function checkConfig(value: unknown): CmdConfig {
  const parsed = CmdConfig.safeParse(value);
  if (!parsed.success)
    throw new CommandsError(422, 'invalid_config', {
      issues: parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ),
    });
  const issues = configIssues(parsed.data);
  if (issues.length) throw new CommandsError(422, 'invalid_config', { issues });
  return parsed.data;
}

export interface FieldChange {
  field: CmdField;
  before: unknown;
  after: unknown;
}

/** JSON with sorted object keys: Postgres jsonb does not keep the key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(v);
}
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Field-level diff (`audience` split into groups / allow / deny), in a stable order. */
export function diffConfig(before: CmdConfig, after: CmdConfig): FieldChange[] {
  const out: FieldChange[] = [];
  for (const key of Object.keys(after) as (keyof CmdConfig)[]) {
    if (key === 'audience') {
      for (const sub of ['groups', 'allow', 'deny'] as const)
        if (!same(before.audience[sub], after.audience[sub]))
          out.push({
            field: `audience.${sub}`,
            before: before.audience[sub],
            after: after.audience[sub],
          });
    } else if (!same(before[key], after[key]))
      out.push({ field: key, before: before[key], after: after[key] });
  }
  return out;
}

/** The team right that allows changing a field (null = streamer only). */
export function rightOf(field: CmdField): keyof CmdTeamRights | null {
  switch (field) {
    case 'enabled':
      return 'toggle';
    case 'reply':
      return 'reply';
    case 'name':
      return 'rename';
    case 'aliases':
      return 'aliases';
    case 'audience.groups':
    case 'audience.allow':
      return 'audience';
    case 'audience.deny':
      return 'exclusions';
    case 'cooldown':
      return 'cooldown';
    case 'quota':
      return 'quota';
    case 'listed':
      return 'listed';
    default:
      return null;
  }
}

/**
 * Team rules for a moderator / supermod (the streamer bypasses them). `creating`: the name and the
 * description of a new simple command are part of the creation right.
 */
export function assertTeamMayChange(
  role: CmdTeamRole,
  rights: CmdTeamRights,
  changes: FieldChange[],
  after: CmdConfig,
  creating = false,
) {
  for (const ch of changes) {
    // Name, description and the (existing) category of a new simple command belong to the creation right.
    if (
      creating &&
      (ch.field === 'name' ||
        ch.field === 'description' ||
        ch.field === 'category')
    )
      continue;
    const right = rightOf(ch.field);
    const granted =
      right === null
        ? false
        : right === 'cooldown'
          ? rights.cooldown.allowed
          : Boolean(rights[right]);
    if (!granted)
      throw new CommandsError(403, 'field_not_delegated', {
        field: ch.field,
        role,
        right: right ?? 'streamer_only',
      });
    if (ch.field === 'cooldown' && rights.cooldown.min_seconds > 0) {
      const cd = after.cooldown;
      if (!cd.enabled || cd.seconds < rights.cooldown.min_seconds)
        throw new CommandsError(422, 'cooldown_below_minimum', {
          min_seconds: rights.cooldown.min_seconds,
          role,
        });
    }
  }
}
