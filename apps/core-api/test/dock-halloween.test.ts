import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DockActivityService } from '../src/dock/service.js';
import { setup } from './helpers.js';

// Halloween in the OBS dock (docs/HALLOWEEN.md, docs/OBS_DOCK.md): a purchase reaches the dock only once its effect
// STARTED on the streamer's screen, plus the reveal delay (5 s by default, set in Studio, 0 = at once). Before that it
// does not exist for the dock at all — no row, no seq, nothing in the feed or its history; the other events are
// never held back. A purchase that never played (refused, refunded before its start) never shows. One activity per
// purchase, updated in place.

const CH = '900100';
const STUDIO = 'studio-A';
const ANA = { id: '900131', display_name: 'Ana' };

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-10-31T21:00:00Z'));
  const shop = core.eventShop;
  await shop.updateSettings(CH, {
    enabled: true,
    rules: { viewer_gap_ms: 0, screamer_gap_ms: 0 },
  });
  await shop.heartbeat({
    studio_instance_id: STUDIO,
    channel_id: CH,
    engine_ready: true,
    media: [],
  });
  await shop.grant(
    {
      idempotency_key: randomUUID(),
      channel_id: CH,
      viewer: ANA.id,
      amount: 50,
      reason: 'grant',
    },
    'test',
  );
  const dock = new DockActivityService(core.db, core.clock, {
    autoScan: false,
  });
  const buy = (item_id: string) =>
    shop.purchase({
      idempotency_key: randomUUID(),
      channel_id: CH,
      viewer: ANA,
      item_id,
    });
  /** Studio takes the purchase and its effect starts now. */
  const play = async () => {
    const c = (await shop.claim(STUDIO, CH))!;
    await shop.ack(c.purchase.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: c.attempt_id,
      event: 'started',
    });
    return c;
  };
  const halloween = async () =>
    (await dock.recent(CH)).activities.filter((a) => a.type === 'halloween');
  return { core, shop, dock, buy, play, halloween };
}

describe('Halloween in the OBS dock: revealed after the scare', () => {
  it('nothing while bought, handed over, or within 5 s of its start; then one line, with viewer, effect and price', async () => {
    const t = await lab();
    await t.buy('blink');
    await t.dock.scan(CH);
    expect(await t.halloween()).toEqual([]);
    await t.play();
    await t.dock.scan(CH);
    expect(await t.halloween()).toEqual([]);
    t.core.clock.advance(4_999);
    await t.dock.scan(CH);
    expect(await t.halloween()).toEqual([]);
    // Nothing anywhere in the dock's own tables before the reveal.
    expect(
      (
        await t.core.db.query(
          "select 1 from dock_activity where activity_key like 'ix:halloween:%'",
        )
      ).length,
    ).toBe(0);
    t.core.clock.advance(1);
    await t.dock.scan(CH);
    const [line] = await t.halloween();
    expect(line).toMatchObject({
      kind: 'interaction',
      type: 'halloween',
      data: {
        actor: { id: ANA.id, name: 'Ana' },
        effect: { label: expect.any(String), price: expect.any(Number) },
      },
      state: { status: 'executing' },
    });
    // Its time is its start (5 s ago), not the reveal.
    expect(Date.parse(line!.occurred_at)).toBe(
      t.core.clock.now().getTime() - 5_000,
    );
  });

  it('other events are never held back: a later TTS shows at once, the purchase after its delay, in seq order', async () => {
    const t = await lab();
    await t.buy('blink');
    await t.play();
    await t.core.ttsLab.heartbeat({
      studio_instance_id: STUDIO,
      player_ready: true,
    });
    await t.core.ttsLab.admit({
      idempotency_key: 'tts-1',
      channel_id: CH,
      viewer: { id: '900132', display_name: 'Bob' },
      lab_session_id: 'lab-1',
      text: 'Bouh',
      payment_method: 'tokens',
    });
    await t.dock.scan(CH);
    const first = await t.dock.changes(CH, { after: 0 });
    expect(first.activities.map((a) => a.type)).toEqual(['tts']);
    t.core.clock.advance(5_000);
    await t.dock.scan(CH);
    const next = await t.dock.changes(CH, { after: first.cursor });
    expect(next.activities.map((a) => a.type)).toEqual(['halloween']);
    expect(next.activities[0]!.seq).toBeGreaterThan(first.cursor);
  });

  it('its end updates the same line (no second one); a purchase that never played never shows', async () => {
    const t = await lab();
    await t.buy('blink');
    const c = await t.play();
    t.core.clock.advance(5_000);
    await t.dock.scan(CH);
    await t.shop.ack(c.purchase.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: c.attempt_id,
      event: 'completed',
    });
    await t.dock.scan(CH);
    const lines = await t.halloween();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.state).toMatchObject({ status: 'completed' });
    // Bought, never taken by Studio: failed and refunded by the sweep — never in the dock.
    await t.buy('fog');
    t.core.clock.advance(60_000);
    await t.shop.sweepAll();
    await t.dock.scan(CH);
    expect(await t.halloween()).toHaveLength(1);
  });

  it('the delay is Studio’s: 0 shows it as soon as it starts; 30 s waits 30 s', async () => {
    const t = await lab();
    await t.shop.updateSettings(CH, { rules: { dock_reveal_ms: 0 } });
    await t.buy('blink');
    const c = await t.play();
    await t.dock.scan(CH);
    expect(await t.halloween()).toHaveLength(1);
    await t.shop.ack(c.purchase.purchase_id, {
      studio_instance_id: STUDIO,
      attempt_id: c.attempt_id,
      event: 'completed',
    });
    await t.shop.updateSettings(CH, { rules: { dock_reveal_ms: 30_000 } });
    await t.buy('fog');
    await t.play();
    t.core.clock.advance(29_000);
    await t.dock.scan(CH);
    expect(await t.halloween()).toHaveLength(1);
    t.core.clock.advance(1_000);
    await t.dock.scan(CH);
    expect(await t.halloween()).toHaveLength(2);
  });
});

// 31/10 (before the 24 h live): the screamers' own chain — two viewers, one play at a time (a second purchase is
// refused, never queued nor charged), STOP ALL and failures before / after the start, a dock that reconnects.
describe('Halloween screamers in the dock: who scared me, only after the scare', () => {
  const BOB = { id: '900132', display_name: 'Bob' };
  async function screamers() {
    const t = await lab();
    await t.shop.heartbeat({
      studio_instance_id: STUDIO,
      channel_id: CH,
      engine_ready: true,
      media: ['foxy', 'golden-freddy'],
    });
    await t.shop.grant(
      {
        idempotency_key: randomUUID(),
        channel_id: CH,
        viewer: BOB.id,
        amount: 50,
        reason: 'grant',
      },
      'test',
    );
    const buyAs = (
      viewer: { id: string; display_name: string },
      item_id: string,
    ) =>
      t.shop.purchase({
        idempotency_key: randomUUID(),
        channel_id: CH,
        viewer,
        item_id,
      });
    const balance = async (id: string) =>
      (await t.shop.viewerState(CH, id)).balance;
    const end = (
      c: { purchase: { purchase_id: string }; attempt_id: string },
      event: 'completed' | 'failed',
      started = true,
    ) =>
      t.shop.ack(c.purchase.purchase_id, {
        studio_instance_id: STUDIO,
        attempt_id: c.attempt_id,
        event,
        ...(event === 'failed' ? { error: 'play_failed', started } : {}),
      } as never);
    const lines = async () =>
      (await t.halloween()).map((a) => [
        (a.data as { actor: { name: string } }).actor.name,
        (a.data as { effect: { label: string } }).effect.label,
      ]);
    /** Studio's heartbeat (every few seconds in real life): the engine stays « ready ». */
    const alive = () =>
      t.shop.heartbeat({
        studio_instance_id: STUDIO,
        channel_id: CH,
        engine_ready: true,
        media: ['foxy', 'golden-freddy'],
      });
    return { ...t, buyAs, balance, end, lines, alive };
  }

  it('two viewers: the second is refused while the first is pending (nothing charged); each name appears 5 s after its own start, once', async () => {
    const t = await screamers();
    await t.buyAs(ANA, 's-foxy');
    const bobBefore = await t.balance(BOB.id);
    await expect(t.buyAs(BOB, 's-golden-freddy')).rejects.toMatchObject({
      code: 'busy',
    });
    expect(await t.balance(BOB.id)).toBe(bobBefore);
    const first = await t.play();
    t.core.clock.advance(5_000);
    await t.dock.scan(CH);
    expect(await t.lines()).toEqual([['Ana', 'Foxy']]);
    await t.end(first, 'completed');
    await t.buyAs(BOB, 's-golden-freddy');
    await t.dock.scan(CH);
    expect(await t.lines()).toEqual([['Ana', 'Foxy']]); // Bob's not played yet: not even hinted
    await t.play();
    t.core.clock.advance(4_000);
    await t.dock.scan(CH);
    expect(await t.lines()).toEqual([['Ana', 'Foxy']]);
    t.core.clock.advance(1_000);
    await t.dock.scan(CH);
    expect(await t.lines()).toEqual(
      expect.arrayContaining([
        ['Ana', 'Foxy'],
        ['Bob', 'Golden Freddy'],
      ]),
    );
    expect(await t.lines()).toHaveLength(2);
    // A dock that reconnects (a new reader) reads the same two lines, never a duplicate.
    const again = new DockActivityService(t.core.db, t.core.clock, {
      autoScan: false,
    });
    await again.scan(CH);
    const reread = (await again.recent(CH)).activities.filter(
      (a) => a.type === 'halloween',
    );
    expect(reread).toHaveLength(2);
  });

  it('STOP ALL before the start: refunded, never in the dock; after the start: shown (it was seen), not refunded', async () => {
    const t = await screamers();
    const before = await t.balance(ANA.id);
    await t.buyAs(ANA, 's-foxy');
    await t.shop.stopAll(CH);
    t.core.clock.advance(10_000);
    await t.dock.scan(CH);
    expect(await t.lines()).toEqual([]);
    expect(await t.balance(ANA.id)).toBe(before);
    await t.alive();
    await t.buyAs(ANA, 's-golden-freddy');
    const paid = await t.balance(ANA.id);
    await t.play();
    await t.shop.stopAll(CH);
    t.core.clock.advance(5_000);
    await t.dock.scan(CH);
    expect(await t.lines()).toEqual([['Ana', 'Golden Freddy']]);
    expect(await t.balance(ANA.id)).toBe(paid);
  });

  it('a play that fails before its start is refunded and never shown; one that fails after its start is shown', async () => {
    const t = await screamers();
    const before = await t.balance(ANA.id);
    await t.buyAs(ANA, 's-foxy');
    const c = (await t.shop.claim(STUDIO, CH))!;
    await t.end(c, 'failed', false);
    t.core.clock.advance(10_000);
    await t.dock.scan(CH);
    expect(await t.lines()).toEqual([]);
    expect(await t.balance(ANA.id)).toBe(before);
    await t.alive();
    await t.buyAs(BOB, 's-golden-freddy');
    const started = await t.play();
    await t.end(started, 'failed', true);
    t.core.clock.advance(5_000);
    await t.dock.scan(CH);
    expect(await t.lines()).toEqual([['Bob', 'Golden Freddy']]);
  });
});
