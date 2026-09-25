import { PRESENCE_INTERVAL_SECONDS } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';

// Read-only post-stream report of the shadow presence tracker.

export const SHADOW_BANNER = 'NO WALLET / NO CREDITS / SHADOW MODE';

export interface PresenceReport {
  mode: typeof SHADOW_BANNER;
  streamId: string;
  streamDay: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  cycles: {
    expected: number;
    total: number;
    ok: number;
    failed: number;
    coveragePercent: number;
    coveredSeconds: number;
    unobservedSeconds: number;
    lastOkAt: string | null;
    workers: number;
  };
  errors: {
    observedAt: string;
    errorKind: string;
    httpStatus: number | null;
    message: string | null;
  }[];
  gaps: { observedAt: string; reason: string }[];
  uniqueViewers: number;
  viewers: {
    twitchUserId: string;
    login: string;
    displayName: string;
    estimatedWatchSeconds: number;
    firstSeenAt: string;
    lastSeenAt: string;
    snapshotsPresent: number;
    intervalsCredited: number;
  }[];
}

export async function latestPresenceStreamId(
  q: Queryable,
): Promise<string | null> {
  const row = (
    await q.query<{ stream_id: string }>(
      'select stream_id from presence_cycles order by observed_at desc limit 1',
    )
  )[0];
  return row?.stream_id ?? null;
}

export async function buildPresenceReport(
  q: Queryable,
  streamId: string,
  now: Date,
): Promise<PresenceReport | null> {
  const session = (
    await q.query<{
      stream_day: string;
      started_at: Date;
      ended_at: Date | null;
    }>(
      'select stream_day, started_at, ended_at from stream_sessions where stream_id = $1',
      [streamId],
    )
  )[0];
  if (!session) return null;

  const cycles = await q.query<{
    observed_at: Date;
    worker_id: string;
    status: 'ok' | 'error';
    error_kind: string | null;
    http_status: number | null;
    error_message: string | null;
    credited_seconds: number;
    gap_reason: string | null;
  }>(
    `select observed_at, worker_id, status, error_kind, http_status, error_message, credited_seconds, gap_reason
     from presence_cycles where stream_id = $1 order by observed_at`,
    [streamId],
  );
  const viewers = await q.query<{
    twitch_user_id: string;
    login: string;
    display_name: string;
    estimated_watch_seconds: number;
    first_seen_at: Date;
    last_seen_at: Date;
    snapshots_present: number;
    intervals_credited: number;
  }>(
    `select p.twitch_user_id, v.login, v.display_name, p.estimated_watch_seconds, p.first_seen_at,
       p.last_seen_at, p.snapshots_present, p.intervals_credited
     from presence_viewer_streams p join viewers v using (twitch_user_id)
     where p.stream_id = $1 order by p.estimated_watch_seconds desc, v.login`,
    [streamId],
  );

  const end = session.ended_at ?? now;
  const durationSeconds = Math.max(
    0,
    Math.round((end.getTime() - session.started_at.getTime()) / 1000),
  );
  const coveredSeconds = cycles.reduce((sum, c) => sum + c.credited_seconds, 0);
  const ok = cycles.filter((c) => c.status === 'ok');

  return {
    mode: SHADOW_BANNER,
    streamId,
    streamDay: session.stream_day,
    startedAt: session.started_at.toISOString(),
    endedAt: session.ended_at?.toISOString() ?? null,
    durationSeconds,
    cycles: {
      expected: Math.floor(durationSeconds / PRESENCE_INTERVAL_SECONDS) + 1,
      total: cycles.length,
      ok: ok.length,
      failed: cycles.length - ok.length,
      coveragePercent: durationSeconds
        ? Math.round((coveredSeconds / durationSeconds) * 1000) / 10
        : 0,
      coveredSeconds,
      unobservedSeconds: Math.max(0, durationSeconds - coveredSeconds),
      lastOkAt: ok.at(-1)?.observed_at.toISOString() ?? null,
      workers: new Set(cycles.map((c) => c.worker_id)).size,
    },
    errors: cycles
      .filter((c) => c.status === 'error')
      .map((c) => ({
        observedAt: c.observed_at.toISOString(),
        errorKind: c.error_kind!,
        httpStatus: c.http_status,
        message: c.error_message,
      })),
    gaps: cycles
      .filter((c) => c.gap_reason !== null)
      .map((c) => ({
        observedAt: c.observed_at.toISOString(),
        reason: c.gap_reason!,
      })),
    uniqueViewers: viewers.length,
    viewers: viewers.map((v) => ({
      twitchUserId: v.twitch_user_id,
      login: v.login,
      displayName: v.display_name,
      estimatedWatchSeconds: v.estimated_watch_seconds,
      firstSeenAt: v.first_seen_at.toISOString(),
      lastSeenAt: v.last_seen_at.toISOString(),
      snapshotsPresent: v.snapshots_present,
      intervalsCredited: v.intervals_credited,
    })),
  };
}

const minutes = (seconds: number) => Math.round(seconds / 6) / 10;

export function formatPresenceReport(r: PresenceReport): string {
  const c = r.cycles;
  const lines = [
    `=== ${r.mode} ===`,
    `stream ${r.streamId} (stream-day ${r.streamDay})`,
    `started ${r.startedAt} · ended ${r.endedAt ?? 'still live'} · duration ${minutes(r.durationSeconds)} min`,
    `cycles: expected ~${c.expected}, recorded ${c.total}, ok ${c.ok}, failed ${c.failed}, workers ${c.workers}`,
    `coverage ${c.coveragePercent}% · unobserved ${minutes(c.unobservedSeconds)} min · last ok snapshot ${c.lastOkAt ?? 'none'}`,
    `unique viewers detected: ${r.uniqueViewers}`,
    '',
    'errors / rate limits:',
    ...(r.errors.length
      ? r.errors.map((e) =>
          `  ${e.observedAt} ${e.errorKind} ${e.httpStatus ?? ''} ${e.message ?? ''}`.trimEnd(),
        )
      : ['  none']),
    '',
    'intervals not credited:',
    ...(r.gaps.length
      ? r.gaps.map((g) => `  ${g.observedAt} ${g.reason}`)
      : ['  none']),
    '',
    'twitch_id | login | display name | est. watch (min) | first seen | last seen | snapshots',
    ...r.viewers.map(
      (v) =>
        `${v.twitchUserId} | ${v.login} | ${v.displayName} | ${minutes(v.estimatedWatchSeconds)} | ${v.firstSeenAt} | ${v.lastSeenAt} | ${v.snapshotsPresent}`,
    ),
    '',
    `=== ${r.mode} ===`,
  ];
  return lines.join('\n');
}

/** CSV ready for a manual/scripted StreamElements comparison (SE columns left empty). */
export function presenceReportCsv(r: PresenceReport): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  const header =
    'twitch_user_id,login,display_name,raptoru_estimated_watch_minutes,streamelements_watch_minutes,diff_minutes,snapshots_present,first_seen_at,last_seen_at';
  const rows = r.viewers.map((v) =>
    [
      v.twitchUserId,
      esc(v.login),
      esc(v.displayName),
      String(minutes(v.estimatedWatchSeconds)),
      '',
      '',
      String(v.snapshotsPresent),
      v.firstSeenAt,
      v.lastSeenAt,
    ].join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}
