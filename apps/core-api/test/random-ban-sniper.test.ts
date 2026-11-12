import { describe, expect, it } from 'vitest';
import { CHALLENGE_METRICS } from '../src/challenges/metrics.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// Random Ban — Sniper (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 4, decided 12/11): a prediction frozen at purchase, never
// handed to the draw; rewardable when the buyer launched no other counted Random Ban (extension, !rb, channel points)
// in the 30 min before; 2 000 Jetons for a rewardable hit, paid once; a request that did nothing is void.

const CH = '83603689';
const MIN = 60_000;
const V = { id: '9001', display_name: 'Alice' };
const KIWI = { id: '990001', login: 'kiwi', name: 'Kiwi' };
const PIKA = { id: '990002', login: 'pika', name: 'Pika' };
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const START = 1_000_000;

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-11-12T20:00:00Z'));
  const rb = core.randomBan;
  rb.candidates = async () => [KIWI, PIKA];
  await core.moduleSettings.set(CH, 'random_ban_ext.enabled', 1, 'test');
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    V.id,
    'set',
    { tokens: START },
    'test',
  );
  let k = 0;
  /** An extension purchase (at the current price), optionally aiming at someone. */
  const launch = async (wish_id?: string) => {
    const s = await rb.buyerState(CH, V.id);
    return core.modules.viewer(CH, 'random_ban_ext', 'launch', {
      viewer: V,
      idempotency_key: `intent-${++k}-sniper`,
      input: { expected_price: s.price.price, ...(wish_id ? { wish_id } : {}) },
    });
  };
  /** The executor runs the next request to the given target (or fails it). */
  const resolve = async (
    target: { id: string; login: string; name: string } | 'fail',
  ) => {
    const c = (await rb.claim(CH, EXEC)).request!;
    if (target === 'fail') {
      await rb.result(c.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: c.attempt_id,
        event: 'failed',
        error: 'test',
      });
      return c;
    }
    await rb.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target,
      is_sub: false,
      stats: { chatters: 3, candidates: 3, follow_checks: 1 },
    });
    await rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'confirmed',
    });
    return c;
  };
  const tokens = async () =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, V.id],
        )
      )[0]!.tokens,
    );
  const snipers = async () =>
    (
      await core.db.query<{ sniper: string; wish_id: string | null }>(
        'select sniper, wish_id from rb_requests where buyer_id = $1 order by seq',
        [V.id],
      )
    ).map((r) => r.sniper);
  const advance = async (ms: number) => {
    core.clock.advance(ms);
    await rb.claim(CH, EXEC); // the executor is there again (15 s)
  };
  await rb.claim(CH, EXEC);
  return { core, rb, launch, resolve, tokens, snipers, advance };
}

describe('Sniper', () => {
  it('the draw never sees the prediction: the executor gets exactly the same claim with or without it', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    const withWish = await l.resolve(KIWI);
    await l.advance(31 * MIN);
    await l.launch();
    const withoutWish = (await l.rb.claim(l.core.clock.now() && CH, EXEC))
      .request!;
    const shape = (c: Record<string, unknown>) => Object.keys(c).sort();
    expect(shape(withWish)).toEqual(shape(withoutWish));
    expect(JSON.stringify(withWish)).not.toContain(KIWI.id);
    expect(withWish.buyer).toEqual(withoutWish.buyer);
  });

  it('a rewardable hit pays 2 000 Jetons once — a replayed result and the sweep never pay again', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    const after = await l.tokens();
    const c = await l.resolve(KIWI);
    expect(await l.tokens()).toBe(after + 2_000);
    // The executor reports again; the sweep passes again.
    await l.rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'confirmed',
    });
    await l.rb.state(CH);
    expect(await l.tokens()).toBe(after + 2_000);
    expect(await l.snipers()).toEqual(['hit']);
    const s = await l.rb.buyerState(CH, V.id);
    expect(s.mine[0]).toMatchObject({
      sniper: 'hit',
      sniper_bonus: 2_000,
      wish: { id: KIWI.id, name: 'Kiwi' },
    });
    expect(s.stats).toMatchObject({
      sniper_tries: 1,
      sniper_hits: 1,
      earned: 2_000,
      spent: 25_000,
    });
  });

  it('miss: no bonus; another target → miss; nothing happened (failed, refunded) → void', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    await l.resolve(PIKA);
    await l.advance(31 * MIN);
    await l.launch(KIWI.id);
    await l.resolve('fail');
    expect(await l.snipers()).toEqual(['miss', 'void']);
  });

  it('30 min window, all sources: a !rb 10 min before → « pour la gloire » (hit without bonus); 31 min → rewardable', async () => {
    const l = await lab();
    await l.launch(); // a Random Ban without prediction (same rule as !rb: a counted Random Ban)
    await l.resolve(PIKA);
    await l.advance(10 * MIN);
    expect((await l.rb.buyerState(CH, V.id)).sniper).toMatchObject({
      ready: false,
    });
    await l.launch(KIWI.id);
    const before = await l.tokens();
    await l.resolve(KIWI);
    expect(await l.tokens()).toBe(before);
    await l.advance(31 * MIN);
    expect((await l.rb.buyerState(CH, V.id)).sniper).toMatchObject({
      ready: true,
      ready_at: null,
    });
    await l.launch(KIWI.id);
    await l.resolve(KIWI);
    expect(await l.snipers()).toEqual(['none', 'glory_hit', 'hit']);
  });

  it('channel points count for the window; a failed (refunded) Random Ban never takes the chance away', async () => {
    const l = await lab();
    await l.rb.request({
      channel_id: CH,
      source: 'channel_points',
      source_ref: 'r-1',
      mode: 'real',
      buyer: { id: V.id, login: 'alice', name: 'Alice' },
    });
    await l.resolve('fail'); // did nothing: does not count
    await l.launch(KIWI.id);
    await l.resolve(KIWI);
    expect(await l.snipers()).toEqual(['none', 'hit']);
    await l.advance(31 * MIN);
    await l.rb.request({
      channel_id: CH,
      source: 'channel_points',
      source_ref: 'r-2',
      mode: 'real',
      buyer: { id: V.id, login: 'alice', name: 'Alice' },
    });
    await l.resolve(PIKA); // a real channel points Random Ban: it counts
    await l.launch(KIWI.id);
    await l.resolve(KIWI);
    expect((await l.snipers()).at(-1)).toBe('glory_hit');
  });

  it('two attempts bought together: the second sees the first (pending counts) — unless the first fails before', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    await l.launch(KIWI.id);
    await l.resolve(KIWI);
    await l.resolve(KIWI);
    expect(await l.snipers()).toEqual(['hit', 'glory_hit']);
    const l2 = await lab();
    await l2.launch(KIWI.id);
    await l2.launch(KIWI.id);
    await l2.resolve('fail');
    await l2.resolve(KIWI);
    expect(await l2.snipers()).toEqual(['void', 'hit']);
  });

  it('aiming at yourself, the streamer or someone absent is refused before any debit', async () => {
    const l = await lab();
    for (const id of [V.id, '42424242'])
      await expect(l.launch(id)).rejects.toMatchObject({
        code: 'wish_unknown',
      });
    expect(await l.tokens()).toBe(START);
    await expect(l.launch('not-an-id')).rejects.toMatchObject({
      code: 'wish_unknown',
    });
  });

  it('the extension lists who may be aimed at (never the buyer), and the bonus', async () => {
    const l = await lab();
    l.rb.candidates = async () => [
      KIWI,
      PIKA,
      { id: V.id, login: 'alice', name: 'Alice' },
    ];
    const s = await l.rb.buyerState(CH, V.id);
    expect(s.candidates).toEqual([
      { id: KIWI.id, name: 'Kiwi' },
      { id: PIKA.id, name: 'Pika' },
    ]);
    expect(s.sniper).toMatchObject({
      ready: true,
      bonus: 2_000,
      window_ms: 30 * MIN,
    });
  });

  it('the secret challenge metric counts rewardable hits only (and CSC its own)', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    await l.resolve(KIWI); // hit
    await l.launch(KIWI.id);
    await l.resolve(KIWI); // glory_hit: not counted
    const metric = (key: string) =>
      CHALLENGE_METRICS.find((m) => m.key === key)!;
    const count = async (key: string) =>
      (
        await l.core.db.query<{ viewer_id: string; n: number }>(
          metric(key).exact!,
          [CH, null, null],
        )
      ).map((r) => [r.viewer_id, Number(r.n)]);
    expect(await count('random_ban_sniper')).toEqual([[V.id, 1]]);
    expect(await count('random_ban_self')).toEqual([]);
  });
});
