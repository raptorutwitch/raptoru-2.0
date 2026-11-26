import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { V2_PREFIX } from '../src/chaos/obs-output.js';
import { ChaosRuntime } from '../src/chaos/runtime.js';
import { FakeObs } from './fixtures/fake-obs.js';

// Mode C de bout en bout (docs/chaos/MODE_C.md) : le VRAI moteur et l'API Studio de la page Chaos, OBS simulé. Les
// activations sont « OBS uniquement » : aucun calque, rien ne s'affiche (aucun test visible). Une commande Studio → une
// session du moteur (partition calculée avant le départ) → filtres réglés, activés au départ, recalés à l'arrêt
// anticipé, coupés à la fin et par STOP ALL ; aucun autre filtre touché.

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', '..');
const REAL =
  process.env.CHAOS_ENGINE_EXE ??
  join(ROOT, 'apps', 'chaos-engine', 'bin', 'ChaosEngine.exe');
const dir = mkdtempSync(join(tmpdir(), 'chaos-mode-c-'));
const cleanup: (() => unknown)[] = [];
afterAll(async () => {
  for (const c of cleanup.splice(0)) await c();
  rmSync(dir, { recursive: true, force: true });
});

const until = async (f: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe.runIf(process.platform === 'win32' && existsSync(REAL))(
  'Chaos mode C : une commande, une session, filtres OBS pilotés (vrai moteur, OBS simulé, rien d’affiché)',
  () => {
    it('préparation, activation, arrêt anticipé recalé, STOP ALL, effet sans version OBS refusé en « OBS uniquement »', async () => {
      const obs = new FakeObs();
      const rt = new ChaosRuntime({
        exe: REAL,
        stateDir: dir,
        obs: () => obs,
      });
      cleanup.push(() => rt.stop());
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
      const call = async (path: string, body?: unknown) => {
        const res = await fetch(base + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'x-raptoru-studio': '1',
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return {
          status: res.status,
          body: (await res.json()) as Record<string, unknown>,
        };
      };

      // L'écran que vise la fiche (écran principal par défaut) est celui que capture la source « Écran ».
      const screens = (await call('/screens')).body.monitors as {
        device: string;
        primary: boolean;
      }[];
      const device = (screens.find((m) => m.primary) ?? screens[0])!.device;
      expect(
        (await call('/obs/config', { mode: 'obs', source: 'Écran', device }))
          .status,
      ).toBe(200);
      const pv = (await call('/obs/preview')).body as {
        create: string[];
        untouched: string[];
      };
      expect(pv.create.length).toBeGreaterThanOrEqual(12);
      expect(pv.untouched).toEqual([
        'Raptoru Chaos · Retourné',
        'Correction des couleurs',
      ]);
      expect((await call('/obs/prepare', {})).status).toBe(400); // confirmation obligatoire
      const prep = (await call('/obs/prepare', { confirm: true })).body as {
        created: string[];
      };
      expect(prep.created).toEqual(pv.create);
      const st = (await call('/obs?force=1')).body as {
        ready: boolean;
        reasons: string[];
      };
      expect(st.reasons).toEqual([]);
      expect(st.ready).toBe(true);
      const v1Before = JSON.stringify(
        obs.filters.filter((f) => !f.filterName.startsWith(V2_PREFIX)),
      );

      // Activation « Activer » : une seule commande ; sortie OBS seule (aucun calque).
      const act = await call('/activate', { effect: 'mirror', kind: 'manual' });
      expect(act.status).toBe(200);
      const views = act.body.activations as {
        outputs: { screen: boolean; obs: boolean };
      }[];
      expect(views[0]!.outputs).toMatchObject({ screen: false, obs: true });
      const mirror = () =>
        obs.filters.find((f) => f.filterName === `${V2_PREFIX}Miroir`)!;
      await until(() => mirror().filterEnabled);
      const s0 = mirror().filterSettings;
      expect(String(s0.chaos_track)).toMatch(/\.png$/);
      expect(existsSync(String(s0.chaos_track))).toBe(true);
      expect(s0.chaos_t_base).toBe(0);
      expect(Number(s0.chaos_expires)).toBeGreaterThan(Number(s0.chaos_since));

      // Arrêt anticipé : la sortie OBS reçoit une nouvelle partition (sortie animée à partir de maintenant), puis coupée.
      await new Promise((r) => setTimeout(r, 800));
      expect((await call('/stop', { effect: 'mirror' })).status).toBe(200);
      await until(() => Number(mirror().filterSettings.chaos_t_base) > 0.5);
      await until(() => !mirror().filterEnabled, 6000);

      // STOP ALL pendant un brouillard : coupé tout de suite.
      await call('/activate', { effect: 'fog', kind: 'manual' });
      const fog = () =>
        obs.filters.find((f) => f.filterName === `${V2_PREFIX}Brouillard`)!;
      await until(() => fog().filterEnabled);
      await call('/stop-all', {});
      await until(() => !fog().filterEnabled, 1500);

      // Écran ivre : deux passes, deux filtres, activés ensemble puis coupés.
      await call('/activate', { effect: 'drunk', kind: 'test' });
      const drunk = () =>
        obs.filters.filter((f) =>
          f.filterName.startsWith(`${V2_PREFIX}Écran ivre`),
        );
      await until(
        () => drunk().length === 2 && drunk().every((f) => f.filterEnabled),
      );
      await until(() => drunk().every((f) => !f.filterEnabled), 12_000);

      // Flash : pas de version OBS ; en « OBS uniquement », refus explicite (aucun rendu incohérent).
      const flash = await call('/activate', { effect: 'flash', kind: 'test' });
      expect(flash.status).toBe(409);
      expect(String(flash.body.message)).toMatch(/Sortie OBS impossible/);

      expect(
        JSON.stringify(
          obs.filters.filter((f) => !f.filterName.startsWith(V2_PREFIX)),
        ),
      ).toBe(v1Before);
      expect(
        obs.filters.filter(
          (f) => f.filterName.startsWith(V2_PREFIX) && f.filterEnabled,
        ),
      ).toEqual([]);
    }, 60_000);
  },
);
