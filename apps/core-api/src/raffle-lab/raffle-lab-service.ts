import { randomUUID } from 'node:crypto';
import type {
  LabModerationCommand,
  LabRaffleJoinRequest,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import {
  activeBlock,
  actorName,
  assertNotGloballyPaused,
  audit,
  countGlobalRefusal,
  creditRaffleWin,
  GlobalPauseError,
  moduleState,
  seeViewer,
  setModuleState,
  type Actor,
  type LabRole,
} from '../lab-moderation/store.js';

// Tombola V2, minimal Lab slice (needed by the Moderation V2 D4 console). Real model of the stream:
// free entry from the extension (one per viewer and per round), a jackpot offered by the channel,
// winners paid on the Lab test wallet. Opened, closed and drawn from Studio. Core is the only source
// of truth: the old in-memory simulation of the Lab EBS is no longer used when Core is connected.

export class RaffleLabError409 extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RaffleRow {
  raffle_id: string;
  channel_id: string;
  status: 'open' | 'closed' | 'drawn';
  jackpot: string | number;
  winners_count: number;
  opened_at: Date;
  ends_at: Date;
  closed_at: Date | null;
  drawn_at: Date | null;
  opened_by: string;
}
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const raffleView = (r: RaffleRow, participants: number) => ({
  raffle_id: r.raffle_id,
  status: r.status,
  jackpot: Number(r.jackpot),
  winners_count: r.winners_count,
  opened_at: iso(r.opened_at)!,
  ends_at: iso(r.ends_at)!,
  closed_at: iso(r.closed_at),
  drawn_at: iso(r.drawn_at),
  opened_by: r.opened_by,
  participants,
});

export class RaffleLabService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Injectable for tests (winner draw). */
    private readonly random: () => number = Math.random,
  ) {}

  /** An open round past its end closes by itself (no more entries; the draw stays a Studio action). */
  private async sweep(q: Queryable, channelId: string) {
    await q.query(
      `update lab_raffles set status = 'closed', closed_at = ends_at where channel_id = $1 and status = 'open' and ends_at <= $2`,
      [channelId, this.clock.now()],
    );
  }

  private async latest(q: Queryable, channelId: string) {
    return (
      (
        await q.query<RaffleRow>(
          'select * from lab_raffles where channel_id = $1 order by opened_at desc limit 1',
          [channelId],
        )
      )[0] ?? null
    );
  }

  private async winners(q: Queryable, raffleIds: string[]) {
    if (!raffleIds.length) return [];
    return q.query<{
      raffle_id: string;
      viewer_id: string;
      viewer_display_name: string;
      amount: string | number;
      ledger_id: string | number | null;
    }>(
      'select raffle_id, viewer_id, viewer_display_name, amount, ledger_id from lab_raffle_winners where raffle_id = any($1::uuid[]) order by viewer_display_name',
      [raffleIds],
    );
  }

  /** Current round, participants, last draw and history (extension session, moderation, Studio). */
  async state(channelId: string, viewerId: string | null = null) {
    return this.db.tx(async (q) => {
      await this.sweep(q, channelId);
      const cur = await this.latest(q, channelId);
      const entries = cur
        ? await q.query<{
            entry_id: string;
            viewer_id: string;
            viewer_display_name: string;
            created_at: Date;
          }>(
            'select entry_id, viewer_id, viewer_display_name, created_at from lab_raffle_entries where raffle_id = $1 order by created_at',
            [cur.raffle_id],
          )
        : [];
      const drawn = await q.query<RaffleRow>(
        `select * from lab_raffles where channel_id = $1 and status = 'drawn' order by drawn_at desc limit 10`,
        [channelId],
      );
      const counts = new Map(
        (
          await q.query<{ raffle_id: string; n: string | number }>(
            'select raffle_id, count(*) as n from lab_raffle_entries where raffle_id = any($1::uuid[]) group by raffle_id',
            [drawn.map((d) => d.raffle_id)],
          )
        ).map((r) => [r.raffle_id, Number(r.n)]),
      );
      const wins = await this.winners(
        q,
        drawn.map((d) => d.raffle_id),
      );
      const history = drawn.map((d) => ({
        ...raffleView(d, counts.get(d.raffle_id) ?? 0),
        winners: wins
          .filter((w) => w.raffle_id === d.raffle_id)
          .map((w) => ({
            viewer_id: w.viewer_id,
            display_name: w.viewer_display_name,
            amount: Number(w.amount),
            ledger_id: w.ledger_id === null ? null : Number(w.ledger_id),
          })),
      }));
      const recent = await q.query<{
        entry_id: string;
        raffle_id: string;
        viewer_id: string;
        viewer_display_name: string;
        created_at: Date;
      }>(
        'select entry_id, raffle_id, viewer_id, viewer_display_name, created_at from lab_raffle_entries where channel_id = $1 order by created_at desc limit 20',
        [channelId],
      );
      return {
        module_state: await moduleState(q, 'raffle'),
        current: cur ? raffleView(cur, entries.length) : null,
        joined:
          !!viewerId &&
          cur?.status === 'open' &&
          entries.some((e) => e.viewer_id === viewerId),
        participants: entries.map((e) => ({
          viewer_id: e.viewer_id,
          display_name: e.viewer_display_name,
          created_at: iso(e.created_at)!,
        })),
        last_draw: history[0] ?? null,
        history,
        recent_entries: recent.map((e) => ({
          interaction_id: e.entry_id,
          raffle_id: e.raffle_id,
          viewer_id: e.viewer_id,
          viewer_display_name: e.viewer_display_name,
          created_at: iso(e.created_at)!,
          status: 'completed',
          simulated_cost: 0,
          payment_method: 'tokens',
          tickets: 1,
        })),
      };
    });
  }

  /** Free entry (one per viewer and per round). A retry or a second click answers « already in ». */
  async join(req: LabRaffleJoinRequest) {
    try {
      return await this.db.tx(async (q) => {
        const now = this.clock.now();
        await this.sweep(q, req.channel_id);
        await assertNotGloballyPaused(q, req.channel_id);
        const state = await moduleState(q, 'raffle');
        if (state === 'disabled')
          throw new RaffleLabError409('module_disabled', 'Tombola disabled');
        if (state === 'paused')
          throw new RaffleLabError409(
            'raffle_paused',
            'Tombola paused by moderation',
          );
        if (await activeBlock(q, req.channel_id, req.viewer.id, 'raffle', now))
          throw new RaffleLabError409(
            'viewer_blocked',
            'Tombola unavailable for this viewer',
          );
        const cur = (
          await q.query<RaffleRow>(
            `select * from lab_raffles where channel_id = $1 and status = 'open' for update`,
            [req.channel_id],
          )
        )[0];
        if (!cur)
          throw new RaffleLabError409('raffle_closed', 'no open Tombola');
        const prior = (
          await q.query<{ entry_id: string }>(
            'select entry_id from lab_raffle_entries where raffle_id = $1 and viewer_id = $2',
            [cur.raffle_id, req.viewer.id],
          )
        )[0];
        if (prior)
          return {
            raffle_id: cur.raffle_id,
            entry_id: prior.entry_id,
            joined: true,
            replayed: true,
          };
        const id = randomUUID();
        await q.query(
          `insert into lab_raffle_entries (entry_id, raffle_id, channel_id, viewer_id, viewer_display_name, idempotency_key, created_at)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            cur.raffle_id,
            req.channel_id,
            req.viewer.id,
            req.viewer.display_name,
            req.idempotency_key,
            now,
          ],
        );
        await seeViewer(
          q,
          req.channel_id,
          req.viewer.id,
          req.viewer.display_name,
          now,
        );
        return {
          raffle_id: cur.raffle_id,
          entry_id: id,
          joined: true,
          replayed: false,
        };
      });
    } catch (e) {
      if (!(e instanceof GlobalPauseError)) throw e;
      await countGlobalRefusal(this.db, req.channel_id, this.clock.now());
      throw new RaffleLabError409('global_pause', e.message);
    }
  }

  /** Tombola commands (inside the moderation transaction, after the permission check). */
  async applyModeration(
    q: Queryable,
    channelId: string,
    cmd: LabModerationCommand,
    actor: Actor,
    role: LabRole,
  ) {
    const now = this.clock.now();
    const reason = 'reason' in cmd ? (cmd.reason ?? null) : null;
    await this.sweep(q, channelId);
    switch (cmd.action) {
      case 'module_state': {
        const before = await moduleState(q, 'raffle');
        await setModuleState(q, 'raffle', cmd.state, now, actor.id);
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'raffle',
          action: `module_${cmd.state}`,
          reason,
          before: { state: before },
          after: { state: cmd.state },
        });
        return { ok: true, module_state: cmd.state };
      }
      case 'raffle_open': {
        const open = (
          await q.query(
            `select 1 from lab_raffles where channel_id = $1 and status = 'open'`,
            [channelId],
          )
        ).length;
        if (open)
          throw new RaffleLabError409(
            'raffle_already_open',
            'a Tombola is already open',
          );
        const id = randomUUID();
        const endsAt = new Date(now.getTime() + cmd.duration_s * 1000);
        await q.query(
          `insert into lab_raffles (raffle_id, channel_id, status, jackpot, winners_count, opened_at, ends_at, opened_by)
           values ($1, $2, 'open', $3, $4, $5, $6, $7)`,
          [
            id,
            channelId,
            cmd.jackpot,
            cmd.winners,
            now,
            endsAt,
            actorName(actor),
          ],
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'raffle',
          action: 'raffle_open',
          reason,
          after: {
            raffle_id: id,
            jackpot: cmd.jackpot,
            winners: cmd.winners,
            ends_at: endsAt.toISOString(),
          },
        });
        return { ok: true, raffle_id: id };
      }
      case 'raffle_close': {
        const done = await q.query<{ raffle_id: string }>(
          `update lab_raffles set status = 'closed', closed_at = $2 where channel_id = $1 and status = 'open' returning raffle_id`,
          [channelId, now],
        );
        if (!done.length)
          throw new RaffleLabError409('no_open_raffle', 'no open Tombola');
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'raffle',
          action: 'raffle_close',
          reason,
          after: { raffle_id: done[0]!.raffle_id },
        });
        return { ok: true };
      }
      case 'raffle_draw': {
        const cur = (
          await q.query<RaffleRow>(
            `select * from lab_raffles where channel_id = $1 and status in ('open', 'closed') order by opened_at desc limit 1 for update`,
            [channelId],
          )
        )[0];
        if (!cur)
          throw new RaffleLabError409(
            'nothing_to_draw',
            'no Tombola waiting for its draw',
          );
        const entries = await q.query<{
          viewer_id: string;
          viewer_display_name: string;
        }>(
          'select viewer_id, viewer_display_name from lab_raffle_entries where raffle_id = $1 order by created_at',
          [cur.raffle_id],
        );
        const pool = [...entries];
        const picked: typeof entries = [];
        while (pool.length && picked.length < cur.winners_count)
          picked.push(
            pool.splice(Math.floor(this.random() * pool.length), 1)[0]!,
          );
        const share = picked.length
          ? Math.floor(Number(cur.jackpot) / picked.length)
          : 0;
        const winners: {
          viewer_id: string;
          display_name: string;
          amount: number;
          ledger_id: number | null;
        }[] = [];
        for (const w of picked) {
          const ledgerId = share
            ? await creditRaffleWin(q, now, {
                channelId,
                viewerId: w.viewer_id,
                amount: share,
                raffleId: cur.raffle_id,
                actor: actorName(actor),
              })
            : null;
          await q.query(
            'insert into lab_raffle_winners (raffle_id, viewer_id, viewer_display_name, amount, ledger_id) values ($1, $2, $3, $4, $5)',
            [
              cur.raffle_id,
              w.viewer_id,
              w.viewer_display_name,
              share,
              ledgerId,
            ],
          );
          winners.push({
            viewer_id: w.viewer_id,
            display_name: w.viewer_display_name,
            amount: share,
            ledger_id: ledgerId,
          });
        }
        await q.query(
          `update lab_raffles set status = 'drawn', drawn_at = $2, closed_at = coalesce(closed_at, $2) where raffle_id = $1`,
          [cur.raffle_id, now],
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'raffle',
          action: 'raffle_draw',
          reason,
          before: {
            participants: entries.length,
            jackpot: Number(cur.jackpot),
          },
          after: {
            raffle_id: cur.raffle_id,
            winners: winners.map((w) => ({
              viewer_id: w.viewer_id,
              amount: w.amount,
            })),
          },
        });
        return { ok: true, raffle_id: cur.raffle_id, winners };
      }
      default:
        throw new RaffleLabError409(
          'unsupported',
          `${cmd.action} does not apply to the Tombola`,
        );
    }
  }
}
