// Music Hub on a real Postgres with real pools (two Cores, docs/music/MUSIC_HUB_STATE.md): the same request key sent to
// both Cores, two requests of one viewer at once against a limit of one, a viewer's withdrawal and a moderator's
// removal of the same request at once — one request, one debit, one refund at most.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import type { SpotifySearchItem, SpotifyStudioStatus } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CpTwitchActions } from '../src/channel-points/twitch-actions.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { labEconomy } from '../src/economy/economy.js';
import { adminAdjust } from '../src/lab-moderation/store.js';
import { SpotifyService } from '../src/spotify/service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const OK: SpotifyStudioStatus = {
  auth: 'ok',
  limited_until: null,
  quota_exceeded: false,
  device: null,
  calls_last_minute: 0,
};
const ITEM = (n: number): SpotifySearchItem => ({
  id: `INTEGRATIONMUSIC${String(n).padStart(6, '0')}`,
  uri: `spotify:track:INTEGRATIONMUSIC${String(n).padStart(6, '0')}`,
  title: `T${n}`,
  artists: ['A'],
  album: null,
  duration_ms: 180_000,
  image_url: null,
  playable: true,
});
const MOD = {
  id: '900102',
  login: 'lab_modo',
  display_name: 'Lab_Modo',
  role: 'moderator' as const,
  via: 'extension' as const,
};

describe.skipIf(!isLocal)('Music Hub on a real Postgres (two Cores)', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-11-08T20:00:00Z'));
  let ch = 800;

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await unlock?.();
  });

  async function twoCores(maxPending = 2) {
    const channel = String(++ch);
    const make = (db: Db) => {
      const s = new SpotifyService(db, clock, new CpTwitchActions(db, clock));
      s.economy = labEconomy;
      return s;
    };
    const A = make(a);
    const B = make(b);
    await A.saveSettings(
      channel,
      {
        enabled: true,
        extension_enabled: true,
        extension_price_tokens: 500,
        max_pending_per_viewer: maxPending,
        viewer_cooldown_seconds: 0,
      },
      'test',
    );
    await A.sync(channel, { status: OK });
    const viewer = { id: '7001', login: 'v7001', name: 'V7001' };
    await a.tx(async (q) => {
      const have = (await labEconomy.balances(q, channel, viewer.id)).tokens;
      await adminAdjust(q, clock.now(), {
        channelId: channel,
        viewerId: viewer.id,
        currency: 'tokens',
        delta: 3_000 - have,
        actor: 'test',
        reason: null,
      });
    });
    const s = await A.extensionSearch(channel, viewer.id, 'titre');
    const job = (await A.sync(channel, { status: OK })).jobs.find(
      (j) => j.job_id === s.search_id,
    )!;
    const attempt_id = randomUUID();
    await A.startJob(channel, job.job_id, attempt_id);
    await A.reportJob(channel, job.job_id, {
      kind: 'search',
      attempt_id,
      outcome: 'done',
      provider: 'lab',
      items: [ITEM(1), ITEM(2)],
    });
    const balance = async () =>
      (await labEconomy.balances(a, channel, viewer.id)).tokens;
    const ask = (S: SpotifyService, n: number, key = randomUUID()) =>
      S.extensionRequest({
        channel_id: channel,
        viewer,
        track_id: ITEM(n).id,
        key,
        expected_price: 500,
      });
    return { channel, A, B, viewer, balance, ask };
  }

  it('moderation refund of the same request on two Cores at once: given back once (post-live 11/11)', async () => {
    const t = await twoCores();
    const r = (await t.ask(t.A, 1)).request;
    // Ended WITHOUT refund (a finished request that was debited): the case of a later manual refund.
    await a.query(
      `update spotify_requests set state = 'REMOVED_BY_MOD' where request_id = $1`,
      [r.request_id],
    );
    expect(await t.balance()).toBe(2_500);
    const out = await Promise.allSettled([
      a.tx((q) =>
        t.A.moderationRefund(q, t.channel, r.request_id, 'mod_a', null),
      ),
      b.tx((q) =>
        t.B.moderationRefund(q, t.channel, r.request_id, 'mod_b', null),
      ),
      a.tx((q) =>
        t.A.moderationRefund(q, t.channel, r.request_id, 'mod_a', null),
      ),
    ]);
    const ok = out.filter(
      (o) => o.status === 'fulfilled' && (o.value as { ok: boolean }).ok,
    );
    expect(ok).toHaveLength(1);
    expect(await t.balance()).toBe(3_000);
    const row = await a.query<{ refund_status: string }>(
      'select refund_status from spotify_requests where request_id = $1',
      [r.request_id],
    );
    expect(row[0]!.refund_status).toBe('refunded');
  });

  it('the same key on two Cores at once: one request, one debit', async () => {
    const t = await twoCores();
    const key = randomUUID();
    const out = await Promise.allSettled([
      t.ask(t.A, 1, key),
      t.ask(t.B, 1, key),
    ]);
    const done = out.filter((o) => o.status === 'fulfilled');
    expect(done.length).toBeGreaterThanOrEqual(1);
    const rows = await a.query(
      `select 1 from spotify_requests where channel_id = $1 and source = 'extension'`,
      [t.channel],
    );
    expect(rows).toHaveLength(1);
    expect(await t.balance()).toBe(2_500);
  });

  it('two requests of one viewer at once against a limit of one: one admitted, one debit', async () => {
    const t = await twoCores(1);
    const out = await Promise.allSettled([t.ask(t.A, 1), t.ask(t.B, 2)]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await t.balance()).toBe(2_500);
  });

  it("a viewer's withdrawal and a moderator's removal at once: one final state, one refund", async () => {
    const t = await twoCores();
    const { request } = await t.ask(t.A, 1);
    expect(await t.balance()).toBe(2_500);
    // Studio adds it to the player's queue (a request still being added cannot be withdrawn: same rule as the reward).
    const job = (await t.A.sync(t.channel, { status: OK })).jobs.find(
      (j) => j.kind === 'song_request',
    )!;
    const attempt_id = randomUUID();
    await t.A.startJob(t.channel, job.job_id, attempt_id);
    await t.A.reportJob(t.channel, job.job_id, {
      kind: 'song_request',
      attempt_id,
      outcome: 'queued',
      track: {
        id: ITEM(1).id,
        uri: ITEM(1).uri,
        title: 'T1',
        artists: ['A'],
        duration_ms: 180_000,
      },
      confirmation: 'http_204',
    });
    await Promise.allSettled([
      t.A.extensionCancel(
        t.channel,
        { id: t.viewer.id, name: t.viewer.name },
        request.request_id,
      ),
      t.B.extensionModerate(
        t.channel,
        MOD,
        { action: 'remove', request_id: request.request_id, refund: true },
        `key-${randomUUID()}`,
      ),
    ]);
    expect(await t.balance()).toBe(3_000);
    const row = (
      await a.query<{ state: string; refund_status: string }>(
        'select state, refund_status from spotify_requests where request_id = $1',
        [request.request_id],
      )
    )[0]!;
    expect(['CANCELED', 'REMOVED_BY_MOD']).toContain(row.state);
    expect(row.refund_status).toBe('refunded');
  });
});
