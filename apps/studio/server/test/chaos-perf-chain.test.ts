import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AB_PLAN,
  type AbApi,
  abRun,
} from '../../../chaos-engine/tools/ab-run.mjs';
import { PerfLab } from '../src/chaos/perf.js';
import { ChaosRuntime } from '../src/chaos/runtime.js';

// Mesures en jeu enchaînées du Performance Lab (A/B du banc en jeu, docs/chaos/BENCH_EFFETS.md § 8.5). Non-régression
// du 25/11 : l'A/B s'arrêtait au 2e essai (« une mesure en jeu est déjà en cours » juste après « done »). Vrai PerfLab
// et vrai runtime Studio (API HTTP) ; faux moteur et fausse télémétrie : rien d'affiché, rien de mesuré sur le PC.

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fixtures', 'fake-chaos-engine.mjs');
const MONITOR = join(here, 'fixtures', 'fake-chaos-perf-monitor.mjs');
const spawnFake = (args: string[]) =>
  spawn(
    process.execPath,
    [args[0] === '--perf-monitor' ? MONITOR : FAKE, ...args],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FAKE_CHAOS_EFFECTS: AB_PLAN.join(',') },
    },
  );
const PHASES = { reference_s: 1, effect_s: 1, after_s: 1 };

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
});

/** Prochaine phase « check » de la boucle d'événements : juste après le minuteur qui a fini la mesure, avant que la
 *  sortie du processus de télémétrie (asynchrone) ne soit signalée. */
const tick = () => new Promise((r) => setImmediate(r));

async function serve(handle: RequestListener) {
  const server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function client(base: string): AbApi {
  const call = async (path: string, init?: RequestInit) => {
    const r = await fetch(base + path, {
      ...init,
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
    });
    return { status: r.status, body: (await r.json()) as unknown };
  };
  return {
    get: (path) => call(path),
    post: (path, body) =>
      call(path, { method: 'POST', body: JSON.stringify(body) }),
  };
}
async function studio() {
  const dir = mkdtempSync(join(tmpdir(), 'chaos-ab-'));
  const rt = new ChaosRuntime({
    exe: 'x',
    stateDir: dir,
    spawnImpl: spawnFake,
    pingMs: 50,
    perfMinPhaseS: 1,
  });
  cleanup.push(async () => {
    await rt.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return client(
    await serve((req, res) => {
      void rt
        .handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1'))
        .then((done) => {
          if (!done) res.writeHead(404).end();
        });
    }),
  );
}

describe('Performance Lab : mesures en jeu enchaînées', () => {
  it('six mesures de suite : la suivante démarre dans la boucle même où « done » apparaît, sans refus « busy »', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chaos-perf-chain-'));
    const calls: string[] = [];
    const p = new PerfLab(
      'x',
      dir,
      (cmd, args) => {
        calls.push(`${cmd}:${String(args?.effect)}`);
        return Promise.resolve({});
      },
      spawnFake,
    );
    cleanup.push(() => {
      p.stop();
      rmSync(dir, { recursive: true, force: true });
    });
    for (const effect of AB_PLAN) {
      await p.startLive({ effect, ...PHASES });
      const end = Date.now() + 15_000;
      while (p.state().live.status === 'running' && Date.now() < end)
        await tick();
      expect(p.state().live.status).toBe('done');
      // Studio libre au même instant que « done » : la mesure suivante (tour de boucle suivant) ne doit pas être refusée.
      expect(p.state().live_available).toBe(true);
    }
    expect(p.state().live_results.map((r) => r.effect)).toEqual(
      [...AB_PLAN].reverse(),
    );
    expect(calls).toEqual(
      AB_PLAN.flatMap((e) => [`effect.activate:${e}`, `effect.stop:${e}`]),
    );
  }, 60_000);

  it('A/B par l’API de Studio : six essais enchaînés, chacun confirmé côté serveur ; ni mesure ni effet restants', async () => {
    const api = await studio();
    const marks: string[] = [];
    const notes: Record<string, unknown>[] = [];
    const r = await abRun(api, {
      phases: PHASES,
      pollMs: 50,
      mark: (m) => marks.push(m),
      note: (n) => notes.push(n),
    });
    expect(r.failed).toBeNull();
    expect(r.done).toBe(6);
    expect(r.results.map((x) => x.effect)).toEqual(AB_PLAN);
    expect(marks).toEqual(AB_PLAN.map((e, i) => `ab-${i + 1}-${e}`));
    expect(notes).toEqual([]); // jamais « busy », jamais de nettoyage
    const perf = (await api.get('/api/chaos/perf')).body as {
      live_available: boolean;
      live_results: unknown[];
    };
    expect(perf.live_available).toBe(true);
    expect(perf.live_results).toHaveLength(6);
    expect(
      ((await api.get('/api/chaos/state')).body as { status: { active: [] } })
        .status.active,
    ).toEqual([]);
  }, 90_000);

  it('A/B : un essai qui échoue arrête le déroulé et laisse Studio propre (aucune mesure, aucun effet)', async () => {
    const api = await studio();
    const notes: Record<string, unknown>[] = [];
    const r = await abRun(api, {
      plan: ['diag.watermark', 'nope', 'fog'],
      phases: PHASES,
      pollMs: 50,
      note: (n) => notes.push(n),
    });
    expect(r.done).toBe(1);
    expect(r.failed).toMatchObject({ effect: 'nope', reason: 'mesure failed' });
    expect(r.clean).toBe(true);
    expect(notes.map((n) => n.step)).toEqual(['ab-erreur', 'ab-nettoyage']);
    const perf = (await api.get('/api/chaos/perf')).body as {
      live_available: boolean;
      live_results: { effect: string }[];
    };
    expect(perf.live_available).toBe(true);
    expect(perf.live_results.map((x) => x.effect)).toEqual(['diag.watermark']);
    expect(
      ((await api.get('/api/chaos/state')).body as { status: { active: [] } })
        .status.active,
    ).toEqual([]);
  }, 60_000);

  it('Studio d’avant le correctif (chaos.9) : « busy » juste après « done » est redemandé selon l’état du serveur, sans échec', async () => {
    // Faux Studio : pas de live_available ; après chaque mesure, la place n'est rendue qu'après 3 démarrages refusés.
    let n = 0,
      run: { effect: string; at: number } | null = null,
      refusals = 0;
    const results: { effect: string; at: string }[] = [];
    const base = await serve((req, res) => {
      const send = (code: number, body: unknown) =>
        res
          .writeHead(code, { 'content-type': 'application/json' })
          .end(JSON.stringify(body));
      const status = () => {
        if (run && Date.now() - run.at > 120) {
          results.unshift({ effect: run.effect, at: String(++n) });
          run = null;
          refusals = 3;
        }
        return run ? 'running' : 'done';
      };
      if (req.url === '/api/chaos/perf')
        return send(200, {
          live: { status: status(), effect: run?.effect },
          live_results: results,
        });
      if (req.url === '/api/chaos/state')
        return send(200, { status: { active: [] } });
      if (req.url === '/api/chaos/perf/live/start') {
        let b = '';
        req.on('data', (d: Buffer) => (b += d.toString()));
        req.on('end', () => {
          status();
          if (run || refusals-- > 0)
            return send(409, {
              error: 'busy',
              message: 'une mesure en jeu est déjà en cours',
            });
          run = {
            effect: (JSON.parse(b) as { effect: string }).effect,
            at: Date.now(),
          };
          send(200, { status: 'running' });
        });
        return;
      }
      send(404, {});
    });
    refusals = 0;
    const notes: Record<string, unknown>[] = [];
    const r = await abRun(client(base), {
      phases: PHASES,
      pollMs: 20,
      note: (x) => notes.push(x),
    });
    expect(r.failed).toBeNull();
    expect(r.results.map((x) => x.effect)).toEqual(AB_PLAN);
    expect(notes.filter((x) => x.step === 'ab-occupe')).toHaveLength(15); // 3 refus × 5 enchaînements
  }, 30_000);
});
