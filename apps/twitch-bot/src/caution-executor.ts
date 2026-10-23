import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { CautionSanction } from '@raptoru/schemas';
import { type Helix, HelixError } from './twitch/helix.js';

// Caution — the Twitch executor (docs/CAUTION.md). Runs in the Lab chat adapter (Lab Core, /v1/lab/caution) and in
// the production bot when CAUTION=true (main Core, /v1/bot/caution) — LeCroupier_'s token for the user lookup and the
// unban, the broadcaster's for the list of bans (moderation:read). Core decides, prices and debits; this executor:
// 1. claims the open caution waiting for Twitch (Core: one at a time per channel);
// 2. quote phase: finds the target by login and reads its sanction (Get Banned Users) → Core quotes or refuses;
// 3. release phase: RE-READS the sanction → Core debits (and only then answers « proceed ») → journals « about to
//    release », calls Unban User ONCE, checks the list of bans, journals the outcome, reports it:
//    released · not_applied (Twitch refused / never sent, still listed) · not_banned (the timeout had already ended) ·
//    uncertain (no answer, 5xx, or the list unreadable / contradicting Twitch's answer) — Core refunds the first two
//    exactly once and never the last. After a crash, a journal entry without outcome is settled from Twitch first.

export const CAUTION_SCOPES = {
  botRelease: 'moderator:manage:banned_users',
  broadcasterRead: 'moderation:read',
} as const;

const NOT_SENT_NETWORK = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
];
const READ_TRIES = 3;

export interface CautionUser {
  id: string;
  login: string;
  name: string;
}

/** The Twitch calls of the executor (Helix in the adapters, fakes in tests). */
export interface CautionTwitch {
  user(login: string): Promise<CautionUser | null>;
  /** Bans and timeouts among these ids (≤ 100): expires_at '' = permanent. */
  bans(ids: string[]): Promise<{ user_id: string; expires_at: string }[]>;
  unban(userId: string): Promise<void>;
}

export class CautionReadError extends Error {}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

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
        throw new CautionReadError(`${what}: Twitch ${e.status}`);
      await pause(300 * (n + 1));
    }
  }
  throw new CautionReadError(
    `${what}: ${last instanceof HelixError ? `Twitch ${last.status}` : ((last as Error)?.message ?? 'erreur')}`.slice(
      0,
      200,
    ),
  );
}

/** The user's sanction now, from Twitch's list of bans (an elapsed timeout counts as none). */
export async function readSanction(
  twitch: CautionTwitch,
  userId: string,
  now: () => number,
  pause: (ms: number) => Promise<void> = sleep,
): Promise<CautionSanction> {
  const bans = await read(
    'liste des bannis',
    () => twitch.bans([userId]),
    pause,
  );
  const b = bans.find((x) => x.user_id === userId);
  if (!b) return { kind: 'none' };
  if (!b.expires_at) return { kind: 'permanent' };
  const ends = Date.parse(b.expires_at);
  if (!(ends > now())) return { kind: 'none' };
  return { kind: 'timeout', ends_at: new Date(ends).toISOString() };
}

export type ReleaseOutcome = {
  event: 'released' | 'not_applied' | 'not_banned' | 'uncertain';
  error?: string;
  verified?: boolean;
};

/** Still listed as banned / timed out? null: Twitch could not tell (after a few tries). */
async function stillBanned(
  twitch: CautionTwitch,
  userId: string,
  now: () => number,
  pause: (ms: number) => Promise<void>,
) {
  try {
    return (await readSanction(twitch, userId, now, pause)).kind !== 'none';
  } catch {
    return null;
  }
}

/**
 * Unban User once. 409 / 429 / request never sent: retried (nothing applied). The list of bans is read after every
 * answer (Twitch's lists lag a little: read again a few times before calling a success contradicted).
 */
export async function releaseOnce(o: {
  twitch: CautionTwitch;
  target: string;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<ReleaseOutcome> {
  const pause = o.pause ?? sleep;
  const now = o.now ?? Date.now;
  /** Listed after `tries` reads spaced by 700 ms? (false as soon as one read says free) */
  const listed = async (tries: number) => {
    let last: boolean | null = null;
    for (let i = 0; i < tries; i++) {
      await pause(700);
      last = await stillBanned(o.twitch, o.target, now, pause);
      if (last === false) return false;
    }
    return last;
  };
  for (let n = 0; n < 3; n++) {
    try {
      await o.twitch.unban(o.target);
      const still = await listed(3);
      if (still === true)
        return {
          event: 'uncertain',
          error: 'Twitch a répondu OK mais le timeout est encore listé',
        };
      // Free, or the list unreadable: Twitch's explicit success stands.
      return { event: 'released' };
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
        if (e.status === 400) {
          // « The user is not banned »: the timeout ended by itself — unless the list says otherwise.
          const still = await listed(1);
          return still === true
            ? {
                event: 'not_applied',
                error: `Twitch 400 : ${e.body}`.slice(0, 300),
              }
            : {
                event: 'not_banned',
                error: 'timeout déjà terminé',
                verified: still === false,
              };
        }
        if (e.status < 500)
          return {
            event: 'not_applied',
            error: `Twitch ${e.status} : ${e.body}`.slice(0, 300),
          };
        return settleAmbiguous(`Twitch ${e.status}`);
      }
      const code = (e as { cause?: { code?: string } })?.cause?.code;
      if (code && NOT_SENT_NETWORK.includes(code)) {
        await pause(500);
        continue;
      }
      return settleAmbiguous(
        (e as { name?: string })?.name === 'TimeoutError'
          ? 'Twitch ne répond pas'
          : 'réponse illisible',
      );
    }
  }
  // Never sent (busy / unreachable each time): the list decides.
  const still = await listed(1);
  if (still === true)
    return {
      event: 'not_applied',
      error: 'Twitch injoignable : aucune levée envoyée',
    };
  if (still === false)
    return {
      event: 'not_banned',
      error: 'timeout déjà terminé',
      verified: true,
    };
  return { event: 'uncertain', error: 'Twitch injoignable, liste illisible' };

  /** The unban may have been applied: free → released (verified); listed or unreadable → uncertain (never refunded). */
  async function settleAmbiguous(why: string): Promise<ReleaseOutcome> {
    const still = await listed(2);
    if (still === false) return { event: 'released', verified: true };
    return {
      event: 'uncertain',
      error:
        `${why} ; ${still === true ? 'encore listé' : 'liste illisible'}`.slice(
          0,
          300,
        ),
    };
  }
}

// --- local journal (written before Twitch is called) ------------------------------------------------------------

interface JournalEntry {
  request_id: string;
  attempt_id: string;
  target_id: string;
  state: 'about_to_release' | 'done';
  outcome?: ReleaseOutcome;
}
export interface CautionJournal {
  entries(): JournalEntry[];
  put(e: JournalEntry): void;
  remove(requestId: string): void;
}
export function memoryCautionJournal(): CautionJournal {
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
/** JSON file rewritten atomically; unreadable → the executor stops (it may hold a release Core does not know). */
export function fileCautionJournal(path: string): CautionJournal {
  const list0 = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { entries: JournalEntry[] })
        .entries
    : [];
  if (!Array.isArray(list0))
    throw new Error(`caution journal ${path} is not valid`);
  let list = list0;
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

/** The Helix calls: LeCroupier_'s Helix (lookup, unban), the broadcaster's for the list of bans (null: none). */
export function helixCautionTwitch(
  bot: Helix,
  broadcaster: Helix | null,
  broadcasterId: string,
  botUserId: string,
): CautionTwitch {
  return {
    user: async (login) => {
      const u = await bot.getUserByLogin(login);
      return u
        ? { id: u.twitchUserId, login: u.login, name: u.displayName }
        : null;
    },
    bans: (ids) =>
      broadcaster
        ? broadcaster.getBans(broadcasterId, ids)
        : Promise.reject(new Error('broadcaster_token_absent')),
    unban: (id) => bot.unbanUser(broadcasterId, botUserId, id),
  };
}

export interface CautionExecutorDeps {
  /** POST to Core; throws only when Core could not be reached. */
  core(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  base?: '/v1/lab/caution' | '/v1/bot/caution';
  channelId: string;
  broadcasterId: string;
  executorId: string;
  login: string;
  botScopes: string[];
  /** null: no broadcaster token here (no read possible). */
  broadcasterScopes: string[] | null;
  twitch: CautionTwitch;
  journal: CautionJournal;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (...args: unknown[]) => void;
}

interface Job {
  request_id: string;
  attempt_id: string;
  phase: 'quote' | 'release';
  mode: 'real' | 'dry_run';
  target_login: string;
  target_id: string | null;
}

export function createCautionExecutor(d: CautionExecutorDeps) {
  const now = d.now ?? Date.now;
  const pause = d.pause ?? sleep;
  const log = d.log ?? console.log;
  const base = d.base ?? '/v1/lab/caution';
  const canRead =
    !!d.broadcasterScopes &&
    d.broadcasterScopes.includes(CAUTION_SCOPES.broadcasterRead);
  const canRelease = d.botScopes.includes(CAUTION_SCOPES.botRelease);
  const missing = [
    ...(d.broadcasterScopes
      ? d.broadcasterScopes.includes(CAUTION_SCOPES.broadcasterRead)
        ? []
        : [`broadcaster: ${CAUTION_SCOPES.broadcasterRead}`]
      : ['broadcaster: jeton absent']),
    ...(canRelease ? [] : [`${d.login}: ${CAUTION_SCOPES.botRelease}`]),
  ];
  const attempt = (job: Pick<Job, 'attempt_id'>) => ({
    executor_id: d.executorId,
    attempt_id: job.attempt_id,
  });
  const post = (path: string, body: object) => d.core(`${base}${path}`, body);

  /** Journaled outcomes to Core; an entry without outcome (crash during the call) is settled from Twitch first. */
  async function recover(): Promise<boolean> {
    for (const e of d.journal.entries()) {
      let outcome = e.outcome;
      if (!outcome) {
        const still = await stillBanned(d.twitch, e.target_id, now, pause);
        // Free: released (by us or by its end). Listed or unknown: the unban may or may not have left → uncertain.
        outcome =
          still === false
            ? { event: 'released', verified: true }
            : {
                event: 'uncertain',
                error: 'Raptoru arrêté pendant la levée',
              };
      }
      d.journal.put({ ...e, state: 'done', outcome });
      try {
        const r = await post(`/requests/${e.request_id}/result`, {
          ...attempt(e),
          ...outcome,
        });
        if (r.status >= 500) return false;
        d.journal.remove(e.request_id);
      } catch {
        return false;
      }
    }
    return true;
  }

  async function quote(job: Job) {
    let body: object;
    try {
      const target = await read(
        'utilisateur',
        () => d.twitch.user(job.target_login),
        pause,
      );
      const sanction: CautionSanction =
        !target || target.id === d.broadcasterId
          ? { kind: 'none' } // the broadcaster: Core reads its Votekick mute
          : await readSanction(d.twitch, target.id, now, pause);
      body = { target, sanction };
    } catch (e) {
      body = { error: (e as Error).message.slice(0, 300) || 'erreur' };
    }
    await post(`/requests/${job.request_id}/check`, {
      ...attempt(job),
      ...body,
    }).catch(() => {}); // lost: the lease expires and the read is offered again (nothing debited)
  }

  async function release(job: Job) {
    let body: object;
    try {
      body = {
        sanction: await readSanction(d.twitch, job.target_id!, now, pause),
      };
    } catch (e) {
      body = { error: (e as Error).message.slice(0, 300) || 'erreur' };
    }
    let answer: { proceed?: boolean; target_id?: string };
    try {
      const r = await post(`/requests/${job.request_id}/recheck`, {
        ...attempt(job),
        ...body,
      });
      if (r.status !== 200) return;
      answer = r.body as typeof answer;
    } catch {
      return; // Core never answered: nothing is sent (if it debited, its lease makes it « uncertain »)
    }
    if (!answer.proceed || job.mode !== 'real') return;
    d.journal.put({
      request_id: job.request_id,
      attempt_id: job.attempt_id,
      target_id: job.target_id!,
      state: 'about_to_release',
    });
    const outcome = await releaseOnce({
      twitch: d.twitch,
      target: job.target_id!,
      pause,
      now,
    });
    d.journal.put({
      request_id: job.request_id,
      attempt_id: job.attempt_id,
      target_id: job.target_id!,
      state: 'done',
      outcome,
    });
    log(
      `[caution] ${job.target_login}: ${outcome.event}${outcome.error ? ` (${outcome.error})` : ''}`,
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
        can_release: canRelease,
        missing,
      });
    } catch {
      return 'idle';
    }
    const job = (claimed.body as { job?: Job | null }).job;
    if (claimed.status !== 200 || !job) return 'idle';
    if (job.phase === 'quote') await quote(job);
    else await release(job);
    return 'worked';
  }

  let stopped = false;
  async function run() {
    while (!stopped) {
      let delay = 1000;
      try {
        if ((await tick()) === 'worked') delay = 0;
      } catch (e) {
        log('[caution] tick failed', (e as Error).message);
      }
      if (delay) await sleep(delay);
    }
  }
  return {
    tick,
    recover,
    run,
    stop: () => (stopped = true),
    ready: { canRead, canRelease, missing },
  };
}
