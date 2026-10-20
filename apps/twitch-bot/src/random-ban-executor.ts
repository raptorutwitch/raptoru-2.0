import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { type Helix, HelixError } from './twitch/helix.js';

// Random Ban V2 — the Twitch executor (docs/RANDOM_BAN_V2.md). Runs in the Lab chat adapter (Lab Core,
// /v1/lab/random-ban) and in the production bot when RANDOM_BAN=true (main Core, /v1/bot/random-ban) — LeCroupier_'s
// token for the chatters, the follows and the timeout; the broadcaster's token for the moderators, the bans and the
// subscriptions. Core decides and records; this executor:
// 1. claims ONE request (Core serializes: one Random Ban at a time);
// 2. searches a target with Twitch reads only — the chatters Twitch lists (lurkers included), minus the broadcaster,
//    the moderators and the banned / timed out (bulk reads, 100 ids per call), shuffled with crypto, then the first
//    one who follows the channel (one call per candidate, 8 in parallel, in the shuffled order: uniform among the
//    eligible); no follower → « flop »; a Twitch read that keeps failing → « failed » (never a false flop);
// 3. tells Core the target BEFORE anything is sent (Core answers the sanction; a dry run stops here);
// 4. journals « about to time out », calls Ban User ONCE with a duration (never a permanent ban), journals the
//    outcome, reports it. An ambiguous answer (timeout, 5xx) is checked in Twitch's list of bans — confirmed, not
//    applied, or « uncertain » if Twitch cannot be read — and never sent again. After a crash, a journal entry
//    without outcome is settled the same way.

export const RB_SCOPES = {
  bot: ['moderator:read:chatters', 'moderator:read:followers'],
  botTimeout: 'moderator:manage:banned_users',
  broadcaster: ['moderation:read', 'channel:read:subscriptions'],
} as const;

const NOT_SENT_NETWORK = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
];
const FOLLOW_WINDOW = 8;
const READ_TRIES = 3;

export interface RbUser {
  id: string;
  login: string;
  name: string;
}

/** The Twitch calls the executor needs (Helix in the adapter, fakes in tests). */
export interface RbTwitch {
  chattersPage(after: string | null): Promise<{
    chatters: RbUser[];
    cursor: string | null;
  }>;
  /** Moderators among these ids (≤ 100). */
  moderators(ids: string[]): Promise<string[]>;
  /** Bans and timeouts among these ids (≤ 100): expires_at '' = permanent. */
  bans(ids: string[]): Promise<{ user_id: string; expires_at: string }[]>;
  follows(userId: string): Promise<boolean>;
  /** Subscribers among these ids (≤ 100). */
  subscribers(ids: string[]): Promise<string[]>;
  ban(userId: string, durationS: number, reason: string): Promise<void>;
}

/** A Twitch read that keeps failing, or a refusal (scope, not a moderator): the search cannot conclude. */
export class RbReadError extends Error {}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const chunks = <T>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
    xs.slice(i * n, i * n + n),
  );

/** One Twitch read, retried on network / 5xx / 429; a 4xx is final (scope, not a moderator…). */
async function read<T>(
  what: string,
  fn: () => Promise<T>,
  pause: (ms: number) => Promise<void>,
  now: () => number,
): Promise<T> {
  let last: unknown;
  for (let n = 0; n < READ_TRIES; n++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof HelixError && e.status >= 400 && e.status < 500) {
        if (e.status !== 429)
          throw new RbReadError(`${what}: Twitch ${e.status}`);
        await pause(
          Math.min(5000, Math.max(200, (e.rateLimitResetMs ?? 0) - now())),
        );
        continue;
      }
      await pause(300 * (n + 1));
    }
  }
  throw new RbReadError(
    `${what}: ${last instanceof HelixError ? `Twitch ${last.status}` : ((last as Error)?.message ?? 'erreur')}`.slice(
      0,
      200,
    ),
  );
}

export type RbSearch =
  | {
      target: RbUser;
      is_sub: boolean;
      stats: { chatters: number; candidates: number; follow_checks: number };
    }
  | {
      target: null;
      stats: { chatters: number; candidates: number; follow_checks: number };
    };

/**
 * The search (pure reads). Uniform among the eligible: a crypto shuffle of the candidates, then the first follower in
 * that order. Followers are checked one by one (Twitch has no bulk check), FOLLOW_WINDOW at a time.
 */
export async function searchTarget(o: {
  twitch: RbTwitch;
  broadcasterId: string;
  draw?: (n: number) => number;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<RbSearch> {
  const pause = o.pause ?? sleep;
  const now = o.now ?? Date.now;
  const draw = o.draw ?? ((n: number) => randomInt(n));
  const r = <T>(what: string, fn: () => Promise<T>) =>
    read(what, fn, pause, now);
  const seen = new Map<string, RbUser>();
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<RbTwitch['chattersPage']>> = await r(
      'liste des chatters',
      () => o.twitch.chattersPage(cursor),
    );
    for (const c of page.chatters) seen.set(c.id, c);
    cursor = page.cursor;
  } while (cursor);
  const chatters = [...seen.values()].filter((c) => c.id !== o.broadcasterId);
  const excluded = new Set<string>();
  for (const ids of chunks(
    chatters.map((c) => c.id),
    100,
  )) {
    for (const id of await r('modérateurs', () => o.twitch.moderators(ids)))
      excluded.add(id);
    for (const b of await r('bannis', () => o.twitch.bans(ids)))
      if (!b.expires_at || Date.parse(b.expires_at) > now())
        excluded.add(b.user_id);
  }
  const candidates = chatters.filter((c) => !excluded.has(c.id));
  // Fisher–Yates with crypto: the order cannot be guessed nor influenced by a viewer.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = draw(i + 1);
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  let checks = 0;
  const stats = () => ({
    chatters: seen.size,
    candidates: candidates.length,
    follow_checks: checks,
  });
  for (const window of chunks(candidates, FOLLOW_WINDOW)) {
    const follows = await Promise.all(
      window.map((c) => r('follow', () => o.twitch.follows(c.id))),
    );
    checks += window.length;
    const i = follows.indexOf(true);
    if (i >= 0) {
      const target = window[i]!;
      const subs = await r('abonnement', () =>
        o.twitch.subscribers([target.id]),
      );
      return { target, is_sub: subs.includes(target.id), stats: stats() };
    }
  }
  return { target: null, stats: stats() };
}

export type TimeoutOutcome =
  | { event: 'confirmed'; verified?: true }
  | { event: 'refused'; error: string }
  | { event: 'uncertain'; error: string };

/** Is the target in timeout now (Twitch's list of bans)? null: Twitch could not tell. */
async function inTimeout(
  twitch: RbTwitch,
  targetId: string,
  now: () => number,
) {
  try {
    const bans = await twitch.bans([targetId]);
    return bans.some(
      (b) =>
        b.user_id === targetId &&
        (!b.expires_at || Date.parse(b.expires_at) > now()),
    );
  } catch {
    return null;
  }
}

/** The ambiguous case: Twitch's list decides; unreadable → uncertain (never sent again). */
async function settle(
  twitch: RbTwitch,
  targetId: string,
  why: string,
  now: () => number,
): Promise<TimeoutOutcome> {
  const banned = await inTimeout(twitch, targetId, now);
  if (banned === true) return { event: 'confirmed', verified: true };
  if (banned === false)
    return {
      event: 'refused',
      error: `${why} ; vérifié : aucun timeout appliqué`.slice(0, 300),
    };
  return {
    event: 'uncertain',
    error: `${why} ; liste des bannis illisible`.slice(0, 300),
  };
}

/** Ban User once (a timeout: a duration is always given). 409 / 429 / request never sent: retried (nothing applied). */
export async function timeoutOnce(o: {
  twitch: RbTwitch;
  target: string;
  durationS: number;
  reason: string;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<TimeoutOutcome> {
  const pause = o.pause ?? sleep;
  const now = o.now ?? Date.now;
  if (!(o.durationS >= 1 && o.durationS <= 1_209_600))
    return { event: 'refused', error: 'invalid_duration' };
  for (let n = 0; n < 3; n++) {
    try {
      await o.twitch.ban(o.target, o.durationS, o.reason);
      return { event: 'confirmed' };
    } catch (e) {
      if (e instanceof HelixError) {
        if (e.status === 409) {
          await pause(500);
          continue;
        }
        if (e.status === 429) {
          await pause(
            Math.min(5000, Math.max(200, (e.rateLimitResetMs ?? 0) - now())),
          );
          continue;
        }
        if (e.status < 500)
          return {
            event: 'refused',
            error: `Twitch ${e.status} : ${e.body}`.slice(0, 300),
          };
        await pause(1500);
        return settle(o.twitch, o.target, `Twitch ${e.status}`, now);
      }
      const code = (e as { cause?: { code?: string } })?.cause?.code;
      if (code && NOT_SENT_NETWORK.includes(code)) {
        await pause(500);
        continue;
      }
      await pause(1500);
      return settle(
        o.twitch,
        o.target,
        (e as { name?: string })?.name === 'TimeoutError'
          ? 'Twitch ne répond pas'
          : 'réponse illisible',
        now,
      );
    }
  }
  return { event: 'refused', error: 'Twitch occupé : aucun timeout appliqué' };
}

// --- local journal (same pattern as the Commands output: written before Twitch is called) -------------------------

interface JournalEntry {
  request_id: string;
  attempt_id: string;
  target_id: string;
  state: 'about_to_timeout' | 'done';
  outcome?: TimeoutOutcome;
}
export interface RbJournal {
  entries(): JournalEntry[];
  put(e: JournalEntry): void;
  remove(requestId: string): void;
}
export function memoryRbJournal(): RbJournal {
  let list: JournalEntry[] = [];
  return {
    entries: () => list.map((e) => ({ ...e })),
    put: (e) => {
      list = [...list.filter((x) => x.request_id !== e.request_id), e];
    },
    remove: (id) => {
      list = list.filter((x) => x.request_id !== id);
    },
  };
}
/** JSON file rewritten atomically; unreadable → the executor stops (it may hold a timeout Core does not know). */
export function fileRbJournal(path: string): RbJournal {
  let list = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { entries: JournalEntry[] })
        .entries
    : [];
  if (!Array.isArray(list))
    throw new Error(`random ban journal ${path} is not valid`);
  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify({ entries: list }));
    renameSync(`${path}.tmp`, path);
  };
  return {
    entries: () => list.map((e) => ({ ...e })),
    put: (e) => {
      list = [...list.filter((x) => x.request_id !== e.request_id), e];
      save();
    },
    remove: (id) => {
      const before = list.length;
      list = list.filter((x) => x.request_id !== id);
      if (list.length !== before) save();
    },
  };
}

// --- executor -------------------------------------------------------------------------------------------------------

/** The Helix calls of the executor: LeCroupier_'s Helix, the broadcaster's for its reads (null: no search possible). */
export function helixRbTwitch(
  bot: Helix,
  broadcaster: Helix | null,
  broadcasterId: string,
  botUserId: string,
): RbTwitch {
  const b = () =>
    broadcaster ?? Promise.reject(new Error('broadcaster_token_absent'));
  return {
    chattersPage: async (after) => {
      const p = await bot.getChattersPage(broadcasterId, botUserId, after);
      return {
        chatters: p.chatters.map((c) => ({
          id: c.twitchUserId,
          login: c.login,
          name: c.displayName,
        })),
        cursor: p.cursor,
      };
    },
    moderators: async (ids) => (await b()).getModeratorIds(broadcasterId, ids),
    bans: async (ids) => (await b()).getBans(broadcasterId, ids),
    follows: (id) => bot.isFollower(broadcasterId, id),
    subscribers: async (ids) =>
      (await b()).getSubscriberIds(broadcasterId, ids),
    ban: (id, duration, reason) =>
      bot.timeoutUser(broadcasterId, botUserId, id, duration, reason),
  };
}

export interface RandomBanExecutorDeps {
  /** POST to Core under `base`; throws only when Core could not be reached. */
  core(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  /** Core routes: '/v1/lab/random-ban' (Lab Core, default) or '/v1/bot/random-ban' (main Core, bot secret). */
  base?: '/v1/lab/random-ban' | '/v1/bot/random-ban';
  channelId: string;
  broadcasterId: string;
  executorId: string;
  login: string;
  botScopes: string[];
  /** null: no broadcaster token here (no search possible). */
  broadcasterScopes: string[] | null;
  twitch: RbTwitch;
  journal: RbJournal;
  draw?: (n: number) => number;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (...args: unknown[]) => void;
}

export function createRandomBanExecutor(d: RandomBanExecutorDeps) {
  const now = d.now ?? Date.now;
  const log = d.log ?? console.log;
  const base = d.base ?? '/v1/lab/random-ban';
  const missing = [
    ...RB_SCOPES.bot
      .filter((s) => !d.botScopes.includes(s))
      .map((s) => `${d.login}: ${s}`),
    ...(d.botScopes.includes(RB_SCOPES.botTimeout)
      ? []
      : [`${d.login}: ${RB_SCOPES.botTimeout}`]),
    ...(d.broadcasterScopes
      ? RB_SCOPES.broadcaster
          .filter((s) => !d.broadcasterScopes!.includes(s))
          .map((s) => `broadcaster: ${s}`)
      : ['broadcaster: jeton absent']),
  ];
  const canSearch =
    RB_SCOPES.bot.every((s) => d.botScopes.includes(s)) &&
    !!d.broadcasterScopes &&
    RB_SCOPES.broadcaster.every((s) => d.broadcasterScopes!.includes(s));
  const canTimeout = d.botScopes.includes(RB_SCOPES.botTimeout);

  const result = (requestId: string, attemptId: string, body: object) =>
    d.core(`${base}/requests/${requestId}/result`, {
      executor_id: d.executorId,
      attempt_id: attemptId,
      ...body,
    });

  /** Journaled outcomes to Core; an entry without outcome (crash during the call) is settled from Twitch first. */
  async function recover(): Promise<boolean> {
    for (const e of d.journal.entries()) {
      const outcome =
        e.outcome ??
        (await settle(
          d.twitch,
          e.target_id,
          'Raptoru arrêté pendant le timeout',
          now,
        ));
      d.journal.put({ ...e, state: 'done', outcome });
      try {
        const r = await result(e.request_id, e.attempt_id, outcome);
        if (r.status >= 500) return false;
        d.journal.remove(e.request_id);
      } catch {
        return false;
      }
    }
    return true;
  }

  async function tick(): Promise<'worked' | 'idle'> {
    if (!(await recover())) return 'idle';
    let claimed: { status: number; body: unknown };
    try {
      claimed = await d.core(`${base}/${d.channelId}/claim`, {
        executor_id: d.executorId,
        login: d.login,
        can_search: canSearch,
        can_timeout: canTimeout,
        missing,
      });
    } catch {
      return 'idle';
    }
    const req = (
      claimed.body as {
        request?: {
          request_id: string;
          attempt_id: string;
          mode: 'real' | 'dry_run';
        } | null;
      }
    ).request;
    if (claimed.status !== 200 || !req) return 'idle';
    let found: RbSearch;
    try {
      found = await searchTarget({
        twitch: d.twitch,
        broadcasterId: d.broadcasterId,
        draw: d.draw,
        pause: d.pause,
        now,
      });
    } catch (e) {
      await result(req.request_id, req.attempt_id, {
        event: 'failed',
        error: `recherche impossible : ${(e as Error).message}`.slice(0, 300),
      }).catch(() => {});
      return 'worked';
    }
    if (!found.target) {
      await result(req.request_id, req.attempt_id, {
        event: 'flop',
        stats: found.stats,
      }).catch(() => {});
      return 'worked';
    }
    // Core knows the target before anything is sent; no answer → nothing is sent (the lease expires, re-offered).
    let answer: { proceed?: boolean; duration_s?: number; reason?: string };
    try {
      const r = await d.core(`${base}/requests/${req.request_id}/target`, {
        executor_id: d.executorId,
        attempt_id: req.attempt_id,
        target: found.target,
        is_sub: found.is_sub,
        stats: found.stats,
      });
      if (r.status !== 200) return 'worked';
      answer = r.body as typeof answer;
    } catch {
      return 'worked';
    }
    if (!answer.proceed || req.mode !== 'real') return 'worked';
    d.journal.put({
      request_id: req.request_id,
      attempt_id: req.attempt_id,
      target_id: found.target.id,
      state: 'about_to_timeout',
    });
    const outcome = await timeoutOnce({
      twitch: d.twitch,
      target: found.target.id,
      durationS: answer.duration_s!,
      reason: answer.reason!,
      pause: d.pause,
      now,
    });
    d.journal.put({
      request_id: req.request_id,
      attempt_id: req.attempt_id,
      target_id: found.target.id,
      state: 'done',
      outcome,
    });
    log(
      `[random-ban] ${found.target.login}: ${outcome.event}${'error' in outcome ? ` (${outcome.error})` : ''}`,
    );
    await recover();
    return 'worked';
  }

  let stopped = false;
  async function run() {
    while (!stopped) {
      let delay = 1000;
      try {
        if ((await tick()) === 'worked') delay = 0;
      } catch (e) {
        log('[random-ban] tick failed', (e as Error).message);
      }
      if (delay) await sleep(delay);
    }
  }
  return {
    tick,
    recover,
    run,
    stop: () => (stopped = true),
    ready: { canSearch, canTimeout, missing },
  };
}
