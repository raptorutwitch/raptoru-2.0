import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import { assertAllowed, audit, type Actor } from '../lab-moderation/store.js';
import type { ModuleSettings } from '../module-settings/service.js';
import { RbError, rbView, type RandomBanService } from './service.js';

// Random Ban in the moderation (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 8) — the EXISTING mechanisms: D4 permissions
// (assertAllowed), the moderation audit (lab_moderation_audit), the blocks and personal cooldowns of every module
// (lab_viewer_blocks / lab_viewer_cooldowns with module « random_ban », enforced by RandomBanService). What is
// Random Ban's own: the history of its requests, the reconciliation list, and four actions — each audited with its
// author and reason, each money movement keyed (a replay never pays nor refunds twice):
// - cancel (queue.cancel): a request still `queued` → `canceled`, refunded once by the usual paths (Jetons: the
//   chat/extension settle; channel points: CANCELED on a Raptoru reward);
// - refund_uncertain (refund.manual): an `uncertain` request checked on Twitch (timeout NOT applied) → refunded once;
// - revoke_bonus (wallet.admin): a Sniper bonus taken back (negative movement, keyed), `revoked`;
// - pause / resume (module.pause): no new purchase, the executor takes nothing (queued ones are refunded by the usual
//   2-min expiry when the pause lasts).

export type RbModerationCommand =
  | { action: 'cancel'; request_id: string; reason: string }
  | { action: 'refund_uncertain'; request_id: string; reason: string }
  | { action: 'revoke_bonus'; request_id: string; reason: string }
  | { action: 'pause' | 'resume'; reason: string };

export class RandomBanModeration {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly rb: RandomBanService,
    private readonly economy: EconomyPort,
    private readonly settings: ModuleSettings,
  ) {}

  /** The team's history: one line per request (source, buyer, prediction, decision, target, status, money, dates). */
  async history(
    channelId: string,
    actor: Actor,
    f: { viewer?: string | null; limit?: number } = {},
  ) {
    await assertAllowed(this.db, channelId, actor, 'viewer.read');
    const rows = await this.db.query<Parameters<typeof rbView>[0]>(
      `select * from rb_requests where channel_id = $1 and ($2::text is null or buyer_id = $2 or target_id = $2)
       order by seq desc limit $3`,
      [channelId, f.viewer ?? null, Math.min(200, Math.max(1, f.limit ?? 50))],
    );
    return {
      paused: await this.paused(this.db, channelId),
      requests: rows.map((r) => ({
        ...rbView(r),
        canceled_by: (r as { canceled_by?: string | null }).canceled_by ?? null,
        cancel_reason:
          (r as { cancel_reason?: string | null }).cancel_reason ?? null,
      })),
    };
  }

  /** « À vérifier » : what still needs a human or a retry. Each line says why. */
  async reconciliation(channelId: string, actor: Actor) {
    await assertAllowed(this.db, channelId, actor, 'viewer.read');
    const now = this.clock.now();
    const rows = await this.db.query<
      Parameters<typeof rbView>[0] & { why: string }
    >(
      `select *, case
           when status = 'uncertain' then 'timeout_incertain'
           when refund = 'needed' then 'remboursement_en_attente'
           when sniper = 'armed' and status not in ('queued', 'searching', 'timeout_requested') then 'prime_non_decidee'
           else 'demande_bloquee' end as why
         from rb_requests where channel_id = $1 and source <> 'test' and (
           status = 'uncertain' or refund = 'needed'
           or (sniper = 'armed' and status not in ('queued', 'searching', 'timeout_requested'))
           or (status in ('queued', 'searching', 'timeout_requested') and created_at < $2))
         order by seq desc limit 100`,
      [channelId, new Date(now.getTime() - 2 * 60_000)],
    );
    return { items: rows.map((r) => ({ why: r.why, request: rbView(r) })) };
  }

  async paused(q: Queryable, channelId: string) {
    return (
      (await this.settings.get(q, channelId, 'random_ban.queue_paused')) === 1
    );
  }

  async act(channelId: string, actor: Actor, cmd: RbModerationCommand) {
    const reason = cmd.reason.trim().slice(0, 300);
    if (!reason) throw new RbError(400, 'reason_required');
    const now = this.clock.now();
    if (cmd.action === 'pause' || cmd.action === 'resume') {
      const role = await assertAllowed(
        this.db,
        channelId,
        actor,
        'module.pause',
      );
      const on = cmd.action === 'pause';
      await this.settings.set(
        channelId,
        'random_ban.queue_paused',
        on ? 1 : 0,
        (actor.display_name ?? actor.id).slice(0, 64),
      );
      await this.db.tx((q) =>
        audit(q, now, {
          channelId,
          actor,
          role,
          module: null,
          action: `random_ban.${cmd.action}`,
          reason,
          after: { paused: on },
        }),
      );
      return { ok: true, paused: on };
    }
    const one = cmd as Exclude<
      RbModerationCommand,
      { action: 'pause' | 'resume' }
    >;
    const permission =
      cmd.action === 'cancel'
        ? 'queue.cancel'
        : cmd.action === 'refund_uncertain'
          ? 'refund.manual'
          : 'wallet.admin';
    const out = await this.db.tx(async (q) => {
      const role = await assertAllowed(q, channelId, actor, permission);
      // The channel's Random Ban lock: a cancel and the executor's claim never both win.
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `random_ban:${channelId}`,
      ]);
      const r = (
        await q.query<Parameters<typeof rbView>[0]>(
          'select * from rb_requests where request_id = $1 and channel_id = $2 for update',
          [one.request_id, channelId],
        )
      )[0];
      if (!r) throw new RbError(404, 'random_ban_not_found');
      const before = { status: r.status, refund: r.refund, sniper: r.sniper };
      let after: Record<string, unknown>;
      if (cmd.action === 'cancel') {
        if (r.status !== 'queued') throw new RbError(409, 'not_cancelable');
        await q.query(
          `update rb_requests set status = 'canceled', refund = case when mode = 'real' or source in ('chat', 'extension')
             then 'needed' else 'none' end, canceled_by = $2, cancel_reason = $3, ended_at = $4, updated_at = $4,
             sniper = case when sniper = 'armed' then 'void' else sniper end
           where request_id = $1`,
          [
            r.request_id,
            (actor.display_name ?? actor.id).slice(0, 64),
            reason,
            now,
          ],
        );
        after = { status: 'canceled', refund: 'needed' };
      } else if (cmd.action === 'refund_uncertain') {
        if (r.status !== 'uncertain' || r.refund !== 'to_verify')
          throw new RbError(409, 'not_refundable');
        await q.query(
          `update rb_requests set refund = 'needed', updated_at = $2 where request_id = $1`,
          [r.request_id, now],
        );
        after = { refund: 'needed' };
      } else {
        if (r.sniper !== 'hit') throw new RbError(409, 'no_bonus');
        const bonus = Number(r.stats?.sniper_bonus ?? 0);
        if (bonus > 0)
          await this.economy.move(q, now, {
            channelId,
            viewerId: r.buyer_id,
            currency: 'tokens',
            amount: -bonus,
            kind: 'mini_game',
            key: `rb:sniper-revoke:${r.request_id}`,
            moduleId: 'random_ban',
          });
        await q.query(
          `update rb_requests set sniper = 'revoked', updated_at = $2 where request_id = $1`,
          [r.request_id, now],
        );
        after = { sniper: 'revoked', bonus_taken_back: bonus };
      }
      await audit(q, now, {
        channelId,
        actor,
        role,
        module: null,
        action: `random_ban.${cmd.action}`,
        viewerId: r.buyer_id,
        interactionId: r.request_id,
        reason,
        before,
        after,
      });
      return { ok: true as const, request_id: r.request_id };
    });
    // After the commit: the refund paths (Jetons, channel points) follow at once, as after an executor result.
    if (cmd.action !== 'revoke_bonus')
      await this.rb.notifySettled(channelId, one.request_id);
    return out;
  }
}
