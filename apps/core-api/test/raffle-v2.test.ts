import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  LabModerationCommand,
  RaffleCommand,
  type LabActor,
  type RaffleConfig,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { LabForbiddenError } from '../src/lab-moderation/store.js';
import { AvatarCache } from '../src/raffle-lab/avatars.js';
import {
  RaffleLabError409,
  RaffleLabService,
} from '../src/raffle-lab/raffle-lab-service.js';
import {
  autoWinners,
  DEFAULT_RAFFLE_CONFIG,
  randomJackpot,
  revealMs,
  split,
} from '../src/raffle-lab/rules.js';
import { LabChatRouter } from '../src/lab-chat/router.js';
import { createPgliteDb, setup } from './helpers.js';

// Tombola V2 (Lab) — Core is the single source of truth: admissions (extension, chat, aliases,
// one entry per viewer whatever the source), explicit phases, draw (normal, SUPER, FULL OSEILLE,
// giveaway), exact split, payouts in the chosen registered currency (exactly once), moderation
// actions with their permissions (D7), cancellation, stream session history, no spoiler for viewers.

const CH = '900100';
const T0 = new Date('2026-10-01T18:00:00Z');
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const ext = (
  id: string,
  role: LabActor['role'],
  login = `u${id}`,
): LabActor => ({
  id,
  login,
  display_name: login,
  role,
  via: 'extension',
});
const modA = ext('900102', 'moderator', 'lab_modo');
const modG = ext('900103', 'moderator', 'modo_tombola');
const superMod = ext('900108', 'moderator', 'grobinou');
const viewer = ext('900101', 'viewer', 'lab_viewer');
let seq = 0;

/** Fixed amount, custom winners, no SUPER / FULL roll: every random value is the test's choice. */
const QUIET: Partial<RaffleConfig> = {
  amount_mode: 'fixed',
  fixed_amount: 20_000,
  winners_mode: 'custom',
  winners_custom: 1,
  full: { enabled: false, chance_pct: 1 },
  super: { ...DEFAULT_RAFFLE_CONFIG.super, enabled: false },
};

async function lab() {
  const core = await setup();
  core.clock.set(T0);
  const queue: number[] = [];
  const random = () => (queue.length ? queue.shift()! : 0.42);
  const raffle = new RaffleLabService(core.db, core.clock, random);
  const m = new LabModerationService(
    core.db,
    core.clock,
    core.ttsLab,
    core.soundLab,
    core.bonkLab,
    raffle,
  );
  const mod = (command: Record<string, unknown>, actor: LabActor = studio) =>
    m.act(CH, { actor, command: LabModerationCommand.parse(command) });
  for (const a of [modA, modG, superMod]) await m.whoami(CH, a);
  await mod({ action: 'set_staff', viewer_id: superMod.id, role: 'supermod' });
  await mod({
    action: 'set_permission',
    viewer_id: modG.id,
    permission: 'raffle',
    granted: true,
  });
  const act = (command: Record<string, unknown>, actor: LabActor = studio) =>
    raffle.act(CH, { actor, command: RaffleCommand.parse(command) });
  const config = (patch: Partial<RaffleConfig> = {}) =>
    act({
      action: 'config',
      config: { ...DEFAULT_RAFFLE_CONFIG, ...QUIET, ...patch },
    });
  const joinExt = (v: string) =>
    raffle.join({
      channel_id: CH,
      viewer: { id: v, display_name: `V${v}` },
      idempotency_key: `ext-${v}-${++seq}`,
    });
  const chat = (
    v: string,
    text: string,
    role: 'viewer' | 'moderator' | 'broadcaster' = 'viewer',
    messageId = `msg-${++seq}`,
  ) =>
    raffle.chat({
      channel_id: CH,
      message_id: messageId,
      text,
      chatter: { id: v, login: `u${v}`, display_name: `V${v}`, role },
      source: 'simulator',
    });
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof LabForbiddenError) return 'forbidden';
      if (e instanceof RaffleLabError409) return e.code;
      throw e;
    }
  };
  const wallet = (v: string) => m.wallet(CH, v);
  const snap = () => raffle.snapshot(CH);
  const seen = (v: string | null = null) => raffle.viewerState(CH, v);
  /** Moves the clock and lets the Lab Core tick take the due transitions. */
  const after = async (ms: number) => {
    core.clock.advance(ms);
    await raffle.tick();
  };
  return {
    core,
    raffle,
    m,
    mod,
    act,
    config,
    joinExt,
    chat,
    code,
    wallet,
    snap,
    seen,
    after,
    queue,
  };
}

describe('Tombola V2 rules', () => {
  it('splits exactly: the remainder goes one unit at a time, the sum is the jackpot', () => {
    expect(split(20_000, 3)).toEqual([6667, 6667, 6666]);
    expect(split(5, 5)).toEqual([1, 1, 1, 1, 1]);
    for (const [t, k] of [
      [49_500, 7],
      [12_345, 4],
      [200_000, 6],
    ] as const)
      expect(split(t, k).reduce((a, b) => a + b, 0)).toBe(t);
  });

  it('automatic winners (D4): 1–2 → 1, 3 → 1 or 2, from 4 never more winners than losers', () => {
    expect(autoWinners(0, () => 0.5)).toBe(0);
    expect(autoWinners(1, () => 0.9)).toBe(1);
    expect(autoWinners(2, () => 0.9)).toBe(1);
    expect(autoWinners(3, () => 0.1)).toBe(1);
    expect(autoWinners(3, () => 0.9)).toBe(2);
    expect(autoWinners(25, () => 0.5)).toBe(4); // round(√25 × 0.8) = 4, jitter 0
    for (let n = 4; n <= 200; n++)
      for (const r of [0, 0.5, 0.99]) {
        const k = autoWinners(n, () => r);
        expect(k).toBeGreaterThanOrEqual(1);
        expect(k).toBeLessThanOrEqual(Math.floor(n / 2));
      }
  });

  it('random jackpot (D3): ~78 % under 20 000, ~18 % 20–40k, ~4 % 40–50k, rarer at the top, steps of 500', () => {
    let s = 7;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const values = Array.from({ length: 40_000 }, () =>
      randomJackpot(DEFAULT_RAFFLE_CONFIG.random, rnd),
    );
    const share = (lo: number, hi: number) =>
      values.filter((v) => v >= lo && v < hi).length / values.length;
    expect(share(5_000, 20_000)).toBeGreaterThan(0.75);
    expect(share(5_000, 20_000)).toBeLessThan(0.81);
    expect(share(20_000, 40_000)).toBeGreaterThan(0.15);
    expect(share(20_000, 40_000)).toBeLessThan(0.21);
    expect(share(40_000, 50_001)).toBeGreaterThan(0.02);
    expect(share(40_000, 50_001)).toBeLessThan(0.055);
    expect(share(5_000, 10_000)).toBeGreaterThan(share(15_000, 20_000)); // rarer towards the top
    expect(
      values.every((v) => v % 500 === 0 && v >= 5_000 && v <= 50_000),
    ).toBe(true);
  });

  it('reveal length depends on the type of reveal and the number of winners', () => {
    expect(revealMs('normal', false, 4)).toBeGreaterThan(
      revealMs('normal', false, 1),
    );
    expect(revealMs('super', false, 4)).toBeGreaterThan(
      revealMs('normal', false, 4),
    );
    expect(revealMs('normal', true, 1)).toBeGreaterThan(
      revealMs('normal', false, 1),
    );
  });
});

describe('Tombola V2 admissions', () => {
  it('extension and chat (!join, !enter, alias) land on one idempotent entry per viewer, first source kept', async () => {
    const { config, act, joinExt, chat, raffle, code } = await lab();
    await config({ join_commands: ['!join', '!enter', '!octobre'] });
    await act({ action: 'launch' });
    expect((await joinExt('900201')).replayed).toBe(false);
    expect(await chat('900201', '!join')).toEqual({
      outcome: 'already_joined',
    }); // ext then chat
    expect(await chat('900202', '!JOIN')).toEqual({ outcome: 'joined' });
    expect((await joinExt('900202')).replayed).toBe(true); // chat then ext
    expect(await chat('900203', '!enter salut')).toEqual({ outcome: 'joined' });
    expect(await chat('900204', '!octobre')).toEqual({ outcome: 'joined' });
    expect(await chat('900205', 'bonjour !join')).toEqual({
      outcome: 'ignored',
    });
    // A replayed chat message (EventSub retry) answers the same outcome, nothing more.
    expect(await chat('900206', '!join', 'viewer', 'dup-1')).toEqual({
      outcome: 'joined',
    });
    expect(await chat('900206', '!join', 'viewer', 'dup-1')).toEqual({
      outcome: 'joined',
      replayed: true,
    });
    const st = await raffle.viewerState(CH, '900202');
    expect(st.phase).toBe('open');
    expect(st.round).toMatchObject({
      participants: 5,
      joined: true,
      my_source: 'chat',
      counts: { chat: 4, extension: 1 },
    });
    // The extension button can be switched off by Studio: the chat still works.
    await config({
      join_commands: ['!join', '!enter', '!octobre'],
      extension_button: false,
    });
    expect(await code(joinExt('900207'))).toBe('extension_join_disabled');
    expect(await chat('900207', '!join')).toEqual({ outcome: 'joined' });
  });

  it('refuses when closed, round paused, blocked, module paused, global pause; simultaneous entries stay unique', async () => {
    const { config, act, joinExt, chat, code, mod, after } = await lab();
    await config();
    expect(await code(joinExt('900211'))).toBe('raffle_closed');
    await act({ action: 'launch' });
    await Promise.all([
      joinExt('900211'),
      chat('900211', '!join'),
      joinExt('900211'),
    ]);
    await mod(
      {
        action: 'block_viewer',
        viewer_id: '900212',
        module: 'raffle',
        duration_s: 300,
      },
      modA,
    );
    expect(await code(joinExt('900212'))).toBe('viewer_blocked');
    await mod(
      { action: 'module_state', module: 'raffle', state: 'paused' },
      modA,
    );
    expect(await code(joinExt('900213'))).toBe('raffle_paused');
    await mod(
      { action: 'module_state', module: 'raffle', state: 'active' },
      modA,
    );
    await mod({ action: 'global_pause', paused: true }, superMod);
    expect(await code(joinExt('900213'))).toBe('global_pause');
    expect((await chat('900213', '!join')).outcome).toBe('global_pause');
    await mod({ action: 'global_pause', paused: false }, superMod);
    await act({ action: 'pause' }, modG);
    expect(await code(joinExt('900214'))).toBe('round_paused');
    await act({ action: 'resume' }, modG);
    await after(62_000);
    expect(await code(joinExt('900215'))).toBe('raffle_closed'); // closes_at reached: Core drew
    const { round } = await (await lab()).seen(); // another channel state is untouched
    expect(round).toBeNull();
  });
});

describe('Tombola V2 phases and draw', () => {
  it('opening → open → drawing → revealing → revealed → finished, stamped at their scheduled time', async () => {
    const { config, act, joinExt, snap, after, core, queue } = await lab();
    await config({ winners_custom: 2 });
    await act({ action: 'launch' });
    expect((await snap()).round!.status).toBe('opening');
    await after(2_000);
    expect((await snap()).round).toMatchObject({
      status: 'open',
      remaining_ms: 60_000,
    });
    await joinExt('900221');
    await joinExt('900222');
    await joinExt('900223');
    queue.push(0, 0); // winners: first, then first of the rest
    await after(60_000); // closes_at
    const s1 = (await snap()).round!;
    expect(s1.status).toBe('drawing');
    expect(s1.reveal).toBeNull(); // nobody sees the winners during « Tirage en cours »
    await after(3_000); // drawing_s
    const s2 = (await snap()).round!;
    expect(s2.status).toBe('revealing');
    expect(s2.reveal!.winners.map((w) => [w.viewer_id, w.amount])).toEqual([
      ['900221', 10_000],
      ['900222', 10_000],
    ]);
    expect(s2.reveal!.pool).toHaveLength(3);
    const rows = await core.db.query<{
      status: string;
      phase_changed_at: Date;
      reveal_at: Date;
    }>('select status, phase_changed_at, reveal_at from lab_raffles');
    expect(new Date(rows[0]!.phase_changed_at).toISOString()).toBe(
      new Date(rows[0]!.reveal_at).toISOString(),
    );
    await after(revealMs('normal', false, 2));
    expect((await snap()).round!.status).toBe('revealed');
    await after(14_000);
    expect((await snap()).round).toBeNull();
    expect(
      (
        await core.db.query<{ status: string }>(
          'select status from lab_raffles',
        )
      )[0]!.status,
    ).toBe('finished');
  });

  it('extension never spoils: « Tirage en cours » until the overlay reveal ends + the stream margin', async () => {
    const { config, act, joinExt, seen, after } = await lab();
    await config({ winners_custom: 3 });
    await act({ action: 'launch' });
    for (const v of ['900231', '900232', '900233', '900234']) await joinExt(v);
    await after(62_000);
    const d = await seen('900231');
    expect(d.phase).toBe('drawing');
    expect(JSON.stringify(d)).not.toMatch(/winners|is_full|my_gain/);
    const reveal = revealMs('normal', false, 3);
    expect(
      Date.parse((d.round as { result_at: string }).result_at) -
        Date.parse(d.server_time),
    ).toBe(3_000 + reveal + 8_000);
    await after(3_000 + reveal + 7_999);
    expect((await seen('900231')).phase).toBe('drawing');
    await after(1);
    const r = await seen('900231');
    expect(r.phase).toBe('result');
    expect((r.round as { winners: unknown[] }).winners).toHaveLength(3);
    await after(12_000); // extension_idle_return_s
    expect((await seen('900231')).phase).toBe('idle');
  });

  it('SUPER: forced by Studio or rolled 1 in N, jackpot and currency of the SUPER settings, announced at the opening', async () => {
    const { config, act, snap, queue } = await lab();
    await config({
      super: {
        enabled: true,
        one_in: 400,
        jackpot: 200_000,
        currency_id: 'tokens',
      },
    });
    queue.push(1 / 400 - 1e-9); // the roll
    await act({ action: 'launch' });
    expect((await snap()).round).toMatchObject({
      kind: 'super',
      amount: 200_000,
    });
    await act({ action: 'cancel' });
    queue.push(1 / 400 + 1e-6);
    await act({ action: 'launch' });
    expect((await snap()).round).toMatchObject({
      kind: 'normal',
      amount: 20_000,
    });
    await act({ action: 'cancel' });
    await act({ action: 'launch', kind: 'super' });
    expect((await snap()).round!.kind).toBe('super');
  });

  it('FULL OSEILLE: decided at the draw only, one winner takes the whole jackpot, never announced before', async () => {
    const { config, act, joinExt, snap, seen, after, wallet, queue, core } =
      await lab();
    await config({ winners_custom: 4, full: { enabled: true, chance_pct: 1 } });
    await act({ action: 'launch' });
    for (const v of ['900241', '900242', '900243', '900244', '900245'])
      await joinExt(v);
    expect(JSON.stringify(await snap())).not.toMatch(/full/i);
    expect(JSON.stringify(await seen('900241'))).not.toMatch(/full/i);
    queue.push(0.005, 0.5); // FULL roll (< 1 %), then the single winner: index 2
    await after(62_000);
    expect((await snap()).round!.reveal).toBeNull();
    await after(3_000);
    expect((await snap()).round!.reveal).toMatchObject({
      is_full: true,
      winners: [{ viewer_id: '900243', amount: 20_000 }],
    });
    expect((await wallet('900243')).tokens).toBe(12_000 + 20_000);
    const r = (
      await core.db.query<{ reveal_end_at: Date; reveal_at: Date }>(
        'select reveal_at, reveal_end_at from lab_raffles',
      )
    )[0]!;
    expect(
      new Date(r.reveal_end_at).getTime() - new Date(r.reveal_at).getTime(),
    ).toBe(revealMs('normal', true, 1));
  });

  it('giveaway: text prize, custom winners, real draw, no wallet movement, history', async () => {
    const { config, act, joinExt, after, wallet, raffle, core } = await lab();
    await config({
      amount_mode: 'giveaway',
      prize: 'Clé Steam — Hades II',
      winners_custom: 2,
    });
    await act({ action: 'launch' });
    for (const v of ['900251', '900252', '900253']) await joinExt(v);
    await after(62_000 + 3_000);
    const s = await raffle.snapshot(CH);
    expect(s.round).toMatchObject({
      kind: 'giveaway',
      prize: 'Clé Steam — Hades II',
      currency: null,
    });
    expect(s.round!.reveal!.winners).toHaveLength(2);
    expect(s.round!.reveal!.winners.every((w) => w.amount === 0)).toBe(true);
    expect(
      (await core.db.query('select 1 from lab_wallet_ledger')).length,
    ).toBe(0);
    for (const v of ['900251', '900252', '900253'])
      expect((await wallet(v)).tokens).toBe(12_000);
    const h = await raffle.history(CH);
    expect(h[0]!.winners.every((w) => w.payout_status === 'none')).toBe(true);
  });

  it('no participant: the round ends without winner nor payment; 1, 2 and 3 participants', async () => {
    for (const n of [0, 1, 2, 3]) {
      const { config, act, joinExt, after, raffle, core } = await lab();
      await config({ winners_mode: 'auto' });
      await act({ action: 'launch' });
      for (let i = 0; i < n; i++) await joinExt(`90026${i}`);
      await after(62_000);
      const h = (await raffle.history(CH))[0]!;
      expect(h.winners).toHaveLength(n === 3 ? 1 : Math.min(n, 1)); // random 0.42: 3 → 1
      expect(
        (await core.db.query('select 1 from lab_wallet_ledger')).length,
      ).toBe(h.winners.length);
    }
  });
});

describe('Tombola V2 zero participants', () => {
  it('no error, no draw, no winner, no payment; « no_participants » distinct from a cancellation; short display; giveaway too', async () => {
    for (const mode of ['fixed', 'giveaway'] as const) {
      const { config, act, after, raffle, core } = await lab();
      await config(
        mode === 'giveaway' ? { amount_mode: 'giveaway', prize: 'Lot' } : {},
      );
      await act({ action: 'launch' });
      await after(62_000);
      // Before the result: nobody knows yet (no spoiler either way).
      expect((await raffle.snapshot(CH)).round!.outcome).toBeNull();
      await after(3_000 + 1_500);
      const s = (await raffle.snapshot(CH)).round!;
      expect(s).toMatchObject({ outcome: 'no_participants', participants: 0 });
      expect(s.reveal?.winners ?? []).toEqual([]);
      const h = (await raffle.history(CH))[0]!;
      expect(h).toMatchObject({
        status: 'revealed',
        outcome: 'no_participants',
        winners: [],
      });
      expect(
        (await core.db.query('select 1 from lab_wallet_ledger')).length,
      ).toBe(0);
      expect(
        await core.db.query(
          "select 1 from lab_moderation_audit where action = 'raffle_no_participants'",
        ),
      ).toHaveLength(1);
      // « Aucun participant cette fois ! » stays `display.empty_s` (5 s), then the round is over.
      await after(5_000);
      expect((await raffle.snapshot(CH)).round).toBeNull();
      expect((await raffle.history(CH))[0]).toMatchObject({
        status: 'finished',
        outcome: 'no_participants',
      });
    }
    // A cancellation keeps its own outcome.
    const { act, raffle } = await lab();
    await act({ action: 'launch' });
    await act({ action: 'cancel' });
    expect((await raffle.history(CH))[0]).toMatchObject({
      status: 'cancelled',
      outcome: 'cancelled',
    });
  });
});

describe('Tombola V2 payouts (registered currencies, exactly once)', () => {
  it('credits the chosen registered currency with the exact amount (Crédits TTS)', async () => {
    const { config, act, joinExt, after, wallet, core, m, code } = await lab();
    await config({ currency_id: 'credits_tts', fixed_amount: 3 });
    await act({ action: 'launch' });
    await joinExt('900271');
    await after(62_000);
    expect(await wallet('900271')).toMatchObject({
      credits_tts: 1 + 3,
      tokens: 12_000,
    });
    const { items } = await m.ledger(CH, { viewer: '900271' });
    expect(items[0]).toMatchObject({
      operation_type: 'raffle_win',
      currency: 'credits_tts',
      amount: 3,
    });
    // A currency registered later (no lab_wallets column) is credited through the generic balances.
    await core.db.query(
      "insert into lab_currencies (currency_id, label, short_label, icon, sort, max_balance) values ('event_coins', 'Pièces d’octobre', 'po', 'star', 9, 1000)",
    );
    await config({ currency_id: 'event_coins', fixed_amount: 7 });
    expect(await code(act({ action: 'launch' }))).toBe('raffle_already_open'); // previous result still shown
    await after(60_000);
    await act({ action: 'launch' });
    await joinExt('900272');
    await after(62_000);
    expect(
      (
        await core.db.query<{ balance: number }>(
          "select balance from lab_wallet_balances where viewer_id = '900272'",
        )
      )[0]!.balance,
    ).toBe(7);
  });

  it('a refused credit is a visible failure, retried once fixed, never paid twice (ticks, restart, retries)', async () => {
    const { config, act, joinExt, after, wallet, raffle, core, code, m } =
      await lab();
    await config({ currency_id: 'credits_soundboard', fixed_amount: 50 });
    await m.editWallet(CH, {
      actor: studio,
      viewer_id: '900281',
      op: 'set',
      credits_soundboard: 99_990,
    });
    await act({ action: 'launch' });
    const { raffle_id } = (await joinExt('900281')) as { raffle_id: string };
    await after(62_000);
    let card = await raffle.round(CH, raffle_id);
    expect(card.winners[0]).toMatchObject({
      payout_status: 'failed',
      expected: 50,
      ledger_id: null,
      credited: 0,
    });
    expect(card.winners[0]!.failure).toMatch(/balance_cap/);
    expect((await wallet('900281')).credits_soundboard).toBe(99_990);
    await m.editWallet(CH, {
      actor: studio,
      viewer_id: '900281',
      op: 'set',
      credits_soundboard: 10,
    });
    expect(
      await code(
        act({ action: 'retry_payout', raffle_id, viewer_id: '900281' }, modA),
      ),
    ).toBe('forbidden');
    await act({ action: 'retry_payout', raffle_id, viewer_id: '900281' }, modG);
    expect(
      await code(
        act({ action: 'retry_payout', raffle_id, viewer_id: '900281' }),
      ),
    ).toBe('already_paid');
    // A restarted Core (new service) and extra ticks never pay again.
    const restarted = new RaffleLabService(core.db, core.clock);
    await restarted.tick();
    await raffle.tick();
    expect((await wallet('900281')).credits_soundboard).toBe(60);
    card = await raffle.round(CH, raffle_id);
    expect(card.winners[0]).toMatchObject({
      payout_status: 'paid',
      credited: 50,
      attempts: 2,
    });
    expect(card.winners[0]!.ledger_id).toBeTypeOf('number');
    expect(card.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'raffle_open',
        'raffle_draw',
        'raffle_retry_payout',
      ]),
    );
    // The ledger itself refuses a second Tombola credit for the same winner and round.
    await expect(
      core.db.query(
        `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, actor, created_at, raffle_id)
         values ($1, '900281', 'raffle_win', 'credits_soundboard', 50, 'raffle', 'test', now(), $2)`,
        [CH, raffle_id],
      ),
    ).rejects.toThrow();
  });
});

describe('Tombola V2 moderation actions and permissions (D7)', () => {
  it('add / remove participants, +time, pause / resume (frozen timer), draw now — audited', async () => {
    const { config, act, joinExt, chat, code, snap, after, raffle } =
      await lab();
    await config();
    await act({ action: 'launch' });
    await after(2_000);
    await joinExt('900291');
    await act(
      {
        action: 'add_participant',
        viewer_id: '900292',
        display_name: 'Ajouté',
      },
      modG,
    );
    expect(
      await code(
        act(
          { action: 'add_participant', viewer_id: '900292', display_name: 'x' },
          modG,
        ),
      ),
    ).toBe('already_joined');
    await act({ action: 'remove_participant', viewer_id: '900291' }, modA);
    expect(await code(joinExt('900291'))).toBe('entry_removed');
    expect((await chat('900291', '!join')).outcome).toBe('entry_removed');
    expect(
      await code(
        act({ action: 'remove_participant', viewer_id: '900299' }, modA),
      ),
    ).toBe('not_a_participant');
    await act(
      {
        action: 'add_participant',
        viewer_id: '900291',
        display_name: 'V900291',
      },
      modG,
    ); // restored
    await act({ action: 'extend', seconds: 30 }, modG);
    expect((await snap()).round!.remaining_ms).toBe(90_000);
    await after(10_000);
    await act({ action: 'pause' }, modG);
    expect((await snap()).round).toMatchObject({
      status: 'paused',
      remaining_ms: 80_000,
    });
    await after(300_000); // frozen: no draw while paused
    expect((await snap()).round).toMatchObject({
      status: 'paused',
      remaining_ms: 80_000,
    });
    await act({ action: 'extend', seconds: 10 }, modG);
    await act({ action: 'resume' }, modG);
    expect((await snap()).round).toMatchObject({
      status: 'open',
      remaining_ms: 90_000,
    });
    await act({ action: 'draw_now' }, modG);
    expect((await snap()).round!.status).toBe('drawing');
    const id = (await snap()).round!.raffle_id;
    const card = await raffle.round(CH, id);
    expect(card.entries.map((e) => [e.viewer_id, e.source])).toEqual([
      ['900291', 'extension'],
      ['900292', 'manual'],
    ]);
    expect(card.audit.map((a) => a.action)).toEqual([
      'raffle_open',
      'raffle_add_participant',
      'raffle_remove_participant',
      'raffle_add_participant',
      'raffle_extend',
      'raffle_pause',
      'raffle_extend',
      'raffle_resume',
      'raffle_draw',
    ]);
  });

  it('manual entry: through a global / module pause, refused over an individual block unless forced (audited)', async () => {
    const { config, act, mod, code, raffle, snap } = await lab();
    await config();
    await act({ action: 'launch' });
    await mod({ action: 'global_pause', paused: true }, superMod);
    await mod(
      { action: 'module_state', module: 'raffle', state: 'paused' },
      modA,
    );
    await act(
      { action: 'add_participant', viewer_id: '900295', display_name: 'Pause' },
      modG,
    );
    await mod(
      {
        action: 'block_viewer',
        viewer_id: '900296',
        module: 'raffle',
        duration_s: 600,
      },
      modA,
    );
    expect(
      await code(
        act(
          {
            action: 'add_participant',
            viewer_id: '900296',
            display_name: 'Bloqué',
          },
          modG,
        ),
      ),
    ).toBe('viewer_blocked');
    await act(
      {
        action: 'add_participant',
        viewer_id: '900296',
        display_name: 'Bloqué',
        force: true,
      },
      modG,
    );
    const card = await raffle.round(CH, (await snap()).round!.raffle_id);
    expect(card.entries.map((e) => e.viewer_id)).toEqual(['900295', '900296']);
    expect(
      card.audit
        .filter((a) => a.action === 'raffle_add_participant')
        .map(
          (a) => (a.after as { forced_over_block: boolean }).forced_over_block,
        ),
    ).toEqual([false, true]);
  });

  it('standard moderator: safe actions only; « Gérer la Tombola » / supermod / broadcaster: the rest; viewer: nothing', async () => {
    const { config, act, code } = await lab();
    await config();
    expect(await code(act({ action: 'launch' }, modA))).toBe('forbidden');
    expect(await code(act({ action: 'launch' }, viewer))).toBe('forbidden');
    await act({ action: 'launch' }, modG);
    for (const c of [
      { action: 'extend', seconds: 30 },
      { action: 'pause' },
      { action: 'draw_now' },
      { action: 'add_participant', viewer_id: '900301', display_name: 'x' },
    ])
      expect(await code(act(c, modA))).toBe('forbidden');
    expect(await code(act({ action: 'cancel' }, viewer))).toBe('forbidden');
    // Configuration: supermods and the broadcaster (« Supermod = accès complet Tombola »).
    expect(
      await code(
        act({ action: 'config', config: { ...DEFAULT_RAFFLE_CONFIG } }, modG),
      ),
    ).toBe('forbidden');
    expect(
      await code(
        act(
          { action: 'config', config: { ...DEFAULT_RAFFLE_CONFIG, ...QUIET } },
          superMod,
        ),
      ),
    ).toBe('ok');
    await act({ action: 'extend', seconds: 30 }, superMod);
    await act({ action: 'cancel' }, modA);
  });

  it('chat cancel (« !annuletombola » + alias): moderator or above only, Core-authorized, no payment', async () => {
    const { config, act, joinExt, chat, snap, seen, core, raffle } =
      await lab();
    await config({ cancel_commands: ['!annuletombola', '!stoptombola'] });
    await act({ action: 'launch' });
    await joinExt('900311');
    expect((await chat('900311', '!annuletombola')).outcome).toBe('forbidden');
    expect(
      (await chat('900312', '!annuletombola', 'broadcaster')).outcome,
    ).toBe('forbidden'); // badge of another account
    expect((await chat(modA.id, '!stoptombola', 'moderator')).outcome).toBe(
      'cancelled',
    );
    expect((await chat(modA.id, '!annuletombola', 'moderator')).outcome).toBe(
      'no_open_raffle',
    );
    const s = (await snap()).round!;
    expect(s.status).toBe('cancelled');
    expect(s.cancel_until).toBe(new Date(T0.getTime() + 4_000).toISOString());
    expect((await seen('900311')).phase).toBe('cancelled');
    expect(
      (await core.db.query('select 1 from lab_wallet_ledger')).length,
    ).toBe(0);
    const card = await raffle.round(CH, s.raffle_id);
    expect(card.audit.at(-1)).toMatchObject({
      action: 'raffle_cancel',
      actor: 'u900102',
      reason: 'commande chat !stoptombola',
    });
  });

  it('cancel before the draw only; invalid transitions are refused', async () => {
    const { config, act, code, after, joinExt } = await lab();
    await config();
    await act({ action: 'launch' });
    expect(await code(act({ action: 'resume' }))).toBe('invalid_phase');
    expect(await code(act({ action: 'launch' }))).toBe('raffle_already_open');
    await joinExt('900321');
    await after(62_000);
    expect(await code(act({ action: 'cancel' }))).toBe('invalid_phase'); // drawing: not cancellable
    expect(await code(act({ action: 'draw_now' }))).toBe('invalid_phase');
  });
});

describe('Tombola V2 read models', () => {
  it('overlay snapshot is reload-safe: same state at any time, the opening is not replayed', async () => {
    const { config, act, joinExt, after, raffle, core } = await lab();
    await config({
      overlay_hint: { mode: 'custom', text: 'Tape !octobre pour participer' },
    });
    await act({ action: 'launch' });
    await after(2_000 + 37_000);
    for (const v of [
      '900331',
      '900332',
      '900333',
      '900334',
      '900335',
      '900336',
    ])
      await joinExt(v);
    // A brand new reader (OBS source reloaded, Core restarted) gets the very same state.
    const reloaded = await new RaffleLabService(core.db, core.clock).snapshot(
      CH,
    );
    expect(reloaded).toEqual(await raffle.snapshot(CH));
    expect(reloaded.overlay_hint).toEqual({
      mode: 'custom',
      text: 'Tape !octobre pour participer',
    });
    expect(reloaded.round).toMatchObject({
      status: 'open',
      remaining_ms: 23_000,
      participants: 6,
    });
    expect(reloaded.round!.recent.map((r) => r.viewer_id)).toEqual([
      '900336',
      '900335',
      '900334',
      '900333',
      '900332',
    ]);
    expect(reloaded.round!.entries_tail.map((e) => e.seq)).toEqual(
      [...reloaded.round!.entries_tail.map((e) => e.seq)].sort((a, b) => a - b),
    );
  });

  it('viewer history = the current stream session only (cancelled marked); a new session starts empty', async () => {
    const { config, act, joinExt, after, seen, code } = await lab();
    await config();
    await act({ action: 'stream_start' });
    await act({ action: 'launch' });
    await joinExt('900341');
    await after(62_000 + 3_000 + 14_000);
    await act({ action: 'launch' });
    await act({ action: 'cancel' });
    const h = (await seen('900341')).history;
    expect(h.map((x) => x.status)).toEqual(['cancelled', 'done']);
    expect(h[1]).toMatchObject({
      me: true,
      participants: 1,
      winners: [{ amount: 20_000 }],
    });
    expect(await code(act({ action: 'stream_start' }))).toBe(
      'stream_already_live',
    );
    await act({ action: 'stream_end' });
    await act({ action: 'stream_start' });
    expect((await seen('900341')).history).toEqual([]);
  });

  it('Twitch pictures: batched cache, initials fallback when absent or failing, retried later, never another host', async () => {
    const { config, act, joinExt, after, snap, core } = await lab();
    await config();
    await act({ action: 'launch' });
    for (const v of ['900351', '900352', '900353']) await joinExt(v);
    const calls: string[][] = [];
    let fail = true;
    const cache = new AvatarCache(core.db, core.clock, async (ids) => {
      calls.push(ids);
      if (fail) throw new Error('twitch down');
      return [
        {
          id: '900351',
          profile_image_url:
            'https://static-cdn.jtvnw.net/user-default-pictures/a.png',
        },
        { id: '900352', profile_image_url: 'https://evil.example/x.png' },
      ];
    });
    expect(await cache.refresh()).toBe(3);
    expect(
      (await snap()).round!.recent.every((r) => r.avatar_url === null),
    ).toBe(true);
    expect(await cache.refresh()).toBe(0); // failure: not retried before 1 h
    fail = false;
    await after(3_601_000);
    expect(await cache.refresh()).toBe(3);
    expect(calls).toHaveLength(2);
    const urls = Object.fromEntries(
      (
        await core.db.query<{ viewer_id: string; url: string | null }>(
          'select viewer_id, url from lab_viewer_avatars',
        )
      ).map((r) => [r.viewer_id, r.url]),
    );
    expect(urls).toEqual({
      '900351': 'https://static-cdn.jtvnw.net/user-default-pictures/a.png',
      '900352': null,
      '900353': null,
    });
  });

  it('configuration is validated by Core (bands, commands, currency)', async () => {
    const { config, code } = await lab();
    // Core's coherence checks answer `invalid_config`; malformed commands never pass the schema.
    const bad = (patch: Partial<RaffleConfig>) =>
      code((async () => config(patch))()).catch((e: Error) =>
        e.name === 'ZodError' ? 'zod' : Promise.reject(e),
      );
    expect(
      await bad({
        random: { step: 500, bands: [{ from: 5000, to: 20000, pct: 70 }] },
      }),
    ).toBe('invalid_config');
    expect(
      await bad({
        random: {
          step: 500,
          bands: [
            { from: 5000, to: 20000, pct: 50 },
            { from: 25000, to: 40000, pct: 50 },
          ],
        },
      }),
    ).toBe('invalid_config');
    expect(await bad({ join_commands: ['!join', '!join'] })).toBe(
      'invalid_config',
    );
    expect(await bad({ cancel_commands: ['!stop', '!stop'] })).toBe(
      'invalid_config',
    );
    expect(
      await bad({
        cancel_commands: ['!octobre'],
        join_commands: ['!join', '!octobre'],
      }),
    ).toBe('invalid_config');
    expect(await bad({ join_commands: [] })).toBe('zod');
    expect(await bad({ join_commands: ['join sans point'] })).toBe('zod');
    expect(await bad({ currency_id: 'nope' })).toBe('invalid_config');
    // A custom overlay text may be empty while it is typed (the overlay then shows nothing).
    expect(await bad({ overlay_hint: { mode: 'custom', text: '' } })).toBe(
      'ok',
    );
    // Every command is editable: the main one replaced, aliases added / removed.
    expect(
      await code(
        config({
          join_commands: ['!participer', '!octobre', '!cadeau'],
          cancel_commands: ['!stoptombola', '!annuletombola'],
        }),
      ),
    ).toBe('ok');
  });
});

describe('Tombola V2 migration (forward-only, on top of the minimal Tombola)', () => {
  it('converts the minimal rounds: never drawn → cancelled, drawn → finished with its paid winner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'raffle-v2-mig-'));
    try {
      for (const f of await readdir(DEFAULT_MIGRATIONS_DIR))
        if (f.endsWith('.sql') && f < '20261008120000')
          await cp(join(DEFAULT_MIGRATIONS_DIR, f), join(dir, f));
      const db = createPgliteDb(new PGlite());
      await migrate(db, dir);
      await db.query(
        `insert into lab_raffles (raffle_id, channel_id, status, jackpot, winners_count, opened_at, ends_at, closed_at, drawn_at, opened_by) values
         ('00000000-0000-4000-8000-000000000001', '1', 'drawn', 8000, 1, '2026-09-30T20:00:00Z', '2026-09-30T20:01:00Z', '2026-09-30T20:01:00Z', '2026-09-30T20:02:00Z', 'studio:a'),
         ('00000000-0000-4000-8000-000000000002', '1', 'closed', 5000, 1, '2026-09-30T21:00:00Z', '2026-09-30T21:01:00Z', '2026-09-30T21:01:00Z', null, 'studio:a')`,
      );
      await db.query(
        `insert into lab_raffle_entries (entry_id, raffle_id, channel_id, viewer_id, viewer_display_name, idempotency_key, created_at)
         values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000001', '1', '42', 'V42', 'k-legacy-1', '2026-09-30T20:00:10Z')`,
      );
      await db.query(
        `insert into lab_raffle_winners (raffle_id, viewer_id, viewer_display_name, amount, ledger_id) values ('00000000-0000-4000-8000-000000000001', '42', 'V42', 8000, 7)`,
      );
      await cp(
        join(DEFAULT_MIGRATIONS_DIR, '20261008120000_raffle_v2.sql'),
        join(dir, '20261008120000_raffle_v2.sql'),
      );
      expect(await migrate(db, dir)).toEqual(['20261008120000_raffle_v2.sql']);
      const rows = await db.query<{
        status: string;
        currency_id: string;
        duration_s: number;
      }>(
        'select status, currency_id, duration_s from lab_raffles order by opened_at',
      );
      expect(rows).toEqual([
        { status: 'finished', currency_id: 'tokens', duration_s: 60 },
        { status: 'cancelled', currency_id: 'tokens', duration_s: 60 },
      ]);
      expect(
        (
          await db.query(
            'select payout_status, position, source from lab_raffle_winners w join lab_raffle_entries e using (raffle_id, viewer_id)',
          )
        )[0],
      ).toEqual({
        payout_status: 'paid',
        position: 1,
        source: 'extension',
      });
      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Tombola V2 automatic scheduler', () => {
  const SCHED = (
    patch: Partial<RaffleConfig['scheduler']> = {},
  ): Partial<RaffleConfig> => ({
    scheduler: {
      ...DEFAULT_RAFFLE_CONFIG.scheduler,
      enabled: true,
      preset: 'custom',
      first_delay_s: 600,
      mode: 'fixed',
      interval_s: 1200,
      ...patch,
    },
  });
  const settings = (raffle: RaffleLabService) => raffle.settings(CH);

  it('starts with the stream, launches automatic rounds, plans the next one from the end of the display, stops with the stream', async () => {
    const { config, act, raffle, after, core } = await lab();
    await config(SCHED());
    expect((await settings(raffle)).scheduler.state).toBe('stopped');
    await act({ action: 'stream_start' });
    let s = (await settings(raffle)).scheduler;
    expect(s).toMatchObject({
      state: 'running',
      remaining_ms: 600_000,
      timing: { first_delay_s: 600, min_s: 1200, max_s: 1200 },
    });
    await after(599_000);
    expect((await raffle.snapshot(CH)).round).toBeNull();
    await after(1_000);
    const r1 = (await raffle.snapshot(CH)).round!;
    expect(r1).toMatchObject({ status: 'opening', origin: 'automatic' });
    s = (await settings(raffle)).scheduler;
    expect(s).toMatchObject({
      waiting_for_round: true,
      last_auto_raffle_id: r1.raffle_id,
    });
    // No participant: the round ends (draw + display), then the next launch is 20 min after it.
    await after(2_000 + 60_000 + 3_000 + 14_000);
    expect((await raffle.snapshot(CH)).round).toBeNull();
    const finished = (
      await core.db.query<{ finished_at: Date }>(
        'select finished_at from lab_raffles',
      )
    )[0]!.finished_at;
    s = (await settings(raffle)).scheduler;
    expect(s.next_at).toBe(
      new Date(new Date(finished).getTime() + 1_200_000).toISOString(),
    );
    expect((await raffle.history(CH))[0]).toMatchObject({
      origin: 'automatic',
    });
    await act({ action: 'stream_end' });
    expect((await settings(raffle)).scheduler).toMatchObject({
      state: 'stopped',
      next_at: null,
    });
    await after(3_600_000);
    expect(await raffle.history(CH)).toHaveLength(1);
  });

  it('a manual round re-plans the next automatic one; never two rounds at once; restart-safe', async () => {
    const { config, act, raffle, after, core } = await lab();
    await config(
      SCHED({ mode: 'random', interval_min_s: 600, interval_max_s: 1800 }),
    );
    await act({ action: 'stream_start' });
    await after(300_000);
    await act({ action: 'launch' }); // manual, before the automatic one is due
    expect((await settings(raffle)).scheduler.waiting_for_round).toBe(true);
    await after(400_000); // the first automatic time passes while the manual round is shown
    const rounds = await core.db.query<{ origin: string }>(
      'select origin from lab_raffles order by opened_at',
    );
    expect(rounds.map((r) => r.origin)).toEqual(['manual']);
    const s = (await settings(raffle)).scheduler;
    const finished = new Date(
      (
        await core.db.query<{ finished_at: Date }>(
          'select finished_at from lab_raffles',
        )
      )[0]!.finished_at,
    ).getTime();
    // random 0.42 between 10 and 30 min, counted from the end of the manual round's display
    expect(Date.parse(s.next_at!)).toBe(
      finished + Math.round((600 + 1200 * 0.42) * 1000),
    );
    // Due time: concurrent ticks and a restarted Core launch one round only.
    core.clock.set(new Date(Date.parse(s.next_at!)));
    const restarted = new RaffleLabService(core.db, core.clock);
    await Promise.all([raffle.tick(), restarted.tick(), raffle.tick()]);
    const auto = await core.db.query(
      "select 1 from lab_raffles where origin = 'automatic'",
    );
    expect(auto).toHaveLength(1);
  });

  it('pause keeps the remaining time; a refused automatic launch is skipped, audited, re-planned; disabling stops it', async () => {
    const { config, act, mod, raffle, after, core, code } = await lab();
    await config(SCHED());
    await act({ action: 'stream_start' });
    await after(100_000);
    expect(await code(act({ action: 'scheduler_pause' }, modA))).toBe(
      'forbidden',
    );
    await act({ action: 'scheduler_pause' }, modG);
    expect((await settings(raffle)).scheduler).toMatchObject({
      state: 'paused',
      remaining_ms: 500_000,
    });
    await after(3_600_000);
    expect(await raffle.history(CH)).toHaveLength(0);
    await act({ action: 'scheduler_resume' }, modG);
    expect((await settings(raffle)).scheduler).toMatchObject({
      state: 'running',
      remaining_ms: 500_000,
    });
    await mod({ action: 'global_pause', paused: true }, superMod);
    await after(500_000);
    expect(await raffle.history(CH)).toHaveLength(0);
    expect((await settings(raffle)).scheduler).toMatchObject({
      last_skip_reason: 'global_pause',
      remaining_ms: 1_200_000,
    });
    const trail = await core.db.query<{ action: string }>(
      "select action from lab_moderation_audit where module_id = 'raffle' order by id",
    );
    expect(trail.map((t) => t.action)).toEqual(
      expect.arrayContaining([
        'stream_start',
        'scheduler_start',
        'scheduler_pause',
        'scheduler_resume',
        'scheduler_skip',
      ]),
    );
    await config(SCHED({ enabled: false }));
    expect((await settings(raffle)).scheduler.state).toBe('stopped');
    await config(SCHED()); // enabled again during the live stream: starts with its first delay
    expect((await settings(raffle)).scheduler).toMatchObject({
      state: 'running',
      remaining_ms: 600_000,
    });
  });

  it('presets bring their own timing', async () => {
    const { config, act, raffle } = await lab();
    await config(SCHED({ preset: 'rare' }));
    await act({ action: 'stream_start' });
    expect((await settings(raffle)).scheduler).toMatchObject({
      timing: { first_delay_s: 1800, min_s: 2700, max_s: 4500 },
      remaining_ms: 1_800_000,
    });
  });
});

describe('Tombola V2 launch sound', () => {
  const sound = (c: string, volume = 80) => ({
    asset_id: c.repeat(64),
    format: 'mp3' as const,
    name: `son ${c}`,
    size_bytes: 12_345,
    volume,
  });

  it('normal / SUPER / giveaway sounds (fallback to the normal one), copied at the opening, played once right after it, never a FULL sound', async () => {
    const { config, act, snap, after, joinExt, queue } = await lab();
    await config({
      launch_sounds: {
        normal: sound('a'),
        super: sound('b', 60),
        giveaway: null,
      },
      full: { enabled: true, chance_pct: 100 },
    });
    await act({ action: 'launch' });
    expect((await snap()).round!.launch_sound).toEqual({
      asset_id: 'a'.repeat(64),
      format: 'mp3',
      volume: 80,
      play_until: new Date(T0.getTime() + 4000).toISOString(),
    });
    // A later change of the configuration never alters the running round.
    await config({
      launch_sounds: { normal: sound('c'), super: null, giveaway: null },
      full: { enabled: true, chance_pct: 100 },
    });
    expect((await snap()).round!.launch_sound!.asset_id).toBe('a'.repeat(64));
    await joinExt('900401');
    queue.push(0); // FULL roll
    await after(62_000 + 3_000);
    expect((await snap()).round).toMatchObject({
      reveal: { is_full: true },
      launch_sound: { asset_id: 'a'.repeat(64) },
    }); // FULL keeps the normal opening sound: nothing announced it
    await after(30_000);
    await config({
      launch_sounds: {
        normal: sound('a'),
        super: sound('b', 60),
        giveaway: null,
      },
    });
    await act({ action: 'launch', kind: 'super' });
    expect((await snap()).round!.launch_sound).toMatchObject({
      asset_id: 'b'.repeat(64),
      volume: 60,
    });
    await act({ action: 'cancel' });
    await after(5_000);
    await config({
      amount_mode: 'giveaway',
      prize: 'Lot',
      launch_sounds: { normal: sound('a'), super: null, giveaway: null },
    });
    await act({ action: 'launch' });
    expect((await snap()).round!.launch_sound!.asset_id).toBe('a'.repeat(64));
    await act({ action: 'cancel' });
    await after(5_000);
    await config({
      launch_sounds: { normal: null, super: null, giveaway: null },
    });
    await act({ action: 'launch' });
    expect((await snap()).round!.launch_sound).toBeNull();
  });

  it('only a managed Studio asset can be configured (content id, format, size, volume)', async () => {
    const { config } = await lab();
    const bad = async (s: Record<string, unknown>) => {
      try {
        await config({
          launch_sounds: { normal: s as never, super: null, giveaway: null },
        });
        return 'ok';
      } catch (e) {
        return (e as Error).name === 'ZodError' ? 'invalid' : String(e);
      }
    };
    expect(
      await bad({ ...sound('a'), asset_id: 'C:/Users/Antoni/son.mp3' }),
    ).toBe('invalid');
    expect(await bad({ ...sound('a'), format: 'flac' })).toBe('invalid');
    expect(await bad({ ...sound('a'), size_bytes: 6 * 1024 * 1024 })).toBe(
      'invalid',
    );
    expect(await bad({ ...sound('a'), volume: 150 })).toBe('invalid');
    expect(await bad(sound('a'))).toBe('ok');
  });
});

describe('Tombola V2 Twitch stream state (chat adapter)', () => {
  it('offline → live opens a Twitch session and starts the scheduler; repeated events change nothing; live → offline ends both', async () => {
    const { config, raffle, core } = await lab();
    await config({
      scheduler: { ...DEFAULT_RAFFLE_CONFIG.scheduler, enabled: true },
    });
    const on = await raffle.streamEvent({
      channel_id: CH,
      event: 'online',
      twitch_stream_id: '317823244002',
    });
    expect(on.changed).toBe(true);
    expect(
      await raffle.streamEvent({ channel_id: CH, event: 'online' }),
    ).toMatchObject({ changed: false, session_id: on.session_id });
    const sessions = await core.db.query<{ source: string }>(
      'select source from lab_stream_sessions',
    );
    expect(sessions).toEqual([{ source: 'twitch' }]);
    expect((await raffle.settings(CH)).scheduler).toMatchObject({
      state: 'running',
      session_id: on.session_id,
      remaining_ms: 15 * 60_000, // preset « Normal »
    });
    expect(
      await raffle.streamEvent({ channel_id: CH, event: 'offline' }),
    ).toMatchObject({ changed: true });
    expect(
      await raffle.streamEvent({ channel_id: CH, event: 'offline' }),
    ).toMatchObject({ changed: false });
    expect((await raffle.settings(CH)).scheduler.state).toBe('stopped');
    expect((await raffle.settings(CH)).stream).toBeNull();
  });
});

describe('Tombola V2 scheduler re-planning', () => {
  it('a new frequency while it runs re-plans the next launch (first delay, then interval), audited', async () => {
    const { config, act, raffle, core } = await lab();
    const sched = (preset: RaffleConfig['scheduler']['preset']) => ({
      scheduler: { ...DEFAULT_RAFFLE_CONFIG.scheduler, enabled: true, preset },
    });
    await config(sched('normal'));
    await act({ action: 'stream_start' });
    expect((await raffle.settings(CH)).scheduler.remaining_ms).toBe(
      15 * 60_000,
    );
    await config(sched('frequent'));
    expect((await raffle.settings(CH)).scheduler.remaining_ms).toBe(
      10 * 60_000,
    );
    await config({ ...sched('frequent'), extension_button: false }); // unrelated change: no re-plan
    expect((await raffle.settings(CH)).scheduler.remaining_ms).toBe(
      10 * 60_000,
    );
    const trail = await core.db.query<{ action: string }>(
      "select action from lab_moderation_audit where action = 'scheduler_replan'",
    );
    expect(trail).toHaveLength(1);
  });
});

describe('Tombola V2 scheduler state for Studio', () => {
  it('disabled · waiting for a stream (no pause offered) · running · paused (resume offered) · waiting for the round', async () => {
    const { config, act, raffle, after, code } = await lab();
    const sched = async () => (await raffle.settings(CH)).scheduler;
    expect(await sched()).toMatchObject({
      phase: 'disabled',
      can_pause: false,
      can_resume: false,
    });
    await config({
      scheduler: {
        ...DEFAULT_RAFFLE_CONFIG.scheduler,
        enabled: true,
        preset: 'very_frequent',
      },
    });
    expect(await sched()).toMatchObject({
      phase: 'waiting_stream',
      can_pause: false,
      can_resume: false,
    });
    expect(await code(act({ action: 'scheduler_pause' }))).not.toBe('ok');
    await act({ action: 'stream_start' });
    expect(await sched()).toMatchObject({
      phase: 'running',
      can_pause: true,
      can_resume: false,
    });
    await act({ action: 'scheduler_pause' });
    expect(await sched()).toMatchObject({
      phase: 'paused',
      can_pause: false,
      can_resume: true,
    });
    await act({ action: 'scheduler_resume' });
    expect((await sched()).phase).toBe('running');
    await after(5 * 60_000);
    expect(await sched()).toMatchObject({
      phase: 'waiting_round',
      can_pause: true,
    });
    await act({ action: 'stream_end' });
    expect((await sched()).phase).toBe('waiting_stream');
  });
});

describe('Tombola V2 editable commands', () => {
  it('a configuration saved before the editable commands keeps working (« !join / !enter + aliases »), new keys take their default', async () => {
    const { raffle, core } = await lab();
    const legacy: Record<string, unknown> = {
      ...DEFAULT_RAFFLE_CONFIG,
      join_aliases: ['!ticket'],
      display: { ...DEFAULT_RAFFLE_CONFIG.display },
    };
    delete legacy.join_commands;
    delete (legacy.display as Record<string, unknown>).empty_s;
    await core.db.query(
      'insert into lab_raffle_settings (channel_id, config, updated_at, updated_by) values ($1, $2, $3, $4)',
      [CH, JSON.stringify(legacy), T0, 'antoni'],
    );
    const c = (await raffle.settings(CH)).config;
    expect(c.join_commands).toEqual(['!join', '!enter', '!ticket']);
    expect(c.display.empty_s).toBe(5);
    expect('join_aliases' in c).toBe(false);
  });

  it('the main command is the first one; any alias joins; a removed command no longer does', async () => {
    const { config, act, chat, raffle } = await lab();
    await config({ join_commands: ['!ticket', '!join'] });
    await act({ action: 'launch' });
    expect((await raffle.snapshot(CH)).join_command).toBe('!ticket');
    expect((await raffle.viewerState(CH, null)).join_command).toBe('!ticket');
    expect(await chat('900271', '!ticket')).toMatchObject({
      outcome: 'joined',
    });
    expect(await chat('900272', '!join')).toMatchObject({ outcome: 'joined' });
    expect(await chat('900273', '!enter')).toMatchObject({
      outcome: 'ignored',
    });
  });
});

describe('Lab chat ingress (Core router, every module)', () => {
  it('routes each chat message to every Lab module; reports only the ones that handled it; stream state too', async () => {
    const { config, act, raffle } = await lab();
    await config();
    const other: string[] = [];
    const router = new LabChatRouter([
      {
        name: 'raffle',
        chat: (m) => raffle.chat(m),
        stream: (e) => raffle.streamEvent(e),
      },
      {
        name: 'tts',
        chat: async (m) => {
          other.push(m.text);
          return {
            outcome: m.text === '!canceltts' ? 'cancelled' : 'ignored',
          };
        },
      },
    ]);
    const msg = (text: string, id: string) => ({
      channel_id: CH,
      message_id: id,
      text,
      chatter: {
        id: '900281',
        login: 'v',
        display_name: 'V',
        role: 'viewer' as const,
      },
      source: 'simulator' as const,
    });
    const live = await router.stream({ channel_id: CH, event: 'online' });
    expect(live.modules.raffle).toMatchObject({ changed: true });
    await act({ action: 'launch' });
    expect(await router.message(msg('!join', 'r-1'))).toEqual({
      handled: [{ module: 'raffle', outcome: 'joined' }],
    });
    expect(await router.message(msg('!canceltts', 'r-2'))).toEqual({
      handled: [{ module: 'tts', outcome: 'cancelled' }],
    });
    expect(await router.message(msg('bonjour', 'r-3'))).toEqual({
      handled: [],
    });
    expect(other).toEqual(['!join', '!canceltts', 'bonjour']);
  });
});

describe('Tombola V2 manual round outside a stream', () => {
  it('allowed for tests, but opens no stream session, never starts the scheduler, leaves the stream state untouched', async () => {
    const { config, act, raffle, after, core, joinExt, seen } = await lab();
    await config({
      scheduler: { ...DEFAULT_RAFFLE_CONFIG.scheduler, enabled: true },
    });
    await act({ action: 'launch' });
    const s = await raffle.settings(CH);
    expect(s.stream).toBeNull();
    expect(s.scheduler).toMatchObject({
      phase: 'waiting_stream',
      state: 'stopped',
      next_at: null,
    });
    expect(
      await core.db.query('select 1 from lab_stream_sessions'),
    ).toHaveLength(0);
    expect(
      await core.db.query(
        "select 1 from lab_moderation_audit where action = 'stream_start'",
      ),
    ).toHaveLength(0);
    // The round itself runs normally (entries, draw, payment) and is shown to viewers off-stream.
    await joinExt('900291');
    await after(62_000 + 3_000 + 14_000);
    const h = (await raffle.history(CH))[0]!;
    expect(h).toMatchObject({ status: 'finished', session_id: null });
    expect(h.winners).toHaveLength(1);
    expect((await seen('900291')).history).toHaveLength(1);
    // Ending the round does not plan an automatic one either.
    expect((await raffle.settings(CH)).scheduler).toMatchObject({
      phase: 'waiting_stream',
      next_at: null,
    });
    // Only the explicit action opens a (simulated) session; its history starts empty.
    await act({ action: 'stream_start' });
    expect((await raffle.settings(CH)).stream).toMatchObject({
      source: 'simulated',
    });
    expect((await raffle.settings(CH)).scheduler.phase).toBe('running');
    expect((await seen('900291')).history).toEqual([]);
  });
});
