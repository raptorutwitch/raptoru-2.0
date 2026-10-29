import type { Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import { CurrencyCreditError } from '../raffle-lab/currencies.js';
import { move } from './ledger.js';

// Bonbons as a Tombola reward (docs/HALLOWEEN.md): the Tombola pays its winners through its economy port; this wrapper
// routes ONE currency, `bonbons`, to the event ledger and leaves every other one (Jetons, credits) to the runtime's
// economy, untouched. The draw, the split, the per-winner payout state and its retries stay the Tombola's own:
// - accepted only while the channel's event is open (a closed event: the round cannot be configured in Bonbons, and a
//   payout attempted then is recorded as failed — retried later like any other failed payout);
// - one credit per round and winner (key `raffle:<round>:<viewer>`): a retried payout or a second draw path finds the
//   first credit and never pays twice;
// - entering a Tombola stays free (nothing here is bought).

export const BONBONS = 'bonbons';

const settingsOf = async (q: Queryable, channelId: string) =>
  (
    await q.query<{ season: string; enabled: boolean }>(
      'select season, enabled from event_shop_settings where channel_id = $1',
      [channelId],
    )
  )[0] ?? null;

export function withBonbonsRewards(base: EconomyPort): EconomyPort {
  const wrapped: EconomyPort = Object.create(base);
  wrapped.acceptsCurrency = async (q, currency) => {
    if (currency !== BONBONS) return base.acceptsCurrency(q, currency);
    // Any channel with an open event (the Tombola checks the currency before it knows more).
    const open = await q.query(
      'select 1 from event_shop_settings where enabled limit 1',
    );
    return open.length > 0;
  };
  wrapped.move = async (q, now, m) => {
    if (m.currency !== BONBONS) return base.move(q, now, m);
    if (m.kind !== 'raffle_win' || !m.raffleId || m.amount <= 0)
      throw new CurrencyCreditError(
        'currency_unavailable',
        'Bonbons: Tombola winnings only',
      );
    const s = await settingsOf(q, m.channelId);
    if (!s?.enabled)
      throw new CurrencyCreditError(
        'currency_unavailable',
        'Bonbons: the event is closed',
      );
    const name =
      (
        await q.query<{ viewer_display_name: string }>(
          'select viewer_display_name from lab_raffle_winners where raffle_id = $1 and viewer_id = $2',
          [m.raffleId, m.viewerId],
        )
      )[0]?.viewer_display_name ?? m.viewerId;
    const r = await move(q, {
      season: s.season,
      channelId: m.channelId,
      viewer: { id: m.viewerId, name },
      kind: 'raffle',
      amount: m.amount,
      key: `raffle:${m.raffleId}:${m.viewerId}`,
      reference: m.raffleId,
      actor: 'raffle',
      reason: 'Tombola',
      now,
    });
    return { balanceAfter: r.balance_after, ledgerId: r.id };
  };
  wrapped.raffleWins = async (q, raffleId) => {
    const own = await base.raffleWins(q, raffleId);
    const bonbons = await q.query<{
      id: string;
      viewer_id: string;
      amount: string;
      created_at: Date;
    }>(
      `select id, viewer_id, amount, created_at from event_ledger where kind = 'raffle' and reference = $1`,
      [raffleId],
    );
    return [
      ...own,
      ...bonbons.map((b) => ({
        id: Number(b.id),
        viewer_id: b.viewer_id,
        amount: Number(b.amount),
        currency: BONBONS,
        created_at: b.created_at,
      })),
    ];
  };
  return wrapped;
}
