import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildStrip, REEL_MS } from '../src/random-ban/reel.js';
import { setup } from './helpers.js';

// Random Ban « Le Viseur » (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 5): the target is frozen before anything is shown;
// Studio's reel stops on it; the timeout is sent when the reel stops (+ the stream's latency); « Esquivé ! » when Twitch
// refuses; the historical order (timeout, then video) when the sequence is off or Studio is absent.

const CH = '83603689';
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const KIWI = { id: '990001', login: 'kiwi', name: 'Kiwi' };
const POOL = ['Pika', 'Moka', 'Zed', 'Luna', 'Nox', 'Iris', 'Bao'].map(
  (name, i) => ({
    id: String(990_002 + i),
    login: name.toLowerCase(),
    name,
  }),
);
const STATS = { chatters: 8, candidates: 8, follow_checks: 1 };

describe('buildStrip (pure)', () => {
  it('the target at `stop`, the predicted viewer never right next to it (1 000 random strips)', () => {
    for (let n = 0; n < 1000; n++) {
      const wish = POOL[n % POOL.length]!;
      const { items, stop } = buildStrip(
        [KIWI, ...POOL],
        KIWI,
        wish.id,
        randomInt,
      );
      expect(items[stop]).toEqual(KIWI);
      expect(items[stop - 1]!.id).not.toBe(wish.id);
      expect(items[stop + 1]!.id).not.toBe(wish.id);
    }
  });
  it('alone: a single card, no strip', () => {
    expect(buildStrip([KIWI], KIWI, null, randomInt)).toEqual({
      items: [KIWI],
      stop: 0,
    });
  });
});

async function lab(o: { sequence?: 0 | 1; studio?: boolean } = {}) {
  const core = await setup();
  core.clock.set(new Date('2026-11-12T20:00:00Z'));
  const rb = core.randomBan;
  rb.candidates = async () => [KIWI, ...POOL];
  if (o.sequence !== undefined)
    await core.moduleSettings.set(
      CH,
      'random_ban.sequence',
      o.sequence,
      'test',
    );
  // Studio's poll (every 500 ms in real life): it says it is there.
  const studioPoll = () =>
    rb.claimMute(CH, {
      consumer_id: 'studio-1',
      obs_ready: false,
      mic_held: false,
    });
  if (o.studio !== false) await studioPoll();
  await rb.claim(CH, EXEC);
  const buy = (buyer = { id: '9001', login: 'alice', name: 'Alice' }) =>
    rb.request({
      channel_id: CH,
      source: 'chat',
      source_ref: `m-${Math.random()}`,
      mode: 'real',
      buyer,
    });
  const drawn = async (target = KIWI) => {
    const c = (await rb.claim(CH, EXEC)).request!;
    const answer = await rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target,
      is_sub: false,
      stats: STATS,
    });
    return { c, answer };
  };
  const report = (
    c: { request_id: string; attempt_id: string },
    event: 'confirmed' | 'refused',
  ) =>
    rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event,
      error: 'x',
    });
  const anim = () => rb.claimAnimation(CH, 'studio-1');
  return { core, rb, buy, drawn, report, anim, studioPoll };
}

describe('Le Viseur', () => {
  it('sequence off (default): no delay, no reel — the historical order', async () => {
    const l = await lab();
    await l.buy();
    const { c, answer } = await l.drawn();
    expect(answer).not.toHaveProperty('delay_ms');
    expect((await l.anim()).animation).toBeNull();
    await l.report(c, 'confirmed');
    expect((await l.anim()).animation).toMatchObject({ banned: 'Kiwi' });
  });

  it('sequence on but Studio silent: timeout at once (fallback), never a reel nobody plays', async () => {
    const l = await lab({ sequence: 1, studio: false });
    await l.buy();
    const { answer } = await l.drawn();
    expect(answer).not.toHaveProperty('delay_ms');
  });

  it('reel first: strike after the reel + latency; the reel lands on the drawn target; then the ban video', async () => {
    const l = await lab({ sequence: 1 });
    await l.buy();
    const { c, answer } = await l.drawn();
    expect(answer).toMatchObject({
      proceed: true,
      duration_s: 300,
      delay_ms: REEL_MS + 3_000,
    });
    // A repeated report: the same strike time, never a new delay.
    l.core.clock.advance(2_000);
    const again = await l.rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: KIWI,
      is_sub: false,
      stats: STATS,
    });
    expect(again).toMatchObject({ delay_ms: REEL_MS + 1_000 });
    const reel = (await l.anim()).animation as unknown as {
      animation: string;
      reel: {
        items: { id: string }[];
        stop: number;
        target: { id: string };
        self: boolean;
      };
    };
    expect(reel.animation).toBe('reel');
    expect(reel.reel.items[reel.reel.stop]!.id).toBe(KIWI.id);
    expect(reel.reel.self).toBe(false);
    // Nothing else while the reel plays (one at a time), and « BANNI » never before the confirmation.
    expect((await l.anim()).animation).toBeNull();
    await l.rb.reportAnimation(c.request_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    expect((await l.anim()).animation).toBeNull();
    await l.report(c, 'confirmed');
    expect((await l.anim()).animation).toMatchObject({
      banned: 'Kiwi',
      trigger: 'Alice',
    });
  });

  it('Twitch refuses after the reel: « Esquivé ! » card, the buyer refunded, never the ban video', async () => {
    const l = await lab({ sequence: 1 });
    await l.buy();
    const { c } = await l.drawn();
    await l.anim(); // the reel
    await l.rb.reportAnimation(c.request_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    await l.report(c, 'refused');
    const dodge = (await l.anim()).animation as unknown as {
      animation: string;
      banned: string;
    };
    expect(dodge).toMatchObject({ animation: 'dodge', banned: 'Kiwi' });
    await l.rb.reportAnimation(c.request_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    expect((await l.anim()).animation).toBeNull();
    // Refunded already by the usual path (!rb: the chat settle, right after the result): nothing owed any more.
    expect(await l.rb.outcome(c.request_id)).toMatchObject({
      status: 'failed',
      refund: 'none',
    });
  });

  it('a reel Studio would play after the strike is skipped (never a reel after the fact)', async () => {
    const l = await lab({ sequence: 1 });
    await l.buy();
    const { c } = await l.drawn();
    l.core.clock.advance(REEL_MS + 3_001);
    await l.report(c, 'confirmed');
    const a = (await l.anim()).animation as unknown as { animation: string };
    expect(a.animation).not.toBe('reel');
  });

  it('CSC: the reel lands on the buyer himself and says so', async () => {
    const l = await lab({ sequence: 1 });
    const alice = { id: '9001', login: 'alice', name: 'Alice' };
    await l.buy(alice);
    await l.drawn(alice);
    const reel = (await l.anim()).animation as unknown as {
      reel: { self: boolean };
    };
    expect(reel.reel.self).toBe(true);
  });
});
