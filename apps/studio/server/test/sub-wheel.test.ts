import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { subWheelAmount, subWheelLayout } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import type { ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import type { EffectsPlayer } from '../src/effects/player.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';
import { subWheelView } from '../../web/src/sub-wheel-view.js';

// Roue du Sub (docs/SUB_WHEEL.md) — the Lab chain with the REAL Lab Core and Studio's runtime with a simulated effects
// player (the page itself is covered by Playwright): a Twitch sub → its alert → its wheel, after the alert, with the
// result Core recorded; one wheel per event; tests never owe a gain; no player → the gain stays as recorded.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const CH = '900100';

async function lab(effectsOn = true) {
  const db = createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
  await migrate(db, 'lab');
  const secret = randomBytes(32).toString('hex');
  const server: Server = createLabCore({
    db,
    clock: systemClock,
    secret,
  }).server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir = await mkdtemp(join(tmpdir(), 'sw-'));
  cleanups.push(async () => {
    server.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const core = localLabCoreClient(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    secret,
  );
  const shown: Record<string, unknown>[] = [];
  const effects = {
    status: () => ({
      url: '',
      connected: true,
      audio: true,
      current: true,
      playing: 0,
    }),
    play: async (e: Record<string, unknown>) => {
      shown.push(e);
      return { end: Promise.resolve({ event: 'completed' as const }) };
    },
    handle: async () => false,
    sounds: () => [],
    videos: () => [],
    interactionMedia: () => [],
  } as unknown as EffectsPlayer;
  const obs: ObsLike = { connected: true, request: async () => ({}) };
  const rt = await ChannelPointsRuntime.create({
    core,
    environment: 'lab',
    channelId: CH,
    origin: 'http://127.0.0.1:1',
    dir,
    obs: () => obs,
    effects: effectsOn ? effects : null,
    twitch: () => ({ scope: true, adapter_running: true }),
  });
  /** The alerts OBS source playing the sub alert to its end. */
  const playAlert = async () => {
    const c = await core<{
      alert: { alert_id: string; attempt_id: string } | null;
    }>(`/v1/lab/alerts/${CH}/claim`, { consumer_id: 'alerts-page' });
    if (!c.alert) return false;
    for (const event of ['started', 'completed'])
      await core(`/v1/lab/alerts/items/${c.alert.alert_id}/ack`, {
        consumer_id: 'alerts-page',
        attempt_id: c.alert.attempt_id,
        event,
      });
    return true;
  };
  const sub = (over: Record<string, unknown> = {}) =>
    core('/v1/lab/alerts/events', {
      channel_id: CH,
      source: 'twitch',
      source_event_id: randomUUID(),
      type: 'resub',
      actor: { id: '9001', login: 'viewer', display_name: 'Viewer' },
      tier: '2000',
      months: 14,
      ...over,
    });
  const state = () =>
    core<{
      recent: Record<string, unknown>[];
      pending_awards: { count: number; total: number };
    }>(`/v1/lab/sub-wheel/${CH}/state`);
  return { core, rt, shown, playAlert, sub, state };
}

describe('Roue du Sub — Lab chain (real Lab Core, Studio runtime, simulated player)', () => {
  it('a real resub: its alert first, then ONE wheel with the recorded result; redelivered event: nothing more', async () => {
    const l = await lab();
    await l.core(`/v1/lab/sub-wheel/${CH}/settings`, { enabled: true });
    const id = randomUUID();
    await l.sub({ source_event_id: id });
    await l.sub({ source_event_id: id });
    // The wheel waits for the sub alert.
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(await l.playAlert()).toBe(true);
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(l.shown).toHaveLength(1);
    const spin = l.shown[0]!.spin as {
      segment: number;
      amount: number;
      layout: unknown;
    };
    expect(l.shown[0]).toMatchObject({
      kind: 'wheel',
      spin: { name: 'Viewer', type: 'resub', tier: 2, months: 14 },
    });
    expect(spin.layout).toEqual(subWheelLayout(14));
    expect(spin.amount).toBe(subWheelAmount(14, 2, spin.segment));
    const s = await l.state();
    expect(s.recent).toHaveLength(1);
    expect(s.recent[0]).toMatchObject({
      status: 'shown',
      amount: spin.amount,
      award: { status: 'awarded' },
    });
    // The Lab Core credits the Lab test wallet (test data): nothing left to attribute.
    expect(s.pending_awards).toEqual({ count: 0, total: 0 });
  });

  it('switch OFF (default): a real sub is only noted; the Studio test (animation, full) shows a wheel without any gain', async () => {
    const l = await lab();
    await l.sub({ type: 'sub' });
    await l.playAlert();
    expect(await l.rt.subWheel.once()).toBe(false);
    expect((await l.state()).recent[0]).toMatchObject({
      status: 'ignored',
      amount: null,
    });
    const api = (path: string, body: object) =>
      l.rt.subWheel.api(
        'POST',
        path,
        async () => body as Record<string, unknown>,
      );
    await api('/test', { name: 'Raptoru_', tier: 3, months: 20 });
    expect(await l.rt.subWheel.once()).toBe(true);
    expect(l.shown[0]).toMatchObject({
      kind: 'wheel',
      spin: { name: 'Raptoru_', tier: 3, months: 20 },
    });
    await api('/test', { full: true, name: 'Full', months: 2 });
    expect(await l.rt.subWheel.once()).toBe(false); // its simulated sub alert first
    expect(await l.playAlert()).toBe(true);
    expect(await l.rt.subWheel.once()).toBe(true);
    const s = await l.state();
    expect(s.pending_awards.count).toBe(0);
    expect(
      s.recent.filter((r) => (r.award as { status: string }).status === 'test'),
    ).toHaveLength(2);
  });

  it('no effects player: nothing is claimed — the wheel waits in the queue, its gain recorded, never reported « not shown »', async () => {
    const l = await lab(false);
    await l.core(`/v1/lab/sub-wheel/${CH}/settings`, { enabled: true });
    await l.sub();
    await l.playAlert();
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(await l.rt.subWheel.once()).toBe(false);
    expect(l.rt.subWheel.waiting).toBe('effects_player_unavailable');
    const r = (await l.state()).recent[0]!;
    expect(r).toMatchObject({
      status: 'queued',
      reason: null,
      award: { status: 'awarded' },
    });
  });
});

describe('Roue du Sub — Studio section (pure view)', () => {
  it('switch, pending gains, escaped names, results, test rows, reconciliation buttons only for pending gains', () => {
    const state = {
      settings: { enabled: false },
      waiting: 1,
      pending_awards: { count: 1, total: 18000 },
      effects: {
        connected: true,
        current: true,
        media: [
          {
            id: 'sw-fin',
            label: 'Roue du Sub — fin casino',
            available: false,
          },
        ],
      },
      recent: [
        {
          spin_id: '11111111-1111-4111-8111-111111111111',
          source: 'twitch',
          type: 'resub',
          viewer: { name: '<b>V</b>' },
          tier: 3,
          months: 12,
          status: 'shown',
          reason: null,
          segment: 11,
          amount: 18000,
          award: { status: 'pending', ref: null, note: null },
          created_at: '2026-10-18T20:00:00.000Z',
        },
        {
          spin_id: '22222222-2222-4222-8222-222222222222',
          source: 'test',
          type: 'sub',
          viewer: { name: 'T' },
          tier: 1,
          months: 1,
          status: 'ignored',
          reason: 'disabled',
          segment: null,
          amount: null,
          award: { status: 'test', ref: null, note: null },
          created_at: '2026-10-18T20:00:01.000Z',
        },
      ],
    } as const;
    // R4: the rows are in « Historique », the switch in « Réglages ».
    const html = subWheelView(state as never, null, {
      tab: 'history',
    });
    expect(html).toContain('Roue : désactivée');
    expect(subWheelView(state as never, null, { tab: 'settings' })).toContain(
      'Activer la roue',
    );
    expect(html).toContain('1 gain(s) à attribuer : 18');
    expect(html).toContain('Médias non importés : Roue du Sub — fin casino');
    expect(html).toContain('&lt;b&gt;V&lt;/b&gt;');
    expect(html).not.toContain('<b>V</b>');
    expect(html).toContain('resub · T3 · 12 mois');
    expect(html).toContain('(segment 12)');
    expect(html).toContain('Gain en attente d’attribution');
    expect(html.match(/data-act="sw-manual"/g)).toHaveLength(1);
    expect(html).toContain('Test : aucun gain');
  });
});
