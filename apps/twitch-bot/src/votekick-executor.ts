import type { VotekickUser } from '@raptoru/schemas';
import {
  memoryRbJournal,
  type RbJournal,
  timeoutOnce,
  type TimeoutOutcome,
} from './random-ban-executor.js';
import { type Helix, HelixError } from './twitch/helix.js';

// Votekick V2 — the Twitch executor (docs/VOTEKICK_V2.md § 9). Runs in the Lab chat adapter (Lab Core,
// /v1/lab/votekick) and in the production bot when VOTEKICK=true (main Core, /v1/bot/votekick). Core decides; this:
// 1. check: finds the target by its login (LeCroupier_'s token) and whether it moderates the channel (the
//    broadcaster's token, moderation:read) → Core opens the vote or refuses;
// 2. timeout: the verdict's timeout on the user Core names (by id, never re-resolved by login) — journaled BEFORE
//    the call, sent ONCE (Random Ban's timeoutOnce: retried only when certainly not applied, an ambiguous answer is
//    settled from Twitch's list of bans), reported confirmed / refused / uncertain. After a crash, a journal entry
//    without outcome is settled from Twitch first (listed: confirmed; otherwise uncertain — never sent again).

export const VOTEKICK_SCOPES = {
  botTimeout: 'moderator:manage:banned_users',
  broadcasterRead: 'moderation:read',
} as const;

const READ_TRIES = 3;
const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** The Twitch calls of the executor (Helix in the adapters, fakes in tests). */
export interface VotekickTwitch {
  user(login: string): Promise<VotekickUser | null>;
  /** Moderators among these ids (≤ 100). */
  moderators(ids: string[]): Promise<string[]>;
  /** Bans and timeouts among these ids: expires_at '' = permanent. */
  bans(ids: string[]): Promise<{ user_id: string; expires_at: string }[]>;
  ban(userId: string, durationS: number, reason: string): Promise<void>;
}

class ReadError extends Error {}

/** One Twitch read, retried on network / 5xx / 429; another 4xx is final (scope, not a moderator…). */
async function read<T>(
  what: string,
  fn: () => Promise<T>,
  pause: (ms: number) => Promise<void>,
): Promise<T> {
  let last: unknown;
  for (let n = 0; n < READ_TRIES; n++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (
        e instanceof HelixError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 429
      )
        throw new ReadError(`${what}: Twitch ${e.status}`);
      await pause(300 * (n + 1));
    }
  }
  throw new ReadError(
    `${what}: ${last instanceof HelixError ? `Twitch ${last.status}` : ((last as Error)?.message ?? 'erreur')}`.slice(
      0,
      200,
    ),
  );
}

/** The Helix calls: LeCroupier_'s Helix (lookup, timeout), the broadcaster's for the moderators and bans. */
export function helixVotekickTwitch(
  bot: Helix,
  broadcaster: Helix | null,
  broadcasterId: string,
  botUserId: string,
): VotekickTwitch {
  const noToken = () => Promise.reject(new Error('broadcaster_token_absent'));
  return {
    user: async (login) => {
      const u = await bot.getUserByLogin(login);
      return u
        ? { id: u.twitchUserId, login: u.login, name: u.displayName }
        : null;
    },
    moderators: (ids) =>
      broadcaster ? broadcaster.getModeratorIds(broadcasterId, ids) : noToken(),
    bans: (ids) =>
      broadcaster ? broadcaster.getBans(broadcasterId, ids) : noToken(),
    ban: (id, duration, reason) =>
      bot.timeoutUser(broadcasterId, botUserId, id, duration, reason),
  };
}

export interface VotekickExecutorDeps {
  /** POST to Core; throws only when Core could not be reached. */
  core(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  base?: '/v1/lab/votekick' | '/v1/bot/votekick';
  channelId: string;
  broadcasterId: string;
  executorId: string;
  login: string;
  botScopes: string[];
  /** null: no broadcaster token here (no moderators read possible). */
  broadcasterScopes: string[] | null;
  twitch: VotekickTwitch;
  journal?: RbJournal;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (...args: unknown[]) => void;
}

type Job =
  | {
      vote_id: string;
      attempt_id: string;
      phase: 'check';
      target_login: string;
    }
  | {
      vote_id: string;
      attempt_id: string;
      phase: 'timeout';
      target_id: string;
      target_login: string;
      seconds: number;
      reason: string;
    };

export function createVotekickExecutor(d: VotekickExecutorDeps) {
  const now = d.now ?? Date.now;
  const pause = d.pause ?? sleep;
  const log = d.log ?? console.log;
  const base = d.base ?? '/v1/lab/votekick';
  const journal = d.journal ?? memoryRbJournal();
  const canRead =
    !!d.broadcasterScopes &&
    d.broadcasterScopes.includes(VOTEKICK_SCOPES.broadcasterRead);
  const canTimeout = d.botScopes.includes(VOTEKICK_SCOPES.botTimeout);
  const missing = [
    ...(canRead
      ? []
      : [
          d.broadcasterScopes
            ? `broadcaster: ${VOTEKICK_SCOPES.broadcasterRead}`
            : 'broadcaster: jeton absent',
        ]),
    ...(canTimeout ? [] : [`${d.login}: ${VOTEKICK_SCOPES.botTimeout}`]),
  ];
  const attempt = (job: { attempt_id: string }) => ({
    executor_id: d.executorId,
    attempt_id: job.attempt_id,
  });
  const post = (path: string, body: object) => d.core(`${base}${path}`, body);

  /** Journaled outcomes to Core; an entry without outcome (crash during the call) is settled from Twitch first. */
  async function recover(): Promise<boolean> {
    for (const e of journal.entries()) {
      let outcome: TimeoutOutcome | undefined = e.outcome;
      if (!outcome) {
        let listed: boolean | null;
        try {
          listed = (await d.twitch.bans([e.target_id])).some(
            (b) =>
              b.user_id === e.target_id &&
              (!b.expires_at || Date.parse(b.expires_at) > now()),
          );
        } catch {
          listed = null;
        }
        outcome =
          listed === true
            ? { event: 'confirmed', verified: true }
            : {
                event: 'uncertain',
                error: 'Raptoru arrêté pendant le timeout',
              };
      }
      journal.put({ ...e, state: 'done', outcome });
      try {
        const r = await post(`/votes/${e.request_id}/timeout`, {
          ...attempt(e),
          event: outcome.event,
          ...('error' in outcome ? { error: outcome.error } : {}),
        });
        if (r.status >= 500) return false;
        journal.remove(e.request_id);
      } catch {
        return false;
      }
    }
    return true;
  }

  async function check(job: Extract<Job, { phase: 'check' }>) {
    let body: object;
    try {
      const target = await read(
        'utilisateur',
        () => d.twitch.user(job.target_login),
        pause,
      );
      try {
        // The broadcaster is not in Twitch's list of moderators; Core handles him (muted, never timed out).
        const moderator =
          !!target &&
          target.id !== d.broadcasterId &&
          (
            await read(
              'modérateurs',
              () => d.twitch.moderators([target.id]),
              pause,
            )
          ).includes(target.id);
        body = { target, moderator };
      } catch (e) {
        body = {
          error: (e as Error).message.slice(0, 300) || 'erreur',
          stage: 'moderators',
        };
      }
    } catch (e) {
      body = {
        error: (e as Error).message.slice(0, 300) || 'erreur',
        stage: 'user',
      };
    }
    await post(`/votes/${job.vote_id}/check`, {
      ...attempt(job),
      ...body,
    }).catch(
      () => {}, // lost: the lease expires and the read is offered again (nothing opened)
    );
  }

  async function timeout(job: Extract<Job, { phase: 'timeout' }>) {
    journal.put({
      request_id: job.vote_id,
      attempt_id: job.attempt_id,
      target_id: job.target_id,
      state: 'about_to_timeout',
    });
    const outcome = await timeoutOnce({
      twitch: d.twitch,
      target: job.target_id,
      durationS: job.seconds,
      reason: job.reason,
      pause,
      now,
    });
    journal.put({
      request_id: job.vote_id,
      attempt_id: job.attempt_id,
      target_id: job.target_id,
      state: 'done',
      outcome,
    });
    log(
      `[votekick] ${job.target_login}: ${outcome.event}${'error' in outcome ? ` (${outcome.error})` : ''}`,
    );
    await recover();
  }

  async function tick(): Promise<'worked' | 'idle'> {
    if (!(await recover())) return 'idle';
    let claimed: { status: number; body: unknown };
    try {
      claimed = await post(`/${d.channelId}/claim`, {
        executor_id: d.executorId,
        login: d.login,
        can_read: canRead,
        can_timeout: canTimeout,
        missing,
      });
    } catch {
      return 'idle';
    }
    const job = (claimed.body as { job?: Job | null }).job;
    if (claimed.status !== 200 || !job) return 'idle';
    if (job.phase === 'check') await check(job);
    else await timeout(job);
    return 'worked';
  }

  let stopped = false;
  async function run() {
    while (!stopped) {
      let delay = 500;
      try {
        if ((await tick()) === 'worked') delay = 0;
      } catch (e) {
        log('[votekick] tick failed', (e as Error).message);
      }
      if (delay) await sleep(delay);
    }
  }
  return {
    tick,
    recover,
    run,
    stop: () => (stopped = true),
    ready: { canRead, canTimeout, missing },
  };
}
