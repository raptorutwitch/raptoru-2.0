import type { Queryable } from '../db/db.js';

// Read-only Loyalty report for one stream: what each viewer earned (credit) or would have earned
// (preview), with the frozen breakdowns. "Aouh would have earned X Jetons."

interface PassiveRow {
  twitch_user_id: string;
  login: string;
  display_name: string;
  validated_seconds: number;
  ticks: number;
}

interface RewardRow {
  twitch_user_id: string;
  source: string;
  status: string;
  amount: number | null;
  breakdown: {
    tier?: string;
    tierMultiplier?: number | null;
    personalOverride?: number | null;
    effectiveMultiplier?: number | null;
    candidates?: Record<string, number>;
    mode?: string;
  };
  created_at: Date;
  login: string;
  display_name: string;
}

export async function latestLoyaltyStreamId(
  q: Queryable,
): Promise<string | null> {
  const row = (
    await q.query<{ stream_id: string }>(
      `select p.stream_id from loyalty_passive_progress p join stream_sessions s using (stream_id)
       order by s.started_at desc limit 1`,
    )
  )[0];
  return row?.stream_id ?? null;
}

export async function buildLoyaltyReport(
  q: Queryable,
  streamId: string,
  now: Date,
) {
  const session = (
    await q.query<{
      started_at: Date;
      ended_at: Date | null;
      stream_day: string;
    }>(
      'select started_at, ended_at, stream_day from stream_sessions where stream_id = $1',
      [streamId],
    )
  )[0];
  if (!session) return null;
  const end = session.ended_at ?? now;

  const progress = await q.query<PassiveRow>(
    `select p.twitch_user_id, v.login, v.display_name, p.validated_seconds, p.ticks
     from loyalty_passive_progress p join viewers v using (twitch_user_id) where p.stream_id = $1`,
    [streamId],
  );
  const passive = await q.query<RewardRow>(
    `select r.twitch_user_id, r.source, r.status, r.amount, r.breakdown, r.created_at, v.login, v.display_name
     from loyalty_rewards r join viewers v using (twitch_user_id)
     where r.stream_id = $1 and r.source = 'passive_watch' order by r.id`,
    [streamId],
  );
  const events = await q.query<RewardRow>(
    `select r.twitch_user_id, r.source, r.status, r.amount, r.breakdown, r.created_at, v.login, v.display_name
     from loyalty_rewards r join viewers v using (twitch_user_id)
     where r.stream_id is null and r.created_at >= $1 and r.created_at <= $2 order by r.id`,
    [session.started_at, end],
  );

  const viewers = progress.map((p) => {
    const mine = passive.filter((r) => r.twitch_user_id === p.twitch_user_id);
    const counted = mine.filter((r) =>
      ['preview', 'pending', 'credited'].includes(r.status),
    );
    const unknown = mine.filter((r) => r.status === 'tier_unknown');
    const last = mine.at(-1)?.breakdown;
    const candidates = ['none', 't1', 't2', 't3'].map((t) => [
      t,
      unknown.reduce((sum, r) => sum + (r.breakdown.candidates?.[t] ?? 0), 0),
    ]);
    return {
      twitchUserId: p.twitch_user_id,
      login: p.login,
      displayName: p.display_name,
      validatedMinutes: Math.round((p.validated_seconds / 60) * 10) / 10,
      ticks: p.ticks,
      tier: last?.tier ?? null,
      tierMultiplier: last?.tierMultiplier ?? null,
      personalOverride: last?.personalOverride ?? null,
      jetons: counted.reduce((sum, r) => sum + (r.amount ?? 0), 0),
      credited: mine.filter((r) => r.status === 'credited').length,
      tierUnknownTicks: unknown.length,
      /** Totals of the tier_unknown ticks for each possible tier (information only). */
      unknownCandidates: Object.fromEntries(candidates) as Record<
        string,
        number
      >,
      excludedTicks: mine.filter((r) => r.status === 'excluded').length,
    };
  });
  viewers.sort(
    (a, b) =>
      b.jetons - a.jetons ||
      b.ticks - a.ticks ||
      a.login.localeCompare(b.login),
  );

  return {
    streamId,
    streamDay: session.stream_day,
    startedAt: session.started_at.toISOString(),
    endedAt: session.ended_at?.toISOString() ?? null,
    modes: [
      ...new Set([...passive, ...events].map((r) => r.breakdown.mode ?? '?')),
    ],
    totals: {
      viewers: viewers.length,
      ticks: viewers.reduce((s, v) => s + v.ticks, 0),
      passiveJetons: viewers.reduce((s, v) => s + v.jetons, 0),
      tierUnknownTicks: viewers.reduce((s, v) => s + v.tierUnknownTicks, 0),
      eventJetons: events.reduce((s, r) => s + (r.amount ?? 0), 0),
    },
    viewers,
    events: events.map((r) => ({
      source: r.source,
      login: r.login,
      status: r.status,
      amount: r.amount,
      at: r.created_at.toISOString(),
      breakdown: r.breakdown,
    })),
  };
}

export type LoyaltyReport = NonNullable<
  Awaited<ReturnType<typeof buildLoyaltyReport>>
>;

export function formatLoyaltyReport(r: LoyaltyReport): string {
  const t = r.totals;
  const lines = [
    `=== LOYALTY REPORT (${r.modes.join('/') || 'no rewards'}) — preview = NO WALLET WRITE ===`,
    `stream ${r.streamId} (stream-day ${r.streamDay}) · ${r.startedAt} → ${r.endedAt ?? 'still live'}`,
    `viewers ${t.viewers} · passive ticks ${t.ticks} · passive Jetons ${t.passiveJetons} · tier unknown ticks ${t.tierUnknownTicks} · event Jetons ${t.eventJetons}`,
    '',
    'login | validated min | ticks | tier | multiplier | Jetons | tier-unknown ticks (if none/t1/t2/t3) | excluded',
    ...r.viewers.map((v) => {
      const unknown = v.tierUnknownTicks
        ? `${v.tierUnknownTicks} (${v.unknownCandidates.none}/${v.unknownCandidates.t1}/${v.unknownCandidates.t2}/${v.unknownCandidates.t3})`
        : '0';
      const mult = v.personalOverride
        ? `x${v.personalOverride} (override)`
        : v.tierMultiplier
          ? `x${v.tierMultiplier}`
          : '—';
      return `${v.login} | ${v.validatedMinutes} | ${v.ticks} | ${v.tier ?? '—'} | ${mult} | ${v.jetons} | ${unknown} | ${v.excludedTicks}`;
    }),
    '',
    'events:',
    ...(r.events.length
      ? r.events.map(
          (e) =>
            `  ${e.at} ${e.source} ${e.login} ${e.amount ?? '—'} (${e.status})`,
        )
      : ['  none']),
  ];
  return lines.join('\n');
}

export function loyaltyReportCsv(r: LoyaltyReport): string {
  const header =
    'twitch_user_id,login,validated_minutes,ticks,tier,tier_multiplier,personal_override,jetons,tier_unknown_ticks,if_none,if_t1,if_t2,if_t3,excluded_ticks';
  const rows = r.viewers.map((v) =>
    [
      v.twitchUserId,
      v.login,
      v.validatedMinutes,
      v.ticks,
      v.tier ?? '',
      v.tierMultiplier ?? '',
      v.personalOverride ?? '',
      v.jetons,
      v.tierUnknownTicks,
      v.unknownCandidates.none,
      v.unknownCandidates.t1,
      v.unknownCandidates.t2,
      v.unknownCandidates.t3,
      v.excludedTicks,
    ].join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}
