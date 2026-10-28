import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HALLOWEEN, HalloweenRuntime } from '../src/halloween/runtime.js';

// Halloween engine (docs/HALLOWEEN.md): the Core's reachability as Studio's journal tells it. At Studio's start the
// Lab Core it launches needs a few seconds: no « injoignable » then; a real outage is written once, and its end too.

let dir = '';
let rt: HalloweenRuntime | null = null;
afterEach(async () => {
  rt?.stop();
  await rm(dir, { recursive: true, force: true });
});

async function runtime() {
  dir = await mkdtemp(join(tmpdir(), 'halloween-rt-'));
  let t = 1_000_000;
  let up = false;
  rt = new HalloweenRuntime({
    origin: 'http://127.0.0.1:4100',
    dir,
    pageDir: dir,
    core: (async () => {
      if (!up) throw new Error('fetch failed');
      return {};
    }) as never,
    environment: 'lab',
    channelId: '900100',
    studioId: 'studio-test',
    fromMain: () => false,
    now: () => t,
  });
  await rt.start();
  rt.stop(); // the test drives the heartbeat itself
  const beat = () =>
    (rt as unknown as { heartbeat(): Promise<void> }).heartbeat();
  const journal = () =>
    (rt!.status() as { events: { text: string }[] }).events.map((e) => e.text);
  return {
    beat,
    journal,
    advance: (ms: number) => (t += ms),
    setUp: (v: boolean) => (up = v),
  };
}

describe('Halloween runtime — Core reachability in the journal', () => {
  it('the Lab Core still starting: no « injoignable », then « Core joint »', async () => {
    const r = await runtime();
    await r.beat();
    r.advance(5_000);
    await r.beat();
    r.setUp(true);
    await r.beat();
    expect(r.journal().filter((x) => x.startsWith('Core'))).toEqual([
      'Core joint',
    ]);
  });

  it('a Core that never answers: written once, after the start grace', async () => {
    const r = await runtime();
    await r.beat();
    r.advance(HALLOWEEN.coreStartGraceMs + 1);
    await r.beat();
    await r.beat();
    expect(
      r.journal().filter((x) => x.startsWith('Core injoignable')),
    ).toHaveLength(1);
  });

  it('an outage after a connection: written at once, once; its end too', async () => {
    const r = await runtime();
    r.setUp(true);
    await r.beat();
    r.setUp(false);
    await r.beat();
    await r.beat();
    r.setUp(true);
    await r.beat();
    expect(r.journal().filter((x) => x.startsWith('Core'))).toEqual([
      'Core joint',
      'Core injoignable : fetch failed',
      'Core joint',
    ]);
  });
});
