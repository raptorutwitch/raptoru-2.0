import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { chaosLabRoutes } from '../../../core-api/src/http/chaos-routes.js';
import { HttpError } from '../../../core-api/src/http/server.js';
import { editWallet } from '../../../core-api/src/lab-moderation/store.js';
import { setup } from '../../../core-api/test/helpers.js';
import { ChaosCoreLoop } from '../src/chaos/core-loop.js';
import { ChaosRuntime } from '../src/chaos/runtime.js';
import type { LabCoreCall } from '../src/lab-moderation/proxy.js';

// Chaos V2 lot 2, bout à bout sans affichage : le VRAI service Chaos du Core (PGlite, Jetons du Lab) ↔ la VRAIE boucle
// Studio (core-loop) ↔ un faux moteur. Un achat est débité une fois, livré, joué, terminé ; un effet que le moteur
// refuse est remboursé intégralement, automatiquement. Le Core est appelé par ses routes Lab, en mémoire.
const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, 'fixtures', 'fake-chaos-engine.mjs');
const CH = '900700';
const VIEWER = { id: '900701', display_name: 'Viewer1' };
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(
  fn: () => Promise<T> | T,
  ms = 10_000,
): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error('timeout');
    await sleep(50);
  }
}

function engine(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'chaos-e2e-'));
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
  cleanup.push(async () => {
    await rt.stop();
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  });
  return { rt, dir };
}

/** Le Core appelé par ses routes Lab, en mémoire (comme le ferait le relais HTTP de Studio). */
function inProcess(core: Awaited<ReturnType<typeof setup>>): LabCoreCall {
  const routes = chaosLabRoutes(core.chaos);
  return (async (path: string, body?: unknown) => {
    const url = new URL(path, 'http://core.lab');
    const method = body === undefined ? 'GET' : 'POST';
    const route = routes.find(
      (r) => r.method === method && r.pattern.test(url.pathname),
    );
    if (!route) throw Object.assign(new Error('not_found'), { status: 404 });
    try {
      return JSON.parse(
        JSON.stringify(
          await route.handle({
            params: route.pattern.exec(url.pathname)!.slice(1),
            url,
            body,
          } as never),
        ),
      );
    } catch (e) {
      if (e instanceof HttpError)
        throw Object.assign(
          new Error(String((e.body as { error?: string }).error)),
          { status: e.status, body: e.body },
        );
      throw e;
    }
  }) as LabCoreCall;
}

async function world(env: Record<string, string>) {
  const core = await setup();
  await core.moduleSettings.set(CH, 'chaos.enabled', 1, 'test');
  await editWallet(
    core.db,
    core.clock.now(),
    CH,
    VIEWER.id,
    'set',
    { tokens: 1_000_000 },
    'test',
  );
  const { rt, dir } = engine(env);
  const loop = await ChaosCoreLoop.open({
    runtime: rt,
    core: inProcess(core),
    environment: 'lab',
    channelId: CH,
    studioId: 'studio-e2e',
    journal: join(dir, 'core-journal.json'),
    heartbeatMs: 100,
  });
  loop.start();
  cleanup.push(() => loop.stop());
  const tokens = async () =>
    Number(
      (
        await core.db.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, VIEWER.id],
        )
      )[0]?.tokens,
    );
  const mine = async () =>
    (await core.chaos.state(CH, VIEWER)).mine as {
      id: string;
      status: string;
      refund_status: string;
      code: string | null;
    }[];
  // Studio prêt (le moteur démarre de lui-même : Chaos ouvert par le Core) : le devis n'est plus bloqué.
  const quote = async (effect: string) =>
    core.chaos.quote(CH, VIEWER, { effect, choice: {} } as never) as Promise<{
      price: number;
      block?: { code: string } | null;
      choice: unknown;
    }>;
  await until(async () => !(await quote('flip')).block);
  return { core, tokens, mine, quote, rt };
}

describe('Chaos V2 bout à bout : Core ↔ boucle Studio ↔ moteur (faux)', () => {
  it('achat : débité une fois, livré, joué, terminé ; le même envoi rejoué ne débite pas une seconde fois', async () => {
    const w = await world({
      FAKE_CHAOS_EFFECTS: 'flip,color',
      FAKE_CHAOS_PLAY_MS: '600',
    });
    const before = await w.tokens();
    const q = await w.quote('flip');
    const key = `intent-${randomUUID()}`;
    const buy = {
      viewer: VIEWER,
      idempotency_key: key,
      effect: 'flip',
      choice: q.choice,
      expected_price: q.price,
    };
    const out = (await w.core.chaos.buy(CH, buy as never)) as {
      request: { id: string };
    };
    const again = (await w.core.chaos.buy(CH, buy as never)) as {
      request: { id: string };
      duplicate: boolean;
    };
    expect(again).toMatchObject({
      duplicate: true,
      request: { id: out.request.id },
    });
    const done = await until(async () =>
      (await w.mine()).find(
        (r) => r.id === out.request.id && r.status === 'ended',
      ),
    );
    expect(done).toMatchObject({ refund_status: 'none' });
    expect(before - (await w.tokens())).toBe(q.price);
  });

  it('moteur arrêté pendant l’effet : fin signalée (engine_exit), politique d’interruption appliquée, remboursé (joué < 50 %)', async () => {
    const w = await world({
      FAKE_CHAOS_EFFECTS: 'flip',
      FAKE_CHAOS_PLAY_MS: '8000',
    });
    const before = await w.tokens();
    const q = await w.quote('flip');
    const out = (await w.core.chaos.buy(CH, {
      viewer: VIEWER,
      idempotency_key: `intent-${randomUUID()}`,
      effect: 'flip',
      choice: q.choice,
      expected_price: q.price,
    } as never)) as { request: { id: string } };
    await until(async () =>
      (await w.mine()).find(
        (r) => r.id === out.request.id && r.status === 'started',
      ),
    );
    await sleep(300);
    await w.rt.client.stop();
    const ended = await until(async () =>
      (await w.mine()).find(
        (r) =>
          r.id === out.request.id &&
          r.status === 'ended' &&
          r.refund_status === 'refunded',
      ),
    );
    expect(ended.code).toBe('engine_exit');
    expect(await w.tokens()).toBe(before);
  });
});
