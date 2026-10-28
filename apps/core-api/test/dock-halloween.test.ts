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
