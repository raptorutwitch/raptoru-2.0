import type { CmdArg, CmdConfig, CmdGroup } from '@raptoru/schemas';
import { checkConfig, CommandsError, VARIABLES } from './model.js';

// Commands V2 — the single decision (phase B). Pure: everything it needs (command, viewer, live
// state, usage counters) is loaded by the caller. The real admission, « Tester la commande » and the
// diagnostic all call this function, so they can never disagree.
//
// Stable order of the checks: reserved word → command found → enabled → valid configuration →
// availability (live / offline) → audience (denied person, then allowed person, then groups) →
// arguments → variables → cooldown → quota. The first failing check is the reason.
// Audience priority (phase A invariant « the streamer can always »): streamer > deny > allow > groups.

export type Reason =
  | 'reserved'
  | 'not_found'
  | 'disabled'
  | 'invalid_config'
  | 'unavailable'
  | 'denied_user'
  | 'access_denied'
  | 'invalid_arguments'
  | 'cooldown'
  | 'quota'
  | 'duplicate_message';

export type ViewerRole = 'broadcaster' | 'supermod' | 'moderator' | 'viewer';

export interface DecideViewer {
  id: string;
  login: string;
  display_name: string;
  role: ViewerRole;
  /** Groups the viewer belongs to right now (everyone included). */
  groups: CmdGroup[];
  /** null = unknown (no follower answer available). */
  follower: boolean | null;
}

export interface DecideUsage {
  /** Last accepted use of this command by this viewer / by anyone (aliases included). */
  lastViewerAt: Date | null;
  lastGlobalAt: Date | null;
  /** Accepted uses inside the quota window (by this viewer / by anyone). */
  windowViewer: number;
  windowGlobal: number;
  /** Accepted uses since the command exists (for {count}). */
  total: number;
}

export interface DecideInput {
  command: { command_id: string; version: number; config: unknown } | null;
  /** Module owning the word, if any (Tombola…): never handled by Commands V2. */
  reservedBy: string | null;
  trigger: string;
  /** Everything after the trigger word. */
  rawArgs: string;
  viewer: DecideViewer;
  live: boolean;
  now: Date;
  usage: DecideUsage;
  /** Message id to reply to (Twitch reply mode). */
  messageId: string | null;
}

export interface RenderedMessage {
  mode: 'normal' | 'me' | 'announce' | 'reply';
  text: string;
  /** Twitch reply: the message the bot answers to. */
  reply_to: string | null;
}
export interface Rendered {
  reply: RenderedMessage | null;
  actions: (
    | ({ id: string; type: 'chat' } & RenderedMessage)
    | { id: string; type: 'module'; module: string; operation: string }
  )[];
  reply_first: boolean;
}

export interface Check {
  check: string;
  ok: boolean;
}

export interface Decision {
  decision: 'accepted' | 'rejected';
  reason: Reason | null;
  /** Human explanation (French, shown as is in Studio / extension). */
  message: string;
  detail: Record<string, unknown>;
  /** Checks run, in order, until the first failure. */
  checks: Check[];
  raw_args: string;
  args: Record<string, string | number>;
  rendered: Rendered | null;
}

/** Twitch rejects messages over 500 characters. */
export const MAX_MESSAGE = 500;

const fmt = (s: number) =>
  s >= 3600 && s % 3600 === 0
    ? `${s / 3600} h`
    : s >= 60
      ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`
      : `${s} s`;
const WINDOW: Record<string, string> = {
  hour: 'sur la dernière heure',
  live: 'pendant ce live',
  day: 'aujourd’hui',
  total: 'au total',
};

/** Parses the arguments in order. A text argument takes the rest of the message. */
export function parseArgs(
  specs: CmdArg[],
  raw: string,
):
  { values: Record<string, string | number> } | { error: string; arg: string } {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const values: Record<string, string | number> = {};
  let i = 0;
  for (const a of specs) {
    if (a.type === 'text') {
      const rest = tokens.slice(i).join(' ');
      i = tokens.length;
      if (rest) values[a.name] = rest;
      else if (a.required) return { error: 'missing', arg: a.name };
      continue;
    }
    const t = tokens[i];
    if (t === undefined) {
      if (a.required) return { error: 'missing', arg: a.name };
      continue;
    }
    if (a.type === 'mention') {
      const m = /^@([A-Za-z0-9_]{1,25})$/.exec(t);
      if (!m) return { error: 'not_a_mention', arg: a.name };
      values[a.name] = m[1]!;
    } else {
      if (!/^\d{1,9}$/.test(t)) return { error: 'not_a_number', arg: a.name };
      values[a.name] = Number(t);
    }
    i++;
  }
  return { values };
}

/** One line, no control characters, never a Twitch chat command, at most 500 characters. */
export function sanitize(text: string): string {
  let out = text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  while (out.startsWith('/') || out.startsWith('.'))
    out = out.slice(1).trimStart();
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE - 1)}…` : out;
}

/** Variables of a message, from the frozen context. Throws `missing` when a value is absent. */
function render(
  text: string,
  vars: Record<string, string | undefined>,
): { text: string } | { missing: string } {
  let missing: string | null = null;
  const out = text.replace(/\{([^{}]*)\}/g, (all, name: string) => {
    if (!(name in VARIABLES)) return all; // impossible: the configuration was validated
    const v = vars[name];
    if (v === undefined) {
      missing ??= name;
      return '';
    }
    return v.replace(/\p{Cc}+/gu, ' ');
  });
  return missing ? { missing } : { text: out };
}

export function decide(input: DecideInput): Decision {
  const checks: Check[] = [];
  const base = { raw_args: input.rawArgs.trim(), args: {}, rendered: null };
  const reject = (
    reason: Reason,
    message: string,
    detail: Record<string, unknown> = {},
  ): Decision => {
    checks.push({ check: reason, ok: false });
    return { decision: 'rejected', reason, message, detail, checks, ...base };
  };
  const pass = (check: string) => checks.push({ check, ok: true });

  if (input.reservedBy)
    return reject(
      'reserved',
      `!${input.trigger} appartient au module ${input.reservedBy}.`,
      {
        module: input.reservedBy,
      },
    );
  if (!input.command)
    return reject('not_found', `Aucune commande !${input.trigger}.`);
  pass('found');

  let cfg: CmdConfig;
  try {
    cfg = checkConfig(input.command.config);
  } catch (e) {
    return reject('invalid_config', 'Sa configuration est à corriger.', {
      issues: e instanceof CommandsError ? e.details.issues : [String(e)],
    });
  }
  if (!cfg.enabled) return reject('disabled', 'La commande est désactivée.');
  pass('enabled');
  pass('config');

  if (cfg.when === 'live' && !input.live)
    return reject('unavailable', 'Utilisable seulement pendant le live.', {
      when: 'live',
    });
  if (cfg.when === 'offline' && input.live)
    return reject('unavailable', 'Utilisable seulement hors live.', {
      when: 'offline',
    });
  pass('available');

  const v = input.viewer;
  const login = v.login.toLowerCase();
  if (v.role !== 'broadcaster') {
    if (cfg.audience.deny.includes(login))
      return reject(
        'denied_user',
        `${v.display_name} est exclu de cette commande.`,
        { login },
      );
    if (!cfg.audience.allow.includes(login)) {
      const hit = cfg.audience.groups.find((g) => v.groups.includes(g));
      if (!hit) {
        const followerUnknown =
          cfg.audience.groups.includes('followers') && v.follower === null;
        return reject(
          'access_denied',
          `${v.display_name} n’a pas accès à cette commande.`,
          {
            groups: cfg.audience.groups,
            viewer_groups: v.groups,
            ...(followerUnknown ? { follower_unknown: true } : {}),
          },
        );
      }
    }
  }
  pass('audience');

  const parsed = parseArgs(cfg.args, input.rawArgs);
  if ('error' in parsed)
    return reject(
      'invalid_arguments',
      parsed.error === 'missing'
        ? `Il manque ${parsed.arg} après la commande.`
        : parsed.error === 'not_a_mention'
          ? `${parsed.arg} doit être un @pseudo.`
          : `${parsed.arg} doit être un nombre.`,
      { arg: parsed.arg, error: parsed.error, syntax: syntax(cfg) },
    );
  pass('arguments');

  const mention = cfg.args.find((a) => a.type === 'mention');
  const number = cfg.args.find((a) => a.type === 'number');
  const vars: Record<string, string | undefined> = {
    user: v.login,
    display_name: v.display_name,
    target: mention
      ? (parsed.values[mention.name] as string | undefined)
      : undefined,
    args: base.raw_args || undefined,
    amount: number ? toStr(parsed.values[number.name]) : undefined,
    count: String(input.usage.total + 1),
  };
  const message = (m: {
    mode: CmdConfig['reply']['mode'];
    text: string;
    to: string;
    to_login?: string;
  }): RenderedMessage | { missing: string } | null => {
    if (m.mode === 'silent') return null;
    const r = render(m.text, vars);
    if ('missing' in r) return r;
    const to =
      m.to === 'author'
        ? v.display_name
        : m.to === 'target'
          ? vars.target
          : m.to === 'user'
            ? m.to_login
            : undefined;
    if (m.to === 'target' && !to) return { missing: 'target' };
    return {
      mode: m.mode,
      text: sanitize(`${to ? `@${to} ` : ''}${r.text}`),
      reply_to: m.mode === 'reply' ? input.messageId : null,
    };
  };
  const reply = message(cfg.reply);
  const actions: Rendered['actions'] = [];
  const missing = (x: unknown) =>
    x && typeof x === 'object' && 'missing' in x
      ? (x as { missing: string }).missing
      : null;
  let absent = missing(reply);
  for (const a of cfg.actions) {
    if (a.type === 'module') {
      actions.push({
        id: a.id,
        type: 'module',
        module: a.module,
        operation: a.operation,
      });
      continue;
    }
    const m = message(a);
    absent ??= missing(m);
    if (m && !missing(m))
      actions.push({ id: a.id, type: 'chat', ...(m as RenderedMessage) });
  }
  if (absent)
    return reject(
      'invalid_arguments',
      `Il manque la valeur de {${absent}} (ajoute-la après la commande).`,
      {
        variable: absent,
        syntax: syntax(cfg),
      },
    );
  pass('variables');

  if (cfg.cooldown.enabled) {
    const last =
      cfg.cooldown.scope === 'viewer'
        ? input.usage.lastViewerAt
        : input.usage.lastGlobalAt;
    const left = last
      ? Math.ceil(
          (last.getTime() + cfg.cooldown.seconds * 1000 - input.now.getTime()) /
            1000,
        )
      : 0;
    if (left > 0)
      return reject('cooldown', `Trop tôt : encore ${fmt(left)} à attendre.`, {
        remaining_s: left,
        scope: cfg.cooldown.scope,
        seconds: cfg.cooldown.seconds,
      });
  }
  pass('cooldown');

  if (cfg.quota.enabled) {
    const used =
      cfg.quota.scope === 'viewer'
        ? input.usage.windowViewer
        : input.usage.windowGlobal;
    if (used >= cfg.quota.max)
      return reject(
        'quota',
        `Maximum atteint : ${used} sur ${cfg.quota.max} ${WINDOW[cfg.quota.window]}${cfg.quota.scope === 'viewer' ? ' pour toi' : ''}.`,
        {
          used,
          max: cfg.quota.max,
          window: cfg.quota.window,
          scope: cfg.quota.scope,
        },
      );
  }
  pass('quota');

  return {
    decision: 'accepted',
    reason: null,
    message: 'La commande répondra.',
    detail: {},
    checks,
    raw_args: base.raw_args,
    args: parsed.values,
    rendered: {
      reply: reply as RenderedMessage | null,
      actions,
      reply_first: cfg.reply_first,
    },
  };
}

const toStr = (x: string | number | undefined) =>
  x === undefined ? undefined : String(x);

/** « !hug @cible [message] » */
export function syntax(c: CmdConfig) {
  return `!${c.name}${c.args
    .map((a) => {
      const w = a.type === 'mention' ? `@${a.name}` : a.name;
      return ` ${a.required ? w : `[${w}]`}`;
    })
    .join('')}`;
}
