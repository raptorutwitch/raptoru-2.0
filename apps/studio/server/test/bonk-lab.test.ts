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
import { LabEbs, thirdPartyGroups } from '../src/extension-lab/lab-ebs.js';
import { extensionFile } from '../src/extension-lab/serve.js';
import { EXTENSION_DIR } from '../src/index.js';
import { LabObs, OBS_RETRY_MS } from '../src/bonk-lab/obs.js';

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

  it('salve (lot 5, Auto): one extension request, N shots admitted atomically, the whole salve claimed in one tick, played in order, never replayed', async () => {
    const f = await fixture();
    await f.ready();
    const lab = await LabEbs.create(EXTENSION_DIR);
    lab.connectBonk(f.worker);
    const headers = {
      authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role: 'viewer', identity_shared: true })).toString('base64url')}`,
      idempotencyKey: 'salve-1',
    };
    const session = await lab.handle('GET', '/session', undefined, headers);
    expect(
      (session.body.modules as { id: string; volley?: unknown }[]).find(
        (m) => m.id === 'bonk',
      )?.volley,
    ).toEqual({ max_shots: 10, cadence_min_ms: 90, cadence_max_ms: 600 });
    const shot = (emote: string, glyph: string) => ({
      emote_source: 'unicode',
      emote,
      emote_glyph: glyph,
    });
    const payload = {
      module_id: 'bonk',
      payload: {
        shots: [
          shot('unicode:1f600', '😀'),
          shot('unicode:1f525', '🔥'),
          shot('unicode:1f600', '😀'),
        ],
        cadence_ms: 95,
      },
    };
    const a = await lab.handle('POST', '/actions/tokens', payload, headers);
    const b = await lab.handle('POST', '/actions/tokens', payload, headers);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ module_id: 'bonk', cost: 600 });
    expect(b.body).toMatchObject({
      volley_id: a.body.volley_id,
      replayed: true,
    });
    const ids = (a.body.interactions as { interaction_id: string }[]).map(
      (i) => i.interaction_id,
    );
    // One tick: the whole salve is in the journal, handed out in firing order with its cadence.
    await f.worker.tick();
    const played: string[] = [];
    for (let n = 0; n < 3; n++) {
      const c = (await f.worker.command('renderer-1'))!;
      expect(c.volley).toMatchObject({ index: n, count: 3, cadence_ms: 95 });
      played.push(c.interaction_id);
      await f.worker.rendererAck(
        c.interaction_id,
        c.delivery.attempt_id!,
        'renderer-1',
        'started',
      );
    }
    expect(played).toEqual(ids);
    expect(await f.worker.command('renderer-1')).toBeNull();
    // A restart cannot prove the end of a sent shot: unknown, never played again.
    const reopened = await BonkWorker.open(f.file, f.client);
    reopened.setObs(true, true);
    await reopened.rendererHeartbeat('renderer-2');
    await reopened.tick();
    expect(await reopened.command('renderer-2')).toBeNull();
    for (const id of ids)
      expect((await f.core.bonkLab.get(id)).status).toBe('execution_unknown');
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

  it('serves the extension Unicode bank unchanged (full emoji catalog in Bonk Lab too)', async () => {
    const served = await extensionFile(
      EXTENSION_DIR,
      '/ext/shared/unicode-emojis.js',
    );
    expect(String(served.body)).toBe(
      await readFile(
        join(EXTENSION_DIR, 'shared', 'unicode-emojis.js'),
        'utf8',
      ),
    );
    expect(String(served.body)).toContain('unicode:1f603');
  });

  it('7TV/BTTV/FFZ: Core catalog -> picker groups; the façade forwards provider + id only', async () => {
    const groups = thirdPartyGroups({
      fetched_at: new Date().toISOString(),
      channel_display_name: 'Raptoru_',
      errors: {},
      emotes: [
        {
          provider: '7tv',
          id: '01FF53DH2000037W021V2MN0SS',
          name: '199Yoooo',
          scope: 'channel',
          animated: true,
          url: 'https://cdn.7tv.app/emote/01FF53DH2000037W021V2MN0SS/4x.webp',
        },
        {
          provider: 'ffz',
          id: '9',
          name: 'ZrehplaR',
          scope: 'global',
          animated: false,
          url: 'https://cdn.frankerfacez.com/emote/9/4',
        },
      ],
    });
    expect(groups.map((g) => [g.id, g.label])).toEqual([
      ['7tv-channel', 'Raptoru_'],
      ['ffz-global', 'Globales'],
    ]);
    expect((groups[0]!.emotes as Record<string, unknown>[])[0]).toEqual({
      id: '7tv:01FF53DH2000037W021V2MN0SS',
      label: '199Yoooo',
      source: '7tv',
      provider: '7tv',
      image_url: 'https://cdn.7tv.app/emote/01FF53DH2000037W021V2MN0SS/4x.webp',
      animated: true,
    });
    const f = await fixture();
    await f.ready();
    const lab = await LabEbs.create(EXTENSION_DIR);
    lab.connectBonk(f.worker);
    const reply = await lab.handle(
      'POST',
      '/actions/tokens',
      {
        module_id: 'bonk',
        payload: {
          target_login: 'streamer',
          emotes: ['7tv:01FF53DH2000037W021V2MN0SS'],
          emote_source: '7tv',
          emote_glyph: null,
        },
      },
      {
        authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role: 'viewer', identity_shared: true })).toString('base64url')}`,
        idempotencyKey: 'seven-1',
      },
    );
    // Core decides (this test Core has no third-party catalog): refused there, not by the façade.
    expect(reply.status).toBe(409);
    expect(reply.body.error).toBe('emote_not_in_catalog');
  });

  it('any Unicode emoji Bonk is admitted with the Twemoji path built by Core', async () => {
    const f = await fixture();
    await f.ready();
    const result = await f.worker.admit(
      { id: '900101', display_name: 'Viewer Lab' },
      'thumbs',
      { provider: 'unicode', id: 'unicode:1f44d', glyph: '👍' },
    );
    expect(
      (await f.core.bonkLab.get(result.interaction.interaction_id)).emote_url,
    ).toBe('assets/twemoji/svg/1f44d.svg');
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

describe('OBS reconnection (Bonk VNext lot 0)', () => {
  // A local OBS that can be stopped, restarted, or refuse the password. `mode` applies to the next
  // connection attempts; `sockets` counts every attempt.
  function fakeObs() {
    const state = {
      mode: 'up' as 'up' | 'down' | 'wrong_password',
      sockets: [] as { close(code?: number): void; open: boolean }[],
    };
    class Socket extends EventTarget {
      open = false;
      constructor(readonly url: string) {
        super();
        state.sockets.push(this);
        const mode = state.mode;
        queueMicrotask(() => {
          if (mode === 'down') {
            this.dispatchEvent(new Event('error'));
            this.end(1006);
          } else this.emit({ op: 0, d: { rpcVersion: 1 } });
        });
      }
      emit(packet: unknown) {
        this.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(packet) }),
        );
      }
      end(code: number) {
        this.open = false;
        this.dispatchEvent(Object.assign(new Event('close'), { code }));
      }
      send(raw: string) {
        if (JSON.parse(raw).op !== 1) return;
        queueMicrotask(() => {
          if (state.mode === 'wrong_password') return this.end(4009);
          this.open = true;
          this.emit({ op: 2, d: {} });
        });
      }
      close() {
        // Closed by the client: no event is needed by the adapter.
        this.open = false;
      }
    }
    vi.stubGlobal('WebSocket', Socket);
    return state;
  }
  const flush = () => new Promise((r) => setImmediate(r));
  afterEach(() => {
    vi.useRealTimers();
  });

  it('OBS closed then restarted: the connection comes back by itself, with a bounded backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const obs = fakeObs();
    const client = new LabObs();
    await client.connect(4455, 'secret');
    expect(client.connected).toBe(true);
    // OBS quits: the established connection is lost.
    obs.mode = 'down';
    (obs.sockets.at(-1) as unknown as { end(code: number): void }).end(1006);
    expect(client.connected).toBe(false);
    expect(client.reconnecting).toBe(true);
    expect(client.error).toBe('obs_offline');
    // Retries while OBS is down: 1 s, 2 s, 5 s, then every 10 s.
    for (const delay of OBS_RETRY_MS) {
      const before = obs.sockets.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(obs.sockets.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(obs.sockets.length).toBe(before + 1);
    }
    // OBS is back: the next retry (10 s) reconnects.
    obs.mode = 'up';
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(client.connected).toBe(true);
    expect(client.reconnecting).toBe(false);
    expect(client.error).toBeNull();
    client.disconnect();
  });

  it('OBS not started yet: the first attempt fails, the retries connect once it is up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const obs = fakeObs();
    obs.mode = 'down';
    const client = new LabObs();
    await expect(client.connect(4455, '')).rejects.toThrow(
      'obs_offline_or_auth_failed',
    );
    expect(client.reconnecting).toBe(true);
    obs.mode = 'up';
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('wrong password: explicit obs_auth_failed and no retry loop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const obs = fakeObs();
    obs.mode = 'wrong_password';
    const client = new LabObs();
    await expect(client.connect(4455, 'bad')).rejects.toThrow(
      'obs_auth_failed',
    );
    expect(client.error).toBe('obs_auth_failed');
    expect(client.reconnecting).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(obs.sockets).toHaveLength(1);
  });

  it('explicit disconnect: no reconnection afterwards', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const obs = fakeObs();
    const client = new LabObs();
    await client.connect(4455, 'secret');
    client.disconnect();
    obs.mode = 'down';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(obs.sockets).toHaveLength(1);
    expect(client.reconnecting).toBe(false);
    expect(client.error).toBeNull();
  });
});
