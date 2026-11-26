import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chaosEffectRequestSchema, type ChaosEvent } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { ChaosCoreLoop } from '../src/chaos/core-loop.js';
import { ChaosRuntime } from '../src/chaos/runtime.js';
import { resolveScreens } from '../src/chaos/viewer-effect.js';
import { createStudioServer } from '../src/index.js';
import {
  localLabCoreClient,
  type LabCoreCall,
} from '../src/lab-moderation/proxy.js';

// Chaos V2 lot 2 (docs/chaos/CONTRAT_LOT2.md § 3) : demandes des viewers. Faux moteur (FAKE_CHAOS_VIEWER : deux écrans,
// emplacements, cycle de vie) et faux Core HTTP (heartbeat / claim / ack / stop-all) : rien d'affiché, aucun vrai Core.

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fixtures', 'fake-chaos-engine.mjs');
const D1 = String.raw`\\.\DISPLAY1`;
const D2 = String.raw`\\.\DISPLAY2`;
const D3 = String.raw`\\.\DISPLAY3`;
const LAB = '/v1/lab/chaos/900100';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T, ms = 8000): Promise<NonNullable<T>> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await sleep(25);
  }
}

function studio(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chaos-core-'));
  const rt = new ChaosRuntime({
    exe: 'x',
    stateDir: dir,
    pingMs: 50,
    spawnImpl: (args) =>
      spawn(process.execPath, [FAKE, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FAKE_CHAOS_VIEWER: '1', ...env },
      }),
  });
  /** Ce que le moteur a reçu (effect.request), dans l'ordre. */
  const received: Record<string, unknown>[] = [];
  rt.client.on('event', (e: ChaosEvent) => {
    if (e.event === 'fake.request')
      received.push(e.body as Record<string, unknown>);
  });
  cleanup.push(async () => {
    await rt.stop();
    // La sortie du moteur écrit encore le journal (comptes rendus de fin) : nouvel essai si le dossier bouge.
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  });
  return { rt, dir, received };
}

async function listen(server: Server) {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise((r) => server.close(r)));
  return (server.address() as AddressInfo).port;
}

/** L'API locale de la page Chaos (ChaosRuntime.handle seul). */
async function serve(rt: ChaosRuntime) {
  const port = await listen(
    createServer((req, res) => {
      void rt
        .handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1'))
        .then((done) => {
          if (!done) res.writeHead(404).end();
        });
    }),
  );
  return async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chaos${path}`, {
      method: 'POST',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  };
}

type Item = {
  id: string;
  attempt_id: string;
  engine_request: Record<string, unknown>;
  duration_ms: number;
  lease_expires_at: string;
  /** Faux Core : rendue même si l'effet n'est pas dans `startable` (désaccord Core / moteur). */
  force?: boolean;
};
const item = (id: string, effect: string, extra = {}): Item => ({
  id,
  attempt_id: `att-${id.slice(0, 4)}`,
  engine_request: { effect, duration_ms: 5000, ...extra },
  duration_ms: 5000,
  lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
});

/** Faux Core Lab (Studio secret) : la file de `items`, les arrêts de `stops`, et tout ce que Studio lui a dit. */
async function fakeCore(items: Item[] = []) {
  const log: { path: string; body: Record<string, unknown> }[] = [];
  const stops: string[] = [];
  const port = await listen(
    createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += String(c)));
      req.on('end', () => {
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.headers.authorization !== 'Bearer s3cret')
          return send(401, { error: 'unauthorized' });
        const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
        const path = (req.url ?? '').replace(LAB, '');
        log.push({ path, body });
        if (path === '/heartbeat')
          return send(200, {
            ok: true,
            stop: stops.splice(0).map((id) => ({ id, reason: 'modération' })),
          });
        if (path === '/claim') {
          const i = items.findIndex(
            (x) =>
              x.force ||
              (body.startable as string[]).includes(
                String(x.engine_request.effect),
              ),
          );
          return send(200, { item: i >= 0 ? items.splice(i, 1)[0] : null });
        }
        if (/^\/requests\/[^/]+\/ack$/.test(path))
          return send(200, { ok: true });
        if (path === '/stop-all') return send(200, { ok: true });
        send(404, { error: 'not_found' });
      });
    }),
  );
  return {
    core: localLabCoreClient(`http://127.0.0.1:${port}`, 's3cret'),
    log,
    stops,
    items,
    acks: () =>
      log
        .filter((l) => l.path.endsWith('/ack'))
        .map(
          (l) =>
            ({ id: l.path.split('/')[2], ...l.body }) as {
              id: string;
              event: string;
              code?: string;
              played_ms?: number;
            },
        ),
    calls: (suffix: string) => log.filter((l) => l.path === suffix),
  };
}

async function startLoop(
  rt: ChaosRuntime,
  core: LabCoreCall,
  journal: string,
  heartbeatMs = 100,
) {
  const loop = await ChaosCoreLoop.open({
    runtime: rt,
    core,
    environment: 'lab',
    channelId: '900100',
    studioId: 'studio-test',
    journal,
    heartbeatMs,
  });
  loop.start();
  cleanup.push(() => loop.stop());
  return loop;
}

describe('Chaos lot 2 : cible et écran de la fiche', () => {
  it('schéma : { kind: screen, device } strict', () => {
    const base = { request_id: 'r1', effect: 'flip', source: { kind: 'core' } };
    expect(
      chaosEffectRequestSchema.safeParse({
        ...base,
        target: { kind: 'screen', device: D2 },
      }).success,
    ).toBe(true);
    for (const target of [
      { kind: 'screen' },
      { kind: 'screen', device: String.raw`C:\Windows` },
      { kind: 'screen', device: D2, hwnd: 4 },
    ])
      expect(
        chaosEffectRequestSchema.safeParse({ ...base, target }).success,
      ).toBe(false);
  });

  it('écran d’un choix de fiche : même règle que le moteur (ScreenLayout)', () => {
    const m = [
      { device: D2, order: 1, primary: true },
      { device: D1, order: 0 },
      { device: D3, order: 2 },
    ];
    expect(resolveScreens('left', m)).toEqual([D1]);
    expect(resolveScreens('right', m)).toEqual([D3]);
    expect(resolveScreens('primary', m)).toEqual([D2]);
    expect(resolveScreens('s:1', m)).toEqual([D2]);
    expect(resolveScreens('all', m)).toEqual([D1, D2, D3]);
    expect(resolveScreens(D3, m)).toEqual([D3]);
    expect(() => resolveScreens('s:2', m)).toThrow(/n'existe plus/);
    expect(() => resolveScreens('left', [])).toThrow(/aucun écran/);
  });
});

describe('Chaos lot 2 : route Lab « Jouer sur mon PC »', () => {
  it('la demande de la fiche joue aux règles d’un viewer (source extension, écran de la fiche, reject)', async () => {
    const { rt, received } = studio({
      FAKE_CHAOS_PLAY_MS: '3000',
      FAKE_CHAOS_DISABLED: 'blur',
    });
    const call = await serve(rt);
    const ok = await call('/lab/play', {
      effect: 'flip',
      duration_ms: 5000,
      level: 'leger',
      params: { angle: 180 },
      transition: { in: { kind: 'cut' } },
    });
    expect(ok).toMatchObject({
      status: 200,
      body: { ok: true, state: 'starting' },
    });
    expect(String(ok.body.request_id)).toMatch(/^lab-/);
    expect(received[0]).toMatchObject({
      effect: 'flip',
      level: 'leger',
      source: { kind: 'extension', ref: 'Lab Interactions' },
      // fiche de flip : écran droit
      target: { kind: 'screen', device: D2 },
      policy: 'reject',
    });
    // Même effet déjà actif sur cet écran : refusé tout de suite, jamais mis en file.
    expect(
      await call('/lab/play', { effect: 'flip', duration_ms: 5000 }),
    ).toMatchObject({
      status: 409,
      body: { ok: false, code: 'same_effect_active' },
    });
    // Désactivé dans sa fiche : refusé à une source communautaire.
    expect(await call('/lab/play', { effect: 'blur' })).toMatchObject({
      status: 409,
      body: { ok: false, code: 'effect_disabled' },
    });
    // Rien d'autre que la forme d'une fiche : ni priorité, ni source, ni cible.
    for (const extra of [
      { priority: 100 },
      { source: { kind: 'studio' } },
      { target: { kind: 'monitor' } },
    ])
      expect(
        await call('/lab/play', { effect: 'mirror', ...extra }),
      ).toMatchObject({
        status: 400,
        body: { ok: false, code: 'invalid_request' },
      });
    expect(received).toHaveLength(3);
  });

  it('même hôte + en-tête Studio sur /api/chaos/* ; route Lab refusée en profil Production', async () => {
    const { rt, received } = studio();
    const req = (
      port: number,
      path: string,
      headers: Record<string, string>,
      body?: unknown,
    ) =>
      new Promise<{ status: number; body: Record<string, unknown> }>(
        (resolve, reject) => {
          const r = httpRequest(
            {
              host: '127.0.0.1',
              port,
              path,
              method: body === undefined ? 'GET' : 'POST',
              headers: { 'content-type': 'application/json', ...headers },
            },
            (res) => {
              let data = '';
              res.on('data', (c) => (data += String(c)));
              res.on('end', () =>
                resolve({
                  status: res.statusCode!,
                  body: JSON.parse(data) as Record<string, unknown>,
                }),
              );
            },
          );
          r.on('error', reject);
          r.end(body === undefined ? undefined : JSON.stringify(body));
        },
      );
    const studioHost = { host: '127.0.0.1:4100', 'x-raptoru-studio': '1' };
    const lab = await listen(
      createStudioServer({ lab: {} as never, onShutdown: () => {}, chaos: rt }),
    );
    // Rebinding DNS : un autre nom d'hôte, même avec l'en-tête, est refusé avant le moteur.
    for (const path of ['/api/chaos/state', '/api/chaos/lab/play'])
      expect(
        await req(
          lab,
          path,
          { ...studioHost, host: 'evil.example:4100' },
          path.endsWith('play') ? { effect: 'flip' } : undefined,
        ),
      ).toMatchObject({ status: 403, body: { error: 'forbidden_host' } });
    expect(
      (await req(lab, '/api/chaos/state', { host: '127.0.0.1:4100' })).status,
    ).toBe(403);
    expect((await req(lab, '/api/chaos/state', studioHost)).status).toBe(200);
    expect(
      await req(lab, '/api/chaos/lab/play', studioHost, { effect: 'flip' }),
    ).toMatchObject({ status: 200, body: { ok: true } });
    const production = await listen(
      createStudioServer({
        lab: {} as never,
        onShutdown: () => {},
        chaos: rt,
        profile: { plan: { effective: 'production' } } as never,
      }),
    );
    expect(
      await req(production, '/api/chaos/lab/play', studioHost, {
        effect: 'mirror',
      }),
    ).toMatchObject({
      status: 409,
      body: { ok: false, error: 'production_profile' },
    });
    expect(received.map((r) => r.effect)).toEqual(['flip']);
  });
});

describe('Chaos lot 2 : boucle du Core', () => {
  it('heartbeat, claim des effets qui peuvent démarrer, livraison (source core, écran, reject), acks started → ended, STOP ALL', async () => {
    const { rt, dir, received } = studio({ FAKE_CHAOS_PLAY_MS: '1200' });
    await rt.client.ready();
    const id = randomUUID();
    const core = await fakeCore([item(id, 'flip')]);
    await startLoop(rt, core.core, join(dir, 'core-journal.json'));
    await until(() => core.acks().some((a) => a.event === 'ended'));
    const acks = core.acks();
    expect(acks.map((a) => a.event)).toEqual(['started', 'ended']);
    expect(acks[1]).toMatchObject({
      id,
      studio_instance_id: 'studio-test',
      attempt_id: `att-${id.slice(0, 4)}`,
      event: 'ended',
      code: 'duration',
    });
    expect(acks[1]!.played_ms).toBeGreaterThanOrEqual(1000);
    expect(received).toEqual([
      expect.objectContaining({
        request_id: `core-${id}`,
        effect: 'flip',
        source: { kind: 'core', ref: id },
        target: { kind: 'screen', device: D2 },
        policy: 'reject',
      }),
    ]);
    const beat = core.calls('/heartbeat').find((c) => c.body.engine_ready);
    expect(beat?.body).toMatchObject({
      studio_instance_id: 'studio-test',
      engine_ready: true,
      safety_max_ms: 30000,
      safe_mode: false,
      effects: {
        flip: { enabled: true },
        mirror: { enabled: true },
        blur: { enabled: true },
      },
    });
    // Effet interne (tests) : jamais proposé au Core.
    expect(beat?.body.effects).not.toHaveProperty('blink');
    expect(
      core
        .calls('/heartbeat')
        .some((c) => (c.body.inflight as string[]).includes(id)),
    ).toBe(true);
    const claims = core.calls('/claim').map((c) => c.body.startable);
    expect(claims[0]).toEqual(['flip', 'mirror', 'blur']);
    // Pendant que flip joue sur l'écran droit : son emplacement (transform) y est pris, blur (écran principal) reste.
    expect(claims).toContainEqual(['blur']);
    // STOP ALL de Studio : dit au Core.
    const call = await serve(rt);
    expect((await call('/stop-all', {})).status).toBe(200);
    await until(() => core.calls('/stop-all').length);
    expect(core.calls('/stop-all')[0]!.body).toEqual({
      studio_instance_id: 'studio-test',
    });
  });

  it('refus du moteur ou demande invalide → failed avec le code, rien d’autre envoyé', async () => {
    const { rt, dir, received } = studio({ FAKE_CHAOS_DISABLED: 'blur' });
    await rt.client.ready();
    const [a, b] = [randomUUID(), randomUUID()];
    const core = await fakeCore([
      { ...item(a, 'blur'), force: true },
      { ...item(b, 'flip', { priority: 100 }), force: true },
    ]);
    await startLoop(rt, core.core, join(dir, 'core-journal.json'));
    await until(() => core.acks().length >= 2);
    expect(core.acks()).toEqual([
      expect.objectContaining({
        id: a,
        event: 'failed',
        code: 'effect_disabled',
      }),
      expect.objectContaining({
        id: b,
        event: 'failed',
        code: 'invalid_request',
      }),
    ]);
    // blur désactivé : jamais dans `startable` ; la demande invalide n'a jamais atteint le moteur.
    expect(
      core
        .calls('/claim')
        .every((c) => !(c.body.startable as string[]).includes('blur')),
    ).toBe(true);
    expect(received.map((r) => r.request_id)).toEqual([`core-${a}`]);
  });

  it('arrêt demandé par la modération (heartbeat) → effect.cancel → ended avec la durée jouée', async () => {
    const { rt, dir } = studio({ FAKE_CHAOS_PLAY_MS: '20000' });
    await rt.client.ready();
    const id = randomUUID();
    const core = await fakeCore([item(id, 'flip')]);
    await startLoop(rt, core.core, join(dir, 'core-journal.json'));
    await until(() => core.acks().some((a) => a.event === 'started'));
    core.stops.push(id);
    await until(() => core.acks().some((a) => a.event === 'ended'));
    const ended = core.acks().find((a) => a.event === 'ended')!;
    expect(ended).toMatchObject({ id, code: 'moderation' });
    expect(ended.played_ms).toBeLessThan(20000);
  });

  it('sortie du moteur pendant un effet → ended engine_exit, puis STOP ALL au Core', async () => {
    const { rt, dir } = studio({ FAKE_CHAOS_PLAY_MS: '20000' });
    await rt.client.ready();
    const id = randomUUID();
    const core = await fakeCore([item(id, 'flip')]);
    await startLoop(rt, core.core, join(dir, 'core-journal.json'));
    await until(() => core.acks().some((a) => a.event === 'started'));
    await rt.client.stop();
    await until(
      () =>
        core.acks().some((a) => a.event === 'ended') &&
        core.calls('/stop-all').length,
    );
    expect(core.acks().find((a) => a.event === 'ended')).toMatchObject({
      id,
      code: 'engine_exit',
    });
  });

  it('redémarrage de Studio : rien n’est rejoué, les comptes rendus en attente sont renvoyés', async () => {
    const { rt, dir, received } = studio();
    await rt.client.ready();
    const [lost, pending, running] = [randomUUID(), randomUUID(), randomUUID()];
    const journal = join(dir, 'core-journal.json');
    const entry = (id: string, extra: Record<string, unknown>) => ({
      id,
      attempt_id: `old-${id.slice(0, 4)}`,
      effect: 'flip',
      duration_ms: 5000,
      delivered: true,
      delivered_at: Date.now() - 2000,
      started_at: null,
      acks: [],
      reported: 0,
      ...extra,
    });
    writeFileSync(
      journal,
      JSON.stringify({
        studio: 'studio-test',
        done: [lost, pending, running],
        entries: [
          // envoyée au moteur, jamais démarrée
          entry(lost, {}),
          // finie, compte rendu `ended` jamais arrivé au Core
          entry(pending, {
            started_at: Date.now() - 1500,
            acks: [
              { event: 'started' },
              { event: 'ended', code: 'duration', played_ms: 1200 },
            ],
            reported: 1,
          }),
          // démarrée, fin inconnue (le moteur est mort avec Studio)
          entry(running, {
            started_at: Date.now() - 1000,
            acks: [{ event: 'started' }],
            reported: 1,
          }),
        ],
      }),
    );
    // Le Core repropose la première (nouvel essai) : jamais rejouée.
    const core = await fakeCore([
      { ...item(lost, 'flip'), attempt_id: 'new-attempt' },
    ]);
    await startLoop(rt, core.core, journal);
    await until(() => core.acks().length >= 4);
    expect(core.acks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: lost,
          attempt_id: `old-${lost.slice(0, 4)}`,
          event: 'failed',
          code: 'studio_restart',
        }),
        expect.objectContaining({
          id: pending,
          event: 'ended',
          code: 'duration',
          played_ms: 1200,
        }),
        expect.objectContaining({
          id: running,
          event: 'ended',
          code: 'unknown_end',
        }),
        expect.objectContaining({
          id: lost,
          attempt_id: 'new-attempt',
          event: 'failed',
          code: 'already_delivered',
        }),
      ]),
    );
    expect(core.acks()).toHaveLength(4);
    expect(received).toEqual([]);
    await until(
      () =>
        (JSON.parse(readFileSync(journal, 'utf8')) as { entries: unknown[] })
          .entries.length === 0,
    );
    expect(
      (JSON.parse(readFileSync(journal, 'utf8')) as { done: string[] }).done,
    ).toContain(lost);
  });

  it('Core injoignable : la boucle s’espace sans planter, puis reprend', async () => {
    const { rt, dir } = studio();
    await rt.client.ready();
    const real = await fakeCore();
    let down = true;
    const paths: string[] = [];
    const core: LabCoreCall = (path, body, o) => {
      paths.push(path);
      return down
        ? Promise.reject(new TypeError('fetch failed'))
        : real.core(path, body, o);
    };
    const loop = await startLoop(rt, core, join(dir, 'core-journal.json'), 300);
    await sleep(3200);
    // Sans espacement : un battement à chaque tour (~5 en 3 s) ; avec : 0, 0,9 s, 2,9 s.
    expect(paths.length).toBeLessThanOrEqual(3);
    expect(paths.every((p) => p.endsWith('/heartbeat'))).toBe(true);
    expect(loop.error).toBe('fetch failed');
    down = false;
    await until(
      () => real.calls('/claim').length && loop.error === null,
      10_000,
    );
  });
});
