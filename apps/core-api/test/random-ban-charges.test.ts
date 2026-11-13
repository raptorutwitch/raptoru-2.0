import type { LabChatMessage } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { chatRouter } from '../src/lab-chat/games.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { charges, RB_PRICING_DEFAULT } from '../src/random-ban/pricing.js';
import { setup } from './helpers.js';

// Random Ban V5 (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 2, decided 13/11/2026): fixed prices (25 000 Jetons for the
// extension and `!rb`) and personal charges — 3 at most, one back every 10 min, shared by the extension, `!rb` and the
// channel points. A refusal creates nothing, debits nothing and never delays the next charge.

const CH = '83603689';
const MIN = 60_000;
const T0 = new Date('2026-11-12T20:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('charges (pure rule)', () => {
  const p = RB_PRICING_DEFAULT;
  const c = (used: number[], now: number) => charges(p, used.map(at), at(now));

  it('nothing used: 3 of 3, nothing to wait for', () => {
    expect(c([], 0)).toMatchObject({
      available: 3,
      max: 3,
      next_at: null,
      full_at: null,
    });
  });

  it('one used: 2, the next back 10 min later', () => {
    expect(c([0], 0)).toMatchObject({
      available: 2,
      next_at: at(10 * MIN).toISOString(),
      full_at: at(10 * MIN).toISOString(),
    });
    expect(c([0], 10 * MIN - 1).available).toBe(2);
    expect(c([0], 10 * MIN).available).toBe(3);
  });

  it('three in a row: empty, then one back every 10 min', () => {
    expect(c([0, 0, 0], 0)).toMatchObject({
      available: 0,
      next_at: at(10 * MIN).toISOString(),
      full_at: at(30 * MIN).toISOString(),
    });
    expect(c([0, 0, 0], 10 * MIN).available).toBe(1);
    expect(c([0, 0, 0], 20 * MIN).available).toBe(2);
    expect(c([0, 0, 0], 30 * MIN).available).toBe(3);
  });

  it('a use during a recharge never restarts it', () => {
    // Used at 0 and at 5 min: the first recharge still ends at 10 min.
    expect(c([0, 5 * MIN], 5 * MIN)).toMatchObject({
      available: 1,
      next_at: at(10 * MIN).toISOString(),
      full_at: at(20 * MIN).toISOString(),
    });
  });

  it('a forced use (a reward Raptoru cannot refund) never digs below zero', () => {
    expect(c([0, 0, 0, 0], 10 * MIN).available).toBe(1);
  });

  it('0 charges in Studio: no limit', () => {
    expect(
      charges({ ...p, chargesMax: 0 }, [T0, T0, T0, T0], T0),
    ).toMatchObject({ available: 0, max: 0, next_at: null });
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
      await core.db.query<{ price_paid: number }>(
        `select price_paid from rb_requests where buyer_id = $1 and source <> 'channel_points' order by seq`,
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
  const refusals = async () =>
    Number(
      (
        await core.db.query<{ n: string }>(
          `select count(*) as n from cmd_steps where idempotency_key like 'rb:refuse:%'`,
        )
      )[0]?.n,
    );
  const cp = (ref: string, cooldown = true) =>
    rb.requestChannelPoints({
      channel_id: CH,
      source_ref: `twitch:${ref}:0`,
      mode: 'real',
      buyer: { id: alice.id, login: alice.login, name: alice.display_name },
      cooldown,
    });
  const left = async () =>
    (await rb.buyerState(CH, alice.id)).charges.available;
  return {
    core,
    rb,
    drain,
    advance,
    tokensOf,
    paid,
    lastReply,
    say,
    buyChat,
    refusals,
    cp,
    left,
  };
}

describe('`!rb` with charges', () => {
  it('3 in a row at 25 000, the 4th refused before anything (no request, no debit, one short line)', async () => {
    const l = await lab();
    await l.drain();
    for (let i = 0; i < 3; i++) expect(await l.buyChat()).toBe('rb_queued');
    expect(await l.tokensOf()).toBe(1_000_000 - 75_000);
    expect(await l.buyChat()).toBe('rb_refused');
    expect(await l.paid()).toEqual([25_000, 25_000, 25_000]);
    expect(await l.tokensOf()).toBe(1_000_000 - 75_000);
    expect(await l.lastReply()).toBe(
      '@Alice - Plus de charge Random Ban, la prochaine dans 10 min · rien n’a été débité.',
    );
  });

  it('one charge back every 10 min; a refusal never delays it', async () => {
    const l = await lab();
    await l.drain();
    for (let i = 0; i < 3; i++) await l.buyChat();
    await l.advance(4 * MIN);
    expect(await l.buyChat()).toBe('rb_refused');
    await l.advance(6 * MIN);
    expect(await l.left()).toBe(1);
    expect(await l.buyChat()).toBe('rb_queued');
    expect(await l.buyChat()).toBe('rb_refused');
  });

  it('refusal lines: at most one per viewer every 5 min', async () => {
    const l = await lab();
    await l.drain();
    for (let i = 0; i < 3; i++) await l.buyChat();
    await l.buyChat();
    await l.buyChat();
    await l.advance(4 * MIN);
    await l.buyChat();
    expect(await l.refusals()).toBe(1);
    await l.advance(MIN);
    await l.buyChat();
    expect(await l.refusals()).toBe(2);
  });

  it('a request that ends with nothing done (refunded) gives its charge back', async () => {
    const l = await lab();
    await l.drain();
    await l.say('!rb');
    expect(await l.left()).toBe(2);
    // The executor refuses it (missing scope): failed, refunded once.
    await l.rb.claim(CH, { ...EXEC, can_timeout: false, missing: ['x'] });
    await l.drain();
    expect(await l.tokensOf()).toBe(1_000_000);
    expect(await l.left()).toBe(3);
  });

  it('the same Twitch message twice: one request, one debit, one charge', async () => {
    const l = await lab();
    await l.drain();
    await l.say('!rb', 'same-1');
    expect((await l.say('!rb', 'same-1')).handled[0]?.outcome).toBe(
      'rb_replayed',
    );
    expect(await l.tokensOf()).toBe(975_000);
    expect(await l.left()).toBe(2);
  });

  it('`!rb <anything>` is not a command (nothing paid, no answer)', async () => {
    const l = await lab();
    await l.drain();
    expect((await l.say('!rb 30000')).handled[0]?.outcome ?? 'ignored').toBe(
      'ignored',
    );
    expect(await l.paid()).toEqual([]);
  });

  it('the pending cap still holds (Studio: 2): the 3rd open request is refused before any debit', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban.max_pending', 2, 'test');
    await l.drain();
    await l.say('!rb');
    await l.say('!rb');
    const before = await l.tokensOf();
    expect((await l.say('!rb')).handled[0]?.outcome).toBe('rb_refused');
    expect(await l.tokensOf()).toBe(before);
    expect(await l.lastReply()).toBe(
      '@Alice - Déjà 2 Random Ban en attente · rien n’a été débité.',
    );
  });

  it('Studio settings: the price, the capacity and the recharge are read at the purchase', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban.price', 20_000, 'test');
    await l.core.moduleSettings.set(CH, 'random_ban.charges_max', 1, 'test');
    await l.core.moduleSettings.set(CH, 'random_ban.recharge_min', 2, 'test');
    await l.drain();
    expect(await l.buyChat()).toBe('rb_queued');
    expect(await l.buyChat()).toBe('rb_refused');
    await l.advance(2 * MIN);
    expect(await l.buyChat()).toBe('rb_queued');
    expect(await l.paid()).toEqual([20_000, 20_000]);
  });
});

describe('charges shared with the channel points', () => {
  it('two redemptions and one `!rb` use the three charges; the next redemption is refused (no request)', async () => {
    const l = await lab();
    await l.drain();
    expect((await l.cp('r1')).request).not.toBeNull();
    expect((await l.cp('r2')).request).not.toBeNull();
    await l.drain();
    expect(await l.buyChat()).toBe('rb_queued');
    const refused = await l.cp('r3');
    expect(refused).toMatchObject({ request: null, refused: 'no_charge' });
    expect(refused.cooling_ms).toBe(10 * MIN);
    // The same redemption again is still refused, never a request.
    expect((await l.cp('r3')).request).toBeNull();
    expect(await l.buyChat()).toBe('rb_refused');
  });

  it('a reward Raptoru cannot refund is never refused for the charges (it still uses one)', async () => {
    const l = await lab();
    await l.drain();
    for (let i = 0; i < 3; i++) await l.buyChat();
    expect((await l.cp('old', false)).request).not.toBeNull();
    await l.drain();
    expect(await l.left()).toBe(0);
    // Never below zero: the first charge still comes back 10 min after the reserve emptied.
    await l.advance(10 * MIN);
    expect(await l.left()).toBe(1);
  });

  it('the moderation wins over the charges: a personal delay refuses with charges left', async () => {
    const l = await lab();
    await l.drain();
    await l.buyChat();
    await l.core.db.query(
      `insert into lab_viewer_cooldowns (channel_id, viewer_id, module_id, delay_s, until, reason, actor, created_at)
       values ($1, $2, 'random_ban', 900, $3, 'test', 'test', $4)`,
      [CH, alice.id, at(60 * MIN), T0],
    );
    expect(await l.left()).toBe(2);
    expect(await l.cp('r1')).toMatchObject({
      request: null,
      refused: 'cooldown',
    });
  });
});

describe('channel-wide limit (Studio, off by default)', () => {
  it('2 per 10 min: the 3rd Random Ban of the channel is refused, whoever buys it', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban.channel_max', 2, 'test');
    await l.drain();
    expect(await l.buyChat()).toBe('rb_queued');
    expect((await l.cp('r1')).request).not.toBeNull();
    await l.drain();
    expect(await l.buyChat()).toBe('rb_refused');
    expect(await l.lastReply()).toBe(
      '@Alice - Trop de Random Ban en ce moment, réessaie dans 10 min · rien n’a été débité.',
    );
    await l.advance(10 * MIN);
    expect(await l.buyChat()).toBe('rb_queued');
  });
});

describe('moderator refill', () => {
  it('the viewer’s charges are full again', async () => {
    const l = await lab();
    await l.drain();
    for (let i = 0; i < 3; i++) await l.buyChat();
    expect(await l.left()).toBe(0);
    await l.core.db.tx((q) => l.rb.refillCharges(q, CH, alice.id));
    expect(await l.left()).toBe(3);
    expect(await l.buyChat()).toBe('rb_queued');
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

  it('shares the charges with `!rb`; never above expected_price; a replayed intent pays once', async () => {
    const l = await lab();
    await l.core.moduleSettings.set(CH, 'random_ban_ext.enabled', 1, 'test');
    await l.drain();
    await l.buyChat(); // 25 000 by !rb
    await expect(launch(l, 20_000)).rejects.toMatchObject({
      code: 'price_changed',
      details: { price: 25_000 },
    });
    const first = await launch(l, 25_000, 'intent-replay-ext');
    expect(first.replayed).toBe(false);
    const again = await launch(l, 25_000, 'intent-replay-ext');
    expect(again.replayed).toBe(true);
    expect(await l.tokensOf()).toBe(950_000);
    await l.drain();
    await launch(l, 25_000);
    await l.drain();
    await expect(launch(l, 25_000)).rejects.toMatchObject({
      code: 'no_charge',
    });
    expect(await l.tokensOf()).toBe(925_000);
    const view = await l.core.modules.viewerState(CH, 'random_ban_ext', V);
    expect(view.state).toMatchObject({
      identity: true,
      price: 25_000,
      charges: { available: 0, max: 3, recharge_ms: 10 * MIN },
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
