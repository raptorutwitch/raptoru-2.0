import { describe, expect, it } from 'vitest';
import { CHALLENGE_METRICS } from '../src/challenges/metrics.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup } from './helpers.js';

// Random Ban — Sniper (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 4, final rule of 13/11): a prediction frozen at purchase,
// never handed to the draw; ONE rewarded attempt per viewer every 30 min (hit or miss), independent of the charges and
// of the Random Ban without a prediction; 1 000 Jetons for a rewarded hit, paid once; in between « pour la gloire »; a
// request that did nothing is void and gives the chance back.

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
  const launch = async (wish_id?: string, wish_text?: string) => {
    const s = await rb.buyerState(CH, V.id);
    return core.modules.viewer(CH, 'random_ban_ext', 'launch', {
      viewer: V,
      idempotency_key: `intent-${++k}-sniper`,
      input: {
        expected_price: s.price,
        ...(wish_id ? { wish_id } : {}),
        ...(wish_text ? { wish_text } : {}),
      },
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

  it('a rewardable hit pays 1 000 Jetons once — a replayed result and the sweep never pay again', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    const after = await l.tokens();
    const c = await l.resolve(KIWI);
    expect(await l.tokens()).toBe(after + 1_000);
    // The executor reports again; the sweep passes again.
    await l.rb.result(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'confirmed',
    });
    await l.rb.state(CH);
    expect(await l.tokens()).toBe(after + 1_000);
    expect(await l.snipers()).toEqual(['hit']);
    const s = await l.rb.buyerState(CH, V.id);
    expect(s.mine[0]).toMatchObject({
      sniper: 'hit',
      sniper_bonus: 1_000,
      wish: { id: KIWI.id, name: 'Kiwi' },
    });
    expect(s.stats).toMatchObject({
      sniper_tries: 1,
      sniper_hits: 1,
      earned: 1_000,
      spent: 25_000,
    });
  });

  it('a rewarded miss uses the chance: the next Sniper is for glory; a failed (refunded) request gives it back', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    await l.resolve(PIKA); // rewarded attempt, missed
    await l.launch(KIWI.id);
    const before = await l.tokens();
    await l.resolve(KIWI); // right, but for glory
    expect(await l.tokens()).toBe(before);
    await l.advance(31 * MIN);
    await l.launch(KIWI.id);
    await l.resolve('fail'); // did nothing: void, the chance stays
    await l.launch(KIWI.id);
    await l.resolve(KIWI);
    expect(await l.snipers()).toEqual(['miss', 'glory_hit', 'void', 'hit']);
  });

  it('30 min per viewer from the rewarded attempt: for glory in between (shown in the state), rewarded again after', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    await l.resolve(KIWI); // hit at 0
    await l.advance(10 * MIN);
    expect((await l.rb.buyerState(CH, V.id)).sniper).toMatchObject({
      ready: false,
      ready_at: new Date(
        new Date('2026-11-12T20:00:00Z').getTime() + 30 * MIN,
      ).toISOString(),
    });
    await l.launch(KIWI.id);
    await l.resolve(PIKA); // glory miss: never pushes the window
    await l.advance(15 * MIN); // 25 min
    await l.launch(KIWI.id);
    await l.resolve(KIWI); // glory hit
    await l.advance(6 * MIN); // 31 min
    expect((await l.rb.buyerState(CH, V.id)).sniper).toMatchObject({
      ready: true,
      ready_at: null,
    });
    await l.launch(KIWI.id);
    await l.resolve(KIWI);
    expect(await l.snipers()).toEqual(['hit', 'glory', 'glory_hit', 'hit']);
    expect(await l.tokens()).toBe(START - 4 * 25_000 + 2 * 1_000);
  });

  it('independent of the charges and of the other sources: Random Ban without a prediction never use the chance', async () => {
    const l = await lab();
    await l.rb.request({
      channel_id: CH,
      source: 'channel_points',
      source_ref: 'r-1',
      mode: 'real',
      buyer: { id: V.id, login: 'alice', name: 'Alice' },
    });
    await l.resolve(PIKA); // a real channel points Random Ban
    await l.launch(); // an extension Random Ban without a Sniper
    await l.resolve(PIKA);
    expect((await l.rb.buyerState(CH, V.id)).sniper).toMatchObject({
      ready: true,
    });
    await l.launch(KIWI.id);
    await l.resolve(KIWI);
    expect(await l.snipers()).toEqual(['none', 'none', 'hit']);
  });

  it('two attempts bought together: the second sees the first (pending counts) — unless the first fails before', async () => {
    const l = await lab();
    await l.launch(KIWI.id);
    expect((await l.rb.buyerState(CH, V.id)).sniper.ready).toBe(false); // shown before the result
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
      { id: KIWI.id, login: 'kiwi', name: 'Kiwi', avatar: null },
      { id: PIKA.id, login: 'pika', name: 'Pika', avatar: null },
    ]);
    expect(s.sniper).toMatchObject({
      ready: true,
      bonus: 1_000,
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

// Refonte Mini-jeux (13/11): the Sniper is typed freely. An exact account (login or name, « @ » or not) is the
// prediction; anything else is kept as typed (`unresolved`) for a moderator — never guessed, never given to the draw.
describe('Sniper — free text and the moderator’s resolution', () => {
  const studio = {
    id: 'antoni',
    role: 'broadcaster' as const,
    via: 'studio' as const,
  };
  const row = async (l: Awaited<ReturnType<typeof lab>>) =>
    (
      await l.core.db.query<{
        request_id: string;
        sniper: string;
        wish_id: string | null;
        wish_text: string | null;
      }>(
        'select request_id, sniper, wish_id, wish_text from rb_requests where buyer_id = $1 order by seq desc limit 1',
        [V.id],
      )
    )[0]!;

  it('an exact name, « @ » and case aside, is the prediction; the text is kept as typed', async () => {
    const l = await lab();
    await l.launch(undefined, '  @PIKA ');
    expect(await row(l)).toMatchObject({
      sniper: 'armed',
      wish_id: PIKA.id,
      wish_text: 'PIKA',
    });
  });

  it('a typo is never guessed: unresolved, no bonus at the result, then a moderator settles it once', async () => {
    const l = await lab();
    await l.launch(undefined, 'Pikka');
    expect(await row(l)).toMatchObject({
      sniper: 'unresolved',
      wish_id: null,
      wish_text: 'Pikka',
    });
    const before = await l.tokens();
    await l.resolve(PIKA);
    expect((await row(l)).sniper).toBe('unresolved'); // the result decides nothing for it
    expect(await l.tokens()).toBe(before);
    const r = await row(l);
    const reco = await l.rb.moderation!.reconciliation(CH, studio);
    expect(
      reco.items.find((x) => x.request.request_id === r.request_id)?.why,
    ).toBe('sniper_a_resoudre');
    await l.rb.moderation!.act(CH, studio, {
      action: 'resolve_sniper',
      request_id: r.request_id,
      viewer_id: PIKA.id,
      reason: 'il visait Pika',
    });
    expect(await row(l)).toMatchObject({ sniper: 'hit', wish_id: PIKA.id });
    expect(await l.tokens()).toBe(before + 1_000);
    // A second resolution (double click, another moderator): refused, never a second bonus.
    await expect(
      l.rb.moderation!.act(CH, studio, {
        action: 'resolve_sniper',
        request_id: r.request_id,
        viewer_id: PIKA.id,
        reason: 'encore',
      }),
    ).rejects.toMatchObject({ code: 'sniper_not_unresolved' });
    expect(await l.tokens()).toBe(before + 1_000);
  });

  it('an unresolved attempt uses the chance like any other: the next one is for glory; its late resolution never pays twice', async () => {
    const l = await lab();
    await l.launch(undefined, 'Pikka');
    await l.resolve(PIKA); // unresolved, rewarded (decided now)
    const first = await row(l);
    await l.launch(KIWI.id);
    await l.resolve(KIWI); // for glory: the unresolved one holds the chance
    const before = await l.tokens();
    await l.rb.moderation!.act(CH, studio, {
      action: 'resolve_sniper',
      request_id: first.request_id,
      viewer_id: PIKA.id,
      reason: 'il visait Pika',
    });
    expect(await l.tokens()).toBe(before + 1_000);
    expect(await l.snipers()).toEqual(['hit', 'glory_hit']);
  });

  it('« no account »: void; a request that did nothing makes an unresolved prediction void by itself', async () => {
    const l = await lab();
    await l.launch(undefined, 'personne');
    await l.resolve(KIWI);
    const r = await row(l);
    await l.rb.moderation!.act(CH, studio, {
      action: 'resolve_sniper',
      request_id: r.request_id,
      viewer_id: null,
      reason: 'aucun compte',
    });
    expect((await row(l)).sniper).toBe('void');
    await l.advance(31 * MIN);
    await l.launch(undefined, 'xyz');
    await l.resolve('fail');
    expect((await row(l)).sniper).toBe('void');
  });

  it('the strip of the extension’s reel is built after the draw, the Core’s target at its stop', async () => {
    const l = await lab();
    await l.launch(PIKA.id);
    await l.resolve(KIWI);
    const mine = (await l.rb.buyerState(CH, V.id)).mine[0]!;
    expect(mine.strip).not.toBeNull();
    expect(mine.strip!.items[mine.strip!.stop]!.id).toBe(KIWI.id);
    // The predicted viewer is never right beside the target (no false « so close »).
    const { items, stop } = mine.strip!;
    expect([items[stop - 1]?.id, items[stop + 1]?.id]).not.toContain(PIKA.id);
    // The public history: who launched, who was drawn — never the strip nor a redemption id.
    const recent = (await l.rb.buyerState(CH, KIWI.id)).recent[0]!;
    expect(recent).toMatchObject({
      buyer: { id: V.id },
      target: { id: KIWI.id },
    });
    expect(recent.strip).toBeNull();
    expect(recent.redemption_id).toBeNull();
  });
});

// V4 (14/11): what stops the buyer is said BEFORE the click — and never mixed with the price or the Sniper window.
describe('the player’s availability', () => {
  it('pause, personal delay of the moderation: in the state, with the time left; none otherwise', async () => {
    const l = await lab();
    expect((await l.rb.buyerState(CH, V.id)).restriction).toBeNull();
    await l.core.moduleSettings.set(CH, 'random_ban.queue_paused', 1, 'test');
    expect((await l.rb.buyerState(CH, V.id)).restriction).toEqual({
      code: 'rb_paused',
    });
    await l.core.moduleSettings.set(CH, 'random_ban.queue_paused', 0, 'test');
    await l.launch();
    await l.core.db.query(
      `insert into lab_viewer_cooldowns (channel_id, viewer_id, module_id, delay_s, until, stream, reason, actor, created_at)
       values ($1, $2, 'random_ban', 600, $3, false, 'test', 'test', $4)`,
      [
        CH,
        V.id,
        new Date(l.core.clock.now().getTime() + 3_600_000),
        l.core.clock.now(),
      ],
    );
    const r = (await l.rb.buyerState(CH, V.id)).restriction;
    expect(r).toMatchObject({ code: 'viewer_cooldown' });
    expect(r!.wait_ms).toBeGreaterThan(9 * MIN);
  });
});
