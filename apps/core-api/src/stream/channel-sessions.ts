import type { Queryable } from '../db/db.js';

// ASTRA-P1-007 (lot 1): the stream session of a channel as the live-dependent modules see it
// (Tombola, Commands V2), in ONE place: one reader for every module, one lock for every writer.
// A Twitch-sourced session is identified by its Twitch stream id, like the canonical
// stream_sessions (stream-sessions.ts): one session per live. A simulated session (« Simuler début
// de stream », Lab only) is explicit (source = 'simulated', no Twitch id). The stream-day (Daily,
// Loyalty) stays a separate notion derived from stream_sessions, never from this table.

export interface ChannelSession {
  session_id: string;
  started_at: Date;
  ended_at: Date | null;
  source: 'simulated' | 'twitch';
  twitch_stream_id: string | null;
}

const COLUMNS = 'session_id, started_at, ended_at, source, twitch_stream_id';

/**
 * Serializes every session transition of a channel (Twitch events, Studio simulation). Always the
 * FIRST lock of such a transaction: no cycle with the Tombola row locks taken afterwards.
 */
export async function lockChannelSessions(q: Queryable, channelId: string) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [
    `lab_stream_sessions:${channelId}`,
  ]);
}

/** The open session of the channel, if any (at most one: unique index). */
export async function liveChannelSession(
  q: Queryable,
  channelId: string,
): Promise<ChannelSession | null> {
  return (
    (
      await q.query<ChannelSession>(
        `select ${COLUMNS} from lab_stream_sessions where channel_id = $1 and ended_at is null`,
        [channelId],
      )
    )[0] ?? null
  );
}

/** The session « ce stream » refers to: the open one, else the last one (open first, then latest). */
export async function latestChannelSession(
  q: Queryable,
  channelId: string,
): Promise<ChannelSession | null> {
  return (
    (
      await q.query<ChannelSession>(
        `select ${COLUMNS} from lab_stream_sessions where channel_id = $1
         order by (ended_at is null) desc, started_at desc limit 1`,
        [channelId],
      )
    )[0] ?? null
  );
}

/** A session of this Twitch live, if it was already recorded. */
export async function twitchChannelSession(
  q: Queryable,
  channelId: string,
  twitchStreamId: string,
): Promise<(ChannelSession & { newer: boolean }) | null> {
  const row = (
    await q.query<ChannelSession>(
      `select ${COLUMNS} from lab_stream_sessions where channel_id = $1 and twitch_stream_id = $2`,
      [channelId, twitchStreamId],
    )
  )[0];
  if (!row) return null;
  // Only a later TWITCH session makes this live stale (a simulation never does).
  const newer = await q.query(
    `select 1 from lab_stream_sessions where channel_id = $1 and source = 'twitch' and started_at > $2 limit 1`,
    [channelId, row.started_at],
  );
  return { ...row, newer: newer.length > 0 };
}
