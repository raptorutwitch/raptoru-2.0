import { randomInt, randomUUID } from 'node:crypto';
import {
  broadcasterMuteSeconds,
  VOTEKICK,
  VOTEKICK_EXEC,
  VOTEKICK_RUNNING,
  votekickVerdict,
  type LabChatMessage,
  type VotekickCheckReport,
  type VotekickClaimRequest,
  type VotekickMuteReport,
  type VotekickOverlayEvent,
  type VotekickStatus,
  type VotekickTimeoutReport,
  type VotekickUser,
} from '@raptoru/schemas';
import type { CautionMutes } from '../caution/service.js';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import { avatarUrls } from '../raffle-lab/avatars.js';
import {
  assertNotGloballyPaused,
  GlobalPauseError,
} from '../lab-moderation/store.js';

// Votekick V2 in production (docs/VOTEKICK_V2.md § 9) — the rules of packages/schemas/src/votekick.ts and the chat
// texts of SAMMI (the in-memory engine.ts is their reference), held in the database like Caution:
// `!votekick pseudo` → the Twitch executor (the bot) reads the target and the moderators → the vote opens 60 s
// (announced, initiator's hourly cooldown recorded) → `!kick` / `!save` (exact, case sensitive; one ballot per voter,
// changing one's mind updates it; the initiator counts KICK and cannot vote) → at the end Core decides the verdict
// (votekickVerdict, coin flip from crypto) → the executor applies the timeout once (confirmed / refused / uncertain),
// or, for the broadcaster (never timed out), Studio mutes OBS for broadcasterMuteSeconds. The broadcaster's mute is
// also the CautionMutes of Caution: a paid caution ends it. Time-driven steps (the vote's end, leases, the mute's end)
// are taken by tick(), every 500 ms in the Core process. One vote at a time per channel: advisory lock + partial
// unique index (two Cores cannot open two). The overlay reads `overlay()`: live tallies, then the verdict 7 s, then
// clear — every visible change bumps `seq` (a stale event of the same vote is ignored by the overlay).
// Studio's chat simulator (source « simulator ») runs a dry run: without an executor the target is resolved from the
// chatters seen in that chat, and the timeout is simulated (never sent); the broadcaster's mute stays real (local OBS).

export class VotekickError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

interface Row {
  vote_id: string;
  channel_id: string;
  source_ref: string;
  mode: 'real' | 'dry_run';
  status: VotekickStatus;
  initiator_id: string;
  initiator_login: string;
  initiator_name: string;
  target_input: string;
  target_id: string | null;
  target_login: string | null;
  target_name: string | null;
  opened_at: Date | null;
  ends_at: Date | null;
  seq: number;
  kick: number | null;
  save: number | null;
  outcome: string | null;
  punished_id: string | null;
  punished_login: string | null;
  minutes: number | null;
  duration_s: number | null;
  sanction: 'none' | 'twitch_timeout' | 'obs_mute' | null;
  applied: string | null;
  reason: string | null;
  error: string | null;
  executor_id: string | null;
  attempt_id: string | null;
  attempts: number;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  decided_at: Date | null;
  ended_at: Date | null;
}

interface MuteRow {
  mute_id: string;
  channel_id: string;
  vote_id: string;
  seconds: number;
  status: 'pending' | 'active' | 'ended' | 'failed';
  starts_at: Date | null;
  ends_at: Date | null;
  end_reason: 'expired' | 'caution' | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface Executor {
  login: string;
  can_read: boolean;
  can_timeout: boolean;
  missing: string[];
  at: number;
}

const COMMAND = /^!votekick(?:\s+(\S+))?(?:\s|$)/i;
const cleanLogin = (s: string) => s.replace(/[@\s"]/g, '').toLowerCase();
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const UNREADABLE =
  'Impossible de vérifier cette cible Twitch. Réessaie dans quelques secondes';

export const votekickView = (r: Row) => ({
  vote_id: r.vote_id,
  mode: r.mode,
  status: r.status,
  initiator: r.initiator_login,
  target: r.target_login ?? r.target_input,
  kick: r.kick,
  save: r.save,
  outcome: r.outcome,
  punished: r.punished_login,
  minutes: r.minutes,
  sanction: r.sanction,
  applied: r.applied,
  reason: r.reason,
  error: r.error,
  created_at: iso(r.created_at),
  opened_at: iso(r.opened_at),
  decided_at: iso(r.decided_at),
});

export class VotekickService implements CautionMutes {
  private readonly executors = new Map<string, Executor>();
  private readonly helped = new Map<string, number>();
  /** Chatters seen in the simulated chat, per channel: the dry run's « Twitch » (login → identity). */
  private readonly simulated = new Map<
    string,
    Map<string, { user: VotekickUser; moderator: boolean }>
  >();
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** The channel's broadcaster (muted in OBS instead of a timeout), or null. */
    private readonly broadcasterOf: () => string | null,
    /** 0 = the target loses the coin flip, 1 = the initiator (tests inject it). */
    private readonly coin: () => 0 | 1 = () => randomInt(2) as 0 | 1,
  ) {}

  /** The Twitch profile pictures (the Tombola's cache, lab_viewer_avatars): the target's picture for the overlay. */
  private avatars: { ensure(ids: string[]): Promise<unknown> } | null = null;
  attachAvatars(cache: { ensure(ids: string[]): Promise<unknown> }) {
    this.avatars = cache;
  }

  /** The cached picture of a Twitch user, '' when unknown (the overlay shows its fallback). */
  private async avatar(id: string | null) {
    if (!id) return '';
    return (await avatarUrls(this.db, [id])).get(id) ?? '';
  }

  private now() {
    return this.clock.now();
  }
  private ms(ms: number) {
    return new Date(this.now().getTime() + ms);
  }

  private lock(q: Queryable, channelId: string) {
    return q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `votekick:${channelId}`,
    ]);
  }

  private async row(q: Queryable, id: string, forUpdate = false) {
    const r = (
      await q.query<Row>(
        `select * from votekick_votes where vote_id = $1${forUpdate ? ' for update' : ''}`,
        [id],
      )
    )[0];
    if (!r) throw new VotekickError(404, 'vote_not_found');
    return r;
  }

  private async running(q: Queryable, channelId: string) {
    return (
      await q.query<Row>(
        `select * from votekick_votes where channel_id = $1 and status = any($2::text[]) for update`,
        [channelId, VOTEKICK_RUNNING],
      )
    )[0];
  }

  private async set(q: Queryable, id: string, fields: Partial<Row>) {
    const entries = Object.entries({ ...fields, updated_at: this.now() });
    await q.query(
      `update votekick_votes set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(', ')} where vote_id = $1`,
      [id, ...entries.map(([, v]) => v)],
    );
  }

  private close(
    q: Queryable,
    r: Row,
    status: 'done' | 'refused' | 'failed',
    fields: Partial<Row> = {},
  ) {
    return this.set(q, r.vote_id, {
      status,
      lease_expires_at: null,
      ended_at: this.now(),
      ...fields,
    });
  }

  /** One chat message per key (a replayed event or a second report writes nothing new). */
  private say(
    q: Queryable,
    channelId: string,
    key: string,
    text: string,
    announce = false,
  ) {
    return insertWordGameSteps(q, {
      channelId,
      now: this.now(),
      // ponytail: no 'votekick' origin in cmd_steps (a migration): the chat modules' generic one, like Caution.
      origin: 'mini_game',
      drafts: [
        {
          idempotencyKey: `votekick:${key}`,
          mode: announce ? 'announce' : 'normal',
          text,
        },
      ],
    });
  }

  /** The Twitch executor told Core recently that it can read Twitch (memory: this Core only). */
  executorReady(channelId: string) {
    const e = this.executors.get(channelId);
    return !!e && this.now().getTime() - e.at < 15_000 && e.can_read;
  }

  private remember(msg: LabChatMessage) {
    if (msg.source !== 'simulator') return;
    let seen = this.simulated.get(msg.channel_id);
    if (!seen) this.simulated.set(msg.channel_id, (seen = new Map()));
    if (seen.size > 2000) seen.clear();
    seen.set(msg.chatter.login.toLowerCase(), {
      user: {
        id: msg.chatter.id,
        login: msg.chatter.login,
        name: msg.chatter.display_name,
      },
      moderator: msg.chatter.role === 'moderator',
    });
  }

  // --- chat -------------------------------------------------------------------------------------------------------

  async chat(msg: LabChatMessage): Promise<{ outcome: string }> {
    this.remember(msg);
    const text = msg.text.trim();
    if (text === VOTEKICK.kickCommand || text === VOTEKICK.saveCommand)
      return this.ballot(msg, text === VOTEKICK.kickCommand ? 'kick' : 'save');
    const m = COMMAND.exec(text);
    if (!m) return { outcome: 'ignored' };
    const initiator = msg.chatter;
    if (!m[1]) {
      const now = this.now().getTime();
      if (
        now - (this.helped.get(initiator.id) ?? 0) <
        VOTEKICK_EXEC.helpCooldownMs
      )
        return { outcome: 'help_throttled' };
      if (this.helped.size > 5000) this.helped.clear();
      this.helped.set(initiator.id, now);
      await this.db.tx((q) =>
        this.say(
          q,
          msg.channel_id,
          `help:${msg.message_id}`,
          'Pour lancer un vote contre quelqu’un du chat -> !votekick pseudo',
        ),
      );
      return { outcome: 'help' };
    }
    const input = cleanLogin(m[1]).slice(0, 64);
    const key = `msg:${msg.message_id}`;
    const ch = msg.channel_id;
    const mode = msg.source === 'simulator' ? 'dry_run' : 'real';
    try {
      return await this.db.tx(async (q) => {
        await assertNotGloballyPaused(q, ch);
        await this.lock(q, ch);
        await this.sweep(q, ch);
        const seen = (
          await q.query(
            'select 1 from votekick_votes where channel_id = $1 and source_ref = $2',
            [ch, msg.message_id],
          )
        ).length;
        if (seen) return { outcome: 'replayed' };
        if (await this.running(q, ch)) {
          await this.say(q, ch, key, 'Un Votekick est déjà en cours.');
          return { outcome: 'busy' };
        }
        const cooldown = (
          await q.query<{ until_at: Date }>(
            'select until_at from votekick_cooldowns where channel_id = $1 and initiator_id = $2',
            [ch, initiator.id],
          )
        )[0];
        if (cooldown && this.now() < new Date(cooldown.until_at)) {
          await this.say(
            q,
            ch,
            key,
            `@${initiator.login} tu as déjà lancé un Votekick récemment`,
          );
          return { outcome: 'cooldown' };
        }
        if (input === initiator.login.toLowerCase()) {
          await this.say(
            q,
            ch,
            key,
            'Tu ne peux pas lancer un Votekick contre toi-même. (espèce d’aw)',
          );
          return { outcome: 'self' };
        }
        const simulate = mode === 'dry_run' && !this.executorReady(ch);
        if (!simulate && !this.executorReady(ch)) {
          await this.say(q, ch, key, UNREADABLE);
          return { outcome: 'unavailable' };
        }
        const id = randomUUID();
        await q.query(
          `insert into votekick_votes (vote_id, channel_id, source_ref, mode, status, initiator_id, initiator_login,
             initiator_name, target_input, lease_expires_at, created_at, updated_at)
           values ($1, $2, $3, $4, 'checking', $5, $6, $7, $8, $9, $10, $10)`,
          [
            id,
            ch,
            msg.message_id,
            mode,
            initiator.id,
            initiator.login,
            initiator.display_name,
            input,
            this.ms(VOTEKICK_EXEC.pickupMs),
            this.now(),
          ],
        );
        if (!simulate) return { outcome: 'checking' };
        // Dry run without an executor: the simulated chat's chatters are « Twitch ».
        const known = this.simulated.get(ch)?.get(input);
        return this.applyCheck(q, await this.row(q, id, true), {
          target: known?.user ?? {
            id: `sim-${input}`,
            login: input,
            name: input,
          },
          moderator: known?.moderator ?? false,
        });
      });
    } catch (e) {
      if (e instanceof GlobalPauseError) {
        await this.db.tx((q) => this.say(q, ch, key, 'Raptoru en pause.'));
        return { outcome: 'paused' };
      }
      throw e;
    }
  }

  /** `!kick` / `!save`: one ballot per voter (a change of mind updates it); late or without a vote: silent. */
  private async ballot(msg: LabChatMessage, choice: 'kick' | 'save') {
    return this.db.tx(async (q) => {
      await this.lock(q, msg.channel_id);
      const v = (
        await q.query<Row>(
          `select * from votekick_votes where channel_id = $1 and status = 'open' for update`,
          [msg.channel_id],
        )
      )[0];
      if (!v || this.now() >= new Date(v.ends_at!))
        return { outcome: 'no_vote' };
      if (msg.chatter.id === v.initiator_id) {
        await this.say(
          q,
          v.channel_id,
          `${v.vote_id}:initiator:${msg.message_id}`,
          `@${msg.chatter.login} l'initiateur ne peut pas voter dans son propre procès`,
        );
        return { outcome: 'initiator' };
      }
      const before = (
        await q.query<{ choice: string }>(
          'select choice from votekick_ballots where vote_id = $1 and voter_id = $2',
          [v.vote_id, msg.chatter.id],
        )
      )[0];
      if (before?.choice === choice) return { outcome: 'same' };
      await q.query(
        `insert into votekick_ballots (vote_id, voter_id, choice, updated_at) values ($1, $2, $3, $4)
         on conflict (vote_id, voter_id) do update set choice = excluded.choice, updated_at = excluded.updated_at`,
        [v.vote_id, msg.chatter.id, choice, this.now()],
      );
      await this.set(q, v.vote_id, { seq: v.seq + 1 });
      return { outcome: before ? 'changed' : 'counted' };
    });
  }

  /** The target is read: refuse (no such user, self, moderator, broadcaster already muted) or open the 60 s vote. */
  private async applyCheck(
    q: Queryable,
    r: Row,
    rep:
      | { target: VotekickUser | null; moderator: boolean }
      | { error: string; stage: 'user' | 'moderators' },
  ) {
    const ch = r.channel_id;
    const key = `${r.vote_id}:check`;
    const refuse = async (reason: string, text: string) => {
      await this.close(q, r, 'refused', { reason });
      await this.say(q, ch, key, text);
      return { outcome: reason };
    };
    if ('error' in rep) {
      await this.close(q, r, 'failed', {
        reason:
          rep.stage === 'moderators' ? 'mods_unreadable' : 'twitch_unreadable',
        error: rep.error.slice(0, 300),
      });
      await this.say(
        q,
        ch,
        key,
        rep.stage === 'moderators'
          ? 'Impossible de vérifier les modérateurs Twitch. Votekick annulé par sécurité'
          : UNREADABLE,
      );
      return { outcome: 'failed' };
    }
    const t = rep.target;
    if (!t) return refuse('unknown_target', 'Utilisateur Twitch introuvable.');
    const target = {
      target_id: t.id,
      target_login: t.login,
      target_name: t.name,
    };
    await this.set(q, r.vote_id, target);
    if (t.id === r.initiator_id)
      return refuse(
        'self',
        'Tu ne peux pas lancer un Votekick contre toi-même. (espèce d’aw)',
      );
    if (t.id === this.broadcasterOf()) {
      const mute = await this.currentMute(q, ch);
      if (mute)
        return refuse(
          'already_muted',
          `${t.login} est déjà réduit au silence pour encore environ ${this.remainingS(mute)} seconde(s).`,
        );
    } else if (rep.moderator)
      return refuse('moderator', 'Tu ne peux pas cibler un modérateur');
    const opened = this.now();
    await this.set(q, r.vote_id, {
      status: 'open',
      opened_at: opened,
      ends_at: new Date(opened.getTime() + VOTEKICK.voteMs),
      lease_expires_at: null,
      seq: r.seq + 1,
    });
    // The target's picture for the overlay: fetched aside (never delays or fails the vote), read by overlay().
    if (r.mode === 'real') void this.avatars?.ensure([t.id]).catch(() => {});
    await q.query(
      `insert into votekick_cooldowns (channel_id, initiator_id, until_at) values ($1, $2, $3)
       on conflict (channel_id, initiator_id) do update set until_at = excluded.until_at`,
      [ch, r.initiator_id, this.ms(VOTEKICK.initiatorCooldownMs)],
    );
    await this.say(
      q,
      ch,
      `${r.vote_id}:open`,
      `⚖️ Votekick lancé contre ${t.login} par ${r.initiator_login} ! Votez !kick ou !save pendant 60 secondes`,
      true,
    );
    return { outcome: 'opened' };
  }

  // --- the Twitch executor (the bot) ------------------------------------------------------------------------------

  async claim(channelId: string, c: VotekickClaimRequest) {
    this.executors.set(channelId, {
      login: c.login,
      can_read: c.can_read,
      can_timeout: c.can_timeout,
      missing: c.missing,
      at: this.now().getTime(),
    });
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      await this.sweep(q, channelId);
      const r = (
        await q.query<Row>(
          `select * from votekick_votes where channel_id = $1
             and (status = 'checking' or (status = 'sanctioning' and attempt_id is null and mode = 'real'))
           order by created_at limit 1 for update`,
          [channelId],
        )
      )[0];
      if (!r) return { job: null, reason: 'idle' };
      const attempt = randomUUID();
      if (r.status === 'checking') {
        if (!c.can_read) {
          await this.close(q, r, 'failed', {
            reason: 'missing_scope_read',
            error: c.missing.join(', ').slice(0, 300),
          });
          await this.say(q, channelId, `${r.vote_id}:check`, UNREADABLE);
          return { job: null, reason: 'refused' };
        }
        await this.set(q, r.vote_id, {
          status: 'reading',
          executor_id: c.executor_id,
          attempt_id: attempt,
          attempts: r.attempts + 1,
          lease_expires_at: this.ms(VOTEKICK_EXEC.readLeaseMs),
        });
        return {
          job: {
            vote_id: r.vote_id,
            attempt_id: attempt,
            phase: 'check' as const,
            target_login: r.target_input,
          },
        };
      }
      if (!c.can_timeout) {
        await this.notSent(q, r, 'missing_scope_timeout', c.missing.join(', '));
        return { job: null, reason: 'refused' };
      }
      await this.set(q, r.vote_id, {
        executor_id: c.executor_id,
        attempt_id: attempt,
        attempts: r.attempts + 1,
        lease_expires_at: this.ms(VOTEKICK_EXEC.timeoutLeaseMs),
      });
      return {
        job: {
          vote_id: r.vote_id,
          attempt_id: attempt,
          phase: 'timeout' as const,
          target_id: r.punished_id!,
          target_login: r.punished_login!,
          seconds: r.duration_s!,
          reason: `Votekick populaire — ${r.outcome}`,
        },
      };
    });
  }

  private current(r: Row, executorId: string, attemptId: string) {
    if (r.executor_id !== executorId || r.attempt_id !== attemptId)
      throw new VotekickError(409, 'not_current_attempt');
  }

  async check(id: string, rep: VotekickCheckReport) {
    return this.db.tx(async (q) => {
      const r0 = await this.row(q, id);
      await this.lock(q, r0.channel_id);
      const r = await this.row(q, id, true);
      this.current(r, rep.executor_id, rep.attempt_id);
      if (r.status !== 'reading') throw new VotekickError(409, 'not_reading');
      return this.applyCheck(q, r, rep);
    });
  }

  async timeoutResult(id: string, rep: VotekickTimeoutReport) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      this.current(r, rep.executor_id, rep.attempt_id);
      if (r.status !== 'sanctioning')
        throw new VotekickError(409, 'not_sanctioning');
      await this.close(q, r, 'done', {
        applied: rep.event,
        error: rep.error?.slice(0, 300) ?? null,
      });
      if (rep.event === 'refused')
        await this.say(
          q,
          r.channel_id,
          `${r.vote_id}:sanction`,
          `Twitch a refusé le timeout de ${r.punished_login} (Votekick).`,
        );
      return { status: 'done', applied: rep.event };
    });
  }

  /** The verdict's timeout was certainly never sent (no executor took it, or it lacks the right). */
  private async notSent(q: Queryable, r: Row, reason: string, error = '') {
    await this.close(q, r, 'done', {
      applied: 'not_sent',
      reason,
      error: error.slice(0, 300) || null,
    });
    await this.say(
      q,
      r.channel_id,
      `${r.vote_id}:sanction`,
      `Timeout de ${r.punished_login} impossible pour le moment (Votekick).`,
    );
  }

  // --- time-driven steps ----------------------------------------------------------------------------------------------

  /** Every 500 ms in the Core process: votes due, leases and mutes that ran out. Never two at a time. */
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      const due = await this.db.query<{ channel_id: string }>(
        `select distinct channel_id from votekick_votes
          where (status = 'open' and ends_at <= $1)
             or (status in ('checking', 'reading', 'sanctioning') and lease_expires_at <= $2)
         union
         select distinct channel_id from votekick_mutes
          where (status = 'pending' and created_at <= $3) or (status = 'active' and ends_at <= $2)`,
        [
          new Date(now.getTime() - VOTEKICK.finishGraceMs),
          now,
          new Date(now.getTime() - VOTEKICK_EXEC.mutePickupMs),
        ],
      );
      for (const { channel_id } of due)
        await this.db.tx(async (q) => {
          await this.lock(q, channel_id);
          await this.sweep(q, channel_id);
        });
    } finally {
      this.ticking = false;
    }
  }

  /** Inside the channel's lock: everything due is taken, once. */
  private async sweep(q: Queryable, ch: string) {
    const now = this.now();
    const rows = await q.query<Row>(
      `select * from votekick_votes where channel_id = $1
         and ((status = 'open' and ends_at <= $2)
           or (status in ('checking', 'reading', 'sanctioning') and lease_expires_at <= $3))
       for update`,
      [ch, new Date(now.getTime() - VOTEKICK.finishGraceMs), now],
    );
    for (const r of rows) {
      if (r.status === 'open') await this.finish(q, r);
      else if (r.status === 'sanctioning') {
        if (!r.attempt_id) await this.notSent(q, r, 'executor_absent');
        // Claimed and never reported: the timeout may or may not be on Twitch.
        else await this.close(q, r, 'done', { applied: 'uncertain' });
      } else if (
        r.status === 'reading' &&
        r.attempts < VOTEKICK_EXEC.maxAttempts
      )
        // A read that never reported changed nothing: offered again.
        await this.set(q, r.vote_id, {
          status: 'checking',
          attempt_id: null,
          lease_expires_at: this.ms(VOTEKICK_EXEC.pickupMs),
        });
      else {
        await this.close(q, r, 'failed', {
          reason: r.status === 'checking' ? 'executor_absent' : 'read_lost',
        });
        await this.say(q, ch, `${r.vote_id}:check`, UNREADABLE);
      }
    }
    const mutes = await q.query<MuteRow>(
      `select * from votekick_mutes where channel_id = $1
         and ((status = 'pending' and created_at <= $2) or (status = 'active' and ends_at <= $3))
       for update`,
      [ch, new Date(now.getTime() - VOTEKICK_EXEC.mutePickupMs), now],
    );
    for (const m of mutes) {
      if (m.status === 'active') {
        await this.setMute(q, m.mute_id, {
          status: 'ended',
          end_reason: 'expired',
        });
        continue;
      }
      await this.muteFailed(q, m, 'studio_absent');
    }
  }

  /** The 60 s are over: the verdict (rules: votekickVerdict), then its sanction. */
  private async finish(q: Queryable, r: Row) {
    const ballots = await q.query<{ voter_id: string; choice: string }>(
      'select voter_id, choice from votekick_ballots where vote_id = $1',
      [r.vote_id],
    );
    const kick =
      (VOTEKICK.initiatorKicks ? 1 : 0) +
      ballots.filter((b) => b.choice === 'kick').length;
    const save = ballots.filter((b) => b.choice === 'save').length;
    const targetSaved = ballots.some(
      (b) => b.voter_id === r.target_id && b.choice === 'save',
    );
    const v = votekickVerdict({ kick, save, targetSaved }, this.coin);
    const punished =
      v.punished === 'target'
        ? { id: r.target_id!, login: r.target_login! }
        : v.punished === 'initiator'
          ? { id: r.initiator_id, login: r.initiator_login }
          : null;
    const decided = {
      kick,
      save,
      outcome: v.outcome,
      minutes: v.minutes,
      duration_s: v.durationS,
      punished_id: punished?.id ?? null,
      punished_login: punished?.login ?? null,
      decided_at: this.now(),
      seq: r.seq + 1,
    };
    if (!punished) {
      await this.close(q, r, 'done', { ...decided, sanction: 'none' });
      return;
    }
    if (punished.id === this.broadcasterOf()) {
      // The broadcaster cannot be timed out: muted in OBS by Studio (VK_MUTE_BROADCASTER).
      await this.close(q, r, 'done', { ...decided, sanction: 'obs_mute' });
      await this.startMute(
        q,
        r,
        Math.round(broadcasterMuteSeconds(v.durationS)),
      );
      return;
    }
    if (r.mode === 'dry_run') {
      await this.close(q, r, 'done', {
        ...decided,
        sanction: 'twitch_timeout',
        applied: 'simulated',
      });
      return;
    }
    await this.set(q, r.vote_id, {
      ...decided,
      status: 'sanctioning',
      sanction: 'twitch_timeout',
      attempt_id: null,
      executor_id: null,
      lease_expires_at: this.ms(VOTEKICK_EXEC.timeoutLeaseMs),
    });
  }

  // --- the broadcaster's mute (Studio) -----------------------------------------------------------------------------

  private async setMute(q: Queryable, id: string, fields: Partial<MuteRow>) {
    const entries = Object.entries({ ...fields, updated_at: this.now() });
    await q.query(
      `update votekick_mutes set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(', ')} where mute_id = $1`,
      [id, ...entries.map(([, v]) => v)],
    );
  }

  private async currentMute(q: Queryable, ch: string) {
    return (
      await q.query<MuteRow>(
        `select * from votekick_mutes where channel_id = $1 and status in ('pending', 'active') for update`,
        [ch],
      )
    )[0];
  }

  private remainingS(m: MuteRow) {
    if (m.status === 'pending') return m.seconds;
    return Math.max(
      0,
      Math.ceil((new Date(m.ends_at!).getTime() - this.now().getTime()) / 1000),
    );
  }

  /** A second mute while one runs only moves its end (Studio's controller does the same in OBS). */
  private async startMute(q: Queryable, r: Row, seconds: number) {
    const running = await this.currentMute(q, r.channel_id);
    if (running) {
      if (running.status === 'pending')
        await this.setMute(q, running.mute_id, {
          seconds: Math.max(running.seconds, seconds),
        });
      else
        await this.setMute(q, running.mute_id, {
          ends_at: new Date(
            Math.max(
              new Date(running.ends_at!).getTime(),
              this.now().getTime() + seconds * 1000,
            ),
          ),
        });
      await this.set(q, r.vote_id, { applied: 'muted' });
      return;
    }
    await q.query(
      `insert into votekick_mutes (mute_id, channel_id, vote_id, seconds, status, created_at, updated_at)
       values ($1, $2, $3, $4, 'pending', $5, $5)`,
      [`mute:${r.vote_id}`, r.channel_id, r.vote_id, seconds, this.now()],
    );
  }

  private async muteFailed(q: Queryable, m: MuteRow, error: string) {
    await this.setMute(q, m.mute_id, { status: 'failed', error });
    await this.set(q, m.vote_id, { applied: 'not_muted', error });
    await this.say(
      q,
      m.channel_id,
      `${m.vote_id}:mute`,
      'Mute du streamer impossible pour le moment (OBS).',
    );
  }

  /** Studio's mute controller reports: started (OBS muted: the time starts now) · failed · ended (restored). */
  async muteReport(channelId: string, muteId: string, rep: VotekickMuteReport) {
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const m = (
        await q.query<MuteRow>(
          'select * from votekick_mutes where mute_id = $1 and channel_id = $2 for update',
          [muteId, channelId],
        )
      )[0];
      if (!m) throw new VotekickError(404, 'mute_not_found');
      if (rep.event === 'started' && m.status === 'pending') {
        await this.setMute(q, m.mute_id, {
          status: 'active',
          starts_at: this.now(),
          ends_at: this.ms(m.seconds * 1000),
        });
        await this.set(q, m.vote_id, { applied: 'muted' });
      } else if (rep.event === 'failed' && m.status === 'pending')
        await this.muteFailed(q, m, rep.error?.slice(0, 300) || 'obs');
      return { mute_id: m.mute_id, status: m.status };
    });
  }

  /** CautionMutes: the broadcaster's running mute (his caution's price is its remaining seconds). */
  async active(q: Queryable, channelId: string) {
    const m = (
      await q.query<MuteRow>(
        `select * from votekick_mutes where channel_id = $1 and status = 'active'`,
        [channelId],
      )
    )[0];
    return m && new Date(m.ends_at!) > this.now()
      ? { id: m.mute_id, endsAt: new Date(m.ends_at!) }
      : null;
  }

  /** CautionMutes: a paid caution ends it now (inside Caution's transaction); Studio restores OBS. */
  async end(q: Queryable, channelId: string, muteId: string) {
    await q.query(
      `update votekick_mutes set status = 'ended', end_reason = 'caution', updated_at = $3
        where mute_id = $1 and channel_id = $2 and status = 'active'`,
      [muteId, channelId, this.now()],
    );
  }

  // --- reads (Studio, the overlay) ---------------------------------------------------------------------------------

  /** The overlay's event now: the live tallies, the verdict for 7 s, else clear. */
  async overlay(channelId: string): Promise<VotekickOverlayEvent> {
    const open = (
      await this.db.query<Row>(
        `select * from votekick_votes where channel_id = $1 and status = 'open'`,
        [channelId],
      )
    )[0];
    if (open) {
      const b = await this.db.query<{ choice: string }>(
        'select choice from votekick_ballots where vote_id = $1',
        [open.vote_id],
      );
      return {
        action: 'live',
        session: open.vote_id,
        seq: open.seq,
        target: open.target_login ?? open.target_input,
        initiator: open.initiator_login,
        avatar: await this.avatar(open.target_id),
        yes:
          (VOTEKICK.initiatorKicks ? 1 : 0) +
          b.filter((x) => x.choice === 'kick').length,
        no: b.filter((x) => x.choice === 'save').length,
        ends: new Date(open.ends_at!).getTime(),
      };
    }
    const last = (
      await this.db.query<Row>(
        `select * from votekick_votes where channel_id = $1 and decided_at is not null
          order by decided_at desc limit 1`,
        [channelId],
      )
    )[0];
    if (
      last &&
      this.now().getTime() - new Date(last.decided_at!).getTime() <
        VOTEKICK.resultMs
    ) {
      const muted = last.sanction === 'obs_mute';
      return {
        action: 'result',
        session: last.vote_id,
        seq: last.seq,
        target: last.target_login ?? last.target_input,
        initiator: last.initiator_login,
        avatar: await this.avatar(last.target_id),
        yes: last.kick ?? 0,
        no: last.save ?? 0,
        outcome: muted
          ? 'broadcaster_muted'
          : (last.outcome as VotekickOverlayEvent['outcome']),
        punished: last.punished_login ?? '',
        minutes: last.minutes ?? 0,
        mute_seconds: muted
          ? Math.round(broadcasterMuteSeconds(last.duration_s ?? 0))
          : 0,
      };
    }
    return {
      action: 'clear',
      session: last?.vote_id,
      seq: (last?.seq ?? 0) + 1,
    };
  }

  /** Studio's task: the overlay's event and the broadcaster's mute to start / end in OBS. */
  async studio(channelId: string) {
    const m = (
      await this.db.query<MuteRow>(
        `select * from votekick_mutes where channel_id = $1 order by created_at desc limit 1`,
        [channelId],
      )
    )[0];
    return {
      overlay: await this.overlay(channelId),
      mute: m
        ? {
            mute_id: m.mute_id,
            status: m.status,
            seconds: m.seconds,
            ends_at: iso(m.ends_at),
            end_reason: m.end_reason,
          }
        : null,
    };
  }

  /** Studio's Votekick section: the vote in progress, the mute, the executor, the last votes. */
  async state(channelId: string) {
    const recent = await this.db.query<Row>(
      `select * from votekick_votes where channel_id = $1 order by created_at desc limit 20`,
      [channelId],
    );
    const e = this.executors.get(channelId);
    const s = await this.studio(channelId);
    return {
      executor: e
        ? {
            login: e.login,
            ready: this.executorReady(channelId),
            can_read: e.can_read,
            can_timeout: e.can_timeout,
            missing: e.missing,
            seen_at: new Date(e.at).toISOString(),
          }
        : null,
      overlay: s.overlay,
      mute: s.mute,
      recent: recent.map(votekickView),
    };
  }
}
