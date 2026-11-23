import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CHAOS_COMMANDS, chaosRegistrySchema } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { ChaosEngineClient, ChaosError } from '../src/chaos/engine-client.js';
import { ChaosRuntime } from '../src/chaos/runtime.js';

// Studio ↔ moteur Chaos : pilote (corrélation, battements, relance, arrêt) et API locale de la page Chaos, sur un faux
// moteur ; puis le vrai moteur quand il est construit (Windows, apps/chaos-engine/bin/ChaosEngine.exe).

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fixtures', 'fake-chaos-engine.mjs');
const ROOT = join(here, '..', '..', '..', '..');
const REAL =
  process.env.CHAOS_ENGINE_EXE ??
  join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe');
const fake =
  (env: Record<string, string> = {}) =>
  (args: string[]) =>
    spawn(process.execPath, [FAKE, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
});

function client(
  o: Partial<ConstructorParameters<typeof ChaosEngineClient>[0]> = {},
) {
  const c = new ChaosEngineClient({
    exe: 'absent.exe',
    stateDir: tmpdir(),
    spawnImpl: fake(),
    pingMs: 50,
    restartDelaysMs: [20],
    ...o,
  });
  cleanup.push(() => c.stop());
  return c;
}

async function serve(rt: ChaosRuntime) {
  const server: Server = createServer((req, res) => {
    void rt
      .handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1'))
      .then((done) => {
        if (!done) res.writeHead(404).end();
      });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chaos`;
  const call = async (path: string, body?: unknown, studio = true) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: studio
        ? { 'x-raptoru-studio': '1', 'content-type': 'application/json' }
        : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  };
  return call;
}

describe('pilote du moteur Chaos', () => {
  it('démarre, se déclare prêt, corrèle les réponses et transmet les arguments de sûreté', async () => {
    const c = client();
    await c.ready();
    expect(c.state.status).toBe('ready');
    const args = (c.state.hello as { args: string[] }).args;
    expect(args).toEqual(
      expect.arrayContaining([
        '--serve',
        '--parent',
        String(process.pid),
        '--heartbeat-ms',
      ]),
    );
    const [a, b] = await Promise.all([c.call('describe'), c.call('status')]);
    expect(a).toHaveProperty('registry');
    expect(b).toHaveProperty('active');
  });

  it('rend une erreur typée quand le moteur refuse', async () => {
    const c = client();
    await expect(
      c.call('effect.request', { effect: 'inconnu' }),
    ).rejects.toMatchObject({ code: 'unknown_effect' });
    await expect(c.call('format' as never)).rejects.toBeInstanceOf(ChaosError);
  });

  it('envoie des battements réguliers', async () => {
    const c = client();
    await c.ready();
    await new Promise((r) => setTimeout(r, 300));
    const r = await c.call<{ pings: number }>('ping');
    expect(r.pings).toBeGreaterThanOrEqual(4);
  });

  it('relance le moteur après une panne, et rejette les demandes en cours', async () => {
    const c = client({
      spawnImpl: fake({ FAKE_CHAOS_CRASH_AFTER: '3' }),
      pingMs: 10_000,
    });
    await c.ready();
    await c.call('status');
    await expect(c.call('status')).resolves.toBeDefined();
    await expect(c.call('status')).rejects.toMatchObject({
      code: 'engine_exited',
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(c.state.restarts).toBe(1);
    expect(c.state.lastExit?.code).toBe(7);
    await c.ready();
    expect(c.state.status).toBe('ready');
  });

  it('s’arrête proprement sans relance', async () => {
    const c = client();
    await c.ready();
    await c.stop();
    expect(c.state.status).toBe('stopped');
    await new Promise((r) => setTimeout(r, 100));
    expect(c.state.status).toBe('stopped');
  });
});

describe('API locale Studio › Chaos', () => {
  it('refuse un appel qui ne vient pas de Studio', async () => {
    const call = await serve(
      new ChaosRuntime({
        exe: 'x',
        stateDir: tmpdir(),
        spawnImpl: fake(),
        pingMs: 50,
      }),
    );
    expect((await call('/state', undefined, false)).status).toBe(403);
  });

  it('état, cibles, essai validé (source studio), refus d’un corps invalide, STOP ALL', async () => {
    const rt = new ChaosRuntime({
      exe: 'x',
      stateDir: tmpdir(),
      spawnImpl: fake(),
      pingMs: 50,
    });
    cleanup.push(() => rt.stop());
    const call = await serve(rt);
    const st = await call('/state');
    expect(st.status).toBe(200);
    expect(st.body.registry).toMatchObject({
      registry: { schema: 'raptoru.chaos.registry' },
    });
    expect((await call('/targets')).body).toMatchObject({
      monitors: [{ device: String.raw`\\.\DISPLAY1`, primary: true }],
      windows: [{ hwnd: 42 }],
    });
    const screen = await call('/test', {
      effect: 'flip',
      target: { kind: 'monitor', device: String.raw`\\.\DISPLAY2` },
    });
    expect(screen.status).toBe(200);
    expect(screen.body).toMatchObject({
      target: { kind: 'monitor', device: String.raw`\\.\DISPLAY2` },
    });
    const badScreen = await call('/test', {
      effect: 'flip',
      target: { kind: 'monitor', device: String.raw`C:\Windows` },
    });
    expect(badScreen.status).toBe(400);
    const ok = await call('/test', {
      effect: 'flip',
      target: { kind: 'window', hwnd: 42 },
      duration_ms: 5000,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      state: 'starting',
      source: { kind: 'studio' },
    });
    expect(String(ok.body.request_id)).toMatch(/^studio-/);
    const bad = await call('/test', { effect: 'flip', prix: 100 });
    expect(bad).toMatchObject({
      status: 400,
      body: { error: 'invalid_request' },
    });
    const forged = await call('/test', {
      effect: 'flip',
      source: { kind: 'core' },
    });
    expect(forged.status).toBe(200);
    expect(forged.body).toMatchObject({ source: { kind: 'studio' } });
    expect((await call('/stop-all', {})).body).toEqual({ stopped: 1 });
    expect((await call('/rien')).status).toBe(404);
  });

  it('fiche d’un effet : Tester et Activer avec ses réglages enregistrés, Arrêter l’effet', async () => {
    const rt = new ChaosRuntime({
      exe: 'x',
      stateDir: tmpdir(),
      spawnImpl: fake(),
      pingMs: 50,
    });
    cleanup.push(() => rt.stop());
    const call = await serve(rt);
    const test = await call('/activate', { effect: 'flip', kind: 'test' });
    expect(test.status).toBe(200);
    expect(test.body).toMatchObject({
      effect: 'flip',
      kind: 'test',
      activations: [{ source: { kind: 'studio' } }],
    });
    const acts = (test.body as { activations: { request_id: string }[] })
      .activations;
    expect(String(acts[0]!.request_id)).toMatch(/^studio-test-/);
    const manual = await call('/activate', {
      effect: 'flip',
      kind: 'n’importe quoi',
      source: { kind: 'core' },
    });
    expect(manual.body).toMatchObject({
      kind: 'manual',
      activations: [{ source: { kind: 'studio' } }],
    });
    expect((await call('/activate', { effect: '../flip' })).status).toBe(400);
    expect((await call('/activate', { effect: 'nope' })).body).toMatchObject({
      error: 'unknown_effect',
    });
    expect((await call('/stop', { effect: 'flip' })).body).toEqual({
      effect: 'flip',
      stopped: 2,
    });
  });

  it('moteur plus ancien que Studio : la page reçoit les commandes qu’il ne connaît pas', async () => {
    for (const [env, missing] of [
      [{}, []],
      [{ FAKE_CHAOS_OLD: '1' }, ['effect.activate', 'effect.stop']],
    ] as const) {
      const rt = new ChaosRuntime({
        exe: 'x',
        stateDir: tmpdir(),
        spawnImpl: fake(env),
        pingMs: 50,
      });
      cleanup.push(() => rt.stop());
      const call = await serve(rt);
      await call('/targets'); // démarre le moteur
      const st = await call('/state');
      expect(st.body).toMatchObject({
        engine: { status: 'ready', missing_commands: missing },
      });
    }
  });

  it('moteur absent : la page le dit, les actions répondent 503', async () => {
    const rt = new ChaosRuntime({
      exe: join(tmpdir(), 'pas-de-moteur.exe'),
      stateDir: tmpdir(),
    });
    const call = await serve(rt);
    const st = await call('/state');
    expect(st.body).toMatchObject({
      engine: { status: 'absent', available: false },
      registry: null,
    });
    expect(await call('/targets')).toMatchObject({
      status: 503,
      body: { error: 'engine_absent' },
    });
  });
});

describe('registre unique des effets', () => {
  it('le fichier partagé respecte le contrat (Studio, Core, extension)', () => {
    const raw = JSON.parse(
      readFileSync(
        join(ROOT, 'packages', 'schemas', 'src', 'chaos-registry.json'),
        'utf8',
      ),
    ) as unknown;
    const reg = chaosRegistrySchema.parse(raw);
    expect(reg.effects.find((e) => e.id === 'flip')).toMatchObject({
      internal: false,
      slot: 'transform',
      input: 'invert_xy',
    });
    expect(reg.input_effects?.invert_xy.scope).toBe('monitor');
  });
});

describe.runIf(process.platform === 'win32' && existsSync(REAL))(
  'vrai moteur (Windows)',
  () => {
    it('démarre, décrit le registre conforme au contrat, lit sa configuration et s’arrête', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'chaos-studio-'));
      cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
      const c = new ChaosEngineClient({
        exe: REAL,
        stateDir: dir,
        pingMs: 500,
      });
      cleanup.push(() => c.stop());
      await c.ready(15_000);
      const d = await c.call<{ registry: unknown; implemented: string[] }>(
        'describe',
      );
      const reg = chaosRegistrySchema.parse(d.registry);
      expect(d.implemented.sort()).toEqual(reg.effects.map((e) => e.id).sort());
      expect(await c.call('config.get')).toMatchObject({
        schema: 'raptoru.chaos.config',
        version: 5,
        engine: { default_mode: 'window', input_effects: false },
        performance: { profile: 'equilibre', on_overload: 'reduire' },
        effects: { flip: { enabled: true, screen: 'primary', cursor: true } },
      });
      const t = await c.call<{ monitors: { device: string }[] }>(
        'targets.list',
      );
      expect(t).toHaveProperty('windows');
      expect(t.monitors.length).toBeGreaterThan(0);
      expect(t.monitors[0]!.device).toMatch(/^\\\\\.\\DISPLAY\d+$/);
      // Écrans rangés de gauche à droite, nommés pour le streamer (jamais DISPLAYn seul).
      const xs = (
        t.monitors as unknown as { x: number; label: string; key: string }[]
      ).map((m) => m.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      expect((t.monitors as unknown as { label: string }[])[0]!.label).toMatch(
        /^Écran/,
      );
      // Toutes les commandes de Studio sont servies par ce moteur (jamais « commande inconnue »), et la fiche d'un
      // effet passe par le vrai protocole : effet inconnu refusé comme tel, sans rien afficher.
      expect(c.state.hello?.commands).toEqual(
        expect.arrayContaining([...CHAOS_COMMANDS]),
      );
      for (const cmd of ['effect.activate', 'effect.stop'] as const)
        await expect(c.call(cmd, { effect: 'nope' })).rejects.toMatchObject({
          code: 'unknown_effect',
        });
      await c.stop();
      expect(c.state.status).toBe('stopped');
    }, 30_000);
  },
);
