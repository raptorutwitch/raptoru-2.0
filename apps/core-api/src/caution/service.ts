import { randomUUID } from 'node:crypto';
import {
  CAUTION,
  CAUTION_EXEC,
  CAUTION_OPEN,
  cautionPrice,
  type CautionCheckReport,
  type CautionClaimRequest,
  type CautionRecheckReport,
  type CautionReleaseReport,
  type CautionSanction,
  type CautionStatus,
  type LabChatMessage,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import {
  assertNotGloballyPaused,
  GlobalPauseError,
  LabWalletError,
} from '../lab-moderation/store.js';

// Caution (docs/CAUTION.md) — SAMMI's CAUTION_START / CONFIRM / FINISH as ONE Core module (Lab Core and main Core).
// `!caution pseudo` → the Twitch executor (the bot, like Random Ban) reads the target and its sanction → Core quotes
// 1 000 Jetons per started minute left (30 s to answer) → the payer's `oui` → the executor RE-READS the sanction →
// Core debits (same transaction as « releasing ») → the executor journals, unbans once, checks → Core records:
// released · refunded exactly once (certainly not lifted, or the timeout had already ended) · « uncertain » (to
// verify, never refunded automatically). Never a debit without a fresh read; never an unban before the debit is
// committed; at most one open caution per channel (DB index, so two Cores cannot open two). The broadcaster cannot be
// timed out: his caution lifts the Votekick mute (CautionMutes, provided by Votekick; absent: never muted).
// Chat texts: SAMMI's. Answers only to real commands (no spam): `oui` / `non` from anyone but the payer, or with no
// quote, are silent; `!caution` alone answers at most once per viewer every 30 s.

export class CautionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** The broadcaster's Votekick mute (Votekick V2). Absent: the broadcaster is never muted. */
export interface CautionMutes {
  active(
    q: Queryable,
    channelId: string,
  ): Promise<{ id: string; endsAt: Date } | null>;
  /** Ends it now (paid), inside the caller's transaction; Studio restores OBS. */
  end(q: Queryable, channelId: string, muteId: string): Promise<void>;
}

interface Row {
  request_id: string;
  channel_id: string;
  seq: string;
  source_ref: string;
  mode: 'real' | 'dry_run';
  payer_id: string;
  payer_login: string;
  payer_name: string;
  target_input: string;
  target_id: string | null;
  target_login: string | null;
  target_name: string | null;
  kind: 'timeout' | 'mute' | null;
  status: CautionStatus;
  sanction_ends_at: Date | null;
  price: number | null;
  quote_expires_at: Date | null;
  confirm_ref: string | null;
  reason: string | null;
  error: string | null;
  money: 'none' | 'debited' | 'refunded' | 'to_verify';
  mute_id: string | null;
  executor_id: string | null;
  attempt_id: string | null;
  attempts: number;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  ended_at: Date | null;
}

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');
const COMMAND = /^!caution(?:\s+(\S+))?\s*$/i;
const cleanLogin = (s: string) => s.replace(/^@+/, '').toLowerCase();

export const cautionView = (r: Row) => ({
  request_id: r.request_id,
  status: r.status,
  mode: r.mode,
  payer: { id: r.payer_id, login: r.payer_login, name: r.payer_name },
  target_input: r.target_input,
  target: r.target_id
    ? { id: r.target_id, login: r.target_login, name: r.target_name }
    : null,
  kind: r.kind,
  price: r.price,
  sanction_ends_at: r.sanction_ends_at
    ? new Date(r.sanction_ends_at).toISOString()
    : null,
  quote_expires_at: r.quote_expires_at
    ? new Date(r.quote_expires_at).toISOString()
    : null,
  reason: r.reason,
  error: r.error,
  money: r.money,
  attempts: r.attempts,
  created_at: new Date(r.created_at).toISOString(),
  ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
});

interface Executor {
  login: string;
  can_read: boolean;
  can_release: boolean;
  missing: string[];
  at: number;
}

export class CautionService {
  private readonly executors = new Map<string, Executor>();
  private readonly helped = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly economy: EconomyPort,
    /** The channel's broadcaster (his caution is the Votekick mute), or null. */
    private readonly broadcasterOf: () => string | null,
    private readonly mutes: CautionMutes | null = null,
  ) {}

  private now() {
    return this.clock.now();
  }
  private ms(ms: number) {
    return new Date(this.now().getTime() + ms);
  }

  private lock(q: Queryable, channelId: string) {
    return q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `caution:${channelId}`,
    ]);
  }

  private async row(q: Queryable, id: string, forUpdate = false) {
    const r = (
      await q.query<Row>(
        `select * from caution_requests where request_id = $1${forUpdate ? ' for update' : ''}`,
        [id],
      )
    )[0];
    if (!r) throw new CautionError(404, 'caution_not_found');
    return r;
  }

  private async open(q: Queryable, channelId: string) {
    return (
      await q.query<Row>(
        `select * from caution_requests where channel_id = $1 and status = any($2::text[]) for update`,
        [channelId, CAUTION_OPEN],
      )
    )[0];
  }

  private async set(q: Queryable, id: string, fields: Partial<Row>) {
    const entries = Object.entries({ ...fields, updated_at: this.now() });
    await q.query(
      `update caution_requests set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(', ')} where request_id = $1`,
      [id, ...entries.map(([, v]) => v)],
    );
  }

  /** Ends a request (never touched again but by an « uncertain » settled later). */
  private end(
    q: Queryable,
    r: Row,
    status: CautionStatus,
    fields: Partial<Row> = {},
  ) {
    return this.set(q, r.request_id, {
      status,
      lease_expires_at: null,
      ended_at: this.now(),
      ...fields,
    });
  }

  /** One chat message per key (a replayed event or a second report writes nothing new). */
  private say(q: Queryable, channelId: string, key: string, text: string) {
    return insertWordGameSteps(q, {
      channelId,
      now: this.now(),
      // ponytail: no 'caution' origin in cmd_steps (a migration): the chat modules' generic one, like !rb / !fxcam.
      origin: 'mini_game',
      drafts: [{ idempotencyKey: `caution:${key}`, mode: 'normal', text }],
    });
  }

  /** The Twitch executor told Core recently that it can read Twitch (memory: this Core only). */
  executorReady(channelId: string) {
    const e = this.executors.get(channelId);
    return !!e && this.now().getTime() - e.at < 15_000 && e.can_read;
  }

  // --- chat -------------------------------------------------------------------------------------------------------

  async chat(msg: LabChatMessage): Promise<{ outcome: string }> {
    const text = msg.text.trim();
    const lower = text.toLowerCase();
    if (lower === CAUTION.confirmWord || lower === CAUTION.cancelWord)
      return this.answer(msg, lower === CAUTION.confirmWord);
    const m = COMMAND.exec(text);
    if (!m) return { outcome: 'ignored' };
    const payer = msg.chatter;
    if (!m[1]) {
      const now = this.now().getTime();
      if (now - (this.helped.get(payer.id) ?? 0) < CAUTION_EXEC.helpCooldownMs)
        return { outcome: 'help_throttled' };
      if (this.helped.size > 5000) this.helped.clear();
      this.helped.set(payer.id, now);
      await this.db.tx((q) =>
        this.say(
          q,
          msg.channel_id,
          `help:${msg.message_id}`,
          'Lève le ban de quelqu’un en payant pour lui - !caution "pseudo"',
        ),
      );
      return { outcome: 'help' };
    }
    const input = cleanLogin(m[1]);
    const key = `msg:${msg.message_id}`;
    const answer = (body: string) =>
      this.db.tx((q) => this.say(q, msg.channel_id, key, body));
    if (input === payer.login.toLowerCase()) {
      await answer(`${payer.login}, tu ne peux pas payer ta propre caution`);
      return { outcome: 'self' };
    }
    if (!this.executorReady(msg.channel_id)) {
      await answer('Caution indisponible pour le moment · aucun jeton débité.');
      return { outcome: 'unavailable' };
    }
    try {
      return await this.db.tx(async (q) => {
        await assertNotGloballyPaused(q, msg.channel_id);
        await this.lock(q, msg.channel_id);
        await this.sweep(q, msg.channel_id);
        const seen = (
          await q.query(
            'select 1 from caution_requests where channel_id = $1 and source_ref = $2',
            [msg.channel_id, msg.message_id],
          )
        ).length;
        if (seen) return { outcome: 'replayed' };
        const busy = await this.open(q, msg.channel_id);
        if (busy) {
          await this.say(
            q,
            msg.channel_id,
            key,
            busy.status === 'quoted'
              ? `Une caution pour ${busy.target_login} attend déjà la réponse de ${busy.payer_login}.`
              : 'Une caution est déjà en cours, réessaie dans un instant.',
          );
          return { outcome: 'busy' };
        }
        await q.query(
          `insert into caution_requests (request_id, channel_id, source_ref, mode, payer_id, payer_login, payer_name,
             target_input, status, lease_expires_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'checking', $9, $10, $10)`,
          [
            randomUUID(),
            msg.channel_id,
            msg.message_id,
            msg.source === 'simulator' ? 'dry_run' : 'real',
            payer.id,
            payer.login,
            payer.display_name,
            input.slice(0, 64),
            this.ms(CAUTION_EXEC.pickupMs),
            this.now(),
          ],
        );
        return { outcome: 'checking' };
      });
    } catch (e) {
      if (e instanceof GlobalPauseError) {
        await answer('Raptoru en pause · aucun jeton débité.');
        return { outcome: 'paused' };
      }
      throw e;
    }
  }

  /** `oui` / `non`: only the payer of the quoted caution; anything else is silent. */
  private async answer(msg: LabChatMessage, yes: boolean) {
    const out = await this.db.tx(async (q) => {
      await this.lock(q, msg.channel_id);
      const r = await this.open(q, msg.channel_id);
      if (!r || r.payer_id !== msg.chatter.id)
        return { outcome: 'ignored' } as const;
      if (r.confirm_ref === msg.message_id)
        return { outcome: 'replayed' } as const;
      if (r.status !== 'quoted') return { outcome: 'ignored' } as const;
      const key = `${r.request_id}:answer`;
      if (!yes) {
        await this.end(q, r, 'cancelled', {
          reason: 'cancelled',
          confirm_ref: msg.message_id,
        });
        await this.say(
          q,
          r.channel_id,
          key,
          `Caution annulée par ${r.payer_login}. Aucun jeton débité.`,
        );
        return { outcome: 'cancelled' } as const;
      }
      if (this.now() >= new Date(r.quote_expires_at!)) {
        await this.end(q, r, 'expired', {
          reason: 'quote_expired',
          confirm_ref: msg.message_id,
        });
        await this.say(
          q,
          r.channel_id,
          key,
          'Cette proposition de caution a expiré. Relance !caution @pseudo.',
        );
        return { outcome: 'expired' } as const;
      }
      if (r.kind === 'mute') return this.payMute(q, r, msg.message_id);
      // A timeout: the executor re-reads it before anything is debited.
      await this.set(q, r.request_id, {
        status: 'confirmed',
        confirm_ref: msg.message_id,
        attempts: 0,
        executor_id: null,
        attempt_id: null,
        lease_expires_at: this.ms(CAUTION_EXEC.pickupMs),
      });
      return { outcome: 'confirmed' } as const;
    });
    return out;
  }

  /** The broadcaster's mute: re-checked, debited and ended in ONE transaction (no Twitch call). */
  private async payMute(q: Queryable, r: Row, confirmRef: string) {
    const mute = await this.mutes?.active(q, r.channel_id);
    const key = `${r.request_id}:answer`;
    if (!mute || mute.id !== r.mute_id || mute.endsAt <= this.now()) {
      await this.end(q, r, 'refused', {
        reason: 'mute_over',
        confirm_ref: confirmRef,
      });
      await this.say(
        q,
        r.channel_id,
        key,
        `Le mute de ${r.target_login} vient de se terminer. Aucun jeton débité.`,
      );
      return { outcome: 'mute_over' } as const;
    }
    try {
      await q.query('savepoint caution_debit');
      await this.economy.debit(q, this.now(), {
        channelId: r.channel_id,
        viewer: { id: r.payer_id, display_name: r.payer_name },
        currency: 'tokens',
        amount: r.price!,
        module: 'caution',
        interactionId: r.request_id,
      });
      await q.query('release savepoint caution_debit');
    } catch (e) {
      await q.query('rollback to savepoint caution_debit');
      if (!(e instanceof LabWalletError)) throw e;
      return this.refuseDebit(q, r, e, confirmRef);
    }
    await this.mutes!.end(q, r.channel_id, mute.id);
    await this.end(q, r, 'released', {
      money: 'debited',
      confirm_ref: confirmRef,
    });
    await this.say(
      q,
      r.channel_id,
      `${r.request_id}:end`,
      `@${r.payer_login} a libéré ${r.target_login} pour ${fmt(r.price!)} jetons !`,
    );
    return { outcome: 'released' } as const;
  }

  private async refuseDebit(
    q: Queryable,
    r: Row,
    e: LabWalletError,
    confirmRef?: string,
  ) {
    const poor = e.code === 'insufficient_tokens';
    await this.end(q, r, 'refused', {
      reason: poor ? 'insufficient' : 'wallet_unavailable',
      ...(confirmRef ? { confirm_ref: confirmRef } : {}),
    });
    await this.say(
      q,
      r.channel_id,
      `${r.request_id}:end`,
      poor
        ? `${r.payer_login}, tu es trop pauvre pour payer cette caution ptdr bouge de là. Il faut ${fmt(r.price!)} jetons et tu en as ${fmt(Number(e.details.balance ?? 0))}.`
        : `${r.payer_login}, impossible de vérifier ton solde pour le moment. Aucun jeton débité, aucune sanction levée.`,
    );
    return { outcome: poor ? 'insufficient' : 'wallet_unavailable' } as const;
  }

  // --- sweep: what was left behind, decided once ------------------------------------------------------------------

  private async sweep(q: Queryable, channelId: string) {
    const r = await this.open(q, channelId);
    if (!r) return;
    const now = this.now();
    const over = (d: Date | null) => !!d && new Date(d) <= now;
    const unavailable =
      'Caution indisponible pour le moment · aucun jeton débité.';
    if (
      (r.status === 'checking' || r.status === 'confirmed') &&
      over(r.lease_expires_at)
    ) {
      await this.end(q, r, 'failed', { reason: 'executor_absent' });
      await this.say(q, channelId, `${r.request_id}:end`, unavailable);
    } else if (
      (r.status === 'quoting' || r.status === 'rechecking') &&
      over(r.lease_expires_at)
    ) {
      // Nothing was debited yet: safe to offer the read again, a few times.
      if (r.attempts < CAUTION_EXEC.maxAttempts)
        await this.set(q, r.request_id, {
          status: r.status === 'quoting' ? 'checking' : 'confirmed',
          executor_id: null,
          attempt_id: null,
          lease_expires_at: this.ms(CAUTION_EXEC.pickupMs),
        });
      else {
        await this.end(q, r, 'failed', { reason: 'executor_lost' });
        await this.say(q, channelId, `${r.request_id}:end`, unavailable);
      }
    } else if (r.status === 'quoted' && over(r.quote_expires_at)) {
      // Silent, like SAMMI: the payer is told only if he answers late.
      await this.end(q, r, 'expired', { reason: 'quote_expired' });
    } else if (r.status === 'releasing' && over(r.lease_expires_at)) {
      // Debited, the unban may have been sent: never again, the Jetons wait for a check.
      await this.end(q, r, 'uncertain', {
        money: 'to_verify',
        error: 'no_answer_after_release',
      });
      await this.say(
        q,
        channelId,
        `${r.request_id}:end`,
        `Libération de ${r.target_login} à vérifier par la modération (${fmt(r.price!)} jetons payés par ${r.payer_login}).`,
      );
    }
  }

  // --- the Twitch executor ----------------------------------------------------------------------------------------

  /** The executor asks for work (with its capabilities): the open caution waiting for a Twitch read, if any. */
  async claim(channelId: string, c: CautionClaimRequest) {
    this.executors.set(channelId, {
      login: c.login,
      can_read: c.can_read,
      can_release: c.can_release,
      missing: c.missing,
      at: this.now().getTime(),
    });
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      await this.sweep(q, channelId);
      const r = await this.open(q, channelId);
      if (!r || (r.status !== 'checking' && r.status !== 'confirmed'))
        return { job: null, reason: r ? 'busy' : 'idle' };
      const release = r.status === 'confirmed';
      const lacks = !c.can_read
        ? 'read'
        : release && r.mode === 'real' && !c.can_release
          ? 'release'
          : null;
      if (lacks) {
        await this.end(q, r, 'failed', {
          reason: `missing_scope_${lacks}`,
          error: c.missing.join(', ').slice(0, 300),
        });
        await this.say(
          q,
          channelId,
          `${r.request_id}:end`,
          'Caution indisponible pour le moment · aucun jeton débité.',
        );
        return { job: null, reason: 'refused' };
      }
      const attempt = randomUUID();
      await this.set(q, r.request_id, {
        status: release ? 'rechecking' : 'quoting',
        executor_id: c.executor_id,
        attempt_id: attempt,
        attempts: r.attempts + 1,
        lease_expires_at: this.ms(CAUTION_EXEC.readLeaseMs),
      });
      return {
        job: {
          request_id: r.request_id,
          attempt_id: attempt,
          phase: release ? ('release' as const) : ('quote' as const),
          mode: r.mode,
          target_login: r.target_login ?? r.target_input,
          target_id: r.target_id,
        },
      };
    });
  }

  private current(r: Row, executorId: string, attemptId: string) {
    if (r.executor_id !== executorId || r.attempt_id !== attemptId)
      throw new CautionError(409, 'not_current_attempt');
  }

  /** Quote phase: the target and its sanction → a quote, or a readable refusal. Nothing is debited here. */
  async check(id: string, rep: CautionCheckReport) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      this.current(r, rep.executor_id, rep.attempt_id);
      if (r.status !== 'quoting') throw new CautionError(409, 'not_quoting');
      const ch = r.channel_id;
      const key = `${r.request_id}:quote`;
      const refuse = async (
        reason: string,
        text: string,
        f: Partial<Row> = {},
      ) => {
        await this.end(q, r, 'refused', { reason, ...f });
        await this.say(q, ch, key, text);
        return { status: 'refused' as const, reason };
      };
      if ('error' in rep) {
        await this.end(q, r, 'failed', {
          reason: 'twitch_unreadable',
          error: rep.error,
        });
        await this.say(
          q,
          ch,
          key,
          `Impossible de vérifier ${r.target_input} pour le moment · aucun jeton débité.`,
        );
        return { status: 'failed' as const, reason: 'twitch_unreadable' };
      }
      const t = rep.target;
      if (!t)
        return refuse(
          'unknown_target',
          `${r.payer_login}, utilisateur Twitch introuvable : ${r.target_input} Vérifie le pseudo`,
        );
      const who = {
        target_id: t.id,
        target_login: t.login,
        target_name: t.name,
      };
      if (t.id === r.payer_id)
        return refuse(
          'self',
          `${r.payer_login}, tu ne peux pas payer ta propre caution`,
          who,
        );
      const now = this.now();
      const quote = async (
        kind: 'timeout' | 'mute',
        endsAt: Date,
        text: (price: number, s: number) => string,
        muteId?: string,
      ) => {
        const remainingS = Math.ceil((endsAt.getTime() - now.getTime()) / 1000);
        const price = cautionPrice(remainingS);
        await this.set(q, r.request_id, {
          ...who,
          kind,
          status: 'quoted',
          sanction_ends_at: endsAt,
          price,
          mute_id: muteId ?? null,
          quote_expires_at: this.ms(CAUTION.quoteMs),
          lease_expires_at: null,
        });
        await this.say(q, ch, key, text(price, remainingS));
        return { status: 'quoted' as const, price };
      };
      if (t.id === this.broadcasterOf()) {
        const mute = await this.mutes?.active(q, ch);
        if (!mute || mute.endsAt <= now)
          return refuse(
            'not_muted',
            `${t.login} n'est pas actuellement réduit au silence.`,
            who,
          );
        return quote(
          'mute',
          mute.endsAt,
          (price, s) =>
            `${t.login} est réduit au silence encore ${s} ${s > 1 ? 'secondes' : 'seconde'}. Le libérer coûte ${fmt(price)} jetons, @${r.payer_login}. Oui ou non ?`,
          mute.id,
        );
      }
      const s = rep.sanction;
      if (s.kind === 'none')
        return refuse('no_timeout', `${t.login} n'a aucun timeout actif`, who);
      if (s.kind === 'permanent')
        return refuse(
          'permanent',
          `Le ban permanent de ${t.login} ne peut pas être racheté`,
          who,
        );
      const ends = new Date(s.ends_at);
      if (ends <= now)
        return refuse(
          'ended',
          `Le timeout de ${t.login} est déjà terminé.`,
          who,
        );
      return quote('timeout', ends, (price, sec) => {
        const min = Math.ceil(sec / 60);
        return `${t.login} est banni encore ${min} ${min > 1 ? 'minutes' : 'minute'}. Le libérer coûte ${fmt(price)} jetons, @${r.payer_login}. Oui ou non ?`;
      });
    });
  }

  /**
   * Release phase, the sanction re-read just now: still a timeout (not longer than quoted) → DEBITED and « releasing »
   * in one transaction, the executor may unban; otherwise ended without any debit. A dry run (Studio's simulator)
   * ends here: debited and « released » without any Twitch call.
   */
  async recheck(id: string, rep: CautionRecheckReport) {
    const decided = await this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      this.current(r, rep.executor_id, rep.attempt_id);
      if (r.status === 'releasing')
        return { proceed: true as const, target_id: r.target_id! }; // a repeated report gets the same answer
      if (r.status !== 'rechecking')
        throw new CautionError(409, 'not_rechecking');
      const ch = r.channel_id;
      const key = `${r.request_id}:end`;
      const stop = async (
        status: CautionStatus,
        reason: string,
        text: string,
        f: Partial<Row> = {},
      ) => {
        await this.end(q, r, status, { reason, ...f });
        await this.say(q, ch, key, text);
        return { proceed: false as const, reason };
      };
      if ('error' in rep)
        return stop(
          'failed',
          'twitch_unreadable',
          `Impossible de vérifier le timeout de ${r.target_login}. Aucun jeton débité.`,
          { error: rep.error },
        );
      const s: CautionSanction = rep.sanction;
      const now = this.now();
      if (
        s.kind === 'none' ||
        (s.kind === 'timeout' && new Date(s.ends_at) <= now)
      )
        return stop(
          'refused',
          'no_longer',
          `${r.target_login} n'est plus en timeout. Aucun jeton débité.`,
        );
      if (s.kind === 'permanent')
        return stop(
          'refused',
          'now_permanent',
          `La sanction de ${r.target_login} est devenue un ban permanent. Aucun jeton débité.`,
        );
      const remainingS = Math.ceil(
        (new Date(s.ends_at).getTime() - now.getTime()) / 1000,
      );
      if (cautionPrice(remainingS) > r.price!)
        return stop(
          'refused',
          'extended',
          `Le timeout de ${r.target_login} a été prolongé : relance !caution ${r.target_login}. Aucun jeton débité.`,
        );
      try {
        await q.query('savepoint caution_debit');
        await this.economy.debit(q, now, {
          channelId: ch,
          viewer: { id: r.payer_id, display_name: r.payer_name },
          currency: 'tokens',
          amount: r.price!,
          module: 'caution',
          interactionId: r.request_id,
        });
        await q.query('release savepoint caution_debit');
      } catch (e) {
        await q.query('rollback to savepoint caution_debit');
        if (!(e instanceof LabWalletError)) throw e;
        await this.refuseDebit(q, r, e);
        return { proceed: false as const, reason: 'debit_refused' };
      }
      if (r.mode === 'dry_run') {
        await this.end(q, r, 'released', {
          money: 'debited',
          sanction_ends_at: new Date(s.ends_at),
          reason: 'dry_run',
        });
        await this.say(
          q,
          ch,
          key,
          `[test] ${r.payer_login} paie ${fmt(r.price!)} jetons : ${r.target_login} serait libéré (simulation, aucun appel Twitch).`,
        );
        return { proceed: false as const, reason: 'dry_run' };
      }
      await this.set(q, r.request_id, {
        status: 'releasing',
        money: 'debited',
        sanction_ends_at: new Date(s.ends_at),
        lease_expires_at: this.ms(CAUTION_EXEC.releaseLeaseMs),
      });
      return { proceed: true as const, target_id: r.target_id! };
    });
    return decided;
  }

  /**
   * The release result. released → done · not_applied / not_banned → refunded exactly once (same transaction) ·
   * uncertain → to verify. Idempotent: a final result stays; only an « uncertain » can still be settled (the bot's
   * journal after a restart).
   */
  async result(id: string, rep: CautionReleaseReport) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, id, true);
      this.current(r, rep.executor_id, rep.attempt_id);
      const settles = r.status === 'releasing' || r.status === 'uncertain';
      if (!settles) return cautionView(r);
      const ch = r.channel_id;
      const key = `${r.request_id}:end:${rep.event}`;
      if (rep.event === 'released') {
        await this.end(q, r, 'released', {
          money: 'debited',
          error: rep.verified ? 'verified_after_ambiguous_answer' : null,
        });
        await this.say(
          q,
          ch,
          key,
          `@${r.payer_login} a libéré ${r.target_login} pour ${fmt(r.price!)} jetons !`,
        );
      } else if (rep.event === 'not_applied' || rep.event === 'not_banned') {
        const back = await this.economy.refund(
          q,
          this.now(),
          r.request_id,
          'system',
          `Caution : ${rep.event === 'not_banned' ? 'timeout déjà terminé' : 'libération refusée'} (${r.target_login})`.slice(
            0,
            200,
          ),
        );
        await this.end(q, r, 'failed', {
          reason: rep.event,
          error: (rep.error ?? null)?.slice(0, 300) ?? null,
          money: 'refunded',
        });
        const amount = fmt(back.amount || r.price!);
        await this.say(
          q,
          ch,
          key,
          rep.event === 'not_banned'
            ? `${r.target_login} n'était plus en timeout : ${r.payer_login} a été remboursé de ${amount} jetons.`
            : `La libération de ${r.target_login} a échoué : ${r.payer_login} a été remboursé de ${amount} jetons.`,
        );
      } else if (r.status === 'releasing') {
        await this.end(q, r, 'uncertain', {
          money: 'to_verify',
          error: (rep.error ?? 'uncertain').slice(0, 300),
        });
        await this.say(
          q,
          ch,
          `${r.request_id}:end`,
          `Libération de ${r.target_login} à vérifier par la modération (${fmt(r.price!)} jetons payés par ${r.payer_login}).`,
        );
      }
      return cautionView(await this.row(q, id));
    });
  }

  /** Studio: recent cautions, the executor, what is to verify. */
  async state(channelId: string) {
    const recent = await this.db.query<Row>(
      'select * from caution_requests where channel_id = $1 order by seq desc limit 20',
      [channelId],
    );
    const e = this.executors.get(channelId);
    return {
      executor: e
        ? {
            login: e.login,
            can_read: e.can_read,
            can_release: e.can_release,
            missing: e.missing,
            seen_ms_ago: this.now().getTime() - e.at,
          }
        : null,
      ready: this.executorReady(channelId),
      to_verify: recent.filter((r) => r.money === 'to_verify').length,
      recent: recent.map(cautionView),
    };
  }
}
