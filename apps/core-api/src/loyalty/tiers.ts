import type {
  SubscriptionSnapshot,
  SubTier,
  TierStatus,
  Viewer,
} from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';
import { ensureViewers } from '../wallet/wallet-service.js';

// Subscription tier cache. A viewer present in the table has that tier. A viewer absent is "none"
// only if a complete snapshot is recent enough; otherwise the tier is "unknown" (a T3 is never
// silently downgraded to non-sub).

export const SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export async function resolveTiers(
  q: Queryable,
  ids: string[],
  now: Date,
): Promise<Map<string, TierStatus>> {
  const rows = await q.query<{ twitch_user_id: string; tier: SubTier }>(
    'select twitch_user_id, tier from viewer_subscriptions where twitch_user_id = any($1::text[])',
    [ids],
  );
  const sync = (
    await q.query<{ last_snapshot_at: Date }>(
      'select last_snapshot_at from loyalty_sub_sync where id = 1',
    )
  )[0];
  const fresh =
    !!sync &&
    now.getTime() - sync.last_snapshot_at.getTime() <= SNAPSHOT_MAX_AGE_MS;
  const known = new Map(rows.map((r) => [r.twitch_user_id, r.tier]));
  return new Map(
    ids.map((id) => [id, known.get(id) ?? (fresh ? 'none' : 'unknown')]),
  );
}

export async function setSubscription(
  q: Queryable,
  viewer: Viewer,
  tier: SubTier,
  isGift: boolean,
): Promise<void> {
  await ensureViewers(q, [viewer]);
  await q.query(
    `insert into viewer_subscriptions (twitch_user_id, tier, is_gift, source) values ($1, $2, $3, 'event')
     on conflict (twitch_user_id) do update set tier = excluded.tier, is_gift = excluded.is_gift,
       source = 'event', updated_at = now()`,
    [viewer.twitchUserId, tier, isGift],
  );
}

export async function endSubscription(
  q: Queryable,
  twitchUserId: string,
): Promise<void> {
  await q.query('delete from viewer_subscriptions where twitch_user_id = $1', [
    twitchUserId,
  ]);
}

/** Replaces the whole cache with a complete Twitch snapshot (never called with a partial one). */
export async function applySnapshot(
  q: Queryable,
  snapshot: SubscriptionSnapshot,
): Promise<{
  count: number;
  /** Roue du Sub R7: paid subscribers absent from the known state, when a previous snapshot exists (else none). */
  added: SubscriptionSnapshot['subscribers'];
  previousAt: Date | null;
}> {
  const subs = snapshot.subscribers;
  const previousAt =
    (
      await q.query<{ last_snapshot_at: Date }>(
        'select last_snapshot_at from loyalty_sub_sync where id = 1',
      )
    )[0]?.last_snapshot_at ?? null;
  const known = new Set(
    (
      await q.query<{ id: string }>(
        'select twitch_user_id as id from viewer_subscriptions where twitch_user_id = any($1::text[])',
        [subs.map((s) => s.viewer.twitchUserId)],
      )
    ).map((r) => r.id),
  );
  const added = previousAt
    ? subs.filter((s) => !s.isGift && !known.has(s.viewer.twitchUserId))
    : [];
  await ensureViewers(
    q,
    subs.map((s) => s.viewer),
  );
  const ids = subs.map((s) => s.viewer.twitchUserId);
  await q.query(
    'delete from viewer_subscriptions where not (twitch_user_id = any($1::text[]))',
    [ids],
  );
  if (subs.length) {
    await q.query(
      `insert into viewer_subscriptions (twitch_user_id, tier, is_gift, source)
       select * , 'snapshot' from unnest($1::text[], $2::text[], $3::boolean[])
       on conflict (twitch_user_id) do update set tier = excluded.tier, is_gift = excluded.is_gift,
         source = 'snapshot', updated_at = now()`,
      [ids, subs.map((s) => s.tier), subs.map((s) => s.isGift)],
    );
  }
  await q.query(
    `insert into loyalty_sub_sync (id, last_snapshot_at, subscriber_count) values (1, $1, $2)
     on conflict (id) do update set last_snapshot_at = excluded.last_snapshot_at, subscriber_count = excluded.subscriber_count`,
    [new Date(snapshot.fetchedAt), subs.length],
  );
  return { count: subs.length, added, previousAt };
}
