import type {
  LabModerationCommand,
  LabModerationRequest,
  LabWalletRequest,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { BonkLabService } from '../bonk-lab/bonk-lab-service.js';
import type { SoundLabService } from '../sound-lab/sound-lab-service.js';
import type { TtsLabService } from '../tts-lab/tts-lab-service.js';
import {
  actorName,
  assertAllowed,
  audit,
  clearBlock,
  editWallet,
  setBlock,
  effectiveRole,
  permissionsFor,
  readWallet,
  restrictions,
  type Actor,
} from './store.js';

// Moderation V2 (Lab) — single entry point for Studio (cockpit) and the extension (moderators).
// Permission check, then the module's own transactional command, always audited in Core.

export class LabModerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Permission(s) a command needs. Anything that gives money back also needs `refund`. */
function permissionsOf(cmd: LabModerationCommand): string[] {
  switch (cmd.action) {
    case 'module_state': {
      const base =
        cmd.state === 'disabled'
          ? 'module.disable'
          : cmd.state === 'active'
            ? 'module.resume'
            : 'module.pause';
      return cmd.waiting === 'cancel_refund' ? [base, 'refund'] : [base];
    }
    case 'stop_current':
      return cmd.refund ? ['queue.stop', 'refund'] : ['queue.stop'];
    case 'cancel':
      return cmd.refund ? ['queue.cancel', 'refund'] : ['queue.cancel'];
    case 'purge':
      return cmd.refund ? ['queue.purge', 'refund'] : ['queue.purge'];
    case 'refund':
      return ['refund'];
    case 'block_viewer':
    case 'unblock_viewer':
      return ['viewer.block'];
    case 'viewer_cooldown':
      return ['viewer.cooldown'];
    case 'set_staff':
      return ['staff.manage'];
  }
}

export class LabModerationService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly tts: TtsLabService,
    private readonly sound: SoundLabService,
    private readonly bonk: BonkLabService,
  ) {}

  async whoami(channelId: string, actor: Actor) {
    const role = await effectiveRole(this.db, channelId, actor);
    return { role, permissions: permissionsFor(role) };
  }

  async act(channelId: string, req: LabModerationRequest) {
    const actor: Actor = req.actor;
    const cmd = req.command;
    return this.db.tx(async (q) => {
      let role = await effectiveRole(q, channelId, actor);
      for (const p of permissionsOf(cmd))
        role = await assertAllowed(q, channelId, actor, p);
      const now = this.clock.now();
      const reason = cmd.reason ?? null;
      switch (cmd.action) {
        case 'block_viewer': {
          const until = cmd.duration_s
            ? new Date(now.getTime() + cmd.duration_s * 1000)
            : null;
          const before = await setBlock(q, now, {
            channelId,
            viewerId: cmd.viewer_id,
            module: cmd.module,
            until,
            reason,
            actor: actorName(actor),
          });
          await audit(q, now, {
            channelId,
            actor,
            role,
            module: cmd.module,
            action: 'block_viewer',
            viewerId: cmd.viewer_id,
            reason,
            before: before
              ? { blocked: true, until: before.until?.toISOString() ?? null }
              : { blocked: false },
            after: { blocked: true, until: until?.toISOString() ?? null },
          });
          return { ok: true, until: until?.toISOString() ?? null };
        }
        case 'unblock_viewer': {
          const removed = await clearBlock(
            q,
            channelId,
            cmd.viewer_id,
            cmd.module,
          );
          await audit(q, now, {
            channelId,
            actor,
            role,
            module: cmd.module,
            action: 'unblock_viewer',
            viewerId: cmd.viewer_id,
            reason,
            before: { blocked: removed },
            after: { blocked: false },
          });
          return { ok: true };
        }
        case 'viewer_cooldown': {
          if (cmd.module === 'tts')
            return this.tts.applyModeration(q, channelId, cmd, actor, role);
          const cur = (
            await q.query<{ until: Date }>(
              'select until from lab_viewer_cooldowns where channel_id = $1 and viewer_id = $2 and module_id = $3',
              [channelId, cmd.viewer_id, cmd.module],
            )
          )[0]?.until;
          const base =
            cmd.mode === 'add' && cur && cur > now
              ? cur.getTime()
              : now.getTime();
          const until =
            cmd.mode === 'clear' || !cmd.seconds
              ? null
              : new Date(base + (cmd.seconds ?? 0) * 1000);
          if (until)
            await q.query(
              `insert into lab_viewer_cooldowns (channel_id, viewer_id, module_id, until, reason, actor, created_at) values ($1, $2, $3, $4, $5, $6, $7)
               on conflict (channel_id, viewer_id, module_id) do update set until = excluded.until, reason = excluded.reason, actor = excluded.actor, created_at = excluded.created_at`,
              [
                channelId,
                cmd.viewer_id,
                cmd.module,
                until,
                reason,
                actorName(actor),
                now,
              ],
            );
          else
            await q.query(
              'delete from lab_viewer_cooldowns where channel_id = $1 and viewer_id = $2 and module_id = $3',
              [channelId, cmd.viewer_id, cmd.module],
            );
          await audit(q, now, {
            channelId,
            actor,
            role,
            module: cmd.module,
            action: `cooldown_${cmd.mode}`,
            viewerId: cmd.viewer_id,
            reason,
            before: { until: cur && cur > now ? cur.toISOString() : null },
            after: { until: until?.toISOString() ?? null },
          });
          return { ok: true, until: until?.toISOString() ?? null };
        }
        case 'set_staff': {
          const before = (
            await q.query<{ role: string }>(
              'select role from lab_staff where channel_id = $1 and viewer_id = $2',
              [channelId, cmd.viewer_id],
            )
          )[0];
          if (cmd.role)
            await q.query(
              `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at) values ($1, $2, $3, $4, $5)
               on conflict (channel_id, viewer_id) do update set role = excluded.role, granted_by = excluded.granted_by, created_at = excluded.created_at`,
              [channelId, cmd.viewer_id, cmd.role, actorName(actor), now],
            );
          else
            await q.query(
              'delete from lab_staff where channel_id = $1 and viewer_id = $2',
              [channelId, cmd.viewer_id],
            );
          await audit(q, now, {
            channelId,
            actor,
            role,
            action: 'set_staff',
            viewerId: cmd.viewer_id,
            reason,
            before: { role: before?.role ?? null },
            after: { role: cmd.role },
          });
          return { ok: true };
        }
        default: {
          const module = cmd.module;
          if (module === 'tts')
            return this.tts.applyModeration(q, channelId, cmd, actor, role);
          if (module === 'soundboard')
            return this.sound.applyModeration(q, channelId, cmd, actor, role);
          return this.bonk.applyModeration(q, channelId, cmd, actor, role);
        }
      }
    });
  }

  /** Cockpit overview: every module state + queues (TTS current / waiting, Soundboard playing / waiting). */
  async overview(channelId: string) {
    const [tts, sound, bonk] = await Promise.all([
      this.tts.moderationQueue(channelId),
      this.sound.moderationQueue(channelId),
      this.bonk.moderationQueue(channelId),
    ]);
    return { tts, soundboard: sound, bonk };
  }

  /** Viewers seen in any module (or in the Lab wallet), for the moderation search. */
  async search(channelId: string, query: string, limit = 12) {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.db.query<{
      viewer_id: string;
      display_name: string;
      last_seen: Date;
    }>(
      `select viewer_id, (array_agg(viewer_display_name order by created_at desc))[1] as display_name, max(created_at) as last_seen
       from (
         select viewer_id, viewer_display_name, created_at from tts_lab_interactions where channel_id = $1
         union all select viewer_id, viewer_display_name, created_at from sound_lab_interactions where channel_id = $1
         union all select viewer_id, viewer_display_name, created_at from bonk_lab_interactions where channel_id = $1
       ) v
       group by viewer_id
       having $2 = '' or bool_or(viewer_display_name ilike $3) or viewer_id like $3
       order by max(created_at) desc limit $4`,
      [channelId, query, like, limit],
    );
  }

  /** Viewer card: identity, Lab wallet, restrictions, recent activity, wallet movements, moderation history. */
  async viewer(channelId: string, viewerId: string) {
    const now = this.clock.now();
    const [wallet, restr, tts, sound, ledger, history, name, staff] =
      await Promise.all([
        readWallet(this.db, channelId, viewerId),
        restrictions(this.db, channelId, viewerId, now),
        this.tts.viewerInteractions(channelId, viewerId),
        this.sound.viewerInteractions(channelId, viewerId),
        this.db.query(
          'select id, kind, currency, amount, module_id, interaction_id, actor, reason, created_at from lab_wallet_ledger where channel_id = $1 and viewer_id = $2 order by id desc limit 15',
          [channelId, viewerId],
        ),
        this.db.query(
          'select id, created_at, actor, role, module_id, action, interaction_id, reason, before, after from lab_moderation_audit where channel_id = $1 and viewer_id = $2 order by id desc limit 20',
          [channelId, viewerId],
        ),
        this.search(channelId, viewerId, 1),
        this.db.query<{ role: string }>(
          'select role from lab_staff where channel_id = $1 and viewer_id = $2',
          [channelId, viewerId],
        ),
      ]);
    const bonk = await this.db.query<{
      interaction_id: string;
      status: string;
      created_at: Date;
      viewer_display_name: string;
    }>(
      'select interaction_id, status, created_at, viewer_display_name from bonk_lab_interactions where channel_id = $1 and viewer_id = $2 order by created_at desc limit 10',
      [channelId, viewerId],
    );
    const activity = [
      ...tts.map((i) => ({
        module: 'tts',
        interaction_id: i.interaction_id,
        status: i.status,
        created_at: i.created_at,
        detail: i.message,
        cost: i.simulated_cost,
        payment_method: i.payment_method,
        refund_status: i.refund_status,
        refundable:
          ['completed', 'failed', 'execution_unknown', 'cancelled'].includes(
            i.status,
          ) && i.refund_status === 'none',
      })),
      ...sound.map((i) => ({
        module: 'soundboard',
        interaction_id: i.interaction_id,
        status: i.status,
        created_at: i.created_at,
        detail: i.sound_label,
        cost: i.simulated_cost,
        payment_method: i.payment_method,
        refund_status: 'none',
        refundable: false,
      })),
      ...bonk.map((i) => ({
        module: 'bonk',
        interaction_id: i.interaction_id,
        status: i.status,
        created_at: i.created_at.toISOString(),
        detail: 'Bonk',
        cost: 0,
        payment_method: 'tokens',
        refund_status: 'none',
        refundable: false,
      })),
    ]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 12);
    return {
      viewer_id: viewerId,
      display_name: name[0]?.display_name ?? viewerId,
      staff_role: staff[0]?.role ?? null,
      wallet,
      restrictions: restr,
      activity,
      wallet_ledger: ledger,
      history,
    };
  }

  async auditTrail(
    channelId: string,
    opts: {
      limit?: number;
      module?: string | null;
      viewer?: string | null;
    } = {},
  ) {
    return this.db.query(
      `select id, created_at, actor, role, module_id, action, viewer_id, interaction_id, reason, before, after
       from lab_moderation_audit where channel_id = $1 and ($2::text is null or module_id = $2) and ($3::text is null or viewer_id = $3)
       order by id desc limit $4`,
      [
        channelId,
        opts.module ?? null,
        opts.viewer ?? null,
        Math.min(200, opts.limit ?? 50),
      ],
    );
  }

  // --- Lab test wallet (Studio Dev/Lab only) ------------------------------------------------------------------------

  async wallet(channelId: string, viewerId: string) {
    return readWallet(this.db, channelId, viewerId);
  }

  async editWallet(channelId: string, req: LabWalletRequest) {
    if (req.actor.via !== 'studio')
      throw new LabModerationError(
        'studio_only',
        'the Lab wallet is edited from Studio only',
      );
    return this.db.tx(async (q) => {
      const role = await assertAllowed(q, channelId, req.actor, 'wallet.lab');
      const now = this.clock.now();
      const values = {
        tokens: req.tokens,
        credits_tts: req.credits_tts,
        credits_soundboard: req.credits_soundboard,
      };
      if (req.op === 'set')
        for (const [k, v] of Object.entries(values))
          if (v !== undefined && v < 0)
            throw new LabModerationError('invalid_wallet', `${k} must be ≥ 0`);
      const { before, after } = await editWallet(
        q,
        now,
        channelId,
        req.viewer_id,
        req.op,
        values,
        actorName(req.actor),
      );
      await audit(q, now, {
        channelId,
        actor: req.actor,
        role,
        action: `lab_wallet_${req.op}`,
        viewerId: req.viewer_id,
        before,
        after,
      });
      return { ok: true, wallet: after };
    });
  }
}
