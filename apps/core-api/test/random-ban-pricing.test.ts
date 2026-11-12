import type { LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { chatRouter } from '../src/lab-chat/games.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { quote, RB_PRICING_DEFAULT } from '../src/random-ban/pricing.js';
import { setup } from './helpers.js';

// Random Ban progressive price (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 2, decided 12/11/2026): 25 000 · 30 000 ·
// 50 000 · 75 000 · 100 000 per Twitch account, shared by the extension and `!rb`, one tier back every 5 min of calm
// (20 min from the top to the normal price), never charged above the amount the buyer confirmed.

const CH = '83603689';
const MIN = 60_000;
const T0 = new Date('2026-11-12T20:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('quote (pure rule)', () => {
  const p = RB_PRICING_DEFAULT;
  const after = (level: number, ms: number) =>
    quote(p, { series_level: level, created_at: T0 }, at(ms));

  it('no purchase yet: the normal price, nothing to wait for', () => {
    expect(quote(p, null, T0)).toMatchObject({
      level: 0,
      price: 25_000,
      next_price: null,
      next_drop_at: null,
      normal_at: null,
      price_after: 30_000,
    });
  });

  it('after the 5th purchase in a row (paid at level 4): 100 000, then 75 000 · 50 000 · 30 000 · 25 000 every 5 min', () => {
    expect(after(4, 0).price).toBe(100_000);
    expect(after(4, 5 * MIN - 1).price).toBe(100_000);
    expect(after(4, 5 * MIN).price).toBe(75_000);
    expect(after(4, 10 * MIN).price).toBe(50_000);
    expect(after(4, 15 * MIN).price).toBe(30_000);
    expect(after(4, 20 * MIN - 1).price).toBe(30_000);
    expect(after(4, 20 * MIN).price).toBe(25_000);
    expect(after(4, 0)).toMatchObject({
      next_price: 75_000,
      next_drop_at: at(5 * MIN).toISOString(),
      normal_at: at(20 * MIN).toISOString(),
    });
    expect(after(4, 12 * MIN)).toMatchObject({
      level: 2,
      next_price: 30_000,
      next_drop_at: at(15 * MIN).toISOString(),
      normal_at: at(20 * MIN).toISOString(),
    });
  });

  it('one purchase, then 5 min of calm: back to normal; 4 min 59 s: the 2nd tier', () => {
    expect(after(0, 5 * MIN - 1000).price).toBe(30_000);
    expect(after(0, 5 * MIN).price).toBe(25_000);
  });

  it('the level never goes above the top tier', () => {
    expect(after(4, 0).price_after).toBe(100_000);
    expect(after(9, 0).price).toBe(100_000);
  });

  it('step 0 (Studio): a flat price', () => {
    const flat = { ...p, stepMs: 0 };
    expect(quote(flat, { series_level: 4, created_at: T0 }, T0)).toMatchObject({
      price: 25_000,
      price_after: 25_000,
      next_price: null,
    });
  });
});

const alice = {
  id: '9001',
  login: 'alice',
  display_name: 'Alice',
  role: 'viewer' as const,
};
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
let n = 0;
const msg = (text: string, id = `tw-${++n}`): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: alice,
  source: 'twitch',
});

async function lab(tokens = 1_000_000) {
  const core = await setup();
  core.clock.set(T0);
  await editWallet(core.db, T0, CH, alice.id, 'set', { tokens }, 'test');
  const router = chatRouter(core.raffleLab, core.chat.chatModules);
  const rb = core.randomBan;
  /** The executor runs every queued request to a confirmed timeout (then nothing is left « open »). */
  const drain = async () => {
    for (;;) {
      const c = (await rb.claim(CH, EXEC)).request;
      if (!c) return;
      const t = await rb.target(c.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: c.attempt_id,
        target: { id: '9100', login: 'kiwi', name: 'Kiwi' },
        is_sub: false,
        stats: { chatters: 10, candidates: 5, follow_checks: 1 },
      });
      if (t.proceed)
        await rb.result(c.request_id, {
          executor_id: EXEC.executor_id,
          attempt_id: c.attempt_id,
          event: 'confirmed',
        });
    }
  };
  const advance = async (ms: number) => {
    core.clock.advance(ms);
    await rb.claim(CH, { ...EXEC, can_search: false }).catch(() => null);
    await rb.claim(CH, EXEC); // the executor says it is there again (15 s)
  };
  const tokensOf = async () =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, alice.id],
        )
      )[0]?.tokens,
    );
  const paid = async () =>
    (
      await core.db.query<{ price_paid: number; series_level: number }>(
        `select price_paid, series_level from rb_requests where buyer_id = $1 and source <> 'channel_points' order by seq`,
        [alice.id],
      )
    ).map((r) => r.price_paid);
  const lastReply = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'rb:%' order by seq_global desc limit 1`,
      )
    )[0]?.params.text;
  const say = (text: string, id?: string) => router.message(msg(text, id));
  /** `!rb` then the executor finishes it (one purchase, nothing left pending). */
  const buyChat = async (text = '!rb') => {
    const out = await say(text);
    await drain();
    return out.handled[0]?.outcome;
  };
  return { core, rb, drain, advance, tokensOf, paid, lastReply, say, buyChat };
}

describe('`!rb` at the progressive price', () => {
  it('5 in a row (each confirmed by its amount): 25 000 + 30 000 + 50 000 + 75 000 + 100 000 = 280 000', async () => {
    const l = await lab();
    await l.drain();
    expect(await l.buyChat()).toBe('rb_queued');
    for (const amount of ['30000', '50 000', '75k', '100000'])
      expect(await l.buyChat(`!rb ${amount}`)).toBe('rb_queued');
    expect(await l.paid()).toEqual([25_000, 30_000, 50_000, 75_000, 100_000]);
    expect(await l.tokensOf()).toBe(1_000_000 - 280_000);
  });

  it('a bare `!rb` above the normal price: the price and what to type, nothing debited, no request', async () => {
    const l = await lab();
    await l.drain();
    await l.buyChat();
    const before = await l.tokensOf();
    expect(await l.buyChat()).toBe('rb_quote');
    expect(await l.tokensOf()).toBe(before);
    expect(await l.paid()).toEqual([25_000]);
    expect(await l.lastReply()).toBe(
      '@Alice - Random Ban à 30 000 Jetons pour toi (série · 25 000 dans 5 min). Tape !rb 30000 pour confirmer · rien n’a été débité.',
    );
  });

  it('`!rb <montant>` below the current price: refused, nothing debited; above it: the (lower) current price is charged', async () => {
    const l = await lab();
    await l.drain();
    await l.buyChat();
    await l.buyChat('!rb 30000');
    const before = await l.tokensOf();
    expect(await l.buyChat('!rb 30000')).toBe('rb_quote'); // now 50 000
    expect(await l.tokensOf()).toBe(before);
    expect(await l.lastReply()).toContain(
      'Le prix a changé : Random Ban à 50 000 Jetons pour toi',
    );
    expect(await l.buyChat('!rb 100000')).toBe('rb_queued');
    expect(await l.tokensOf()).toBe(before - 50_000);
  });

  it('recovery: one tier back every 5 min; a purchase during the recovery starts from the tier it paid', async () => {
    const l = await lab();
    await l.drain();
    await l.buyChat();
    for (const a of ['30000', '50000', '75000', '100000'])
      await l.buyChat(`!rb ${a}`);
    await l.advance(10 * 60_000); // 100 000 → 75 000 → 50 000
    expect(await l.buyChat('!rb 50000')).toBe('rb_queued');
    expect((await l.paid()).at(-1)).toBe(50_000);
    // Paid at level 2: the next one is 75 000, and 25 000 comes back 15 min later.
    expect(await l.buyChat('!rb 74999')).toBe('rb_quote');
    await l.advance(15 * 60_000);
    expect(await l.buyChat()).toBe('rb_queued');
    expect((await l.paid()).at(-1)).toBe(25_000);
  });

  it('a purchase that ends with nothing done (refunded) never raises the price', async () => {
    const l = await lab();
    await l.drain();
    await l.say('!rb');
    // The executor refuses it (missing scope): failed, refunded once.
    await l.rb.claim(CH, { ...EXEC, can_timeout: false, missing: ['x'] });
    await l.drain();
    expect(await l.tokensOf()).toBe(1_000_000);
    expect(await l.buyChat()).toBe('rb_queued'); // the normal price again
    expect(await l.paid()).toEqual([25_000, 25_000]);
  });

  it('the same Twitch message twice: one request, one debit', async () => {
    const l = await lab();
    await l.drain();
    await l.say('!rb', 'same-1');
    expect((await l.say('!rb', 'same-1')).handled[0]?.outcome).toBe(
      'rb_replayed',
    );
    expect(await l.tokensOf()).toBe(975_000);
  });

  it('at most 2 pending requests per buyer: the 3rd is refused before any debit', async () => {
    const l = await lab();
    await l.drain();
    await l.say('!rb');
    await l.say('!rb 30000');
    const before = await l.tokensOf();
    expect((await l.say('!rb 50000')).handled[0]?.outcome).toBe('rb_refused');
    expect(await l.tokensOf()).toBe(before);
    expect(await l.lastReply()).toBe(
      '@Alice - Tu as déjà 2 Random Ban en attente · rien n’a été débité.',
    );
  });

  it('channel points Random Bans never move the Jetons price', async () => {
    const l = await lab();
    await l.drain();
    for (let i = 0; i < 3; i++)
      await l.rb.request({
        channel_id: CH,
        source: 'channel_points',
        source_ref: `redemption-${i}`,
        mode: 'real',
        buyer: { id: alice.id, login: alice.login, name: alice.display_name },
      });
    await l.drain();
    expect(await l.buyChat()).toBe('rb_queued');
    expect(await l.paid()).toEqual([25_000]);
  });

  it('Studio settings: the tiers and the step are read at the purchase', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban.price', 20_000, 'test');
    await l.core.moduleSettings.set(CH, 'random_ban.price_2', 21_000, 'test');
    await l.core.moduleSettings.set(CH, 'random_ban.tier_step_min', 1, 'test');
    await l.drain();
    await l.buyChat();
    expect(await l.buyChat('!rb 21000')).toBe('rb_queued');
    await l.advance(2 * 60_000);
    expect(await l.buyChat()).toBe('rb_queued');
    expect(await l.paid()).toEqual([20_000, 21_000, 20_000]);
  });
});

describe('extension purchase (module host `random_ban_ext.launch`)', () => {
  const V = { id: alice.id, display_name: alice.display_name };
  let k = 0;
  const launch = (
    l: Awaited<ReturnType<typeof lab>>,
    expected_price: unknown,
    key = `intent-${++k}-ext`,
  ) =>
    l.core.modules.viewer(CH, 'random_ban_ext', 'launch', {
      viewer: V,
      idempotency_key: key,
      input: { expected_price },
    });

  it('OFF by default: refused before any debit', async () => {
    const l = await lab();
    await l.drain();
    await expect(launch(l, 25_000)).rejects.toMatchObject({
      code: 'module_disabled',
    });
    expect(await l.tokensOf()).toBe(1_000_000);
  });

  it('shares the level with `!rb`; never above expected_price; a replayed intent pays once', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban_ext.enabled', 1, 'test');
    await l.drain();
    await l.buyChat(); // 25 000 by !rb
    await expect(launch(l, 25_000)).rejects.toMatchObject({
      code: 'price_changed',
      details: { price: 30_000 },
    });
    expect(await l.tokensOf()).toBe(975_000);
    const first = await launch(l, 30_000, 'intent-replay-ext');
    expect(first.replayed).toBe(false);
    const again = await launch(l, 30_000, 'intent-replay-ext');
    expect(again.replayed).toBe(true);
    expect(await l.tokensOf()).toBe(945_000);
    await l.drain();
    // A higher confirmed amount is a ceiling: the current price (50 000) is charged.
    await launch(l, 100_000);
    expect(await l.paid()).toEqual([25_000, 30_000, 50_000]);
    // The gauge data: the price after these, from the server clock.
    const view = await l.core.modules.viewerState(CH, 'random_ban_ext', V);
    const state = view.state as {
      identity: boolean;
      price: { price: number; level: number; next_price: number | null };
      pending: number;
    };
    expect(state).toMatchObject({
      identity: true,
      price: { level: 3, price: 75_000, next_price: 50_000 },
      pending: 1,
    });
  });

  it('expected_price is required', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban_ext.enabled', 1, 'test');
    await l.drain();
    await expect(launch(l, undefined)).rejects.toMatchObject({
      code: 'expected_price_required',
    });
  });
});
