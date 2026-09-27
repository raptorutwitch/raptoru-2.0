import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../core-api/src/http/server.js';
import { setup, count } from '../../../core-api/test/helpers.js';
import {
  BonkWorker,
  localCoreClient,
  type CoreCall,
} from '../src/bonk-lab/worker.js';
import { LabEbs } from '../src/extension-lab/lab-ebs.js';
import { extensionFile } from '../src/extension-lab/serve.js';
import { EXTENSION_DIR } from '../src/index.js';
import { LabObs } from '../src/bonk-lab/obs.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
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
  const dir = await mkdtemp(join(process.cwd(), '.runtime-bonk-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'journal.json');
  const client = localCoreClient(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    'studio-test-secret',
  );
  const worker = await BonkWorker.open(file, client);
  const ready = async (w = worker) => {
    w.setObs(true, true);
    await w.rendererHeartbeat('renderer-1');
    await w.tick();
  };
  const admit = (key: string, w = worker) =>
    w.admit({ id: '900101', display_name: 'Viewer Lab' }, key, {
      provider: 'unicode',
      id: 'unicode:1f600',
    });
  return { core, worker, client, file, ready, admit };
}

describe('Bonk vertical Lab transport (real Core HTTP + PGlite + durable Studio)', () => {
  it('actual extension payload reaches Core once; no fake local debit or old stage event; lifecycle is renderer-driven', async () => {
    const f = await fixture();
    await f.ready();
    const lab = await LabEbs.create(EXTENSION_DIR);
    lab.connectBonk(f.worker);
    const headers = {
      authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role: 'viewer', identity_shared: true })).toString('base64url')}`,
      idempotencyKey: 'click-1',
    };
    const payload = {
      module_id: 'bonk',
      payload: {
        target_login: 'streamer',
        emotes: ['unicode:1f600'],
        emote_source: 'unicode',
        emote_glyph: '😀',
      },
    };
    const before = await lab.handle('GET', '/session', undefined, headers);
    const a = await lab.handle('POST', '/actions/tokens', payload, headers);
    const b = await lab.handle('POST', '/actions/tokens', payload, headers);
    expect(a.status).toBe(200);
    expect(a.body.status).toBe('queued');
    expect(a.body.reference_id).toBe(b.body.reference_id);
    expect(
      (await lab.handle('GET', '/session', undefined, headers)).body.wallet,
    ).toEqual(before.body.wallet);
    expect(lab.snapshot(0).events).toEqual([]);
    await f.worker.tick();
    const command = (await f.worker.command('renderer-1'))!;
    expect(command.interaction_id).toBe(a.body.reference_id);
    expect(await f.worker.command('renderer-1')).toBeNull();
    expect((await f.core.bonkLab.get(command.interaction_id)).status).toBe(
      'queued',
    );
    for (const event of ['started', 'completed'] as const) {
      await f.worker.rendererAck(
        command.interaction_id,
        command.delivery.attempt_id!,
        'renderer-1',
        event,
      );
      await f.worker.tick();
    }
    expect((await f.core.bonkLab.get(command.interaction_id)).status).toBe(
      'completed',
    );
    // HTTP response lost after durable ACK + local cleanup: retry still succeeds.
    await f.worker.rendererAck(
      command.interaction_id,
      command.delivery.attempt_id!,
      'renderer-1',
      'completed',
    );
    for (const table of [
      'wallets',
      'wallet_operations',
      'wallet_transactions',
      'viewers',
      'loyalty_rewards',
      'daily_claims',
      'presence_viewer_streams',
    ])
      expect(await count(f.core.db, table)).toBe(0);
  });

  it('20 overlapping Bonks, two viewers, duplicate submissions: ordered starts without batching', async () => {
    const f = await fixture();
    await f.ready();
    for (let n = 0; n < 20; n++)
      await Promise.all(
        [0, 1].map(() =>
          f.worker.admit(
            { id: String(900101 + (n % 2)), display_name: 'V' },
            `burst-${n}`,
            { provider: 'unicode', id: 'unicode:1f600' },
          ),
        ),
      );
    const starts: number[] = [];
    for (let n = 0; n < 20; n++) {
      // Like the real overlay (heartbeat every 1.5 s): readiness expires after 5 s without one.
      await f.worker.rendererHeartbeat('renderer-1');
      await f.worker.tick();
      const c = (await f.worker.command('renderer-1'))!;
      expect(c).not.toBeNull();
      starts.push(c.channel_sequence);
      await f.worker.rendererAck(
        c.interaction_id,
        c.delivery.attempt_id!,
        'renderer-1',
        'started',
      );
      await f.worker.tick();
      await f.worker.rendererAck(
        c.interaction_id,
        c.delivery.attempt_id!,
        'renderer-1',
        'completed',
      );
    }
    await f.worker.tick();
    expect(starts).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await count(f.core.db, 'bonk_lab_interactions')).toBe(20);
    // ~80 HTTP round trips to PGlite: above the default 5 s on a loaded machine.
  }, 30_000);

  it('restarts do not replay sent visuals, and replay only durable ACKs after a lost Core response', async () => {
    const f = await fixture();
    await f.ready();
    await f.admit('crash');
    await f.worker.tick();
    const c = (await f.worker.command('renderer-1'))!;
    const restarted = await BonkWorker.open(f.file, f.client);
    await f.ready(restarted);
    expect((await f.core.bonkLab.get(c.interaction_id)).status).toBe(
      'execution_unknown',
    );
    expect(await restarted.command('renderer-1')).toBeNull();
    await f.admit('known', restarted);
    await restarted.tick();
    const next = (await restarted.command('renderer-1'))!;
    await restarted.rendererAck(
      next.interaction_id,
      next.delivery.attempt_id!,
      'renderer-1',
      'started',
    );
    await restarted.rendererAck(
      next.interaction_id,
      next.delivery.attempt_id!,
      'renderer-1',
      'completed',
    );
    let lost = false;
    const flaky: CoreCall = async <T>(path: string, body?: unknown) => {
      const result = await f.client<T>(path, body);
      if (path.endsWith('/ack') && !lost) {
        lost = true;
        throw new Error('lost_response');
      }
      return result;
    };
    const recovering = await BonkWorker.open(f.file, flaky);
    await recovering.tick();
    expect(recovering.error).toBe('lost_response');
    await recovering.tick();
    expect((await f.core.bonkLab.get(next.interaction_id)).status).toBe(
      'completed',
    );
    expect(JSON.parse(await readFile(f.file, 'utf8')).entries).toEqual([]);
  });

  it('renderer failure is explicit, and a wrong renderer cannot ACK another attempt', async () => {
    const f = await fixture();
    await f.ready();
    await f.admit('bad-image');
    await f.worker.tick();
    const c = (await f.worker.command('renderer-1'))!;
    await expect(
      f.worker.rendererAck(
        c.interaction_id,
        c.delivery.attempt_id!,
        'other',
        'completed',
      ),
    ).rejects.toThrow('attempt_mismatch');
    await f.worker.rendererAck(
      c.interaction_id,
      c.delivery.attempt_id!,
      'renderer-1',
      'failed',
    );
    await f.worker.tick();
    expect((await f.core.bonkLab.get(c.interaction_id)).status).toBe('failed');
  });

  it('fails closed before admission without OBS/source/renderer; remote Core and non-Bonk routes refused', async () => {
    const f = await fixture();
    await f.worker.tick();
    await expect(f.admit('offline')).rejects.toThrow('obs_offline');
    f.worker.setObs(true, false);
    expect(await f.worker.command('renderer-1')).toBeNull();
    expect(() => localCoreClient('https://raptoru.fr', 'secret')).toThrow(
      'local_bonk_core_required',
    );
    await expect(f.client('/v1/admin/wallet')).rejects.toThrow(
      'bonk_route_required',
    );
    expect(await count(f.core.db, 'bonk_lab_interactions')).toBe(0);
  });

  it('restricts Unicode catalog only in explicit Bonk Lab, leaving imported files untouched', async () => {
    const normal = await extensionFile(
      EXTENSION_DIR,
      '/ext/shared/unicode-emojis.js',
    );
    const bonk = await extensionFile(
      EXTENSION_DIR,
      '/ext/shared/unicode-emojis.js',
      true,
    );
    expect(String(bonk.body)).toContain('unicode:1f600');
    expect(String(bonk.body)).not.toContain('unicode:1f603');
    expect(String(normal.body).length).toBeGreaterThan(
      String(bonk.body).length,
    );
  });
});

describe('OBS v5 adapter', () => {
  it('handshakes locally and verifies the exact named active Browser Source, with no mutations', async () => {
    const requests: string[] = [];
    class Socket extends EventTarget {
      constructor(readonly url: string) {
        super();
        queueMicrotask(() =>
          this.emit({
            op: 0,
            d: {
              rpcVersion: 1,
              authentication: { salt: 'salt', challenge: 'challenge' },
            },
          }),
        );
      }
      emit(packet: unknown) {
        this.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(packet) }),
        );
      }
      send(raw: string) {
        const p = JSON.parse(raw);
        if (p.op === 1) {
          expect(p.d.authentication).toBeTruthy();
          queueMicrotask(() => this.emit({ op: 2, d: {} }));
        } else {
          requests.push(p.d.requestType);
          queueMicrotask(() =>
            this.emit({
              op: 7,
              d: {
                requestId: p.d.requestId,
                requestStatus: { result: true },
                responseData:
                  p.d.requestType === 'GetInputSettings'
                    ? {
                        inputKind: 'browser_source',
                        inputSettings: {
                          url: 'http://local/overlay',
                          width: 1920,
                          height: 1080,
                        },
                      }
                    : { videoActive: true },
              },
            }),
          );
        }
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', Socket);
    const obs = new LabObs();
    await obs.connect(4455, 'test');
    expect(await obs.sourceReady('http://local/overlay')).toBe(true);
    expect(await obs.sourceReady('http://other/overlay')).toBe(false);
    expect(requests.every((r) => r.startsWith('Get'))).toBe(true);
    obs.disconnect();
    expect(obs.connected).toBe(false);
  });
});
