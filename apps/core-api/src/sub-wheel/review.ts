import type { Queryable } from '../db/db.js';

// Roue du Sub V2, lot R2 — rights « À vérifier » (decision of 21/10/2026). Two rights of one viewer that may stand for
// the SAME subscription month, without a proof reliable enough to join them (same Twitch event, certain month, or a
// proof of another source within 10 min — rights.ts), are both kept; the suspect one is blocked until a human decides
// (lot R4: two distinct months, merge, or left unresolved). Never decided on time proximity: the only trigger is the
// same month, one of the two months at least being an estimate (two certain months never share a right: unique index;
// two certain rights of one month are the certain-duplicate detector's, never a review). Every draw path goes through
// draw(), which refuses a right under review (needs_review). A review never changes a right, its proofs or a gain.

interface Right {
  spin_id: string;
  channel_id: string;
  viewer_id: string | null;
  source: string;
  type: string;
  months: number;
  sub_month: number | null;
  month_source: string | null;
  status: string;
  acquired_at: Date | null;
  created_at: Date;
  /** Twitch time of its first proof (read here): the order of two rights is Twitch's, never the processing order. */
  first_at?: Date | null;
}

/** The month a right stands for: its V2 month, or a V1 resub's cumulative months (rows from before R1). */
const monthOf = (r: Right) =>
  r.sub_month ??
  (r.month_source === null && r.source === 'twitch' && r.type === 'resub'
    ? r.months
    : null);
const certain = (r: Right) =>
  r.month_source === 'twitch' ||
  (r.month_source === null && r.source === 'twitch' && r.type === 'resub');
const undrawn = (r: Right) => r.status === 'owed' || r.status === 'requested';
const at = (r: Right) =>
  new Date(r.first_at ?? r.acquired_at ?? r.created_at).getTime();
const FIRST_AT =
  '(select min(p.occurred_at) from sw_spin_sources p where p.spin_id = s.spin_id) as first_at';

/** Statuses that keep a right blocked: open (detected) and unresolved (left so by a human, lot R4). */
export const BLOCKING = ['open', 'unresolved'] as const;

export async function underReview(
  q: Queryable,
  spinId: string,
): Promise<boolean> {
  return (
    (
      await q.query(
        `select 1 from sw_spin_reviews where spin_id = $1 and status = any($2::text[]) limit 1`,
        [spinId, BLOCKING],
      )
    ).length > 0
  );
}

/**
 * After a right was created or got its month (under the viewer lock): every other right of the viewer with the same
 * month, one of the two months estimated, opens a review on the suspect one — the one not drawn yet (a drawn right is
 * never undone); both undrawn: the estimated one, else the later one. Nothing to block (both drawn): no review.
 */
export async function flagSameMonth(
  q: Queryable,
  r: Right,
  now: Date,
): Promise<void> {
  const month = monthOf(r);
  if (month === null || !r.viewer_id) return;
  const self = (
    await q.query<{ first_at: Date | null }>(
      `select ${FIRST_AT} from sw_spins s where s.spin_id = $1`,
      [r.spin_id],
    )
  )[0];
  r = { ...r, first_at: self?.first_at ?? null };
  const others = await q.query<Right>(
    `select s.*, ${FIRST_AT} from sw_spins s
     where channel_id = $1 and viewer_id = $2 and spin_id <> $3 and status <> 'merged'
       and coalesce(sub_month, case when month_source is null and source = 'twitch' and type = 'resub'
                                    then months end) = $4
     order by created_at, spin_id`,
    [r.channel_id, r.viewer_id, r.spin_id, month],
  );
  for (const seen of others) {
    if (certain(r) && certain(seen)) continue;
    // Both rights locked (in spin_id order: never a lock cycle), then decided on their state NOW: a draw committed
    // meanwhile (claimAnimation on another Core) makes the OTHER right the suspect — a review and a draw of one right
    // never cross, and a month is never left drawable twice.
    const fresh = await q.query<Right>(
      'select * from sw_spins where spin_id = any($1::uuid[]) order by spin_id for update',
      [[r.spin_id, seen.spin_id]],
    );
    const me = fresh.find((x) => x.spin_id === r.spin_id);
    const o = fresh.find((x) => x.spin_id === seen.spin_id);
    if (!me || !o || o.status === 'merged') continue;
    me.first_at = r.first_at;
    o.first_at = seen.first_at;
    const open = [me, o].filter(undrawn);
    if (!open.length) continue;
    const suspect =
      open.length === 1
        ? open[0]!
        : certain(me) !== certain(o)
          ? certain(me)
            ? o
            : me
          : at(me) > at(o) || (at(me) === at(o) && me.spin_id > o.spin_id)
            ? me
            : o;
    const other = suspect === me ? o : me;
    // A pair already examined (either way round, open or decided by a human) is never reviewed again.
    const known = await q.query(
      `select 1 from sw_spin_reviews
       where (spin_id = $1 and other_spin_id = $2) or (spin_id = $2 and other_spin_id = $1) limit 1`,
      [me.spin_id, o.spin_id],
    );
    if (known.length) continue;
    await q.query(
      `insert into sw_spin_reviews (channel_id, viewer_id, spin_id, other_spin_id, reason, month, detail, status,
         created_at)
       values ($1, $2, $3, $4, 'same_month', $5, $6, 'open', $7)
       on conflict (spin_id, other_spin_id) do nothing`,
      [
        r.channel_id,
        r.viewer_id,
        suspect.spin_id,
        other.spin_id,
        month,
        JSON.stringify({
          suspect: {
            month_source: suspect.month_source,
            status: suspect.status,
          },
          other: { month_source: other.month_source, status: other.status },
        }),
        now,
      ],
    );
  }
}

/**
 * A right whose month became certain (a Twitch proof): its open reviews whose two months now differ are closed
 * (auto_distinct — the proof showed two months). Then the same-month check runs again with its new month.
 */
export async function recheckAfterConfirmation(
  q: Queryable,
  r: Right,
  now: Date,
): Promise<void> {
  await q.query(
    `update sw_spin_reviews v set status = 'auto_distinct', resolved_at = $2, resolved_by = 'twitch_proof'
     from sw_spins a, sw_spins b
     where v.status = 'open' and (v.spin_id = $1 or v.other_spin_id = $1)
       and a.spin_id = v.spin_id and b.spin_id = v.other_spin_id
       and coalesce(a.sub_month,
             case when a.month_source is null and a.source = 'twitch' and a.type = 'resub' then a.months end)
         is distinct from coalesce(b.sub_month,
             case when b.month_source is null and b.source = 'twitch' and b.type = 'resub' then b.months end)`,
    [r.spin_id, now],
  );
  await flagSameMonth(q, r, now);
}

/** Studio (R4 shows them): the rights blocked « À vérifier », with both rights and their proofs. */
export async function openReviews(q: Queryable, channelId: string) {
  return q.query<{
    review_id: string | number;
    status: string;
    month: number;
    created_at: Date;
    viewer_id: string;
    suspect: Record<string, unknown>;
    other: Record<string, unknown>;
  }>(
    `select v.id as review_id, v.status, v.month, v.created_at, v.viewer_id,
       json_build_object('spin_id', a.spin_id, 'status', a.status, 'sub_month', a.sub_month,
         'month_source', a.month_source, 'queue', a.queue, 'acquired_at', a.acquired_at,
         'award_status', a.award_status, 'tier', a.tier, 'viewer_name', a.viewer_name,
         'sources', (select coalesce(json_agg(json_build_object('source', p.source, 'occurred_at', p.occurred_at,
            'months', p.months) order by p.id), '[]') from sw_spin_sources p where p.spin_id = a.spin_id)) as suspect,
       json_build_object('spin_id', b.spin_id, 'status', b.status, 'sub_month', coalesce(b.sub_month, b.months),
         'month_source', b.month_source, 'amount', b.amount, 'acquired_at', coalesce(b.acquired_at, b.created_at),
         'sources', (select coalesce(json_agg(json_build_object('source', p.source, 'occurred_at', p.occurred_at,
            'months', p.months) order by p.id), '[]') from sw_spin_sources p where p.spin_id = b.spin_id)) as other
     from sw_spin_reviews v join sw_spins a on a.spin_id = v.spin_id join sw_spins b on b.spin_id = v.other_spin_id
     where v.channel_id = $1 and v.status = any($2::text[])
     order by v.created_at, v.id`,
    [channelId, BLOCKING],
  );
}

/**
 * « Possible doublon » (R4, informative only — never a block, never a merge): two rights of one viewer, one month at
 * least estimated, whose first Twitch proofs are less than 28 days apart (the shortest billing month) and that no
 * review covers. An estimate lower than the real month can hide the same renewal behind two different months (R2's
 * known limit): this only shows it.
 */
export const POSSIBLE_DUPLICATE_MS = 28 * 86_400_000;

export async function possibleDuplicates(q: Queryable, channelId: string) {
  return q.query<{
    viewer_id: string;
    viewer_name: string;
    days_apart: number;
    a: Record<string, unknown>;
    b: Record<string, unknown>;
  }>(
    `with r as (
       select s.spin_id, s.viewer_id, s.viewer_name, s.status, s.sub_month, s.month_source, s.queue, s.amount,
         s.award_status,
         coalesce((select min(p.occurred_at) from sw_spin_sources p where p.spin_id = s.spin_id), s.created_at) as t
       from sw_spins s
       where s.channel_id = $1 and s.viewer_id is not null and s.source = 'twitch' and s.status <> 'merged'
         and s.sub_month is not null)
     select a.viewer_id, b.viewer_name,
       round((abs(extract(epoch from (a.t - b.t))) / 86400)::numeric, 1)::float as days_apart,
       json_build_object('spin_id', a.spin_id, 'status', a.status, 'sub_month', a.sub_month,
         'month_source', a.month_source, 'award_status', a.award_status, 'amount', a.amount, 'at', a.t) as a,
       json_build_object('spin_id', b.spin_id, 'status', b.status, 'sub_month', b.sub_month,
         'month_source', b.month_source, 'award_status', b.award_status, 'amount', b.amount, 'at', b.t) as b
     from r a join r b on b.viewer_id = a.viewer_id and a.t < b.t
     where (a.month_source like 'estimated%' or b.month_source like 'estimated%')
       and extract(epoch from (b.t - a.t)) * 1000 < $2
       and not exists (select 1 from sw_spin_reviews v
         where (v.spin_id = a.spin_id and v.other_spin_id = b.spin_id)
            or (v.spin_id = b.spin_id and v.other_spin_id = a.spin_id))
     order by b.t desc
     limit 50`,
    [channelId, POSSIBLE_DUPLICATE_MS],
  );
}
