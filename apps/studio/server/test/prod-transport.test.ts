// ASTRA-P1-019 lot 1 — future production transport, end to end on this machine:
// Studio installation identity → HTTPS (local test certificate, trusted by this client only) → real
// Core handler (PGlite) → claim → renderer → ACK, with the existing Bonk worker and journal.
// The certificate in test/fixtures/tls is for these tests only (CN raptoru-transport-test-only,
// SAN localhost / 127.0.0.1). Regenerate with:
//   openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes -keyout localhost-test-only.key \
//     -out localhost-test-only.crt -subj "/CN=raptoru-transport-test-only" \
//     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -addext "basicConstraints=critical,CA:FALSE"
import { readFile, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BonkWorker, type CoreCall } from '../src/bonk-lab/worker.js';
import {
  prodCoreClient,
  StudioTransportError,
} from '../src/prod-transport/core-client.js';
import {
  loadOrCreateInstallation,
  StudioInstallationError,
  type StudioInstallation,
} from '../src/prod-transport/installation.js';
import { WorkerLoop } from '../src/worker-loop.js';
import {
  cert,
  certSha256,
  CHANNEL,
  pairedStudio,
  tempDir,
  type Cleanups,
} from './prod-fixture.js';

const BASE = '/v1/studio/bonk';

const cleanups: Cleanups = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const p = await pairedStudio(cleanups);
  const { core, dir, installation, client } = p;
  const journal = join(dir, 'prod-bonk', 'journal.json');
  const open = (core_: CoreCall = client()) =>
    BonkWorker.open(journal, core_, {
      base: BASE,
      studioId: installation.installationId,
    });
  const worker = await open();
  const ready = async (w: BonkWorker) => {
    w.setObs(true, true);
    await w.rendererHeartbeat('renderer-1');
    await w.tick();
  };
  const admit = async (w: BonkWorker, key_ = 'k-1') =>
    (
      await core.bonkLab.admit({
        idempotency_key: key_,
        channel_id: CHANNEL,
        viewer: { id: '900101', display_name: 'Viewer Lab' },
        lab_session_id: w.session,
        emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
      })
    ).interaction;
  const deliveries = async (id: string) =>
    Number(
      (
        await core.db.query<{ n: string }>(
          'select count(*) as n from bonk_lab_deliveries where interaction_id = $1',
          [id],
        )
      )[0]!.n,
    );
  return { ...p, open, worker, ready, admit, deliveries };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof StudioTransportError ? e.code : (e as Error).message;
  }
};

describe('production transport Studio → Core over local HTTPS (ASTRA-P1-019 lot 1)', () => {
  it('normal: handshake, heartbeat, claim, renderer, ACK started → completed; terminal state in Core', async () => {
    const f = await fixture();
    expect(await f.client()('/v1/studio/session')).toEqual({
      installation_id: f.installation.installationId,
      protocol: 1,
    });
    await f.ready(f.worker);
    const queued = await f.admit(f.worker);
    await f.worker.tick(); // claim
    const sent = await f.worker.command('renderer-1');
    expect(sent?.interaction_id).toBe(queued.interaction_id);
    expect(sent?.delivery.studio_instance_id).toBe(
      f.installation.installationId,
    );
    await f.worker.rendererAck(
      queued.interaction_id,
      sent!.delivery.attempt_id!,
      'renderer-1',
      'started',
    );
    await f.worker.rendererAck(
      queued.interaction_id,
      sent!.delivery.attempt_id!,
      'renderer-1',
      'completed',
    );
    await f.worker.tick();
    expect(f.worker.error).toBeNull();
    expect((await f.core.bonkLab.get(queued.interaction_id)).status).toBe(
      'completed',
    );
    expect(f.worker.busy).toBe(false);
  });

  it('a Studio of another channel: wrong_channel shown (heartbeat and claim), the viewer is refused before any debit (Bonk VNext lot 0)', async () => {
    const f = await fixture();
    const other = await BonkWorker.open(
      join(f.dir, 'other-bonk', 'journal.json'),
      f.client(),
      {
        base: BASE,
        studioId: f.installation.installationId,
        channel: '1239040922',
      },
    );
    await f.ready(other);
    expect(other.error).toBe(
      'Chaîne du Studio différente de celle du Core (Core : 900100) : rien ne sera joué',
    );
    expect(other.ready).toBe(true); // locally ready: only the Core refuses it
    expect(
      await codeOf(
        f.core.bonkLab.admit({
          idempotency_key: 'k-wrong',
          channel_id: CHANNEL,
          viewer: { id: '900101', display_name: 'Viewer Lab' },
          lab_session_id: other.session,
          emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
        }),
      ),
    ).toBe('studio_offline');
    // The claim itself is refused too (not a silent « nothing to play »).
    expect(
      await codeOf(
        f.client()(`${BASE}/claim`, {
          studio_instance_id: f.installation.installationId,
          channel_id: '1239040922',
        }),
      ),
    ).toBe('wrong_channel');
    // The Studio of the right channel works as before.
    await f.ready(f.worker);
    expect(f.worker.error).toBeNull();
    const queued = await f.admit(f.worker);
    await f.worker.tick();
    expect((await f.worker.command('renderer-1'))?.interaction_id).toBe(
      queued.interaction_id,
    );
  });

  it('TLS is really verified: without the trusted test certificate, or over http, nothing is called', async () => {
    const f = await fixture();
    await f.ready(f.worker);
    // An identity bound to this Core with the system roots: the self-signed certificate is refused.
    const systemRoots = await loadOrCreateInstallation(
      join(f.dir, 'system-roots.json'),
      { coreOrigin: f.net.origin(), caSha256: null },
    );
    expect(
      await codeOf(
        prodCoreClient({ url: f.net.url(), installation: systemRoots })(
          '/v1/studio/session',
        ),
      ),
    ).toBe('tls_rejected');
    // The credential is never sent to another Core, nor with another trust anchor.
    for (const over of [
      { url: 'https://127.0.0.1:1' },
      { ca: undefined },
      { ca: Buffer.from('-----BEGIN CERTIFICATE-----\nother\n') },
    ])
      expect(() => f.client(over)).toThrow(
        'Identité Studio liée à un autre Core',
      );
    expect(() =>
      prodCoreClient({
        url: f.net.url().replace('https:', 'http:'),
        installation: f.installation,
      }),
    ).toThrow('https_core_url_required');
    // The client only speaks the production routes (never the Lab ones).
    expect(await codeOf(f.client()('/v1/lab/bonk/claim', {}))).toBe(
      'studio_route_required',
    );
  });

  it('bad credential: clean refusal, explicit message, no interaction handed out', async () => {
    const f = await fixture();
    const stranger = await loadOrCreateInstallation(
      join(f.dir, 'other.json'),
      f.binding,
    ); // never paired
    const w = await BonkWorker.open(
      join(f.dir, 'stranger', 'journal.json'),
      prodCoreClient({ url: f.net.url(), installation: stranger, ca: cert }),
      { base: BASE, studioId: stranger.installationId },
    );
    await f.ready(f.worker); // a paired, ready Studio exists: admissions are open
    const queued = await f.admit(w);
    await f.ready(w);
    expect(w.error).toBe('Studio non reconnu par le Core : appairage requis');
    expect(w.busy).toBe(false);
    expect(await f.deliveries(queued.interaction_id)).toBe(0);
  });

  it('revoked: valid before, refused on the next call, no silent continuation; its work ends as execution_unknown', async () => {
    const f = await fixture();
    await f.ready(f.worker);
    const queued = await f.admit(f.worker);
    await f.worker.tick();
    const sent = await f.worker.command('renderer-1');
    await f.worker.rendererAck(
      queued.interaction_id,
      sent!.delivery.attempt_id!,
      'renderer-1',
      'started',
    );
    await f.core.studioInstallations.revoke(f.installation.installationId);
    await f.worker.tick();
    expect(f.worker.error).toBe(
      'Studio révoqué côté Core : nouvel appairage requis',
    );
    expect(await codeOf(f.client()('/v1/studio/session'))).toBe(
      'studio_revoked',
    );
    // Core settles the revoked Studio's delivery at the next sweep: never handed out again.
    f.core.clock.advance(1);
    await f.core.bonkLab.heartbeat({
      studio_instance_id: 'another-studio',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    expect(await f.core.bonkLab.claim('another-studio', CHANNEL)).toBeNull();
    expect((await f.core.bonkLab.get(queued.interaction_id)).status).toBe(
      'execution_unknown',
    );
  });

  it('incompatible protocol: « mise à jour requise », not a network error; nothing claimed', async () => {
    const f = await fixture();
    await f.ready(f.worker);
    const queued = await f.admit(f.worker);
    const w = await BonkWorker.open(
      join(f.dir, 'v2', 'journal.json'),
      f.client({ protocolVersion: 2 }),
      { base: BASE, studioId: f.installation.installationId },
    );
    await f.ready(w);
    expect(w.error).toBe(
      'Mise à jour requise : protocole Studio 2 incompatible (Core accepte 1)',
    );
    expect(
      await codeOf(f.client({ protocolVersion: 2 })('/v1/studio/session')),
    ).toBe('protocol_incompatible');
    expect(await f.deliveries(queued.interaction_id)).toBe(0);
  });

  it('network cut before the claim: the tick fails cleanly, the retry claims exactly once', async () => {
    const f = await fixture();
    await f.ready(f.worker);
    const queued = await f.admit(f.worker);
    await f.net.down();
    await f.worker.tick();
    expect(f.worker.error).toMatch(/^Core unreachable/);
    expect(await f.deliveries(queued.interaction_id)).toBe(0);
    await f.net.up();
    await f.worker.tick();
    await f.worker.tick();
    expect(f.worker.error).toBeNull();
    expect(await f.deliveries(queued.interaction_id)).toBe(1);
    expect((await f.worker.command('renderer-1'))?.interaction_id).toBe(
      queued.interaction_id,
    );
  });

  it('cut after the claim, before any ACK, Studio restarted: execution_unknown, never replayed', async () => {
    const f = await fixture();
    await f.ready(f.worker);
    const queued = await f.admit(f.worker);
    await f.worker.tick();
    expect((await f.worker.command('renderer-1'))?.interaction_id).toBe(
      queued.interaction_id,
    ); // possibly shown
    await f.net.down();
    await f.worker.tick(); // nothing reported
    // Studio process restarts while Core is unreachable.
    const again = await f.open();
    await f.net.up();
    again.setObs(true, true);
    await again.rendererHeartbeat('renderer-2');
    await again.tick();
    expect((await f.core.bonkLab.get(queued.interaction_id)).status).toBe(
      'execution_unknown',
    );
    expect(await again.command('renderer-2')).toBeNull();
    expect(await f.deliveries(queued.interaction_id)).toBe(1);
  });

  it('ACK lost (Core applied it, the answer never came back): re-sent idempotently, the execution is never handed out again', async () => {
    const f = await fixture();
    const real = f.client();
    let dropNextAck = true;
    const lossy: CoreCall = async (path, body, options) => {
      const result = await real(path, body, options);
      if (dropNextAck && path.endsWith('/ack')) {
        dropNextAck = false;
        throw new StudioTransportError(
          'core_unreachable',
          'Core unreachable (ECONNRESET)',
        );
      }
      return result as never;
    };
    const w = await f.open(lossy);
    await f.ready(w);
    const queued = await f.admit(w);
    await w.tick();
    const sent = await w.command('renderer-1');
    await w.rendererAck(
      queued.interaction_id,
      sent!.delivery.attempt_id!,
      'renderer-1',
      'started',
    );
    await w.tick(); // Core records « started », the answer is lost
    expect(w.error).toMatch(/^Core unreachable/);
    expect((await f.core.bonkLab.get(queued.interaction_id)).status).toBe(
      'executing',
    );
    expect(await w.command('renderer-1')).toBeNull(); // not handed out again locally
    await w.rendererAck(
      queued.interaction_id,
      sent!.delivery.attempt_id!,
      'renderer-1',
      'completed',
    );
    await w.tick(); // « started » re-sent (no-op in Core) then « completed »
    expect(w.error).toBeNull();
    expect((await f.core.bonkLab.get(queued.interaction_id)).status).toBe(
      'completed',
    );
    expect(await f.deliveries(queued.interaction_id)).toBe(1);
  });

  it('ACKs never arrive: Core turns the expired lease into execution_unknown, never into a new claim', async () => {
    const f = await fixture();
    await f.ready(f.worker);
    const queued = await f.admit(f.worker);
    await f.worker.tick();
    const sent = await f.worker.command('renderer-1');
    await f.worker.rendererAck(
      queued.interaction_id,
      sent!.delivery.attempt_id!,
      'renderer-1',
      'started',
    );
    await f.net.down(); // the started ACK never reaches Core
    f.core.clock.advance(10 * 60_000);
    await f.core.bonkLab.heartbeat({
      studio_instance_id: 'another-studio',
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    expect(await f.core.bonkLab.claim('another-studio', CHANNEL)).toBeNull();
    expect((await f.core.bonkLab.get(queued.interaction_id)).status).toBe(
      'execution_unknown',
    );
  });

  it('Core unavailable: every call has a bounded total deadline (a Core that never answers)', async () => {
    const dir = await tempDir(cleanups);
    // Accepts the TCP connection, never answers (not even the TLS handshake).
    const sockets = new Set<import('node:net').Socket>();
    const silent = createTcpServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    cleanups.push(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((r) => silent.close(r));
    });
    const installation = await loadOrCreateInstallation(join(dir, 'id.json'), {
      coreOrigin: `https://127.0.0.1:${(silent.address() as AddressInfo).port}`,
      caSha256: certSha256,
    });
    const hung = prodCoreClient({
      url: `https://127.0.0.1:${(silent.address() as AddressInfo).port}`,
      installation,
      ca: cert,
      timeoutMs: 300,
    });
    const t0 = Date.now();
    expect(await codeOf(hung('/v1/studio/session'))).toBe('core_unreachable');
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('Core unavailable with local work pending: the loop backs off to 1 s instead of 150 ms', async () => {
    vi.useFakeTimers();
    let ticks = 0;
    const loop = new WorkerLoop(
      async () => {
        ticks++;
      },
      () => true, // unreported ACK in the journal
      () => true, // last tick failed
    );
    loop.start();
    await vi.advanceTimersByTimeAsync(5_000);
    loop.stop();
    // 0, 300, 900, 1 900, 2 900, 3 900, 4 900 ms — instead of 34 ticks at 150 ms.
    expect(ticks).toBe(7);
  });

  it('Studio restarted: same installation and credential, clean reconnection and handshake', async () => {
    const f = await fixture();
    const before = await readFile(f.identityFile, 'utf8');
    const reloaded = await loadOrCreateInstallation(f.identityFile, f.binding);
    expect(reloaded.installationId).toBe(f.installation.installationId);
    expect(reloaded.pairingCode).toBe(f.installation.pairingCode);
    expect(await readFile(f.identityFile, 'utf8')).toBe(before); // never rewritten
    const client = prodCoreClient({
      url: f.net.url(),
      installation: reloaded,
      ca: cert,
    });
    expect(await client('/v1/studio/session')).toEqual({
      installation_id: reloaded.installationId,
      protocol: 1,
    });
    const w = await BonkWorker.open(
      join(f.dir, 'prod-bonk', 'journal.json'),
      client,
      {
        base: BASE,
        studioId: reloaded.installationId,
      },
    );
    await f.ready(w);
    expect(w.error).toBeNull();
  });

  it('the secret never leaks: not in logs / JSON / errors; a damaged identity file is never replaced', async () => {
    const f = await fixture();
    const secret = JSON.parse(await readFile(f.identityFile, 'utf8'))
      .secret as string;
    expect(JSON.stringify(f.installation)).not.toContain(secret);
    expect(inspect(f.installation)).not.toContain(secret);
    expect(f.installation.pairingCode).not.toContain(secret);
    const errors: unknown[] = [];
    for (const p of [
      prodCoreClient({
        url: f.net.url(),
        installation: await loadOrCreateInstallation(
          join(f.dir, 'roots.json'),
          { coreOrigin: f.net.origin(), caSha256: null },
        ),
      })('/v1/studio/session'),
      f.client({ protocolVersion: 9 })('/v1/studio/session'),
    ])
      errors.push(await p.catch((e) => e));
    const stranger: StudioInstallation = await loadOrCreateInstallation(
      join(f.dir, 'x.json'),
      f.binding,
    );
    errors.push(
      await prodCoreClient({
        url: f.net.url(),
        installation: stranger,
        ca: cert,
      })('/v1/studio/session').catch((e) => e),
    );
    for (const e of errors)
      expect(inspect(e) + JSON.stringify(e)).not.toContain(secret);
    await writeFile(f.identityFile, '{"version":1,"installation_id":"broken"}');
    await expect(
      loadOrCreateInstallation(f.identityFile, f.binding),
    ).rejects.toThrow(StudioInstallationError);
    expect(await readFile(f.identityFile, 'utf8')).toBe(
      '{"version":1,"installation_id":"broken"}',
    );
  });
});
