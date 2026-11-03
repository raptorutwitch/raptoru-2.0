import type { Db } from '../db/db.js';

// Statistiques des modules par viewer (raptoru.fr lot 4, docs/MODULE_STATS.md): read-only aggregates computed from the
// tables each module ALREADY writes in production — nothing new is recorded, nothing is estimated.
// - paid interactions (Bonk, TTS, Soundboard…): the canonical Wallet's debits `interaction:<id>:debit` (source = the
//   module), minus those refunded (`interaction:<id>:refund`). A free use leaves no trace and is not counted;
// - Random Ban: rb_requests in `real` mode (sent, landed on someone else, turned against the buyer, flops, received);
// - roulette / machine à sous: mini_game_plays; duels: mini_game_duels (resolved only);
// - Roue du Sub: sw_spins from Twitch, shown;
// - Screamers (event shop): event_shop_purchases completed and not refunded.
// Each source also gives `since`: the first record the Core holds for it on the channel. Anything before (SAMMI,
// StreamElements, the old site) is not in these tables and is never recomputed here.
// Owner-only for now (the site token): which totals become public is Antoni's decision (ROADMAP_SITE.md § 4.1).

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;
const n = (v: string | number | null | undefined) => Number(v ?? 0);

export class ModuleStatsService {
  private sinceCache: {
    at: number;
    value: Record<string, string | null>;
  } | null = null;

  constructor(
    private readonly db: Pick<Db, 'query'>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Channel-wide: since when each source holds data (cached 10 min — it only moves when a module starts). */
  async since(channelId: string) {
    if (this.sinceCache && this.now() - this.sinceCache.at < 600_000)
      return this.sinceCache.value;
    const r = (
      await this.db.query<Record<string, Date | null>>(
        `select
           (select min(t.created_at) from wallet_transactions t join wallet_operations o on o.id = t.operation_id
             where o.idempotency_key like 'interaction:%:debit') as interactions,
           (select min(created_at) from rb_requests where channel_id = $1 and mode = 'real') as random_ban,
           (select min(created_at) from mini_game_plays where channel_id = $1) as mini_games,
           (select min(created_at) from mini_game_duels where channel_id = $1) as duels,
           (select min(created_at) from sw_spins where channel_id = $1 and source = 'twitch') as sub_wheel,
           (select min(created_at) from event_shop_purchases where channel_id = $1) as screamers`,
        [channelId],
      )
    )[0]!;
    const value = Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, iso(v)]),
    );
    this.sinceCache = { at: this.now(), value };
    return value;
  }

  async viewer(channelId: string, viewerId: string) {
    const q = this.db;
    const [paid, rb, plays, duels, spins, screamers, since] = await Promise.all(
      [
        q.query<{ module: string; uses: string }>(
          `select t.source as module, count(*) as uses
         from wallet_transactions t join wallet_operations o on o.id = t.operation_id
         where t.twitch_user_id = $1 and o.idempotency_key like 'interaction:%:debit' and t.amount < 0
           and not exists (select 1 from wallet_operations r
             where r.idempotency_key = left(o.idempotency_key, -6) || ':refund' and r.status = 'applied')
         group by t.source order by t.source`,
          [viewerId],
        ),
        q.query<Record<string, string>>(
          `select count(*) filter (where buyer_id = $2) as sent,
           count(*) filter (where buyer_id = $2 and status = 'confirmed' and target_id is distinct from buyer_id) as landed,
           count(*) filter (where buyer_id = $2 and status = 'confirmed' and target_id = buyer_id) as backfired,
           count(*) filter (where buyer_id = $2 and status = 'flop') as flops,
           count(*) filter (where target_id = $2 and buyer_id <> $2 and status = 'confirmed') as received
         from rb_requests where channel_id = $1 and mode = 'real' and (buyer_id = $2 or target_id = $2)`,
          [channelId, viewerId],
        ),
        q.query<{ game: string; plays: string; wins: string }>(
          `select game, count(*) as plays, count(*) filter (where won) as wins
         from mini_game_plays where channel_id = $1 and viewer_id = $2 group by game order by game`,
          [channelId, viewerId],
        ),
        q.query<Record<string, string>>(
          `select count(*) as played, count(*) filter (where winner_id = $2) as won
         from mini_game_duels where channel_id = $1 and status = 'resolved' and (challenger_id = $2 or target_id = $2)`,
          [channelId, viewerId],
        ),
        q.query<Record<string, string>>(
          `select count(*) as spins from sw_spins
         where channel_id = $1 and viewer_id = $2 and source = 'twitch' and status = 'shown'`,
          [channelId, viewerId],
        ),
        q.query<{ season: string; bought: string }>(
          `select season, count(*) as bought from event_shop_purchases
         where channel_id = $1 and viewer_id = $2 and status = 'completed' and refund_status = 'none'
         group by season order by season`,
          [channelId, viewerId],
        ),
        this.since(channelId),
      ],
    );
    const game = (g: string) => plays.find((p) => p.game === g);
    return {
      viewer: viewerId,
      // Paid uses per module, as the Wallet recorded them (refunded ones removed).
      interactions: Object.fromEntries(paid.map((p) => [p.module, n(p.uses)])),
      random_ban: {
        sent: n(rb[0]?.sent),
        landed: n(rb[0]?.landed),
        backfired: n(rb[0]?.backfired),
        flops: n(rb[0]?.flops),
        received: n(rb[0]?.received),
      },
      roulette: {
        plays: n(game('roulette')?.plays),
        wins: n(game('roulette')?.wins),
      },
      slot: { plays: n(game('slot')?.plays), wins: n(game('slot')?.wins) },
      duels: { played: n(duels[0]?.played), won: n(duels[0]?.won) },
      sub_wheel: { spins: n(spins[0]?.spins) },
      screamers: Object.fromEntries(
        screamers.map((s) => [s.season, n(s.bought)]),
      ),
      since,
    };
  }
}
