import type { Queryable } from '../db/db.js';

// One-shot import of the legacy raptoru.fr Daily history (players + daily_events) into Core.
// Isolated tool: only used by scripts/import-legacy-daily.ts, never by the Daily runtime.
// Legacy windows 'YYYY-MM-DD_16h30' (and their '#id' / 'v2|…|' variants) become stream-day D.
// Historical payments were made by SAMMI, so no credit is created.

// Legacy rows marking an aired window, not a viewer claim.
const LEGACY_MARKER_ID = '__daily_stream__';

export interface LegacyPlayerRow {
  twitch_user_id: string;
  login: string | null;
  display_name: string | null;
  total_daily: number | null;
  current_streak: number | null;
  best_streak: number | null;
  last_daily_stream: string | null;
}

export interface LegacyDailyEventRow {
  id: number;
  twitch_user_id: string;
  pseudo: string;
  stream_id: string;
  streak_at_time: number;
  total_at_time: number;
  reward_at_time: number;
  created_at: Date | null;
}

export interface ImportPlan {
  streamDays: { day: string; openedAt: Date }[];
  viewers: { twitchUserId: string; login: string; displayName: string }[];
  stats: {
    twitchUserId: string;
    totalDaily: number;
    currentStreak: number;
    bestStreak: number;
    lastClaimDay: string | null;
  }[];
  claims: {
    twitchUserId: string;
    streamDay: string;
    claimedAt: Date;
    streakAfter: number;
    totalAfter: number;
    reward: number;
  }[];
  warnings: string[];
}

export function legacyWindowDay(value: string | null): string | null {
  const match = /(\d{4}-\d{2}-\d{2})_16h30/.exec(String(value ?? ''));
  return match ? match[1]! : null;
}

export function buildLegacyImport(
  players: LegacyPlayerRow[],
  events: LegacyDailyEventRow[],
): ImportPlan {
  const warnings: string[] = [];
  const dayOpenedAt = new Map<string, Date>();
  const noteDay = (day: string, at: Date | null) => {
    const current = dayOpenedAt.get(day);
    const value = at ?? new Date(`${day}T14:00:00Z`);
    if (!current || value < current) dayOpenedAt.set(day, value);
  };

  const claimsByKey = new Map<string, ImportPlan['claims'][number]>();
  const pseudoById = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const day = legacyWindowDay(e.stream_id);
    if (!day) {
      warnings.push(
        `daily_events#${e.id}: unrecognised stream_id "${e.stream_id}"`,
      );
      continue;
    }
    noteDay(day, e.created_at);
    if (e.twitch_user_id === LEGACY_MARKER_ID) continue;
    if (!/^\d+$/.test(e.twitch_user_id)) {
      warnings.push(
        `daily_events#${e.id}: non-numeric twitch_user_id "${e.twitch_user_id}"`,
      );
      continue;
    }
    pseudoById.set(e.twitch_user_id, e.pseudo);
    const key = `${e.twitch_user_id}|${day}`;
    if (claimsByKey.has(key)) {
      warnings.push(
        `daily_events#${e.id}: duplicate claim for ${key}, kept the first one`,
      );
      continue;
    }
    claimsByKey.set(key, {
      twitchUserId: e.twitch_user_id,
      streamDay: day,
      claimedAt: e.created_at ?? new Date(`${day}T14:00:00Z`),
      streakAfter: Math.max(1, Number(e.streak_at_time) || 1),
      totalAfter: Math.max(1, Number(e.total_at_time) || 1),
      reward: Math.max(0, Number(e.reward_at_time) || 0),
    });
  }
  const claims = [...claimsByKey.values()];

  const claimsByViewer = new Map<string, ImportPlan['claims']>();
  for (const c of claims) {
    claimsByViewer.set(c.twitchUserId, [
      ...(claimsByViewer.get(c.twitchUserId) ?? []),
      c,
    ]);
  }

  const viewers: ImportPlan['viewers'] = [];
  const stats: ImportPlan['stats'] = [];
  const playerIds = new Set<string>();
  for (const p of players) {
    playerIds.add(p.twitch_user_id);
    const own = claimsByViewer.get(p.twitch_user_id) ?? [];
    const total = Math.max(Number(p.total_daily) || 0, own.length);
    if (total === 0) continue; // Jeu des mots player who never did a Daily.
    if (!/^\d+$/.test(p.twitch_user_id)) {
      warnings.push(`players ${p.twitch_user_id}: non-numeric twitch_user_id`);
      continue;
    }
    const lastDay =
      legacyWindowDay(p.last_daily_stream) ??
      own
        .map((c) => c.streamDay)
        .sort()
        .at(-1) ??
      null;
    if (lastDay) noteDay(lastDay, null);
    const currentStreak = Math.max(0, Number(p.current_streak) || 0);
    const displayName =
      p.display_name || pseudoById.get(p.twitch_user_id) || p.twitch_user_id;
    viewers.push({
      twitchUserId: p.twitch_user_id,
      login: (p.login || displayName).toLowerCase(),
      displayName,
    });
    stats.push({
      twitchUserId: p.twitch_user_id,
      totalDaily: total,
      currentStreak,
      bestStreak: Math.max(Number(p.best_streak) || 0, currentStreak),
      lastClaimDay: lastDay,
    });
  }
  for (const [id, own] of claimsByViewer) {
    if (playerIds.has(id)) continue;
    warnings.push(
      `viewer ${id}: daily_events without players row, stats rebuilt from events`,
    );
    const last = [...own]
      .sort((a, b) => a.streamDay.localeCompare(b.streamDay))
      .at(-1)!;
    const displayName = pseudoById.get(id) ?? id;
    viewers.push({
      twitchUserId: id,
      login: displayName.toLowerCase(),
      displayName,
    });
    stats.push({
      twitchUserId: id,
      totalDaily: own.length,
      currentStreak: last.streakAfter,
      bestStreak: Math.max(...own.map((c) => c.streakAfter)),
      lastClaimDay: last.streamDay,
    });
  }

  return {
    streamDays: [...dayOpenedAt]
      .map(([day, openedAt]) => ({ day, openedAt }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    viewers,
    stats,
    claims,
    warnings,
  };
}

/** Idempotent: rows already present in Core are left untouched. */
export async function applyLegacyImport(
  q: Queryable,
  plan: ImportPlan,
): Promise<void> {
  for (const d of plan.streamDays) {
    await q.query(
      'insert into stream_days (day, opened_at) values ($1, $2) on conflict do nothing',
      [d.day, d.openedAt],
    );
  }
  for (const v of plan.viewers) {
    await q.query(
      'insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3) on conflict do nothing',
      [v.twitchUserId, v.login, v.displayName],
    );
  }
  for (const s of plan.stats) {
    await q.query(
      `insert into daily_stats (twitch_user_id, total_daily, current_streak, best_streak, last_claim_day)
       values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [
        s.twitchUserId,
        s.totalDaily,
        s.currentStreak,
        s.bestStreak,
        s.lastClaimDay,
      ],
    );
  }
  for (const c of plan.claims) {
    await q.query(
      `insert into daily_claims (twitch_user_id, stream_day, source, claimed_at, streak_after, total_after, best_after, reward)
       values ($1, $2, 'import', $3, $4, $5, $4, $6) on conflict do nothing`,
      [
        c.twitchUserId,
        c.streamDay,
        c.claimedAt,
        c.streakAfter,
        c.totalAfter,
        c.reward,
      ],
    );
  }
}
