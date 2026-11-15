import {
  DEFAULT_PROGRESSION_RULES,
  type LabChatMessage,
  LEVEL_V2,
  type LevelUpNotifyMode,
  type ProgressionRules,
  ProgressionRulesSchema,
  WizebotExport,
} from '@raptoru/schemas';
import { createHash } from 'node:crypto';
import { insertAnnouncement } from '../commands/steps.js';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { LabChatModule } from '../lab-chat/router.js';
import type { TwitchUserLookup } from '../raffle-lab/avatars.js';
import type {
  PresenceListener,
  ValidatedPresence,
} from '../presence/presence-service.js';
import { liveChannelSession } from '../stream/channel-sessions.js';

// Progression native (docs/PROGRESSION.md) — replaces WizeBot's levels. The Core is the source of truth:
// - XP from VALIDATED presence (the presence tracker's intervals: seen in two consecutive chatters readings, credited
//   exactly once inside the cycle transaction) and from chat messages (one rewarded message per cooldown, a minimum
//   length, never a command, bots and the broadcaster excluded, live only) — no lurker detection is claimed beyond
//   what the chatters list shows;
// - every movement in an append-only ledger with a unique key (a redelivered message or cycle never pays twice);
// - the level derives from the XP (curve in the rules); reaching a level grants the catalogue's rewards for it;
// - titles and badges: a catalogue, an inventory (kept when revoked), what is equipped (owned and not revoked only).
// OFF by default: nothing is counted before the channel turns it on.

export class ProgressionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface Actor {
  id: string;
  name?: string;
}

/** Total XP to reach `level` (level 1 = 0 XP). */
export function xpForLevel(level: number, rules: ProgressionRules) {
  return level <= 1
    ? 0
    : Math.round(rules.curve_base * (level - 1) ** rules.curve_exponent);
}

/** The level of an XP total (the highest level whose threshold it reached). */
export function levelForXp(xp: number, rules: ProgressionRules) {
  let level = Math.max(
    1,
    Math.floor(
      (Math.max(0, xp) / rules.curve_base) ** (1 / rules.curve_exponent),
    ) + 1,
  );
  while (level > 1 && xpForLevel(level, rules) > xp) level--;
  while (xpForLevel(level + 1, rules) <= xp) level++;
  return level;
}

/**
 * Level Up V2: the frozen WizeBot normalization — newLevel = floor(1 + (target_max − 1) × ((L − 1) / (max_level − 1)) ^
 * exponent), monotone, level 1 stays 1, max_level → target_max; max_level = 1 → 1. A tiny epsilon keeps exact values
 * (135 → 50) from floating below their integer.
 */
export function normalizeWizebotLevel(
  level: number,
  n: { exponent: number; max_level: number; target_max: number },
) {
  if (n.max_level <= 1 || level <= 1) return 1;
  const r = (level - 1) / (n.max_level - 1);
  return Math.max(
    1,
    Math.floor(1 + (n.target_max - 1) * r ** n.exponent + 1e-9),
  );
}

/** The XP an attached WizeBot history starts with: its level on the curve, normalized once Level Up V2 is active. */
export function importXp(level: number, rules: ProgressionRules) {
  return xpForLevel(
    rules.wizebot_normalization
      ? normalizeWizebotLevel(level, rules.wizebot_normalization)
      : level,
    rules,
  );
}

type Settings = { enabled: boolean; rules: ProgressionRules };

interface AccountRow {
  twitch_user_id: string;
  xp: string | number;
  level: number;
  watch_seconds: string | number;
  messages: string | number;
  imported_watch_seconds: string | number;
  imported_messages: string | number;
  imported_level: number | null;
  last_message_xp_at: Date | null;
}

/** A WizeBot reading (Studio sends it in batches): one row per pseudo, the source's Twitch id when it gave one. */
interface ImportRequest {
  source: 'wizebot';
  /** The same work, rolled back: exact numbers, nothing written. */
  dry_run?: boolean;
  /** When the source was read (default: now); a reading older than the stored one never replaces it. */
  measured_at?: string | null;
  rows: {
    twitch_user_id: string | null;
    /** Where the id comes from (null: none); 'ambiguous': the legacy data saw several holders of the pseudo. */
    id_source?: 'wizebot' | 'legacy' | 'ambiguous' | null;
    login: string;
    level: number;
    watch_seconds: number;
    messages: number;
  }[];
}

/** How many different letters or digits a message has (« aaaa » → 1, « ????? » → 0, « salut » → 4). */
export function distinctChars(text: string) {
  return new Set(
    [...text.toLowerCase().normalize('NFKD')].filter((c) =>
      /[\p{L}\p{N}]/u.test(c),
    ),
  ).size;
}

/**
 * A message's fingerprint (never the text itself): case, accents, spaces, punctuation and stretched letters ignored —
 * « Salut !! », « salut » and « saluuuut » are the same message.
 */
export function messageFingerprint(text: string) {
  const norm = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/(.)\1+/gu, '$1');
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

/** Twitch: an announcement is 500 characters at most; a few names keep it readable. */
const ANNOUNCE_MAX_CHARS = 450;
const ANNOUNCE_MAX_NAMES = 8;
/** Two announcements are at least this far apart, even when a full one leaves level-ups for the next. */
const ANNOUNCE_MIN_GAP_MS = 60_000;
/** A WORD JOINER after the pseudo's first character: invisible, and the name no longer mentions (pings) the viewer. */
export const unping = (name: string) => {
  const c = Array.from(name);
  return c.length > 1 ? `${c[0]}\u2060${c.slice(1).join('')}` : name;
};
/** « Pseudo [Titre] (niveau) »: the equipped title only when there is one (never an empty slot). */
export const announceEntry = (
  name: string,
  title: string | null,
  level: number,
) => `${unping(name)}${title ? ` [${title}]` : ''} (${level})`;

/** raptoru.fr's WizeBot export (public, read-only); WIZEBOT_EXPORT_URL points elsewhere (staging, tests). */
const WIZEBOT_EXPORT_URL =
  process.env.WIZEBOT_EXPORT_URL ?? 'https://raptoru.fr/api/wizebot?export=1';

export interface NamesRefresh {
  at: string;
  /** Progression accounts checked against Twitch, by their id. */
  checked: number;
  /** Pseudos written for the first time (the account had none in the directory). */
  added: number;
  /** Pseudos changed (a rename, a display name). */
  updated: number;
  /** Ids Twitch does not know (deleted or suspended account): left as they are. */
  unresolved: number;
}

export class ProgressionService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** The channel whose viewers earn (the broadcaster); null: nothing is counted. */
    private readonly channelOf: () => string | null,
    /**
     * The Lab Core: its viewers are `lab_viewers` (per channel, no login: the lowercased name stands for it) and its
     * live is the Lab session; the main Core: `viewers` (Twitch logins) and the Daily's stream sessions.
     */
    private readonly o: {
      lab?: boolean;
      /** Reads raptoru.fr's WizeBot export (public data; the site holds the WizeBot key). Tests pass their own. */
      wizebotExport?: () => Promise<unknown>;
    } = {},
  ) {}

  /** Helix Get Users by id (the Core's Twitch app, wired by the frontier); absent without Twitch (the Lab). */
  userLookup: TwitchUserLookup | null = null;
  /** The last pseudo refresh (refreshNames), for Studio; in memory — the next run (start, then daily) refills it. */
  private lastNames: NamesRefresh | null = null;

  private async readWizebot() {
    const read =
      this.o.wizebotExport ??
      (async () => {
        const res = await fetch(WIZEBOT_EXPORT_URL, {
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new ProgressionError(502, 'wizebot_unavailable');
        return res.json();
      });
    const parsed = WizebotExport.safeParse(await read().catch(() => null));
    if (!parsed.success || !parsed.data.rows.length)
      throw new ProgressionError(502, 'wizebot_unavailable');
    return parsed.data;
  }

  /**
   * Studio's « Simuler » / « Importer depuis WizeBot »: the Core reads the whole WizeBot export itself (every viewer of
   * the three rankings, with the exact Twitch ids WizeBot gives and the date of the reading), then imports it in ONE
   * transaction — the simulation sees exactly what the import would do.
   */
  async importFromWizebot(channelId: string, dryRun: boolean, actor: Actor) {
    const data = await this.readWizebot();
    const out = await this.importHistory(
      channelId,
      {
        source: 'wizebot',
        dry_run: dryRun,
        measured_at: data.measured_at,
        rows: data.rows,
      },
      actor,
    );
    return { read: data.rows.length, measured_at: data.measured_at, ...out };
  }

  /** The channel's viewer directory as `(twitch_user_id, login, display_name)` (channel ids are digits only). */
  private dir(channelId: string) {
    if (!this.o.lab) return 'viewers';
    if (!/^[0-9]{1,32}$/.test(channelId))
      throw new ProgressionError(400, 'invalid_channel');
    return `(select viewer_id as twitch_user_id, lower(display_name) as login, display_name from lab_viewers
      where channel_id = '${channelId}')`;
  }

  private now() {
    return this.clock.now();
  }

  // --- settings ----------------------------------------------------------------------------------------------------

  async settings(channelId: string, q: Queryable = this.db): Promise<Settings> {
    const r = (
      await q.query<{ enabled: boolean; rules: Partial<ProgressionRules> }>(
        'select enabled, rules from progression_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    const rules = { ...DEFAULT_PROGRESSION_RULES, ...(r?.rules ?? {}) };
    // The first V2's text ({pseudo}, {niveau}: one line per viewer, with a mention) reads as today's announcement.
    if (!rules.level_up_chat_text.includes('{liste}'))
      rules.level_up_chat_text = DEFAULT_PROGRESSION_RULES.level_up_chat_text;
    return { enabled: r?.enabled ?? false, rules };
  }

  async updateSettings(
    channelId: string,
    patch: { enabled?: boolean; rules?: Partial<ProgressionRules> },
  ) {
    return this.db.tx(async (q) => {
      const cur = await this.settings(channelId, q);
      const rules = ProgressionRulesSchema.parse({
        ...cur.rules,
        ...(patch.rules ?? {}),
      });
      const curveChanged =
        rules.curve_base !== cur.rules.curve_base ||
        rules.curve_exponent !== cur.rules.curve_exponent;
      // Level Up V2: once the levels are fixed (1 000 XP each), the curve never changes from the settings — a level
      // reached never drops because of a setting.
      if (curveChanged && cur.rules.level_model === 'fixed')
        throw new ProgressionError(409, 'level_curve_locked');
      const enabled = patch.enabled ?? cur.enabled;
      await q.query(
        `insert into progression_settings (channel_id, enabled, rules, updated_at) values ($1, $2, $3, $4)
         on conflict (channel_id) do update set enabled = $2, rules = $3, updated_at = $4`,
        [channelId, enabled, JSON.stringify(rules), this.now()],
      );
      // A new curve: every level follows it (XP is never changed).
      if (curveChanged) await this.relevelAll(q, channelId, rules);
      return { enabled, rules };
    });
  }

  private async relevelAll(
    q: Queryable,
    channelId: string,
    rules: ProgressionRules,
  ) {
    const rows = await q.query<{ twitch_user_id: string; xp: string | number }>(
      'select twitch_user_id, xp from progression_accounts where channel_id = $1',
      [channelId],
    );
    for (const r of rows) {
      const level = levelForXp(Number(r.xp), rules);
      await q.query(
        'update progression_accounts set level = $3 where channel_id = $1 and twitch_user_id = $2 and level <> $3',
        [channelId, r.twitch_user_id, level],
      );
      await this.grantLevelRewards(q, channelId, r.twitch_user_id, level);
    }
  }

  // --- XP ----------------------------------------------------------------------------------------------------------

  /**
   * One XP movement, once (its key). In the caller's transaction. Returns false when the key was already recorded.
   * `extra` adds to the counters (watched seconds, messages) with the same exactly-once guarantee.
   */
  private async move(
    q: Queryable,
    channelId: string,
    viewerId: string,
    m: {
      kind:
        | 'presence'
        | 'message'
        | 'import'
        | 'grant'
        | 'correction'
        | 'normalization';
      amount: number;
      key: string;
      actor: string;
      reason?: string | null;
      watchSeconds?: number;
      messages?: number;
      messageXpAt?: Date;
    },
    rules: ProgressionRules,
  ) {
    const now = this.now();
    const inserted = await q.query(
      `insert into progression_ledger (channel_id, twitch_user_id, kind, amount, key, actor, reason, created_at,
         watch_seconds)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (channel_id, key) do nothing returning id`,
      [
        channelId,
        viewerId,
        m.kind,
        m.amount,
        m.key.slice(0, 200),
        m.actor.slice(0, 64),
        m.reason ?? null,
        now,
        m.watchSeconds ?? 0,
      ],
    );
    if (!inserted.length) return false;
    // What was EARNED by activity (presence, chat), per calendar week and month in Europe/Paris — the « Semaine » /
    // « Mois » rankings. Imports and Studio adjustments are not activity: they never enter a period.
    if (m.kind === 'presence' || m.kind === 'message')
      await q.query(
        `insert into progression_period_stats as s (channel_id, period, period_start, twitch_user_id, xp,
           watch_seconds, messages, updated_at)
         select $1, p, date_trunc(p, $6::timestamptz at time zone 'Europe/Paris')::date, $2, $3, $4, $5, $6
         from unnest(array['week', 'month']) as p
         on conflict (channel_id, period, period_start, twitch_user_id) do update set
           xp = s.xp + excluded.xp, watch_seconds = s.watch_seconds + excluded.watch_seconds,
           messages = s.messages + excluded.messages, updated_at = excluded.updated_at`,
        [
          channelId,
          viewerId,
          Math.max(0, m.amount),
          m.watchSeconds ?? 0,
          m.messages ?? 0,
          now,
        ],
      );
    const acc = (
      await q.query<AccountRow>(
        `insert into progression_accounts (channel_id, twitch_user_id, xp, level, watch_seconds, messages,
           last_message_xp_at, updated_at)
         values ($1, $2, greatest(0, $3::bigint), 1, $4, $5, $6, $7)
         on conflict (channel_id, twitch_user_id) do update set
           xp = greatest(0, progression_accounts.xp + $3::bigint),
           watch_seconds = progression_accounts.watch_seconds + $4,
           messages = progression_accounts.messages + $5,
           last_message_xp_at = coalesce($6, progression_accounts.last_message_xp_at),
           updated_at = $7
         returning *`,
        [
          channelId,
          viewerId,
          m.amount,
          m.watchSeconds ?? 0,
          m.messages ?? 0,
          m.messageXpAt ?? null,
          now,
        ],
      )
    )[0]!;
    const level = levelForXp(Number(acc.xp), rules);
    if (level !== acc.level)
      await q.query(
        'update progression_accounts set level = $3 where channel_id = $1 and twitch_user_id = $2',
        [channelId, viewerId, level],
      );
    if (level > acc.level) {
      await this.grantLevelRewards(q, channelId, viewerId, level);
      // A REAL level-up (presence, chat) is announced; an import, a normalization, a catch-up or a Studio adjustment
      // never is. One event per movement (its key): a replay never makes a second one.
      if (m.kind === 'presence' || m.kind === 'message')
        await this.levelUpEvent(
          q,
          channelId,
          viewerId,
          acc.level,
          level,
          m.key,
          rules,
        );
    }
    return true;
  }

  /**
   * Records a level-up, its SOUND (Studio's invisible OBS source: only when the channel's sound is on AND the viewer turned
   * it on — no choice known = no sound) and its CHAT announcement (every real level-up while the channel's announcements
   * are on, whatever the viewer's sound choice). The chat line itself is written by flushLevelUpChat.
   */
  private async levelUpEvent(
    q: Queryable,
    channelId: string,
    viewerId: string,
    from: number,
    to: number,
    key: string,
    rules: ProgressionRules,
  ) {
    const sound = await this.soundOn(q, channelId, viewerId);
    const who = (
      await q.query<{ name: string | null; login: string | null }>(
        `select coalesce(display_name, login) as name, login from ${this.dir(channelId)} d where twitch_user_id = $1`,
        [viewerId],
      )
    )[0];
    const name = who?.name ?? viewerId;
    const reason = !rules.level_up_sound
      ? 'sound_off'
      : !sound
        ? 'viewer_no_sound'
        : null;
    const chatReason = !rules.level_up_chat ? 'chat_off' : null;
    await q.query(
      `insert into progression_level_events (channel_id, twitch_user_id, display_name, login, from_level, to_level,
         source_key, notify_mode, status, reason, chat_status, chat_reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (channel_id, source_key) do nothing`,
      [
        channelId,
        viewerId,
        name.slice(0, 64),
        who?.login ?? null,
        from,
        to,
        key.slice(0, 200),
        sound ? 'sound' : 'off',
        reason ? 'skipped' : 'pending',
        reason,
        chatReason ? 'skipped' : 'pending',
        chatReason,
        this.now(),
      ],
    );
  }

  /**
   * The chat announcements of the level-ups waiting (in the caller's transaction, after the XP it moved, or the Core's
   * 30 s tick): a REAL Twitch announcement (the commands' outbox, mode `announce`: LeCroupier_ sends it with Send Chat
   * Announcement; « Sortie chat réelle » and the bot's rate limit apply).
   * - Grouping: the oldest level-up waiting opens a window of level_up_chat_interval_s; at its end, ONE announcement
   *   names everyone of the window (at most ANNOUNCE_MAX_NAMES and ANNOUNCE_MAX_CHARS; the others go in the next one,
   *   ANNOUNCE_MIN_GAP_MS later at least).
   * - A viewer who climbed several levels is named once, at the highest (the others « merged »); a level-up is in one
   *   announcement only (sent once, under the channel's lock).
   * - Every level-up ends with a recorded state (sent, merged, expired, skipped and why): never a silent loss. Not sent
   *   within level_up_max_age_s after its window: « too old », never a late flood after a pause.
   * An outbox refusal is logged and skipped, never its caller.
   */
  async flushLevelUpChat(
    q: Queryable,
    channelId: string,
    rules: ProgressionRules,
  ) {
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `levelups-chat:${channelId}`,
    ]);
    const now = this.now();
    const settle = (ids: string[], status: string, reason: string | null) =>
      ids.length
        ? q.query(
            `update progression_level_events set chat_status = $3, chat_reason = $4, chat_at = $5
             where channel_id = $1 and id = any($2::bigint[])`,
            [channelId, ids, status, reason, now],
          )
        : null;
    const rows = await q.query<{
      id: string;
      twitch_user_id: string;
      display_name: string;
      to_level: number;
      created_at: Date;
    }>(
      `select id, twitch_user_id, display_name, to_level, created_at from progression_level_events
       where channel_id = $1 and chat_status = 'pending' order by id limit 500`,
      [channelId],
    );
    if (!rows.length) return { sent: 0, waiting: 0 };
    if (!rules.level_up_chat) {
      await settle(
        rows.map((r) => r.id),
        'skipped',
        'chat_off',
      );
      return { sent: 0, waiting: 0 };
    }
    // « Sortie chat réelle » off (Lab without Twitch, chat muted): nothing is queued, nothing piles up for later.
    const output = (
      await q.query<{ chat_output: boolean }>(
        'select chat_output from cmd_channels where channel_id = $1',
        [channelId],
      )
    )[0]?.chat_output;
    if (!output) {
      await settle(
        rows.map((r) => r.id),
        'skipped',
        'chat_output_off',
      );
      return { sent: 0, waiting: 0 };
    }
    const age = (r: (typeof rows)[number]) =>
      now.getTime() - new Date(r.created_at).getTime();
    const window = rules.level_up_chat_interval_s * 1000;
    const tooOld = rows.filter(
      (r) => age(r) > window + rules.level_up_max_age_s * 1000,
    );
    await settle(
      tooOld.map((r) => r.id),
      'expired',
      'too_old',
    );
    const fresh = rows.filter((r) => !tooOld.includes(r));
    if (!fresh.length) return { sent: 0, waiting: 0 };
    // One entry per viewer, at their highest level, named in the order they FIRST levelled up (rows: oldest first).
    const best = new Map<string, (typeof fresh)[number]>();
    for (const r of fresh) {
      const cur = best.get(r.twitch_user_id);
      // Map keeps the first insertion's place: a higher level replaces the entry, not its position.
      if (!cur || r.to_level >= cur.to_level) best.set(r.twitch_user_id, r);
    }
    const wanted = [...best.values()];
    // The window: opened by the oldest level-up waiting (a merged one included: the viewer waited since then).
    if (Math.max(...fresh.map(age)) < window)
      return { sent: 0, waiting: wanted.length };
    const last = (
      await q.query<{ at: Date | null }>(
        `select max(chat_at) as at from progression_level_events where channel_id = $1 and chat_status = 'sent'`,
        [channelId],
      )
    )[0]?.at;
    if (last && now.getTime() - new Date(last).getTime() < ANNOUNCE_MIN_GAP_MS)
      return { sent: 0, waiting: wanted.length };
    const titles = await this.equippedTitles(
      q,
      channelId,
      wanted.map((r) => r.twitch_user_id),
    );
    const line = (parts: string[]) =>
      rules.level_up_chat_text.replace('{liste}', parts.join(' · '));
    const parts: string[] = [];
    const included: typeof wanted = [];
    for (const r of wanted) {
      const part = announceEntry(
        r.display_name,
        titles.get(r.twitch_user_id) ?? null,
        r.to_level,
      );
      if (
        parts.length >= ANNOUNCE_MAX_NAMES ||
        (parts.length && line([...parts, part]).length > ANNOUNCE_MAX_CHARS)
      )
        break;
      parts.push(part);
      included.push(r);
    }
    const ids = included.map((r) => r.id);
    // The lower level-ups of the viewers named: merged into this announcement (settled with it, not before — the
    // window and the order stay those of their first level-up).
    const named = new Set(included.map((r) => r.twitch_user_id));
    const merged = fresh
      .filter((r) => named.has(r.twitch_user_id) && !ids.includes(r.id))
      .map((r) => r.id);
    const written = await insertAnnouncement(q, {
      channelId,
      now,
      origin: 'module:level_up',
      drafts: [
        {
          idempotencyKey: `levelup:${channelId}:${ids.join('-')}`.slice(0, 200),
          mode: 'announce',
          color: rules.level_up_chat_color,
          text: line(parts).slice(0, ANNOUNCE_MAX_CHARS),
        },
      ],
    });
    await settle(
      ids,
      written ? 'sent' : 'skipped',
      written ? null : 'outbox_refused',
    );
    await settle(merged, 'merged', 'newer_level_up');
    return {
      sent: written ? ids.length : 0,
      waiting: wanted.length - included.length,
    };
  }

  /**
   * The title each viewer has EQUIPPED now (their choice on raptoru.fr), shown only while they own it (not revoked) and
   * it is active and published — the rankings' own rule. No title: absent from the map.
   */
  private async equippedTitles(
    q: Queryable,
    channelId: string,
    viewerIds: string[],
  ) {
    if (!viewerIds.length) return new Map<string, string>();
    const rows = await q.query<{ id: string; label: string }>(
      `select e.twitch_user_id as id, r.label from progression_equipped e
       join progression_grants g on g.channel_id = e.channel_id and g.twitch_user_id = e.twitch_user_id
         and g.reward_id = e.title_id and g.revoked_at is null
       join progression_rewards r on r.channel_id = e.channel_id and r.reward_id = e.title_id and r.kind = 'title'
         and r.active and r.status <> 'draft'
       where e.channel_id = $1 and e.twitch_user_id = any($2::text[])`,
      [channelId, viewerIds],
    );
    return new Map(rows.map((r) => [r.id, r.label.slice(0, 40)]));
  }

  /** The Core's own tick (every 30 s): an announcement whose window ended goes out even when nobody chats. */
  async tick() {
    const channelId = this.channelOf();
    if (!channelId) return;
    await this.db.tx(async (q) => {
      const s = await this.settings(channelId, q);
      if (s.enabled) await this.flushLevelUpChat(q, channelId, s.rules);
    });
  }

  /** Viewers excluded by login (bots, from the rules) and the broadcaster. */
  private async eligible(
    q: Queryable,
    channelId: string,
    ids: string[],
    rules: ProgressionRules,
  ) {
    if (!ids.length) return [];
    const excluded = new Set(
      (
        await q.query<{ id: string }>(
          `select twitch_user_id as id from ${this.dir(channelId)} d where twitch_user_id = any($1::text[]) and login = any($2::text[])`,
          [ids, rules.excluded_logins],
        )
      ).map((r) => r.id),
    );
    return ids.filter((id) => id !== channelId && !excluded.has(id));
  }

  /** The presence tracker's listener: XP for each validated interval (inside the cycle transaction). */
  readonly presenceListener: PresenceListener = {
    /**
     * Runs inside the presence cycle's transaction, next to the Loyalty Engine (Jetons): in its own savepoint, so a
     * progression failure is undone alone and logged — never the cycle, never the Jetons of that interval.
     */
    validated: async (q: Queryable, interval: ValidatedPresence) => {
      await q.query('savepoint progression_presence');
      try {
        await this.presenceXp(q, interval);
        await q.query('release savepoint progression_presence');
      } catch (e) {
        await q.query('rollback to savepoint progression_presence');
        console.error('[progression] presence ignored', (e as Error).message);
      }
    },
  };

  private async presenceXp(q: Queryable, interval: ValidatedPresence) {
    const channelId = this.channelOf();
    if (!channelId) return;
    const s = await this.settings(channelId, q);
    if (!s.enabled || interval.seconds <= 0) return;
    const amount = Math.round((interval.seconds / 60) * s.rules.xp_per_minute);
    const cycle = `${interval.streamId}:${interval.at.getTime()}`;
    const ids = await this.eligible(q, channelId, interval.viewerIds, s.rules);
    for (const id of ids)
      await this.move(
        q,
        channelId,
        id,
        {
          kind: 'presence',
          amount,
          key: `presence:${cycle}:${id}`,
          actor: 'presence',
          watchSeconds: interval.seconds,
        },
        s.rules,
      );
    // Viewers seen again: their waiting WizeBot history, if certainly theirs.
    await this.attachReturning(q, channelId, ids);
    // Everyone who levelled up in this cycle: one grouped chat line (never one per viewer).
    await this.flushLevelUpChat(q, channelId, s.rules);
  }

  private async live(q: Queryable, channelId: string) {
    if (this.o.lab) return (await liveChannelSession(q, channelId)) !== null;
    return (
      (
        await q.query(
          'select 1 from stream_sessions where ended_at is null limit 1',
        )
      ).length > 0
    );
  }

  /**
   * A chat message: COUNTED once (every message the bot received, commands included — the statistic), XP only when it
   * passes the anti-spam rules (never a command, a minimum length, one rewarded message per cooldown). Never blocks
   * the chat (errors swallowed).
   */
  async onMessage(msg: LabChatMessage) {
    const channelId = msg.channel_id;
    if (channelId !== this.channelOf()) return 'ignored';
    return this.db.tx(async (q) => {
      const s = await this.settings(channelId, q);
      if (!s.enabled) return 'off';
      const text = msg.text.trim();
      const command = text.startsWith('!');
      if (
        msg.chatter.role === 'broadcaster' ||
        s.rules.excluded_logins.includes(msg.chatter.login.toLowerCase())
      )
        return 'excluded';
      if (s.rules.live_only && !(await this.live(q, channelId)))
        return 'offline';
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `xp:${channelId}:${msg.chatter.id}`,
      ]);
      if (this.o.lab)
        await q.query(
          `insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen) values ($1, $2, $3, $4, $4)
           on conflict (channel_id, viewer_id) do update set display_name = $3, last_seen = $4`,
          [channelId, msg.chatter.id, msg.chatter.display_name, this.now()],
        );
      else
        await q.query(
          // A renamed viewer: today's pseudo (by the stable id), never the old one kept.
          `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3)
           on conflict (twitch_user_id) do update set login = excluded.login, display_name = excluded.display_name,
             updated_at = now()
           where viewers.login is distinct from excluded.login or viewers.display_name is distinct from excluded.display_name`,
          [
            msg.chatter.id,
            msg.chatter.login.toLowerCase(),
            msg.chatter.display_name,
          ],
        );
      const acc = (
        await q.query<{
          last_message_xp_at: Date | null;
          last_message_fp: string | null;
        }>(
          'select last_message_xp_at, last_message_fp from progression_accounts where channel_id = $1 and twitch_user_id = $2',
          [channelId, msg.chatter.id],
        )
      )[0];
      const now = this.now();
      const since = acc?.last_message_xp_at
        ? now.getTime() - new Date(acc.last_message_xp_at).getTime()
        : Infinity;
      const ready = since >= s.rules.message_cooldown_s * 1000;
      // Anti-farming (docs/LEVEL_UP_V2.md § 3): a real sentence, not « aaaa » nor « ?????? », and not the same text
      // as the last rewarded one.
      const long =
        [...text].length >= s.rules.message_min_chars &&
        distinctChars(text) >= s.rules.message_min_distinct;
      const fp = messageFingerprint(text);
      const repeated =
        acc?.last_message_fp === fp &&
        since < s.rules.message_repeat_window_s * 1000;
      const amount =
        ready && long && !repeated && !command ? s.rules.message_xp : 0;
      // Every message is counted once (the counter WizeBot showed); only a rewarded one moves the cooldown.
      const done = await this.move(
        q,
        channelId,
        msg.chatter.id,
        {
          kind: 'message',
          amount,
          key: `msg:${msg.message_id}`,
          actor: 'chat',
          messages: 1,
          messageXpAt: amount > 0 ? now : undefined,
        },
        s.rules,
      );
      if (done && amount > 0)
        await q.query(
          'update progression_accounts set last_message_fp = $3 where channel_id = $1 and twitch_user_id = $2',
          [channelId, msg.chatter.id, fp],
        );
      if (done) {
        await this.attachReturning(q, channelId, [msg.chatter.id]);
        await this.flushLevelUpChat(q, channelId, s.rules);
      }
      return !done
        ? 'replayed'
        : command
          ? 'command'
          : amount > 0
            ? 'xp'
            : !ready
              ? 'cooldown'
              : !long
                ? 'too_short'
                : 'repeated';
    });
  }

  /** The chat router's module: reads every plain message, never answers, never takes a message from another module. */
  readonly chatModule: LabChatModule = {
    name: 'progression',
    plainText: true,
    chat: async (msg) => {
      try {
        await this.onMessage(msg);
      } catch (e) {
        console.error('[progression] message ignored', (e as Error).message);
      }
      return { outcome: 'ignored' };
    },
  };

  // --- rewards: catalogue, inventory, equipped -----------------------------------------------------------------------

  async catalog(channelId: string, all = false) {
    return this.db.query(
      `select reward_id, kind, label, description, rarity, category, unlock_level, active, sort, status
       from progression_rewards
       where channel_id = $1 and ($2 or (active and status <> 'draft')) order by kind, sort, unlock_level nulls last, label`,
      [channelId, all],
    );
  }

  async upsertReward(
    channelId: string,
    r: {
      reward_id: string;
      kind: 'title' | 'badge';
      label: string;
      description: string;
      rarity: string;
      category: string;
      unlock_level: number | null;
      active: boolean;
      sort: number;
    },
  ) {
    return this.db.tx(async (q) => {
      const prior = (
        await q.query<{ kind: string }>(
          'select kind from progression_rewards where channel_id = $1 and reward_id = $2',
          [channelId, r.reward_id],
        )
      )[0];
      if (prior && prior.kind !== r.kind)
        throw new ProgressionError(409, 'kind_locked');
      const now = this.now();
      await q.query(
        `insert into progression_rewards (channel_id, reward_id, kind, label, description, rarity, category, unlock_level,
           active, sort, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         on conflict (channel_id, reward_id) do update set label = $4, description = $5, rarity = $6, category = $7,
           unlock_level = $8, active = $9, sort = $10, updated_at = $11`,
        [
          channelId,
          r.reward_id,
          r.kind,
          r.label,
          r.description,
          r.rarity,
          r.category,
          r.unlock_level,
          r.active,
          r.sort,
          now,
        ],
      );
      // A level reward: every viewer already at that level gets it now (never a second copy) — or at the Level Up V2
      // activation while WizeBot levels wait for their normalization (levelRewardsReady).
      if (
        r.unlock_level !== null &&
        r.active &&
        (await this.levelRewardsReady(q, channelId))
      ) {
        const ids = await q.query<{ id: string }>(
          'select twitch_user_id as id from progression_accounts where channel_id = $1 and level >= $2',
          [channelId, r.unlock_level],
        );
        for (const { id } of ids)
          await this.insertGrant(
            q,
            channelId,
            id,
            r.reward_id,
            'level',
            `level:${r.unlock_level}`,
            'progression',
            false,
          );
      }
      return r;
    });
  }

  /** Returns true when the viewer now owns it (new or restored). `restore`: a revoked grant comes back (manual). */
  async insertGrant(
    q: Queryable,
    channelId: string,
    viewerId: string,
    rewardId: string,
    source: 'level' | 'event' | 'manual' | 'import' | 'purchase' | 'reward',
    reference: string | null,
    by: string,
    restore: boolean,
  ) {
    const now = this.now();
    const r = await q.query<{ revoked_at: Date | null; fresh: boolean }>(
      `insert into progression_grants (channel_id, twitch_user_id, reward_id, source, reference, granted_by, granted_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (channel_id, twitch_user_id, reward_id) do update set
         revoked_at = case when $8 then null else progression_grants.revoked_at end,
         revoked_by = case when $8 then null else progression_grants.revoked_by end,
         revoke_reason = case when $8 then null else progression_grants.revoke_reason end,
         source = case when $8 and progression_grants.revoked_at is not null then excluded.source
           else progression_grants.source end,
         granted_at = case when $8 and progression_grants.revoked_at is not null then excluded.granted_at
           else progression_grants.granted_at end
       returning revoked_at, (xmax = 0) as fresh`,
      [
        channelId,
        viewerId,
        rewardId,
        source,
        reference,
        by.slice(0, 64),
        now,
        restore,
      ],
    );
    return r[0]?.revoked_at === null;
  }

  /**
   * Level rewards (the badges every 10 levels) follow the level the viewer KEEPS: while attached WizeBot histories wait
   * for the Level Up V2 normalization, a level read on the old scale (a WizeBot 135 before it becomes 50) would give a
   * badge lost the day after — so they wait for the activation, which gives them on the recalculated levels. A channel
   * without WizeBot history, or already on Level Up V2: given at once, as always.
   */
  async levelRewardsReady(q: Queryable, channelId: string) {
    const { rules } = await this.settings(channelId, q);
    if (rules.level_model === 'fixed') return true;
    return !(
      await q.query(
        `select 1 from progression_accounts where channel_id = $1 and imported_level is not null limit 1`,
        [channelId],
      )
    ).length;
  }

  private async grantLevelRewards(
    q: Queryable,
    channelId: string,
    viewerId: string,
    level: number,
  ) {
    if (!(await this.levelRewardsReady(q, channelId))) return;
    const rewards = await q.query<{ reward_id: string; unlock_level: number }>(
      `select reward_id, unlock_level from progression_rewards
       where channel_id = $1 and active and status <> 'draft' and unlock_level is not null and unlock_level <= $2`,
      [channelId, level],
    );
    for (const r of rewards)
      await this.insertGrant(
        q,
        channelId,
        viewerId,
        r.reward_id,
        'level',
        `level:${r.unlock_level}`,
        'progression',
        false,
      );
  }

  /** Studio / an event: grant one reward to viewers. Idempotent; a revoked grant is restored (a deliberate re-grant). */
  async grant(
    channelId: string,
    req: {
      reward_id: string;
      viewers: string[];
      source: 'event' | 'manual';
      reference: string | null;
    },
    actor: Actor,
  ) {
    return this.db.tx(async (q) => {
      const reward = (
        await q.query<{ active: boolean; status: string }>(
          'select active, status from progression_rewards where channel_id = $1 and reward_id = $2',
          [channelId, req.reward_id],
        )
      )[0];
      if (!reward) throw new ProgressionError(404, 'unknown_reward');
      if (!reward.active) throw new ProgressionError(409, 'reward_inactive');
      // Boutique cosmétique: a draft is never given (published, hidden and archived items can be).
      if (reward.status === 'draft')
        throw new ProgressionError(409, 'reward_draft');
      const ids = [...new Set(req.viewers)];
      const known = new Set(
        (
          await q.query<{ id: string }>(
            `select twitch_user_id as id from ${this.dir(channelId)} d where twitch_user_id = any($1::text[])`,
            [ids],
          )
        ).map((r) => r.id),
      );
      const granted: string[] = [];
      for (const id of ids)
        if (
          known.has(id) &&
          (await this.insertGrant(
            q,
            channelId,
            id,
            req.reward_id,
            req.source,
            req.reference,
            actor.name ?? actor.id,
            true,
          ))
        )
          granted.push(id);
      return {
        reward_id: req.reward_id,
        granted,
        unknown: ids.filter((id) => !known.has(id)),
      };
    });
  }

  /** Revoke (kept in the inventory as revoked, with who and why); unequipped at once. */
  async revoke(
    channelId: string,
    req: { reward_id: string; viewer: string; reason: string },
    actor: Actor,
  ) {
    return this.db.tx((q) => this.revokeIn(q, channelId, req, actor));
  }

  /** The same, in the caller's transaction (the cosmetic shop's refund). */
  async revokeIn(
    q: Queryable,
    channelId: string,
    req: { reward_id: string; viewer: string; reason: string },
    actor: Actor,
  ) {
    {
      const r = await q.query(
        `update progression_grants set revoked_at = $4, revoked_by = $5, revoke_reason = $6
         where channel_id = $1 and twitch_user_id = $2 and reward_id = $3 and revoked_at is null returning id`,
        [
          channelId,
          req.viewer,
          req.reward_id,
          this.now(),
          (actor.name ?? actor.id).slice(0, 64),
          req.reason,
        ],
      );
      if (!r.length) throw new ProgressionError(404, 'not_owned');
      await q.query(
        `update progression_equipped set title_id = case when title_id = $3 then null else title_id end,
           badge_ids = array_remove(badge_ids, $3),
           frame_id = case when frame_id = $3 then null else frame_id end,
           banner_id = case when banner_id = $3 then null else banner_id end, updated_at = $4
         where channel_id = $1 and twitch_user_id = $2`,
        [channelId, req.viewer, req.reward_id, this.now()],
      );
      return { revoked: true };
    }
  }

  /**
   * The viewer's choice (raptoru.fr): a title, up to 3 badges, a frame and a banner among what they own (not revoked,
   * active). frame_id / banner_id absent: unchanged (an older site never clears them); null: removed.
   */
  async equip(
    channelId: string,
    req: {
      viewer: string;
      title_id: string | null;
      badge_ids: string[];
      frame_id?: string | null;
      banner_id?: string | null;
    },
  ) {
    return this.db.tx(async (q) => {
      const wanted = [
        ...new Set(
          [req.title_id, req.frame_id, req.banner_id, ...req.badge_ids].filter(
            (x): x is string => !!x,
          ),
        ),
      ];
      const owned = new Map(
        (
          await q.query<{ reward_id: string; kind: string }>(
            `select g.reward_id, r.kind from progression_grants g join progression_rewards r using (channel_id, reward_id)
             where g.channel_id = $1 and g.twitch_user_id = $2 and g.revoked_at is null and r.active
               and r.status <> 'draft' and g.reward_id = any($3::text[])`,
            [channelId, req.viewer, wanted],
          )
        ).map((r) => [r.reward_id, r.kind]),
      );
      if (req.title_id && owned.get(req.title_id) !== 'title')
        throw new ProgressionError(403, 'title_not_owned');
      const badges = [...new Set(req.badge_ids)];
      if (badges.some((b) => owned.get(b) !== 'badge'))
        throw new ProgressionError(403, 'badge_not_owned');
      if (req.frame_id && owned.get(req.frame_id) !== 'frame')
        throw new ProgressionError(403, 'frame_not_owned');
      if (req.banner_id && owned.get(req.banner_id) !== 'banner')
        throw new ProgressionError(403, 'banner_not_owned');
      const row = (
        await q.query<{ frame_id: string | null; banner_id: string | null }>(
          `insert into progression_equipped (channel_id, twitch_user_id, title_id, badge_ids, frame_id, banner_id, updated_at)
           values ($1, $2, $3, $4, $6, $8, $5)
           on conflict (channel_id, twitch_user_id) do update set title_id = $3, badge_ids = $4, updated_at = $5,
             frame_id = case when $7 then $6 else progression_equipped.frame_id end,
             banner_id = case when $9 then $8 else progression_equipped.banner_id end
           returning frame_id, banner_id`,
          [
            channelId,
            req.viewer,
            req.title_id,
            badges,
            this.now(),
            req.frame_id ?? null,
            req.frame_id !== undefined,
            req.banner_id ?? null,
            req.banner_id !== undefined,
          ],
        )
      )[0]!;
      return {
        title_id: req.title_id,
        badge_ids: badges,
        frame_id: row.frame_id,
        banner_id: row.banner_id,
      };
    });
  }

  // --- WizeBot import (every row kept, attached only when certain, idempotent, reversible) -----------------------------

  /**
   * Records the source's rows in `progression_history` (with their source and date), then attaches every row still
   * waiting: by the exact Twitch id the source gave, else by the ONE Core account behind its pseudo. An attached viewer
   * starts at their WizeBot level (XP = the curve's threshold, once: key import:wizebot:<id>) with WizeBot's watchtime and
   * messages kept apart. Rows that cannot be attached stay stored (pending / ambiguous / conflict) for a later run.
   * `dry_run`: the same work in a savepoint rolled back — the exact numbers, nothing written.
   */
  async importHistory(channelId: string, req: ImportRequest, actor: Actor) {
    return this.db.tx(async (q) => {
      if (!req.dry_run) return this.runImport(q, channelId, req, actor);
      await q.query('savepoint progression_dry_run');
      try {
        const { imported, ...rest } = await this.runImport(
          q,
          channelId,
          req,
          actor,
        );
        return { dry_run: true, would_import: imported, ...rest };
      } finally {
        await q.query('rollback to savepoint progression_dry_run');
      }
    });
  }

  private async runImport(
    q: Queryable,
    channelId: string,
    req: ImportRequest,
    actor: Actor,
  ) {
    const s = await this.settings(channelId, q);
    const now = this.now();
    const measuredAt = req.measured_at ? new Date(req.measured_at) : now;
    const already = (
      await q.query<{ n: string }>(
        `select count(*) as n from progression_history
         where channel_id = $1 and source = $2 and status = 'imported' and login = any($3::text[])`,
        [channelId, req.source, req.rows.map((r) => r.login)],
      )
    )[0]!;
    // Stored first, attached or not. An imported row is frozen; an older reading never replaces a newer one.
    if (req.rows.length)
      await q.query(
        `insert into progression_history as h (channel_id, source, login, twitch_user_id, id_source, level, watch_seconds,
           messages, measured_at, status, first_seen_at, updated_at)
         select $1, $2, r.login, r.twitch_user_id, r.id_source, r.level, r.watch_seconds, r.messages, $3, 'pending', $4, $4
         from jsonb_to_recordset($5::jsonb) as r(login text, twitch_user_id text, id_source text, level int,
           watch_seconds bigint, messages bigint)
         on conflict (channel_id, source, login) do update set
           -- A newer reading without identity evidence never erases the one already stored.
           twitch_user_id = case when excluded.id_source is null then h.twitch_user_id else excluded.twitch_user_id end,
           id_source = coalesce(excluded.id_source, h.id_source), level = excluded.level,
           watch_seconds = excluded.watch_seconds, messages = excluded.messages, measured_at = excluded.measured_at,
           updated_at = excluded.updated_at
         where h.status <> 'imported' and excluded.measured_at >= h.measured_at`,
        [channelId, req.source, measuredAt, now, JSON.stringify(req.rows)],
      );
    const waiting = await q.query<{
      login: string;
      twitch_user_id: string | null;
      id_source: 'wizebot' | 'legacy' | 'ambiguous' | null;
      level: number;
      watch_seconds: string | number;
      messages: string | number;
    }>(
      `select login, twitch_user_id, id_source, level, watch_seconds, messages from progression_history
       where channel_id = $1 and source = $2 and status <> 'imported' order by login`,
      [channelId, req.source],
    );
    // The Core's directory: every id behind a pseudo (a pseudo held by two accounts is ambiguous).
    const known = await q.query<{ id: string; login: string }>(
      `select twitch_user_id as id, login from ${this.dir(channelId)} d where login = any($1::text[])`,
      [waiting.map((w) => w.login)],
    );
    const idsOfLogin = new Map<string, Set<string>>();
    for (const k of known)
      idsOfLogin.set(k.login, (idsOfLogin.get(k.login) ?? new Set()).add(k.id));
    // Viewers who already have an imported history: never a second one.
    const taken = new Set(
      (
        await q.query<{ id: string }>(
          `select resolved_id as id from progression_history
           where channel_id = $1 and source = $2 and status = 'imported'`,
          [channelId, req.source],
        )
      ).map((r) => r.id),
    );
    type Res = {
      row: (typeof waiting)[number];
      id: string;
      by: 'id' | 'login';
    };
    const resolved: Res[] = [];
    const status = new Map<string, 'pending' | 'ambiguous' | 'conflict'>();
    // The Wallet's identity rules (docs/ECONOMY_MIGRATION.md § 8, wallet/se-identity.ts), the Core's directory standing
    // for « Twitch now »: the Twitch id is the identity; a pseudo is only a clue; quarantine rather than a wrong holder.
    for (const row of waiting) {
      const found = idsOfLogin.get(row.login) ?? new Set<string>();
      if (row.id_source === 'ambiguous' || found.size > 1)
        // The legacy data saw several holders of the pseudo, or the Core knows several accounts by it.
        status.set(row.login, 'ambiguous');
      else if (row.twitch_user_id && row.id_source === 'wizebot')
        // WizeBot's own user id: exact (a renamed viewer keeps their history).
        resolved.push({ row, id: row.twitch_user_id, by: 'id' });
      else if (row.twitch_user_id)
        // A legacy (id, pseudo) pair: kept unless today's holder of the pseudo is someone else (pseudo reassigned).
        if (found.size && !found.has(row.twitch_user_id))
          status.set(row.login, 'ambiguous');
        else resolved.push({ row, id: row.twitch_user_id, by: 'id' });
      else if (found.size === 1)
        resolved.push({ row, id: [...found][0]!, by: 'login' });
      else status.set(row.login, 'pending');
    }
    // One viewer reached by two rows (two pseudos of one account), or already imported: conflict, none attached.
    const perId = new Map<string, number>();
    for (const r of resolved) perId.set(r.id, (perId.get(r.id) ?? 0) + 1);
    const unique: Res[] = [];
    for (const r of resolved)
      if (perId.get(r.id)! > 1 || taken.has(r.id))
        status.set(r.row.login, 'conflict');
      else unique.push(r);
    let imported = 0;
    for (const { row, id, by } of unique) {
      const ok = await this.move(
        q,
        channelId,
        id,
        {
          kind: 'import',
          amount: importXp(row.level, s.rules),
          key: `import:${req.source}:${id}`,
          actor: actor.name ?? actor.id,
          reason: `${req.source} niveau ${row.level} (${row.login})`,
        },
        s.rules,
      );
      if (!ok) {
        status.set(row.login, 'conflict');
        continue;
      }
      await q.query(
        `update progression_accounts set imported_level = $3, imported_watch_seconds = $4, imported_messages = $5
         where channel_id = $1 and twitch_user_id = $2`,
        [channelId, id, row.level, row.watch_seconds, row.messages],
      );
      await q.query(
        `update progression_history set status = 'imported', resolved_id = $4, resolved_by = $5, resolved_at = $6,
           updated_at = $6
         where channel_id = $1 and source = $2 and login = $3`,
        [channelId, req.source, row.login, id, by, now],
      );
      imported++;
    }
    const list = (st: string) =>
      [...status].filter(([, v]) => v === st).map(([k]) => k);
    for (const st of ['pending', 'ambiguous', 'conflict'] as const)
      await q.query(
        `update progression_history set status = $4, updated_at = $5
         where channel_id = $1 and source = $2 and login = any($3::text[]) and status <> $4`,
        [channelId, req.source, list(st), st, now],
      );
    return {
      imported,
      already: Number(already.n),
      by_id: unique.filter((u) => u.by === 'id').length,
      by_login: unique.filter((u) => u.by === 'login').length,
      unresolved: list('pending'),
      ambiguous: list('ambiguous'),
      conflicts: list('conflict'),
    };
  }

  /**
   * A viewer seen again (presence, chat, sign-in on raptoru.fr): when a waiting WizeBot row could be theirs (their id or
   * their pseudo), the waiting rows are attached again with the same rules. In the caller's transaction; cheap when
   * nothing waits for them. The XP earned since is never touched (the import adds its own movement once).
   */
  private async attachReturning(
    q: Queryable,
    channelId: string,
    viewerIds: string[],
  ) {
    if (!viewerIds.length) return;
    const hit = await q.query(
      `select 1 from progression_history h where h.channel_id = $1 and h.status = 'pending'
         and (h.twitch_user_id = any($2::text[])
           or h.login in (select login from ${this.dir(channelId)} d where twitch_user_id = any($2::text[])))
       limit 1`,
      [channelId, viewerIds],
    );
    if (hit.length)
      await this.runImport(
        q,
        channelId,
        { source: 'wizebot', rows: [] },
        { id: 'auto', name: 'rattachement automatique' },
      );
  }

  /**
   * raptoru.fr: a viewer signed in (Twitch OAuth — the site's own verified pair of id and pseudo). The pair joins the
   * Core's directory when unknown, then their waiting history is attached if it is certainly theirs.
   */
  async identify(
    channelId: string,
    req: { viewer: string; login: string; display_name?: string | null },
  ) {
    return this.db.tx(async (q) => {
      if (!this.o.lab)
        await q.query(
          // A renamed viewer: today's pseudo (by the stable id), never the old one kept.
          `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3)
           on conflict (twitch_user_id) do update set login = excluded.login, display_name = excluded.display_name,
             updated_at = now()
           where viewers.login is distinct from excluded.login or viewers.display_name is distinct from excluded.display_name`,
          [req.viewer, req.login, req.display_name ?? req.login],
        );
      const before = (await this.importStatus(channelId, 'wizebot', q))
        .imported;
      await this.attachReturning(q, channelId, [req.viewer]);
      const after = (await this.importStatus(channelId, 'wizebot', q)).imported;
      return { attached: after - before };
    });
  }

  /** Studio: the rows still waiting (pending / ambiguous / conflict), with the Core accounts behind their pseudo. */
  async waiting(channelId: string, search = '', q: Queryable = this.db) {
    const prefix = search
      .trim()
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 25);
    const rows = await q.query<{
      login: string;
      twitch_user_id: string | null;
      id_source: string | null;
      level: number;
      watch_seconds: string;
      messages: string;
      measured_at: Date;
      status: string;
      candidates: string[] | null;
    }>(
      `select h.login, h.twitch_user_id, h.id_source, h.level, h.watch_seconds, h.messages, h.measured_at, h.status,
         (select array_agg(d.twitch_user_id order by d.twitch_user_id) from ${this.dir(channelId)} d
           where d.login = h.login) as candidates
       from progression_history h
       where h.channel_id = $1 and h.status <> 'imported' and h.login like $2
       order by h.level desc, h.login limit 200`,
      [channelId, `${prefix.replace(/_/g, '\\_')}%`],
    );
    return rows.map((r) => ({
      login: r.login,
      status: r.status,
      twitchUserId: r.twitch_user_id,
      idSource: r.id_source,
      level: r.level,
      watchMinutes: Math.floor(Number(r.watch_seconds) / 60),
      messages: Number(r.messages),
      measuredAt: new Date(r.measured_at).toISOString(),
      candidates: r.candidates ?? [],
    }));
  }

  /**
   * Studio: Antoni attaches one waiting row to a viewer after checking it himself — journaled (who, why). Refused when
   * that viewer already has a WizeBot history (never two) or is unknown to the Core.
   */
  async attachManually(
    channelId: string,
    req: { source: 'wizebot'; login: string; viewer: string; reason: string },
    actor: Actor,
  ) {
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `xp:${channelId}:${req.viewer}`,
      ]);
      const s = await this.settings(channelId, q);
      const row = (
        await q.query<{
          status: string;
          level: number;
          watch_seconds: string;
          messages: string;
        }>(
          `select status, level, watch_seconds, messages from progression_history
           where channel_id = $1 and source = $2 and login = $3 for update`,
          [channelId, req.source, req.login],
        )
      )[0];
      if (!row) throw new ProgressionError(404, 'unknown_row');
      if (row.status === 'imported')
        throw new ProgressionError(409, 'already_attached');
      const known = await q.query(
        `select 1 from ${this.dir(channelId)} d where twitch_user_id = $1`,
        [req.viewer],
      );
      if (!known.length) throw new ProgressionError(404, 'unknown_viewer');
      const by = actor.name ?? actor.id;
      const ok = await this.move(
        q,
        channelId,
        req.viewer,
        {
          kind: 'import',
          amount: importXp(row.level, s.rules),
          key: `import:${req.source}:${req.viewer}`,
          actor: by,
          reason:
            `${req.source} niveau ${row.level} (${req.login}) — rattachement manuel : ${req.reason}`.slice(
              0,
              300,
            ),
        },
        s.rules,
      );
      if (!ok) throw new ProgressionError(409, 'viewer_has_history');
      await q.query(
        `update progression_accounts set imported_level = $3, imported_watch_seconds = $4, imported_messages = $5
         where channel_id = $1 and twitch_user_id = $2`,
        [channelId, req.viewer, row.level, row.watch_seconds, row.messages],
      );
      await q.query(
        `update progression_history set status = 'imported', resolved_id = $4, resolved_by = 'manual', resolved_at = $5,
           resolve_note = $6, updated_at = $5
         where channel_id = $1 and source = $2 and login = $3`,
        [
          channelId,
          req.source,
          req.login,
          req.viewer,
          this.now(),
          `${by} : ${req.reason}`.slice(0, 300),
        ],
      );
      return { attached: true, viewer: req.viewer, level: row.level };
    });
  }

  /** What the history holds: rows per status, the latest reading (Studio's panel). */
  async importStatus(
    channelId: string,
    source: 'wizebot' = 'wizebot',
    q: Queryable = this.db,
  ) {
    const rows = await q.query<{
      status: string;
      n: string;
      last: Date | null;
    }>(
      `select status, count(*) as n, max(measured_at) as last from progression_history
       where channel_id = $1 and source = $2 group by status`,
      [channelId, source],
    );
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    const last = rows.reduce<Date | null>(
      (m, r) => (r.last && (!m || new Date(r.last) > m) ? new Date(r.last) : m),
      null,
    );
    return {
      source,
      imported: by.imported ?? 0,
      pending: by.pending ?? 0,
      ambiguous: by.ambiguous ?? 0,
      conflict: by.conflict ?? 0,
      lastMeasuredAt: last ? last.toISOString() : null,
    };
  }

  /**
   * Undo an import: its ledger rows go, every account is recomputed from what remains; the history rows stay (back to
   * pending, attached again by the next run). Rewards granted stay.
   */
  async revertImport(channelId: string, source: 'wizebot') {
    return this.db.tx(async (q) => {
      const s = await this.settings(channelId, q);
      const gone = await q.query(
        `delete from progression_ledger where channel_id = $1 and kind = 'import' and key like $2 returning twitch_user_id`,
        [channelId, `import:${source}:%`],
      );
      await q.query(
        `update progression_accounts a set xp = coalesce((select greatest(0, sum(amount)) from progression_ledger l
           where l.channel_id = a.channel_id and l.twitch_user_id = a.twitch_user_id), 0),
           imported_level = null, imported_watch_seconds = 0, imported_messages = 0
         where a.channel_id = $1`,
        [channelId],
      );
      await q.query(
        `update progression_history set status = 'pending', resolved_id = null, resolved_by = null, resolved_at = null,
           updated_at = $3
         where channel_id = $1 and source = $2`,
        [channelId, source, this.now()],
      );
      await this.relevelAll(q, channelId, s.rules);
      return { removed: gone.length };
    });
  }

  // --- Studio: manual XP (authorised, journaled, never negative) ---------------------------------------------------

  /**
   * Add, remove, or set the XP / the level of one viewer: one ledger movement with the reason and who did it (key
   * adjust:<request_id>: a repeated click is the same adjustment). Going below zero is refused.
   */
  async adjust(
    channelId: string,
    req: {
      viewer: string;
      mode: 'add' | 'remove' | 'set_xp' | 'set_level';
      value: number;
      reason: string;
      request_id: string;
    },
    actor: Actor,
  ) {
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `xp:${channelId}:${req.viewer}`,
      ]);
      const s = await this.settings(channelId, q);
      const known = await q.query(
        `select 1 from ${this.dir(channelId)} d where twitch_user_id = $1
         union all select 1 from progression_accounts where channel_id = $2 and twitch_user_id = $1`,
        [req.viewer, channelId],
      );
      if (!known.length) throw new ProgressionError(404, 'unknown_viewer');
      const key = `adjust:${req.request_id}`;
      const xpNow = async () =>
        Number(
          (
            await q.query<{ xp: string }>(
              'select xp from progression_accounts where channel_id = $1 and twitch_user_id = $2',
              [channelId, req.viewer],
            )
          )[0]?.xp ?? 0,
        );
      const result = async (changed: boolean) => {
        const xp = await xpNow();
        return { changed, xp, level: levelForXp(xp, s.rules) };
      };
      const replay = await q.query(
        'select 1 from progression_ledger where channel_id = $1 and key = $2',
        [channelId, key],
      );
      if (replay.length) return result(false);
      const xp = await xpNow();
      const target =
        req.mode === 'add'
          ? xp + req.value
          : req.mode === 'remove'
            ? xp - req.value
            : req.mode === 'set_xp'
              ? req.value
              : xpForLevel(req.value, s.rules);
      if (target < 0) throw new ProgressionError(409, 'below_zero');
      if (target === xp) return result(false);
      await this.move(
        q,
        channelId,
        req.viewer,
        {
          kind: target > xp ? 'grant' : 'correction',
          amount: target - xp,
          key,
          actor: actor.name ?? actor.id,
          reason: `${req.mode} ${req.value} — ${req.reason}`.slice(0, 300),
        },
        s.rules,
      );
      return result(true);
    });
  }

  /** Studio: one viewer's journal (imports, grants, corrections) and the WizeBot rows attached to them. */
  async history(channelId: string, viewerId: string) {
    const movements = await this.db.query<{
      kind: string;
      amount: string;
      actor: string;
      reason: string | null;
      created_at: Date;
    }>(
      `select kind, amount, actor, reason, created_at from progression_ledger
       where channel_id = $1 and twitch_user_id = $2 and kind in ('import', 'grant', 'correction', 'normalization')
       order by id desc limit 50`,
      [channelId, viewerId],
    );
    // Level Up V2: where the level comes from (the audit of the normalization) and the viewer's notification mode.
    const norm = (
      await this.db.query<{
        version: number;
        wizebot_level: number | null;
        previous_level: number;
        previous_xp: string;
        native_xp: string;
        new_level: number;
        new_xp: string;
        applied_at: Date;
        reverted_at: Date | null;
      }>(
        `select version, wizebot_level, previous_level, previous_xp, native_xp, new_level, new_xp, applied_at,
           reverted_at
         from progression_normalizations where channel_id = $1 and twitch_user_id = $2 order by version desc limit 1`,
        [channelId, viewerId],
      )
    )[0];
    const pref = await this.viewerPrefs(channelId, viewerId);
    const sources = await this.db.query<{
      source: string;
      login: string;
      level: number;
      watch_seconds: string;
      messages: string;
      measured_at: Date;
      resolved_by: string | null;
    }>(
      `select source, login, level, watch_seconds, messages, measured_at, resolved_by from progression_history
       where channel_id = $1 and resolved_id = $2`,
      [channelId, viewerId],
    );
    return {
      sound: pref.level_up_sound,
      soundSource: pref.source,
      normalization: norm
        ? {
            version: norm.version,
            wizebotLevel: norm.wizebot_level,
            previousLevel: norm.previous_level,
            previousXp: Number(norm.previous_xp),
            nativeXp: Number(norm.native_xp),
            newLevel: norm.new_level,
            newXp: Number(norm.new_xp),
            appliedAt: new Date(norm.applied_at).toISOString(),
            revertedAt: norm.reverted_at
              ? new Date(norm.reverted_at).toISOString()
              : null,
          }
        : null,
      movements: movements.map((m) => ({
        kind: m.kind,
        amount: Number(m.amount),
        actor: m.actor,
        reason: m.reason,
        at: new Date(m.created_at).toISOString(),
      })),
      sources: sources.map((h) => ({
        source: h.source,
        login: h.login,
        level: h.level,
        watchMinutes: Math.floor(Number(h.watch_seconds) / 60),
        messages: Number(h.messages),
        measuredAt: new Date(h.measured_at).toISOString(),
        attachedBy: h.resolved_by,
      })),
    };
  }

  /** Studio: viewers by pseudo (login or Twitch name, prefix) or id, with their level. */
  async searchViewers(channelId: string, text: string) {
    const q = text.trim().toLowerCase().replace(/^@/, '').slice(0, 25);
    // A pseudo has no LIKE wildcard: anything else is dropped from the prefix (nothing left: no search).
    const prefix = q.replace(/[^a-z0-9_ -]/g, '');
    if (!prefix) return [];
    return this.db.query(
      `select v.twitch_user_id, v.login, v.display_name, coalesce(a.level, 1) as level, coalesce(a.xp, 0)::bigint as xp
       from ${this.dir(channelId)} v left join progression_accounts a on a.channel_id = $1 and a.twitch_user_id = v.twitch_user_id
       where v.twitch_user_id = $2 or v.login like $3 or lower(v.display_name) like $3
       order by (v.login = $2) desc, a.xp desc nulls last, v.login limit 20`,
      [channelId, q, `${prefix.replace(/_/g, '\\_')}%`],
    );
  }

  // --- Level Up V2: notification modes, delivery, normalization (docs/PROGRESSION.md) ------------------------------

  private async chosenPref(q: Queryable, channelId: string, viewerId: string) {
    return (
      (
        await q.query<{
          mode: LevelUpNotifyMode;
          source: 'extension' | 'legacy';
          legacy_updated_at: Date | null;
        }>(
          `select level_up_notify as mode, source, legacy_updated_at from progression_viewer_prefs
           where channel_id = $1 and twitch_user_id = $2`,
          [channelId, viewerId],
        )
      )[0] ?? null
    );
  }

  /** The viewer's sound: on only when they turned it on (here or in the first extension). No choice known: no sound. */
  private async soundOn(q: Queryable, channelId: string, viewerId: string) {
    return (await this.chosenPref(q, channelId, viewerId))?.mode === 'sound';
  }

  /**
   * « Jouer un son lorsque je monte de niveau » (the extension, the viewer's Twitch identity): their choice, imported
   * from the first extension or made here (`source`); none known: off (`chosen`: false). The first extension's boolean
   * `level_up_sfx_opt_in` is returned too (same meaning).
   */
  async viewerPrefs(channelId: string, viewerId: string) {
    const pref = await this.chosenPref(this.db, channelId, viewerId);
    const on = pref?.mode === 'sound';
    return {
      level_up_sound: on,
      level_up_sfx_opt_in: on,
      chosen: pref !== null,
      source: pref?.source ?? null,
    };
  }

  async setViewerPrefs(
    channelId: string,
    viewerId: string,
    req: {
      level_up_sound?: boolean;
      level_up_sfx_opt_in?: boolean;
      level_up_notify?: LevelUpNotifyMode;
    },
  ) {
    const on =
      req.level_up_sound ??
      req.level_up_sfx_opt_in ??
      req.level_up_notify === 'sound';
    // A choice made in the extension: source 'extension' from now on — an import of the old choices never replaces it.
    await this.db.query(
      `insert into progression_viewer_prefs (channel_id, twitch_user_id, level_up_notify, source, updated_at)
       values ($1, $2, $3, 'extension', $4)
       on conflict (channel_id, twitch_user_id) do update set level_up_notify = $3, source = 'extension', updated_at = $4`,
      [channelId, viewerId, on ? 'sound' : 'off', this.now()],
    );
    return this.viewerPrefs(channelId, viewerId);
  }

  /**
   * Studio: the first extension's choices (raptoru.fr's EBS, Supabase `ext_viewer_preferences`, written until the cutover
   * of 20/10/2026), from its export. Priority (docs/LEVEL_UP_V2.md § 8): a choice made in Raptoru 2.0's extension always
   * wins (kept); an imported one is replaced only by a newer row of the same export; the Twitch id is the identity (a row
   * of another channel, or without an id, is reported, never attached by pseudo). `dry_run` (the default): the same work
   * rolled back — the exact numbers, nothing written. Never a sound, never an announcement.
   */
  async importViewerPrefs(
    channelId: string,
    req: {
      dry_run: boolean;
      rows: {
        channel_id: string;
        twitch_user_id: string | null;
        twitch_login: string | null;
        level_up_sfx_opt_in: boolean;
        updated_at: string | null;
      }[];
    },
  ) {
    return this.db.tx(async (q) => {
      await q.query('savepoint prefs_import');
      try {
        const out = await this.runPrefsImport(q, channelId, req.rows);
        await q.query(
          req.dry_run
            ? 'rollback to savepoint prefs_import'
            : 'release savepoint prefs_import',
        );
        return { dry_run: req.dry_run, ...out };
      } catch (e) {
        await q.query('rollback to savepoint prefs_import');
        throw e;
      }
    });
  }

  private async runPrefsImport(
    q: Queryable,
    channelId: string,
    rows: {
      channel_id: string;
      twitch_user_id: string | null;
      twitch_login: string | null;
      level_up_sfx_opt_in: boolean;
      updated_at: string | null;
    }[],
  ) {
    const out = {
      rows: rows.length,
      sound_on: 0,
      sound_off: 0,
      unchanged: 0,
      kept_extension_choice: 0,
      other_channel: 0,
      duplicates: 0,
      no_identity: [] as string[],
    };
    // One row per Twitch id: the newest (a pseudo is never an identity).
    const byId = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (r.channel_id !== channelId) {
        out.other_channel++;
        continue;
      }
      if (!r.twitch_user_id) {
        out.no_identity.push(r.twitch_login ?? '?');
        continue;
      }
      const prev = byId.get(r.twitch_user_id);
      if (prev) {
        out.duplicates++;
        if ((r.updated_at ?? '') < (prev.updated_at ?? '')) continue;
      }
      byId.set(r.twitch_user_id, r);
    }
    const now = this.now();
    for (const [id, r] of byId) {
      const cur = (
        await q.query<{
          mode: string;
          source: string;
          legacy_updated_at: Date | null;
        }>(
          `select level_up_notify as mode, source, legacy_updated_at from progression_viewer_prefs
           where channel_id = $1 and twitch_user_id = $2 for update`,
          [channelId, id],
        )
      )[0];
      if (cur?.source === 'extension') {
        out.kept_extension_choice++;
        continue;
      }
      const mode = r.level_up_sfx_opt_in ? 'sound' : 'off';
      const at = r.updated_at ? new Date(r.updated_at) : null;
      if (
        cur &&
        (cur.mode === mode ||
          (cur.legacy_updated_at && at && cur.legacy_updated_at >= at))
      ) {
        out.unchanged++;
        continue;
      }
      await q.query(
        `insert into progression_viewer_prefs (channel_id, twitch_user_id, level_up_notify, source, legacy_updated_at,
           updated_at)
         values ($1, $2, $3, 'legacy', $4, $5)
         on conflict (channel_id, twitch_user_id) do update set level_up_notify = $3, source = 'legacy',
           legacy_updated_at = $4, updated_at = $5`,
        [channelId, id, mode, at, now],
      );
      if (mode === 'sound') out.sound_on++;
      else out.sound_off++;
    }
    return { ...out, no_identity: out.no_identity.slice(0, 50) };
  }

  /** Studio: the latest level-ups and what became of their notification. */
  /**
   * The directory's pseudos from Twitch, by the STABLE id (Helix Get Users, 100 ids per call): every progression account
   * checked, the current login and display name written when missing or changed (a rename). Never an attachment, never
   * an XP, level, badge or history change; an id Twitch does not know (deleted, suspended) is left as it is and counted.
   */
  async refreshNames(channelId: string): Promise<NamesRefresh> {
    // The Lab's viewers are fictional (lab_viewers): nothing to ask Twitch.
    if (this.o.lab || !this.userLookup)
      throw new ProgressionError(503, 'twitch_unavailable');
    const ids = (
      await this.db.query<{ id: string }>(
        'select twitch_user_id as id from progression_accounts where channel_id = $1 order by twitch_user_id',
        [channelId],
      )
    ).map((r) => r.id);
    let added = 0;
    let updated = 0;
    let unresolved = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const found = new Map(
        (await this.userLookup(chunk))
          .filter(
            (u) =>
              /^[a-z0-9_]{1,25}$/.test(u.login ?? '') &&
              (u.display_name ?? '').trim(),
          )
          .map((u) => [u.id, u]),
      );
      unresolved += chunk.filter((id) => !found.has(id)).length;
      if (!found.size) continue;
      const users = [...found.values()];
      const rows = await this.db.query<{ inserted: boolean }>(
        `insert into viewers (twitch_user_id, login, display_name)
         select * from unnest($1::text[], $2::text[], $3::text[])
         on conflict (twitch_user_id) do update set login = excluded.login, display_name = excluded.display_name,
           updated_at = now()
         where viewers.login is distinct from excluded.login or viewers.display_name is distinct from excluded.display_name
         returning (xmax = 0) as inserted`,
        [
          users.map((u) => u.id),
          users.map((u) => u.login!),
          users.map((u) => u.display_name!.trim().slice(0, 64)),
        ],
      );
      const fresh = rows.filter((r) => r.inserted).length;
      added += fresh;
      updated += rows.length - fresh;
    }
    this.lastNames = {
      at: this.now().toISOString(),
      checked: ids.length,
      added,
      updated,
      unresolved,
    };
    return this.lastNames;
  }

  /** The last pseudo refresh (null before the first one since this Core started). */
  namesStatus() {
    return this.lastNames;
  }

  /**
   * Studio › « Viewers avec son activé »: the viewers who TURNED ON the Level Up sound themselves (the extension now,
   * or the first extension's imported choice) — never someone who made no choice. Read-only: the choice stays theirs.
   */
  async soundViewers(channelId: string) {
    const rows = await this.db.query<{
      twitch_user_id: string;
      name: string | null;
      login: string | null;
      source: 'extension' | 'legacy';
      changed_at: Date;
    }>(
      `select p.twitch_user_id, coalesce(d.display_name, d.login) as name, d.login, p.source,
         case when p.source = 'legacy' then coalesce(p.legacy_updated_at, p.updated_at) else p.updated_at end
           as changed_at
       from progression_viewer_prefs p
       left join ${this.dir(channelId)} d on d.twitch_user_id = p.twitch_user_id
       where p.channel_id = $1 and p.level_up_notify = 'sound'
       order by changed_at desc, p.twitch_user_id`,
      [channelId],
    );
    return {
      count: rows.length,
      viewers: rows.map((r) => ({
        twitchUserId: r.twitch_user_id,
        displayName: r.name ?? r.twitch_user_id,
        login: r.login,
        source: r.source,
        changedAt: new Date(r.changed_at).toISOString(),
      })),
    };
  }

  async levelUps(channelId: string, limit = 50) {
    const rows = await this.db.query<{
      id: string;
      twitch_user_id: string;
      display_name: string;
      from_level: number;
      to_level: number;
      notify_mode: string;
      status: string;
      reason: string | null;
      sound: boolean;
      created_at: Date;
      delivered_at: Date | null;
      chat_status: string;
      chat_reason: string | null;
      chat_at: Date | null;
    }>(
      `select id, twitch_user_id, display_name, from_level, to_level, notify_mode, status, reason, sound, created_at,
         delivered_at, chat_status, chat_reason, chat_at
       from progression_level_events where channel_id = $1 order by id desc limit $2`,
      [channelId, Math.min(limit, 200)],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      twitchUserId: r.twitch_user_id,
      displayName: r.display_name,
      fromLevel: r.from_level,
      toLevel: r.to_level,
      mode: r.notify_mode,
      status: r.status,
      reason: r.reason,
      sound: r.sound,
      at: new Date(r.created_at).toISOString(),
      deliveredAt: r.delivered_at
        ? new Date(r.delivered_at).toISOString()
        : null,
      chat: {
        status: r.chat_status,
        reason: r.chat_reason,
        at: r.chat_at ? new Date(r.chat_at).toISOString() : null,
      },
    }));
  }

  /**
   * Studio's invisible OBS « Level Up » source asks for the sounds to play (at most 5 at a time):
   * - only for a viewer whose sound is on NOW (they may have turned it off since the level-up);
   * - too old (level_up_max_age_s) → expired, never played late;
   * - several waiting for one viewer → one sound (the others « merged »);
   * - at most one sound per level_up_sound_cooldown_s for the whole channel: a level-up inside it plays nothing;
   * - delivered at most once (a page that crashed never replays an old level-up).
   */
  async claimLevelUps(channelId: string, consumer: string) {
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `levelups:${channelId}`,
      ]);
      const { rules } = await this.settings(channelId, q);
      const now = this.now();
      const rows = await q.query<{
        id: string;
        twitch_user_id: string;
        display_name: string;
        from_level: number;
        to_level: number;
        created_at: Date;
      }>(
        `select id, twitch_user_id, display_name, from_level, to_level, created_at
         from progression_level_events where channel_id = $1 and status = 'pending' order by id limit 200`,
        [channelId],
      );
      const settle = (ids: string[], status: string, reason: string) =>
        ids.length
          ? q.query(
              `update progression_level_events set status = $3, reason = $4 where channel_id = $1 and id = any($2::bigint[])`,
              [channelId, ids, status, reason],
            )
          : null;
      if (!rules.level_up_sound) {
        await settle(
          rows.map((r) => r.id),
          'skipped',
          'sound_off',
        );
        return { notices: [] };
      }
      const maxAge = rules.level_up_max_age_s * 1000;
      const fresh = rows.filter(
        (r) => now.getTime() - new Date(r.created_at).getTime() <= maxAge,
      );
      await settle(
        rows.filter((r) => !fresh.includes(r)).map((r) => r.id),
        'expired',
        'too_old',
      );
      const latest = new Map<string, (typeof fresh)[number]>();
      for (const r of fresh) latest.set(r.twitch_user_id, r);
      await settle(
        fresh
          .filter((r) => latest.get(r.twitch_user_id) !== r)
          .map((r) => r.id),
        'merged',
        'newer_level_up',
      );
      const last = (
        await q.query<{ at: Date | null }>(
          `select max(delivered_at) as at from progression_level_events where channel_id = $1 and sound`,
          [channelId],
        )
      )[0]?.at;
      let lastSound = last ? new Date(last).getTime() : null;
      const notices = [];
      for (const r of [...latest.values()].slice(0, 5)) {
        if (!(await this.soundOn(q, channelId, r.twitch_user_id))) {
          await settle([r.id], 'skipped', 'viewer_no_sound');
          continue;
        }
        if (
          lastSound !== null &&
          now.getTime() - lastSound < rules.level_up_sound_cooldown_s * 1000
        ) {
          await settle([r.id], 'skipped', 'sound_cooldown');
          continue;
        }
        lastSound = now.getTime();
        await q.query(
          `update progression_level_events set status = 'delivered', sound = true, consumer = $3, delivered_at = $4,
             reason = null
           where channel_id = $1 and id = $2`,
          [channelId, r.id, consumer, now],
        );
        notices.push({
          id: Number(r.id),
          twitchUserId: r.twitch_user_id,
          displayName: r.display_name,
          level: r.to_level,
          fromLevel: r.from_level,
          sound: true,
        });
      }
      return { notices };
    });
  }

  private async levelV2Data(q: Queryable, channelId: string) {
    const history = (
      await q.query<{ level: number }>(
        `select level from progression_history where channel_id = $1 and source = 'wizebot'`,
        [channelId],
      )
    ).map((r) => r.level);
    const accounts = await q.query<{
      twitch_user_id: string;
      xp: string;
      level: number;
      imported_level: number | null;
      native: string | null;
    }>(
      `select a.twitch_user_id, a.xp, a.level, a.imported_level,
         (select sum(l.amount) from progression_ledger l where l.channel_id = a.channel_id
            and l.twitch_user_id = a.twitch_user_id and l.kind not in ('import', 'normalization')) as native
       from progression_accounts a where a.channel_id = $1 order by a.twitch_user_id`,
      [channelId],
    );
    return {
      history,
      maxLevel: history.length ? Math.max(...history) : 1,
      accounts,
    };
  }

  /**
   * Level Up V2, read-only: the real distribution of the WizeBot levels and, for the proportional (exponent 1), the
   * square-root (0.5) and the chosen (0.7) compressions, what every history and every attached account would become.
   */
  async levelV2Status(channelId: string) {
    const { rules } = await this.settings(channelId);
    const d = await this.levelV2Data(this.db, channelId);
    const buckets = (levels: number[]) => {
      const out: Record<string, number> = {};
      for (const [a, b] of [
        [1, 10],
        [11, 20],
        [21, 30],
        [31, 40],
        [41, 50],
        [51, 1_000_000],
      ] as const)
        out[b > 1000 ? `${a}+` : `${a}-${b}`] = levels.filter(
          (x) => x >= a && x <= b,
        ).length;
      return out;
    };
    const attached = d.accounts
      .map((a) => a.imported_level)
      .filter((x): x is number => x !== null);
    const methods = Object.fromEntries(
      (
        [
          ['proportional', 1],
          ['sqrt', 0.5],
          ['chosen', LEVEL_V2.exponent],
        ] as const
      ).map(([name, exponent]) => {
        const n = {
          exponent,
          max_level: d.maxLevel,
          target_max: LEVEL_V2.targetMax,
        };
        const all = d.history.map((L) => normalizeWizebotLevel(L, n));
        return [
          name,
          {
            exponent,
            all: buckets(all),
            attached: buckets(attached.map((L) => normalizeWizebotLevel(L, n))),
            droppedToLevel1: d.history.filter(
              (L) => L > 1 && normalizeWizebotLevel(L, n) === 1,
            ).length,
            distinctLevels: new Set(all).size,
          },
        ];
      }),
    );
    const badges = await this.db.query<{
      reward_id: string;
      label: string;
      unlock_level: number;
      active: boolean;
      status: string;
      image_id: string | null;
      owners: string;
    }>(
      `select r.reward_id, r.label, r.unlock_level, r.active, r.status, r.image_id,
         (select count(*) from progression_grants g where g.channel_id = r.channel_id and g.reward_id = r.reward_id
            and g.revoked_at is null) as owners
       from progression_rewards r
       where r.channel_id = $1 and r.kind = 'badge' and r.unlock_level is not null order by r.unlock_level, r.reward_id`,
      [channelId],
    );
    const levels = await this.levelBuckets(this.db, channelId);
    return {
      levelModel: rules.level_model,
      normalization: rules.wizebot_normalization,
      levels,
      levelBadges: badges.map((b) => ({
        id: b.reward_id,
        label: b.label,
        level: b.unlock_level,
        active: b.active,
        status: b.status,
        image: b.image_id ? `/v1/cosmetics/images/${b.image_id}` : null,
        owners: Number(b.owners),
      })),
      xpPerLevel: LEVEL_V2.xpPerLevel,
      historyRows: d.history.length,
      maxWizebotLevel: d.maxLevel,
      distinctWizebotLevels: new Set(d.history).size,
      wizebot: buckets(d.history),
      accounts: d.accounts.length,
      attachedAccounts: attached.length,
      nativeXpAccounts: d.accounts.filter((a) => Number(a.native ?? 0) !== 0)
        .length,
      methods,
    };
  }

  /**
   * Level Up V2 — ONCE, with a typed confirmation: every level becomes « 1 000 XP per level ».
   * - an attached WizeBot history starts at its normalized level (exponent 0.7, max frozen = the highest WizeBot level
   *   known now), PLUS every XP earned or adjusted since (never lost): XP = 1 000 × (N − 1) + native XP;
   * - an account without WizeBot history keeps its XP (its level now reads 1 per 1 000 XP);
   * - each change: one « normalization » ledger movement (no period, no notification) and one audit row with the
   *   level and XP before; the parameters are frozen in the rules for every history attached later;
   * - a second activation is refused (never lowered twice).
   */
  async activateLevelV2(channelId: string, actor: Actor) {
    return this.db.tx((q) => this.runActivateLevelV2(q, channelId, actor));
  }

  /**
   * Studio's « Simuler » : the very same activation in a savepoint rolled back — the exact numbers (accounts changed,
   * levels after, badges and titles that would be given), nothing written, nothing announced.
   */
  async simulateLevelV2(channelId: string, actor: Actor) {
    return this.db.tx(async (q) => {
      await q.query('savepoint level_v2_simulation');
      try {
        return {
          dry_run: true,
          ...(await this.runActivateLevelV2(q, channelId, actor)),
        };
      } finally {
        await q.query('rollback to savepoint level_v2_simulation');
      }
    });
  }

  private async levelBuckets(q: Queryable, channelId: string) {
    const rows = await q.query<{ level: number }>(
      'select level from progression_accounts where channel_id = $1',
      [channelId],
    );
    const out: Record<string, number> = {};
    for (const [a, b] of [
      [1, 1],
      [2, 5],
      [6, 9],
      [10, 19],
      [20, 29],
      [30, 39],
      [40, 49],
      [50, 1_000_000],
    ] as const)
      out[b > 1000 ? `${a}+` : a === b ? `${a}` : `${a}-${b}`] = rows.filter(
        (r) => r.level >= a && r.level <= b,
      ).length;
    return {
      buckets: out,
      max: rows.reduce((m, r) => Math.max(m, r.level), 1),
    };
  }

  /** Every level reward (the badges every 10 levels, a level title) and how many viewers own it now. */
  private async levelRewardOwners(q: Queryable, channelId: string) {
    return (
      await q.query<{
        reward_id: string;
        kind: string;
        label: string;
        unlock_level: number;
        owners: string;
      }>(
        `select r.reward_id, r.kind, r.label, r.unlock_level,
           (select count(*) from progression_grants g where g.channel_id = r.channel_id and g.reward_id = r.reward_id
              and g.revoked_at is null) as owners
         from progression_rewards r
         where r.channel_id = $1 and r.unlock_level is not null and r.active and r.status <> 'draft'
         order by r.unlock_level, r.reward_id`,
        [channelId],
      )
    ).map((r) => ({
      id: r.reward_id,
      kind: r.kind,
      label: r.label,
      level: r.unlock_level,
      owners: Number(r.owners),
    }));
  }

  private async grantCount(q: Queryable, channelId: string) {
    return Number(
      (
        await q.query<{ n: string }>(
          `select count(*) as n from progression_grants where channel_id = $1 and source = 'level'`,
          [channelId],
        )
      )[0]?.n ?? 0,
    );
  }

  private async runActivateLevelV2(
    q: Queryable,
    channelId: string,
    actor: Actor,
  ) {
    {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `level-v2:${channelId}`,
      ]);
      const before = await this.levelBuckets(q, channelId);
      const grantsBefore = await this.grantCount(q, channelId);
      const rewardsBefore = await this.levelRewardOwners(q, channelId);
      const s = await this.settings(channelId, q);
      if (s.rules.wizebot_normalization)
        throw new ProgressionError(409, 'already_applied');
      const d = await this.levelV2Data(q, channelId);
      const now = this.now();
      const rules: ProgressionRules = {
        ...s.rules,
        curve_base: LEVEL_V2.xpPerLevel,
        curve_exponent: 1,
        ...LEVEL_V2.rates,
        level_model: 'fixed',
        wizebot_normalization: {
          version: LEVEL_V2.version,
          exponent: LEVEL_V2.exponent,
          max_level: d.maxLevel,
          target_max: LEVEL_V2.targetMax,
          applied_at: now.toISOString(),
          previous_curve: {
            curve_base: s.rules.curve_base,
            curve_exponent: s.rules.curve_exponent,
          },
          previous_rates: {
            xp_per_minute: s.rules.xp_per_minute,
            message_xp: s.rules.message_xp,
            message_cooldown_s: s.rules.message_cooldown_s,
          },
        },
      };
      let changed = 0;
      const changes: {
        id: string;
        wizebot: number | null;
        before: number;
        after: number;
        xpBefore: number;
        xpAfter: number;
      }[] = [];
      for (const a of d.accounts) {
        const xp = Number(a.xp);
        const native = Number(a.native ?? 0);
        const wizebot =
          a.imported_level === null
            ? null
            : normalizeWizebotLevel(
                a.imported_level,
                rules.wizebot_normalization!,
              );
        const newXp =
          wizebot === null
            ? xp
            : Math.max(0, xpForLevel(wizebot, rules) + native);
        const newLevel = levelForXp(newXp, rules);
        changes.push({
          id: a.twitch_user_id,
          wizebot: a.imported_level,
          before: a.level,
          after: newLevel,
          xpBefore: xp,
          xpAfter: newXp,
        });
        await q.query(
          `insert into progression_normalizations (channel_id, version, twitch_user_id, wizebot_level, previous_level,
             previous_xp, native_xp, new_level, new_xp, applied_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (channel_id, version, twitch_user_id) do update set wizebot_level = excluded.wizebot_level,
             previous_level = excluded.previous_level, previous_xp = excluded.previous_xp,
             native_xp = excluded.native_xp, new_level = excluded.new_level, new_xp = excluded.new_xp,
             applied_at = excluded.applied_at, reverted_at = null`,
          [
            channelId,
            LEVEL_V2.version,
            a.twitch_user_id,
            a.imported_level,
            a.level,
            xp,
            native,
            newLevel,
            newXp,
            now,
          ],
        );
        if (newXp !== xp) {
          changed++;
          await this.move(
            q,
            channelId,
            a.twitch_user_id,
            {
              kind: 'normalization',
              amount: newXp - xp,
              key: `normalize:v${LEVEL_V2.version}:${a.twitch_user_id}`,
              actor: actor.name ?? actor.id,
              reason: `Level Up V2 : niveau WizeBot ${a.imported_level} → ${wizebot}`,
            },
            rules,
          );
        }
      }
      await q.query(
        `update progression_settings set rules = $2, updated_at = $3 where channel_id = $1`,
        [channelId, JSON.stringify(rules), now],
      );
      // Every account reads its level on the new scale (the ones without a movement too); the level rewards (the
      // badges every 10 levels) are given to whoever already reached them — never announced, never twice.
      await this.relevelAll(q, channelId, rules);
      const after = await this.levelBuckets(q, channelId);
      const rewardsAfter = await this.levelRewardOwners(q, channelId);
      // The biggest individual changes (in levels), with their names: what Antoni checks before saying yes.
      const big = changes
        .filter((c) => c.after !== c.before)
        .sort(
          (x, y) =>
            Math.abs(y.after - y.before) - Math.abs(x.after - x.before) ||
            y.before - x.before,
        )
        .slice(0, 25);
      const names = new Map(
        (
          await q.query<{ id: string; name: string | null }>(
            `select twitch_user_id as id, coalesce(display_name, login) as name from ${this.dir(channelId)} d
             where twitch_user_id = any($1::text[])`,
            [big.map((c) => c.id)],
          )
        ).map((r) => [r.id, r.name]),
      );
      const waiting = await this.waiting(channelId, '', q);
      return {
        applied: true,
        version: LEVEL_V2.version,
        accounts: d.accounts.length,
        attachedAccounts: changes.filter((c) => c.wizebot !== null).length,
        changed,
        levelChanged: changes.filter((c) => c.after !== c.before).length,
        maxWizebotLevel: d.maxLevel,
        rates: LEVEL_V2.rates,
        levelsBefore: before,
        levelsAfter: after,
        variations: big.map((c) => ({ ...c, name: names.get(c.id) ?? c.id })),
        levelRewardsGiven: (await this.grantCount(q, channelId)) - grantsBefore,
        levelRewards: rewardsAfter.map((r) => ({
          ...r,
          ownersBefore: rewardsBefore.find((b) => b.id === r.id)?.owners ?? 0,
        })),
        // The WizeBot histories not attached to a certain viewer: never given to a guessed one. Attached later (the
        // viewer seen again, a sign-in on raptoru.fr, Studio's manual attachment), they get the same frozen levels.
        unresolved: {
          ...(await this.importStatus(channelId, 'wizebot', q)),
          sample: waiting.slice(0, 50).map((w) => ({
            login: w.login,
            status: w.status,
            level: w.level,
            candidates: w.candidates.length,
          })),
        },
      };
    }
  }

  /**
   * Undo Level Up V2 (its own audit kept, marked reverted): the normalization movements go, every XP is recomputed
   * from the ledger, the previous curve comes back. Refused once a history was attached after the activation (its XP
   * was counted on the new scale).
   */
  /**
   * Studio's « Envoyer le test dans le chat » (Level Up V2, a typed confirmation): ONE real Twitch announcement
   * « [TEST] … » made with the channel's own text and colour, on the same outbox as a real one (LeCroupier_ sends it;
   * « Sortie chat réelle » and the bot's rate limit apply). Nothing of the progression is written: no XP, no level, no
   * level-up event, no reward, no sound. Refused when the chat output is off (nothing would be sent).
   */
  async testLevelUpChat(
    channelId: string,
    pseudo: string,
    level: number,
    /** A title of the catalogue (active, published), to see it in the line; never free text. */
    titleId: string | null = null,
  ) {
    return this.db.tx(async (q) => {
      const { rules } = await this.settings(channelId, q);
      const title = titleId
        ? ((
            await q.query<{ label: string }>(
              `select label from progression_rewards where channel_id = $1 and reward_id = $2 and kind = 'title'
                 and active and status <> 'draft'`,
              [channelId, titleId],
            )
          )[0]?.label.slice(0, 40) ?? null)
        : null;
      if (titleId && !title) throw new ProgressionError(404, 'title_not_found');
      const output = (
        await q.query<{ chat_output: boolean }>(
          'select chat_output from cmd_channels where channel_id = $1',
          [channelId],
        )
      )[0]?.chat_output;
      if (!output) throw new ProgressionError(409, 'chat_output_off');
      const now = this.now();
      const text = `[TEST] ${rules.level_up_chat_text.replace(
        '{liste}',
        announceEntry(pseudo, title, level),
      )}`.slice(0, ANNOUNCE_MAX_CHARS);
      const written = await insertAnnouncement(q, {
        channelId,
        now,
        origin: 'module:level_up',
        drafts: [
          {
            idempotencyKey: `levelup-test:${channelId}:${now.getTime()}`,
            mode: 'announce',
            color: rules.level_up_chat_color,
            text,
          },
        ],
      });
      if (!written) throw new ProgressionError(409, 'outbox_refused');
      return { sent: true, text };
    });
  }

  async revertLevelV2(channelId: string) {
    return this.db.tx(async (q) => {
      const s = await this.settings(channelId, q);
      const n = s.rules.wizebot_normalization;
      if (!n) throw new ProgressionError(409, 'not_applied');
      const since = await q.query(
        `select 1 from progression_ledger where channel_id = $1 and kind = 'import' and created_at > $2 limit 1`,
        [channelId, n.applied_at],
      );
      if (since.length)
        throw new ProgressionError(409, 'imports_since_activation');
      const gone = await q.query(
        `delete from progression_ledger where channel_id = $1 and kind = 'normalization' and key like $2 returning 1`,
        [channelId, `normalize:v${n.version}:%`],
      );
      await q.query(
        `update progression_accounts a set xp = coalesce((select greatest(0, sum(amount)) from progression_ledger l
           where l.channel_id = a.channel_id and l.twitch_user_id = a.twitch_user_id), 0)
         where a.channel_id = $1`,
        [channelId],
      );
      const rules: ProgressionRules = {
        ...s.rules,
        ...n.previous_curve,
        ...(n.previous_rates ?? {}),
        level_model: 'curve',
        wizebot_normalization: null,
      };
      await q.query(
        `update progression_settings set rules = $2, updated_at = $3 where channel_id = $1`,
        [channelId, JSON.stringify(rules), this.now()],
      );
      await q.query(
        `update progression_normalizations set reverted_at = $3 where channel_id = $1 and version = $2 and reverted_at is null`,
        [channelId, n.version, this.now()],
      );
      await this.relevelAll(q, channelId, rules);
      return { reverted: true, movements: gone.length };
    });
  }

  // --- public reads (raptoru.fr) ---------------------------------------------------------------------------------------

  /**
   * The public rankings, by XP, presence time or messages:
   * - `all`: each total = WizeBot's imported history + what the Core counted since (the level is cumulative);
   * - `week` / `month`: what was EARNED in the current calendar week (Monday 00:00) or month (the 1st 00:00), Europe/Paris
   *   — XP from presence and chat, presence time, messages — from the Core's own events only (WizeBot's history has no
   *   dates: never spread over periods). `since`: the first event the Core counted (null: none yet).
   * Presence time is the time seen in Twitch's chatters list, not a proof of watching.
   */
  async leaderboard(
    channelId: string,
    limit = 100,
    by: 'xp' | 'watch' | 'messages' = 'xp',
    period: 'all' | 'week' | 'month' = 'all',
  ) {
    const s = await this.settings(channelId);
    // Up to 2 000 rows: the whole ranking (every attached viewer can find themselves on raptoru.fr).
    const lim = Math.min(limit, 2000);
    // The equipped title, only while owned (not revoked) and active: what the rankings show next to the name.
    const titleJoins = `left join progression_equipped e on e.channel_id = a.channel_id and e.twitch_user_id = a.twitch_user_id
       left join progression_grants g on g.channel_id = a.channel_id and g.twitch_user_id = a.twitch_user_id
         and g.reward_id = e.title_id and g.revoked_at is null
       left join progression_rewards r on r.channel_id = a.channel_id and r.reward_id = g.reward_id and r.active
         and r.status <> 'draft'`;
    // No pseudo in the directory (an id Twitch no longer knows): the WizeBot pseudo of the history attached to that
    // EXACT id (WizeBot's own user id), never a pseudo matched by resemblance; none: the id, as it is.
    const historyJoin = (
      id: string,
    ) => `left join progression_history h on h.channel_id = $1 and h.source = 'wizebot'
         and h.status = 'imported' and h.resolved_by = 'id' and h.resolved_id = ${id} and v.twitch_user_id is null`;
    type Row = {
      twitch_user_id: string;
      login: string | null;
      display_name: string | null;
      history_login: string | null;
      xp: string | number;
      level: number;
      watch_seconds: string | number;
      messages: string | number;
      title_id: string | null;
      title_label: string | null;
      title_rarity: string | null;
      title_style: Record<string, unknown> | null;
    };
    let rows: Row[];
    let bounds: { start: string; end: string } | null = null;
    if (period === 'all') {
      const total = {
        xp: 'a.xp',
        watch: '(a.watch_seconds + a.imported_watch_seconds)',
        messages: '(a.messages + a.imported_messages)',
      }[by];
      rows = await this.db.query<Row>(
        `select a.twitch_user_id, v.login, v.display_name, h.login as history_login, a.xp, a.level,
           a.watch_seconds + a.imported_watch_seconds as watch_seconds, a.messages + a.imported_messages as messages,
           r.reward_id as title_id, r.label as title_label, r.rarity as title_rarity, r.style as title_style
         from progression_accounts a
         left join ${this.dir(channelId)} v using (twitch_user_id)
         ${historyJoin('a.twitch_user_id')}
         ${titleJoins}
         where a.channel_id = $1 and ${total} > 0
         order by ${total} desc, a.imported_level desc nulls last, a.twitch_user_id limit $2`,
        [channelId, lim],
      );
    } else {
      const b = (
        await this.db.query<{ start: string; s: Date; e: Date }>(
          `select d::text as start, (d::timestamp at time zone 'Europe/Paris') as s,
             ((d + ('1 ' || $1)::interval)::timestamp at time zone 'Europe/Paris') as e
           from (select date_trunc($1, $2::timestamptz at time zone 'Europe/Paris')::date as d) x`,
          [period, this.now()],
        )
      )[0]!;
      bounds = {
        start: new Date(b.s).toISOString(),
        end: new Date(b.e).toISOString(),
      };
      const metric = {
        xp: 'p.xp',
        watch: 'p.watch_seconds',
        messages: 'p.messages',
      }[by];
      rows = await this.db.query<Row>(
        `select p.twitch_user_id, v.login, v.display_name, h.login as history_login, p.xp, coalesce(a.level, 1) as level,
           p.watch_seconds,
           p.messages, r.reward_id as title_id, r.label as title_label, r.rarity as title_rarity,
           r.style as title_style
         from progression_period_stats p
         left join progression_accounts a on a.channel_id = p.channel_id and a.twitch_user_id = p.twitch_user_id
         left join ${this.dir(channelId)} v on v.twitch_user_id = p.twitch_user_id
         ${historyJoin('p.twitch_user_id')}
         ${titleJoins}
         where p.channel_id = $1 and p.period = $3 and p.period_start = $4::date and ${metric} > 0
         order by ${metric} desc, p.twitch_user_id limit $2`,
        [channelId, lim, period, b.start],
      );
    }
    const first = (
      await this.db.query<{ at: Date | null }>(
        `select min(created_at) as at from progression_ledger where channel_id = $1 and kind in ('presence', 'message')`,
        [channelId],
      )
    )[0]?.at;
    // The equipped badges of the returned rows, in ONE grouped query (never one per viewer), with the profile's rule:
    // owned and not revoked, active, published, kind badge; in the viewer's chosen order. Additive field.
    const badges = new Map<
      string,
      { id: string; label: string; rarity: string; image: string | null }[]
    >();
    if (rows.length) {
      const eq = await this.db.query<{
        twitch_user_id: string;
        reward_id: string;
        label: string;
        rarity: string;
        image_id: string | null;
      }>(
        `select e.twitch_user_id, r.reward_id, r.label, r.rarity, r.image_id
         from progression_equipped e
         cross join lateral unnest(e.badge_ids) with ordinality as b(reward_id, ord)
         join progression_rewards r on r.channel_id = e.channel_id and r.reward_id = b.reward_id
           and r.kind = 'badge' and r.active and r.status <> 'draft'
         where e.channel_id = $1 and e.twitch_user_id = any($2::text[])
           and exists (select 1 from progression_grants g where g.channel_id = e.channel_id
             and g.twitch_user_id = e.twitch_user_id and g.reward_id = b.reward_id and g.revoked_at is null)
         order by e.twitch_user_id, b.ord`,
        [channelId, rows.map((r) => r.twitch_user_id)],
      );
      for (const b of eq) {
        const list = badges.get(b.twitch_user_id) ?? [];
        list.push({
          id: b.reward_id,
          label: b.label,
          rarity: b.rarity,
          image: b.image_id ? `/v1/cosmetics/images/${b.image_id}` : null,
        });
        badges.set(b.twitch_user_id, list);
      }
    }
    // The equipped frame and banner of the returned rows, in ONE grouped query, with the same rule (lot 3).
    const looks = new Map<
      string,
      Partial<
        Record<
          'frame' | 'banner',
          { id: string; label: string; rarity: string; image: string | null }
        >
      >
    >();
    if (rows.length) {
      const eq = await this.db.query<{
        twitch_user_id: string;
        kind: 'frame' | 'banner';
        reward_id: string;
        label: string;
        rarity: string;
        image_id: string | null;
      }>(
        `select e.twitch_user_id, r.kind, r.reward_id, r.label, r.rarity, r.image_id
         from progression_equipped e
         join progression_rewards r on r.channel_id = e.channel_id and r.active and r.status <> 'draft'
           and ((r.kind = 'frame' and r.reward_id = e.frame_id) or (r.kind = 'banner' and r.reward_id = e.banner_id))
         where e.channel_id = $1 and e.twitch_user_id = any($2::text[])
           and exists (select 1 from progression_grants g where g.channel_id = e.channel_id
             and g.twitch_user_id = e.twitch_user_id and g.reward_id = r.reward_id and g.revoked_at is null)`,
        [channelId, rows.map((r) => r.twitch_user_id)],
      );
      for (const l of eq) {
        const look = looks.get(l.twitch_user_id) ?? {};
        look[l.kind] = {
          id: l.reward_id,
          label: l.label,
          rarity: l.rarity,
          image: l.image_id ? `/v1/cosmetics/images/${l.image_id}` : null,
        };
        looks.set(l.twitch_user_id, look);
      }
    }
    return {
      enabled: s.enabled,
      by,
      period,
      ...(bounds ?? {}),
      since: first ? new Date(first).toISOString() : null,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        twitchUserId: r.twitch_user_id,
        login: r.login,
        displayName:
          r.display_name ?? r.login ?? r.history_login ?? r.twitch_user_id,
        level: r.level,
        // period: XP earned in it; all: the total XP.
        xp: Number(r.xp),
        watchMinutes: Math.floor(Number(r.watch_seconds) / 60),
        messages: Number(r.messages),
        title: r.title_id
          ? {
              id: r.title_id,
              label: r.title_label,
              rarity: r.title_rarity,
              style: r.title_style ?? {},
            }
          : null,
        badges: badges.get(r.twitch_user_id) ?? [],
        frame: looks.get(r.twitch_user_id)?.frame ?? null,
        banner: looks.get(r.twitch_user_id)?.banner ?? null,
      })),
    };
  }

  async viewer(channelId: string, viewerId: string) {
    const s = await this.settings(channelId);
    const acc = (
      await this.db.query<AccountRow & { rank: string | number }>(
        // Accounts without XP sort last: the rank of those with XP is unchanged; theirs is null.
        `select * from (select a.*, case when a.xp > 0 then row_number() over (order by a.xp desc, a.imported_level desc nulls last, a.twitch_user_id) end
           as rank from progression_accounts a where a.channel_id = $1) x where twitch_user_id = $2`,
        [channelId, viewerId],
      )
    )[0];
    const inventory = await this.db.query<{
      reward_id: string;
      kind: string;
      label: string;
      description: string;
      rarity: string;
      category: string;
      source: string;
      reference: string | null;
      granted_at: Date;
      status: string;
      style: Record<string, unknown> | null;
      image_id: string | null;
    }>(
      `select g.reward_id, r.kind, r.label, r.description, r.rarity, r.category, g.source, g.reference, g.granted_at,
         r.status, r.style, r.image_id
       from progression_grants g join progression_rewards r using (channel_id, reward_id)
       where g.channel_id = $1 and g.twitch_user_id = $2 and g.revoked_at is null and r.active and r.status <> 'draft'
       order by r.kind, r.sort, g.granted_at`,
      [channelId, viewerId],
    );
    const eq = (
      await this.db.query<{
        title_id: string | null;
        badge_ids: string[];
        frame_id: string | null;
        banner_id: string | null;
      }>(
        'select title_id, badge_ids, frame_id, banner_id from progression_equipped where channel_id = $1 and twitch_user_id = $2',
        [channelId, viewerId],
      )
    )[0];
    const owned = new Set(inventory.map((i) => i.reward_id));
    const xp = Number(acc?.xp ?? 0);
    const level = acc?.level ?? 1;
    // This calendar week and month (Europe/Paris): what the Core counted (no WizeBot history in a period).
    const current = await this.db.query<{
      period: 'week' | 'month';
      xp: string;
      watch_seconds: string;
      messages: string;
    }>(
      `select period, xp, watch_seconds, messages from progression_period_stats
       where channel_id = $1 and twitch_user_id = $2
         and period_start = date_trunc(period, $3::timestamptz at time zone 'Europe/Paris')::date`,
      [channelId, viewerId, this.now()],
    );
    const inPeriod = (p: 'week' | 'month') => {
      const r = current.find((c) => c.period === p);
      return {
        xp: Number(r?.xp ?? 0),
        watchMinutes: Math.floor(Number(r?.watch_seconds ?? 0) / 60),
        messages: Number(r?.messages ?? 0),
      };
    };
    return {
      periods: { week: inPeriod('week'), month: inPeriod('month') },
      enabled: s.enabled,
      twitchUserId: viewerId,
      level,
      xp,
      rank: acc?.rank ? Number(acc.rank) : null,
      levelXp: xpForLevel(level, s.rules),
      nextLevelXp: xpForLevel(level + 1, s.rules),
      // Counted by the Core since the switch (presence seen in the chatters list; messages read by the bot).
      watchMinutes: Math.floor(Number(acc?.watch_seconds ?? 0) / 60),
      messages: Number(acc?.messages ?? 0),
      // What the site shows: imported history + counted since.
      totals: {
        watchMinutes: Math.floor(
          (Number(acc?.watch_seconds ?? 0) +
            Number(acc?.imported_watch_seconds ?? 0)) /
            60,
        ),
        messages:
          Number(acc?.messages ?? 0) + Number(acc?.imported_messages ?? 0),
      },
      imported: acc?.imported_level
        ? {
            source: 'wizebot',
            level: acc.imported_level,
            watchMinutes: Math.floor(Number(acc.imported_watch_seconds) / 60),
            messages: Number(acc.imported_messages),
          }
        : null,
      equipped: {
        title: eq?.title_id && owned.has(eq.title_id) ? eq.title_id : null,
        badges: (eq?.badge_ids ?? []).filter((b) => owned.has(b)),
        frame: eq?.frame_id && owned.has(eq.frame_id) ? eq.frame_id : null,
        banner: eq?.banner_id && owned.has(eq.banner_id) ? eq.banner_id : null,
      },
      inventory: inventory.map((i) => ({
        id: i.reward_id,
        kind: i.kind,
        label: i.label,
        description: i.description,
        rarity: i.rarity,
        category: i.category,
        source: i.source,
        reference: i.reference,
        grantedAt: new Date(i.granted_at).toISOString(),
        // Boutique cosmétique: its look (data the site draws with the Core's stylesheet), its image, its state.
        status: i.status,
        style: i.style ?? {},
        image: i.image_id ? `/v1/cosmetics/images/${i.image_id}` : null,
      })),
    };
  }
}
