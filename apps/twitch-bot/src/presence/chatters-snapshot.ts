import type { Chatter, PresenceSnapshot } from '@raptoru/schemas';
import type { ChattersPage } from '../twitch/helix.js';
import { HelixError } from '../twitch/helix.js';

export type GetChattersPage = (
  after: string | null,
  signal: AbortSignal,
) => Promise<ChattersPage>;

export interface SnapshotOptions {
  /** Aborted by the worker on stop: the snapshot is then abandoned, never reported. */
  signal: AbortSignal;
  /** Whole-snapshot budget, all pages and retries included. */
  deadlineMs?: number;
  maxPages?: number;
  /** Extra attempts per page for transient failures (timeout, network, 5xx). */
  pageRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface SnapshotResult {
  snapshot: PresenceSnapshot;
  /** Set on 429: do not call Twitch again before this instant (epoch ms). */
  retryAtMs: number | null;
}

export class SnapshotAbortedError extends Error {
  constructor() {
    super('snapshot aborted');
  }
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

function failure(
  errorKind: Extract<PresenceSnapshot, { status: 'error' }>['errorKind'],
  message: string,
  httpStatus: number | null = null,
  retryAtMs: number | null = null,
): SnapshotResult {
  return {
    snapshot: {
      status: 'error',
      errorKind,
      httpStatus,
      message: message.slice(0, 500),
    },
    retryAtMs,
  };
}

/**
 * Complete Get Chatters snapshot, or an explicit error. A partial list is never returned as a
 * success: any failed page, repeated cursor, page limit or deadline fails the whole snapshot.
 */
export async function takeChattersSnapshot(
  getPage: GetChattersPage,
  {
    signal,
    deadlineMs = 30_000,
    maxPages = 50,
    pageRetries = 1,
    retryDelayMs = 1_000,
    sleep = defaultSleep,
  }: SnapshotOptions,
): Promise<SnapshotResult> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
  const chatters = new Map<string, Chatter>();
  const seenCursors = new Set<string>();
  let after: string | null = null;

  for (let pages = 1; ; pages++) {
    if (pages > maxPages)
      return failure('pagination', `more than ${maxPages} pages`);

    let page: ChattersPage | null = null;
    for (let attempt = 0; page === null; attempt++) {
      if (signal.aborted) throw new SnapshotAbortedError();
      if (deadline.aborted)
        return failure('timeout', `snapshot exceeded ${deadlineMs}ms`);
      try {
        page = await getPage(after, deadline);
      } catch (error) {
        if (signal.aborted) throw new SnapshotAbortedError();
        if (deadline.aborted)
          return failure('timeout', `snapshot exceeded ${deadlineMs}ms`);
        if (error instanceof HelixError) {
          if (error.status === 429) {
            return failure(
              'rate_limited',
              'Twitch rate limit',
              429,
              error.rateLimitResetMs,
            );
          }
          if (error.status === 401 || error.status === 403) {
            return failure('auth', error.message, error.status);
          }
          if (error.status < 500 || attempt >= pageRetries) {
            return failure('http_error', error.message, error.status);
          }
        } else {
          const timedOut =
            error instanceof Error && error.name === 'TimeoutError';
          if (attempt >= pageRetries) {
            return failure(
              timedOut ? 'timeout' : 'network',
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        await sleep(retryDelayMs, deadline);
      }
    }

    for (const c of page.chatters) chatters.set(c.twitchUserId, c);
    if (!page.cursor) {
      return {
        snapshot: {
          status: 'ok',
          chatters: [...chatters.values()],
          reportedTotal: page.total,
          pages,
        },
        retryAtMs: null,
      };
    }
    if (seenCursors.has(page.cursor))
      return failure('pagination', 'repeated pagination cursor');
    seenCursors.add(page.cursor);
    after = page.cursor;
  }
}
