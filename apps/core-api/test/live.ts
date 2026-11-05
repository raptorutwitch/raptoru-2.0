import type { Clock } from '../src/clock.js';
import type { Db } from '../src/db/db.js';
import { StreamSessions } from '../src/stream/stream-sessions.js';

/**
 * Refonte H1: on the canonical economy the paid stream interactions need the canonical live (stream_sessions, opened by
 * Twitch through the bot). Tests of those flows open one, as Twitch would. Fictional stream id.
 */
export function openCanonicalLive(
  db: Db,
  clock: Clock,
  streamId = 'test-live-1',
) {
  return new StreamSessions(db, clock).online({
    streamId,
    startedAt: clock.now(),
  });
}
