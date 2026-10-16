import { randomUUID } from 'node:crypto';
import type {
  LabChatMessage,
  WordGameAction,
  WordGameActiveWord,
  WordGameRecentWin,
  WordGameState,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import {
  insertWordGameSteps,
  type WordGameStepDraft,
} from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import {
  creditCurrency,
  CurrencyCreditError,
} from '../raffle-lab/currencies.js';
import {
  type ChannelSession,
  liveChannelSession,
} from '../stream/channel-sessions.js';
import { loadWordBank } from './bank.js';
import * as R from './rules.js';

// Jeu des mots V1 (Lab) — the canonical service (docs/WORD_GAME_PARITY.md). Pure rules: rules.ts (Lot 1);
// chat output: cmd_steps origin word_game (Lot 2); live session: the single reader liveChannelSession
// (read only: the session is opened / closed by the stream events and the Studio simulation, whatever
// the Tombola configuration); winnings: the Lab test wallet (Jetons).
//
// - The game runs only while a session is open. A new session starts with zero active word, an empty
//   streak and the cycle on (first word 5–15 min later); the active words of other sessions are
//   abandoned. A restart (Core / Studio) or a reconnection within the SAME session restores everything.
// - One winning message = one transaction under the channel row lock: words found, streak / breaker /
//   announcer, ONE Wallet credit (key jdm:<channel>:<message_id>), finds, chat messages. A replayed
//   message_id changes nothing; a plain message offline or without an active word writes nothing.

export class WordGameError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

interface ChannelRow {
  channel_id: string;
  session_id: string | null;
  stopped: boolean;
  next_word_at: Date | null;
  streak_holder_id: string | null;
  streak_holder_name: string | null;
  streak_count: number;
  announced_streak: number;
  announced_user_id: string | null;
  mots_at: Date | null;
}

interface WordRow {
  occurrence_id: string;
  word: string;
  shuffled: string;
  golden: boolean;
  source: 'cycle' | 'manual';
  created_at: Date;
}

const toActive = (w: WordRow): R.ActiveWord => ({
  occurrenceId: w.occurrence_id,
  word: w.word,
  shuffled: w.shuffled,
  golden: w.golden,
  createdAt: new Date(w.created_at).getTime(),
});

const streakOf = (row: ChannelRow | undefined, live: ChannelSession | null) =>
  row && live && row.session_id === live.session_id && row.streak_holder_id
    ? {
        holderId: row.streak_holder_id,
        holderName: row.streak_holder_name,
        count: row.streak_count,
      }
    : R.EMPTY_STREAK;

export type WordGameChatOutcome =
  'ignored' | 'word_game_win' | 'word_game_command';

export class WordGameService {
  private readonly bank: readonly string[];

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly rng: R.Rng = Math.random,
    bank?: readonly string[],
  ) {
    this.bank = bank ?? loadWordBank();
  }

  // --- chat (§§ 11, 17, 21, 22) ---------------------------------------------------------------------

  /** One chat message (plain or command). Never sends to Twitch: chat answers become cmd_steps. */
  async chat(
    msg: LabChatMessage,
  ): Promise<{ outcome: WordGameChatOutcome; replayed?: boolean }> {
    const command = msg.text.trim().toLowerCase();
    const isMots = command === '!mots';
    const isStreak = command === '!streakmot';
    // Cheap read path: a plain message offline or without any active word writes nothing.
    if (!isMots && !isStreak) {
      const live = await liveChannelSession(this.db, msg.channel_id);
      if (!live) return { outcome: 'ignored' };
      if (await this.won(this.db, msg))
        return { outcome: 'word_game_win', replayed: true };
      const active = await this.activeWords(
        this.db,
        msg.channel_id,
        live.session_id,
      );
      if (!R.matchWords(msg.text, active.map(toActive)).length)
        return { outcome: 'ignored' };
    }
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      if (await this.won(q, msg))
        return { outcome: 'word_game_win' as const, replayed: true };
      const { row, live } = await this.enter(q, msg.channel_id, now);
      let outcome: WordGameChatOutcome = 'ignored';
      if (live && (await this.win(q, row, live, msg, now)))
        outcome = 'word_game_win';
      if (isMots && (await this.mots(q, row, live, msg, now)))
        outcome = outcome === 'ignored' ? 'word_game_command' : outcome;
      if (isStreak) {
        const fresh = (await this.channelRow(q, msg.channel_id))!;
        await insertWordGameSteps(q, {
          channelId: msg.channel_id,
          now,
          drafts: [
            {
              idempotencyKey: `jdm:cmd:${msg.message_id}`,
              mode: 'announce',
              text: R.streakmotText(streakOf(fresh, live)),
            },
          ],
        });
        if (outcome === 'ignored') outcome = 'word_game_command';
      }
      return { outcome };
    });
  }

  /** Words found by this message, if any: everything in one go (§§ 4–10, 12.3–12.6, 21, 22). */
  private async win(
    q: Queryable,
    row: ChannelRow,
    live: ChannelSession,
    msg: LabChatMessage,
    now: Date,
  ): Promise<boolean> {
    const words = await this.activeWords(
      q,
      msg.channel_id,
      live.session_id,
      true,
    );
    const chatter = {
      id: msg.chatter.id,
      displayName: msg.chatter.display_name,
    };
    const out = R.evaluateMessage({
      message: msg.text,
      chatter,
      now: now.getTime(),
      active: words.map(toActive),
      streak: streakOf(row, live),
    });
    if (!out) return false;
    for (const f of out.finds)
      await q.query(
        `update word_game_words set status = 'found', found_at = $2, ended_at = $2, found_by_viewer_id = $3,
           found_message_id = $4 where occurrence_id = $1 and status = 'active'`,
        [f.occurrenceId, now, chatter.id, msg.message_id],
      );
    // ONE Wallet credit for the whole message (Lab test wallet, Jetons). A refused credit (balance cap,
    // currency unavailable) fails the whole message: the transaction rolls back (words still active,
    // streak, finds and chat untouched, no gain announced) and the message can be processed again.
    const key = `jdm:${msg.channel_id}:${msg.message_id}`;
    try {
      await creditCurrency(q, now, {
        channelId: msg.channel_id,
        viewerId: chatter.id,
        currencyId: 'tokens',
        amount: out.total,
      });
    } catch (e) {
      if (e instanceof CurrencyCreditError)
        throw new WordGameError(
          503,
          'credit_failed',
          `${e.code}: ${e.message}`,
        );
      throw e;
    }
    const ledger = Number(
      (
        await q.query<{ id: number }>(
          `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, actor, reason, created_at)
           values ($1, $2, 'word_game', 'tokens', $3, null, 'system', $4, $5) returning id`,
          [msg.channel_id, chatter.id, out.total, key, now],
        )
      )[0]!.id,
    );
    const pointsOfWords = out.finds.reduce((s, f) => s + f.points, 0);
    await q.query(
      `insert into word_game_messages (channel_id, message_id, session_id, viewer_id, viewer_display_name,
         words_points, combo, breaker, broken_viewer_id, broken_count, total, ledger_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        msg.channel_id,
        msg.message_id,
        live.session_id,
        chatter.id,
        chatter.displayName,
        pointsOfWords,
        out.combo,
        out.breaker?.bonus ?? 0,
        out.breaker?.brokenId ?? null,
        out.breaker?.brokenCount ?? null,
        out.total,
        ledger,
        now,
      ],
    );
    for (const f of out.finds)
      await q.query(
        `insert into word_game_finds (occurrence_id, channel_id, message_id, session_id, viewer_id,
           viewer_display_name, word, points, fast, golden, streak_after, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          f.occurrenceId,
          msg.channel_id,
          msg.message_id,
          live.session_id,
          chatter.id,
          chatter.displayName,
          f.word,
          f.points,
          f.fast,
          f.golden,
          f.streakAfter,
          now,
        ],
      );
    const ann = R.streakAnnouncement(
      { lastAnnounced: row.announced_streak, userId: row.announced_user_id },
      out.streak,
    );
    await q.query(
      `update word_game_channels set streak_holder_id = $2, streak_holder_name = $3, streak_count = $4,
         announced_streak = $5, announced_user_id = $6, updated_at = $7 where channel_id = $1`,
      [
        msg.channel_id,
        out.streak.holderId,
        out.streak.holderName,
        out.streak.count,
        ann.state.lastAnnounced,
        ann.state.userId,
        now,
      ],
    );
    const drafts: WordGameStepDraft[] = [
      {
        idempotencyKey: `jdm:msg:${msg.message_id}:find`,
        mode: 'announce',
        text: R.findAnnouncementText(chatter.displayName, out),
      },
    ];
    if (ann.announce)
      drafts.push({
        idempotencyKey: `jdm:msg:${msg.message_id}:streak`,
        mode: 'announce',
        text: R.streakAnnouncementText(
          chatter.displayName,
          out.streak.count,
          R.pickVariant(this.rng),
        ),
        delayMs: R.STREAK_ANNOUNCE_DELAY_MS,
      });
    if (out.breaker)
      drafts.push({
        idempotencyKey: `jdm:msg:${msg.message_id}:breaker`,
        mode: 'announce',
        text: R.breakerAnnouncementText(chatter.displayName, out.breaker),
        delayMs: R.BREAKER_ANNOUNCE_DELAY_MS,
      });
    await insertWordGameSteps(q, { channelId: msg.channel_id, now, drafts });
    return true;
  }

  /** !mots: the shuffled active words, 1 s for the whole channel (§§ 11, 12.7). */
  private async mots(
    q: Queryable,
    row: ChannelRow,
    live: ChannelSession | null,
    msg: LabChatMessage,
    now: Date,
  ): Promise<boolean> {
    if (
      row.mots_at &&
      now.getTime() - new Date(row.mots_at).getTime() < R.MOTS_COOLDOWN_MS
    )
      return false;
    await q.query(
      'update word_game_channels set mots_at = $2 where channel_id = $1',
      [msg.channel_id, now],
    );
    const active = live
      ? (await this.activeWords(q, msg.channel_id, live.session_id)).map(
          toActive,
        )
      : [];
    await insertWordGameSteps(q, {
      channelId: msg.channel_id,
      now,
      drafts: [
        {
          idempotencyKey: `jdm:cmd:${msg.message_id}`,
          mode: 'announce',
          text: R.motsText(active),
        },
      ],
    });
    return true;
  }

  // --- cycle (§§ 13–16) ------------------------------------------------------------------------------

  /** Lab Core tick: every live channel advances its cycle (one transaction per channel). */
  async tick(): Promise<number> {
    const channels = await this.db.query<{ channel_id: string }>(
      'select channel_id from lab_stream_sessions where ended_at is null',
    );
    for (const { channel_id } of channels)
      await this.db.tx((q) => this.advance(q, channel_id));
    return channels.length;
  }

  /** Due (or overdue after a restart): exactly ONE word, then the next one 5–15 min from now. */
  private async advance(q: Queryable, channelId: string) {
    const now = this.clock.now();
    const { row, live } = await this.enter(q, channelId, now);
    if (!live || row.stopped || !row.next_word_at) return;
    if (new Date(row.next_word_at) > now) return;
    await this.generate(
      q,
      channelId,
      live.session_id,
      now,
      'cycle',
      `jdm-${randomUUID()}`,
    );
    await q.query(
      'update word_game_channels set next_word_at = $2, updated_at = $3 where channel_id = $1',
      [channelId, new Date(now.getTime() + R.nextWordDelayMs(this.rng)), now],
    );
  }

  /** A new word, never one already active; cycle words come with the announcement (+500 ms). */
  private async generate(
    q: Queryable,
    channelId: string,
    sessionId: string,
    now: Date,
    source: 'cycle' | 'manual',
    occurrenceId: string,
  ): Promise<string | null> {
    const active = await q.query<{ word: string }>(
      `select word from word_game_words where channel_id = $1 and status = 'active'`,
      [channelId],
    );
    const word = R.pickWord(
      this.bank,
      active.map((w) => w.word),
      this.rng,
    );
    if (!word) return null;
    const shuffled = R.shuffleLetters(word, this.rng);
    const golden = R.rollGolden(this.rng);
    await q.query(
      `insert into word_game_words (occurrence_id, channel_id, session_id, word, shuffled, golden, source, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'active', $8)`,
      [occurrenceId, channelId, sessionId, word, shuffled, golden, source, now],
    );
    const publish: WordGameStepDraft = {
      idempotencyKey: `jdm:word:${occurrenceId}:publish`,
      mode: 'normal',
      text: R.publishText(shuffled, golden),
    };
    await insertWordGameSteps(q, {
      channelId,
      now,
      drafts:
        source === 'cycle'
          ? [
              {
                idempotencyKey: `jdm:word:${occurrenceId}:cycle`,
                mode: 'announce',
                text: R.CYCLE_ANNOUNCEMENT,
              },
              { ...publish, delayMs: R.CYCLE_TO_WORD_MS },
            ]
          : [publish],
    });
    return occurrenceId;
  }

  // --- Studio (§ 14) ---------------------------------------------------------------------------------

  async act(channelId: string, a: WordGameAction): Promise<WordGameState> {
    await this.db.tx(async (q) => {
      const now = this.clock.now();
      const { row, live } = await this.enter(q, channelId, now);
      if (!live) throw new WordGameError(409, 'offline');
      if (a.action === 'stop' && !row.stopped)
        await q.query(
          'update word_game_channels set stopped = true, next_word_at = null, updated_at = $2 where channel_id = $1',
          [channelId, now],
        );
      if (a.action === 'start' && row.stopped)
        await q.query(
          'update word_game_channels set stopped = false, next_word_at = $2, updated_at = $3 where channel_id = $1',
          [
            channelId,
            new Date(now.getTime() + R.nextWordDelayMs(this.rng)),
            now,
          ],
        );
      if (a.action === 'new_word') {
        // Like the legacy click on ShuffleWord: now, no announcement, the cycle is not shifted.
        const occurrenceId = `jdm-m-${a.request_id}`;
        const exists = await q.query(
          'select 1 from word_game_words where occurrence_id = $1',
          [occurrenceId],
        );
        if (!exists.length)
          await this.generate(
            q,
            channelId,
            live.session_id,
            now,
            'manual',
            occurrenceId,
          );
      }
    });
    return this.state(channelId);
  }

  /** Read only: what Studio shows (status, active words and their age, streak, recent wins). */
  async state(channelId: string): Promise<WordGameState> {
    const now = this.clock.now();
    const live = await liveChannelSession(this.db, channelId);
    const row = await this.channelRow(this.db, channelId);
    const current = !!live && row?.session_id === live.session_id;
    const active = live
      ? await this.activeWords(this.db, channelId, live.session_id)
      : [];
    const recent = await this.db.query<{
      message_id: string;
      viewer_id: string;
      viewer_display_name: string;
      combo: number;
      breaker: number;
      total: number;
      created_at: Date;
      words: { word: string; points: number; fast: boolean; golden: boolean }[];
    }>(
      `select m.message_id, m.viewer_id, m.viewer_display_name, m.combo, m.breaker, m.total,
         m.created_at,
         (select coalesce(json_agg(json_build_object('word', f.word, 'points', f.points, 'fast', f.fast,
             'golden', f.golden) order by f.occurrence_id), '[]'::json)
            from word_game_finds f where f.channel_id = m.channel_id and f.message_id = m.message_id) as words
       from word_game_messages m where m.channel_id = $1 order by m.created_at desc limit 10`,
      [channelId],
    );
    const streak = streakOf(row, live);
    const stopped = current ? row!.stopped : false;
    return {
      channel_id: channelId,
      live: !!live,
      session_id: live?.session_id ?? null,
      running: !!live && !stopped,
      stopped,
      next_word_at:
        current && row!.next_word_at
          ? new Date(row!.next_word_at).toISOString()
          : null,
      active: active
        .slice()
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .map((w): WordGameActiveWord => ({
          occurrence_id: w.occurrence_id,
          word: w.word,
          shuffled: w.shuffled,
          golden: w.golden,
          source: w.source,
          created_at: new Date(w.created_at).toISOString(),
          age_seconds: R.ageSeconds(
            new Date(w.created_at).getTime(),
            now.getTime(),
          ),
        })),
      streak: {
        holder_id: streak.holderId,
        holder_name: streak.holderName,
        count: streak.count,
      },
      recent: recent.map((r): WordGameRecentWin => ({
        message_id: r.message_id,
        viewer_id: r.viewer_id,
        viewer_display_name: r.viewer_display_name,
        words: r.words.map((w) => ({ ...w, points: Number(w.points) })),
        combo: Number(r.combo),
        breaker: Number(r.breaker),
        total: Number(r.total),
        created_at: new Date(r.created_at).toISOString(),
      })),
    };
  }

  // --- helpers ---------------------------------------------------------------------------------------

  /**
   * Locks the channel row (created if missing) and aligns it with the open session: a new session
   * abandons the active words of the others and resets the streak, the announcer, « Arrêter » and the
   * cycle (first word 5–15 min later). Same session: nothing changes (restart / reconnection restore).
   */
  private async enter(
    q: Queryable,
    channelId: string,
    now: Date,
  ): Promise<{ row: ChannelRow; live: ChannelSession | null }> {
    await q.query(
      'insert into word_game_channels (channel_id, updated_at) values ($1, $2) on conflict (channel_id) do nothing',
      [channelId, now],
    );
    let row = (
      await q.query<ChannelRow>(
        'select * from word_game_channels where channel_id = $1 for update',
        [channelId],
      )
    )[0]!;
    const live = await liveChannelSession(q, channelId);
    if (live && row.session_id !== live.session_id) {
      await q.query(
        `update word_game_words set status = 'abandoned', ended_at = $2
         where channel_id = $1 and status = 'active' and session_id <> $3`,
        [channelId, now, live.session_id],
      );
      row = (
        await q.query<ChannelRow>(
          `update word_game_channels set session_id = $2, stopped = false, next_word_at = $3,
             streak_holder_id = null, streak_holder_name = null, streak_count = 0, announced_streak = 0,
             announced_user_id = null, mots_at = null, updated_at = $4
           where channel_id = $1 returning *`,
          [
            channelId,
            live.session_id,
            new Date(now.getTime() + R.nextWordDelayMs(this.rng)),
            now,
          ],
        )
      )[0]!;
    }
    return { row, live };
  }

  private async channelRow(q: Queryable, channelId: string) {
    return (
      await q.query<ChannelRow>(
        'select * from word_game_channels where channel_id = $1',
        [channelId],
      )
    )[0];
  }

  private async activeWords(
    q: Queryable,
    channelId: string,
    sessionId: string,
    lock = false,
  ) {
    return q.query<WordRow>(
      `select occurrence_id, word, shuffled, golden, source, created_at from word_game_words
       where channel_id = $1 and session_id = $2 and status = 'active'
       order by created_at${lock ? ' for update' : ''}`,
      [channelId, sessionId],
    );
  }

  private async won(q: Queryable, msg: LabChatMessage) {
    return (
      (
        await q.query(
          'select 1 from word_game_messages where channel_id = $1 and message_id = $2',
          [msg.channel_id, msg.message_id],
        )
      ).length > 0
    );
  }
}
