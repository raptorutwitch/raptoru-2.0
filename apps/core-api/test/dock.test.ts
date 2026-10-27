import { randomUUID } from 'node:crypto';
import type { AlertEventInput } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import type { Db } from '../src/db/db.js';
import { DockActivityService, DockError } from '../src/dock/service.js';
import { dockRoutes } from '../src/http/dock-routes.js';
import { createTestDb, FakeClock } from './helpers.js';

// Dock OBS V1 (docs/OBS_DOCK.md) — the read-only activity projection, its change feed and the visual replay, on the
// test database: every alert event projected (with or without animation), its changes (played, replayed) delivered
// again in commit order, channel points redemptions and their updates, long-poll, reset; the replay queues ONLY a new
// alert item (no other table changes), idempotent per click, one at a time per original, refused when meaningless.

const CH = '900801';
const T0 = new Date('2026-10-27T20:00:00Z');

let db: Db;
let clock: FakeClock;
let alerts: AlertsService;
let dock: DockActivityService;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  alerts = new AlertsService(db, clock, () => 0);
  dock = new DockActivityService(db, clock, { autoScan: false });
});

let n = 0;
const ev = (over: Partial<AlertEventInput> = {}): AlertEventInput => ({
  channel_id: CH,
  source: 'simulation',
  source_event_id: `d-${++n}`,
  type: 'follow',
  actor: { id: '1', login: 'alice', display_name: 'Alice' },
  ...over,
});

/** Claim and finish the next alert as a player would. */
async function play(event: 'completed' | 'failed' = 'completed') {
  const a = (await alerts.claim(CH, 'studio-A'))!;
  await alerts.ack(a.alert_id, {
    consumer_id: 'studio-A',
    attempt_id: a.attempt_id!,
    event: 'started',
  });
  await alerts.ack(a.alert_id, {
    consumer_id: 'studio-A',
    attempt_id: a.attempt_id!,
    event,
  });
  return a;
}

async function redemption(
  id: string,
  status = 'pending',
  over: Record<string, unknown> = {},
) {
  const r = {
    reward_title: 'Hydrate',
    reward_cost: 500,
    user_input: null,
    twitch_status: 'UNFULFILLED',
    reason: null,
    results: '[]',
    ...over,
  };
  await db.query(
    `insert into cp_redemptions (channel_id, source, redemption_id, reward_id, reward_title, reward_cost, user_id,
       user_login, user_name, user_input, twitch_status, redeemed_at, received_at, status, reason, results)
     values ($1, 'simulation', $2, 'rw-1', $3, $4, '7', 'bob', 'Bob', $5, $6, $7, $7, $8, $9, $10)
     on conflict (channel_id, source, redemption_id) do update set status = excluded.status,
       twitch_status = excluded.twitch_status, reason = excluded.reason, results = excluded.results`,
    [
      CH,
      id,
      r.reward_title,
      r.reward_cost,
      r.user_input,
      r.twitch_status,
      clock.now(),
      status,
      r.reason,
      r.results,
    ],
  );
}

describe('projection and feed', () => {
  it('every alert event is projected — with an animation, absorbed or below the threshold — with its display data only', async () => {
    await alerts.receive(ev({ source_event_id: 'f-1' }));
    clock.advance(10);
    await alerts.receive(
      ev({
        source_event_id: 'b-1',
        type: 'bits',
        bits: 1,
        message: '<img src=x onerror=alert(1)>',
      }),
    );
    expect(await dock.scan(CH)).toBe(2);
    const r = await dock.recent(CH);
    expect(r.cursor).toBe(2);
    expect(
      r.activities.map((a) => [a.activity_key, a.type, a.state.outcome]),
    ).toEqual([
      ['alert:simulation:b-1', 'bits', 'below_threshold'],
      ['alert:simulation:f-1', 'follow', 'queued'],
    ]);
    // Viewer text is kept as data (escaped by the dock), never interpreted here; no source internals.
    expect(r.activities[0]!.data).toMatchObject({
      bits: 1,
      message: '<img src=x onerror=alert(1)>',
    });
    expect(r.activities[0]!.data).not.toHaveProperty('channel_id');
    expect(r.activities[0]!.data).not.toHaveProperty('source_event_id');
    // Nothing changed: a second scan writes nothing.
    expect(await dock.scan(CH)).toBe(0);
  });

  it('a change (alert played) comes back in the feed with a new position; nothing older is repeated', async () => {
    await alerts.receive(ev({ source_event_id: 'f-2' }));
    await dock.scan(CH);
    const { cursor } = await dock.recent(CH);
    await play();
    await dock.scan(CH);
    const ch = await dock.changes(CH, { after: cursor });
    expect(ch.activities).toHaveLength(1);
    expect(ch.activities[0]).toMatchObject({
      activity_key: 'alert:simulation:f-2',
      seq: cursor + 1,
      state: { alert_status: 'completed' },
    });
    expect((await dock.changes(CH, { after: ch.cursor })).activities).toEqual(
      [],
    );
  });

  it('channel points: the redemption and every later change of its status', async () => {
    await redemption('r-1', 'pending', { user_input: 'salut <b>toi</b>' });
    await dock.scan(CH);
    const first = await dock.recent(CH);
    expect(first.activities[0]).toMatchObject({
      kind: 'channel_points',
      type: 'reward',
      data: {
        actor: { login: 'bob' },
        reward: { title: 'Hydrate', cost: 500 },
        message: 'salut <b>toi</b>',
      },
      state: { status: 'pending', twitch_status: 'UNFULFILLED' },
    });
    await redemption('r-1', 'done', {
      twitch_status: 'FULFILLED',
      results: '[{"ok":true}]',
    });
    await dock.scan(CH);
    const ch = await dock.changes(CH, { after: first.cursor });
    expect(ch.activities.map((a) => a.state.status)).toEqual(['done']);
  });

  it('long-poll: waits for the next scan that writes something; a cursor ahead of the channel asks for a reset', async () => {
    await dock.scan(CH);
    const { cursor } = await dock.recent(CH);
    const waiting = dock.changes(CH, { after: cursor, waitMs: 5_000 });
    await alerts.receive(ev({ source_event_id: 'f-3' }));
    await dock.scan(CH);
    expect((await waiting).activities.map((a) => a.activity_key)).toEqual([
      'alert:simulation:f-3',
    ]);
    expect(await dock.changes(CH, { after: cursor + 99 })).toMatchObject({
      reset: true,
      activities: [],
    });
    // Nothing new: an empty answer after the wait.
    const t = Date.now();
    expect(
      (await dock.changes(CH, { after: cursor + 1, waitMs: 50 })).activities,
    ).toEqual([]);
    expect(Date.now() - t).toBeGreaterThanOrEqual(40);
  });

  it('pages back into the history (newest first, `before`)', async () => {
    for (let i = 0; i < 5; i++) {
      await alerts.receive(ev({ source_event_id: `p-${i}` }));
      clock.advance(1_000);
    }
    await dock.scan(CH);
    const page1 = await dock.recent(CH, { limit: 2 });
    expect(page1.activities.map((a) => a.activity_key)).toEqual([
      'alert:simulation:p-4',
      'alert:simulation:p-3',
    ]);
    expect(page1.more).toBe(true);
    const page2 = await dock.recent(CH, {
      limit: 2,
      before: {
        at: page1.activities.at(-1)!.occurred_at,
        seq: page1.activities.at(-1)!.seq,
      },
    });
    expect(page2.activities.map((a) => a.activity_key)).toEqual([
      'alert:simulation:p-2',
      'alert:simulation:p-1',
    ]);
  });
});

describe('visual replay: the animation only, never the event', () => {
  /** Rows of every table of the database. */
  async function census() {
    const tables = (
      await db.query<{ t: string }>(
        `select tablename as t from pg_tables where schemaname = 'public' order by 1`,
      )
    ).map((r) => r.t);
    const out: Record<string, number> = {};
    for (const t of tables)
      out[t] = Number(
        (await db.query<{ n: string }>(`select count(*) as n from "${t}"`))[0]!
          .n,
      );
    return out;
  }

  it('a played alert: replayed as a NEW queued item with its frozen variant and data; the original is untouched', async () => {
    const original = (
      await alerts.receive(
        ev({ source_event_id: 's-1', type: 'sub', tier: '1000' }),
      )
    ).alert!;
    await play();
    const before = await census();
    const key = randomUUID();
    const r = await dock.replayAlert(CH, original.alert_id, key);
    expect(r).toMatchObject({ created: true });
    const after = await census();
    // Only the alerts queue (one item) and the replays audit (one row) changed — and the dock projection.
    const changed = Object.keys(after).filter((t) => after[t] !== before[t]);
    expect(changed.sort()).toEqual(
      ['alert_items', 'dock_activity', 'dock_activity_channels', 'dock_replays']
        .filter((t) => changed.includes(t))
        .sort(),
    );
    expect(after.alert_items! - before.alert_items!).toBe(1);
    expect(after.dock_replays! - before.dock_replays!).toBe(1);
    expect(after.alert_events).toBe(before.alert_events);
    const replay = (await alerts.get(r.replay_alert_id))!;
    expect(replay).toMatchObject({
      status: 'queued',
      type: 'sub',
      family: original.family,
      variant_id: original.variant_id,
      data: original.data,
    });
    expect((await alerts.get(original.alert_id)).status).toBe('completed');
    // The player takes it like any alert.
    expect((await alerts.claim(CH, 'studio-A'))!.alert_id).toBe(
      r.replay_alert_id,
    );
  });

  it('the same click twice (or a retried request): one replay; another click while it waits: that same replay', async () => {
    const original = (await alerts.receive(ev({ source_event_id: 's-2' })))
      .alert!;
    await play();
    const key = randomUUID();
    const a = await dock.replayAlert(CH, original.alert_id, key);
    const b = await dock.replayAlert(CH, original.alert_id, key);
    expect(b).toEqual({ replay_alert_id: a.replay_alert_id, created: false });
    const c = await dock.replayAlert(CH, original.alert_id, randomUUID());
    expect(c).toEqual({
      replay_alert_id: a.replay_alert_id,
      created: false,
      already_pending: true,
    });
    expect(
      Number(
        (
          await db.query<{ n: string }>(
            'select count(*) as n from dock_replays',
          )
        )[0]!.n,
      ),
    ).toBe(1);
    // Played: a later, deliberate replay is a new one.
    await play();
    const d = await dock.replayAlert(CH, original.alert_id, randomUUID());
    expect(d.created).toBe(true);
    expect(d.replay_alert_id).not.toBe(a.replay_alert_id);
    // A key never moves to another alert.
    const other = (await alerts.receive(ev({ source_event_id: 's-3' }))).alert!;
    await play();
    await expect(
      dock.replayAlert(CH, other.alert_id, key),
    ).rejects.toMatchObject({ code: 'replay_key_reused' });
  });

  it('refused: the original not played yet, an event without animation, an unknown alert, a replay item itself, another channel', async () => {
    const waiting = (await alerts.receive(ev({ source_event_id: 'w-1' })))
      .alert!;
    await expect(
      dock.replayAlert(CH, waiting.alert_id, randomUUID()),
    ).rejects.toMatchObject({ status: 409, code: 'original_not_played_yet' });
    await play();
    await expect(
      dock.replayAlert(CH, randomUUID(), randomUUID()),
    ).rejects.toBeInstanceOf(DockError);
    const r = await dock.replayAlert(CH, waiting.alert_id, randomUUID());
    await play();
    await expect(
      dock.replayAlert(CH, r.replay_alert_id, randomUUID()),
    ).rejects.toMatchObject({ code: 'alert_not_replayable' });
    await expect(
      dock.replayAlert('900802', waiting.alert_id, randomUUID()),
    ).rejects.toMatchObject({ code: 'alert_not_replayable' });
  });

  it('the dock sees the replay: queued, then played (the original keeps its own status)', async () => {
    const original = (await alerts.receive(ev({ source_event_id: 'v-1' })))
      .alert!;
    await play('failed');
    await dock.scan(CH);
    const { cursor } = await dock.recent(CH);
    const r = await dock.replayAlert(CH, original.alert_id, randomUUID());
    const ch = await dock.changes(CH, { after: cursor });
    expect(ch.activities[0]!.state).toMatchObject({
      alert_status: 'failed',
      replay: { alert_id: r.replay_alert_id, status: 'queued', count: 1 },
    });
    await play();
    await dock.scan(CH);
    expect(
      (await dock.changes(CH, { after: ch.cursor })).activities[0]!.state,
    ).toMatchObject({
      alert_status: 'failed',
      replay: { status: 'completed', count: 1 },
    });
  });
});

describe('routes', () => {
  const call = async (
    routes: ReturnType<typeof dockRoutes>,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ) => {
    const url = new URL(`http://core${path}`);
    for (const r of routes) {
      const m = r.method === method ? r.pattern.exec(url.pathname) : null;
      if (m) return r.handle({ params: m.slice(1), body, url });
    }
    throw new Error(`no route ${method} ${path}`);
  };

  it('production: the installation credential, its channel only; queries and the replay body are validated', async () => {
    const routes = dockRoutes(dock, { channelId: CH });
    expect(routes.every((r) => r.auth === 'studio_installation')).toBe(true);
    await expect(
      call(routes, 'GET', `/v1/studio/dock/900802/activity`),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      call(routes, 'GET', `/v1/studio/dock/${CH}/changes?after=-1`),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      call(routes, 'GET', `/v1/studio/dock/${CH}/activity?before=nope`),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      call(
        routes,
        'POST',
        `/v1/studio/dock/${CH}/alerts/${randomUUID()}/replay`,
        { replay_key: 'x' },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      call(
        routes,
        'POST',
        `/v1/studio/dock/${CH}/alerts/${randomUUID()}/replay`,
        { replay_key: randomUUID(), economy: true },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      call(
        routes,
        'POST',
        `/v1/studio/dock/${CH}/alerts/${randomUUID()}/replay`,
        { replay_key: randomUUID() },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await call(routes, 'GET', `/v1/studio/dock/${CH}/changes?after=0`),
    ).toMatchObject({ cursor: 0, activities: [] });
    // The Lab: the Studio secret, any channel.
    expect(dockRoutes(dock).every((r) => r.auth === 'studio')).toBe(true);
  });
});
