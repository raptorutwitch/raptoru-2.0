import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerfLab } from '../src/chaos/perf.js';

// Performance Lab › Validation en jeu : les trois phases d'une mesure, telles qu'Antoni les lance (Miroir 10 / 40 / 10 s).
// Non-régression du 26/11 : la mesure s'arrêtait à la fin de la référence (le moteur refusait 40 s, au-delà de la
// durée maximale des effets du stream ; règle du moteur corrigée et testée dans chaos-unit). Horloge simulée : les 60 s
// passent en un instant. Faux moteur (mémoire des effets actifs) et fausse télémétrie : rien d'affiché, rien de mesuré.

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const c of cleanup.splice(0)) await c();
});

/** Fausse télémétrie (--perf-monitor) : Studio lit ses lignes ; « kill » la ferme comme Windows le ferait. */
function monitor() {
  const p = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
    killed: false,
    kill() {
      p.killed = true;
      p.stdout.end();
      setImmediate(() => p.emit('exit', 0));
      return true;
    },
  });
  const line = (o: object) => p.stdout.write(`${JSON.stringify(o)}\n`);
  line({ type: 'start', system: { cpu: { logical_cores: 4 } } });
  return {
    p,
    sample: (t_ms: number) =>
      line({ type: 'sample', t_ms, gpu_ms_all: t_ms, processes: [] }),
  };
}
const flush = () => new Promise((r) => setImmediate(r));

function lab(activate: (args: Record<string, unknown>) => Promise<unknown>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const dir = mkdtempSync(join(tmpdir(), 'chaos-perf-phases-'));
  const active = new Set<string>();
  const calls: { cmd: string; args: Record<string, unknown>; t: number }[] = [];
  const t0 = Date.now();
  let mon: ReturnType<typeof monitor> | null = null;
  const p = new PerfLab(
    'x',
    dir,
    async (cmd, args = {}) => {
      calls.push({ cmd, args, t: Date.now() - t0 });
      if (cmd === 'effect.activate') {
        await activate(args);
        active.add(String(args.effect));
      } else if (cmd === 'effect.stop') active.delete(String(args.effect));
      return {};
    },
    () => (mon = monitor()).p as unknown as ChildProcess,
  );
  cleanup.push(() => {
    p.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  /** Avance l'horloge par relevés de 500 ms, comme la vraie télémétrie, et note phase et effets actifs à chacun. */
  const run = async (maxMs: number) => {
    const seen: { t: number; phase?: string; active: boolean }[] = [];
    for (
      let t = 0;
      t <= maxMs && p.state().live.status === 'running';
      t += 500
    ) {
      mon!.sample(t);
      await flush();
      seen.push({
        t,
        phase: p.state().live.phase,
        active: active.has('mirror'),
      });
      await vi.advanceTimersByTimeAsync(500);
    }
    await flush();
    return seen;
  };
  return { p, calls, active, run, mon: () => mon! };
}

describe('Performance Lab : référence → effet → retour', () => {
  it('Miroir 10 / 40 / 10 s : rien pendant la référence, Miroir activé 40 s puis arrêté, retour, résultat — sans intervention', async () => {
    const { p, calls, active, run, mon } = lab(() => Promise.resolve());
    await p.startLive({
      effect: 'mirror',
      label: 'Miroir',
      reference_s: 10,
      effect_s: 40,
      after_s: 10,
    });
    const seen = await run(70_000);

    // Une seule activation à la fin de la référence (durée = phase « effet »), un seul arrêt à la fin de l'effet.
    expect(calls.map((c) => [c.cmd, c.t])).toEqual([
      ['effect.activate', 10_000],
      ['effect.stop', 50_000],
    ]);
    expect(calls[0]!.args).toMatchObject({
      effect: 'mirror',
      kind: 'manual',
      duration_ms: 40_000,
      source: { kind: 'studio', ref: 'Studio › Chaos › Performance Lab' },
    });
    expect(calls[1]!.args).toEqual({ effect: 'mirror' });

    // Chaque relevé : Miroir absent pendant la référence et le retour, présent pendant toute la phase « effet ».
    const by = (ph: string) => seen.filter((s) => s.phase === ph);
    expect(by('reference').length).toBe(20);
    expect(by('effect').length).toBe(80);
    expect(by('after').length).toBe(20);
    expect(by('reference').every((s) => !s.active)).toBe(true);
    expect(by('effect').every((s) => s.active)).toBe(true);
    expect(by('after').every((s) => !s.active)).toBe(true);
    expect(seen.map((s) => s.phase)).toEqual([
      ...Array<string>(20).fill('reference'),
      ...Array<string>(80).fill('effect'),
      ...Array<string>(20).fill('after'),
    ]);

    // Fin : résultat gardé avec ses trois phases, télémétrie fermée, Studio libre, aucun effet laissé.
    const st = p.state();
    expect(st.live).toMatchObject({ status: 'done', effect: 'mirror' });
    expect(st.live.error).toBeUndefined();
    expect(st.live_available).toBe(true);
    expect(mon().p.killed).toBe(true);
    expect(active.size).toBe(0);
    const r = st.live_results[0]!;
    expect(r).toMatchObject({
      effect: 'mirror',
      label: 'Miroir',
      phases_s: { reference: 10, effect: 40, after: 10 },
    });
    const phases = r.phases as Record<string, { samples: number }>;
    expect([
      phases.reference!.samples,
      phases.effect!.samples,
      phases.after!.samples,
    ]).toEqual([20, 80, 20]);
  });

  it('effet refusé par le moteur : la mesure s’arrête à la fin de la référence avec la raison, Studio libre, aucun effet', async () => {
    const { p, calls, active, run, mon } = lab(() =>
      Promise.reject(new Error('durée hors bornes [1000, 30000] ms')),
    );
    await p.startLive({
      effect: 'mirror',
      label: 'Miroir',
      reference_s: 10,
      effect_s: 40,
      after_s: 10,
    });
    const seen = await run(70_000);
    expect(seen.at(-1)!.t).toBe(9_500); // dernier relevé : fin de la référence, plus rien après le refus
    expect(calls.map((c) => c.cmd)).toEqual(['effect.activate']);
    const st = p.state();
    expect(st.live.status).toBe('failed');
    expect(st.live.error).toEqual({
      code: 'activate_failed',
      message:
        'Miroir n’a pas été activé par le moteur, mesure arrêtée : durée hors bornes [1000, 30000] ms',
    });
    expect(st.live_available).toBe(true);
    expect(mon().p.killed).toBe(true);
    expect(active.size).toBe(0);
    expect(st.live_results).toHaveLength(0);
  });
});
