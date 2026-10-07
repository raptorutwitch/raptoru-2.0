// ASTRA-P1-019 (cockpit delta): in the Production profile, the Studio cockpit (Moderation V2, Tombola,
// test wallet) reaches the Production Core over HTTPS with the installation credential — the same Lab
// paths, relayed under /v1/studio/cockpit, for the Core's channel only. Never the Lab chat.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SoundWorker } from '../src/sound-lab/worker.js';
import { StudioTransportError } from '../src/prod-transport/core-client.js';
import { cockpitClient } from '../src/prod-transport/production.js';
import { CHANNEL, pairedStudio, type Cleanups } from './prod-fixture.js';

const cleanups: Cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('Studio cockpit in the Production profile', () => {
  it('reads and commands the Production Core as the broadcaster Studio', async () => {
    const { client } = await pairedStudio(cleanups);
    const cockpit = cockpitClient(client());
    const overview = await cockpit<Record<string, unknown>>(
      `/v1/lab/moderation/${CHANNEL}/overview`,
    );
    expect(overview).toHaveProperty('tts');
    // Test wallet of a viewer (fictitious Jetons), then a credit from the cockpit.
    expect(
      await cockpit<{ tokens: number }>(`/v1/lab/wallet/${CHANNEL}/4242`),
    ).toMatchObject({ tokens: 12_000 });
    await cockpit(`/v1/lab/moderation/${CHANNEL}/actions`, {
      actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
      command: {
        action: 'wallet_adjust',
        viewer_id: '4242',
        currency: 'tokens',
        delta: 1000,
        reason: 'test',
      },
    });
    expect(
      await cockpit<{ tokens: number }>(`/v1/lab/wallet/${CHANNEL}/4242`),
    ).toMatchObject({ tokens: 13_000 });
  });

  it("refuses another channel, the Lab chat and the extension's own entry, with Core's reason", async () => {
    const { client } = await pairedStudio(cleanups);
    const cockpit = cockpitClient(client());
    const refusal = (path: string, body?: unknown) =>
      cockpit(path, body).then(
        () => null,
        (e: StudioTransportError) => ({
          status: e.status,
          error: e.body?.error,
        }),
      );
    expect(await refusal('/v1/lab/moderation/1/overview')).toEqual({
      status: 403,
      error: 'wrong_channel',
    });
    expect(await refusal('/v1/lab/chat', {})).toEqual({
      status: 404,
      error: 'not_found',
    });
    expect(await refusal('/v1/lab/raffle/entries', {})).toEqual({
      status: 404,
      error: 'not_found',
    });
    // Never anything but a Lab cockpit path.
    await expect(cockpit('/v1/studio/session')).rejects.toThrow(
      'lab_route_required',
    );
  });
});

describe('Soundboard config in the Production profile', () => {
  it('reads and edits the bank through the cockpit (the execution transport stays separate)', async () => {
    const { client, dir, installation } = await pairedStudio(cleanups);
    const worker = await SoundWorker.open(join(dir, 'sound.json'), client(), {
      base: '/v1/studio/sound',
      studioId: installation.installationId,
      channel: CHANNEL,
      configBase: '/v1/studio/cockpit/sound',
    });
    const { sounds } = await worker.config();
    expect(sounds.length).toBeGreaterThan(0);
    const updated = await worker.updateSound(sounds[0]!.id, {
      token_cost: 650,
      playback_mode: 'ignore_if_running',
    });
    expect(updated).toMatchObject({
      token_cost: 650,
      playback_mode: 'ignore_if_running',
    });
    expect(
      await worker.updateSettings({ volume_protection: 'medium' }),
    ).toMatchObject({ volume_protection: 'medium' });
    expect(
      (await worker.config()).sounds.find((s) => s.id === sounds[0]!.id),
    ).toMatchObject({ token_cost: 650 });
  });
});
