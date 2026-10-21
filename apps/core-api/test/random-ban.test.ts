import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { RANDOM_BAN, RANDOM_BAN_DRAW } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { ChannelPointsService } from '../src/channel-points/service.js';
import { migrate } from '../src/db/migrate.js';
import { RandomBanService } from '../src/random-ban/service.js';
import { createPgliteDb, setup } from './helpers.js';

// Random Ban V2 (docs/RANDOM_BAN_V2.md) — Core: one request per trigger, one Random Ban at a time, the target told
// before any timeout, the sanction (sub 3 min / 5 min), never replayed after a timeout request, refunds owed recorded
// (never claimed done), the animation only for a confirmed result / flop / test, the channel points rule.

const CH = '83603689';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

const EXEC = {
  executor_id: 'lab-chat-1239040922',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const BUYER = { id: '9001', login: 'buyer', name: 'Buyer' };
const TARGET = { id: '9002', login: 'target', name: 'Target' };
const STATS = { chatters: 12, candidates: 7, follow_checks: 2 };

async function fixture(draw = (n: number) => n - 1) {
  const core = await setup();
  core.clock.set(new Date('2026-10-18T20:00:00Z'));
  const rb = new RandomBanService(core.db, core.clock, draw);
  const ask = (ref = randomUUID(), mode: 'real' | 'dry_run' = 'real') =>
    rb.request({
      channel_id: CH,
      source: 'channel_points',
      source_ref: ref,
      mode,
      buyer: BUYER,
    });
  const claim = async () => {
    const c = await rb.claim(CH, EXEC);
    return c.request!;
  };
  const target = (id: string, attempt: string, is_sub = false, t = TARGET) =>
    rb.target(id, {
      executor_id: EXEC.executor_id,
      attempt_id: attempt,
      target: t,
      is_sub,
      stats: STATS,
    });
  const result = (id: string, attempt: string, o: object) =>
    rb.result(id, {
      executor_id: EXEC.executor_id,
      attempt_id: attempt,
      ...(o as { event: 'flop' }),
    });
  return { core, rb, ask, claim, target, result };
}

describe('Random Ban — requests, serialization, sanction', () => {
  it('one request per trigger; one Random Ban at a time; the target is recorded before the timeout with its sanction', async () => {
    const { rb, ask, claim, target, result } = await fixture();
    const ref = randomUUID();
    const a = await ask(ref);
    expect((await ask(ref)).request_id).toBe(a.request_id);
    const b = await ask();
    const c1 = await claim();
    expect(c1.request_id).toBe(a.request_id);
    expect(await rb.claim(CH, EXEC)).toEqual({ request: null, reason: 'busy' });
    // Non-subscriber: 5 min, the legacy reason.
    expect(await target(c1.request_id, c1.attempt_id, false)).toEqual({
      proceed: true,
      duration_s: 300,
      reason: 'Pas de chance gros fdp',
    });
    // Same report again (answer lost): same answer, never a second target.
    expect(await target(c1.request_id, c1.attempt_id, false)).toMatchObject({
      proceed: true,
      duration_s: 300,
    });
    expect(await rb.claim(CH, EXEC)).toEqual({ request: null, reason: 'busy' });
    const done = await result(c1.request_id, c1.attempt_id, {
      event: 'confirmed',
    });
    expect(done).toMatchObject({
      status: 'confirmed',
      target: { name: 'Target', is_sub: false },
      duration_s: 300,
      refund: 'none',
      animation_status: 'pending',
    });
    expect(RANDOM_BAN_DRAW).toContain(done.animation);
    // The next one, now; a subscriber gets 3 min.
    const c2 = await claim();
    expect(c2.request_id).toBe(b.request_id);
    expect(await target(c2.request_id, c2.attempt_id, true)).toEqual({
      proceed: true,
      duration_s: 180,
      reason: 'Pas de chance fdp',
    });
  });

  it('CSC: the buyer drawn himself gets the CSC animation; the nine others are drawn uniformly', async () => {
    const { ask, claim, target, result } = await fixture();
    await ask();
    const c = await claim();
    await target(c.request_id, c.attempt_id, false, BUYER);
    expect(
      await result(c.request_id, c.attempt_id, { event: 'confirmed' }),
    ).toMatchObject({ animation: 'ban_csc', target: { id: BUYER.id } });
    expect(RANDOM_BAN_DRAW).toHaveLength(9);
    expect(RANDOM_BAN_DRAW).not.toContain('ban_csc');
  });

  it('refused by Twitch: failed, refund needed (never claimed done); uncertain: refund to verify, settled later by the executor', async () => {
    const { rb, ask, claim, target, result } = await fixture();
    await ask();
    const c = await claim();
    await target(c.request_id, c.attempt_id);
    expect(
      await result(c.request_id, c.attempt_id, {
        event: 'refused',
        error: 'Twitch 400 : user may not be put in a timeout',
      }),
    ).toMatchObject({
      status: 'failed',
      refund: 'needed',
      animation_status: 'none',
    });
    await ask();
    const d = await claim();
    await target(d.request_id, d.attempt_id);
    expect(
      await result(d.request_id, d.attempt_id, {
        event: 'uncertain',
        error: 'Twitch ne répond pas ; liste des bannis illisible',
      }),
    ).toMatchObject({ status: 'uncertain', refund: 'to_verify' });
    // The executor's journal settles it later (Twitch read again): confirmed, nothing owed.
    expect(
      await result(d.request_id, d.attempt_id, {
        event: 'confirmed',
        verified: true,
      }),
    ).toMatchObject({
      status: 'confirmed',
      refund: 'none',
      error: 'verified_after_ambiguous_answer',
    });
    // Another executor / attempt cannot report.
    await expect(
      rb.result(d.request_id, {
        executor_id: 'someone',
        attempt_id: d.attempt_id,
        event: 'refused',
      }),
    ).rejects.toMatchObject({ code: 'not_current_attempt' });
  });

  it('flop: nobody eligible — flop animation, nothing refunded; a failed search (Twitch unreadable) is not a flop', async () => {
    const { ask, claim, result } = await fixture();
    await ask();
    const c = await claim();
    expect(
      await result(c.request_id, c.attempt_id, {
        event: 'flop',
        stats: { chatters: 3, candidates: 0, follow_checks: 0 },
      }),
    ).toMatchObject({
      status: 'flop',
      refund: 'none',
      animation: 'flop',
      animation_status: 'pending',
    });
    await ask();
    const d = await claim();
    expect(
      await result(d.request_id, d.attempt_id, {
        event: 'failed',
        error: 'recherche impossible : bannis: Twitch 401',
      }),
    ).toMatchObject({ status: 'failed', refund: 'needed', animation: null });
  });

  it('executor without the timeout right: a real request fails at once (refund needed); a dry run still searches', async () => {
    const { rb, ask } = await fixture();
    const real = await ask();
    const dry = await ask(randomUUID(), 'dry_run');
    const exec = {
      ...EXEC,
      can_timeout: false,
      missing: ['lecroupier_: moderator:manage:banned_users'],
    };
    expect(await rb.claim(CH, exec)).toEqual({
      request: null,
      reason: 'refused',
    });
    expect(await rb.outcome(real.request_id)).toMatchObject({
      status: 'failed',
      refund: 'needed',
      error:
        'missing_scope_timeout: lecroupier_: moderator:manage:banned_users',
    });
    const c = await rb.claim(CH, exec);
    expect(c.request).toMatchObject({
      request_id: dry.request_id,
      mode: 'dry_run',
    });
    // Dry run: Core never asks for a timeout; simulated, animated.
    expect(
      await rb.target(c.request!.request_id, {
        executor_id: exec.executor_id,
        attempt_id: c.request!.attempt_id,
        target: TARGET,
        is_sub: true,
        stats: STATS,
      }),
    ).toEqual({ proceed: false });
    expect(await rb.outcome(dry.request_id)).toMatchObject({
      status: 'simulated',
      duration_s: 180,
      refund: 'none',
      animation_status: 'pending',
    });
  });
});

describe('Random Ban — lost executor, restarts, late results (never a doubled timeout)', () => {
  it('search lost (no target told): offered again, at most 3 times; timeout requested and lost: uncertain, never offered again', async () => {
    const { core, rb, ask, claim, target } = await fixture();
    const a = await ask();
    for (let n = 1; n <= RANDOM_BAN.maxAttempts; n++) {
      const c = await claim();
      expect(c.request_id).toBe(a.request_id);
      core.clock.advance(RANDOM_BAN.searchLeaseMs + 1);
    }
    expect(await rb.claim(CH, EXEC)).toEqual({ request: null, reason: 'idle' });
    expect(await rb.outcome(a.request_id)).toMatchObject({
      status: 'failed',
      error: 'executor_lost',
      refund: 'needed',
      attempts: 3,
    });
    const b = await ask();
    const c = await claim();
    await target(c.request_id, c.attempt_id);
    core.clock.advance(RANDOM_BAN.timeoutLeaseMs + 1);
    expect(await rb.claim(CH, EXEC)).toEqual({ request: null, reason: 'idle' });
    expect(await rb.outcome(b.request_id)).toMatchObject({
      status: 'uncertain',
      refund: 'to_verify',
      error: 'no_answer_after_timeout_request',
    });
  });

  it('bot absent: a request not picked up within 2 min fails (never a ban minutes later)', async () => {
    const { core, rb, ask } = await fixture();
    const a = await ask();
    core.clock.advance(RANDOM_BAN.pickupMs + 1);
    expect(await rb.claim(CH, EXEC)).toEqual({ request: null, reason: 'idle' });
    expect(await rb.outcome(a.request_id)).toMatchObject({
      status: 'failed',
      error: 'executor_absent',
      refund: 'needed',
    });
  });

  it('animations: one at a time, in order, never handed twice; a late one is dropped; tests never call Twitch', async () => {
    const { core, rb, ask, claim, target, result } = await fixture();
    await ask();
    const c = await claim();
    await target(c.request_id, c.attempt_id);
    await result(c.request_id, c.attempt_id, { event: 'confirmed' });
    const t = await rb.test(CH, { mode: 'animation', outcome: 'flop' });
    expect(t).toMatchObject({
      mode: 'animation',
      status: 'simulated',
      animation: 'flop',
    });
    const first = await rb.claimAnimation(CH, 'studio-a');
    expect(first.animation).toMatchObject({
      request_id: c.request_id,
      trigger: 'Buyer',
      banned: 'Target',
    });
    expect(await rb.claimAnimation(CH, 'studio-a')).toEqual({
      animation: null,
    });
    await expect(
      rb.reportAnimation(c.request_id, {
        consumer_id: 'studio-b',
        event: 'completed',
      }),
    ).rejects.toMatchObject({ code: 'not_current_consumer' });
    expect(
      await rb.reportAnimation(c.request_id, {
        consumer_id: 'studio-a',
        event: 'completed',
      }),
    ).toEqual({ animation_status: 'completed' });
    const second = await rb.claimAnimation(CH, 'studio-a');
    expect(second.animation).toMatchObject({
      request_id: t.request_id,
      animation: 'flop',
      banned: null,
    });
    // A CSC test; then Studio absent too long: dropped, not shown late.
    const csc = await rb.test(CH, {
      mode: 'animation',
      outcome: 'csc',
      trigger: 'Raptoru_',
    });
    expect(csc).toMatchObject({
      animation: 'ban_csc',
      target: { name: 'Raptoru_' },
    });
    core.clock.advance(RANDOM_BAN.animationMaxAgeMs + 1);
    await rb.state(CH);
    expect(await rb.outcome(csc.request_id)).toMatchObject({
      animation_status: 'skipped',
    });
    expect(await rb.outcome(t.request_id)).toMatchObject({
      animation_status: 'unknown',
    });
  });

  it('state: the executor as it last claimed, the recent requests', async () => {
    const { core, rb, ask } = await fixture();
    await ask();
    await rb.claim(CH, { ...EXEC, can_timeout: false, missing: ['x'] });
    const s = await rb.state(CH);
    expect(s.executor).toMatchObject({
      login: 'lecroupier_',
      can_timeout: false,
    });
    expect(s.rules).toEqual({ duration_sub_s: 180, duration_non_sub_s: 300 });
    expect(s.recent).toHaveLength(1);
    core.clock.advance(20_000);
    expect((await rb.state(CH)).executor).toBeNull();
  });
});

describe('Random Ban — from the channel points rule', () => {
  it('a real redemption → one real request (no Studio job); a redelivery → nothing more; the result reaches the history', async () => {
    const { core, rb } = await fixture();
    const cp = new ChannelPointsService(core.db, core.clock, core.soundLab, rb);
    await cp.syncRewards({
      channel_id: CH,
      rewards: [
        {
          id: 'reward-rb',
          title: 'Ban aléatoire',
          cost: 3000,
          is_enabled: true,
        },
      ],
    });
    await cp.saveRule(CH, 'reward-rb', {
      enabled: true,
      actions: [{ type: 'interaction', interaction: 'random_ban' }],
    });
    await cp.setEnabled(CH, true, 'test');
    const e = {
      channel_id: CH,
      source: 'twitch' as const,
      redemption_id: randomUUID(),
      reward: { id: 'reward-rb', title: 'Ban aléatoire', cost: 3000 },
      user: { id: BUYER.id, login: BUYER.login, display_name: BUYER.name },
      twitch_status: 'unfulfilled' as const,
      redeemed_at: core.clock.now().toISOString(),
    };
    const first = await cp.receive(e);
    expect(first.redemption).toMatchObject({
      status: 'pending',
      results: [{ status: 'pending', progress: 'queued' }],
    });
    expect((await cp.receive(e)).outcome).toBe('duplicate');
    expect(await cp.claim(CH, 'studio-1')).toBeNull();
    const c = await rb.claim(CH, EXEC);
    expect(c.request).toMatchObject({ mode: 'real', buyer: { name: 'Buyer' } });
    expect(await rb.claim(CH, EXEC)).toEqual({ request: null, reason: 'busy' });
    await rb.target(c.request!.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.request!.attempt_id,
      target: TARGET,
      is_sub: false,
      stats: STATS,
    });
    await rb.result(c.request!.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.request!.attempt_id,
      event: 'confirmed',
    });
    const state = await cp.state(CH);
    expect(state.recent[0]).toMatchObject({
      status: 'done',
      results: [{ status: 'done', detail: 'Target en timeout 5 min' }],
    });
    // Studio « Tester » (simulation): a dry run, never a timeout; a refused one says the refund is owed.
    const t = await cp.receive({
      ...e,
      source: 'simulation',
      redemption_id: `test-${randomUUID()}`,
    });
    const req = (t.redemption.results[0] as { random_ban_id: string })
      .random_ban_id;
    expect(await rb.outcome(req)).toMatchObject({ mode: 'dry_run' });
    const real = await cp.receive({ ...e, redemption_id: randomUUID() });
    const id = (real.redemption.results[0] as { random_ban_id: string })
      .random_ban_id;
    // The dry run first (one at a time), then the real one, refused.
    const d = await rb.claim(CH, EXEC);
    await rb.result(d.request!.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: d.request!.attempt_id,
      event: 'flop',
    });
    const r = await rb.claim(CH, EXEC);
    expect(r.request!.request_id).toBe(id);
    await rb.target(id, {
      executor_id: EXEC.executor_id,
      attempt_id: r.request!.attempt_id,
      target: TARGET,
      is_sub: false,
      stats: STATS,
    });
    await rb.result(id, {
      executor_id: EXEC.executor_id,
      attempt_id: r.request!.attempt_id,
      event: 'refused',
      error: 'Twitch 400 : already banned',
    });
    const after = await cp.state(CH);
    const of = (rid: string) =>
      after.recent.find((x) => x.redemption_id === rid);
    expect(of(real.redemption.redemption_id!)).toMatchObject({
      status: 'failed',
      results: [
        {
          status: 'failed',
          error:
            'Twitch 400 : already banned — remboursement nécessaire (non effectué : récompense créée par SAMMI)',
        },
      ],
    });
    expect(of(t.redemption.redemption_id!)).toMatchObject({
      results: [{ status: 'done', detail: 'flop : aucun follower éligible' }],
    });
  });
});

describe('Random Ban — the redemption follows the result without Studio (live of 21/10)', () => {
  it('confirmed → the redemption is done at the executor report, no Studio read; another pending one is untouched', async () => {
    const { core, rb } = await fixture();
    const cp = new ChannelPointsService(core.db, core.clock, core.soundLab, rb);
    await cp.syncRewards({
      channel_id: CH,
      rewards: [
        {
          id: 'reward-rb',
          title: 'Ban aléatoire',
          cost: 3000,
          is_enabled: true,
        },
      ],
    });
    await cp.saveRule(CH, 'reward-rb', {
      enabled: true,
      actions: [{ type: 'interaction', interaction: 'random_ban' }],
    });
    await cp.setEnabled(CH, true, 'test');
    const redeem = () =>
      cp.receive({
        channel_id: CH,
        source: 'twitch' as const,
        redemption_id: randomUUID(),
        reward: { id: 'reward-rb', title: 'Ban aléatoire', cost: 3000 },
        user: { id: BUYER.id, login: BUYER.login, display_name: BUYER.name },
        twitch_status: 'unfulfilled' as const,
        redeemed_at: core.clock.now().toISOString(),
      });
    const first = await redeem();
    const second = await redeem(); // queued behind the first: stays pending
    const row = async (rid: string) =>
      (
        await core.db.query<{
          status: string;
          twitch_status: string;
          results: { status: string; detail?: string }[];
        }>(
          'select status, twitch_status, results from cp_redemptions where redemption_id = $1',
          [rid],
        )
      )[0]!;
    const c = await rb.claim(CH, EXEC);
    await rb.target(c.request!.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.request!.attempt_id,
      target: TARGET,
      is_sub: false,
      stats: STATS,
    });
    const report = {
      executor_id: EXEC.executor_id,
      attempt_id: c.request!.attempt_id,
      event: 'confirmed' as const,
    };
    expect((await rb.result(c.request!.request_id, report)).status).toBe(
      'confirmed',
    );
    // No cp.state() / cp.claim(): the redemption is final from the report alone. Twitch's status is untouched
    // (SAMMI's reward: Raptoru never fulfils it).
    expect(await row(first.redemption.redemption_id!)).toMatchObject({
      status: 'done',
      twitch_status: 'unfulfilled',
      results: [{ status: 'done', detail: 'Target en timeout 5 min' }],
    });
    expect(await row(second.redemption.redemption_id!)).toMatchObject({
      status: 'pending',
      results: [{ status: 'pending' }],
    });
    // The same report again (answer lost): idempotent, still done once.
    await rb.result(c.request!.request_id, report);
    expect((await row(first.redemption.redemption_id!)).status).toBe('done');
  });
});

describe('Random Ban migrations', () => {
  const fresh = () =>
    createPgliteDb(
      new PGlite({
        parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
      }),
    );
  const schema = async (db: ReturnType<typeof fresh>) => ({
    columns: await db.query(
      `select column_name, data_type, is_nullable, column_default, is_identity from information_schema.columns
       where table_name = 'rb_requests' order by column_name`,
    ),
    checks: await db.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid::regclass::text = 'rb_requests' order by 1`,
    ),
    indexes: await db.query(
      `select indexname, indexdef from pg_indexes where tablename = 'rb_requests' order by indexname`,
    ),
  });
  it('production scope = Lab scope; idempotent in the « all » scope', async () => {
    const prod = fresh();
    const lab = fresh();
    closers.push(
      () => prod.close(),
      () => lab.close(),
    );
    await migrate(prod, 'prod');
    await migrate(lab, 'lab');
    const p = await schema(prod);
    expect(p.columns.length).toBe(30);
    expect(p).toEqual(await schema(lab));
    const all = fresh();
    closers.push(() => all.close());
    await expect(migrate(all, 'all')).resolves.toContain(
      '20261026130000_random_ban.sql',
    );
  });
});
