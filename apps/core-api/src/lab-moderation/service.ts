import type {
  LabModerationCommand,
  LabModerationRequest,
  LabWalletRequest,
} from '@raptoru/schemas';
import { createHash } from 'node:crypto';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { BonkLabService } from '../bonk-lab/bonk-lab-service.js';
import type { RaffleLabService } from '../raffle-lab/raffle-lab-service.js';
import type { SoundLabService } from '../sound-lab/sound-lab-service.js';
import { nominalStreamDay, streamDayWindow } from '../stream/stream-day.js';
import type { TtsLabService } from '../tts-lab/tts-lab-service.js';
import {
  access,
  actorName,
  adminAdjust,
  allowed,
  anyModuleState,
  assertAccess,
  assertAllowed,
  audit,
  clearBlock,
  editWallet,
  globalState,
  GRANTS,
  isStaff,
  LabForbiddenError,
  permissionsFor,
  readWallet,
  restrictions,
  setBlock,
  touchStaff,
  type Access,
  type Actor,
} from './store.js';
import { normalizeWord, wordRules } from './words.js';

// Moderation V2 (Lab, parity D4) — single entry point for Studio (cockpit) and the extension
// (moderators). Core decides every permission (roles + D4 grants per moderator), executes the
// module's own transactional command and audits it. The read models below are what Studio and the
// extension display: no client keeps any state of its own.

export class LabModerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** D4: a block on everything, or longer than one hour (or until unblocked), is a sensitive sanction. */
export const SENSITIVE_BLOCK_S = 3600;
/** D4 « Ce stream » for a personal cooldown (no stream end signal in the Lab): 3 hours. */
export const STREAM_SPAN_S = 3 * 3600;

/** Operation types of the Lab wallet ledger, as D4 « Activité Jetons » shows them. */
export const LEDGER_TYPES: Record<
  string,
  { label: string; visible_in_moderation_activity: boolean }
> = {
  tts: { label: 'TTS', visible_in_moderation_activity: true },
  soundboard: { label: 'Soundboard', visible_in_moderation_activity: true },
  bonk: { label: 'Bonk', visible_in_moderation_activity: true },
  refund: { label: 'Remboursement', visible_in_moderation_activity: true },
  admin: { label: 'Ajustement admin', visible_in_moderation_activity: true },
  raffle_win: { label: 'Tombola', visible_in_moderation_activity: true },
  lab_tools: {
    label: 'Wallet de test (Studio)',
    visible_in_moderation_activity: true,
  },
};
const operationType = (kind: string, module: string | null) =>
  kind === 'debit'
    ? (module ?? 'debit')
    : kind === 'set' || kind === 'adjust' || kind === 'reset'
      ? 'lab_tools'
      : kind;

/** Status family of D4's history filters. */
const STATUS_KEY = `case when refund_status = 'refunded' then 'refunded'
  when status = 'completed' then 'done'
  when status in ('accepted', 'queued', 'starting', 'playing', 'executing') then 'queued'
  when status = 'cancelled' then 'cancelled' else 'failed' end`;
/** Every interaction of every module, in one shape (history, viewer card). */
const INTERACTIONS = `(
  select 'tts' as module, interaction_id::text as interaction_id, channel_id, viewer_id, viewer_display_name, status,
    refund_status, created_at, simulated_cost as cost, payment_method, message as detail, review_status
  from tts_lab_interactions
  union all select 'soundboard', interaction_id::text, channel_id, viewer_id, viewer_display_name, status, refund_status,
    created_at, simulated_cost, payment_method, sound_label, 'none' from sound_lab_interactions
  union all select 'bonk', interaction_id::text, channel_id, viewer_id, viewer_display_name, status, refund_status,
    created_at, simulated_cost, 'tokens', coalesce(emote_glyph, emote_id), 'none' from bonk_lab_interactions
  union all select 'raffle', entry_id::text, channel_id, viewer_id, viewer_display_name, 'completed', 'none', created_at,
    0, 'tokens', 'Inscription', 'none' from lab_raffle_entries
) ix`;

interface InteractionRow {
  module: string;
  interaction_id: string;
  viewer_id: string;
  viewer_display_name: string;
  status: string;
  refund_status: string;
  created_at: Date;
  cost: number;
  payment_method: string;
  detail: string;
  review_status: string;
  status_key: string;
}
const interactionView = (r: InteractionRow) => ({
  module: r.module,
  interaction_id: r.interaction_id,
  viewer_id: r.viewer_id,
  viewer_display_name: r.viewer_display_name,
  status: r.status,
  status_key: r.status_key,
  refund_status: r.refund_status,
  created_at: new Date(r.created_at).toISOString(),
  simulated_cost: Number(r.cost),
  payment_method: r.payment_method,
  detail: r.detail,
  review_status: r.review_status,
});

export class LabModerationService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly tts: TtsLabService,
    private readonly sound: SoundLabService,
    private readonly bonk: BonkLabService,
    private readonly raffle: RaffleLabService,
  ) {}

  /** Effective role, D4 grants and permissions of the caller (the staff seen joins the team). */
  async whoami(channelId: string, actor: Actor) {
    return this.db.tx(async (q) => {
      await touchStaff(q, channelId, actor, this.clock.now());
      const acc = await access(q, channelId, actor);
      return {
        role: acc.role,
        grants: acc.grants,
        permissions: permissionsFor(acc),
        viewer_id: actor.via === 'extension' ? actor.id : null,
      };
    });
  }

  /** Permission(s) a command needs. D4: refunds belong to every moderator. */
  private async needs(
    q: Queryable,
    cmd: LabModerationCommand,
  ): Promise<string[]> {
    const refund = (r: boolean) => (r ? ['refund'] : []);
    switch (cmd.action) {
      case 'module_state': {
        // D4: « Désactivé » (to or from) needs « Désactiver un module ».
        const cur = await anyModuleState(q, cmd.module);
        const base =
          cmd.state !== cur && (cmd.state === 'disabled' || cur === 'disabled')
            ? 'module.disable'
            : cmd.state === 'active'
              ? 'module.resume'
              : 'module.pause';
        return [base, ...refund(cmd.waiting === 'cancel_refund')];
      }
      case 'stop_current':
      case 'stop_all':
        return ['queue.stop', ...refund(cmd.refund)];
      case 'cancel':
        return ['queue.cancel', ...refund(cmd.refund)];
      case 'purge':
        return ['queue.purge', ...refund(cmd.refund)];
      case 'refund':
        return ['refund.manual'];
      case 'allow':
        return ['review.allow'];
      case 'block_viewer':
        return cmd.module === 'all' ||
          cmd.duration_s === null ||
          cmd.duration_s > SENSITIVE_BLOCK_S
          ? ['viewer.block', 'sanction.sensitive']
          : ['viewer.block'];
      case 'unblock_viewer':
        return ['viewer.block'];
      case 'set_cooldown':
      case 'clear_cooldown':
        return ['viewer.cooldown'];
      case 'global_pause':
        return ['global.pause'];
      case 'set_permission':
        return ['perms.manage'];
      case 'set_staff':
        return ['staff.manage'];
      case 'add_note':
        return ['notes.write'];
      case 'add_word':
      case 'remove_word':
        return ['words.manage'];
      case 'wallet_adjust':
        return ['wallet.admin'];
      case 'raffle_open':
      case 'raffle_close':
      case 'raffle_draw':
        return ['raffle.manage'];
    }
  }

  async act(channelId: string, req: LabModerationRequest) {
    const actor: Actor = req.actor;
    const cmd = req.command;
    // Tombola: due transitions (draw at closes_at…) are committed first, whatever this command does.
    await this.raffle.settle(channelId);
    return this.txOnce(channelId, req, async (q) => {
      const now = this.clock.now();
      await touchStaff(q, channelId, actor, now);
      const acc = await access(q, channelId, actor);
      for (const p of await this.needs(q, cmd)) assertAccess(acc, p);
      const role = acc.role;
      const reason = 'reason' in cmd ? (cmd.reason ?? null) : null;
      const notStaff = async (viewerId: string) => {
        if (await isStaff(q, channelId, viewerId))
          throw new LabModerationError(
            'target_is_staff',
            'a team member cannot be sanctioned',
          );
      };
      switch (cmd.action) {
        case 'block_viewer': {
          await notStaff(cmd.viewer_id);
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
              ? {
                  blocked: true,
                  until: before.until
                    ? new Date(before.until).toISOString()
                    : null,
                }
              : { blocked: false },
            after: {
              blocked: true,
              until: until?.toISOString() ?? null,
              sensitive:
                cmd.module === 'all' ||
                !cmd.duration_s ||
                cmd.duration_s > SENSITIVE_BLOCK_S,
            },
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
        case 'set_cooldown': {
          await notStaff(cmd.viewer_id);
          const stream = cmd.span === 'stream';
          const until = new Date(
            now.getTime() +
              (stream ? STREAM_SPAN_S : (cmd.span as number)) * 1000,
          );
          const before = (
            await q.query<{ delay_s: number; until: Date }>(
              'select delay_s, until from lab_viewer_cooldowns where channel_id = $1 and viewer_id = $2 and module_id = $3 and until > $4',
              [channelId, cmd.viewer_id, cmd.module, now],
            )
          )[0];
          await q.query(
            `insert into lab_viewer_cooldowns (channel_id, viewer_id, module_id, delay_s, until, stream, reason, actor, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             on conflict (channel_id, viewer_id, module_id) do update set delay_s = excluded.delay_s, until = excluded.until,
               stream = excluded.stream, reason = excluded.reason, actor = excluded.actor, created_at = excluded.created_at`,
            [
              channelId,
              cmd.viewer_id,
              cmd.module,
              cmd.delay_s,
              until,
              stream,
              reason,
              actorName(actor),
              now,
            ],
          );
          await audit(q, now, {
            channelId,
            actor,
            role,
            module: cmd.module,
            action: 'cooldown_set',
            viewerId: cmd.viewer_id,
            reason,
            before: before
              ? {
                  delay_s: before.delay_s,
                  until: new Date(before.until).toISOString(),
                }
              : null,
            after: {
              delay_s: cmd.delay_s,
              until: until.toISOString(),
              stream,
            },
          });
          return { ok: true, until: until.toISOString() };
        }
        case 'clear_cooldown': {
          const removed = await q.query<{ delay_s: number; until: Date }>(
            'delete from lab_viewer_cooldowns where channel_id = $1 and viewer_id = $2 and module_id = $3 returning delay_s, until',
            [channelId, cmd.viewer_id, cmd.module],
          );
          // TTS: the viewer can buy again at once (the running cooldown of the last TTS goes too).
          if (cmd.module === 'tts')
            await this.tts.clearRunningCooldown(
              q,
              channelId,
              cmd.viewer_id,
              actor,
              role,
            );
          await audit(q, now, {
            channelId,
            actor,
            role,
            module: cmd.module,
            action: 'cooldown_clear',
            viewerId: cmd.viewer_id,
            reason,
            before: removed[0]
              ? {
                  delay_s: removed[0].delay_s,
                  until: new Date(removed[0].until).toISOString(),
                }
              : null,
            after: null,
          });
          return { ok: true };
        }
        case 'global_pause': {
          const before = await globalState(q, channelId);
          await q.query(
            `insert into lab_global_state (channel_id, paused, paused_at, paused_by, refused_count, updated_at)
             values ($1, $2, $3, $4, 0, $5)
             on conflict (channel_id) do update set paused = excluded.paused, paused_at = excluded.paused_at,
               paused_by = excluded.paused_by, refused_count = 0, updated_at = excluded.updated_at`,
            [
              channelId,
              cmd.paused,
              cmd.paused ? now : null,
              cmd.paused ? actorName(actor) : null,
              now,
            ],
          );
          await audit(q, now, {
            channelId,
            actor,
            role,
            module: 'all',
            action: cmd.paused ? 'global_pause' : 'global_resume',
            reason,
            before: { paused: before.paused, refused: before.refused },
            after: { paused: cmd.paused },
          });
          return { ok: true, paused: cmd.paused };
        }
        case 'set_permission':
          return this.setPermission(q, channelId, actor, acc, cmd, now);
        case 'set_staff': {
          if (cmd.viewer_id === channelId)
            throw new LabModerationError(
              'target_not_editable',
              'the broadcaster keeps every permission',
            );
          const before = (
            await q.query<{ role: string; grants: string[] }>(
              'select role, grants from lab_staff where channel_id = $1 and viewer_id = $2',
              [channelId, cmd.viewer_id],
            )
          )[0];
          if (cmd.role)
            await q.query(
              `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, updated_at, updated_by)
               values ($1, $2, 'supermod', $3, $4, $4, $3)
               on conflict (channel_id, viewer_id) do update set role = 'supermod', updated_at = excluded.updated_at,
                 updated_by = excluded.updated_by`,
              [channelId, cmd.viewer_id, actorName(actor), now],
            );
          else if (before)
            // Back to a moderator with the standard D4 moderation (no grant kept).
            await q.query(
              `update lab_staff set role = 'moderator', grants = '{}', updated_at = $3, updated_by = $4
               where channel_id = $1 and viewer_id = $2`,
              [channelId, cmd.viewer_id, now, actorName(actor)],
            );
          await audit(q, now, {
            channelId,
            actor,
            role,
            action: 'set_staff',
            viewerId: cmd.viewer_id,
            reason,
            before: { role: before?.role ?? null },
            after: {
              role: cmd.role ?? (before ? 'moderator' : null),
            },
          });
          return { ok: true };
        }
        case 'add_note': {
          const id = (
            await q.query<{ id: string }>(
              `insert into lab_viewer_notes (channel_id, viewer_id, body, author, author_role, created_at)
               values ($1, $2, $3, $4, $5, $6) returning id`,
              [channelId, cmd.viewer_id, cmd.text, actorName(actor), role, now],
            )
          )[0]!.id;
          await audit(q, now, {
            channelId,
            actor,
            role,
            action: 'note_add',
            viewerId: cmd.viewer_id,
            after: { note_id: Number(id), text: cmd.text },
          });
          return { ok: true, note_id: Number(id) };
        }
        case 'add_word': {
          const normalized = normalizeWord(cmd.word);
          const word = cmd.word.trim().replace(/\s+/g, ' ');
          const inserted = await q.query<{ id: string }>(
            `insert into lab_tts_words (channel_id, word, normalized, kind, created_by, created_at)
             values ($1, $2, $3, $4, $5, $6) on conflict (channel_id, normalized) do nothing returning id`,
            [channelId, word, normalized, cmd.kind, actorName(actor), now],
          );
          if (!inserted.length)
            throw new LabModerationError(
              'word_exists',
              'this word is already in the list',
            );
          await this.tts.rescanReview(
            q,
            channelId,
            await wordRules(q, channelId),
          );
          await audit(q, now, {
            channelId,
            actor,
            role,
            module: 'tts',
            action: 'word_add',
            after: { word, kind: cmd.kind },
          });
          return { ok: true, word_id: Number(inserted[0]!.id) };
        }
        case 'remove_word': {
          const removed = await q.query<{ word: string; kind: string }>(
            'delete from lab_tts_words where channel_id = $1 and id = $2 returning word, kind',
            [channelId, cmd.word_id],
          );
          if (!removed.length)
            throw new LabModerationError('word_not_found', 'unknown word');
          await this.tts.rescanReview(
            q,
            channelId,
            await wordRules(q, channelId),
          );
          await audit(q, now, {
            channelId,
            actor,
            role,
            module: 'tts',
            action: 'word_remove',
            before: removed[0],
          });
          return { ok: true };
        }
        case 'wallet_adjust': {
          const out = await adminAdjust(q, now, {
            channelId,
            viewerId: cmd.viewer_id,
            currency: cmd.currency,
            delta: cmd.delta,
            actor: actorName(actor),
            reason,
          });
          if (out.applied === 0)
            throw new LabModerationError(
              cmd.delta < 0 ? 'nothing_to_debit' : 'wallet_full',
              cmd.delta < 0 ? 'the balance is already 0' : 'balance at maximum',
            );
          await audit(q, now, {
            channelId,
            actor,
            role,
            action: 'wallet_adjust',
            viewerId: cmd.viewer_id,
            reason,
            before: { [cmd.currency]: out.before[cmd.currency] },
            after: {
              [cmd.currency]: out.after[cmd.currency],
              applied: out.applied,
              ledger_id: out.ledgerId,
            },
          });
          return {
            ok: true,
            wallet: out.after,
            applied: out.applied,
            ledger_id: out.ledgerId,
          };
        }
        case 'raffle_open':
        case 'raffle_close':
        case 'raffle_draw':
          return this.raffle.applyModeration(q, channelId, cmd, actor, role);
        default: {
          const module = cmd.module;
          if (module === 'tts')
            return this.tts.applyModeration(q, channelId, cmd, actor, role);
          if (module === 'soundboard')
            return this.sound.applyModeration(q, channelId, cmd, actor, role);
          if (module === 'raffle')
            return this.raffle.applyModeration(q, channelId, cmd, actor, role);
          return this.bonk.applyModeration(q, channelId, cmd, actor, role);
        }
      }
    });
  }

  /**
   * Idempotent action (ASTRA-P1-009): with an idempotency key, the action is recorded with its
   * result in the SAME transaction as its effect. A retry after a lost response gets that result
   * again instead of applying the action twice; the same key with another payload is refused.
   * A failed action records nothing (its retry is evaluated again). Kept 24 h.
   */
  private txOnce<T>(
    channelId: string,
    req: LabModerationRequest,
    apply: (q: Queryable) => Promise<T>,
  ): Promise<T> {
    const key = req.idempotency_key;
    if (!key) return this.db.tx(apply);
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      const hash = createHash('sha256')
        .update(JSON.stringify([req.actor.id, req.command]))
        .digest('hex');
      // Claimed first: a concurrent duplicate waits on this row, then reads the committed result.
      const claimed = await q.query(
        `insert into lab_moderation_requests (channel_id, idempotency_key, request_hash, result, created_at)
         values ($1, $2, $3, 'null'::jsonb, $4) on conflict do nothing returning 1`,
        [channelId, key, hash, now],
      );
      if (!claimed.length) {
        const [prior] = await q.query<{ request_hash: string; result: T }>(
          'select request_hash, result from lab_moderation_requests where channel_id = $1 and idempotency_key = $2',
          [channelId, key],
        );
        if (prior!.request_hash !== hash)
          throw new LabModerationError(
            'idempotency_conflict',
            'this idempotency key was already used for another action',
          );
        return prior!.result;
      }
      const out = await apply(q);
      await q.query(
        'update lab_moderation_requests set result = $3 where channel_id = $1 and idempotency_key = $2',
        [channelId, key, JSON.stringify(out ?? null)],
      );
      await q.query(
        'delete from lab_moderation_requests where channel_id = $1 and created_at < $2',
        [channelId, new Date(now.getTime() - 24 * 3_600_000)],
      );
      return out;
    });
  }

  /**
   * « Équipe & permissions » (D4). Only a moderator's grants are editable (supermods and the
   * broadcaster have everything); nobody edits their own; a moderator with « Gérer les permissions »
   * grants or removes only permissions they hold themselves.
   */
  private async setPermission(
    q: Queryable,
    channelId: string,
    actor: Actor,
    acc: Access,
    cmd: Extract<LabModerationCommand, { action: 'set_permission' }>,
    now: Date,
  ) {
    if (actor.via === 'extension' && cmd.viewer_id === actor.id)
      throw new LabModerationError(
        'self_edit',
        'nobody edits their own permissions',
      );
    const target = (
      await q.query<{ role: string; grants: string[] }>(
        'select role, grants from lab_staff where channel_id = $1 and viewer_id = $2 for update',
        [channelId, cmd.viewer_id],
      )
    )[0];
    if (!target)
      throw new LabModerationError('not_in_team', 'not a team member');
    if (target.role !== 'moderator')
      throw new LabModerationError(
        'target_not_editable',
        'supermods and the broadcaster have every permission',
      );
    if (acc.role === 'moderator' && !acc.grants.includes(cmd.permission))
      throw new LabForbiddenError(`grant.${cmd.permission}`, acc.role);
    const before = [...target.grants];
    const after = cmd.granted
      ? [...new Set([...before, cmd.permission])]
      : before.filter((g) => g !== cmd.permission);
    const ordered = GRANTS.filter((g) => after.includes(g));
    await q.query(
      'update lab_staff set grants = $3, updated_at = $4, updated_by = $5 where channel_id = $1 and viewer_id = $2',
      [channelId, cmd.viewer_id, ordered, now, actorName(actor)],
    );
    await audit(q, now, {
      channelId,
      actor,
      role: acc.role,
      action: 'set_permission',
      viewerId: cmd.viewer_id,
      reason: cmd.reason ?? null,
      before: {
        permission: cmd.permission,
        granted: before.includes(cmd.permission),
      },
      after: { permission: cmd.permission, granted: cmd.granted },
    });
    return { ok: true, grants: ordered };
  }

  // --- read models ------------------------------------------------------------------------------------------

  /** Console overview: module states and queues, Tombola, global pause. */
  async overview(channelId: string) {
    const [tts, sound, bonk, raffle, raffleV2, global] = await Promise.all([
      this.tts.moderationQueue(channelId),
      this.sound.moderationQueue(channelId),
      this.bonk.moderationQueue(channelId),
      this.raffle.state(channelId),
      this.raffle.moderationView(channelId),
      globalState(this.db, channelId),
    ]);
    return {
      tts,
      soundboard: sound,
      bonk,
      raffle,
      raffle_v2: raffleV2,
      global,
    };
  }

  /** « Viewer… » search: every viewer seen (and the team), with role and restriction badges. */
  async search(channelId: string, query: string, limit = 12) {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const now = this.clock.now();
    const rows = await this.db.query<{
      viewer_id: string;
      display_name: string;
      last_seen: Date;
      staff_role: string | null;
      blocked: boolean;
      cooldown: boolean;
    }>(
      `select v.viewer_id, v.display_name, v.last_seen, s.role as staff_role,
         exists (select 1 from lab_viewer_blocks b where b.channel_id = v.channel_id and b.viewer_id = v.viewer_id
           and (b.until is null or b.until > $5)) as blocked,
         exists (select 1 from lab_viewer_cooldowns c where c.channel_id = v.channel_id and c.viewer_id = v.viewer_id
           and c.until > $5) as cooldown
       from lab_viewers v left join lab_staff s on s.channel_id = v.channel_id and s.viewer_id = v.viewer_id
       where v.channel_id = $1 and ($2 = '' or v.display_name ilike $3 or v.viewer_id like $3)
       order by v.last_seen desc limit $4`,
      [channelId, query, like, limit, now],
    );
    return rows.map((r) => ({
      viewer_id: r.viewer_id,
      display_name: r.display_name,
      last_seen: new Date(r.last_seen).toISOString(),
      role:
        r.viewer_id === channelId ? 'broadcaster' : (r.staff_role ?? 'viewer'),
      restriction: r.blocked ? 'block' : r.cooldown ? 'cooldown' : null,
    }));
  }

  private async roleOf(q: Queryable, channelId: string, viewerId: string) {
    if (viewerId === channelId) return 'broadcaster';
    return (
      (
        await q.query<{ role: string }>(
          'select role from lab_staff where channel_id = $1 and viewer_id = $2',
          [channelId, viewerId],
        )
      )[0]?.role ?? 'viewer'
    );
  }

  /** Viewer card (D4 fiche): identity, role, Lab wallet, restrictions, activity, notes, ledger. */
  async viewer(channelId: string, viewerId: string) {
    const now = this.clock.now();
    const since = this.streamStart(now);
    const [wallet, restr, dir, role, activity, today, notes, ledger, history] =
      await Promise.all([
        readWallet(this.db, channelId, viewerId),
        restrictions(this.db, channelId, viewerId, now),
        this.db.query<{
          display_name: string;
          first_seen: Date;
          last_seen: Date;
        }>(
          'select display_name, first_seen, last_seen from lab_viewers where channel_id = $1 and viewer_id = $2',
          [channelId, viewerId],
        ),
        this.roleOf(this.db, channelId, viewerId),
        this.interactions(channelId, { viewer: viewerId, limit: 12 }),
        this.db.query<{ n: string | number }>(
          `select count(*) as n from ${INTERACTIONS} where channel_id = $1 and viewer_id = $2 and created_at >= $3`,
          [channelId, viewerId, since],
        ),
        this.db.query<{
          id: string;
          body: string;
          author: string;
          author_role: string;
          created_at: Date;
        }>(
          'select id, body, author, author_role, created_at from lab_viewer_notes where channel_id = $1 and viewer_id = $2 order by id desc',
          [channelId, viewerId],
        ),
        this.ledger(channelId, { viewer: viewerId, limit: 30, auto: true }),
        this.db.query(
          'select id, created_at, actor, role, module_id, action, interaction_id, reason, before, after from lab_moderation_audit where channel_id = $1 and viewer_id = $2 order by id desc limit 20',
          [channelId, viewerId],
        ),
      ]);
    const staff = await this.db.query<{
      login: string | null;
      display_name: string | null;
    }>(
      'select login, display_name from lab_staff where channel_id = $1 and viewer_id = $2',
      [channelId, viewerId],
    );
    return {
      viewer_id: viewerId,
      display_name:
        dir[0]?.display_name ??
        staff[0]?.display_name ??
        staff[0]?.login ??
        viewerId,
      role,
      staff: role !== 'viewer',
      /** Kept for older readers: supermod name (null otherwise). */
      staff_role: role === 'supermod' ? 'supermod' : null,
      first_seen: dir[0] ? new Date(dir[0].first_seen).toISOString() : null,
      last_seen: dir[0] ? new Date(dir[0].last_seen).toISOString() : null,
      today_count: Number(today[0]?.n ?? 0),
      wallet,
      restrictions: restr,
      tts_cooldown_until: await this.tts.runningCooldownUntil(
        channelId,
        viewerId,
      ),
      activity: activity.items,
      notes: notes.map((n) => ({
        id: Number(n.id),
        text: n.body,
        author: n.author,
        author_role: n.author_role,
        created_at: new Date(n.created_at).toISOString(),
      })),
      wallet_ledger: ledger.items,
      history,
      /** Tombola V2: part of the running round (before the draw) or not; null = no such round. */
      raffle: await this.raffle.participation(channelId, viewerId),
    };
  }

  /** Start of the current stream (D4 « Ce stream »): the Daily stream-day window, 16:00 Paris. */
  private streamStart(now: Date) {
    return streamDayWindow(nominalStreamDay(now)).start;
  }

  /**
   * D4 history « Interactions »: every module, filtered in Core (module, status family, viewer id or
   * name, period), newest first, paginated (`before` = created_at of the last row shown).
   */
  async interactions(
    channelId: string,
    f: {
      module?: string | null;
      status?: string | null;
      viewer?: string | null;
      q?: string | null;
      period?: string | null;
      before?: string | null;
      limit?: number;
    } = {},
  ) {
    const now = this.clock.now();
    const since =
      f.period === 'stream'
        ? this.streamStart(now)
        : f.period && /^\d{1,5}$/.test(f.period)
          ? new Date(now.getTime() - Number(f.period) * 60_000)
          : null;
    const limit = Math.min(200, Math.max(1, f.limit ?? 60));
    const like = f.q ? `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db.query<InteractionRow>(
      `select * from (select ix.*, ${STATUS_KEY} as status_key from ${INTERACTIONS} where ix.channel_id = $1) x
       where ($2::text is null or module = $2) and ($3::text is null or status_key = $3)
         and ($4::text is null or viewer_id = $4) and ($5::text is null or viewer_display_name ilike $5)
         and ($6::timestamptz is null or created_at >= $6) and ($7::timestamptz is null or created_at < $7)
       order by created_at desc limit $8`,
      [
        channelId,
        f.module && f.module !== 'all' ? f.module : null,
        f.status && f.status !== 'all' ? f.status : null,
        f.viewer ?? null,
        like,
        since,
        f.before ? new Date(f.before) : null,
        limit + 1,
      ],
    );
    const items = rows.slice(0, limit).map(interactionView);
    return {
      items,
      more: rows.length > limit,
      since: since?.toISOString() ?? null,
    };
  }

  /** One interaction of any module, with what D4's drawer shows (who ended it, linked movements). */
  async interaction(channelId: string, id: string) {
    const row = (
      await this.db.query<InteractionRow>(
        `select ix.*, ${STATUS_KEY} as status_key from ${INTERACTIONS} where ix.channel_id = $1 and ix.interaction_id = $2`,
        [channelId, id],
      )
    )[0];
    if (!row) return null;
    const base = interactionView(row);
    const extra =
      row.module === 'tts'
        ? await this.db.query(
            `select i.message, i.error, i.review_hits, i.reviewed_by, i.reviewed_at, i.character_id, i.voice_profile_id,
               i.estimated_duration_ms, d.completed_at, d.started_at
             from tts_lab_interactions i left join tts_lab_deliveries d using (interaction_id) where i.interaction_id = $1`,
            [id],
          )
        : row.module === 'soundboard'
          ? await this.db.query(
              `select i.sound_label, i.error, i.duration_ms, d.completed_at, d.started_at, d.stopped_at
               from sound_lab_interactions i left join sound_lab_deliveries d using (interaction_id) where i.interaction_id = $1`,
              [id],
            )
          : row.module === 'bonk'
            ? await this.db.query(
                `select i.emote_id, i.emote_glyph, i.emote_url, i.error, d.completed_at, d.started_at
                 from bonk_lab_interactions i left join bonk_lab_deliveries d using (interaction_id) where i.interaction_id = $1`,
                [id],
              )
            : await this.db.query(
                'select raffle_id, created_at as completed_at from lab_raffle_entries where entry_id = $1',
                [id],
              );
    const ended = (
      await this.db.query<{
        action: string;
        actor: string;
        role: string;
        created_at: Date;
        after: { refund?: boolean } | null;
      }>(
        `select action, actor, role, created_at, after from lab_moderation_audit where channel_id = $1 and interaction_id = $2
         order by id`,
        [channelId, id],
      )
    ).map((a) => ({ ...a, created_at: new Date(a.created_at).toISOString() }));
    const movements = (
      await this.db.query<{ id: string; kind: string; amount: string }>(
        `select id, kind, currency, amount, created_at from lab_wallet_ledger where interaction_id = $1 order by id`,
        [id],
      )
    ).map((m) => ({ ...m, id: Number(m.id), amount: Number(m.amount) }));
    return {
      ...base,
      ...(extra[0] ?? {}),
      actions: ended,
      movements,
    };
  }

  /**
   * D4 « Activité Jetons »: the Lab test wallet ledger (a viewer, or the whole channel), with the
   * operation type and its `visible_in_moderation_activity` flag, the linked interaction and the
   * refund / original debit links. `auto` = include the automatic movements.
   */
  async ledger(
    channelId: string,
    f: {
      viewer?: string | null;
      before?: number | null;
      limit?: number;
      auto?: boolean;
    } = {},
  ) {
    const limit = Math.min(200, Math.max(1, f.limit ?? 60));
    const rows = await this.db.query<{
      id: string;
      viewer_id: string;
      display_name: string | null;
      kind: string;
      currency: string;
      amount: string;
      module_id: string | null;
      interaction_id: string | null;
      raffle_id: string | null;
      actor: string;
      reason: string | null;
      created_at: Date;
      refunded_by: string | null;
      refund_of: string | null;
    }>(
      `select l.id, l.viewer_id, v.display_name, l.kind, l.currency, l.amount, l.module_id, l.interaction_id, l.raffle_id,
         l.actor, l.reason, l.created_at,
         case when l.kind = 'debit' then (select r.id from lab_wallet_ledger r where r.kind = 'refund' and r.interaction_id = l.interaction_id) end as refunded_by,
         case when l.kind = 'refund' then (select d.id from lab_wallet_ledger d where d.kind = 'debit' and d.interaction_id = l.interaction_id) end as refund_of
       from lab_wallet_ledger l left join lab_viewers v on v.channel_id = l.channel_id and v.viewer_id = l.viewer_id
       where l.channel_id = $1 and ($2::text is null or l.viewer_id = $2) and ($3::bigint is null or l.id < $3)
       order by l.id desc limit $4`,
      [channelId, f.viewer ?? null, f.before ?? null, limit + 1],
    );
    const all = rows.slice(0, limit).map((r) => {
      const type = operationType(r.kind, r.module_id);
      const t = LEDGER_TYPES[type] ?? {
        label: type,
        visible_in_moderation_activity: true,
      };
      return {
        id: Number(r.id),
        viewer_id: r.viewer_id,
        viewer_display_name: r.display_name ?? r.viewer_id,
        kind: r.kind,
        operation_type: type,
        label:
          r.kind === 'refund'
            ? `Remboursement ${LEDGER_TYPES[r.module_id ?? '']?.label ?? ''}`.trim()
            : t.label,
        visible_in_moderation_activity: t.visible_in_moderation_activity,
        currency: r.currency,
        amount: Number(r.amount),
        module_id: r.module_id,
        interaction_id: r.interaction_id,
        raffle_id: r.raffle_id,
        actor: r.actor,
        reason: r.reason,
        created_at: new Date(r.created_at).toISOString(),
        refunded_by: r.refunded_by === null ? null : Number(r.refunded_by),
        refund_of: r.refund_of === null ? null : Number(r.refund_of),
      };
    });
    const items = f.auto
      ? all
      : all.filter((e) => e.visible_in_moderation_activity);
    return {
      items,
      hidden: all.length - items.length,
      more: rows.length > limit,
    };
  }

  /** D4 « Équipe & permissions »: broadcaster, supermods, moderators with their grants. */
  async team(channelId: string) {
    const rows = await this.db.query<{
      viewer_id: string;
      role: string;
      grants: string[];
      login: string | null;
      display_name: string | null;
      last_seen: Date | null;
    }>(
      `select s.viewer_id, s.role, s.grants, s.login, coalesce(s.display_name, v.display_name) as display_name, s.last_seen
       from lab_staff s left join lab_viewers v on v.channel_id = s.channel_id and v.viewer_id = s.viewer_id
       where s.channel_id = $1
       order by case s.role when 'broadcaster' then 0 when 'supermod' then 1 else 2 end,
         lower(coalesce(s.display_name, v.display_name, s.login, s.viewer_id))`,
      [channelId],
    );
    const members = rows.map((r) => ({
      viewer_id: r.viewer_id,
      display_name: r.display_name ?? r.login ?? r.viewer_id,
      role: r.viewer_id === channelId ? 'broadcaster' : r.role,
      grants:
        r.role === 'moderator' && r.viewer_id !== channelId
          ? r.grants
          : [...GRANTS],
      last_seen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
    }));
    if (!members.some((m) => m.role === 'broadcaster')) {
      const name = (
        await this.db.query<{ display_name: string }>(
          'select display_name from lab_viewers where channel_id = $1 and viewer_id = $1',
          [channelId],
        )
      )[0]?.display_name;
      members.unshift({
        viewer_id: channelId,
        display_name: name ?? 'Streamer',
        role: 'broadcaster',
        grants: [...GRANTS],
        last_seen: null,
      });
    }
    return { members };
  }

  /** D4 « Surveillance »: the watched / blocked words. */
  async words(channelId: string) {
    return {
      words: (
        await this.db.query<{
          id: string;
          word: string;
          kind: string;
          created_by: string;
          created_at: Date;
        }>(
          'select id, word, kind, created_by, created_at from lab_tts_words where channel_id = $1 order by id',
          [channelId],
        )
      ).map((w) => ({
        ...w,
        id: Number(w.id),
        created_at: new Date(w.created_at).toISOString(),
      })),
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

  /** Read models are for the team: a viewer never reads them (Core-side check). */
  async assertReader(channelId: string, actor: Actor | null) {
    if (!actor) return; // Studio (local secret)
    const acc = await access(this.db, channelId, actor);
    if (!allowed(acc, 'viewer.read'))
      throw new LabForbiddenError('viewer.read', acc.role);
  }

  // --- Lab test wallet (Studio Dev/Lab only) ------------------------------------------------------------------------

  async wallet(channelId: string, viewerId: string) {
    return readWallet(this.db, channelId, viewerId);
  }

  async editWallet(channelId: string, req: LabWalletRequest) {
    if (req.actor.via !== 'studio')
      throw new LabModerationError(
        'studio_only',
        'the Lab wallet tools are Studio only',
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
