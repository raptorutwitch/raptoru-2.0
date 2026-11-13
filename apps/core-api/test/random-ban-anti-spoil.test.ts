import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RANDOM_BAN_ANIMATIONS } from '@raptoru/schemas';
import { buildStrip } from '../src/random-ban/reel.js';
import { setup } from './helpers.js';

// Random Ban anti-spoil (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 5, 13/11): the target drawn, the stream's HISTORICAL
// alert is queued at once, BEFORE the timeout; Core decides when the extension reveals the target (the alert's reveal +
// the stream's latency) and when the bot strikes (+ the setting); the alert's real start refines both, an alert that
// does not start holds the strike at most 20 s; nothing public names the target before its reveal.

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

async function lab(o: { studio?: boolean } = {}) {
  const core = await setup();
  core.clock.set(new Date('2026-11-12T20:00:00Z'));
  const rb = core.randomBan;
  rb.candidates = async () => [KIWI, ...POOL];
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
    return {
      c,
      answer: answer as {
        proceed: boolean;
        duration_s?: number;
        delay_ms?: number;
      },
    };
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
  const again = (c: { request_id: string; attempt_id: string }) =>
    rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: KIWI,
      is_sub: false,
      stats: STATS,
    }) as Promise<{ proceed: boolean; delay_ms?: number }>;
  const row = async (id: string) =>
    (
      await core.db.query<{
        status: string;
        animation: string;
        animation_status: string;
        refund: string;
      }>('select * from rb_requests where request_id = $1', [id])
    )[0]!;
  const showOf = async (id: string) => {
    const animation = (await row(id)).animation;
    return RANDOM_BAN_ANIMATIONS.find((a) => a.id === animation)!.showAt;
  };
  return { core, rb, buy, drawn, report, anim, studioPoll, again, row, showOf };
}

describe('anti-spoil: the alert first, the timeout after the reveal', () => {
  it('drawn: the historical alert is queued BEFORE any timeout; the strike waits for its reveal + latency + setting', async () => {
    const l = await lab();
    await l.buy();
    const { c, answer } = await l.drawn();
    const show = await l.showOf(c.request_id);
    // pickup (1 s) + the alert's reveal + 4 s of stream latency + 2 s (defaults)
    expect(answer).toMatchObject({
      proceed: true,
      duration_s: 300,
      delay_ms: 1_000 + show + 4_000 + 2_000,
    });
    expect((await l.row(c.request_id)).status).toBe('timeout_requested');
    // Studio starts the alert 300 ms later: the real start decides (the bot checks again before striking).
    l.core.clock.advance(300);
    expect((await l.anim()).animation).toMatchObject({
      banned: 'Kiwi',
      trigger: 'Alice',
    });
    expect(await l.again(c)).toMatchObject({
      delay_ms: show + 4_000 + 2_000,
    });
    l.core.clock.advance(show + 6_000);
    expect(await l.again(c)).not.toHaveProperty('delay_ms');
    await l.rb.reportAnimation(c.request_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    await l.report(c, 'confirmed');
    // Its alert already played: never a second one after the confirmation.
    expect((await l.anim()).animation).toBeNull();
    expect((await l.row(c.request_id)).animation_status).toBe('completed');
  });

  it('settings: « Retard du stream » and « Timeout après la révélation » set the strike', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban.stream_delay_s', 5, 't');
    await l.core.moduleSettings.set(CH, 'random_ban.strike_after_s', 0, 't');
    await l.buy();
    const { c, answer } = await l.drawn();
    expect(answer.delay_ms).toBe(
      1_000 + (await l.showOf(c.request_id)) + 5_000,
    );
  });

  it('an alert that does not start (Studio busy): the strike is held, at most 20 s after the draw', async () => {
    const l = await lab();
    await l.buy();
    const { c } = await l.drawn();
    for (let t = 1; t <= 30; t++) {
      l.core.clock.advance(1_000);
      await l.studioPoll(); // Studio is there but never claims this alert
      const a = await l.again(c);
      expect(a.proceed).toBe(true);
      if (!a.delay_ms) {
        expect(t).toBeGreaterThan(7);
        expect(t).toBeLessThanOrEqual(20);
        return;
      }
    }
    throw new Error('never struck');
  });

  it('Studio absent: no hold — the timeout at the planned time (bounded fallback); a refused ban drops its unplayed alert', async () => {
    const l = await lab({ studio: false });
    await l.buy();
    const { c, answer } = await l.drawn();
    l.core.clock.advance(answer.delay_ms!);
    expect(await l.again(c)).not.toHaveProperty('delay_ms');
    await l.report(c, 'refused');
    expect(await l.row(c.request_id)).toMatchObject({
      status: 'failed',
      animation_status: 'skipped',
    });
  });

  it('the bot lost for good: still due for 90 s after the strike (a restart finds it), then uncertain; its check refused', async () => {
    const l = await lab({ studio: false });
    await l.buy();
    const { c, answer } = await l.drawn();
    l.core.clock.advance(answer.delay_ms! + 60_000);
    await l.rb.state(CH);
    expect((await l.row(c.request_id)).status).toBe('timeout_requested');
    l.core.clock.advance(31_000);
    await l.rb.state(CH);
    expect(await l.row(c.request_id)).toMatchObject({
      status: 'uncertain',
      refund: 'to_verify',
      animation_status: 'skipped',
    });
    await expect(l.again(c)).rejects.toMatchObject({ code: 'not_searching' });
  });

  it('two in a row: the second alert waits for the first; its strike is held until its alert really starts', async () => {
    const l = await lab();
    await l.buy();
    await l.buy({ id: '9002', login: 'bob', name: 'Bob' });
    const first = await l.drawn();
    await l.anim(); // the first alert plays
    l.core.clock.advance(first.answer.delay_ms!);
    await l.report(first.c, 'confirmed');
    const second = await l.drawn();
    l.core.clock.advance(second.answer.delay_ms!);
    await l.studioPoll();
    expect((await l.anim()).animation).toBeNull(); // the first still plays
    const held = await l.again(second.c);
    expect(held.delay_ms).toBeGreaterThan(0); // never struck before its own alert
    await l.rb.reportAnimation(first.c.request_id, {
      consumer_id: 'studio-1',
      event: 'completed',
    });
    expect((await l.anim()).animation).toMatchObject({ trigger: 'Bob' });
    const show = await l.showOf(second.c.request_id);
    expect(await l.again(second.c)).toMatchObject({
      delay_ms: show + 6_000,
    });
  });

  it('nothing public names the target before its reveal (state, history, strip); the strip in the last 3 s', async () => {
    const l = await lab();
    await l.buy();
    const { c } = await l.drawn();
    await l.anim(); // the alert starts now
    const show = await l.showOf(c.request_id);
    const mine = async () => (await l.rb.buyerState(CH, '9001')).mine[0]!;
    const before = await mine();
    expect(before).toMatchObject({
      status: 'searching',
      target: null,
      strip: null,
      stats: null,
    });
    const pub = await l.rb.buyerState(CH, '9001');
    // (Kiwi is in `candidates`: the viewers present, whom anyone may aim at — not the result.)
    expect(JSON.stringify([pub.mine, pub.recent])).not.toContain(KIWI.id);
    expect(Date.parse(before.reveal_at!)).toBe(
      l.core.clock.now().getTime() + show + 4_000,
    );
    l.core.clock.advance(show + 1_500);
    await l.studioPoll();
    const lead = await mine();
    expect(lead.target).toBeNull();
    expect(lead.strip!.items[lead.strip!.stop]!.id).toBe(KIWI.id);
    l.core.clock.advance(2_500);
    await l.studioPoll();
    expect((await mine()).target).toMatchObject({ id: KIWI.id });
    expect(
      (await l.rb.buyerState(CH, '9002')).recent.map((r) => r.request_id),
    ).toContain(c.request_id);
  });
});
