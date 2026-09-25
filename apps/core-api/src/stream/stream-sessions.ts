import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { nominalStreamDay } from './stream-day.js';

export interface ActiveSession {
  streamId: string;
  streamDay: string;
  startedAt: Date;
}

export interface StreamLiveInput {
  streamId: string;
  startedAt: Date;
}

interface SessionRow {
  stream_id: string;
  stream_day: string;
  started_at: Date;
  ended_at: Date | null;
}

export async function activeSession(
  q: Queryable,
): Promise<ActiveSession | null> {
  const rows = await q.query<SessionRow>(
    'select stream_id, stream_day, started_at from stream_sessions where ended_at is null',
  );
  const row = rows[0];
  return row
    ? {
        streamId: row.stream_id,
        streamDay: row.stream_day,
        startedAt: row.started_at,
      }
    : null;
}

export class StreamSessions {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  current(): Promise<ActiveSession | null> {
    return activeSession(this.db);
  }

  /** Idempotent: repeated or late `online` for the same stream id never creates a second session. */
  online(live: StreamLiveInput): Promise<ActiveSession> {
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        'stream_sessions',
      ]);

      const existing = (
        await q.query<SessionRow>(
          'select * from stream_sessions where stream_id = $1',
          [live.streamId],
        )
      )[0];
      if (existing) {
        const newer = await q.query(
          'select 1 from stream_sessions where started_at > $1 limit 1',
          [existing.started_at],
        );
        if (existing.ended_at && newer.length === 0) {
          // Offline was wrong (or out of order): the same broadcast is still live.
          await closeOpenSessions(q, this.clock.now());
          await q.query(
            'update stream_sessions set ended_at = null where stream_id = $1',
            [live.streamId],
          );
        }
        return {
          streamId: existing.stream_id,
          streamDay: existing.stream_day,
          startedAt: existing.started_at,
        };
      }

      // A previous live still open was never closed (missed offline): a new broadcast replaces it.
      await closeOpenSessions(q, live.startedAt);

      const streamDay = nominalStreamDay(live.startedAt);

      await q.query(
        'insert into stream_days (day, opened_at) values ($1, $2) on conflict do nothing',
        [streamDay, live.startedAt],
      );

      await q.query(
        'insert into stream_sessions (stream_id, stream_day, started_at) values ($1, $2, $3)',
        [live.streamId, streamDay, live.startedAt],
      );
      return { streamId: live.streamId, streamDay, startedAt: live.startedAt };
    });
  }

  /** Idempotent: closes the open session, if any. */
  async offline(endedAt: Date = this.clock.now()): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        'stream_sessions',
      ]);
      await closeOpenSessions(q, endedAt);
    });
  }

  /** Reconciles with a Twitch snapshot. `null` must only be passed when Twitch confirmed offline. */
  async sync(live: StreamLiveInput | null): Promise<ActiveSession | null> {
    if (live) return this.online(live);
    await this.offline();
    return null;
  }
}

async function closeOpenSessions(q: Queryable, endedAt: Date): Promise<void> {
  await q.query(
    'update stream_sessions set ended_at = greatest(started_at, $1) where ended_at is null',
    [endedAt],
  );
}
