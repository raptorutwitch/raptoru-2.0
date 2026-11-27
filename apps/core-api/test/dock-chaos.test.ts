import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { EFFECTS } from '../src/chaos/catalog.js';
import { CHAOS_RULES } from '../src/chaos/service.js';
import { DockActivityService } from '../src/dock/service.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { createTestDb, setup } from './helpers.js';

// Chaos V2 in the OBS dock (docs/OBS_DOCK.md): one line per purchase from the extension — the viewer, the effect and
// the choice as bought, its price and duration — whose state follows the real request (waiting, playing, played,
// interrupted, not played) and its refund, always on that SAME line (never a second activity). Read only.

const CH = '900700';
const STUDIO = 'studio-dock';
const ANA = { id: '900701', display_name: 'Ana' };
const ALL = Object.fromEntries(EFFECTS.map((e) => [e.id, { enabled: true }]));

async function lab() {
  const core = await setup();
  core.clock.set(new Date('2026-11-27T20:00:00Z'));
  await core.moduleSettings.set(CH, 'chaos.enabled', 1, 'test');
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    ANA.id,
    'set',
    { tokens: 5_000_000 },
    'test',
  );
  const chaos = core.chaos;
  const hb = () =>
    chaos.heartbeat(CH, {
      studio_instance_id: STUDIO,
      engine_ready: true,
      safety_max_ms: 60_000,
      safe_mode: false,
      effects: ALL,
      inflight: [],
    });
  await hb();
  const buy = async (effect: string, choice: Record<string, unknown>) => {
    const { price } = await chaos.quote(CH, ANA, { effect, choice });
    return chaos.buy(CH, {
      viewer: ANA,
      idempotency_key: randomUUID(),
      effect,
      choice,
      expected_price: price,
    });
  };
  const claim = () =>
    chaos.claim(
      CH,
      STUDIO,
      EFFECTS.map((e) => e.id),
    );
  const ack = (
    item: { id: string; attempt_id: string },
    event: 'started' | 'ended',
    extra = {},
  ) =>
    chaos.ack(CH, item.id, {
      studio_instance_id: STUDIO,
      attempt_id: item.attempt_id,
      event,
      ...extra,
    });
  const dock = new DockActivityService(core.db, core.clock, {
    autoScan: false,
  });
  const lines = async () => {
    await dock.scan(CH);
    return (await dock.recent(CH)).activities.filter((a) => a.type === 'chaos');
  };
  return { core, chaos, hb, buy, claim, ack, dock, lines };
}

beforeAll(() => createTestDb(), 180_000);

describe('Chaos purchases in the OBS dock', () => {
  it('one line per purchase: viewer, effect, choice, price and duration; waiting → playing → played on the same line', async () => {
    const l = await lab();
    const bought = await l.buy('blink', {
      style: 'fatigue',
      level: 'extreme',
      duration: 10,
    });
    const id = bought.request.id;
    const [line] = await l.lines();
    expect(line).toMatchObject({
      activity_key: `ix:chaos:${id}`,
      kind: 'interaction',
      type: 'chaos',
      data: {
        actor: { id: ANA.id, name: 'Ana' },
        effect: { id: 'blink', label: 'Paupières' },
        choice: { style: 'fatigue', level: 'extreme' },
        duration_s: 10,
        price: bought.request.price,
        payment: 'jetons',
      },
      state: { status: 'chaos_queued', refund_status: 'none' },
    });
    expect(line!.data.price).toBeGreaterThan(0);
    const { item } = await l.claim();
    expect((await l.lines())[0]!.state.status).toBe('chaos_queued');
    await l.ack(item!, 'started');
    expect(await l.lines()).toMatchObject([
      { activity_key: `ix:chaos:${id}`, state: { status: 'chaos_playing' } },
    ]);
    l.core.clock.advance(item!.duration_ms);
    await l.ack(item!, 'ended', {
      code: 'duration',
      played_ms: item!.duration_ms,
    });
    const after = await l.lines();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      activity_key: `ix:chaos:${id}`,
      state: { status: 'chaos_played', refund_status: 'none' },
    });
    expect(after[0]!.seq).toBeGreaterThan(line!.seq);
    // Nothing new: no second scan of the same state.
    expect(await l.dock.scan(CH)).toBe(0);
  });

  it('interrupted early (a breakdown): « interrupted » and refunded on that line; never claimed in time: not played, refunded', async () => {
    const l = await lab();
    const broken = await l.buy('color', { style: 'sepia', duration: 20 });
    const { item } = await l.claim();
    await l.ack(item!, 'started');
    l.core.clock.advance(2000);
    await l.ack(item!, 'ended', { code: 'engine_exit', played_ms: 2000 });
    const expired = await l.buy('vhs', {});
    l.core.clock.advance(CHAOS_RULES.queueTtlMs + 1);
    await l.hb();
    const byId = Object.fromEntries(
      (await l.lines()).map((a) => [a.activity_key, a.state]),
    );
    expect(Object.keys(byId)).toHaveLength(2);
    expect(byId[`ix:chaos:${broken.request.id}`]).toEqual({
      status: 'chaos_interrupted',
      refund_status: 'refunded',
    });
    expect(byId[`ix:chaos:${expired.request.id}`]).toEqual({
      status: 'chaos_unplayed',
      refund_status: 'refunded',
    });
    // The dock only reads: one projection row per purchase.
    expect(
      (
        await l.core.db.query<{ n: number }>(
          "select count(*)::int as n from dock_activity where activity_key like 'ix:chaos:%'",
        )
      )[0]!.n,
    ).toBe(2);
  });
});
