import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../core-api/src/http/server.js';
import { count, setup } from '../../../core-api/test/helpers.js';
import {
  localSoundCoreClient,
  SoundWorker,
  type SoundCoreCall,
} from '../src/sound-lab/worker.js';
import { LabEbs } from '../src/extension-lab/lab-ebs.js';
import { EXTENSION_DIR } from '../src/index.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const core = await setup();
  core.clock.set(new Date());
  const server = createApp({
    ...core,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const dir = await mkdtemp(join(process.cwd(), '.runtime-sound-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'journal.json');
  const client = localSoundCoreClient(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    'studio-test-secret',
  );
  const worker = await SoundWorker.open(file, client);
  const ready = async (w = worker, player = 'player-1') => {
    await w.playerHeartbeat(player, true);
    await w.tick();
  };
  const admit = (key: string, soundId = 'boop', w = worker) =>
    w.admit(
      { id: '900101', display_name: 'Viewer Lab' },
      key,
      soundId,
      'tokens',
    );
  return { core, worker, client, file, ready, admit };
}

const viewer = {
  authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role: 'viewer', identity_shared: true })).toString('base64url')}`,
};
const sound = (sound_id: string) => ({
  module_id: 'soundboard',
  payload: { sound_id },
});

describe('Soundboard Lab: Extension Lab → Core → Studio worker → local player', () => {
  it('the façade shows the Core catalog and sends the real extension payload to Core once; no local debit or stage event', async () => {
    const f = await fixture();
    await f.ready();
    const lab = await LabEbs.create(EXTENSION_DIR);
    lab.connectSound(f.worker);
    const session = (await lab.handle('GET', '/session', undefined, viewer))
      .body;
    const module = (session.modules as Record<string, unknown>[]).find(
      (m) => m.id === 'soundboard',
    )!;
    const listed = module.sounds as Record<string, unknown>[];
    // The whole bank, with its live state; Core stays authoritative.
    expect(listed).toHaveLength(69);
    expect(listed.find((s) => s.id === 'boop')).toEqual({
      id: 'boop',
      label: 'Boop',
      emoji: '🔊',
      credit_cost: 1,
      token_cost: 500,
      preview_url: 'assets/sounds/boop.mp3',
      duration_ms: 842,
      playback_mode: 'stack',
      enabled: true,
      cooldown_ms: 0,
      cooldown_until: null,
      running: false,
    });
    const headers = { ...viewer, idempotencyKey: 'click-1' };
    const a = await lab.handle(
      'POST',
      '/actions/tokens',
      sound('boop'),
      headers,
    );
    const b = await lab.handle(
      'POST',
      '/actions/tokens',
      sound('boop'),
      headers,
    );
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({
      status: 'queued',
      test_mode: true,
      payment_mode: 'simulated',
      charged: false,
    });
    expect(b.body.reference_id).toBe(a.body.reference_id);
    expect(
      (await lab.handle('GET', '/session', undefined, viewer)).body.wallet,
    ).toEqual(session.wallet);
    expect(lab.snapshot(0).events).toEqual([]);
    expect(await count(f.core.db, 'sound_lab_interactions')).toBe(1);
    // Unknown and disabled sounds are refused by Core, not played.
    await f.core.soundLab.updateSound('ohlala', { enabled: false });
    const unknown = await lab.handle('POST', '/actions/tokens', sound('nope'), {
      ...viewer,
      idempotencyKey: 'click-2',
    });
    const disabled = await lab.handle(
      'POST',
      '/actions/tokens',
      sound('ohlala'),
      { ...viewer, idempotencyKey: 'click-3' },
    );
    expect([unknown.status, unknown.body.error]).toEqual([
      409,
      'sound_not_found',
    ]);
    expect([disabled.status, disabled.body.error]).toEqual([
      409,
      'sound_disabled',
    ]);
    // After its first load the extension only polls /state: a Studio change must show there.
    await f.core.soundLab.updateSound('boop', { token_cost: 350 });
    lab.invalidateSoundCatalog();
    const polled = (await lab.handle('GET', '/state', undefined, viewer)).body;
    const polledSounds = (polled.modules as Record<string, unknown>[]).find(
      (m) => m.id === 'soundboard',
    )!.sounds as Record<string, unknown>[];
    expect(polledSounds.find((s) => s.id === 'boop')!.token_cost).toBe(350);
    expect(polledSounds.find((s) => s.id === 'ohlala')!.enabled).toBe(false);

    // Names, through the Studio panel path (worker → Core): rename, then back to the default.
    const shownLabel = async () => {
      lab.invalidateSoundCatalog();
      const state = (await lab.handle('GET', '/state', undefined, viewer)).body;
      const sounds = (state.modules as Record<string, unknown>[]).find(
        (m) => m.id === 'soundboard',
      )!.sounds as Record<string, unknown>[];
      return sounds.find((s) => s.id === 'boop')!.label;
    };
    const renamed = (await f.worker.updateSound('boop', {
      label: "Boîte à meuh — c'est ça",
    })) as Record<string, unknown>;
    expect(renamed).toMatchObject({
      label: "Boîte à meuh — c'est ça",
      default_label: 'Boop',
      custom_label: "Boîte à meuh — c'est ça",
    });
    expect(await shownLabel()).toBe("Boîte à meuh — c'est ça");
    // « ↺ Nom par défaut » sends null; an emptied field sends ''.
    for (const reset of [null, '']) {
      await f.worker.updateSound('boop', { label: 'Autre nom' });
      const back = (await f.worker.updateSound('boop', {
        label: reset,
      })) as Record<string, unknown>;
      expect(back).toMatchObject({ label: 'Boop', custom_label: null });
      expect(await shownLabel()).toBe('Boop');
    }
  });

  it('player-driven lifecycle: started then completed; a replayed ACK after cleanup is accepted', async () => {
    const f = await fixture();
    await f.ready();
    const { interaction } = await f.admit('play');
    await f.worker.tick();
    const command = (await f.worker.command('player-1'))!;
    expect(command).toMatchObject({
      interaction_id: interaction.interaction_id,
      sound_url: 'assets/sounds/boop.mp3',
      test_mode: true,
      payment_mode: 'simulated',
    });
    expect(await f.worker.command('player-1')).toBeNull();
    for (const event of ['started', 'completed'] as const) {
      await f.worker.playerAck(
        command.interaction_id,
        command.delivery.attempt_id!,
        'player-1',
        event,
      );
      await f.worker.tick();
    }
    expect(await f.core.soundLab.get(command.interaction_id)).toMatchObject({
      status: 'completed',
      real_debited: 0,
    });
    // HTTP response lost after the durable ACK and local cleanup: the player's retry succeeds.
    await f.worker.playerAck(
      command.interaction_id,
      command.delivery.attempt_id!,
      'player-1',
      'completed',
    );
  });

  it('missing file / audio error is an explicit failure with its code; a wrong player cannot ACK', async () => {
    const f = await fixture();
    await f.ready();
    await f.admit('missing');
    await f.worker.tick();
    const c = (await f.worker.command('player-1'))!;
    await expect(
      f.worker.playerAck(
        c.interaction_id,
        c.delivery.attempt_id!,
        'other',
        'failed',
      ),
    ).rejects.toThrow('attempt_mismatch');
    await f.worker.playerAck(
      c.interaction_id,
      c.delivery.attempt_id!,
      'player-1',
      'failed',
      { code: 'file_missing', message: 'audio file missing or unreadable' },
    );
    await f.worker.tick();
    expect(await f.core.soundLab.get(c.interaction_id)).toMatchObject({
      status: 'failed',
      error: { code: 'file_missing' },
    });
  });

  it('a Studio restart never replays a sound handed to the player: execution_unknown', async () => {
    const f = await fixture();
    await f.ready();
    await f.admit('crash');
    await f.worker.tick();
    const c = (await f.worker.command('player-1'))!;
    const restarted = await SoundWorker.open(f.file, f.client);
    await f.ready(restarted);
    expect(await f.core.soundLab.get(c.interaction_id)).toMatchObject({
      status: 'execution_unknown',
    });
    expect(await restarted.command('player-1')).toBeNull();
  });

  it('fails closed without a live, audio-enabled player; only Lab Soundboard routes reachable', async () => {
    const f = await fixture();
    // No Studio heartbeat at all: Studio offline.
    await expect(f.admit('offline')).rejects.toThrow('studio_offline');
    // Studio alive, player page open but audio not enabled (no user click yet): player offline.
    await f.worker.playerHeartbeat('player-1', false);
    await f.worker.tick();
    await expect(f.admit('muted')).rejects.toThrow('player_offline');
    expect(() => localSoundCoreClient('https://raptoru.fr', 'secret')).toThrow(
      'local_sound_core_required',
    );
    await expect(
      (f.client as SoundCoreCall)('/v1/admin/wallet'),
    ).rejects.toThrow('sound_route_required');
    expect(await count(f.core.db, 'sound_lab_interactions')).toBe(0);
  });
  it('stack: several sounds are handed to the player at once; queue: one after the other', async () => {
    const f = await fixture();
    await f.ready();
    await f.core.soundLab.updateSound('ohlala', { playback_mode: 'queue' });
    for (const key of ['s1', 's2', 's3']) await f.admit(key);
    await f.admit('q1', 'ohlala');
    await f.admit('q2', 'ohlala');
    await f.worker.tick();
    const handed = [];
    for (let n = 0; n < 10; n++) {
      const c = await f.worker.command('player-1');
      if (!c) break;
      handed.push(c);
    }
    // 3 boop overlap, only the first ohlala.
    expect(handed.map((c) => c.sound_id)).toEqual([
      'boop',
      'boop',
      'boop',
      'ohlala',
    ]);
    const q1 = handed[3]!;
    for (const event of ['started', 'completed'] as const)
      await f.worker.playerAck(
        q1.interaction_id,
        q1.delivery.attempt_id!,
        'player-1',
        event,
      );
    await f.worker.tick();
    await f.worker.tick();
    const q2 = (await f.worker.command('player-1'))!;
    expect(q2.sound_id).toBe('ohlala');
    expect(q2.channel_sequence).toBe(5);
  });

  it('the credits price and the simulated balance check; settings reach the worker (and the player)', async () => {
    const f = await fixture();
    await f.ready();
    const lab = await LabEbs.create(EXTENSION_DIR);
    lab.connectSound(f.worker);
    await f.core.soundLab.updateSound('boop', {
      token_cost: 999_999,
    });
    await lab.handle('GET', '/session', undefined, viewer);
    // More than the fictitious Lab balance: refused before Core, nothing stored.
    const poor = await lab.handle('POST', '/actions/tokens', sound('boop'), {
      ...viewer,
      idempotencyKey: 'poor',
    });
    expect([poor.status, poor.body.error]).toEqual([
      409,
      'insufficient_tokens',
    ]);
    const credits = await lab.handle(
      'POST',
      '/actions/redemption',
      { ...sound('boop'), redemption_id: 'red-demo-2' },
      { ...viewer, idempotencyKey: 'credits' },
    );
    expect(credits.body.interaction).toMatchObject({
      payment_method: 'credits',
      simulated_cost: 1,
      simulated_currency: 'credits_lab',
      real_debited: 0,
    });
    await f.core.soundLab.updateSettings({ volume_protection: 'medium' });
    const w = await SoundWorker.open(f.file, f.client);
    await w.playerHeartbeat('player-1', true);
    await w.tick();
    expect(w.settings).toEqual({ volume_protection: 'medium' });
  });
});
