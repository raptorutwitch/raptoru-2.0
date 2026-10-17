import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { setup } from './helpers.js';

// Twitch alerts V1 on the production Core (§ 22): the SAME service and sub-paths as the Lab, under /v1/studio/alerts,
// behind a Studio installation credential, for the Core's single channel; twitch events only from the bot.

const CHANNEL = '83603689';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture(channelId: string | null = CHANNEL) {
  const core = await setup();
  core.clock.set(new Date());
  const server = createApp({
    ...core,
    labRoutes: false,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
    ...(channelId
      ? {
          cockpit: {
            core: () => Promise.reject(new Error('unused')),
            channelId,
          },
        }
      : {}),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  await core.studioInstallations.register(`${id}.${sha256(secret)}`, 'PC test');
  const call = async (
    path: string,
    body?: unknown,
    auth = `Bearer rsi_${id}.${secret}`,
  ) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: auth,
        [STUDIO_PROTOCOL_HEADER]: '1',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
    return { status: res.status, body: (await res.json()) as any };
  };
  return { call };
}

const ev = (over: Record<string, unknown> = {}) => ({
  channel_id: CHANNEL,
  source: 'simulation',
  source_event_id: `sim-${randomUUID()}`,
  type: 'follow',
  actor: { display_name: 'Viewer' },
  ...over,
});

describe('alerts on the production Core (/v1/studio/alerts)', () => {
  it('the whole cycle for the paired Studio: event → state → claim → started → completed; dedup', async () => {
    const { call } = await fixture();
    expect(
      (await call('/v1/studio/alerts/catalog')).body.variants.length,
    ).toBeGreaterThan(10);
    const e = ev({ source_event_id: 'sim-1' });
    const first = await call('/v1/studio/alerts/events', e);
    expect(first).toMatchObject({ status: 200, body: { outcome: 'queued' } });
    expect((await call('/v1/studio/alerts/events', e)).body.outcome).toBe(
      'duplicate',
    );
    // StreamElements donations come from Studio too.
    expect(
      (
        await call(
          '/v1/studio/alerts/events',
          ev({
            source: 'external',
            type: 'donation',
            provider: 'streamelements',
            amount: { value: 420, decimal_place: 2, currency: 'EUR' },
          }),
        )
      ).body.outcome,
    ).toBe('queued');
    expect(
      (await call(`/v1/studio/alerts/${CHANNEL}/state`)).body.queued,
    ).toHaveLength(2);
    const claimed: { alert_id: string; attempt_id: string; family: string }[] =
      [];
    for (let i = 0; i < 3; i++) {
      const { alert } = (
        await call(`/v1/studio/alerts/${CHANNEL}/claim`, {
          consumer_id: 'obs-1',
        })
      ).body;
      if (alert) claimed.push(alert);
    }
    expect(claimed.map((a) => a.family).sort()).toEqual(['donation', 'follow']);
    const a = claimed[0]!;
    for (const event of ['started', 'completed'])
      expect(
        (
          await call(`/v1/studio/alerts/items/${a.alert_id}/ack`, {
            consumer_id: 'obs-1',
            attempt_id: a.attempt_id,
            event,
          })
        ).status,
      ).toBe(200);
    expect(
      (await call(`/v1/studio/alerts/items/${a.alert_id}`)).body.status,
    ).toBe('completed');
  });

  it('refusals: no / bad credential, another channel, twitch events (bot only); no Lab routes on the public Core', async () => {
    const { call } = await fixture();
    expect(
      (
        await call(
          '/v1/studio/alerts/catalog',
          undefined,
          'Bearer studio-test-secret',
        )
      ).status,
    ).toBe(401);
    expect(
      (await call('/v1/studio/alerts/catalog', undefined, '')).status,
    ).toBe(401);
    expect((await call('/v1/studio/alerts/999/state')).body).toMatchObject({
      error: 'wrong_channel',
    });
    expect(
      (await call('/v1/studio/alerts/999/claim', { consumer_id: 'x' })).status,
    ).toBe(409);
    expect(
      (await call('/v1/studio/alerts/events', ev({ channel_id: '999' })))
        .status,
    ).toBe(409);
    expect(
      (await call('/v1/studio/alerts/events', ev({ source: 'twitch' }))).body,
    ).toEqual({
      error: 'twitch_events_from_bot_only',
    });
    expect(
      (
        await call(
          `/v1/lab/alerts/${CHANNEL}/state`,
          undefined,
          'Bearer studio-test-secret',
        )
      ).status,
    ).toBe(404);
  });

  it('without a configured channel the alerts routes are not served', async () => {
    const { call } = await fixture(null);
    expect((await call('/v1/studio/alerts/catalog')).status).toBe(404);
  });
});
