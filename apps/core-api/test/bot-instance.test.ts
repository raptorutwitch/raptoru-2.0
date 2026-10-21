import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { BOT_INSTANCE_HEADER, type BotLeaseRequest } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { setup } from './helpers.js';

// Single active production bot (plan post-live lot 1): one lease, renewed with the health; anyone else waits.

const req = (
  instanceId: string,
  over: Partial<BotLeaseRequest> = {},
): BotLeaseRequest => ({
  instanceId,
  host: instanceId.startsWith('pc') ? 'pc' : 'vps',
  version: 'test-1',
  startedAt: '2026-10-21T10:00:00.000Z',
  health: {
    eventSubBot: true,
    eventSubBroadcaster: true,
    broadcasterToken: true,
  },
  flags: { CHAT_GAMES: true, ALERTS_MODE: 'active' },
  ...over,
});

describe('bot lease (BotInstanceService)', () => {
  it('first instance gets it; a second waits (standby, holder named) while the first renews', async () => {
    const core = await setup();
    const a = await core.botInstances.lease(req('pc-1'));
    expect(a.granted).toBe(true);
    expect(a.holder.instanceId).toBe('pc-1');
    expect(a.ttlSeconds).toBe(45);
    expect(a.renewSeconds).toBe(15);

    const b = await core.botInstances.lease(req('vps-1'));
    expect(b.granted).toBe(false);
    expect(b.holder).toMatchObject({ instanceId: 'pc-1', host: 'pc' });

    core.clock.advance(15_000);
    expect((await core.botInstances.lease(req('pc-1'))).granted).toBe(true);
    core.clock.advance(40_000); // 55 s after the first grant, 40 s after the renewal: still held
    expect((await core.botInstances.lease(req('vps-1'))).granted).toBe(false);
  });

  it('a renewal keeps its start; a takeover after expiry starts at the takeover', async () => {
    const core = await setup();
    const first = await core.botInstances.lease(req('pc-1'));
    core.clock.advance(15_000);
    const renewed = await core.botInstances.lease(req('pc-1'));
    expect(renewed.holder.since).toBe(first.holder.since);

    core.clock.advance(46_000); // no renewal for 46 s: free
    const takeover = await core.botInstances.lease(req('vps-1'));
    expect(takeover.granted).toBe(true);
    expect(takeover.holder.since).toBe(core.clock.now().toISOString());
    // The old holder comes back: it must wait now.
    expect((await core.botInstances.lease(req('pc-1'))).granted).toBe(false);
  });

  it('release frees the lease at once (clean stop); a non-holder releases nothing', async () => {
    const core = await setup();
    await core.botInstances.lease(req('pc-1'));
    expect(await core.botInstances.release('vps-1')).toEqual({
      released: false,
    });
    expect((await core.botInstances.lease(req('vps-1'))).granted).toBe(false);
    expect(await core.botInstances.release('pc-1')).toEqual({ released: true });
    expect((await core.botInstances.lease(req('vps-1'))).granted).toBe(true);
  });

  it('the same instance id restarting (same container) keeps the lease', async () => {
    const core = await setup();
    await core.botInstances.lease(req('vps-1'));
    core.clock.advance(5_000);
    const again = await core.botInstances.lease(
      req('vps-1', { startedAt: core.clock.now().toISOString() }),
    );
    expect(again.granted).toBe(true);
  });

  it('two instances asking at the same time: exactly one wins', async () => {
    const core = await setup();
    const results = await Promise.all(
      ['pc-1', 'vps-1', 'vps-2'].map((id) => core.botInstances.lease(req(id))),
    );
    expect(results.filter((r) => r.granted)).toHaveLength(1);
    const winner = results.find((r) => r.granted)!.holder.instanceId;
    for (const r of results) expect(r.holder.instanceId).toBe(winner);
  });

  it('status: none → active (health, flags) with a recent standby → stale after expiry', async () => {
    const core = await setup();
    expect(await core.botInstances.status()).toMatchObject({
      state: 'none',
      active: null,
      standby: [],
    });

    await core.botInstances.lease(req('vps-1'));
    await core.botInstances.lease(req('pc-1'));
    const s = await core.botInstances.status();
    expect(s.state).toBe('active');
    expect(s.active).toMatchObject({
      instanceId: 'vps-1',
      host: 'vps',
      version: 'test-1',
      health: {
        eventSubBot: true,
        eventSubBroadcaster: true,
        broadcasterToken: true,
      },
      flags: { CHAT_GAMES: true, ALERTS_MODE: 'active' },
    });
    expect(s.standby).toEqual([
      expect.objectContaining({ instanceId: 'pc-1', host: 'pc' }),
    ]);

    core.clock.advance(3 * 60_000); // nobody renews: lease expired, the standby too old to list
    const later = await core.botInstances.status();
    expect(later.state).toBe('stale');
    expect(later.active?.instanceId).toBe('vps-1'); // last known holder, for « dernier signe de vie »
    expect(later.standby).toEqual([]);
  });

  it('after a clean release: no active bot, the instance shows as gone', async () => {
    const core = await setup();
    await core.botInstances.lease(req('vps-1'));
    await core.botInstances.release('vps-1');
    const s = await core.botInstances.status();
    expect(s.state).toBe('stale');
    expect(s.active).toBeNull();
    // Still known: Studio says « arrêté proprement à … » rather than « aucun bot ».
    expect(s.lastSeen).toMatchObject({
      instanceId: 'vps-1',
      host: 'vps',
      state: 'released',
    });
  });

  it('lastSeen: none before any bot; then the most recent instance', async () => {
    const core = await setup();
    expect((await core.botInstances.status()).lastSeen).toBeNull();
    await core.botInstances.lease(req('pc-1'));
    core.clock.advance(1_000);
    await core.botInstances.lease(req('vps-1')); // refused: standby, but seen last
    expect((await core.botInstances.status()).lastSeen).toMatchObject({
      instanceId: 'vps-1',
      state: 'standby',
    });
  });
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture() {
  const core = await setup();
  core.clock.set(new Date());
  const server = createApp({
    ...core,
    labRoutes: false,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  await core.studioInstallations.register(`${id}.${sha256(secret)}`, 'PC test');
  const call = async (
    path: string,
    auth: string,
    body?: unknown,
    instance?: string,
  ) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: auth,
        ...(instance ? { [BOT_INSTANCE_HEADER]: instance } : {}),
        [STUDIO_PROTOCOL_HEADER]: '1',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
    return { status: res.status, body: (await res.json()) as any };
  };
  return {
    core,
    call,
    bot: 'Bearer bot-test-secret',
    studio: `Bearer rsi_${id}.${secret}`,
  };
}

describe('bot lease routes', () => {
  it('bot secret only for the lease; installation only for the status; never a secret in the answers', async () => {
    const { call, bot, studio } = await fixture();
    expect(
      (await call('/v1/bot/instance/lease', studio, req('vps-1'))).status,
    ).toBe(401);
    const granted = await call('/v1/bot/instance/lease', bot, req('vps-1'));
    expect(granted.status).toBe(200);
    expect(granted.body.granted).toBe(true);

    expect((await call('/v1/studio/status/bot', bot)).status).toBe(401);
    const status = await call('/v1/studio/status/bot', studio);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      state: 'active',
      active: { instanceId: 'vps-1' },
    });
    expect(JSON.stringify(status.body)).not.toContain('bot-test-secret');

    const released = await call('/v1/bot/instance/release', bot, {
      instanceId: 'vps-1',
    });
    expect(released.body).toEqual({ released: true });
  });

  it('refuses a malformed report: secret-like flag values, unknown hosts, long ids', async () => {
    const { call, bot } = await fixture();
    for (const bad of [
      req('vps-1', { flags: { BOT_SECRET: 'abc123XYZ' } }),
      req('vps-1', { host: 'My PC' }),
      req('x'.repeat(200)),
    ]) {
      expect((await call('/v1/bot/instance/lease', bot, bad)).status).toBe(400);
    }
  });

  it('server-side fencing: with a live lease, the bot routes answer its holder only', async () => {
    const { core, call, bot } = await fixture();
    const sync = (instance?: string) =>
      call('/v1/bot/stream/sync', bot, { live: null }, instance);

    // No lease yet (today's bot, unnamed): nothing to protect, it passes.
    expect((await sync()).status).toBe(200);

    await call('/v1/bot/instance/lease', bot, req('vps-1'));
    expect((await sync('vps-1')).status).toBe(200);
    const other = await sync('pc-1');
    expect(other.status).toBe(409);
    expect(other.body).toEqual({ error: 'not_lease_holder', holder: 'vps-1' });
    expect((await sync()).status).toBe(409); // an unnamed (older) bot neither
    // The lease routes stay open to everyone (that is how a standby instance waits).
    const standby = await call('/v1/bot/instance/lease', bot, req('pc-1'));
    expect(standby.status).toBe(200);
    expect(standby.body.granted).toBe(false);

    // Expired (holder silent for > 45 s): nobody is protected any more.
    core.clock.advance(46_000);
    expect((await sync('pc-1')).status).toBe(200);
    // A new holder: the old one is now the fenced one.
    await call('/v1/bot/instance/lease', bot, req('pc-1'));
    expect((await sync('vps-1')).status).toBe(409);
    // Released: open again.
    await call('/v1/bot/instance/release', bot, { instanceId: 'pc-1' });
    expect((await sync()).status).toBe(200);
  });

  it('deploy window (code deployed before its migration): no bot_lease table → bot routes still served', async () => {
    const { core, call, bot } = await fixture();
    await core.db.query('drop table bot_lease');
    const r = await call('/v1/bot/stream/sync', bot, { live: null });
    expect(r.status).toBe(200);
    expect(
      (await call('/v1/bot/stream/sync', bot, { live: null }, 'pc-1')).status,
    ).toBe(200);
  });
});
