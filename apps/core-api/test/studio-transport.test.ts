import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/server.js';
import {
  parsePairingCode,
  sha256,
  STUDIO_PROTOCOL_HEADER,
  StudioPairingError,
} from '../src/studio/installations.js';
import { setup, type TestCore } from './helpers.js';

// ASTRA-P1-019 lot 1 — Core side of the future production transport: installation credential,
// protocol version, execution routes bound to the authenticated installation.

const CHANNEL = '900100';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

function newInstallation() {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  return { id, secret, code: `${id}.${sha256(secret)}` };
}

async function fixture() {
  const core = await setup();
  core.clock.set(new Date());
  const server = createApp({
    ...core,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const a = newInstallation();
  await core.studioInstallations.register(a.code, 'PC test');
  const call = async (
    path: string,
    body?: unknown,
    {
      auth = `Bearer rsi_${a.id}.${a.secret}`,
      protocol = '1',
    }: { auth?: string; protocol?: string | null } = {},
  ) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: auth,
        ...(protocol === null ? {} : { [STUDIO_PROTOCOL_HEADER]: protocol }),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
    return { status: res.status, body: (await res.json()) as any };
  };
  return { core, a, call };
}

async function queuedBonk(core: TestCore, key = 'k-1') {
  return (
    await core.bonkLab.admit({
      idempotency_key: key,
      channel_id: CHANNEL,
      viewer: { id: '900101', display_name: 'Viewer Lab' },
      lab_session_id: 'lab-1',
      emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
    })
  ).interaction;
}

const heartbeat = (id: string) => ({
  studio_instance_id: id,
  obs: 'connected' as const,
  source_ready: true,
  overlay_ready: true,
});

describe('Studio installation transport (ASTRA-P1-019 lot 1)', () => {
  it('normal: handshake, heartbeat, claim, ACK started → completed; the delivery belongs to the installation', async () => {
    const { core, a, call } = await fixture();
    expect((await call('/v1/studio/session')).body).toEqual({
      installation_id: a.id,
      protocol: 1,
    });
    expect(
      (await call('/v1/studio/bonk/studio/heartbeat', heartbeat(a.id))).status,
    ).toBe(200);
    const queued = await queuedBonk(core);
    const claim = await call('/v1/studio/bonk/claim', {
      studio_instance_id: a.id,
      channel_id: CHANNEL,
    });
    expect(claim.body.interaction.interaction_id).toBe(queued.interaction_id);
    expect(claim.body.interaction.delivery.studio_instance_id).toBe(a.id);
    const id = queued.interaction_id;
    const attempt = claim.body.interaction.delivery.attempt_id;
    for (const event of ['started', 'completed'])
      expect(
        (
          await call(`/v1/studio/bonk/interactions/${id}/ack`, {
            studio_instance_id: a.id,
            attempt_id: attempt,
            event,
          })
        ).status,
      ).toBe(200);
    expect((await call(`/v1/studio/bonk/interactions/${id}`)).body.status).toBe(
      'completed',
    );
  });

  it('bad credential: refused before any work, no interaction handed out', async () => {
    const { core, a, call } = await fixture();
    await core.bonkLab.heartbeat(heartbeat(a.id));
    await queuedBonk(core);
    const claim = { studio_instance_id: a.id, channel_id: CHANNEL };
    const wrongSecret = `Bearer rsi_${a.id}.${randomBytes(32).toString('base64url')}`;
    const unknownId = `Bearer rsi_${randomUUID()}.${a.secret}`;
    for (const auth of [
      wrongSecret,
      unknownId,
      'Bearer studio-test-secret', // the shared Lab / admin secret never opens these routes
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYnJvYWRjYXN0ZXIifQ.c2ln', // extension-JWT shape
      `Bearer rsi_${a.id}'--.${a.secret}`, // malformed: rejected before SQL
      '',
    ])
      expect(await call('/v1/studio/bonk/claim', claim, { auth })).toEqual({
        status: 401,
        body: { error: 'studio_unauthorized' },
      });
    // Still queued, never claimed.
    expect(
      (await core.bonkLab.recent(CHANNEL, null, 10))[0]!.delivery.attempt_id,
    ).toBeNull();
  });

  it('a body naming another Studio instance is refused (the instance is the credential, not the body)', async () => {
    const { core, call } = await fixture();
    await core.bonkLab.heartbeat(heartbeat('other-studio'));
    await queuedBonk(core);
    const res = await call('/v1/studio/bonk/claim', {
      studio_instance_id: 'other-studio',
      channel_id: CHANNEL,
    });
    expect(res).toEqual({
      status: 403,
      body: { error: 'studio_instance_mismatch' },
    });
  });

  it("an installation cannot read another installation's interaction", async () => {
    const { core, a, call } = await fixture();
    const b = newInstallation();
    await core.studioInstallations.register(b.code, 'Autre PC');
    await core.bonkLab.heartbeat(heartbeat(a.id));
    const queued = await queuedBonk(core);
    await call('/v1/studio/bonk/claim', {
      studio_instance_id: a.id,
      channel_id: CHANNEL,
    });
    const asB = await call(
      `/v1/studio/bonk/interactions/${queued.interaction_id}`,
      undefined,
      {
        auth: `Bearer rsi_${b.id}.${b.secret}`,
      },
    );
    expect(asB).toEqual({
      status: 404,
      body: { error: 'interaction_not_found' },
    });
  });

  it('incompatible protocol: explicit stable error, nothing claimed', async () => {
    const { core, a, call } = await fixture();
    await core.bonkLab.heartbeat(heartbeat(a.id));
    await queuedBonk(core);
    for (const protocol of ['2', '0', 'abc', null])
      expect(
        await call(
          '/v1/studio/bonk/claim',
          { studio_instance_id: a.id, channel_id: CHANNEL },
          { protocol },
        ),
      ).toEqual({
        status: 426,
        body: { error: 'protocol_incompatible', supported: [1] },
      });
    expect(
      (await core.bonkLab.recent(CHANNEL, null, 10))[0]!.delivery.attempt_id,
    ).toBeNull();
  });

  it('revoked: the next call is refused; its unfinished delivery becomes execution_unknown, never replayed', async () => {
    const { core, a, call } = await fixture();
    await call('/v1/studio/bonk/studio/heartbeat', heartbeat(a.id));
    const queued = await queuedBonk(core);
    const claim = await call('/v1/studio/bonk/claim', {
      studio_instance_id: a.id,
      channel_id: CHANNEL,
    });
    await call(`/v1/studio/bonk/interactions/${queued.interaction_id}/ack`, {
      studio_instance_id: a.id,
      attempt_id: claim.body.interaction.delivery.attempt_id,
      event: 'started',
    });
    expect(await core.studioInstallations.revoke(a.id)).toBe(true);
    expect(await core.studioInstallations.revoke(a.id)).toBe(true); // idempotent
    expect(await call('/v1/studio/session')).toEqual({
      status: 401,
      body: { error: 'studio_revoked' },
    });
    // Another (paired) Studio claims: the sweep settles the revoked delivery, nothing is handed out again.
    const b = newInstallation();
    await core.studioInstallations.register(b.code, 'Remplaçant');
    await core.bonkLab.heartbeat(heartbeat(b.id));
    core.clock.advance(1);
    expect(await core.bonkLab.claim(b.id, CHANNEL)).toBeNull();
    expect((await core.bonkLab.get(queued.interaction_id)).status).toBe(
      'execution_unknown',
    );
  });

  it('pairing: invalid codes and a second pairing of the same installation are refused', async () => {
    const { core, a } = await fixture();
    for (const code of [
      '',
      `${a.id}`,
      `${a.id}.xyz`,
      `not-a-uuid.${sha256('x')}`,
      `${a.id}.${sha256('x')}.extra`,
    ])
      expect(() => parsePairingCode(code)).toThrow(StudioPairingError);
    await expect(
      core.studioInstallations.register(a.code, 'Again'),
    ).rejects.toThrow('installation already paired');
    await expect(
      core.studioInstallations.register(newInstallation().code, ' '),
    ).rejects.toThrow(StudioPairingError);
  });
});
