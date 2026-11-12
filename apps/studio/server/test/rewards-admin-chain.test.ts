import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { createCpTwitchActionsExecutor } from '../../../twitch-bot/src/cp-twitch-actions-executor.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Récompenses Twitch — the whole chain without Twitch (docs/RECOMPENSES_TWITCH.md): Studio's API → the real
// Lab Core (HTTP) → the bot's Twitch actions executor on a FAKE Twitch → back to Studio's state. A migration of the old
// « Ban aléatoire »: the new reward, its rule copied OFF; then a pause; then a refund — each sent to « Twitch » ONCE.

const CH = '900100';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function chain() {
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
  const coreUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await mkdtemp(join(tmpdir(), 'rwa-'));
  cleanups.push(async () => {
    server.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const core = localLabCoreClient(coreUrl, secret);
  let rt: ChannelPointsRuntime | null = null;
  const studio = createServer((req, res) => {
    void rt!.handle(req, res, new URL(req.url!, origin)).then((d) => {
      if (!d) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => studio.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => studio.close(() => r(undefined))));
  const origin = `http://127.0.0.1:${(studio.address() as AddressInfo).port}`;
  rt = await ChannelPointsRuntime.create({
    core,
    environment: 'lab',
    channelId: CH,
    origin,
    dir,
    obs: () => null,
    effects: null,
    twitch: () => ({ scope: true, adapter_running: true }),
  });
  const api = async (path: string, body?: unknown) => {
    const res = await fetch(`${origin}/api/channel-points${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  // The bot: its Twitch actions executor (the real one), on a fake Twitch that records each call.
  const calls: string[] = [];
  const bot = createCpTwitchActionsExecutor({
    core: async (path, body) => {
      const res = await fetch(new URL(path, coreUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as unknown };
    },
    base: '/v1/lab/channel-points/twitch-actions',
    channelId: CH,
    scopes: ['channel:manage:redemptions'],
    twitch: {
      updateRedemptionStatus: async (reward, redemption, status) =>
        void calls.push(`status ${reward} ${redemption} ${status}`),
      createCustomReward: async (r) => {
        calls.push(`create ${r.title} ${r.cost}`);
        return 'raptoru-rb-1';
      },
      updateCustomReward: async (reward, patch) =>
        void calls.push(`update ${reward} ${JSON.stringify(patch)}`),
    },
    pause: async () => {},
    log: () => {},
  });
  // Twitch's list, as the bot syncs it: the old SAMMI reward, which Raptoru may not manage.
  await core('/v1/lab/channel-points/rewards', {
    channel_id: CH,
    rewards: [
      {
        id: 'old-ban-aleatoire',
        title: 'Ban aléatoire',
        cost: 3000,
        is_enabled: true,
        manageable: false,
      },
    ],
  });
  await core(`/v1/lab/channel-points/${CH}/rules/old-ban-aleatoire`, {
    enabled: true,
    actions: [{ type: 'interaction', interaction: 'random_ban' }],
  });
  return { api, bot, calls, core };
}

describe('Récompenses Twitch — Studio → Lab Core → bot executor (fake Twitch)', () => {
  it('migrate Random Ban, pause, refund: each one Twitch call, the state follows; the old reward is never touched', async () => {
    const c = await chain();
    let s = (await c.api('/state')).body;
    expect(s.rewards[0]).toMatchObject({
      id: 'old-ban-aleatoire',
      managed: false,
    });
    // Not ours: no pause possible.
    expect(
      (
        await c.api('/rewards/old-ban-aleatoire/twitch', {
          patch: { is_paused: true },
        })
      ).body,
    ).toMatchObject({
      error: 'reward_not_managed',
    });
    // The same title: refused before asking Twitch.
    expect(
      (
        await c.api('/rewards', {
          title: 'Ban aléatoire',
          cost: 3000,
          migrated_from: 'old-ban-aleatoire',
        })
      ).body,
    ).toMatchObject({ error: 'reward_title_taken' });
    expect(
      (
        await c.api('/rewards', {
          title: 'Random Ban',
          cost: 3000,
          prompt: 'Un viewer au hasard',
          migrated_from: 'old-ban-aleatoire',
        })
      ).status,
    ).toBe(200);
    expect(await c.bot.tick()).toBe('worked');
    s = (await c.api('/state')).body;
    const created = s.rewards.find(
      (r: { id: string }) => r.id === 'raptoru-rb-1',
    );
    expect(created).toMatchObject({
      managed: true,
      migrated_from: 'old-ban-aleatoire',
      cost: 3000,
      rule: {
        enabled: false,
        actions: [{ type: 'interaction', interaction: 'random_ban' }],
      },
    });
    // Pause, then resume.
    await c.api('/rewards/raptoru-rb-1/twitch', { patch: { is_paused: true } });
    await c.bot.tick();
    s = (await c.api('/state')).body;
    expect(
      s.rewards.find((r: { id: string }) => r.id === 'raptoru-rb-1'),
    ).toMatchObject({ paused: true });
    // A real redemption of the new reward while its rule is still OFF (the migration's copy): refunded at once by the
    // Core (never points kept for nothing); a refund by hand from Studio then finds it done — one CANCELED only.
    const redemption = randomUUID();
    await c.core('/v1/lab/channel-points/redemptions', {
      channel_id: CH,
      source: 'twitch',
      redemption_id: redemption,
      reward: { id: 'raptoru-rb-1', title: 'Random Ban', cost: 3000 },
      user: { id: '9001', login: 'kiwi', display_name: 'Kiwi' },
      twitch_status: 'unfulfilled',
      redeemed_at: new Date().toISOString(),
    });
    expect(
      (await c.api(`/redemptions/twitch/${redemption}/refund`, {})).body,
    ).toMatchObject({ status: 'exists' });
    await c.bot.tick();
    expect(await c.bot.tick()).toBe('idle');
    expect(c.calls).toEqual([
      'create Random Ban 3000',
      'update raptoru-rb-1 {"is_paused":true}',
      `status raptoru-rb-1 ${redemption} CANCELED`,
    ]);
    s = (await c.api('/state')).body;
    expect(s.twitch_actions.map((a: { status: string }) => a.status)).toEqual([
      'done',
      'done',
      'done',
    ]);
    expect(
      s.rewards.find((r: { id: string }) => r.id === 'old-ban-aleatoire'),
    ).toMatchObject({
      managed: false,
      rule: { enabled: true },
    });
  }, 30_000);
});
